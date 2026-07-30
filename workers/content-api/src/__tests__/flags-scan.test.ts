import { describe, expect, it } from 'vitest';
import {
  classifyFlag,
  scanGrantedFlags,
  scanRequiredFlags,
} from '../flags-scan';

/**
 * 旗標掃描器：從 content 的序列化 HTML 撈 FlagMarker 的授予旗標、
 * 從 metadata 撈 gate 的需求旗標，以及 derived／custom 的形狀分類。
 *
 * 這是新寫的掃描器而非移植——編輯器端的判定吃 PMNode（ProseMirror
 * 型別，Worker 沒有那個環境），D1 的 content 欄位存的是 HTML 字串。
 */

/** 包成 ContentBlock[] JSON，模擬 D1 實際存放的形狀 */
function block(html: string): string {
  return JSON.stringify([{ type: 'rich_text', content: html }]);
}

describe('scanGrantedFlags', () => {
  it('單一 marker 的逗號分隔旗標全部取出', () => {
    const html =
      '<div data-grants-flags="met:novia,met:dell" data-role="progress-marker" class="tiptap-progress-marker"></div>';
    expect(scanGrantedFlags(block(html))).toEqual(['met:novia', 'met:dell']);
  });

  /**
   * mergeAttributes 把節點自己的屬性排在 data-role 之前，但順序不是契約
   * 的一部分——正規式不能假設 data-role 一定在最前或最後。
   */
  it('data-role 出現在屬性字串任何位置都能匹配', () => {
    const before =
      '<div data-role="progress-marker" data-grants-flags="a-flag"></div>';
    const after =
      '<div data-grants-flags="b-flag" aria-hidden="true" data-role="progress-marker"></div>';
    expect(scanGrantedFlags(block(before))).toEqual(['a-flag']);
    expect(scanGrantedFlags(block(after))).toEqual(['b-flag']);
  });

  it('多個 marker 累加並去重', () => {
    const html = [
      '<div data-role="progress-marker" data-grants-flags="dup-flag,one"></div>',
      '<p>中間的內文</p>',
      '<div data-role="progress-marker" data-grants-flags="dup-flag,two"></div>',
    ].join('');
    expect(scanGrantedFlags(block(html))).toEqual(['dup-flag', 'one', 'two']);
  });

  it('沒有 data-grants-flags 的純進度標記不產生旗標', () => {
    const html = '<div data-role="progress-marker"></div>';
    expect(scanGrantedFlags(block(html))).toEqual([]);
  });

  it('空值、多餘空白與空項目都被清掉', () => {
    const html =
      '<div data-role="progress-marker" data-grants-flags=" spaced ,, ,trailing "></div>';
    expect(scanGrantedFlags(block(html))).toEqual(['spaced', 'trailing']);
  });

  it('屬性值的實體字元會被解開', () => {
    const html =
      '<div data-role="progress-marker" data-grants-flags="a&amp;b"></div>';
    expect(scanGrantedFlags(block(html))).toEqual(['a&b']);
  });

  it('非 progress-marker 的標記不被誤收', () => {
    const html =
      '<div data-role="echo-spot" data-grants-flags="should-not-count"></div>';
    expect(scanGrantedFlags(block(html))).toEqual([]);
  });

  it('content 為純 HTML 字串（非 ContentBlock JSON）時直接掃', () => {
    const html =
      '<div data-role="progress-marker" data-grants-flags="raw-html"></div>';
    expect(scanGrantedFlags(html)).toEqual(['raw-html']);
  });

  it('壞 JSON、null、空陣列都不炸', () => {
    expect(scanGrantedFlags('{ 壞掉的 json')).toEqual([]);
    expect(scanGrantedFlags(null)).toEqual([]);
    expect(scanGrantedFlags(undefined)).toEqual([]);
    expect(scanGrantedFlags([])).toEqual([]);
    expect(scanGrantedFlags([{ type: 'rich_text' }])).toEqual([]);
  });
});

describe('scanRequiredFlags', () => {
  it('巢狀 gate 形狀', () => {
    expect(
      scanRequiredFlags({ gate: { requiresFlags: ['completed:a', 'x-flag'] } })
    ).toEqual(['completed:a', 'x-flag']);
  });

  /**
   * 平鋪形狀是 parseGateCondition 既有的相容行為。掃描器漏掉這種就會把
   * 真正有在用的旗標誤報成「沒人需要」。
   */
  it('平鋪形狀', () => {
    expect(scanRequiredFlags({ requiresFlags: ['flat-flag'] })).toEqual([
      'flat-flag',
    ]);
  });

  it('gate 存在時只讀 gate，不再看平鋪', () => {
    expect(
      scanRequiredFlags({
        gate: { requiresFlags: ['nested'] },
        requiresFlags: ['flat'],
      })
    ).toEqual(['nested']);
  });

  it('去重、去空白、丟掉非字串元素', () => {
    expect(
      scanRequiredFlags({
        requiresFlags: [' dup ', 'dup', '', 42, null, 'other'],
      })
    ).toEqual(['dup', 'other']);
  });

  it('沒有 gate 或型別不符都回空陣列', () => {
    expect(scanRequiredFlags(null)).toEqual([]);
    expect(scanRequiredFlags(undefined)).toEqual([]);
    expect(scanRequiredFlags({})).toEqual([]);
    expect(scanRequiredFlags({ gate: null })).toEqual([]);
    expect(scanRequiredFlags({ requiresFlags: 'not-an-array' })).toEqual([]);
    expect(scanRequiredFlags('字串')).toEqual([]);
  });
});

describe('classifyFlag', () => {
  it('六種規則生成形狀都判為 derived', () => {
    expect(classifyFlag('completed:history/passage/ch-1')).toBe('derived');
    expect(classifyFlag('met:novia')).toBe('derived');
    expect(classifyFlag('zone:visited:echoes')).toBe('derived');
    expect(classifyFlag('rain-sea-finale:song')).toBe('derived');
    expect(classifyFlag('xavier-colsono:gallery')).toBe('derived');
    expect(classifyFlag('gallery:visuals/illustrations/era-u/x')).toBe(
      'derived'
    );
    expect(classifyFlag('some-gallery:image:img-01')).toBe('derived');
  });

  it('一般自訂旗標判為 custom', () => {
    expect(classifyFlag('chapter1-truth-revealed')).toBe('custom');
    expect(classifyFlag('act2:betrayal')).toBe('custom');
    expect(classifyFlag('debug-unlock-all')).toBe('custom');
  });

  it('空字串與純空白視為 custom（不豁免註冊）', () => {
    expect(classifyFlag('')).toBe('custom');
    expect(classifyFlag('   ')).toBe('custom');
  });

  /**
   * 已知限制，不是 bug：判定看的是形狀，而 `{storyKey}:song` 的 storyKey
   * 本身就是任意 key 字串，字元集與自訂旗標完全重疊，沒有正規式能區分
   * 「劇情歌解鎖旗標」與「剛好以 :song 結尾的自訂旗標」。後者會被誤判為
   * derived 而豁免註冊強制。緩解靠命名慣例，不靠更聰明的比對。
   */
  it('剛好以 derived 尾碼結尾的自訂旗標會被誤判（已知限制）', () => {
    expect(classifyFlag('my-custom:song')).toBe('derived');
    expect(classifyFlag('anything:gallery')).toBe('derived');
  });
});
