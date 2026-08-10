/**
 * UEP 讀者帳號 — 客戶端 session 管理（Epic 2 S5）
 *
 * 跨 island 共享模式沿用 progressStore：module singleton +
 * `window.__uepReaderAuth` bridge + `uep:auth-change` CustomEvent。
 *
 * token 存 localStorage（讀者帳號只保護閱讀進度，敏感度低；
 * admin 仍走 httpOnly cookie + SSR proxy，兩套完全分離）。
 *
 * 登入/註冊成功後自動把 progressStore 的 adapter 切成 ServerAdapter
 * （伺服器優先合併——遠端有資料則覆蓋本地；遠端為空**只有在全新帳號**
 * 時才上傳本地，見 `RemoteLoadResult`）。
 */

import { LocalStorageAdapter } from '../progress/adapters';
import { getProgressManager } from '../progress/progressStore';
import { ServerAdapter } from '../progress/serverAdapter';
import { getApiBase, isTestMode } from '../lib/apiBase';

/** 未登入訪客的統一稱呼（與 Worker uep-alias.ts 對齊） */
export const GUEST_ALIAS = '初入世界的朋友';

/** 觀測者印記持有者的顯示前綴（與 Worker uep-alias.ts 對齊） */
export const WITNESSED_PREFIX = '已見證的';

/**
 * localStorage key（含 schema 版本）。
 *
 * Test Mode 下加 `:test` 後綴做環境隔離——正式環境的讀者 token 因兩
 * worker 共用 JWT_SECRET 會被 test worker 接受，若跨環境殘留會讓
 * ServerAdapter 把另一環境的進度上傳進當前環境的帳號。
 * mode 切換必伴隨 reload，module 載入時計算一次即可。
 */
export const READER_SESSION_KEY = isTestMode()
  ? 'uep.reader.session.v1:test'
  : 'uep.reader.session.v1';

/** auth 狀態變更事件名稱 */
export const AUTH_CHANGE_EVENT = 'uep:auth-change';

const API_BASE = getApiBase();

export interface ReaderSession {
  token: string;
  username: string;
  alias: string;
  observerEver: boolean;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

type Listener = (session: ReaderSession | null) => void;

declare global {
  interface Window {
    __uepReaderAuth?: typeof uepReaderAuth;
  }
}

/* ── module-level 狀態 ── */
let session: ReaderSession | null = loadSessionSync();
let serverAdapter: ServerAdapter | null = null;
const listeners: Listener[] = [];

function loadSessionSync(): ReaderSession | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(READER_SESSION_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Partial<ReaderSession>;
    if (
      typeof obj.token !== 'string' ||
      typeof obj.username !== 'string' ||
      typeof obj.alias !== 'string'
    )
      return null;
    return {
      token: obj.token,
      username: obj.username,
      alias: obj.alias,
      observerEver: obj.observerEver === true,
    };
  } catch {
    return null;
  }
}

function persistSession(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (session) {
      window.localStorage.setItem(READER_SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(READER_SESSION_KEY);
    }
  } catch {
    // localStorage 不可用時靜默——auth 只影響同步，不阻斷閱讀
  }
}

function notify(): void {
  listeners.forEach((fn) => fn(session));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ReaderSession | null>(AUTH_CHANGE_EVENT, {
        detail: session,
      })
    );
  }
}

