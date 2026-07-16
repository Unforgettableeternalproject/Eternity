/**
 * 動畫 / 儀式觸發 DevTools actions（艾斯維爾 Issue #41 補充需求）
 *
 * 專門處理那些「一般難以直接測試」的入場動畫、轉場、UI 效果。
 * 大部分透過 CustomEvent 廣播；元件端訂閱事件觸發動畫。
 *
 * 依現有實作可用的動畫觸發點：
 * - UepToast / UepDialog：直接呼叫全域函式（若已掛）
 * - LostBookmark openGate：透過 event 廣播
 * - Onboarding：透過 __uepOnboardingTest bridge
 * - Zone Portal Transition：透過 URL 導覽觸發
 * - View Switch Ceremony：透過 progress bridge
 *
 * ⚠️ 部分動畫觸發點若元件端未掛（例如 Toast container 未在頁面），
 *    action 會 no-op；面板不會炸，但視覺上什麼都沒發生。
 */

import { getRegistry } from '../actionRegistry';

const GROUP_UI = '通用動畫';
const GROUP_ZONE = 'Zone 入場動畫';
const GROUP_CEREMONY = '儀式動畫';

/** 元件端接觸發訊號用的統一事件名前綴 */
const DEVTOOL_TRIGGER_PREFIX = 'uep:devtool:trigger:';

function dispatchTrigger(name: string, detail?: unknown): void {
  window.dispatchEvent(
    new CustomEvent(`${DEVTOOL_TRIGGER_PREFIX}${name}`, { detail })
  );
}

