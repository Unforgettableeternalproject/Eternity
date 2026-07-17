/**
 * 進度系統 DevTools actions（Issue #41 T-17）
 *
 * 呼叫的是 `window.__uepProgress` bridge（progressStore.ts 掛的 singleton，
 * 兩者都非 dev-only）。若不存在通常代表 progressStore 尚未初始化，
 * 通常 hydrate 完就會有。
 */

import { PROGRESS_STORAGE_KEY } from '../../progress/adapters';
import { getRegistry } from '../actionRegistry';

const GROUP = '進度系統';

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
      label: '完全重置（含 onboarding + audio）',
      description:
        '清當前環境 progress key / uep.onboarded.v1 / uep.audio.v1 後重載',
      destructive: true,
      requiresConfirm: true,
      confirmMessage:
        '⚠ 這會完全清空所有本機狀態（包含 onboarding 決定），重載後就像全新訪客。確認？',
      execute: () => {
        try {
          // progress key 依環境 namespace（正式／測試），只清當前環境
          localStorage.removeItem(PROGRESS_STORAGE_KEY);
          localStorage.removeItem('uep.onboarded.v1');
          localStorage.removeItem('uep.audio.v1');
        } catch {
          /* 靜默 */
        }
        window.location.reload();
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
    {
      group: GROUP,
      id: 'progress:trigger-view-ceremony',
      label: '觸發視角切換儀式（Explorer ↔ Observer）',
      description: '走完整儀式流程，不繞過（測試 ViewSwitchCeremony 動畫）',
      execute: () => {
        const current = window.__uepProgress?.getState().view;
        const next = current === 'observer' ? 'explorer' : 'observer';
        // 使用 requestViewSwitch 走儀式；若無此方法則 fallback setView
        const bridge = window.__uepProgress;
        if (bridge && 'requestViewSwitch' in bridge) {
          (
            bridge as unknown as { requestViewSwitch(v: string): void }
          ).requestViewSwitch(next);
        } else {
          bridge?.setView(next);
        }
      },
    },
  ]);
}