/** 建立 ServerAdapter 並切換 progressStore 的儲存層 */
async function attachServerAdapter(): Promise<void> {
  // 同 logout：舊 adapter 的殘留進度要在換掉它之前送完
  await serverAdapter?.destroy();
  serverAdapter = new ServerAdapter({
    apiBase: API_BASE,
    getToken: () => session?.token ?? null,
    onAuthExpired: () => {
      // token 過期：清 session、退回本地儲存（鏡像是新的，無縫）
      void uepReaderAuth.logout(true);
    },
    onProgressReset: () => {
      /* admin 在後台改寫了這個帳號的進度（清空**或**存入新內容），
         我們手上的是他寫入之前的快照，已被伺服器判定過期。

         必須走 hydrateAuthoritative()——它以遠端為準、遠端空則歸零，
         且不把本地推上去。兩個都不能用的替代方案：
         - reset()：admin 若存的是**非空**進度，reset 後那份空 state 會在
           2 秒後 PUT 上去，反過來蓋掉 admin 剛存的東西。
         - setAdapter() 重新 hydrate：遠端為 null 時它會「上傳本地作為
           初始值」，把同一份過期快照再送一次 → 又 409 → 無限重試。 */
      /* hydrate 完再 refresh：progress 的 observerEver 已由 meta 校正成
         伺服器值，但顯示用的「已見證的」前綴讀的是 session。admin 若
         **清除**了印記，session 仍是舊的 true，得靠 /auth/me 下修。
         （反向的「印記剛落下」由下方 progress 訂閱即時升級，不需等這裡。） */
      void getProgressManager()
        .hydrateAuthoritative()
        .then(() => uepReaderAuth.refresh());
      window.__uepToastManager?.info('閱讀進度已由管理者更新。');
    },
    onRevMissing: () => {
      /* 想上傳但手上沒有伺服器版本號（初次 GET 失敗過）。ServerAdapter
         已經放棄這次上傳——沒有 rev 只能走時間戳弱鎖，那條路擋不住
         admin 的寫入。這裡補一次權威 hydrate 取回 rev 並以伺服器為準
         收斂，之後的 mutation 就能正常做 CAS。

         刻意不 toast：對使用者而言什麼都沒發生（本地鏡像一路是新的），
         這只是背景的同步重試，不是「管理者改了你的進度」。
         hydrate 若也失敗，rev 維持 null，下一次 mutation 會再觸發一次。 */
      void getProgressManager().hydrateAuthoritative();
    },
  });
  await getProgressManager().setAdapter(serverAdapter);
}

/** 呼叫 auth API 的共用包裝 */
async function postJson<T>(
  path: string,
  body: unknown
): Promise<{ status: number; ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok: boolean;
      data?: T;
      error?: string;
    };
    return {
      status: res.status,
      ok: json.ok,
      data: json.data,
      error: json.error,
    };
  } catch {
    return { status: 0, ok: false, error: '無法連線至記錄服務' };
  }
}

interface AuthResponseData {
  token: string;
  username: string;
  alias: string;
  observerEver: boolean;
}

function applyAuthData(data: AuthResponseData): void {
  session = {
    token: data.token,
    username: data.username,
    alias: data.alias,
    observerEver: data.observerEver,
  };
  persistSession();
  notify();
}

