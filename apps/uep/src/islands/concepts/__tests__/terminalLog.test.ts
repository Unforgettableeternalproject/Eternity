/**
 * Terminal 輸出歷史持久化測試（S7-C 驗收回饋）
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  MAX_TERM_LINES,
  TERMINAL_LOG_KEY,
  clearTerminalLog,
  loadTerminalLog,
  normalizeTermLines,
  saveTerminalLog,
} from '../terminalLog';
import type { TermLine } from '../terminalLog';

beforeEach(() => {
  window.localStorage.clear();
});

const sampleEntry = {
  name: '艾斯維爾·科索諾',
  stack: 'dossier' as const,
  pageId: 'concepts/server/records/character_list',
  pageTitle: '角色列表',
  entityKey: 'xavier',
};

describe('round-trip', () => {
  it('save 後 load 保留 kind/text/fade/action', () => {
    const lines: TermLine[] = [
      { kind: 'in', text: '$ query xavier' },
      { kind: 'ok', text: '✓ 1 筆結果' },
      {
        kind: 'row',
        text: '  › 艾斯維爾',
        fade: true,
        action: { type: 'show-entry', entry: sampleEntry },
      },
    ];
    saveTerminalLog(lines);
    const loaded = loadTerminalLog();
    expect(loaded).toEqual(lines);
    // action 是純資料——可序列化重建
    expect(loaded![2].action).toEqual({
      type: 'show-entry',
      entry: sampleEntry,
    });
  });

  it('超過上限時截尾保留最新', () => {
    const lines: TermLine[] = Array.from(
      { length: MAX_TERM_LINES + 50 },
      (_, i): TermLine => ({ kind: 'meta', text: `line ${i}` })
    );
    saveTerminalLog(lines);
    const loaded = loadTerminalLog();
    expect(loaded).toHaveLength(MAX_TERM_LINES);
    expect(loaded![loaded!.length - 1].text).toBe(
      `line ${MAX_TERM_LINES + 49}`
    );
    expect(loaded![0].text).toBe('line 50');
  });

  it('clearTerminalLog 後 load 回傳 null', () => {
    saveTerminalLog([{ kind: 'meta', text: 'x' }]);
    clearTerminalLog();
    expect(loadTerminalLog()).toBeNull();
    expect(window.localStorage.getItem(TERMINAL_LOG_KEY)).toBeNull();
  });
});

describe('容錯', () => {
  it('毀損 JSON 回傳 null', () => {
    window.localStorage.setItem(TERMINAL_LOG_KEY, '{broken!!');
    expect(loadTerminalLog()).toBeNull();
  });

  it('非陣列形狀回傳 null', () => {
    window.localStorage.setItem(TERMINAL_LOG_KEY, '{"not":"array"}');
    expect(loadTerminalLog()).toBeNull();
  });

  it('非法行剔除、合法行保留', () => {
    const normalized = normalizeTermLines([
      { kind: 'meta', text: 'ok line' },
      { kind: 'bogus', text: 'bad kind' },
      { kind: 'row' }, // 缺 text
      'not an object',
      null,
    ]);
    expect(normalized).toEqual([{ kind: 'meta', text: 'ok line' }]);
  });

  it('非法 action 降級為純文字行（不整行丟棄）', () => {
    const normalized = normalizeTermLines([
      { kind: 'row', text: 'a', action: { type: 'unknown' } },
      { kind: 'row', text: 'b', action: { type: 'show-entry' } }, // 缺 entry
      {
        kind: 'row',
        text: 'c',
        action: {
          type: 'show-entry',
          entry: { name: 'n', stack: 'evil', pageId: 'p', pageTitle: 't' },
        },
      }, // 非法 stack
      {
        kind: 'row',
        text: 'd',
        action: { type: 'show-entry', entry: sampleEntry },
      },
    ]);
    expect(normalized).toHaveLength(4);
    expect(normalized![0].action).toBeUndefined();
    expect(normalized![1].action).toBeUndefined();
    expect(normalized![2].action).toBeUndefined();
    expect(normalized![3].action).toEqual({
      type: 'show-entry',
      entry: sampleEntry,
    });
  });

  it('navigate action round-trip；非法 pageId 降級純文字', () => {
    const normalized = normalizeTermLines([
      {
        kind: 'row',
        text: '→ 前往角色列表 ▸',
        action: { type: 'navigate', pageId: 'concepts/server/records/x' },
      },
      { kind: 'row', text: 'bad', action: { type: 'navigate', pageId: '' } },
      { kind: 'row', text: 'bad2', action: { type: 'navigate' } },
    ]);
    expect(normalized![0].action).toEqual({
      type: 'navigate',
      pageId: 'concepts/server/records/x',
    });
    expect(normalized![1].action).toBeUndefined();
    expect(normalized![2].action).toBeUndefined();
  });

  it('expand-browser action round-trip；非法 entry 降級純文字（S7-D-4）', () => {
    const browserEntry = {
      ...sampleEntry,
      stack: 'browser' as const,
      pageId: 'concepts/server/browser/profiles',
    };
    const normalized = normalizeTermLines([
      {
        kind: 'row',
        text: '  ▸ 展開完整檔案',
        action: { type: 'expand-browser', entry: browserEntry },
      },
      { kind: 'row', text: 'bad', action: { type: 'expand-browser' } },
    ]);
    expect(normalized![0].action).toEqual({
      type: 'expand-browser',
      entry: browserEntry,
    });
    expect(normalized![1].action).toBeUndefined();
  });

  it('ls-category action round-trip；非法 stack 降級純文字', () => {
    const normalized = normalizeTermLines([
      {
        kind: 'row',
        text: '▸ 人物 (17) ▾',
        action: { type: 'ls-category', stack: 'dossier', category: '人物' },
      },
      {
        kind: 'row',
        text: '▸ 未分類 (3) ▾',
        action: { type: 'ls-category', stack: 'diff', category: '' },
      },
      {
        kind: 'row',
        text: 'bad',
        action: { type: 'ls-category', stack: 'evil', category: 'x' },
      },
    ]);
    expect(normalized![0].action).toEqual({
      type: 'ls-category',
      stack: 'dossier',
      category: '人物',
    });
    expect(normalized![1].action).toEqual({
      type: 'ls-category',
      stack: 'diff',
      category: '',
    });
    expect(normalized![2].action).toBeUndefined();
  });

  it('ls-category 帶 pageId 的三層式 round-trip（S7 驗收 #5）', () => {
    const normalized = normalizeTermLines([
      {
        kind: 'row',
        text: '▸ 三區 (5) ▾',
        action: {
          type: 'ls-category',
          stack: 'dossier',
          category: '三區',
          pageId: 'concepts/a',
        },
      },
      // 非字串 pageId → 欄位丟棄但 action 保留（舊 log 相容語意）
      {
        kind: 'row',
        text: '▸ 五區 (2) ▾',
        action: {
          type: 'ls-category',
          stack: 'dossier',
          category: '五區',
          pageId: 42,
        },
      },
    ]);
    expect(normalized![0].action).toEqual({
      type: 'ls-category',
      stack: 'dossier',
      category: '三區',
      pageId: 'concepts/a',
    });
    expect(normalized![1].action).toEqual({
      type: 'ls-category',
      stack: 'dossier',
      category: '五區',
    });
  });

  it('ls-page action round-trip；缺 pageTitle / 非法 stack 降級純文字（S7 驗收 #5）', () => {
    const normalized = normalizeTermLines([
      {
        kind: 'row',
        text: '▸ 人物列表 (13) ▾',
        action: {
          type: 'ls-page',
          stack: 'dossier',
          pageId: 'concepts/a',
          pageTitle: '人物列表',
        },
      },
      {
        kind: 'row',
        text: 'bad',
        action: { type: 'ls-page', stack: 'dossier', pageId: 'concepts/a' },
      },
      {
        kind: 'row',
        text: 'bad2',
        action: { type: 'ls-page', stack: 'evil', pageId: 'x', pageTitle: 'y' },
      },
    ]);
    expect(normalized![0].action).toEqual({
      type: 'ls-page',
      stack: 'dossier',
      pageId: 'concepts/a',
      pageTitle: '人物列表',
    });
    expect(normalized![1].action).toBeUndefined();
    expect(normalized![2].action).toBeUndefined();
  });

  it('fade 只接受 true（其他值不落欄位）', () => {
    const normalized = normalizeTermLines([
      { kind: 'row', text: 'a', fade: true },
      { kind: 'row', text: 'b', fade: 'yes' },
    ]);
    expect(normalized![0].fade).toBe(true);
    expect('fade' in normalized![1]).toBe(false);
  });
});

describe('suffix（行尾符號動作）', () => {
  it('suffix round-trip；非法 suffix 整個丟棄、主行保留', () => {
    const normalized = normalizeTermLines([
      {
        kind: 'ok',
        text: '✓ 艾斯維爾 · log/records',
        suffix: {
          text: '↗',
          action: { type: 'navigate', pageId: 'concepts/server/records/x' },
        },
      },
      {
        kind: 'ok',
        text: 'bad suffix action',
        suffix: { text: '↗', action: { type: 'navigate', pageId: '' } },
      },
      {
        kind: 'ok',
        text: 'bad suffix text',
        suffix: { text: '', action: { type: 'navigate', pageId: 'p' } },
      },
    ]);
    expect(normalized![0].suffix).toEqual({
      text: '↗',
      action: { type: 'navigate', pageId: 'concepts/server/records/x' },
    });
    expect(normalized![1].suffix).toBeUndefined();
    expect(normalized![1].text).toBe('bad suffix action');
    expect(normalized![2].suffix).toBeUndefined();
  });

  it('主 action 與 suffix 可並存', () => {
    const normalized = normalizeTermLines([
      {
        kind: 'row',
        text: '› 條目',
        action: { type: 'show-entry', entry: sampleEntry },
        suffix: {
          text: '↗',
          action: { type: 'navigate', pageId: 'concepts/p' },
        },
      },
    ]);
    expect(normalized![0].action?.type).toBe('show-entry');
    expect(normalized![0].suffix?.action.type).toBe('navigate');
  });
});

describe('completeInput 的 browser 排除（三輪定案）', () => {
  it('browser 條目不進補全候選', async () => {
    const { completeInput } = await import('../terminalCore');
    const { createInitialState } = await import('../../../progress/types');
    const entries = [
      sampleEntry, // dossier
      {
        name: '艾斯維爾·科索諾 (Xavier Colsono)',
        stack: 'browser' as const,
        pageId: 'concepts/server/browser/profiles',
        pageTitle: '個性瀏覽器',
        entityKey: 'xavier',
      },
    ];
    const hits = completeInput('query xavier', entries, createInitialState());
    expect(hits).toEqual(['query 艾斯維爾·科索諾']);
  });
});
