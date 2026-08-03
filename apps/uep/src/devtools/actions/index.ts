/**
 * DevTools actions 集中註冊點（Issue #41 T-17~T-20）
 *
 * 每個模組 export 一個 `registerXxxActions()` 函式；
 * `registerAllActions()` 於面板首次掛載時一次呼叫全部。
 *
 * 幂等：重複呼叫會覆蓋舊 action（registry 內建警告），HMR 場景友善。
 *
 * ## 2026-08-03 精簡：`animationActions.ts` 整檔移除
 *
 * 那個檔的 17 個 action 沒有一個值得留：
 *
 * - **5 個是別處的逐字複製品**（view 儀式、身分選擇、觀測者協議、
 *   history 島解鎖、書籤儀式頁），本尊都在對應的功能群組裡。
 * - **5 個是死的**：四個 toast 把 bridge 名寫成 `__uepToast`（真實是
 *   `__uepToastManager`）、方法寫成 `push()`（真實是 `show/info/success/
 *   error`）、variant 寫成 `warn`（真實是 `warning`）；`reload-with-lobby`
 *   的 `?lobby=1` 全庫沒有任何消費端。全部用 optional chaining 靜默失敗，
 *   所以錯了很久都沒人發現。
 * - **6 個 zone 導覽**就是 `window.location.assign('/history')`，在網址列
 *   打路徑更快。
 * - `dialog-confirm` 把 `{title, message}` 當單一物件傳給
 *   `confirm(message: string, opts)`，訊息會顯示成 `[object Object]`。
 *
 * 📌 教訓：DevTools action 靜默 no-op 是預設行為（bridge 不在就跳過），
 * 這讓寫錯的 action 可以長期存活。新增 action 時若依賴 bridge，
 * **要嘛掛 `available()` 讓按鈕變灰，要嘛在 bridge 缺席時 `console.warn`**。
 */

// import 依字母序（lint 規則要求）；註冊呼叫順序另有考量，見下方
import { registerAudioActions } from './audioActions';
import { registerEchoesActions } from './echoesActions';
import { registerFlagActions } from './flagActions';
import { registerFogActions } from './fogActions';
import { registerIslandActions } from './islandActions';
import { registerOnboardingActions } from './onboardingActions';
import { registerProgressActions } from './progressActions';
import { registerProtectionActions } from './protectionActions';
import { registerRhythmActions } from './rhythmActions';

export function registerAllActions(): void {
  registerProgressActions();
  registerFogActions();
  registerIslandActions();
  registerOnboardingActions();
  registerAudioActions();
  registerEchoesActions();
  registerProtectionActions();
  registerFlagActions();
  registerRhythmActions();
}
