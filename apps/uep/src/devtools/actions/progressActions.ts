/**
 * 進度系統 DevTools actions（Issue #41 T-17）
 *
 * 呼叫的是 `window.__uepProgress` bridge（progressStore.ts 掛的 singleton，
 * 兩者都非 dev-only）。若不存在通常代表 progressStore 尚未初始化，
 * 通常 hydrate 完就會有。
 */

import { wipeLocalIdentity } from '../../lib/wipeLocalIdentity';
import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

const GROUP = GROUPS.PROGRESS;

/** 詢問使用者輸入 flag 名稱（逗號分隔可多個） */
function promptFlags(prompt: string): string[] | null {
  const raw = window.prompt(prompt, '');
  if (raw === null) return null;
  const flags = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return flags.length ? flags : null;
}

export function registerProgressActions(): void {
  const registry = getRegistry();
  registry.register([
    {
      group: GROUP,
      id: 'progress:reset',
      label: '重置使用者 Progress',
      description: '清除 progress state（保留 onboarding 紀錄），重載頁面',
      destructive: true,
      requiresConfirm: true,
      confirmMessage: '確認清除全部進度並重載頁面？',
      execute: () => {
        window.__uepProgress?.reset();
        window.location.reload();
      },
    },
    {
      group: GROUP,
      id: 'progress:full-wipe',
      label: '完全重置（含 onboarding + 登入）',
      description:
        '登出並清空整個 UEP 命名空間（保留主題／DevTools 旗標）後重載',
      destructive: true,
      requiresConfirm: true,
      confirmMessage:
        '⚠ 這會登出並完全清空所有本機狀態（包含 onboarding 決定），重載後就像全新訪客。確認？',
      execute: () => {
        // 2026-07-26：原本手抄三把 key，既漏了 session（重載後舊帳號
        // 進度會被 hydrate 回來，等於沒重置），也漏了 pinned/terminal/
        // phantom/浮島視窗。改走統一入口，見 lib/wipeLocalIdentity.ts。
        void wipeLocalIdentity().then(() => {
          window.location.reload();
        });
      },
    },
    {
      group: GROUP,
      id: 'progress:set-observer',
      label: '切換視角 → 觀測者（Observer）',
      execute: () => {
        window.__uepProgress?.setView('observer');
      },
    },
    {
      group: GROUP,
      id: 'progress:set-explorer',
      label: '切換視角 → 探索者（Explorer）',
      execute: () => {
        window.__uepProgress?.setView('explorer');
      },
    },
    {
      group: GROUP,
      id: 'progress:grant-flags',
      label: '授予自訂旗標',
      description: '彈出輸入框，逗號分隔多個 flag',
      execute: () => {
        const flags = promptFlags(
          '輸入要授予的 flag（逗號分隔多個），例：pure-observer, ended-s8-b'
        );
        if (!flags) return;
        window.__uepProgress?.grantFlags(flags);
      },
    },
    {
      group: GROUP,
      id: 'progress:revoke-flags',
      label: '撤銷自訂旗標',
      description: '彈出輸入框，逗號分隔多個 flag',
      execute: () => {
        const flags = promptFlags('輸入要撤銷的 flag（逗號分隔多個）');
        if (!flags) return;
        window.__uepProgress?.revokeFlags(flags);
      },
    },
    {
      group: GROUP,
      id: 'progress:mark-completed',
      label: '標記頁面完成（輸入 pageId）',
      description: '例：history/chapter-1-arc-1-section-2',
      execute: () => {
        const raw = window.prompt(
          '輸入 pageId（格式：area/slug 或層級路徑）',
          ''
        );
        if (!raw) return;
        window.__uepProgress?.markPageCompleted(raw.trim());
      },
    },
    {
      group: GROUP,
      id: 'progress:dump-state',
      label: '傾印 progress state 到 console',
      description: '在 devtools console 印出 getState() 快照 + copy 到剪貼簿',
      execute: async () => {
        const state = window.__uepProgress?.getState();
        // eslint-disable-next-line no-console
        console.log('[UEP Progress State]', state);
        try {
          await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
        } catch {
          /* 剪貼簿權限沒了就算了，console 看得到就夠 */
        }
      },
    },
    // 2026-08-03 移除 `progress:trigger-view-ceremony`（與 animationActions
    // 的 `anim:trigger-view-ceremony` 是同一份程式碼的兩個入口）。
    //
    // 它宣稱「走完整儀式流程，不繞過」，但依賴的 `requestViewSwitch` 全庫
    // 不存在，所以一律 fallback 到 `setView()`——正好就是繞過儀式，與說明
    // 相反。而 `setView` 已經在上面有兩個明確的 action（且它自己會寫
    // `observerEver`，不會留下不一致狀態）。
    //
    // 儀式狀態是 `ViewSwitch` 元件的 local state，沒有外部觸發點。要讓
    // DevTools 真的演一次得為它新增第四套 bridge——而正規入口就是識別證裡
    // 那顆使用者隨時按得到的按鈕。DevTools 的價值是跳過不合理的門檻
    // （AFK 要等三分鐘、教學一個帳號只演一次），切視角沒有門檻。
  ]);
}
