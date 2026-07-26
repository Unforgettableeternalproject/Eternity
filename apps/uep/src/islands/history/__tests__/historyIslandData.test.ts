/**
 * History Island 資料層測試
 *
 * gating 語意本身由 progress/gating 測試覆蓋，這裡驗證島端推導：
 * 最後閱讀頁、當前卷、章節列表、統計與導航。
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createInitialState } from '../../../progress';
import type { ProgressState } from '../../../progress';
import {
  averageReadingMinutes,
  buildChapterEntries,
  buildTreeIndex,
  buildUnlockedChapterList,
  collectTocCounts,
  deriveLastRead,
  diffTocCounts,
  displayProgressPct,
  navigateToHistoryPage,
  parentOf,
  progressRatio,
  tocCount,
  volumeOf,
} from '../historyIslandData';
import type { HistoryTreeNode } from '../historyIslandData';

function node(
  id: string,
  pageType: string,
  metadata: Record<string, unknown> = {},
  children: HistoryTreeNode[] = []
): HistoryTreeNode {
  return {
    id,
    title: id,
    slug: id.split('/').pop() || id,
    sortOrder: 0,
    pageType,
    depth: id.split('/').length - 1,
    status: 'published',
    metadata,
    children,
  };
}

/** 測試樹：一卷（U）底下兩章 + 一個隱藏章 + 一個靜態鎖章 */
function buildFixtureTree(): HistoryTreeNode[] {
  return [
    node('history/u', 'chapter', {}, [
      node('history/u/1', 'arc', { progressPage: true }, [
        node('history/u/1/1-1', 'section', {}),
        node('history/u/1/1-2', 'section', {}),
      ]),
      node('history/u/2', 'arc', { progressPage: true }, [
        node('history/u/2/2-1', 'section', {}),
      ]),
      node('history/u/hidden', 'arc', { hidden: true }),
      node('history/u/sealed', 'arc', { locked: true }),
    ]),
  ];
}

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

/**
 * 四層測試樹（S6-2，對齊真實 D1 結構）：
 * zone(U) → chapter ×3（一般/靜態鎖/隱藏）→ arc → section
 */
function buildZoneTree(): HistoryTreeNode[] {
  return [
    node('history/u', 'zone', {}, [
      node('history/u/c1', 'chapter', {}, [
        node('history/u/c1/a1', 'arc', { progressPage: true }, [
          node('history/u/c1/a1/s1', 'section', {}),
          node('history/u/c1/a1/s2', 'section', {}),
        ]),
        node('history/u/c1/a2', 'arc', { progressPage: true }, [
          node('history/u/c1/a2/s1', 'section', {}),
        ]),
      ]),
      node('history/u/c2', 'chapter', { locked: true }),
      node('history/u/chidden', 'chapter', { hidden: true }),
    ]),
  ];
}

/**
 * 五層測試樹（S6-3，對齊真實 D1 結構）：
 * passage(page) → zone ×2 → chapter → arc → section。
 * root 是 page 不是 zone/chapter——目錄必須遞迴往下鑽才撈得到 chapter。
 * homepage root 平行存在（landing 拼裝用，目錄不該誤收）。
 */
function buildPassageTree(): HistoryTreeNode[] {
  return [
    node('history/homepage', 'homepage', {}),
    node('history/passage', 'page', {}, [
      node('history/passage/u', 'zone', {}, [
        node('history/passage/u/c1', 'chapter', {}, [
          node('history/passage/u/c1/a1', 'arc', { progressPage: true }, [
            node('history/passage/u/c1/a1/s1', 'section', {}),
            node('history/passage/u/c1/a1/s2', 'section', {}),
          ]),
        ]),
        node('history/passage/u/c2', 'chapter', { locked: true }),
      ]),
      node('history/passage/e', 'zone', {}, [
        node('history/passage/e/c1', 'chapter', {}, [
          node('history/passage/e/c1/a1', 'arc', { progressPage: true }, [
            node('history/passage/e/c1/a1/s1', 'section', {}),
          ]),
        ]),
      ]),
    ]),
  ];
}

describe('buildTreeIndex', () => {
  it('建立索引並過濾隱藏 root', () => {
    const index = buildTreeIndex([
      ...buildFixtureTree(),
      node('history/ghost', 'chapter', { hidden: true }),
    ]);
    expect(index.roots).toHaveLength(1);
    expect(index.nodesById.has('history/u/1/1-1')).toBe(true);
    expect(index.nodesById.has('history/ghost')).toBe(false);
    expect(
      index.ancestorsById.get('history/u/1/1-1')?.map((a) => a.id)
    ).toEqual(['history/u', 'history/u/1']);
  });
});

