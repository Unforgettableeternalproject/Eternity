/**
 * 登入儀式的播放地點判定。
 *
 * 儀式只在主頁播：回到 zone 頁時該頁自己就有入場動畫與 Reader 的進場節奏，
 * 全屏儀式疊上去是兩套開場互相打架。判定錯的代價是不對稱的——
 * 誤判成主頁會讓 zone 頁多播一次不該有的儀式，誤判成非主頁只是少播一次。
 */
import { describe, expect, it } from 'vitest';

import { isHomeReturn } from '../ReaderLoginPage';

describe('isHomeReturn', () => {
  it('根路徑是主頁', () => {
    expect(isHomeReturn('/')).toBe(true);
  });

  it('帶 query 或 hash 的根路徑仍是主頁', () => {
    // 這是不能用字串相等判斷的原因：主頁的錨點連結長這樣
    expect(isHomeReturn('/#journey-start')).toBe(true);
    expect(isHomeReturn('/?from=zone')).toBe(true);
    expect(isHomeReturn('/?a=1#b')).toBe(true);
  });

  it('zone 頁不是主頁', () => {
    expect(isHomeReturn('/history')).toBe(false);
    expect(isHomeReturn('/echoes/song/abc')).toBe(false);
  });

  it('開頭像主頁但其實是別的路徑——不可只比前綴', () => {
    expect(isHomeReturn('/history?x=/')).toBe(false);
  });

  it('空字串當主頁：sanitizeReturn 之後不該出現，但落到這裡時放行比擋掉安全', () => {
    expect(isHomeReturn('')).toBe(true);
  });
});
