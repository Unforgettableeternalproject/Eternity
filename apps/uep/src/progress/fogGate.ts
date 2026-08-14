/**
 * UEP 進度系統 — 迷霧閘門的純函式（S10-2 rush prevention）
 *
 * 迷霧擋的是「跳到文章底部 speedrun 解鎖」，不是「讀得快」。所有判定
 * 都收斂到一個連續量 `fogRatio`（0~1，見 progress/types.ts）：
 *
 * - 迷霧線**就是掃描線本身**的連續量化版，用同一個 80% 位置換算，
 *   兩者永遠重合，不存在誰落後誰的漂移問題
 * - 位置一律存 ratio 而非 px：圖片非同步載入撐高版面、admin 改動內容
 *   長度，同一個 ratio 換算出的絕對位置會自我修正，不需要遷移歷史資料
 *
 * 此檔案不碰 store 也不碰 DOM——只做數字進、數字出，方便單獨驗證。
 */

/**
 * 迷霧跳躍門檻：單次取樣最多能推進幾個視窗高度。
 *
 * 用 vh 而非固定 px 或固定 ratio，因為「一次連續捲動大約能推進多少個
 * 螢幕」才是跟裝置與文章長度都無關的體感常數：
 * - 固定 ratio：同樣 5% 在短文是半屏、在長文超過一整屏，嚴格度隨文章長度漂移
 * - 固定 px：同樣 800px 在手機是三屏、在桌面不到一屏，嚴格度隨裝置漂移
 *
 * ⚠️ 1.5 是待實測校準的起點值，不是最終值。要拿滑鼠滾輪／觸控板慣性／
 * 觸控螢幕甩動的實際單幀位移分佈來調，讓它寬容到不誤傷快速閱讀、
 * 嚴格到擋得住捲軸拖曳與 End 鍵。
 */
export const FOG_JUMP_THRESHOLD_VH = 1.5;

/** 掃描線在視窗高度的哪個位置（對齊 scanline.ts 的 rootMargin -20%） */
export const SCANLINE_VIEWPORT_RATIO = 0.8;

/**
 * 迷霧線的最大推進速率（每秒幾個視窗高）。
 *
 * ⚠️ 只有跳躍門檻是**擋不住 speedrun** 的：取樣跑在 rAF 上，快速捲動是
 * 「連續多幀各走一小步」，每一步都不超過跳躍門檻，於是每一步都合法，
 * 累積起來照樣三秒捲完整篇。跳躍門檻管的是「單次瞬移」，速率上限管的
 * 才是「讀得多快」——兩者缺一不可。
 *
 * 速率上限不會讓迷霧自己前進：推進仍以讀者的捲動位置為準，這裡只截斷
 * 「這一瞬間最多能推到哪」。停著不動 → 位置沒變 → 不推進；慢慢讀 →
 * 位置變化本來就低於上限 → 完全跟上；快速捲 → 被截斷，霧留在後面，
 * 讀者前方持續是霧。
 *
 * 0.55 ≈ 每屏近兩秒，對略讀者仍寬鬆，但擋得住整篇一拉到底。
 * 與跳躍門檻同屬待實測校準的體感參數。
 */
export const FOG_MAX_ADVANCE_VH_PER_SEC = 0.55;

/**
 * 單次取樣的時間差上限（ms）。
 *
 * 離開分頁十分鐘再回來，elapsed 會大到讓速率上限形同虛設（等於累積了
 * 十分鐘的推進額度）。速率限制的語意是「閱讀速度」，不是「掛機時數」。
 */
const MAX_SAMPLE_ELAPSED_MS = 1200;

/** 短文判定的浮點容忍值（px） */
const SCROLL_EPSILON_PX = 1;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * 捲動位置 → 內容 ratio。
 *
 * 加上 `viewportHeight * 0.8` 是為了對齊掃描線的 80% 線——迷霧線量的是
 * 「掃描線掃到哪」，不是「捲動條拉到哪」。
 *
 * ⚠️ 捲到底必須直接回 1，不能套公式。掃描線停在視窗 80% 處，捲到極限時
 * 公式只會給出 `1 - 0.2 * viewport / scrollHeight`，**永遠差最後一段**：
 * 文末那 20% 視窗高的內容會永遠蓋著霧，而哨兵的「fogRatio >= 1」合取
 * 因此永遠不成立——文章再怎麼讀都無法完成。捲到底本來就等於讀完了。
 */
export function computeContentRatio(
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number
): number {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 0;
  const maxScrollTop = scrollHeight - viewportHeight;
  if (maxScrollTop <= SCROLL_EPSILON_PX) return 1;
  if (scrollTop >= maxScrollTop - SCROLL_EPSILON_PX) return 1;
  return clamp01(
    (scrollTop + viewportHeight * SCANLINE_VIEWPORT_RATIO) / scrollHeight
  );
}