describe('deriveLastRead', () => {
  it('取 updatedAt 最新且存在於 tree 的頁面', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const progress = stateWith({
      pageMarkers: {
        'history/u/1/1-1': {
          maxMarkerIdx: 2,
          lastMarkerIdx: 1,
          totalMarkers: 3,
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
        'history/u/1/1-2': {
          maxMarkerIdx: 1,
          lastMarkerIdx: 1,
          totalMarkers: 3,
          updatedAt: '2026-07-05T00:00:00.000Z',
        },
        'history/deleted-page': {
          maxMarkerIdx: 9,
          lastMarkerIdx: 9,
          totalMarkers: 9,
          updatedAt: '2026-07-06T00:00:00.000Z', // 最新但不在 tree
        },
      },
    });
    expect(deriveLastRead(progress, index)?.id).toBe('history/u/1/1-2');
  });

  it('無任何足跡時回傳 null', () => {
    const index = buildTreeIndex(buildFixtureTree());
    expect(deriveLastRead(createInitialState(), index)).toBeNull();
  });

  it('lastVisitedPageId 優先於 pageMarkers（換頁當下即更新續讀）', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const progress = stateWith({
      lastVisitedPageId: 'history/u/1',
      lastVisitedAt: '2026-07-06T00:00:00.000Z',
      pageMarkers: {
        'history/u/1/1-2': {
          maxMarkerIdx: 1,
          lastMarkerIdx: 1,
          totalMarkers: 3,
          updatedAt: '2026-07-06T12:00:00.000Z', // 比 lastVisited 新也不採用
        },
      },
    });
    expect(deriveLastRead(progress, index)?.id).toBe('history/u/1');
  });

  it('lastVisited 頁面已鎖定時 fallback 到 pageMarkers', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const progress = stateWith({
      lastVisitedPageId: 'history/u/sealed', // 靜態鎖定
      lastVisitedAt: '2026-07-06T00:00:00.000Z',
      pageMarkers: {
        'history/u/1/1-2': {
          maxMarkerIdx: 1,
          lastMarkerIdx: 1,
          totalMarkers: 3,
          updatedAt: '2026-07-05T00:00:00.000Z',
        },
      },
    });
    expect(deriveLastRead(progress, index)?.id).toBe('history/u/1/1-2');
  });

  it('lastVisited 頁面不在 tree 時 fallback 到 pageMarkers', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const progress = stateWith({
      lastVisitedPageId: 'history/deleted-page',
      lastVisitedAt: '2026-07-06T00:00:00.000Z',
      pageMarkers: {
        'history/u/1/1-2': {
          maxMarkerIdx: 1,
          lastMarkerIdx: 1,
          totalMarkers: 3,
          updatedAt: '2026-07-05T00:00:00.000Z',
        },
      },
    });
    expect(deriveLastRead(progress, index)?.id).toBe('history/u/1/1-2');
  });
});

describe('volumeOf', () => {
  it('回傳最上層祖先；root 自身回傳自己', () => {
    const index = buildTreeIndex(buildFixtureTree());
    expect(volumeOf('history/u/1/1-1', index)?.id).toBe('history/u');
    expect(volumeOf('history/u', index)?.id).toBe('history/u');
    expect(volumeOf('history/nope', index)).toBeNull();
  });
});

describe('parentOf（S6-2 續讀 kicker 層級）', () => {
  it('Section→arc、Arc→chapter、Chapter/Zone→null，判層用 pageType', () => {
    const index = buildTreeIndex(buildZoneTree());
    expect(parentOf('history/u/c1/a1/s1', index)?.id).toBe('history/u/c1/a1');
    expect(parentOf('history/u/c1/a1', index)?.id).toBe('history/u/c1');
    expect(parentOf('history/u/c1', index)).toBeNull();
    expect(parentOf('history/u', index)).toBeNull();
    expect(parentOf('history/nope', index)).toBeNull();
  });
});

