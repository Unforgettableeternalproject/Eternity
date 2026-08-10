/**
 * 浮島 DevTools actions（Issue #41 T-18）
 *
 * 依賴 `window.__uepIslandsTest`（IslandHost 掛的 test bridge）
 * 與 `window.__uepLostBookmarkTest`（history Reader 掛的 bridge）。
 *
 * 若當前頁面沒掛 IslandHost / 不在 history Reader，對應 action 會 no-op 並 warn。
 * available() 決定 UI disabled 狀態。
 *
 * 書籤（LostBookmark）2026-08-03 起併入同一個面板群組：遺落書籤儀式就是
 * history 島的取得途徑，兩者是同一條驗收動線，分成兩組只是因為 bridge 不同。
 */

import { getRegistry } from '../actionRegistry';
import { GROUPS } from '../groups';

const GROUP_ISLANDS = GROUPS.ISLANDS;
/** 與 `GROUP_ISLANDS` 同一組，保留名稱只為讓下面的書籤區塊讀起來仍分明 */
const GROUP_BOOKMARK = GROUPS.ISLANDS;

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
const hasStorageNoticeBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.__uepStorageNoticeTest;

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
      description:
        '直接解鎖並保留（跳過解鎖儀式，因此不會演教學；要看教學請用「播放 X 島的教學」）',
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
      description: '五座島一次全解鎖（保留足跡），同樣不會演教學',
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

    // ── Storage 對話解鎖通知（Fence 探頭） ──
    // 真實觸發條件是「gate 剛剛從擋住變成通過」，拿到旗標後就再也復現不了
    // 那一瞬間——這幾個入口讓卡片本身可以反覆驗。
    {
      group: GROUP_ISLANDS,
      id: 'storage-notice:force',
      label: '推一則 Storage 解鎖通知',
      description:
        '優先挑目前被 gate 擋住的對話；島收合中會留 pending 並亮 chip',
      available: hasStorageNoticeBridge,
      execute: () => {
        if (!window.__uepStorageNoticeTest)
          return warnMissing('__uepStorageNoticeTest');
        window.__uepStorageNoticeTest.force();
      },
    },
    {
      group: GROUP_ISLANDS,
      id: 'storage-notice:clear',
      label: '清除 Storage 解鎖通知',
      description: '收掉顯示中與 pending 的通知（等同換頁）',
      available: hasStorageNoticeBridge,
      execute: () => {
        if (!window.__uepStorageNoticeTest)
          return warnMissing('__uepStorageNoticeTest');
        window.__uepStorageNoticeTest.clear();
      },
    },
    {
      group: GROUP_ISLANDS,
      id: 'storage-notice:dump-status',
      label: '傾印 Storage 通知狀態到 console',
      description: '通知沒出現時看這個：索引筆數、目前被擋／通過的 slug',
      available: hasStorageNoticeBridge,
      execute: () => {
        if (!window.__uepStorageNoticeTest)
          return warnMissing('__uepStorageNoticeTest');
        // eslint-disable-next-line no-console
        console.log(
          '[UEP Storage Notice Status]',
          window.__uepStorageNoticeTest.status()
        );
      },
    },
  ]);
}
