import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { useEntityRevisionGates } from '../useEntityRevisionGates';

/**
 * 實體 revision 條件捷徑的取數測試。
 *
 * 最重要的一條是「dossier 優先於 browser」——同一個 key 兩邊都有條目時
 * 若取錯來源，編輯者套到的會是詳細內容那條鏈的條件，與權威來源不一致。
 */

const ENTRIES = [
  {
    stack: 'browser',
    entityKey: 'turncoat',
    revisionGates: [
      { id: 'turncoat:browser', gate: { requiresFlags: ['wrong'] } },
    ],
  },
  {
    stack: 'dossier',
    entityKey: 'turncoat',
    revisionGates: [
      { id: 'turncoat:01', gate: { requiresFlags: ['turncoat:met'] } },
      { id: 'turncoat:02', gate: { requiresFlags: ['turncoat:turned'] } },
      // 無條件的 revision 沒有可套用的東西
      { id: 'turncoat:base', gate: null },
    ],
  },
  {
    stack: 'dossier',
    entityKey: 'other',
    revisionGates: [{ id: 'other:01', gate: { requiresFlags: ['nope'] } }],
  },
];

function stubFetch(ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok,
        json: () => Promise.resolve({ ok, data: { entries: ENTRIES } }),
      })
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useEntityRevisionGates', () => {
  it('只回該 entityKey 的 revision 條件，並跳過無條件的', async () => {
    stubFetch();
    const { result } = renderHook(() => useEntityRevisionGates('', 'turncoat'));
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.map((g) => g.id)).toEqual([
      'turncoat:01',
      'turncoat:02',
    ]);
  });

  it('dossier 優先於 browser——不混用兩條鏈', async () => {
    stubFetch();
    const { result } = renderHook(() => useEntityRevisionGates('', 'turncoat'));
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
    expect(result.current.some((g) => g.id === 'turncoat:browser')).toBe(false);
  });

  it('未填 entityKey 時不發請求', () => {
    stubFetch();
    const { result } = renderHook(() => useEntityRevisionGates('', undefined));
    expect(result.current).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('取數失敗時靜默回空陣列', async () => {
    stubFetch(false);
    const { result } = renderHook(() => useEntityRevisionGates('', 'turncoat'));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
