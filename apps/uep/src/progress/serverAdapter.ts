/**
 * UEP 進度系統 — ServerAdapter（Epic 2 S5）
 *
 * 登入後接管進度儲存：
 * - load()：GET /api/uep/progress（伺服器優先；網路失敗時 fallback 本地鏡像）
 * - save()：write-through——立即寫 localStorage 鏡像 + debounce 合批 PUT 上傳。
 *   掃描線的 marker-update 很頻繁，絕不能每次 mutation 都打 Worker。
 *
 * 設計原則：進度同步失敗不阻斷閱讀（靜默容錯），登出後因為鏡像
 * 一直是新的，切回 LocalStorageAdapter 完全無縫。
 */

import { LocalStorageAdapter, normalizeState } from './adapters';
import type {
  AuthoritativeSnapshot,
  ProgressAdapter,
  ProgressState,
  RemoteLoadResult,
} from './types';

/** debounce 預設間隔（毫秒） */
const DEFAULT_DEBOUNCE_MS = 2000;

/** `/api/uep/progress` 的回應形狀（meta 與 data 平行） */
interface ProgressResponse {
  ok: boolean;
  data?: unknown;
  meta?: { rev?: number; observerEver?: boolean };
}

export interface ServerAdapterOptions {
  /** content-api base URL */
  apiBase: string;
  /** 取得當前讀者 token；回傳 null 代表已登出（上傳直接放棄） */
  getToken: () => string | null;
  /** token 失效（401）時的回呼——由 auth 層清除 session */
  onAuthExpired?: () => void;
  /**
   * 進度被 admin 重置（409）時的回呼。
   * 手上的快照已過期，呼叫端應改為從伺服器重新 hydrate。
   */
  onProgressReset?: () => void;
  /**
   * 需要上傳但手上沒有伺服器版本號時的回呼（初次 GET 失敗過）。
   *
   * 沒有 rev 就無法做 CAS，此時上傳只能走時間戳弱鎖——而弱鎖擋不住
   * admin 的寫入。呼叫端應改為做一次權威 hydrate 取得 rev 並以伺服器
   * 為準收斂，而不是把本地推上去。
   *
   * 與 `onProgressReset` 分開：這不是「管理者改了你的進度」，只是本端
   * 從未讀到伺服器，不該對使用者顯示相同的提示。
   */
  onRevMissing?: () => void;
  /** debounce 間隔，測試用 */
  debounceMs?: number;
}

export class ServerAdapter implements ProgressAdapter {
  private readonly local = new LocalStorageAdapter();
  private readonly opts: Required<
    Pick<ServerAdapterOptions, 'apiBase' | 'getToken' | 'debounceMs'>
  > &
    Pick<
      ServerAdapterOptions,
      'onAuthExpired' | 'onProgressReset' | 'onRevMissing'
    >;

  private pending: ProgressState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 伺服器發放的進度版本號，PUT 時以 `X-Progress-Rev` 帶回做 CAS。
   *
   * null = 尚未成功從伺服器讀過。此狀態下 `flush()` 一律放棄上傳並要求
   * 呼叫端做權威 hydrate——不會退回時間戳弱鎖（見 `flush()` 的註解）。
   */
  private rev: number | null = null;
  /** flush 序列化的尾巴——保證同一時間只有一個 PUT 在飛（見 `flush()`） */
  private inflight: Promise<void> = Promise.resolve();
  private readonly onPageHide = () => {
    void this.flush(true);
  };

  constructor(options: ServerAdapterOptions) {
    this.opts = {
      apiBase: options.apiBase.replace(/\/$/, ''),
      getToken: options.getToken,
      onAuthExpired: options.onAuthExpired,
      onProgressReset: options.onProgressReset,
      onRevMissing: options.onRevMissing,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    };
    // 離開頁面時把未上傳的進度沖出去（keepalive 讓請求在 unload 後存活）
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void this.flush(true);
  };

