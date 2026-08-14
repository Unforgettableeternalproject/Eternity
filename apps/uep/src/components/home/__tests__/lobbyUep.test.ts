/**
 * 大廳 U.E.P 的出現判定（S11）
 *
 * 「第一次必定、之後兩成」這句話的邊界全在這支：標記何時寫下、
 * localStorage 不能用時退成什麼行為。
 */
/* global Storage */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOBBY_ART_CHANCE,
  LOBBY_ART_KEY,
  shouldShowLobbyArt,
} from '../LobbyUep';

/** 讓 random 回傳可預期值，避免用真亂數測機率邊界 */
const fixed = (v: number) => () => v;

describe('shouldShowLobbyArt', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('第一次進站必定出現，即使亂數落在不利的那一側', () => {
    expect(shouldShowLobbyArt(fixed(0.99))).toBe(true);
  });

  it('第一次判定就寫下標記', () => {
    expect(window.localStorage.getItem(LOBBY_ART_KEY)).toBeNull();
    shouldShowLobbyArt(fixed(0.99));
    expect(window.localStorage.getItem(LOBBY_ART_KEY)).not.toBeNull();
  });

  it('見過之後轉為機率制', () => {
    shouldShowLobbyArt(fixed(0.99));
    expect(shouldShowLobbyArt(fixed(0.99))).toBe(false);
    expect(shouldShowLobbyArt(fixed(0.01))).toBe(true);
  });

  it('機率邊界是左閉右開：剛好等於門檻不出現', () => {
    shouldShowLobbyArt(fixed(0.99));
    expect(shouldShowLobbyArt(fixed(LOBBY_ART_CHANCE))).toBe(false);
    expect(shouldShowLobbyArt(fixed(LOBBY_ART_CHANCE - 0.0001))).toBe(true);
  });

  it('標記寫不進去時整個停用，不會退成沒有記憶的機率制', () => {
    // 要攔的是 Storage.prototype——直接指派 window.localStorage.setItem
    // 在 jsdom 上不會生效，測試會靜默地變成在測正常路徑
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    try {
      expect(shouldShowLobbyArt(fixed(0.99))).toBe(false);
      // 沒有記憶的話「第一次必定」每次都成立，她會變成常駐——所以連
      // 有利的亂數也不放行
      expect(shouldShowLobbyArt(fixed(0.01))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
