/**
 * Echoes／Visuals 子分類編輯器拖曳排序
 *
 * 拖曳只改編輯器暫存的順序並標記未儲存；按下儲存才以批次排序端點
 * 一次送出最終順序。失敗時提示、維持未儲存並保留暫存順序以便重試；
 * 拖回與伺服器一致的順序即清除未儲存。
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useCallback, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import EchoesSubcatEditor from '../EchoesSubcatEditor';
import VisualsSubcatEditor from '../VisualsSubcatEditor';
import { commitPendingReorder, type PendingReorder } from '../editorHelpers';

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

function treeFor(area: string, pageType: string, slugs = ['a', 'b', 'c']) {
  const parent = `${area}/cat`;
  return [
    {
      id: parent,
      title: 'cat',
      pageType: 'subcategory',
      sortOrder: 0,
      children: slugs.map((s, i) => ({
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

/**
 * 依 RichEditor 的接法包住子分類編輯器：暫存排序由上層持有，
 * 儲存成功才清除並重抓列表，失敗則保留暫存。
 */
function Harness({
  Editor,
  area,
}: {
  Editor: typeof EchoesSubcatEditor;
  area: string;
}) {
  const parentId = `${area}/cat`;
  const [pending, setPending] = useState<PendingReorder | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const onPendingOrderChange = useCallback(
    (order: string[] | null) => setPending(order ? { parentId, order } : null),
    [parentId]
  );
  const save = async () => {
    if (!pending) return;
    const committed = pending;
    const ok = await commitPendingReorder('', area, committed);
    if (ok) setPending((cur) => (cur === committed ? null : cur));
    setRefreshKey((k) => k + 1);
  };
  return (
    <>
      <Editor
        area={area}
        apiBase=""
        pageId={parentId}
        pageSlug="cat"
        accent="#fff"
        onDirty={() => {}}
        refreshKey={refreshKey}
        pendingOrder={pending?.order ?? null}
        onPendingOrderChange={onPendingOrderChange}
      />
      <span data-testid="dirty">{pending ? 'modified' : 'saved'}</span>
      <button type="button" onClick={() => void save()}>
        儲存
      </button>
    </>
  );
}

const rowTitles = () =>
  rows().map((r) => r.querySelector('.ned-subcat-song-title')?.textContent);