export function registerAnimationActions(): void {
  getRegistry().register([
    // ── 通用 UI 動畫 ──
    {
      group: GROUP_UI,
      id: 'anim:toast-info',
      label: 'Toast · 資訊訊息',
      description: '觸發 info 級 toast',
      execute: () => {
        interface ToastBridge {
          push?: (opts: {
            message: string;
            variant?: 'info' | 'success' | 'warn' | 'error';
          }) => void;
        }
        const toast = (window as unknown as { __uepToast?: ToastBridge })
          .__uepToast;
        if (toast?.push) {
          toast.push({
            message: '這是資訊 toast（DevTools 觸發）',
            variant: 'info',
          });
        } else {
          dispatchTrigger('toast', { variant: 'info', message: 'info toast' });
        }
      },
    },
    {
      group: GROUP_UI,
      id: 'anim:toast-success',
      label: 'Toast · 成功訊息',
      execute: () => {
        interface ToastBridge {
          push?: (opts: {
            message: string;
            variant?: 'info' | 'success' | 'warn' | 'error';
          }) => void;
        }
        const toast = (window as unknown as { __uepToast?: ToastBridge })
          .__uepToast;
        toast?.push?.({
          message: '成功 toast（DevTools 觸發）',
          variant: 'success',
        });
      },
    },
    {
      group: GROUP_UI,
      id: 'anim:toast-warn',
      label: 'Toast · 警告訊息',
      execute: () => {
        interface ToastBridge {
          push?: (opts: {
            message: string;
            variant?: 'info' | 'success' | 'warn' | 'error';
          }) => void;
        }
        const toast = (window as unknown as { __uepToast?: ToastBridge })
          .__uepToast;
        toast?.push?.({
          message: '警告 toast（DevTools 觸發）',
          variant: 'warn',
        });
      },
    },
    {
      group: GROUP_UI,
      id: 'anim:toast-error',
      label: 'Toast · 錯誤訊息',
      execute: () => {
        interface ToastBridge {
          push?: (opts: {
            message: string;
            variant?: 'info' | 'success' | 'warn' | 'error';
          }) => void;
        }
        const toast = (window as unknown as { __uepToast?: ToastBridge })
          .__uepToast;
        toast?.push?.({
          message: '錯誤 toast（DevTools 觸發）',
          variant: 'error',
        });
      },
    },
    {
      group: GROUP_UI,
      id: 'anim:dialog-confirm',
      label: 'Dialog · 確認對話',
      execute: () => {
        interface DialogBridge {
          confirm?: (opts: {
            title?: string;
            message: string;
          }) => Promise<boolean> | boolean;
        }
        const dialog = (
          window as unknown as { __uepDialogManager?: DialogBridge }
        ).__uepDialogManager;
        dialog?.confirm?.({
          title: '確認測試',
          message: '這是 DevTools 觸發的 confirm dialog',
        });
      },
    },

    // ── Zone 入場 / 轉場動畫 ──
    {
      group: GROUP_ZONE,
      id: 'zone:go-history',
      label: '導覽到 history（觸發 portal transition）',
      execute: () => {
        window.location.assign('/history');
      },
    },
    {
      group: GROUP_ZONE,
      id: 'zone:go-echoes',
      label: '導覽到 echoes（觸發回聲殘響）',
      execute: () => {
        window.location.assign('/echoes');
      },
    },
    {
      group: GROUP_ZONE,
      id: 'zone:go-visuals',
      label: '導覽到 visuals（觸發幻影閃現）',
      execute: () => {
        window.location.assign('/visuals');
      },
    },
    {
      group: GROUP_ZONE,
      id: 'zone:go-concepts',
      label: '導覽到 concepts（觸發 CRT 開機）',
      execute: () => {
        window.location.assign('/concepts');
      },
    },
    {
      group: GROUP_ZONE,
      id: 'zone:go-storage',
      label: '導覽到 storage（觸發掃描線）',
      execute: () => {
        window.location.assign('/storage');
      },
    },
    {
      group: GROUP_ZONE,
      id: 'zone:go-home',
      label: '導覽到首頁（大廳動畫）',
      description: '含 lobby lobbyBlock 遮罩 + WelcomeHost',
      execute: () => {
        window.location.assign('/');
      },
    },
    {
      group: GROUP_ZONE,
      id: 'anim:replay-welcome',
      label: '重播首頁 Welcome 動畫',
      description: '清 uep.welcome-seen 後重載首頁',
      execute: () => {
        try {
          sessionStorage.removeItem('uep.welcome-seen');
          localStorage.removeItem('uep.welcome-seen');
        } catch {
          /* 忽略 */
        }
        window.location.assign('/');
      },
    },

    // ── 儀式 / 系統動畫 ──
    {
      group: GROUP_CEREMONY,
      id: 'anim:trigger-view-ceremony',
      label: '觸發視角切換儀式（走完整動畫）',
      description: '不繞過 ceremony，實測 ViewSwitchCeremony 動畫',
      execute: () => {
        const current = window.__uepProgress?.getState().view;
        const next = current === 'observer' ? 'explorer' : 'observer';
        const bridge = window.__uepProgress as unknown as {
          requestViewSwitch?: (v: string) => void;
        };
        if (bridge?.requestViewSwitch) {
          bridge.requestViewSwitch(next);
        } else {
          window.__uepProgress?.setView(next);
        }
      },
    },
    {
      group: GROUP_CEREMONY,
      id: 'anim:onboarding-choice',
      label: '觸發身分選擇儀式',
      description: '走一次 IdentCard 選擇（不清狀態，僅顯示）',
      execute: () => {
        window.__uepOnboardingTest?.showChoice();
      },
    },
    {
      group: GROUP_CEREMONY,
      id: 'anim:observer-gate',
      label: '觸發觀測者協議動畫',
      execute: () => {
        window.__uepOnboardingTest?.showObserverGate();
      },
    },
    {
      group: GROUP_CEREMONY,
      id: 'anim:island-unlock-history',
      label: '觸發 history 島解鎖動畫',
      description: '呼叫 unlock 產生 IslandUnlockObject 上浮動畫',
      execute: () => {
        window.__uepIslandsTest?.unlock('history');
      },
    },
    {
      group: GROUP_CEREMONY,
      id: 'anim:lost-bookmark-gate',
      label: '觸發書籤儀式頁動畫',
      description: '需在 /history 內',
      execute: () => {
        window.__uepLostBookmarkTest?.openGate();
      },
    },
    {
      group: GROUP_CEREMONY,
      id: 'anim:reload-with-lobby',
      label: '重載首頁保留 lobby 遮罩',
      description: '模擬第一次到訪首頁的完整入場',
      execute: () => {
        window.location.assign('/?lobby=1');
      },
    },
  ]);
}
