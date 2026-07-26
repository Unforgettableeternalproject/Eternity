/**
 * Echoes 歌曲解鎖判定測試（S8 B-1）
 *
 * 核心語意：解鎖凌駕於所有 spoiler 之上——未解鎖的歌在 Echoes 中
 * 完全隱藏。解鎖 = gate 條件達成（同 Concepts）或持有系統推導旗標。
 */
import { describe, expect, it } from 'vitest';

import {
  buildProgressTreeAdapter,
  createInitialState,
} from '../../../progress';
import type { ProgressState } from '../../../progress';
import { isSongQueueEligible, isSongUnlockedInZone } from '../echoesVisibility';

function makeProgress(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

function makeSong(metadata: Record<string, unknown> | null = null) {
  return { id: 'echoes/silent-oath', metadata };
}

describe('isSongUnlockedInZone', () => {
  it('無 gate 無鎖 → 天生解鎖', () => {
    expect(isSongUnlockedInZone(makeSong(), makeProgress())).toBe(true);
    expect(isSongUnlockedInZone(makeSong({}), makeProgress())).toBe(true);
  });

  it('gate 條件未達成 → 隱藏', () => {
    const song = makeSong({ requiresFlags: ['completed:history/ch1'] });
    expect(isSongUnlockedInZone(song, makeProgress())).toBe(false);
  });

  it('gate 條件達成（旗標／完成章節）→ 解鎖', () => {
    const song = makeSong({ requiresFlags: ['completed:history/ch1'] });
    const progress = makeProgress({ flags: ['completed:history/ch1'] });
    expect(isSongUnlockedInZone(song, progress)).toBe(true);
  });

  it('巢狀 gate 物件形狀也可求值', () => {
    const song = makeSong({ gate: { requiresFlags: ['some:flag'] } });
    expect(isSongUnlockedInZone(song, makeProgress())).toBe(false);
    expect(
      isSongUnlockedInZone(song, makeProgress({ flags: ['some:flag'] }))
    ).toBe(true);
  });

  it('無 key 的歌推導不出旗標 → 只能靠 gate 解鎖', () => {
    const song = makeSong({ requiresFlags: ['completed:history/ch9'] });
    // 舊的 song:{id} 旗標已不再是判斷依據
    const progress = makeProgress({ flags: ['song:echoes/silent-oath'] });
    expect(isSongUnlockedInZone(song, progress)).toBe(false);
    // gate 過了才解鎖
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['completed:history/ch9'] })
      )
    ).toBe(true);
  });

  it('推導旗標 {entityKey}:song 授予 → 解鎖', () => {
    const song = makeSong({
      entityKey: 'xavier-colsono',
      requiresFlags: ['completed:history/ch9'],
    });
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['xavier-colsono:song'] })
      )
    ).toBe(true);
    // 舊的 song:{id} 命名已完全退場，不再是判斷依據
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['song:echoes/silent-oath'] })
      )
    ).toBe(false);
  });

  it('entityKey 空白字串等同沒填 → 推導不出旗標', () => {
    const song = makeSong({ entityKey: '  ', requiresFlags: ['x:y'] });
    const progress = makeProgress({ flags: ['song:echoes/silent-oath'] });
    expect(isSongUnlockedInZone(song, progress)).toBe(false);
  });

  it('劇情歌用 storyKey 推導旗標，不吃 entityKey', () => {
    const song = makeSong({
      category: 'story',
      storyKey: 'rain-sea-finale',
      requiresFlags: ['completed:history/ch9'],
    });
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['rain-sea-finale:song'] })
      )
    ).toBe(true);
  });

  it('沒有 storyKey 的劇情歌永遠推導不出旗標', () => {
    const song = makeSong({
      category: 'story',
      requiresFlags: ['completed:history/ch9'],
    });
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['song:echoes/silent-oath', 'anything:song'] })
      )
    ).toBe(false);
  });

  it('觀測者 bypass requiresFlags', () => {
    const song = makeSong({ requiresFlags: ['completed:history/ch9'] });
    const progress = makeProgress({ view: 'observer', observerEver: true });
    expect(isSongUnlockedInZone(song, progress)).toBe(true);
  });

  it('觀測者不 bypass pristineOnly', () => {
    const song = makeSong({ pristineOnly: true });
    const progress = makeProgress({ view: 'observer', observerEver: true });
    expect(isSongUnlockedInZone(song, progress)).toBe(false);
  });

  it('靜態鎖凌駕一切：推導旗標與觀測者都不 bypass', () => {
    const song = makeSong({ locked: true });
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['song:echoes/silent-oath'] })
      )
    ).toBe(false);
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ view: 'observer', observerEver: true })
      )
    ).toBe(false);
  });

  it('progress 為 null → 向後相容只判靜態鎖', () => {
    expect(isSongUnlockedInZone(makeSong(), null)).toBe(true);
    expect(isSongUnlockedInZone(makeSong({ locked: true }), null)).toBe(false);
    // gate 條件在無 progress 時不求值（向後相容顯示）
    expect(
      isSongUnlockedInZone(makeSong({ requiresFlags: ['x:y'] }), null)
    ).toBe(true);
  });
});