describe('buildUnlockedChapterList（S6-2 兩層目錄）', () => {
  it('只列已解鎖 chapters：靜態鎖與隱藏排除，arcs 沿用 Reader 語意', () => {
    const index = buildTreeIndex(buildZoneTree());
    const items = buildUnlockedChapterList(index, createInitialState(), null);

    const ids = items.map((i) => i.node.id);
    expect(ids).toEqual(['history/u/c1']); // c2 鎖定、chidden 隱藏
    // a2 被進度鏈隱藏（a1 未完成），arcs 只剩 a1
    expect(items[0].arcs.map((a) => a.node.id)).toEqual(['history/u/c1/a1']);
    // 進度彙總：三個 section 進度葉，全未完成
    expect(items[0].total).toBe(3);
    expect(items[0].completed).toBe(0);
  });

  it('isCurrent 標在 lastRead 祖先鏈上（chapter 與 arc 都標）', () => {
    const index = buildTreeIndex(buildZoneTree());
    const items = buildUnlockedChapterList(
      index,
      createInitialState(),
      'history/u/c1/a1/s2'
    );
    const c1 = items.find((i) => i.node.id === 'history/u/c1')!;
    expect(c1.isCurrent).toBe(true);
    expect(
      c1.arcs.find((a) => a.node.id === 'history/u/c1/a1')?.isCurrent
    ).toBe(true);
  });

  it('roots 直接是 chapter 時也能列（防禦性容錯）', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const items = buildUnlockedChapterList(index, createInitialState(), null);
    expect(items.map((i) => i.node.id)).toEqual(['history/u']);
  });

  it('五層真實樹（root=passage page）：遞迴往下鑽撈到全部 chapter（S6-3 根因）', () => {
    const index = buildTreeIndex(buildPassageTree());
    const items = buildUnlockedChapterList(index, createInitialState(), null);

    // root 是 page 不是 zone/chapter——舊實作只查 root 一層會回空陣列
    const ids = items.map((i) => i.node.id);
    expect(ids).toEqual(['history/passage/u/c1', 'history/passage/e/c1']);
    // homepage root 不含 chapter，不會誤收
    expect(ids.some((id) => id.startsWith('history/homepage'))).toBe(false);
    // 靜態鎖章排除
    expect(ids).not.toContain('history/passage/u/c2');
    // 進度彙總與 arcs 語意不受樹深影響
    expect(items[0].total).toBe(2);
    expect(items[0].arcs.map((a) => a.node.id)).toEqual([
      'history/passage/u/c1/a1',
    ]);
  });
});

describe('displayProgressPct（S6-3 1% 下限）', () => {
  it('total 為 0 回傳 null（UI 不畫進度條）', () => {
    expect(displayProgressPct(0, 0)).toBeNull();
  });

  it('completed 為 0 但 total > 0 顯示 1% 而非 0%', () => {
    expect(displayProgressPct(0, 3)).toBe(1);
  });

  it('四捨五入後為 0 的極小進度也套下限', () => {
    expect(displayProgressPct(1, 500)).toBe(1);
  });

  it('一般值照常四捨五入，100% 不被下限影響', () => {
    expect(displayProgressPct(1, 3)).toBe(33);
    expect(displayProgressPct(2, 3)).toBe(67);
    expect(displayProgressPct(3, 3)).toBe(100);
  });
});

describe('buildChapterEntries', () => {
  it('列出可見章節：隱藏排除、鎖定標記、進度比例正確', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const volume = index.nodesById.get('history/u')!;
    // 讀完 arc landing + 1-1（1-1 的有效閘門需要 landing completed），1-2 未讀
    const progress = stateWith({
      flags: ['completed:history/u/1', 'completed:history/u/1/1-1'],
      completedPageIds: ['history/u/1', 'history/u/1/1-1'],
    });
    const entries = buildChapterEntries(volume, progress, index, null);

    const ids = entries.map((e) => e.node.id);
    expect(ids).not.toContain('history/u/hidden');
    expect(ids).toContain('history/u/1');

    const ch1 = entries.find((e) => e.node.id === 'history/u/1')!;
    expect(ch1.total).toBe(2);
    expect(ch1.completed).toBe(1);
    expect(ch1.locked).toBe(false);
    expect(progressRatio(ch1)).toBeCloseTo(0.5);

    const sealed = entries.find((e) => e.node.id === 'history/u/sealed');
    if (sealed) expect(sealed.locked).toBe(true);
  });

  it('isCurrent 標在最後閱讀頁的祖先鏈上', () => {
    const index = buildTreeIndex(buildFixtureTree());
    const volume = index.nodesById.get('history/u')!;
    const entries = buildChapterEntries(
      volume,
      createInitialState(),
      index,
      'history/u/1/1-2'
    );
    expect(entries.find((e) => e.node.id === 'history/u/1')?.isCurrent).toBe(
      true
    );
    // u/2 依進度鏈隱藏規則此時不可見（Reader 同語意）；
    // 其餘可見章節都不在最後閱讀頁的祖先鏈上
    expect(entries.map((e) => e.node.id)).not.toContain('history/u/2');
    for (const entry of entries) {
      if (entry.node.id !== 'history/u/1') {
        expect(entry.isCurrent).toBe(false);
      }
    }
  });
});

