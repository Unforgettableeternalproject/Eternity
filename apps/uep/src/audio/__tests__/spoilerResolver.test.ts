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

/** 標準三段降級鏈：離開 L3、L2、L1。 */
const CHAIN: SongSpoilerRevision[] = [
  { sourceLevel: 3, gate: { requiresFlags: ['xavier:01'] } },
  { sourceLevel: 2, gate: { requiresFlags: ['xavier:02'] } },
  { sourceLevel: 1, gate: { requiresFlags: ['xavier:03'] } },
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

  it('允許跳級：只設定 L3 與 L1 時走 L3 → L1 → L0', () => {
    const skipping: SongSpoilerRevision[] = [
      { sourceLevel: 1, gate: { requiresFlags: ['b'] } },
      { sourceLevel: 3, gate: { requiresFlags: ['a'] } },
    ];
    expect(resolveSpoilerLevel(skipping, progressWith())).toBe(3);
    expect(resolveSpoilerLevel(skipping, progressWith({ flags: ['a'] }))).toBe(
      1
    );
    expect(
      resolveSpoilerLevel(skipping, progressWith({ flags: ['a', 'b'] }))
    ).toBe(0);
  });

  it('只有一個 Gate 時通過後只降一級', () => {
    const single: SongSpoilerRevision[] = [
      { sourceLevel: 3, gate: { requiresFlags: ['a'] } },
    ];
    expect(resolveSpoilerLevel(single, progressWith({ flags: ['a'] }))).toBe(2);
  });

  it('pristineOnly 條件走既有 evaluateGate 語意（觀測者印記者不降級）', () => {
    const chain: SongSpoilerRevision[] = [
      { sourceLevel: 1, gate: { pristineOnly: true } },
    ];
    // 純潔者：降到 L0
    expect(resolveSpoilerLevel(chain, progressWith())).toBe(0);
    // 有印記的探索者：L1 那關不過，維持 L1
    expect(
      resolveSpoilerLevel(chain, progressWith({ observerEver: true }))
    ).toBe(1);
  });

  it('舊 targetLevel 資料可向後相容，壞資料會跳過', () => {
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
  it('角色歌／區域歌用 entityKey → {entityKey}:song', () => {
    expect(deriveSongUnlockFlag('character', 'xavier-colsono')).toBe(
      'xavier-colsono:song'
    );
    expect(deriveSongUnlockFlag('area', 'invera')).toBe('invera:song');
  });

  it('劇情歌用 storyKey → {storyKey}:song', () => {
    expect(deriveSongUnlockFlag('story', undefined, 'rain-sea-finale')).toBe(
      'rain-sea-finale:song'
    );
  });

  it('劇情歌沒有 storyKey → null（永遠無法進收藏池）', () => {
    expect(deriveSongUnlockFlag('story')).toBeNull();
    expect(deriveSongUnlockFlag('story', undefined, null)).toBeNull();
    expect(deriveSongUnlockFlag('story', undefined, '  ')).toBeNull();
    // 劇情歌不看 entityKey——即使誤填了也不產生旗標
    expect(deriveSongUnlockFlag('story', 'stray-entity-key')).toBeNull();
  });

  it('非劇情歌沒有 entityKey → null', () => {
    expect(deriveSongUnlockFlag('character')).toBeNull();
    expect(deriveSongUnlockFlag('area', null)).toBeNull();
    expect(deriveSongUnlockFlag('special', '  ')).toBeNull();
    // 非劇情歌不看 storyKey
    expect(
      deriveSongUnlockFlag('character', null, 'stray-story-key')
    ).toBeNull();
  });
});
