/**
 * Content API base URL 解析（Issue #41 隔離測試環境）
 *
 * 優先順序：
 * 1. Cookie `uep-test-api-url` — Test Mode override（僅 Admin 可寫入）
 * 2. `import.meta.env.PUBLIC_CONTENT_API_URL` — build-time 環境變數
 * 3. 硬編碼 fallback `http://localhost:8788`（本地 wrangler dev）
 *
 * SSR 端（Astro server / API route）：呼叫端必須明確傳入 test cookie 值。
 * Client 端（React island）：讀環境變數後疊 cookie override。
 *
 * ⚠️ 兩站的 `apiBase.ts` **介面契約**必須一致（apps/root 有對應版本），
 *    但 cookie 名稱各站獨立以區分 namespace（uep-* vs root-*）。
 *    未來若要升格到 `packages/` 共用，cookie 名稱需改為 factory 參數。
 */

/** 部署後的正式 test worker URL；toggle UI 與 override 驗證會用到 */
const TEST_WORKER_URL =
  'https://eternity-content-api-test.ptyc4076.workers.dev';

/** test worker 的完整 hostname；override 驗證用完整比對，不可只看第一段 */
const TEST_WORKER_HOST = new URL(TEST_WORKER_URL).hostname;

/** Test Mode override cookie 名稱 */
const TEST_COOKIE_NAME = 'uep-test-api-url';

/** Cookie 保留天數 */
const TEST_COOKIE_TTL_DAYS = 7;

/** Content API URL 若未設定時的最後 fallback（本地 wrangler dev port） */
const FALLBACK_BASE = 'http://localhost:8788';

// ── 內部工具：cookie 讀寫（SSR-safe，無 document 時不動作） ──

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const entries = document.cookie.split('; ').filter(Boolean);
  for (const raw of entries) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const key = raw.slice(0, eq);
    if (key === name) {
      try {
        return decodeURIComponent(raw.slice(eq + 1));
      } catch {
        return raw.slice(eq + 1);
      }
    }
  }
  return null;
}

function writeCookie(
  name: string,
  value: string,
  opts: { days?: number; sameSite?: 'Strict' | 'Lax' | 'None' } = {}
): void {
  if (typeof document === 'undefined') return;
  const { days = 7, sameSite = 'Strict' } = opts;
  const maxAge = days * 86400;
  const encoded = encodeURIComponent(value);
  const secure =
    typeof globalThis.location !== 'undefined' &&
    globalThis.location.protocol === 'https:'
      ? '; Secure'
      : '';
  document.cookie = `${name}=${encoded}; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}${secure}`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof globalThis.location !== 'undefined' &&
    globalThis.location.protocol === 'https:'
      ? '; Secure'
      : '';
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
}

function decodeCookieValue(value: string | null): string | null {
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 判斷一個 URL 是否為合法 test worker URL。
 *
 * 規則：可 parse 為 URL 且 hostname **完整等於** test worker hostname。
 * 必須完整比對，不能只看第一段——`eternity-content-api-test.evil.com`
 * 的第一段同樣是 test worker 名稱，只比對 `split('.')[0]` 會讓偽造網域過關，
 * 使 SSR proxy 把 admin JWT 轉送到攻擊者網域（hostname 完整比對，取代前綴判斷）。
 */
function isTestWorkerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === TEST_WORKER_HOST;
  } catch {
    return false;
  }
}

/** 環境變數形式的 base URL（無尾斜線）；空字串或未定義都走 fallback */
function envBase(): string {
  const raw =
    (import.meta.env.PUBLIC_CONTENT_API_URL as string | undefined) ||
    FALLBACK_BASE;
  // trim 防禦：Cloudflare Pages 環境變數常被誤貼前導/尾隨空白，
  // 帶空白的 URL 雖被 fetch 容忍，但字串比對（isTestWorkerUrl 等）會出錯。
  return raw.trim().replace(/\/+$/, '');
}

// ── 公開 API ──

/**
 * 回傳當前應使用的 Content API base URL（保證無尾斜線）。
 *
 * Client-side 且 cookie 為合法 test worker URL → 使用 override。
 * 其他情況 → 使用環境變數（或 fallback）。
 */
export function getApiBase(serverCookieValue?: string | null): string {
  const override =
    serverCookieValue === undefined
      ? readCookie(TEST_COOKIE_NAME)
      : decodeCookieValue(serverCookieValue);
  if (override && isTestWorkerUrl(override)) {
    return override.trim().replace(/\/+$/, '');
  }
  return envBase();
}

/**
 * 判斷目前是否處於 Test Mode。
 *
 * 條件（滿足任一即為 true）：
 * 1. Cookie `uep-test-api-url` 存在且為合法 test worker URL（僅 client-side）
 * 2. 環境變數 `PUBLIC_CONTENT_API_URL` 直接指向 test worker
 *    （test Pages 專案部署時 build-time 綁定；SSR 端也會 true）
 *
 * ⚠️ SSR 端不再永遠回 false（架構稿 ADR-02 原稿如此，實作已調整）：
 *    若 build-time env 指向 test worker，SSR 首次渲染就會判定 test mode。
 *    T-07 Banner 可依此在 SSR 渲染時直接輸出，不必等 client hydration。
 */
export function isTestMode(): boolean {
  const override = readCookie(TEST_COOKIE_NAME);
  if (override && isTestWorkerUrl(override)) return true;
  return isTestWorkerUrl(envBase());
}

/**
 * 寫入或清除 Test Mode override cookie（僅供 Admin 呼叫）。
 *
 * @param testUrl test worker URL；`null` 或空字串代表清除 override。
 * @returns `true` 若寫入或清除成功，`false` 若拒絕（非 test worker URL）。
 *
 * 呼叫端應在 `true` 時 `location.reload()` 讓其他模組重新解析。
 */
export function setTestModeOverride(testUrl: string | null): boolean {
  if (typeof document === 'undefined') return false;
  if (!testUrl) {
    deleteCookie(TEST_COOKIE_NAME);
    return true;
  }
  if (!isTestWorkerUrl(testUrl)) {
    console.warn('[apiBase] 拒絕寫入非 test worker URL:', testUrl);
    return false;
  }
  writeCookie(TEST_COOKIE_NAME, testUrl, {
    days: TEST_COOKIE_TTL_DAYS,
    sameSite: 'Strict',
  });
  return true;
}

/** Test worker URL 常數（供 admin toggle UI 顯示與呼叫 `setTestModeOverride`） */
export const TEST_WORKER_BASE_URL = TEST_WORKER_URL;

/** Test Mode override cookie 名稱（供 E2E 測試 / SSR 端讀取判斷用） */
export const TEST_MODE_COOKIE_NAME = TEST_COOKIE_NAME;

// ── 測試專用 export（僅供單元測試 import；不供業務程式使用） ──
// FALLBACK_BASE 是實作細節，不 export 讓測試 assert（避免改 fallback 就要同步改測試）。
export const __internal = {
  readCookie,
  writeCookie,
  deleteCookie,
  decodeCookieValue,
  isTestWorkerUrl,
  envBase,
};