  /**
   * 移除事件監聽並沖出殘留進度（登出／切換 adapter 時呼叫）。
   *
   * ⚠️ **回傳的 Promise 必須被 await**。`flush()` 走的是 `inflight` 鏈，實際的
   * PUT 至少要等到下一個 microtask 才會讀 token；呼叫端若不等就同步清掉
   * session，`doFlush()` 醒來時 `getToken()` 已經回 null，這份殘留進度會被
   * 當成「已登出」直接丟棄——debounce 窗口內（預設兩秒）的閱讀全部消失。
   */
  destroy(): Promise<void> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.flush(true);
  }

  /**
   * 單一遠端讀取實作，四態語意見 `RemoteLoadResult`。
   * `load()` / `loadRemote()` / `loadAuthoritative()` 全部走這裡，
   * 差別只在如何把結果翻譯成各自的回傳型別。
   */
  private async fetchRemote(): Promise<RemoteLoadResult> {
    const token = this.opts.getToken();
    if (!token) return { kind: 'unavailable' };
    try {
      const res = await fetch(`${this.opts.apiBase}/api/uep/progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        this.opts.onAuthExpired?.();
        return { kind: 'unavailable' };
      }
      if (!res.ok) return { kind: 'unavailable' };
      const json = (await res.json()) as ProgressResponse;
      if (!json.ok) return { kind: 'unavailable' };

      const rev = typeof json.meta?.rev === 'number' ? json.meta.rev : null;
      if (rev !== null) this.rev = rev;
      const observerEver = json.meta?.observerEver === true;

      /* 「遠端沒有可用進度」的兩種來歷靠 rev 分辨：
         - rev === 0：這個帳號從來沒被寫過（全新註冊）→ absent，
           呼叫端可以把匿名期的本地進度匯入為初始值。
         - rev > 0：曾被寫過而現在是空的（admin 剛重置）→ empty，
           本地鏡像正是被清掉的那份，推回去等於復原他的操作。
         rev 缺失（尚未升級的 worker）保守當 empty——寧可少匯入一次
         匿名進度，也不要冒著把 admin 的重置蓋回去的風險。 */
      const withoutState = (): RemoteLoadResult =>
        rev === 0
          ? { kind: 'absent', observerEver }
          : { kind: 'empty', observerEver };

      if (json.data === null || json.data === undefined) return withoutState();

      // blob 存在但無法正規化（資料毀損）：同樣視為沒有可用進度
      const state = normalizeState(json.data);
      if (!state) return withoutState();

      return { kind: 'present', state, observerEver };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  /** 四態遠端讀取——`setAdapter()` hydrate 用（見 `RemoteLoadResult`） */
  loadRemote(): Promise<RemoteLoadResult> {
    return this.fetchRemote();
  }

  async load(): Promise<ProgressState | null> {
    if (!this.opts.getToken()) return null;
    const result = await this.fetchRemote();
    switch (result.kind) {
      case 'present':
        return result.state;
      case 'empty':
      case 'absent':
        // 帳號無雲端進度。⚠️ 呼叫端無法從這個 null 分辨「權威空」與
        // 「讀不到」——需要區分的話走 loadRemote()。
        return null;
      case 'unavailable':
        // 伺服器暫時性錯誤／離線：fallback 本地鏡像，不阻斷閱讀
        return this.local.loadSync();
    }
  }

  save(state: ProgressState): Promise<void> {
    // write-through：本地鏡像永遠即時，登出切回 LocalStorageAdapter 無縫
    void this.local.save(state);
    this.pending = state;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.debounceMs);
    return Promise.resolve();
  }

  /**
   * 立即上傳未送出的進度。keepalive=true 用於 pagehide（unload 後請求仍存活）。
   *
   * 對 `doFlush()` 做**序列化**——同一時間只有一個 PUT 在飛
   * 。少了這道鏈：慢網路下第一個 PUT 還沒回來，
   * 第二次 debounce 到期就帶著**同一個** rev 送出；伺服器讓先到的通過、
   * 後到的回 409，而 409 觸發的權威 hydrate 會把 state 收斂成**較舊**的
   * 第一筆，較新的第二筆憑空消失。排隊後第二筆讀到的是第一筆更新過的
   * rev，正常通過。
   *
   * 鏈上刻意吃掉 rejection：`doFlush()` 內部已全面靜默容錯，這裡只是
   * 防止某次意外的 reject 讓整條鏈永久卡死。
   */
  flush(keepalive = false): Promise<void> {
    const next = this.inflight.then(() => this.doFlush(keepalive));
    this.inflight = next.catch(() => {});
    return next;
  }

  private async doFlush(keepalive: boolean): Promise<void> {
    if (!this.pending) return;
    const token = this.opts.getToken();
    if (!token) {
      // 已登出：放棄上傳（本地鏡像已保存）
      this.pending = null;
      return;
    }
    /* rev 未知 = 初次 GET 從未成功過（離線開站、伺服器短暫掛掉，或
       上一次 409 之後 hydrate 也失敗）。此時**絕不能上傳**：沒有 rev
       只能讓 worker 退回時間戳弱鎖，而弱鎖擋不住 admin 的寫入——只要
       初次 GET 短暫失敗，這份沒跟伺服器對過帳的 state 就會覆蓋 admin
       剛存的內容。

       丟棄 pending 而非留著重試：它衍生自未經驗證的 state，權威 hydrate
       完成後會被伺服器版本取代；留著只會在下次 flush 帶著**新** rev 送
       出去，變成合法通過 CAS 的盲目覆蓋。本地鏡像已由 save() 即時
       write-through，畫面與離線閱讀都不受影響。 */
    if (this.rev === null) {
      this.pending = null;
      this.opts.onRevMissing?.();
      return;
    }

    const snapshot = this.pending;
    const body = JSON.stringify(snapshot);
    this.pending = null;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // 版本號做 compare-and-swap。上面已保證 rev 非 null——
        // 「不帶 header 走弱鎖」那條路對本客戶端已永久關閉。
        'X-Progress-Rev': String(this.rev),
      };

      const res = await fetch(`${this.opts.apiBase}/api/uep/progress`, {
        method: 'PUT',
        headers,
        body,
        keepalive,
      });
      if (res.status === 401) {
        this.opts.onAuthExpired?.();
        return;
      }
      /* 409 = 版本衝突：伺服器上的進度在我們讀取之後被改寫過
         （admin 後台編輯／清空，或另一個分頁搶先寫入）。
         手上這份必然過期，繼續重試只會一直被拒——交給呼叫端做權威
         hydrate 收斂。rev 一併作廢，避免下次又拿舊版本去撞。 */
      if (res.status === 409) {
        this.rev = null;
        this.opts.onProgressReset?.();
        return;
      }
      if (res.ok) {
        const json = (await res.json()) as ProgressResponse;
        if (typeof json.meta?.rev === 'number') this.rev = json.meta.rev;
        return;
      }
      // 其他錯誤（5xx、代理攔截…）：留著等重試
      this.restorePending(snapshot, keepalive);
    } catch {
      // 網路失敗：同上
      this.restorePending(snapshot, keepalive);
    }
  }

  /**
   * 把送失敗的快照放回 `pending` 並重排一次上傳。
   *
   * 原本這裡是「靜默丟棄，下次 save 會帶著最新狀態重試」——但那句話的前提是
   * **之後還有下一次 save**。使用者停止操作或直接關掉分頁時沒有下一次，而
   * 這筆進度已經從 `pending` 消失，於是只活在本地鏡像裡；下次開站的
   * server-first hydrate 會拿伺服器上較舊的版本把鏡像覆蓋掉，那段閱讀就真的
   * 不見了。
   *
   * ⚠️ 只在期間沒有更新的 pending 時才放回——`save()` 可能在這次請求飛在天上
   * 時寫入了更新的快照，用舊的蓋掉它等於把進度倒退。
   *
   * keepalive 代表這是 pagehide／visibilitychange 的最後一搏，頁面即將卸載，
   * 重排計時器不會有機會執行，放回也只是讓狀態一致而已。
   */
  private restorePending(snapshot: ProgressState, keepalive: boolean): void {
    if (this.pending) return;
    this.pending = snapshot;
    if (keepalive) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.debounceMs);
  }

  /**
   * 嚴格遠端讀取——與 `load()` 的關鍵差異是**任何失敗都回 null**，
   * 絕不 fallback 本地鏡像。
   *
   * 權威 hydrate 的前提是「以伺服器為準」，而此刻本地鏡像正是被判定過期
   * 的那份。若在 GET 失敗時把它當成伺服器事實採用，下一次 mutation 會帶
   * 著新版本號把過期資料寫回去，等於繞過整個衝突偵測。
   */
  async loadAuthoritative(): Promise<AuthoritativeSnapshot | null> {
    const result = await this.fetchRemote();
    // 讀不到就說讀不到，不拿本地充數
    if (result.kind === 'unavailable') return null;
    return {
      state: result.kind === 'present' ? result.state : null,
      observerEver: result.observerEver,
    };
  }
}
