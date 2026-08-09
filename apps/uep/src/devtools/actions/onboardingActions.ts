/**
 * 入站儀式 DevTools actions（Issue #41 T-19）
 *
 * 依賴 `window.__uepOnboardingTest`（OnboardingGate 掛的 bridge，本來就非 dev-only）。
 * 用於模擬入站儀式的各種階段，測試 IdentCard / ObserverGate 等元件。
 */

import { LOBBY_ART_KEY } from '../../components/home/LobbyUep';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

const GROUP = GROUPS.ONBOARDING;

const hasBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepOnboardingTest;

function warn(): void {
  // eslint-disable-next-line no-console
  console.warn(
    '[DevTools] __uepOnboardingTest 尚未掛載（需 OnboardingGate 在頁面上）'
  );
}

export function registerOnboardingActions(): void {
  getRegistry().register([
    {
      group: GROUP,
      id: 'onboarding:show-choice',
      label: '強制顯示身分選擇儀式',
      description: '彈出 IdentCard 選擇（探索者 / 觀測者）',
      available: hasBridge,
      execute: () => {
        if (!window.__uepOnboardingTest) return warn();
        window.__uepOnboardingTest.showChoice();
      },
    },
    {
      group: GROUP,
      id: 'onboarding:show-observer-gate',
      label: '強制顯示觀測者協議',
      description: '直接開 ObserverGate 條款頁',
      available: hasBridge,
      execute: () => {
        if (!window.__uepOnboardingTest) return warn();
        window.__uepOnboardingTest.showObserverGate();
      },
    },
    {
      group: GROUP,
      id: 'onboarding:hide',
      label: '關閉目前入站視窗',
      available: hasBridge,
      execute: () => {
        if (!window.__uepOnboardingTest) return warn();
        window.__uepOnboardingTest.hide();
      },
    },
    {
      group: GROUP,
      id: 'onboarding:reset-identity',
      label: '重置本機身分（模擬全新訪客）',
      description: '登出並清空整個 UEP 命名空間，重新載入首頁',
      destructive: true,
      requiresConfirm: true,
      confirmMessage: '⚠ 這會登出並清除本機所有 UEP 狀態，然後導回首頁。確認？',
      available: hasBridge,
      execute: () => {
        if (!window.__uepOnboardingTest) return warn();
        void window.__uepOnboardingTest.resetLocalIdentity({ reload: true });
      },
    },
    {
      group: GROUP,
      id: 'onboarding:lobby-art-again',
      label: '讓大廳的 U.E.P 下次必定出現',
      description:
        '清掉「已見過」標記後導回首頁。第一次進站是必定出現的，之後才轉機率制（站台設定 home.lobbyArtChancePct），清掉標記等於回到第一次',
      // localStorage 存不進去時 shouldShowLobbyArt 整個停用，清標記也叫不出來，
      // 但那條路徑本身就不可用，這裡不另外守門
      execute: () => {
        try {
          localStorage.removeItem(LOBBY_ART_KEY);
        } catch {
          throw new Error('無法寫入 localStorage');
        }
        window.location.assign('/');
      },
    },
    {
      group: GROUP,
      id: 'onboarding:dump-status',
      label: '傾印入站狀態到 console',
      available: hasBridge,
      execute: () => {
        if (!window.__uepOnboardingTest) return warn();
        // eslint-disable-next-line no-console
        console.log(
          '[UEP Onboarding Status]',
          window.__uepOnboardingTest.status()
        );
      },
    },
  ]);
}
