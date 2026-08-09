/**
 * 內容保護 DevTools actions
 *
 * 測試模式（staging build-bound / test cookie）與本地 dev 下，
 * 內容保護預設關閉；此處提供面板內的切換開關，寫入
 * localStorage['uep-protection-force'] 後重載頁面生效。
 * 正式環境保護永遠開啟，這些 action 不影響正式站行為。
 */

import {
  FORCE_PROTECTION_KEY,
  isProtectionForced,
} from '../../scripts/content-protection';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

/**
 * 與 `rhythmActions` 的 AFK／休息共用一組：三者都是 Reader 頁的行為層開關，
 * 而且會互相影響——內容保護與 activityWatch 對同一組 visibility／blur 事件
 * 反應（見 `lib/activityWatch.ts` 的分工說明），驗收時本來就要一起看。
 */
const GROUP = GROUPS.READER;

export function registerProtectionActions(): void {
  getRegistry().register([
    {
      group: GROUP,
      id: 'protection:toggle',
      label: '切換內容保護（重新載入生效）',
      description:
        '測試模式 / 本地 dev 預設關閉；開啟後可在 Reader 頁驗證正式站的保護行為',
      execute: () => {
        try {
          if (isProtectionForced()) {
            localStorage.removeItem(FORCE_PROTECTION_KEY);
          } else {
            localStorage.setItem(FORCE_PROTECTION_KEY, 'true');
          }
        } catch {
          throw new Error('無法寫入 localStorage');
        }
        window.location.reload();
      },
    },
    {
      group: GROUP,
      id: 'protection:status',
      label: '顯示保護狀態（console）',
      description: '呼叫 __uepProtection.status() 輸出目前判定',
      available: () =>
        typeof window !== 'undefined' &&
        Boolean(
          (window as unknown as { __uepProtection?: unknown }).__uepProtection
        ),
      execute: () => {
        const toolkit = (
          window as unknown as {
            __uepProtection?: { status?: () => unknown };
          }
        ).__uepProtection;
        toolkit?.status?.();
      },
    },
    /*
     * 兩種面孔各給一個入口。正式的擲骰只有一成會抽到立繪，靠切視窗碰運氣
     * 驗收要試十幾次；而這兩個 action 要驗的是版面與濾鏡，不是機率。
     * 走 `__uepProtection.test()` 與真實顯示同一條路徑，只是跳過擲骰。
     */
    ...(
      [
        ['text', '文字版（觀測失效）', '中央是字樣與色差複影'],
        [
          'art',
          '立繪版（U.E.P 比出不行）',
          '中央換成灰階＋雜訊處理的立繪，字樣讓位；只有角落浮水印兩種都在',
        ],
      ] as const
    ).map(([variant, label, description]) => ({
      group: GROUP,
      id: `protection:overlay-${variant}`,
      label: `閃現保護遮罩：${label}`,
      description: `${description}。1.5 秒後照正常流程演「重新接上訊號」的退場`,
      available: () =>
        typeof window !== 'undefined' &&
        Boolean(
          (window as unknown as { __uepProtection?: unknown }).__uepProtection
        ),
      execute: () => {
        const toolkit = (
          window as unknown as {
            __uepProtection?: { test?: (variant?: string) => void };
          }
        ).__uepProtection;
        toolkit?.test?.(variant);
      },
    })),
  ]);
}
