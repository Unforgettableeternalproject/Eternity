/**
 * 後台讀取受可見度過濾端點的共用工具。
 *
 * content-api 對未認證的讀取把靜態鎖頁（metadata.locked）換成存根：標題與
 * content 清空、metadata 只留結構鍵並標 `redacted: true`。後台若以訪客身分
 * 讀到存根再存回去，等於把封存內容覆蓋成空，所以：
 *
 * 1. SSR 直連 worker 的讀取必須轉發 httpOnly cookie 裡的管理員 JWT
 *    （同源 `/api/*` proxy 已各自轉發，這裡處理不經 proxy 的 SSR 路徑）
 * 2. 任何要進編輯器的資料都先檢查存根標記，帶標記一律拒絕進入可存檔狀態
 */

export const ADMIN_JWT_COOKIE = 'uep-admin-jwt';

export const REDACTED_STUB_ERROR =
  '讀取到受保護的存根資料，請重新登入後再開啟編輯器';

/** 管理員 JWT → Authorization header；沒有 JWT 回空物件 */
export function adminAuthHeaders(
  jwt: string | null | undefined
): Record<string, string> {
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/** metadata 是否為 content-api 的存根（visibility.ts `stubMetadata`） */
export function isRedactedMetadata(meta: unknown): boolean {
  return (
    !!meta &&
    typeof meta === 'object' &&
    !Array.isArray(meta) &&
    (meta as Record<string, unknown>).redacted === true
  );
}

/**
 * 存檔前的存根檢查：開頁時的 metadata 或存檔前重讀的 metadata 任一為存根，
 * 回傳錯誤訊息並擋下存檔；兩者皆非存根回 null。
 */
export function redactedSaveBlock(
  initialMetadata: unknown,
  latestMetadata: unknown
): string | null {
  return isRedactedMetadata(initialMetadata) ||
    isRedactedMetadata(latestMetadata)
    ? REDACTED_STUB_ERROR
    : null;
}

export interface AdminEditPageResult {
  page: any | null;
  error: string | null;
}

/**
 * `/admin/edit/[...slug]` 的 SSR 讀取：以管理員身分直連 content-api 取單頁。
 * 回應若仍是存根（JWT 缺失或失效），回錯誤而不交給編輯器。
 */
export async function loadAdminEditPage(
  contentApi: string,
  area: string,
  pageSlug: string,
  jwt: string | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<AdminEditPageResult> {
  try {
    const res = await fetchImpl(
      `${contentApi}/api/content/${area}/${pageSlug}`,
      {
        headers: adminAuthHeaders(jwt),
      }
    );
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('Content API not available (received non-JSON response)');
    }
    const json = await res.json();
    if (!json.ok) {
      return { page: null, error: json.error || 'Page not found' };
    }
    if (isRedactedMetadata(json.data?.metadata)) {
      return { page: null, error: REDACTED_STUB_ERROR };
    }
    return { page: json.data, error: null };
  } catch (e: any) {
    return {
      page: null,
      error: e?.message || 'Failed to connect to Content API',
    };
  }
}