/**
 * 內容短到不需要捲動 → 完全不套用迷霧。
 *
 * ⚠️ 這不只是「沒必要」，是**必要的死鎖防護**：短文套 `computeContentRatio`
 * 會得到 ≈0.8（scrollTop 恆為 0、viewport 與 scrollHeight 幾乎相等），
 * 若初始 fogRatio 是 0，這個落差會被 `isWithinFogReach` 判成非法跳躍，
 * 而讀者**沒有捲動空間可以重新靠近迷霧線**——永久卡住，無法解除。
 */
export function isNonScrollable(
  scrollHeight: number,
  clientHeight: number
): boolean {
  return scrollHeight <= clientHeight + SCROLL_EPSILON_PX;
}

/**
 * 跳躍判定：某個位置是否在既有迷霧線的可及範圍內。
 *
 * ⚠️ 比較基準是**目前已站穩的迷霧線**，不是「上一次取樣位置」。
 * 這個選擇是整套機制的關鍵：
 *
 * 1. 「rush 之後回頭重新讀」不需要額外分支——不管讀者曾經跳到多遠，
 *    只要退回迷霧線附近，下一次取樣自然又滿足這個條件
 * 2. 若改比 delta（這次取樣 vs 上次取樣），讀者 rush 到某處之後，
 *    接下來只要不再做大幅跳躍，迷霧線就會被小幅捲動**悄悄拖著追上他**，
 *    防護完全失效。這是最容易誤植的反例
 */
export function isWithinFogReach(
  candidateRatio: number,
  storedFogRatio: number,
  viewportHeight: number,
  scrollHeight: number
): boolean {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return true;
  // 往回捲自由：只有向下跳才擋
  if (candidateRatio <= storedFogRatio) return true;
  const thresholdRatio =
    (FOG_JUMP_THRESHOLD_VH * viewportHeight) / scrollHeight;
  return candidateRatio - storedFogRatio <= thresholdRatio;
}

/**
 * 速率上限：這一次取樣最多能把迷霧線推到哪。
 *
 * 回傳 `null` 代表這次取樣不推進（位置沒有前進，或距上次取樣沒有時間
 * 經過）。呼叫端拿到數值後直接交給 `advanceFog`——單調與量化級距由
 * store 那邊統一處理。
 */
export function limitFogAdvance(
  candidateRatio: number,
  storedFogRatio: number,
  elapsedMs: number,
  viewportHeight: number,
  scrollHeight: number
): number | null {
  if (candidateRatio <= storedFogRatio) return null;
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return null;
  const elapsed = Math.min(Math.max(elapsedMs, 0), MAX_SAMPLE_ELAPSED_MS);
  if (elapsed <= 0) return null;
  const maxStep =
    (FOG_MAX_ADVANCE_VH_PER_SEC * (elapsed / 1000) * viewportHeight) /
    scrollHeight;
  return Math.min(candidateRatio, storedFogRatio + maxStep);
}

/**
 * `computeContentRatio` 的反函式：ratio → 續讀目標捲動位置。
 *
 * 回傳值已 clamp 進合法捲動範圍——ratio 接近 0 時反推會是負數，
 * 直接交給 `scrollTo` 雖然不會壞，但不同瀏覽器對超界值的處理不保證一致。
 */
export function ratioToScrollTop(
  ratio: number,
  viewportHeight: number,
  scrollHeight: number
): number {
  const target =
    ratio * scrollHeight - viewportHeight * SCANLINE_VIEWPORT_RATIO;
  return Math.min(
    Math.max(0, target),
    Math.max(0, scrollHeight - viewportHeight)
  );
}

/**
 * 元素在捲動容器內的位置 → ratio。
 *
 * 只在標記真的觸發 IO callback 時算一次（頻率等同標記通過次數，
 * 不是每幀），`getBoundingClientRect` 的成本在這個量級可忽略。
 */
export function computeElementRatio(
  el: Element,
  scrollEl: HTMLElement | null
): number {
  if (!scrollEl) {
    // 沒有捲動容器（root = viewport）時退回文件座標系
    const top = el.getBoundingClientRect().top + window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    if (scrollHeight <= 0) return 0;
    return clamp01(top / scrollHeight);
  }
  const top =
    el.getBoundingClientRect().top -
    scrollEl.getBoundingClientRect().top +
    scrollEl.scrollTop;
  if (scrollEl.scrollHeight <= 0) return 0;
  return clamp01(top / scrollEl.scrollHeight);
}
