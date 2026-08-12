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

/**
 * 連續失敗幾次後放棄重試。
 *
 * 上限針對的是「使用者已經停止操作，分頁卻還在背景無限打 Worker」——
 * 只要還有新的 `save()`，計數就歸零、重試繼續，所以正在閱讀的人不會被截斷。
 */
const MAX_RETRIES = 5;

/** 退避上限，避免長時間離線後把間隔推到荒謬的長度 */
const MAX_BACKOFF_MS = 60_000;

/**
 * 關閉前（登出／切換 adapter）沖出殘留進度的嘗試次數。
 *
 * 刻意**不加延遲**：這條路徑上呼叫端正等著往下走（登出流程），拖住它會讓
 * 使用者盯著沒反應的畫面。連續重試救得回 5xx 與代理瞬斷這類瞬時故障；
 * 真的斷線就救不回，改由回傳值讓呼叫端告知使用者。
 */
const SHUTDOWN_FLUSH_ATTEMPTS = 3;

/**
 * 這個 HTTP 狀態值得重試嗎？
 *
 * 只有暫時性故障該重試。400/413/422 這類請求本身就不合法的錯誤重送幾次
 * 都是同樣結果，只是固定每個週期空打一次 Worker——版本不相容或 blob 過大
 * 時，每個開著的分頁都會變成穩定的無效流量來源。
 *
 * 401 與 409 不會走到這裡：前者交給 onAuthExpired、後者交給權威 hydrate。
 */
