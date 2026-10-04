/**
 * 子頁面列表空狀態判定測試
 *
 * 判定語意：
 * - draft / 軟刪除 / hidden → 不存在；只剩這些 → construction
 * - static locked / gate 未過 → 存在但未解鎖；全部如此 → sealed
 * - 任一可見 → null
 *
 * 解鎖判斷一律接各 zone 既有的可見度函式，這裡用真實函式驗證組合結果。
 */
import { describe, expect, it } from 'vitest';

import {
  buildProgressTreeAdapter,
  createInitialState,
} from '../../../progress';
import type { ProgressState } from '../../../progress';
import { isSongUnlockedInZone } from '../../echoes/echoesVisibility';
import { isGalleryUnlockedInZone } from '../../visuals/visualsVisibility';
import { isLocked } from '../contentVisibility';
import {
  CONSTRUCTION_VARIANTS,
  SEALED_COPY,
  countPresence,
  pickConstructionVariant,
  pickSealedCopy,
  resolveEmptyStateFromCounts,
  resolveZoneEmptyState,
} from '../zoneEmptyState';

interface Node {
  id: string;
  pageType?: string;
  status?: string;
  deletedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  children?: Node[];
}

function makeProgress(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

function node(
  id: string,
  metadata: Record<string, unknown> | null = null,
  extra: Partial<Node> = {}
): Node {
  return { id, pageType: 'gallery', status: 'published', metadata, ...extra };
}

const explorer = makeProgress();
const observer = makeProgress({ view: 'observer', observerEver: true });

/** Concepts / Storage 的謂詞：非 tree 版 isLocked（static + 本頁 gate） */
const plainUnlocked =
  (progress: ProgressState) =>
  (n: Node): boolean =>
    !isLocked(n, progress);

const galleryUnlocked =
  (progress: ProgressState) =>
  (n: Node): boolean =>
    isGalleryUnlockedInZone(n, progress);

describe('resolveZoneEmptyState', () => {
  it('完全沒有項目 → construction', () => {
    expect(resolveZoneEmptyState([], plainUnlocked(explorer))).toBe(
      'construction'
    );
  });

  it('只有 hidden / draft / 軟刪除 → construction（視同不存在）', () => {
    const items = [
      node('a', { hidden: true }),
      node('b', null, { status: 'draft' }),
      node('c', null, { deletedAt: '2026-10-01T00:00:00Z' }),
    ];
    expect(resolveZoneEmptyState(items, plainUnlocked(explorer))).toBe(
      'construction'
    );
  });

  it('hidden 項目即使未上鎖也不算可見', () => {
    // 謂詞對 hidden 項目回 true，但它根本不存在
    expect(
      resolveZoneEmptyState([node('a', { hidden: true })], () => true)
    ).toBe('construction');
  });

  it('全部 static locked → sealed', () => {
    const items = [node('a', { locked: true }), node('b', { locked: true })];
    expect(resolveZoneEmptyState(items, plainUnlocked(explorer))).toBe(
      'sealed'
    );
  });

  it('全部 gate 未過（requiresFlags / alwaysLocked / pristineOnly）→ sealed', () => {
    const items = [
      node('a', { gate: { requiresFlags: ['uep:met-exera'] } }),
      node('b', { gate: { alwaysLocked: true } }),
      node('c', { gate: { pristineOnly: true } }),
    ];
    const tainted = makeProgress({ observerEver: true });
    expect(resolveZoneEmptyState(items, plainUnlocked(tainted))).toBe('sealed');
  });

  it('locked 與 hidden 混合（無可見）→ sealed', () => {
    const items = [
      node('a', { hidden: true }),
      node('b', null, { status: 'draft' }),
      node('c', { gate: { requiresFlags: ['completed:history/ch1'] } }),
    ];
    expect(resolveZoneEmptyState(items, plainUnlocked(explorer))).toBe(
      'sealed'
    );
  });

  it('混合中只要有一項可見 → null', () => {
    const items = [
      node('a', { hidden: true }),
      node('b', { locked: true }),
      node('c', { gate: { requiresFlags: ['uep:never'] } }),
      node('d'),
    ];
    expect(resolveZoneEmptyState(items, plainUnlocked(explorer))).toBeNull();
  });

  it('gate 達成後變可見 → null', () => {
    const items = [
      node('a', { gate: { requiresFlags: ['completed:history/ch1'] } }),
    ];
    const done = makeProgress({ flags: ['completed:history/ch1'] });
    expect(resolveZoneEmptyState(items, plainUnlocked(done))).toBeNull();
  });

  describe('觀測者模式（沿用 evaluateGate 語意）', () => {
    it('requiresFlags 類 gate 被 bypass → 可見 → null', () => {
      const items = [node('a', { gate: { requiresFlags: ['uep:never'] } })];
      expect(resolveZoneEmptyState(items, plainUnlocked(explorer))).toBe(
        'sealed'
      );
      expect(resolveZoneEmptyState(items, plainUnlocked(observer))).toBeNull();
    });

    it('alwaysLocked 被 bypass → 可見 → null', () => {
      const items = [node('a', { gate: { alwaysLocked: true } })];
      expect(resolveZoneEmptyState(items, plainUnlocked(explorer))).toBe(
        'sealed'
      );
      expect(resolveZoneEmptyState(items, plainUnlocked(observer))).toBeNull();
    });

    it('static locked / pristineOnly 不被 bypass → 仍 sealed', () => {
      for (const metadata of [
        { locked: true },
        { gate: { pristineOnly: true } },
      ]) {
        expect(
          resolveZoneEmptyState([node('a', metadata)], plainUnlocked(observer))
        ).toBe('sealed');
      }
    });

    it('觀測者看不到 hidden / draft → 仍 construction', () => {
      const items = [
        node('a', { hidden: true }),
        node('b', null, { status: 'draft' }),
      ];
      expect(resolveZoneEmptyState(items, plainUnlocked(observer))).toBe(
        'construction'
      );
    });
  });

  describe('沿用 zone 既有可見度函式', () => {
    it('Visuals：推導旗標授予後 gallery 可見 → null', () => {
      const items = [
        node('visuals/profiles/characters/exera', {
          gate: { requiresFlags: ['completed:history/ch9'] },
        }),
      ];
      expect(resolveZoneEmptyState(items, galleryUnlocked(explorer))).toBe(
        'sealed'
      );
      const granted = makeProgress({
        flags: ['gallery:visuals/profiles/characters/exera'],
      });
      expect(resolveZoneEmptyState(items, galleryUnlocked(granted))).toBeNull();
    });

    it('Visuals：static locked 凌駕觀測者 → sealed', () => {
      const items = [node('g', { locked: true })];
      expect(resolveZoneEmptyState(items, galleryUnlocked(observer))).toBe(
        'sealed'
      );
    });

    it('Echoes：未解鎖歌曲 → sealed', () => {
      const items = [
        node(
          'echoes/stories/a',
          { gate: { requiresFlags: ['uep:never'] } },
          {
            pageType: 'song',
          }
        ),
      ];
      expect(
        resolveZoneEmptyState(items, (n) => isSongUnlockedInZone(n, explorer))
      ).toBe('sealed');
    });

    it('tree-aware：progressPage 鏈未通過 → sealed，前一頁完成後 → null', () => {
      const first = node('visuals/x/first', { progressPage: true });
      const second = node('visuals/x/second', { progressPage: true });
      const tree = buildProgressTreeAdapter([
        { id: 'visuals/x', pageType: 'subcategory', children: [first, second] },
      ]);
      const unlocked = (progress: ProgressState) => (n: Node) =>
        isGalleryUnlockedInZone(n, progress, tree);

      // 只看鏈上第二頁：第一頁未完成 → 存在但未解鎖
      expect(resolveZoneEmptyState([second], unlocked(explorer))).toBe(
        'sealed'
      );
      const done = makeProgress({
        flags: ['completed:visuals/x/first'],
        completedPageIds: ['visuals/x/first'],
      });
      expect(resolveZoneEmptyState([second], unlocked(done))).toBeNull();
    });
  });
});

describe('countPresence / resolveEmptyStateFromCounts', () => {
  it('計數分類正確', () => {
    const items = [
      node('a', { hidden: true }),
      node('b', { locked: true }),
      node('c'),
      node('d'),
    ];
    expect(countPresence(items, plainUnlocked(explorer))).toEqual({
      visible: 2,
      locked: 1,
      absent: 1,
    });
  });

  it('只給計數也能判定（後端回傳計數時的入口）', () => {
    expect(resolveEmptyStateFromCounts({})).toBe('construction');
    expect(resolveEmptyStateFromCounts({ absent: 3 })).toBe('construction');
    expect(resolveEmptyStateFromCounts({ locked: 2, absent: 1 })).toBe(
      'sealed'
    );
    expect(resolveEmptyStateFromCounts({ visible: 1, locked: 5 })).toBeNull();
  });
});

describe('變體與文案挑選', () => {
  it('同一 seed 每次結果相同', () => {
    const seed = 'visuals:visuals/profiles/characters';
    expect(pickConstructionVariant(seed)).toBe(pickConstructionVariant(seed));
    expect(pickSealedCopy(seed)).toBe(pickSealedCopy(seed));
  });

  it('不同子頁面會分散到三種施工變體', () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) =>
        pickConstructionVariant(`visuals:subcat-${i}`)
      )
    );
    expect([...seen].sort()).toEqual([...CONSTRUCTION_VARIANTS].sort());
  });

  it('sealed 文案都取得到', () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => pickSealedCopy(`echoes:sub-${i}`))
    );
    expect(seen.size).toBe(SEALED_COPY.length);
  });
});
