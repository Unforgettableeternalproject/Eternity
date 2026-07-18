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

const GROUP = '內容保護';

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
  ]);
}
