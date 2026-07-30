/**
 * ProgressOverview 測試
 *
 * 重點是 `flattenProgressTree` 的多層繼承語意（S10-3 拆卡地雷 1）：
 * RichEditor 既有的單層 fetch 寫法在三層以上巢狀會判錯，這裡的純函式
 * 測試就是防止未來有人「順手改回去」的鎖。
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import ProgressOverview, {
  flattenProgressTree,
  type ProgressTreeNode,
} from '../ProgressOverview';

// ===== 純函式：多層繼承 =====

/** chapter（自標）→ arc（未標）→ section（未標）三層巢狀 */
function threeLevelTree(): ProgressTreeNode[] {
  return [
    {
      id: 'history/ch1',
      title: '第一章',
      pageType: 'chapter',
      metadata: { progressPage: true },
      children: [
        {
          id: 'history/ch1/arc1',
          title: '相遇',
          pageType: 'arc',
          metadata: {},
          children: [
            {
              id: 'history/ch1/arc1/s1',
              title: '01-01',
              pageType: 'section',
              metadata: {},
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

describe('flattenProgressTree', () => {
  it('三層巢狀：中間層未標記，最底層仍繼承（地雷 1 的直接回歸）', () => {
    const rows = flattenProgressTree(threeLevelTree());
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('history/ch1')).toMatchObject({
      raw: true,
      inherited: false,
      effective: true,
      depth: 0,
    });
    // arc 自己 raw 為 false，只是被動繼承
    expect(byId.get('history/ch1/arc1')).toMatchObject({
      raw: false,
      inherited: true,
      effective: true,
      inheritedFrom: '第一章',
      depth: 1,
    });
    // section 隔著一個未標記的 arc，仍要追溯到祖父層 chapter
    expect(byId.get('history/ch1/arc1/s1')).toMatchObject({
      raw: false,
      inherited: true,
      effective: true,
      inheritedFrom: '第一章',
      depth: 2,
    });
  });

  it('gateExempt 是切斷點：豁免節點與其子樹都不繼承', () => {
    const tree = threeLevelTree();
    tree[0].children![0].metadata = { gateExempt: true };
    const rows = flattenProgressTree(tree);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('history/ch1/arc1')).toMatchObject({
      exempt: true,
      inherited: false,
      effective: false,
    });
    expect(byId.get('history/ch1/arc1/s1')).toMatchObject({
      inherited: false,
      effective: false,
    });
  });

  it('豁免節點自標 progressPage 時自己與子樹照常生效（語意正交）', () => {
    const tree = threeLevelTree();
    tree[0].children![0].metadata = { gateExempt: true, progressPage: true };
    const rows = flattenProgressTree(tree);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get('history/ch1/arc1')).toMatchObject({
      raw: true,
      exempt: true,
      effective: true,
    });
    // 子層的繼承來源是重新自標的 arc，不再是 chapter
    expect(byId.get('history/ch1/arc1/s1')).toMatchObject({
      inherited: true,
      effective: true,
      inheritedFrom: '相遇',
    });
  });

  it('gate 條件收斂成摘要字串，沒有條件時為 null', () => {
    const tree: ProgressTreeNode[] = [
      {
        id: 'history/p1',
        title: '有條件',
        pageType: 'page',
        metadata: {
          gate: {
            requiresFlags: ['completed:history/ch0'],
            pristineOnly: true,
          },
        },
        children: [],
      },
      {
        id: 'history/p2',
        title: '沒條件',
        pageType: 'page',
        metadata: {},
        children: [],
      },
    ];
    const rows = flattenProgressTree(tree);
    expect(rows[0].gateSummary).toBe('completed:history/ch0、純潔者限定');
    expect(rows[1].gateSummary).toBeNull();
  });

  it('攤平順序是 DFS：父列緊接著它的子樹', () => {
    const rows = flattenProgressTree(threeLevelTree());
    expect(rows.map((r) => r.id)).toEqual([
      'history/ch1',
      'history/ch1/arc1',
      'history/ch1/arc1/s1',
    ]);
  });
});

// ===== 元件 =====

function mockApi() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = (data: unknown) => ({
      ok: true,
      json: async () => ({ ok: true, data }),
    });
    if (url === '/api/content/history/tree') return body(threeLevelTree());
    if (url === '/api/interlink/anchors-summary') {
      return body({
        pages: {
          'history/ch1/arc1/s1': {
            'echo-spot': 2,
            'visual-clue-start': 1,
            'visual-clue-end': 1,
          },
        },
      });
    }
    if (url.endsWith('/metadata') && init?.method === 'PATCH') {
      return body({ id: url, metadata: {}, updatedAt: 'now' });
    }
    return body({});
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls };
}

describe('ProgressOverview', () => {
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    ({ calls } = mockApi());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderOverview = (markers = new Map<string, number>()) =>
    render(<ProgressOverview markerCountByPage={markers} />);

  it('掛載時透過同源 proxy 載入樹與錨點彙總', async () => {
    renderOverview();
    await screen.findByText('第一章');
    const urls = calls.map((c) => c.url);
    expect(urls).toContain('/api/content/history/tree');
    expect(urls).toContain('/api/interlink/anchors-summary');
  });

  it('繼承列顯示 ☑(繼承) 而不是 checkbox，並註明來源', async () => {
    renderOverview();
    await screen.findByText('第一章');

    // chapter 自標：有可勾的 checkbox
    expect(
      screen.getByRole('checkbox', { name: '第一章 進度頁' })
    ).toBeChecked();
    // arc/section 繼承：進度頁欄變唯讀字樣
    expect(
      screen.queryByRole('checkbox', { name: '相遇 進度頁' })
    ).not.toBeInTheDocument();
    const inherited = screen.getAllByText('☑(繼承)');
    expect(inherited).toHaveLength(2);
    expect(inherited[0]).toHaveAttribute('title', '繼承自「第一章」');
  });

  it('勾 checkbox 打 metadata PATCH 並 refetch 整棵樹', async () => {
    renderOverview();
    await screen.findByText('第一章');
    const treeFetches = () =>
      calls.filter((c) => c.url === '/api/content/history/tree').length;
    expect(treeFetches()).toBe(1);

    fireEvent.click(screen.getByRole('checkbox', { name: '第一章 進度頁' }));

    await waitFor(() => {
      const patch = calls.find(
        (c) =>
          c.url === '/api/content/history/ch1/metadata' &&
          c.init?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({
        progressPage: false,
      });
    });
    // 不做就地 state 手術，成功後整棵樹重抓
    await waitFor(() => expect(treeFetches()).toBe(2));
  });

  it('豁免 checkbox 打的是 gateExempt 鍵', async () => {
    renderOverview();
    await screen.findByText('第一章');

    fireEvent.click(
      screen.getByRole('checkbox', { name: '相遇 不繼承容器進度' })
    );

    await waitFor(() => {
      const patch = calls.find(
        (c) =>
          c.url === '/api/content/history/ch1/arc1/metadata' &&
          c.init?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({
        gateExempt: true,
      });
    });
  });

  it('標記欄拼合 marker 聚合與錨點彙總，全零顯示 —', async () => {
    renderOverview(new Map([['history/ch1/arc1/s1', 3]]));
    await screen.findByText('第一章');

    expect(screen.getByText('⚑3')).toBeInTheDocument();
    expect(screen.getByText('♪2')).toBeInTheDocument();
    // visual clue 用 start 當代表，end 是配對閉合不另計
    expect(screen.getByText('◈1')).toBeInTheDocument();
  });

  it('搜尋過濾標題與頁面 id', async () => {
    renderOverview();
    await screen.findByText('第一章');

    fireEvent.change(screen.getByPlaceholderText('搜尋標題、頁面 id…'), {
      target: { value: '01-01' },
    });
    expect(screen.queryByText('第一章')).not.toBeInTheDocument();
    expect(screen.getByText('01-01')).toBeInTheDocument();
  });
});