describe.each(cases)('$name 拖曳排序', ({ area, pageType, Editor }) => {
  function setup(reorderResponse: () => Promise<Response>) {
    const slugs = ['a', 'b', 'c'];
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/api/content/${area}/tree`)) {
        return new Response(
          JSON.stringify({ ok: true, data: treeFor(area, pageType, slugs) })
        );
      }
      // 新增子頁：之後的 tree 多一筆 d，排在伺服器尾端
      if (
        url.endsWith(`/api/content/${area}/cat/d`) &&
        init?.method === 'PUT'
      ) {
        slugs.push('d');
        return new Response(JSON.stringify({ ok: true }));
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

    render(<Harness Editor={Editor} area={area} />);
  }

  const reorderCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/reorder'));
  const treeCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/tree'));
  const dirty = () => screen.getByTestId('dirty').textContent;
  const clickSave = () =>
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

  it('拖放只暫存順序並標記未儲存，不打 API', async () => {
    setup(async () => new Response(JSON.stringify({ ok: true, data: {} })));
    await screen.findByText('T-c');

    const dt = dragRow(2, 0);
    expect(dt.setData).toHaveBeenCalled();
    expect(dt.setDragImage).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(dirty()).toBe('modified'));
    expect(rowTitles()).toEqual(['T-c', 'T-a', 'T-b']);
    await new Promise((r) => setTimeout(r, 0));
    expect(reorderCalls()).toHaveLength(0);
    expect(treeCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method)).toHaveLength(0);
  });

  it('儲存時只呼叫一次批次端點，帶最終順序並清除未儲存', async () => {
    setup(async () => new Response(JSON.stringify({ ok: true, data: {} })));
    await screen.findByText('T-c');

    dragRow(2, 0);
    dragRow(2, 1);
    await waitFor(() => expect(rowTitles()).toEqual(['T-c', 'T-b', 'T-a']));
    expect(reorderCalls()).toHaveLength(0);

    clickSave();

    await waitFor(() => expect(dirty()).toBe('saved'));
    expect(reorderCalls()).toHaveLength(1);
    const [, init] = reorderCalls()[0];
    expect(JSON.parse(String(init.body))).toEqual({
      parentId: `${area}/cat`,
      order: [`${area}/cat/c`, `${area}/cat/b`, `${area}/cat/a`],
    });
    // 不再有逐筆 PUT
    expect(
      fetchMock.mock.calls.filter(
        ([url, i]) => i?.method === 'PUT' && !String(url).endsWith('/reorder')
      )
    ).toHaveLength(0);
    // 成功後重抓列表對齊伺服器
    await waitFor(() => expect(treeCalls()).toHaveLength(2));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('伺服器回 ok:false → 提示錯誤、維持未儲存並保留暫存順序，可重試', async () => {
    setup(
      async () =>
        new Response(JSON.stringify({ ok: false, error: '不屬於該層' }), {
          status: 400,
        })
    );
    await screen.findByText('T-c');

    dragRow(0, 2);
    await waitFor(() => expect(dirty()).toBe('modified'));
    clickSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0][0]).toContain('不屬於該層');
    await waitFor(() => expect(treeCalls()).toHaveLength(2));
    expect(dirty()).toBe('modified');
    expect(rowTitles()).toEqual(['T-b', 'T-c', 'T-a']);

    clickSave();
    await waitFor(() => expect(reorderCalls()).toHaveLength(2));
    const [, init] = reorderCalls()[1];
    expect(JSON.parse(String(init.body)).order).toEqual([
      `${area}/cat/b`,
      `${area}/cat/c`,
      `${area}/cat/a`,
    ]);
  });

  it('網路錯誤 → 提示錯誤並維持未儲存', async () => {
    setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    await screen.findByText('T-c');

    dragRow(1, 0);
    await waitFor(() => expect(dirty()).toBe('modified'));
    clickSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(treeCalls()).toHaveLength(2));
    expect(dirty()).toBe('modified');
    expect(rowTitles()).toEqual(['T-b', 'T-a', 'T-c']);
  });

  it('暫存期間新增子頁 → 保留暫存順序並把新項目接在尾端', async () => {
    setup(async () => new Response(JSON.stringify({ ok: true })));
    await screen.findByText('T-c');

    dragRow(2, 0);
    await waitFor(() => expect(dirty()).toBe('modified'));

    fireEvent.click(screen.getByRole('button', { name: /^\+ 新增/ }));
    const input = document.querySelector<HTMLInputElement>(
      '.ned-subcat-add-input'
    )!;
    fireEvent.change(input, { target: { value: 'd' } });
    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await screen.findByText('T-d');
    expect(rowTitles()).toEqual(['T-c', 'T-a', 'T-b', 'T-d']);
    expect(dirty()).toBe('modified');
    expect(reorderCalls()).toHaveLength(0);

    clickSave();
    await waitFor(() => expect(reorderCalls()).toHaveLength(1));
    const [, init] = reorderCalls()[0];
    expect(JSON.parse(String(init.body)).order).toEqual([
      `${area}/cat/c`,
      `${area}/cat/a`,
      `${area}/cat/b`,
      `${area}/cat/d`,
    ]);
  });

  it('拖回原位 → 清除未儲存且不打 API', async () => {
    setup(async () => new Response(JSON.stringify({ ok: true })));
    await screen.findByText('T-c');

    dragRow(2, 0);
    await waitFor(() => expect(dirty()).toBe('modified'));
    dragRow(0, 2);
    await waitFor(() => expect(dirty()).toBe('saved'));
    expect(rowTitles()).toEqual(['T-a', 'T-b', 'T-c']);

    dragRow(1, 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(dirty()).toBe('saved');
    expect(reorderCalls()).toHaveLength(0);
  });
});
