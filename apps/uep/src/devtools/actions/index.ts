/**
 * DevTools actions 集中註冊點（Issue #41 T-17~T-20 + Animations）
 *
 * 每個模組 export 一個 `registerXxxActions()` 函式；
 * `registerAllActions()` 於面板首次掛載時一次呼叫全部。
 *
 * 幂等：重複呼叫會覆蓋舊 action（registry 內建警告），HMR 場景友善。
 */

import { registerProgressActions } from './progressActions';
import { registerIslandActions } from './islandActions';
import { registerOnboardingActions } from './onboardingActions';
import { registerAudioActions } from './audioActions';
import { registerAnimationActions } from './animationActions';

export function registerAllActions(): void {
  registerProgressActions();
  registerIslandActions();
  registerOnboardingActions();
  registerAudioActions();
  registerAnimationActions();
}