describe('isSongUnlockedInZone — tree-aware（段 0 補修迴歸）', () => {
  /**
   * 07/13 finding 場景：cluster 標 progressPage → 歌曲經父容器繼承
   * 排進同層完成鏈。舊版 isSongUnlockedInZone 不傳 tree，此鏈完全
   * 不生效（歌曲提前曝光）。
   */
  function makeTree() {
    const songA = {
      id: 'echoes/areas/song-a',
      pageType: 'song',
      metadata: {},
      children: [],
    };
    const songB = {
      id: 'echoes/areas/song-b',
      pageType: 'song',
      metadata: {},
      children: [],
    };
    const cluster = {
      id: 'echoes/areas',
      metadata: { progressPage: true },
      children: [songA, songB],
    };
    const root = { id: 'echoes', metadata: {}, children: [cluster] };
    return { songA, songB, tree: buildProgressTreeAdapter([root]) };
  }

  it('progressPage 容器的完成鏈：後曲未達成前曲 completion → 鎖定', () => {
    const { songB, tree } = makeTree();
    // 無 tree：本頁無 gate → 天生解鎖（舊行為，即 finding 所指缺陷）
    expect(isSongUnlockedInZone(songB, makeProgress())).toBe(true);
    // 有 tree：繼承進度鏈（依賴 completed:song-a）→ 鎖定
    expect(isSongUnlockedInZone(songB, makeProgress(), tree)).toBe(false);
  });

  it('前曲 completion 達成（完整鏈）→ 後曲解鎖', () => {
    const { songB, tree } = makeTree();
    // 孤兒偵測語意：song-a 的 completion 合法需其自身鏈也成立
    // （首曲依賴父 landing completed），故需給完整鏈
    const progress = makeProgress({
      flags: ['completed:echoes/areas', 'completed:echoes/areas/song-a'],
      completedPageIds: ['echoes/areas', 'echoes/areas/song-a'],
    });
    expect(isSongUnlockedInZone(songB, progress, tree)).toBe(true);
  });

  it('首曲 fallback 依賴父 landing completion', () => {
    const { songA, tree } = makeTree();
    expect(isSongUnlockedInZone(songA, makeProgress(), tree)).toBe(false);
    const progress = makeProgress({
      flags: ['completed:echoes/areas'],
      completedPageIds: ['echoes/areas'],
    });
    expect(isSongUnlockedInZone(songA, progress, tree)).toBe(true);
  });

  it('推導旗標凌駕進度鏈（已被授權聽過即解鎖）', () => {
    const { songB, tree } = makeTree();
    // songB 掛 entityKey 才有旗標可推導
    songB.metadata = { entityKey: 'song-b-entity' };
    const progress = makeProgress({ flags: ['song-b-entity:song'] });
    expect(isSongUnlockedInZone(songB, progress, tree)).toBe(true);
  });

  it('觀測者 bypass 進度鏈', () => {
    const { songB, tree } = makeTree();
    const progress = makeProgress({ view: 'observer', observerEver: true });
    expect(isSongUnlockedInZone(songB, progress, tree)).toBe(true);
  });
});

describe('isSongQueueEligible', () => {
  it('只有 L0 可加入佇列，L1-L3 即使臨時解鎖仍不合格', () => {
    expect(isSongQueueEligible(0, true)).toBe(true);
    expect(isSongQueueEligible(0, false)).toBe(false);
    expect(isSongQueueEligible(1, true)).toBe(false);
    expect(isSongQueueEligible(2, true)).toBe(false);
    expect(isSongQueueEligible(3, true)).toBe(false);
  });
});
