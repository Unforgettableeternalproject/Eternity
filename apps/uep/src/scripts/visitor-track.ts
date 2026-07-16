/**
 * 文件站訪客追蹤（fire-and-forget）
 *
 * 為什麼在 uep 端要獨立追蹤：
 * - visitor-counter Worker 已支援 ?site=root|uep 分站計數（無參數視同 root）
 * - Discord widget 的 uepVisitorCount 統計需要文件站有自己的追蹤來源
 * - Widget UI 在文件站不顯示計數，這只是個「打卡動作」，不需要處理回傳
 *
 * 行為：
 * - sessionStorage 24h 去重 key：'uep-visitor-tracked'
 * - 缺 PUBLIC_VISITOR_API_URL 時直接跳過（開發環境常見）
 * - 錯誤全部吞掉——追蹤不應該影響閱讀體驗
 *
 * 注意：這是 Astro 端 client-side module，Vite build 會把 import.meta.env.PUBLIC_*
 * 靜態替換成實際值，所以可以直接在此讀取。
 */

const SESSION_KEY = 'uep-visitor-tracked';

/**
 * 內部：實際送 track 請求。已通過去重檢查與 apiUrl 檢查。
 */
function sendTrack(apiUrl: string): void {
  // fire-and-forget；keepalive 讓頁面關閉時仍能送出
  fetch(`${apiUrl}/api/visitor/track?site=uep`, {
    method: 'POST',
    keepalive: true,
  }).catch(() => {
    // 送失敗就算了，session 標記留著避免頻繁重試打爆 Worker
  });
}

/**
 * 對外：判斷是否要送、透過 requestIdleCallback 排程實際發送。
 * DesignLayout 每頁載入時呼叫一次；sessionStorage 保證同 session 只送一次。
 */
export function scheduleUepVisitorTrack(): void {
  if (typeof window === 'undefined') return;

  const apiUrl = import.meta.env.PUBLIC_VISITOR_API_URL;
  if (!apiUrl) return;

  try {
    if (sessionStorage.getItem(SESSION_KEY)) return;
  } catch {
    // sessionStorage 不可用（privacy mode 等）→ 直接放棄，避免無 dedup 亂送
    return;
  }

  // 先寫入 session 標記，避免 race condition 送兩次
  try {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
    return;
  }

  // 等 idle 再送，避免競爭首屏資源；連 requestIdleCallback 都缺就 setTimeout 兜底
  const send = () => sendTrack(apiUrl);
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(send, { timeout: 3000 });
  } else {
    setTimeout(send, 1500);
  }
}
