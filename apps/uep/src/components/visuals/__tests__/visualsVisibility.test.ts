/**
 * Visuals gallery 解鎖判定測試（S8 下半場審查修正 P1-1）
 *
 * 核心語意（對位 isSongUnlockedInZone）：解鎖 = gate 條件達成或持有
 * 系統推導旗標（deriveGalleryUnlockFlag，Visual Clue 展示時授予）；
 * 靜態鎖凌駕推導旗標。
 */
import { describe, expect, it } from 'vitest';

import {
  buildProgressTreeAdapter,
  createInitialState,
} from '../../../progress';
import type { ProgressState } from '../../../progress';
import { isGalleryUnlockedInZone } from '../visualsVisibility';

function makeProgress(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

function makeGallery(metadata: Record<string, unknown> | null = null) {
  return { id: 'visuals/illustrations/rain-sea', metadata };
}

describe('isGalleryUnlockedInZone', () => {
  it('無 gate 無鎖 → 天生解鎖', () => {
    expect(isGalleryUnlockedInZone(makeGallery(), makeProgress())).toBe(true);
    expect(isGalleryUnlockedInZone(makeGallery({}), makeProgress())).toBe(true);
  });

  it('gate 條件未達成 → 鎖定', () => {
    const gallery = makeGallery({
      gate: { requiresFlags: ['completed:history/ch1'] },
    });
    expect(isGalleryUnlockedInZone(gallery, makeProgress())).toBe(false);
  });

  it('gate 條件達成 → 解鎖', () => {
    const gallery = makeGallery({
      gate: { requiresFlags: ['completed:history/ch1'] },
    });
    const progress = makeProgress({ flags: ['completed:history/ch1'] });
    expect(isGalleryUnlockedInZone(gallery, progress)).toBe(true);
  });

  it('推導旗標 gallery:{id}（無 entityKey）授予 → 解鎖，即使 gate 未過', () => {
    const gallery = makeGallery({
      gate: { requiresFlags: ['completed:history/ch9'] },
    });
    const progress = makeProgress({
      flags: ['gallery:visuals/illustrations/rain-sea'],
    });
    expect(isGalleryUnlockedInZone(gallery, progress)).toBe(true);
  });

  it('推導旗標 {entityKey}:gallery 授予 → 解鎖', () => {
    const gallery = makeGallery({
      entityKey: 'xavier-colsono',
      gate: { requiresFlags: ['completed:history/ch9'] },
    });
    expect(
      isGalleryUnlockedInZone(
        gallery,
        makeProgress({ flags: ['xavier-colsono:gallery'] })
      )
    ).toBe(true);
    // 有 entityKey 時不吃 gallery:{id} 旗標（雙命名空間互斥）
    expect(
      isGalleryUnlockedInZone(
        gallery,
        makeProgress({ flags: ['gallery:visuals/illustrations/rain-sea'] })
      )
    ).toBe(false);
  });

  it('entityKey 空白字串 → fallback 到 gallery:{id}', () => {
    const gallery = makeGallery({
      entityKey: '  ',
      gate: { pristineOnly: true },
    });
    // observerEver = 已見證（非純潔者）→ pristineOnly 閘不過，
    // 但推導旗標仍可解鎖
    const progress = makeProgress({
      flags: ['gallery:visuals/illustrations/rain-sea'],
      observerEver: true,
    });
    expect(isGalleryUnlockedInZone(gallery, progress)).toBe(true);
  });

  it('觀測者 bypass requiresFlags、不 bypass pristineOnly', () => {
    const observer = makeProgress({ view: 'observer', observerEver: true });
    expect(
      isGalleryUnlockedInZone(
        makeGallery({ gate: { requiresFlags: ['completed:history/ch9'] } }),
        observer
      )
    ).toBe(true);
    expect(
      isGalleryUnlockedInZone(
        makeGallery({ gate: { pristineOnly: true } }),
        observer
      )
    ).toBe(false);
  });

  it('靜態鎖凌駕一切：推導旗標與觀測者都不 bypass', () => {
    const gallery = makeGallery({ locked: true });
    expect(
      isGalleryUnlockedInZone(
        gallery,
        makeProgress({ flags: ['gallery:visuals/illustrations/rain-sea'] })
      )
    ).toBe(false);
    expect(
      isGalleryUnlockedInZone(
        gallery,
        makeProgress({ view: 'observer', observerEver: true })
      )
    ).toBe(false);
  });

  it('progress 為 null → 向後相容只判靜態鎖', () => {
    expect(isGalleryUnlockedInZone(makeGallery(), null)).toBe(true);
    expect(isGalleryUnlockedInZone(makeGallery({ locked: true }), null)).toBe(
      false
    );
    expect(
      isGalleryUnlockedInZone(
        makeGallery({ gate: { requiresFlags: ['x:y'] } }),
        null
      )
    ).toBe(true);
  });
});

describe('isGalleryUnlockedInZone — tree-aware', () => {
  /**
   * 對位 Echoes 段 0 補修場景：subcategory 標 progressPage 時，
   * gallery 經父容器繼承排進同層完成鏈。不傳 tree 則鏈不生效。
   */
  function makeTree() {
    const galleryA = {
      id: 'visuals/profiles/cast/first',
      pageType: 'gallery',
      metadata: {},
      children: [],
    };
    const galleryB = {
      id: 'visuals/profiles/cast/second',
      pageType: 'gallery',
      metadata: {},
      children: [],
    };
    const subcat = {
      id: 'visuals/profiles/cast',
      metadata: { progressPage: true },
      children: [galleryA, galleryB],
    };
    const root = { id: 'visuals', metadata: {}, children: [subcat] };
    return { galleryA, galleryB, tree: buildProgressTreeAdapter([root]) };
  }

  it('progressPage 容器完成鏈：前項未完成 → 鎖定；傳 tree 才生效', () => {
    const { galleryB, tree } = makeTree();
    expect(isGalleryUnlockedInZone(galleryB, makeProgress())).toBe(true);
    expect(isGalleryUnlockedInZone(galleryB, makeProgress(), tree)).toBe(false);
  });

  it('前項 completion 達成（完整鏈）→ 後項解鎖', () => {
    const { galleryB, tree } = makeTree();
    const progress = makeProgress({
      flags: [
        'completed:visuals/profiles/cast',
        'completed:visuals/profiles/cast/first',
      ],
      completedPageIds: [
        'visuals/profiles/cast',
        'visuals/profiles/cast/first',
      ],
    });
    expect(isGalleryUnlockedInZone(galleryB, progress, tree)).toBe(true);
  });

  it('推導旗標凌駕進度鏈（clue 展示過即解鎖）', () => {
    const { galleryB, tree } = makeTree();
    const progress = makeProgress({
      flags: ['gallery:visuals/profiles/cast/second'],
    });
    expect(isGalleryUnlockedInZone(galleryB, progress, tree)).toBe(true);
  });
});
