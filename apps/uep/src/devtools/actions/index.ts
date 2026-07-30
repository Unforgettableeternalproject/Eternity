/**
 * DevTools actions 集中註冊點（Issue #41 T-17~T-20 + Animations）
 *
 * 每個模組 export 一個 `registerXxxActions()` 函式；
 * `registerAllActions()` 於面板首次掛載時一次呼叫全部。
 *
 * 幂等：重複呼叫會覆蓋舊 action（registry 內建警告），HMR 場景友善。
 */

// import 依字母序（lint 規則要求）；註冊呼叫順序另有考量，見下方
import { registerAnimationActions } from './animationActions';
import { registerAudioActions } from './audioActions';
import { registerEchoesActions } from './echoesActions';
import { registerFlagActions } from './flagActions';
import { registerFogActions } from './fogActions';
import { registerIslandActions } from './islandActions';
import { registerOnboardingActions } from './onboardingActions';
import { registerProgressActions } from './progressActions';
import { registerProtectionActions } from './protectionActions';

export function registerAllActions(): void {
  registerProgressActions();
  registerFogActions();
  registerIslandActions();
  registerOnboardingActions();
  registerAudioActions();
  registerAnimationActions();
  registerEchoesActions();
  registerProtectionActions();
  registerFlagActions();
}