function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

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
   * PUT 撞版本（409）時的回呼——伺服器上的進度在我們讀取之後被改寫
   * 過（另一台裝置並行寫入，或 admin 後台編輯／重置）。
   * 手上的快照已過期，呼叫端應改走 `hydrateConflict()` 收斂：遠端空
   * 視為 admin 重置（覆蓋），遠端非空視為並行寫入（聯集合併）。
   */
  onProgressConflict?: () => void;
  /**
   * 需要上傳但手上沒有伺服器版本號時的回呼（初次 GET 失敗過）。
   *
   * 沒有 rev 就無法做 CAS，此時上傳只能走時間戳弱鎖——而弱鎖擋不住
   * admin 的寫入。呼叫端應改為做一次權威 hydrate 取得 rev 並以伺服器
   * 為準收斂，而不是把本地推上去。
   *
   * 與 `onProgressConflict` 分開：這不是「進度被改寫」，只是本端
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
      'onAuthExpired' | 'onProgressConflict' | 'onRevMissing'
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
  /** 連續失敗次數；任何一次成功上傳或新的 `save()` 都會歸零 */
  private retries = 0;
  /** flush 序列化的尾巴——保證同一時間只有一個 PUT 在飛（見 `flush()`） */
  private inflight: Promise<void> = Promise.resolve();
  /**
   * 頁面正在卸載。只有 `pagehide` 會設起來——重排的計時器此後不會有機會執行。
   *
   * ⚠️ 別拿 `keepalive` 當這件事的代理訊號。`destroy()`（登出／切換 adapter）
   * 同樣用 keepalive，但那時頁面還好端端地在，重排是有意義的；
   * `visibilitychange` 也一樣，切走的分頁隨時可能切回來。
   */
  private unloading = false;
  private readonly onPageHide = () => {
    this.unloading = true;
    void this.flush(true);
  };

  constructor(options: ServerAdapterOptions) {
    this.opts = {
      apiBase: options.apiBase.replace(/\/$/, ''),
      getToken: options.getToken,
      onAuthExpired: options.onAuthExpired,
      onProgressConflict: options.onProgressConflict,
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
   *
   * @returns 殘留進度是否已經處理完畢。`false` 代表這一份**真的沒送出去**：
   * 呼叫端（登出）接著就會清掉 session 與本地鏡像，沒有任何後續機會補送，
   * 所以這個結果必須讓使用者知道，不能靜默吞掉。
   */
  async destroy(): Promise<boolean> {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    /* 這裡不能只 flush 一次。失敗時 `restorePending()` 會把快照放回 pending
       並排一次重試，但登出流程等不到那個計時器——session 隨即被清空，計時器
       醒來時 `getToken()` 回 null，那份進度就被當成「已登出」丟棄。而本地鏡像
       又會被 logout 的 reset 一併清掉（隱私要求），等於連退路都沒有。 */
    for (let attempt = 0; attempt < SHUTDOWN_FLUSH_ATTEMPTS; attempt += 1) {
      await this.flush(true);
      if (!this.pending) return true;
    }
    // 仍有殘留：清掉排好的重試，別讓它在 session 消失後空跑一趟
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return false;
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
    // 使用者還在操作就是新的一輪，之前累積的失敗不該讓這筆被上限擋掉
    this.retries = 0;
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
        this.discardStalePending();
        this.opts.onProgressConflict?.();
        return;
      }
      if (res.ok) {
        const json = (await res.json()) as ProgressResponse;
        if (typeof json.meta?.rev === 'number') this.rev = json.meta.rev;
        this.retries = 0;
        return;
      }
      // 暫時性故障（5xx、408、429、代理攔截…）：留著等重試
      if (isRetriableStatus(res.status)) {
        this.restorePending(snapshot);
        return;
      }
      /* 其餘 4xx 是請求本身不合法（版本不相容的 400、blob 過大的 413…），
         重送幾次都一樣。丟棄快照、不排重試；本地鏡像仍是最新的。 */
      this.retries = 0;
    } catch {
      // 網路失敗：可重試
      this.restorePending(snapshot);
    }
  }

  /**
   * 作廢「基於過期 canonical」的待送快照，連同已排的重試一起取消。
   *
   * 409 只清 `rev` 是不夠的。PUT 飛在天上時 UI 仍可能 `save()`，那份新快照
   * 是疊在**衝突前**的 canonical 上算出來的；接著 `onProgressConflict()` 觸發的
   * 權威 hydrate 走 `fetchRemote()`，而它會把伺服器的新 rev 寫回 `this.rev`。
   * 於是原本排好的 timer 醒來時 rev 已經有效，那份過期快照就帶著合法版本號
   * 通過 CAS——admin 或另一個分頁剛做的變更被無聲復原。
   *
   * 語意上與 `rev === null` 那條防線一致：任何沒跟伺服器對過帳的 state 都
   * 不准上傳。畫面會由 hydrate 收斂到伺服器版本，本地鏡像同時被更新。
   */
  private discardStalePending(): void {
    this.pending = null;
    this.retries = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
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
   * 頁面正在卸載時只放回、不重排——計時器不會有機會執行了。判斷看的是
   * `unloading` 而非 keepalive，兩者不等價（見該欄位的註解）。
   */
  private restorePending(snapshot: ProgressState): void {
    if (this.pending) return;
    this.pending = snapshot;
    if (this.unloading) return;

    this.retries += 1;
    if (this.retries > MAX_RETRIES) {
      /* 連續失敗到上限：停手。使用者顯然已經離開，繼續每個週期空打一次
         Worker 沒有意義。本地鏡像仍是最新的，下次 save 會重開一輪。 */
      return;
    }

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.nextRetryDelay());
  }

  /**
   * 指數退避 + jitter。
   *
   * jitter 刻意只往**下**抖（0.85~1.0 倍）而非上下各半：多分頁同時斷線時
   * 需要打散重試時點，但第一次重試仍要落在一個 debounce 週期內——往上抖會
   * 讓「失敗後隔一個週期重送」這個最基本的保證變成有時成立有時不成立。
   */
  private nextRetryDelay(): number {
    const backoff = Math.min(
      this.opts.debounceMs * 2 ** (this.retries - 1),
      MAX_BACKOFF_MS
    );
    return Math.round(backoff * (0.85 + Math.random() * 0.15));
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
