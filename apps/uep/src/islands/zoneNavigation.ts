/**
 * 浮島 → Reader 的跨區導航（S10-1）
 *
 * 各 zone 的 Reader 都是單一路由 SPA（`/history`、`/concepts`…），內部靠
 * `useZoneRouter` 讀 query string 切子頁。浮島與 Reader 分屬不同 React
 * root，只能經 URL 溝通，且要分兩種情況：
 *
 * - **已在該 zone**：`pushState` 改 URL 後**手動 dispatch popstate**。
 *   pushState 依規範不會自己觸發 popstate（只有瀏覽器上下頁才會），而
 *   `useZoneRouter` 只監聽 popstate——少了這一步 URL 換了但畫面不動。
 *   這是 07/25 三驗才追出來的根因，四處導航都踩同一個坑。
 * - **在其他 zone**：整頁導航（跨 zone 沒有不重載的路徑）。
 *
 * 原本 History 與 Concepts 各自帶一份幾乎相同的實作，S10-1 要再加
 * Echoes 與 Visuals——與其變成四份，收斂成一份。日後改 pushState 語意
 * 時不會漏掉其中一處。
 */

/** 各 zone 用哪個 query param 指向「一頁內容」 */
const ZONE_PAGE_PARAM = {
  history: 'page',
  concepts: 'page',
  /** Echoes 的歌曲頁走 `?song=`，`?page=` 是非歌曲的內容頁 */
  echoes: 'song',
  visuals: 'page',
} as const;

export type NavigableZone = keyof typeof ZONE_PAGE_PARAM;

/**
 * 跳到某個 zone 的指定頁面。
 *
 * `pageId` 可帶或不帶 area prefix（`history/xxx` 與 `xxx` 都吃）——各
 * Reader 的路由 handler 統一用不帶 prefix 的 slug，會自己補回去。
 *
 * 未解鎖的頁面不在這裡擋：呼叫端的 UI 層本來就不該給出入口，Reader 的
 * deep-link 守門是最後防線（呈現 not-found 而非洩漏內容）。
 */
export function navigateToZonePage(
  zone: NavigableZone,
  pageId: string,
  /** 覆寫 query param——Echoes 要導向非歌曲內容頁時傳 `'page'` */
  paramOverride?: string
): void {
  if (typeof window === 'undefined') return;
  const prefix = `${zone}/`;
  const slug = pageId.startsWith(prefix) ? pageId.slice(prefix.length) : pageId;
  const param = paramOverride ?? ZONE_PAGE_PARAM[zone];
  const onZonePage = window.location.pathname.replace(/\/$/, '') === `/${zone}`;

  if (onZonePage) {
    const url = new URL(window.location.href);
    // 整組清掉再設：舊 query（別的子頁、group 索引…）留著會讓
    // useZoneRouter 依「第一個命中的 param」分派到錯的 route
    url.search = '';
    url.searchParams.set(param, slug);
    window.history.pushState({}, '', url.toString());
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  window.location.href = `/${zone}?${param}=${encodeURIComponent(slug)}`;
}