describe('averageReadingMinutes', () => {
  it('無完成頁或無累計時間時回傳 null', () => {
    expect(averageReadingMinutes(createInitialState())).toBeNull();
    expect(
      averageReadingMinutes(stateWith({ readingStats: { totalMs: 60_000 } }))
    ).toBeNull();
  });

  it('平均 = totalMs / 完成頁數', () => {
    const progress = stateWith({
      completedPageIds: ['a', 'b'],
      readingStats: { totalMs: 6 * 60_000 },
    });
    expect(averageReadingMinutes(progress)).toBeCloseTo(3);
  });
});

describe('navigateToHistoryPage（/history 頁內）', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/history');
  });

  it('pushState 設定 ?page= 並 dispatch popstate（Reader 路由接手）', () => {
    let popped = 0;
    const onPop = () => {
      popped += 1;
    };
    window.addEventListener('popstate', onPop);
    navigateToHistoryPage('history/u/1');
    window.removeEventListener('popstate', onPop);

    const params = new URLSearchParams(window.location.search);
    expect(params.get('page')).toBe('u/1');
    expect(popped).toBe(1);
  });
});

describe('tocCount（S9-D.6 目錄頁碼字串）', () => {
  it('locked 顯示「封」，即使 completed/total 有值也不顯示數字', () => {
    expect(tocCount({ completed: 3, total: 10, locked: true })).toBe('封');
  });

  it('未鎖定顯示 completed/total', () => {
    expect(tocCount({ completed: 3, total: 10 })).toBe('3/10');
    expect(tocCount({ completed: 0, total: 5, locked: false })).toBe('0/5');
  });

  it('未帶 locked 欄位時視同未鎖定', () => {
    expect(tocCount({ completed: 1, total: 1 })).toBe('1/1');
  });
});

describe('collectTocCounts', () => {
  it('同時收 chapter 與其底下 arcs 的頁碼快照', () => {
    const index = buildTreeIndex(buildZoneTree());
    const items = buildUnlockedChapterList(index, createInitialState(), null);
    const counts = collectTocCounts(items);

    expect(counts['history/u/c1']).toBe(tocCount(items[0]));
    expect(Object.keys(counts)).toContain('history/u/c1/a1');
    for (const arc of items[0].arcs) {
      expect(counts[arc.node.id]).toBe(tocCount(arc));
    }
  });

  it('沒有已解鎖 chapter 時回傳空物件', () => {
    // 拿一個沒有任何已解鎖 chapter 的樹（只剩鎖定/隱藏）驗證退化情形
    const lockedOnlyIndex = buildTreeIndex([
      { ...buildZoneTree()[0], children: buildZoneTree()[0].children.slice(1) },
    ]);
    const items = buildUnlockedChapterList(
      lockedOnlyIndex,
      createInitialState(),
      null
    );
    expect(collectTocCounts(items)).toEqual({});
  });
});

describe('diffTocCounts（S9-D.6 前後快照比對）', () => {
  it('值相同不算變動', () => {
    const prev = { a: '1/2', b: '封' };
    const next = { a: '1/2', b: '封' };
    expect(diffTocCounts(prev, next)).toEqual([]);
  });

  it('值不同時列為變動', () => {
    const prev = { a: '1/2', b: '封' };
    const next = { a: '2/2', b: '封' };
    expect(diffTocCounts(prev, next)).toEqual(['a']);
  });

  it('首次出現的條目（prev 沒有該 key）不算變動', () => {
    const prev = { a: '1/2' };
    const next = { a: '1/2', b: '0/3' };
    expect(diffTocCounts(prev, next)).toEqual([]);
  });

  it('locked→unlocked（「封」變成「0/12」）也算一次變動', () => {
    const prev = { a: '封' };
    const next = { a: '0/12' };
    expect(diffTocCounts(prev, next)).toEqual(['a']);
  });

  it('空前後快照回傳空陣列', () => {
    expect(diffTocCounts({}, {})).toEqual([]);
  });
});