/* ── 公開 API ── */
export const uepReaderAuth = {
  /** 目前 session（null = 訪客） */
  getSession(): ReaderSession | null {
    return session;
  },

  /** 是否已登入 */
  isLoggedIn(): boolean {
    return session !== null;
  },

  /**
   * 顯示用代稱：訪客 → 「初入世界的朋友」；
   * 有觀測者印記的註冊者 → 「已見證的」+ 代稱。
   */
  displayAlias(): string {
    if (!session) return GUEST_ALIAS;
    return session.observerEver
      ? `${WITNESSED_PREFIX}${session.alias}`
      : session.alias;
  },

  /** 隨機 roll 一個代稱（註冊 UI 的重 roll 按鈕） */
  async rollAlias(): Promise<string | null> {
    try {
      const res = await fetch(`${API_BASE}/api/uep/alias/roll`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { alias: string };
      };
      return json.ok && json.data ? json.data.alias : null;
    } catch {
      return null;
    }
  },

  /** 註冊；成功後自動登入並切換 ServerAdapter */
  async register(input: {
    username: string;
    password: string;
    email?: string;
    alias?: string;
  }): Promise<AuthResult> {
    const res = await postJson<AuthResponseData>(
      '/api/uep/auth/register',
      input
    );
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error || '註冊失敗' };
    }
    applyAuthData(res.data);
    await attachServerAdapter();
    return { ok: true };
  },

  /** 登入；成功後切換 ServerAdapter（伺服器優先合併） */
  async login(username: string, password: string): Promise<AuthResult> {
    const res = await postJson<AuthResponseData>('/api/uep/auth/login', {
      username,
      password,
    });
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error || '登入失敗' };
    }
    applyAuthData(res.data);
    await attachServerAdapter();
    return { ok: true };
  },

  /**
   * 登出：清 session、進度退回 LocalStorageAdapter 並**清空本機進度**。
   *
   * 本機進度為何要清：ServerAdapter 一路
   * write-through 本地鏡像，登出後那份鏡像仍完整保有上一位登入者的
   * flags／完成頁／便條／閱讀時數。共用瀏覽器的下一位訪客會直接繼承
   * 別人的閱讀足跡——這是隱私缺口，優先於「同一人登出再登入很無縫」。
   *
   * ⚠️ **四個步驟的順序不可對調**，每一步都在擋一個具體事故：
   * 1. `destroy()` 先跑——它會 flush 殘留進度，此時 token 仍有效，
   *    這些資料屬於原帳號，本來就該上傳。**必須 await**：flush 走 promise
   *    鏈，不等的話 PUT 醒來時第 2 步已經把 session 清掉，`getToken()` 回
   *    null，殘留進度會被當成「已登出」丟棄。
   * 2. 清 session。**必須在 reset 之前**：`flush()` 靠 `getToken()` 回 null
   *    才放棄上傳，順序反過來會把重置後的空進度 PUT 上去，
   *    **直接清空伺服器上的帳號進度**。
   * 3. 換 LocalStorageAdapter，且 `hydrate: false`——下一步就要 reset，
   *    讀回舊帳號鏡像只是白做工兼畫面閃爍。
   *    （這步同時遞增 adapter 世代，讓仍在飛的舊 hydrate 結果作廢。）
   * 4. `reset({ keepObserverEver: false })`，此時 persist 走的已是本地
   *    adapter，安全。**印記必須一起清**——它屬於帳號不屬於裝置，留著
   *    會被下一位新註冊者的初始上傳帶進伺服器並永久生效，詳見
   *    `progressStore.reset()` 的註解。
   *
   * @param expired token 過期觸發時為 true（UI 可顯示不同訊息）
   */
  async logout(expired = false): Promise<void> {
    await serverAdapter?.destroy();
    serverAdapter = null;
    session = null;
    persistSession();
    const progress = getProgressManager();
    await progress.setAdapter(new LocalStorageAdapter(), { hydrate: false });
    progress.reset({ keepObserverEver: false });
    notify();
    if (expired && typeof window !== 'undefined') {
      window.__uepToastManager?.info('記錄憑證已過期，請重新登入。');
    }
  },

  /**
   * 以既有 token 重新驗證並更新使用者資訊（頁面載入時呼叫）。
   * token 失效時自動登出。
   */
  async refresh(): Promise<void> {
    if (!session) return;
    try {
      const res = await fetch(`${API_BASE}/api/uep/auth/me`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (res.status === 401) {
        await this.logout(true);
        return;
      }
      if (!res.ok) return; // 暫時性錯誤：維持現狀
      const json = (await res.json()) as {
        ok: boolean;
        data?: { username: string; alias: string; observerEver: boolean };
      };
      if (json.ok && json.data) {
        session = { ...session, ...json.data };
        persistSession();
        notify();
      }
    } catch {
      // 離線：維持現狀
    }
  },

  /** 訂閱 auth 狀態變更，回傳取消訂閱函式 */
  subscribe(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
      const i = listeners.indexOf(listener);
      if (i > -1) listeners.splice(i, 1);
    };
  },
};

/* ── window bridge（跨 React island 單例保證） ── */
if (typeof window !== 'undefined' && !window.__uepReaderAuth) {
  window.__uepReaderAuth = uepReaderAuth;
  // 已有 session：頁面載入即接上 ServerAdapter + 背景驗證 token
  if (session) {
    void attachServerAdapter().then(() => uepReaderAuth.refresh());
  }
  // 印記即時同步：觀測者印記的事實來源在 progress store（切視角當下寫入），
  // session 只是快照——這裡訂閱 store，印記一落下就同步進 session 並通知消費端，
  // 「已見證的」前綴與識別證印記列不用等 refresh/重載。
  getProgressManager().subscribe((state) => {
    if (session && state.observerEver && !session.observerEver) {
      session = { ...session, observerEver: true };
      persistSession();
      notify();
    }
  });
}

/** 取得全域單例（優先 window bridge，SSR fallback 為 module 實例） */
export function getReaderAuth(): typeof uepReaderAuth {
  if (typeof window !== 'undefined' && window.__uepReaderAuth) {
    return window.__uepReaderAuth;
  }
  return uepReaderAuth;
}
