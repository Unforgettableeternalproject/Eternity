/**
 * Echoes 歌曲解鎖判定測試（S8 B-1）
 *
 * 核心語意：解鎖凌駕於所有 spoiler 之上——未解鎖的歌在 Echoes 中
 * 完全隱藏。解鎖 = gate 條件達成（同 Concepts）或持有系統推導旗標。
 */
import { describe, expect, it } from 'vitest';

import { createInitialState } from '../../../progress';
import type { ProgressState } from '../../../progress';
import { isSongUnlockedInZone } from '../echoesVisibility';

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

  it('推導旗標 song:{id}（無 entityKey）授予 → 解鎖，即使 gate 未過', () => {
    const song = makeSong({ requiresFlags: ['completed:history/ch9'] });
    const progress = makeProgress({ flags: ['song:echoes/silent-oath'] });
    expect(isSongUnlockedInZone(song, progress)).toBe(true);
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
    // 有 entityKey 時不吃 song:{id} 旗標（雙命名空間互斥）
    expect(
      isSongUnlockedInZone(
        song,
        makeProgress({ flags: ['song:echoes/silent-oath'] })
      )
    ).toBe(false);
  });

  it('entityKey 空白字串 → fallback 到 song:{id}', () => {
    const song = makeSong({ entityKey: '  ', requiresFlags: ['x:y'] });
    const progress = makeProgress({ flags: ['song:echoes/silent-oath'] });
    expect(isSongUnlockedInZone(song, progress)).toBe(true);
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
