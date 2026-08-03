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

import { getProgressManager } from '../../progress';
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

function warnMissing(name: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[DevTools] ${name} bridge 尚未掛載——請確認頁面已初始化對應模組`
  );
}

/**
 * 解鎖但不觸發浮島教學。
 *
 * DevTools 的解鎖走的是與真實解鎖完全相同的路徑（`unlockIsland` →
 * `mutate('island-unlocked')`），而 `IslandGuideAuto` 正是靠那個 source
 * 排程自動教學的——所以想驗浮島本身時，聚光燈會蓋上來擋路。
 *
 * 解法是解鎖後順手把該島記為 seen。**不新增「解鎖並演教學」的變體**：
 * 要看教學已經有現成的 `guide:play:{id}`（走回顧路徑，不受 seen 與
 * session 上限限制），多開一組 action 只是把同一件事拆成兩個入口。
 *
 * ⚠️ 順序不能反：先 seen 再 unlock 的話，`markIslandGuideSeen` 觸發的
 * progress 變更會讓 `IslandGuideAuto` 先跑一次 effect，那時島還沒解鎖、
 * seen 已經寫了，行為雖然仍正確但多繞一圈；先 unlock 則是同一批
 * mutate 之後 effect 只會看到最終狀態。
 */
function unlockWithoutGuide(id: IslandId): void {
  window.__uepIslandsTest?.unlock(id);
  getProgressManager().markIslandGuideSeen(id);
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
        '直接解鎖並保留（跳過解鎖儀式）。順手記為「教學已看過」，不會被聚光燈蓋住；要看教學請用「播放 X 島的教學」',
      available: hasIslandBridge,
      execute: () => {
        if (!window.__uepIslandsTest) return warnMissing('__uepIslandsTest');
        unlockWithoutGuide(id);
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
        for (const id of ISLAND_IDS) unlockWithoutGuide(id);
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
