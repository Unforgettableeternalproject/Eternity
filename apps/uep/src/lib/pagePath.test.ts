import { describe, expect, it } from 'vitest';
import { canonicalizePagePath, isSamePagePath } from './pagePath';

describe('pagePath', () => {
  it('將中文與保留字逐段正規化，且不編碼路徑分隔線', () => {
    expect(canonicalizePagePath('echoes/核心人物/測試 歌曲#1')).toBe(
      'echoes/%E6%A0%B8%E5%BF%83%E4%BA%BA%E7%89%A9/%E6%B8%AC%E8%A9%A6%20%E6%AD%8C%E6%9B%B2%231'
    );
  });

  it('對已編碼的 page path 保持冪等', () => {
    const encoded =
      'echoes/characters/core_chara/%E6%B8%AC%E8%A9%A6%E6%AD%8C%E6%9B%B2';
    expect(canonicalizePagePath(encoded)).toBe(encoded);
  });

  it('把 encoded 與 decoded 的同一頁視為相同', () => {
    expect(
      isSamePagePath(
        'echoes/characters/core_chara/%E6%B8%AC%E8%A9%A6%E6%AD%8C%E6%9B%B2',
        'echoes/characters/core_chara/測試歌曲'
      )
    ).toBe(true);
  });

  it('遇到 malformed percent sequence 時不拋錯', () => {
    expect(canonicalizePagePath('history/100%/draft')).toBe(
      'history/100%25/draft'
    );
  });
});
