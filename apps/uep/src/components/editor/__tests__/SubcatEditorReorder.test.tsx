/**
 * Echoes／Visuals 子分類編輯器拖曳排序
 *
 * 逐筆 PUT sortOrder 會讓後端每次重排同層、中間暫態被拉回原順序；
 * 拖放必須只打一次批次排序端點，失敗時提示並重抓列表回復伺服器狀態。
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import EchoesSubcatEditor from '../EchoesSubcatEditor';
import VisualsSubcatEditor from '../VisualsSubcatEditor';

const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

interface Case {
  name: string;
  area: string;
  pageType: string;
  Editor: typeof EchoesSubcatEditor;
}

const cases: Case[] = [
  {
    name: 'EchoesSubcatEditor',
    area: 'echoes',
    pageType: 'song',
    Editor: EchoesSubcatEditor,
  },
  {
    name: 'VisualsSubcatEditor',
    area: 'visuals',
    pageType: 'gallery',
    Editor: VisualsSubcatEditor,
  },
];

function treeFor(area: string, pageType: string) {
  const parent = `${area}/cat`;
  return [
    {
      id: parent,
      title: 'cat',
      pageType: 'subcategory',
      sortOrder: 0,
      children: ['a', 'b', 'c'].map((s, i) => ({
        id: `${parent}/${s}`,
        title: `T-${s}`,
        slug: `cat/${s}`,
        pageType,
        sortOrder: i,
        metadata: {},
        children: [],
      })),
    },
  ];
}

function fakeDataTransfer() {
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
  };
}

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.ned-subcat-song-row')
  );
}

/** 把第 from 列拖到第 to 列 */
function dragRow(from: number, to: number) {
  const dataTransfer = fakeDataTransfer();
  fireEvent.dragStart(rows()[from], { dataTransfer });
  fireEvent.dragOver(rows()[to], { dataTransfer });
  fireEvent.drop(rows()[to], { dataTransfer });
  return dataTransfer;
}

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  (window as any).__uepToastManager = toast;
  toast.error.mockReset();
});

afterEach(() => {
  delete (window as any).__uepToastManager;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe.each(cases)('$name 拖曳排序', ({ area, pageType, Editor }) => {
  function setup(reorderResponse: () => Promise<Response>) {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/api/content/${area}/tree`)) {
        return new Response(
          JSON.stringify({ ok: true, data: treeFor(area, pageType) })
        );
      }
      if (
        url.endsWith(`/api/content/${area}/reorder`) &&
        init?.method === 'PUT'
      ) {
        return reorderResponse();
      }
      return new Response(JSON.stringify({ ok: false, error: 'unexpected' }), {
        status: 500,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <Editor
        area={area}
        apiBase=""
        pageId={`${area}/cat`}
        pageSlug="cat"
        accent="#fff"
        onDirty={() => {}}
      />
    );
  }

  const reorderCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/reorder'));
  const treeCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tree'));

  it('拖放只呼叫一次批次端點，帶最終順序', async () => {
    setup(async () => new Response(JSON.stringify({ ok: true, data: {} })));
    await screen.findByText('T-c');

    const dt = dragRow(2, 0);
    expect(dt.setData).toHaveBeenCalled();
    expect(dt.setDragImage).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(treeCalls()).toHaveLength(2));
    expect(reorderCalls()).toHaveLength(1);
    const [, init] = reorderCalls()[0];
    expect(JSON.parse(String(init.body))).toEqual({
      parentId: `${area}/cat`,
      order: [`${area}/cat/c`, `${area}/cat/a`, `${area}/cat/b`],
    });
    // 不再有逐筆 PUT
    expect(
      fetchMock.mock.calls.filter(
        ([url, i]) => i?.method === 'PUT' && !String(url).endsWith('/reorder')
      )
    ).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('伺服器回 ok:false → 提示錯誤並重抓列表', async () => {
    setup(
      async () =>
        new Response(JSON.stringify({ ok: false, error: '不屬於該層' }), {
          status: 400,
        })
    );
    await screen.findByText('T-c');

    dragRow(0, 2);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toContain('不屬於該層');
    await waitFor(() => expect(treeCalls()).toHaveLength(2));
    // 重抓後回到伺服器順序
    await waitFor(() =>
      expect(rows().map((r) => r.textContent)).toEqual([
        expect.stringContaining('T-a'),
        expect.stringContaining('T-b'),
        expect.stringContaining('T-c'),
      ])
    );
  });

  it('網路錯誤 → 提示錯誤並重抓列表', async () => {
    setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    await screen.findByText('T-c');

    dragRow(1, 0);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(treeCalls()).toHaveLength(2));
  });

  it('放回原位不打 API', async () => {
    setup(async () => new Response(JSON.stringify({ ok: true })));
    await screen.findByText('T-c');

    dragRow(1, 1);

    await new Promise((r) => setTimeout(r, 0));
    expect(reorderCalls()).toHaveLength(0);
  });
});
