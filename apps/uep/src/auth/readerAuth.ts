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
 * （伺服器優先合併——遠端有資料則覆蓋本地、遠端空則上傳本地）。
 */

import { LocalStorageAdapter } from '../progress/adapters';
import { getProgressManager } from '../progress/progressStore';
import { ServerAdapter } from '../progress/serverAdapter';
import { getApiBase } from '../lib/apiBase';

/** 未登入訪客的統一稱呼（與 Worker uep-alias.ts 對齊） */
export const GUEST_ALIAS = '初入世界的朋友';

/** 觀測者印記持有者的顯示前綴（與 Worker uep-alias.ts 對齊） */
export const WITNESSED_PREFIX = '已見證的';

/** localStorage key（含 schema 版本） */
export const READER_SESSION_KEY = 'uep.reader.session.v1';

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
  serverAdapter?.destroy();
  serverAdapter = new ServerAdapter({
    apiBase: API_BASE,
    getToken: () => session?.token ?? null,
    onAuthExpired: () => {
      // token 過期：清 session、退回本地儲存（鏡像是新的，無縫）
      void uepReaderAuth.logout(true);
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
   * 登出：清 session、進度退回 LocalStorageAdapter。
   * ServerAdapter 一直 write-through 本地鏡像，切回無縫。
   * @param expired token 過期觸發時為 true（UI 可顯示不同訊息）
   */
  async logout(expired = false): Promise<void> {
    serverAdapter?.destroy();
    serverAdapter = null;
    session = null;
    persistSession();
    await getProgressManager().setAdapter(new LocalStorageAdapter());
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
