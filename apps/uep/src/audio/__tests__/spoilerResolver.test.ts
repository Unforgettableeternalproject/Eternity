/**
 * Spoiler 降級鏈與收藏池判定 — 純函式測試（S8 A-1）
 */
import { describe, it, expect } from 'vitest';

import { createInitialState } from '../../progress';
import type { ProgressState } from '../../progress';
import {
  resolveSpoilerLevel,
  isSpoilerPlayable,
  isSongCollected,
  deriveSongUnlockFlag,
  type SongSpoilerRevision,
} from '../spoilerResolver';

/** 建立測試用進度狀態 */
function progressWith(overrides: Partial<ProgressState> = {}): ProgressState {
  return { ...createInitialState(), ...overrides };
}

/** 標準三段降級鏈：xavier:01 → L2、xavier:02 → L1、xavier:03 → L0 */
const CHAIN: SongSpoilerRevision[] = [
  { targetLevel: 2, gate: { requiresFlags: ['xavier:01'] } },
  { targetLevel: 1, gate: { requiresFlags: ['xavier:02'] } },
  { targetLevel: 0, gate: { requiresFlags: ['xavier:03'] } },
];

describe('resolveSpoilerLevel', () => {
  it('無降級鏈（undefined / 空陣列）= 完全開放 L0', () => {
    const p = progressWith();
    expect(resolveSpoilerLevel(undefined, p)).toBe(0);
    expect(resolveSpoilerLevel(null, p)).toBe(0);
    expect(resolveSpoilerLevel([], p)).toBe(0);
  });

  it('觀測者 bypass 全部 spoiler → L0', () => {
    const p = progressWith({ view: 'observer', observerEver: true });
    expect(resolveSpoilerLevel(CHAIN, p)).toBe(0);
  });

  it('有降級鏈但無任何旗標 → 保持初始 L3', () => {
    expect(resolveSpoilerLevel(CHAIN, progressWith())).toBe(3);
  });

  it('逐級降：持有旗標到哪、降到哪', () => {
    expect(
      resolveSpoilerLevel(CHAIN, progressWith({ flags: ['xavier:01'] }))
    ).toBe(2);
    expect(
      resolveSpoilerLevel(
        CHAIN,
        progressWith({ flags: ['xavier:01', 'xavier:02'] })
      )
    ).toBe(1);
    expect(
      resolveSpoilerLevel(
        CHAIN,
        progressWith({ flags: ['xavier:01', 'xavier:02', 'xavier:03'] })
      )
    ).toBe(0);
  });

  it('單調 AND 鏈：前段未過時，後段條件成立也不生效', () => {
    // 只持有 xavier:03（跳級）——L2 那關就停，維持 L3
    expect(
      resolveSpoilerLevel(CHAIN, progressWith({ flags: ['xavier:03'] }))
    ).toBe(3);
    // 持有 01 + 03（缺 02）——降到 L2 後停
    expect(
      resolveSpoilerLevel(
        CHAIN,
        progressWith({ flags: ['xavier:01', 'xavier:03'] })
      )
    ).toBe(2);
  });

  it('亂序防禦：targetLevel 不可回升', () => {
    // 宣告順序反置（L0 在前）——L0 先通過後，L2/L1 因 >= current 被跳過
    const reversed: SongSpoilerRevision[] = [
      { targetLevel: 0, gate: { requiresFlags: ['a'] } },
      { targetLevel: 2, gate: { requiresFlags: ['b'] } },
    ];
    const p = progressWith({ flags: ['a', 'b'] });
    expect(resolveSpoilerLevel(reversed, p)).toBe(0);
  });

  it('pristineOnly 條件走既有 evaluateGate 語意（觀測者印記者不降級）', () => {
    const chain: SongSpoilerRevision[] = [
      { targetLevel: 0, gate: { pristineOnly: true } },
    ];
    // 純潔者：降到 L0
    expect(resolveSpoilerLevel(chain, progressWith())).toBe(0);
    // 有印記的探索者：L2 那關不過，維持 L3
    expect(
      resolveSpoilerLevel(chain, progressWith({ observerEver: true }))
    ).toBe(3);
  });

  it('資料防禦：targetLevel 非數字的條目跳過不炸', () => {
    const dirty = [
      { targetLevel: undefined, gate: {} },
      { targetLevel: 2, gate: { requiresFlags: ['xavier:01'] } },
    ] as unknown as SongSpoilerRevision[];
    expect(
      resolveSpoilerLevel(dirty, progressWith({ flags: ['xavier:01'] }))
    ).toBe(2);
  });
});

describe('isSpoilerPlayable', () => {
  it('L0-L2 可播放、L3 不可播放', () => {
    expect(isSpoilerPlayable(0)).toBe(true);
    expect(isSpoilerPlayable(1)).toBe(true);
    expect(isSpoilerPlayable(2)).toBe(true);
    expect(isSpoilerPlayable(3)).toBe(false);
  });
});

describe('isSongCollected', () => {
  it('持有旗標 → 已收藏', () => {
    const p = progressWith({ flags: ['xavier:song'] });
    expect(isSongCollected('xavier:song', p)).toBe(true);
  });

  it('未持有旗標 → 未收藏', () => {
    expect(isSongCollected('xavier:song', progressWith())).toBe(false);
  });

  it('觀測者一律視為已收藏', () => {
    const p = progressWith({ view: 'observer', observerEver: true });
    expect(isSongCollected('xavier:song', p)).toBe(true);
  });
});

describe('deriveSongUnlockFlag', () => {
  it('有 entityKey → {entityKey}:song', () => {
    expect(deriveSongUnlockFlag('echoes/songs/x', 'xavier-colsono')).toBe(
      'xavier-colsono:song'
    );
  });

  it('無 entityKey（undefined / null / 空白）→ song:{songId}', () => {
    expect(deriveSongUnlockFlag('echoes/songs/x')).toBe('song:echoes/songs/x');
    expect(deriveSongUnlockFlag('echoes/songs/x', null)).toBe(
      'song:echoes/songs/x'
    );
    expect(deriveSongUnlockFlag('echoes/songs/x', '  ')).toBe(
      'song:echoes/songs/x'
    );
  });
});
