/**
 * 浮島 DevTools actions（Issue #41 T-18）
 *
 * 依賴 `window.__uepIslandsTest`（IslandHost 掛的 test bridge）
 * 與 `window.__uepLostBookmarkTest`（history Reader 掛的 bridge）。
 *
 * 若當前頁面沒掛 IslandHost / 不在 history Reader，對應 action 會 no-op 並 warn。
 * available() 決定 UI disabled 狀態。
 */

import { getRegistry } from '../actionRegistry';

const GROUP_ISLANDS = '浮島';
const GROUP_BOOKMARK = '書籤（LostBookmark）';

const ISLAND_IDS = [
  'history',
  'concepts',
  'echoes',
  'visuals',
  'storage',
] as const;
type IslandId = (typeof ISLAND_IDS)[number];

const hasIslandBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepIslandsTest;
const hasLostBookmarkBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepLostBookmarkTest;

function warnMissing(name: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[DevTools] ${name} bridge 尚未掛載——請確認頁面已初始化對應模組`
  );
}

export function registerIslandActions(): void {
  const registry = getRegistry();

  // ── Island 通用 actions（依 ISLAND_IDS 動態展開） ──
  const islandActions = ISLAND_IDS.flatMap((id: IslandId) => [
    {
      group: GROUP_ISLANDS,
      id: `island:unlock:${id}`,
      label: `解鎖 ${id} 島`,
      description: '直接解鎖並保留（跳過解鎖儀式）',
      available: hasIslandBridge,
      execute: () => {
        if (!window.__uepIslandsTest) return warnMissing('__uepIslandsTest');
        window.__uepIslandsTest.unlock(id);
      },
    },
    {
      group: GROUP_ISLANDS,
      id: `island:relock:${id}`,
      label: `重新上鎖 ${id} 島`,
      description: '視窗自動卸載，可重驗解鎖儀式',
      available: hasIslandBridge,
      execute: () => {
        if (!window.__uepIslandsTest) return warnMissing('__uepIslandsTest');
        window.__uepIslandsTest.relock(id);
      },
    },
    // 2026-07-26 移除 `island:visit` / `island:unvisit`：
    // `zone:visited:*` 旗標已廢除（見 islands/unlockRitual.ts）。
  ]);

  registry.register([
    ...islandActions,
    {
      group: GROUP_ISLANDS,
      id: 'island:unlock-all',
      label: '解鎖全部島',
      description: '五座島一次全解鎖（保留足跡）',
      available: hasIslandBridge,
      execute: () => {
        if (!window.__uepIslandsTest) return warnMissing('__uepIslandsTest');
        for (const id of ISLAND_IDS) window.__uepIslandsTest.unlock(id);
      },
    },
    {
      group: GROUP_ISLANDS,
      id: 'island:relock-all',
      label: '重新上鎖全部島',
      requiresConfirm: true,
      confirmMessage: '確認重新上鎖全部島？（浮島視窗會消失）',
      available: hasIslandBridge,
      execute: () => {
        if (!window.__uepIslandsTest) return warnMissing('__uepIslandsTest');
        for (const id of ISLAND_IDS) window.__uepIslandsTest.relock(id);
      },
    },
    {
      group: GROUP_ISLANDS,
      id: 'island:dump-status',
      label: '傾印浮島狀態到 console',
      available: hasIslandBridge,
      execute: () => {
        if (!window.__uepIslandsTest) return warnMissing('__uepIslandsTest');
        const status = window.__uepIslandsTest.status();
        // eslint-disable-next-line no-console
        console.log('[UEP Islands Status]', status);
      },
    },

    // ── LostBookmark actions（history Reader 專用） ──
    {
      group: GROUP_BOOKMARK,
      id: 'lostbookmark:guarantee',
      label: '保底顯示書籤（chance = 100%）',
      description: '需在 /history Reader 頁面才有效',
      available: hasLostBookmarkBridge,
      execute: () => {
        if (!window.__uepLostBookmarkTest)
          return warnMissing('__uepLostBookmarkTest');
        window.__uepLostBookmarkTest.guarantee();
      },
    },
    {
      group: GROUP_BOOKMARK,
      id: 'lostbookmark:force',
      label: '強制顯示書籤',
      available: hasLostBookmarkBridge,
      execute: () => {
        if (!window.__uepLostBookmarkTest)
          return warnMissing('__uepLostBookmarkTest');
        window.__uepLostBookmarkTest.force();
      },
    },
    {
      group: GROUP_BOOKMARK,
      id: 'lostbookmark:reset',
      label: '重置書籤機率',
      available: hasLostBookmarkBridge,
      execute: () => {
        if (!window.__uepLostBookmarkTest)
          return warnMissing('__uepLostBookmarkTest');
        window.__uepLostBookmarkTest.reset();
      },
    },
    {
      group: GROUP_BOOKMARK,
      id: 'lostbookmark:open-gate',
      label: '直接開啟書籤儀式頁',
      description: '需 history Reader 內有消費者才生效',
      available: hasLostBookmarkBridge,
      execute: () => {
        if (!window.__uepLostBookmarkTest)
          return warnMissing('__uepLostBookmarkTest');
        window.__uepLostBookmarkTest.openGate();
      },
    },
    {
      group: GROUP_BOOKMARK,
      id: 'lostbookmark:dump-status',
      label: '傾印書籤狀態到 console',
      available: hasLostBookmarkBridge,
      execute: () => {
        if (!window.__uepLostBookmarkTest)
          return warnMissing('__uepLostBookmarkTest');
        // eslint-disable-next-line no-console
        console.log(
          '[UEP LostBookmark Status]',
          window.__uepLostBookmarkTest.status()
        );
      },
    },
  ]);
}
