/**
 * HomepageEditor 存根保護網：讀到 content-api 的存根（metadata.redacted）或
 * 載入失敗時，絕不可進入可存檔狀態——否則存檔會把原內容覆蓋成空。
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REDACTED_STUB_ERROR } from '../../../lib/adminPageRead';
import HomepageEditor from '../homepage/HomepageEditor';

const originalFetch = globalThis.fetch;

function mockFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function renderEditor() {
  return render(
    <HomepageEditor
      area="history"
      zoneLabel="歷史典藏庫"
      zoneColor="#8A4423"
      apiBase=""
    />
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('HomepageEditor 存根保護網', () => {
  it('讀到存根時顯示錯誤並鎖住存檔', async () => {
    const calls = mockFetch({
      ok: true,
      data: {
        title: '',
        content: [],
        metadata: { locked: true, redacted: true },
      },
    });
    renderEditor();

    expect(await screen.findByText(REDACTED_STUB_ERROR)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /儲存/ })).toBeDisabled();
    expect(calls.every((c) => (c.init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('載入失敗時同樣不可存檔', async () => {
    mockFetch({ ok: false, error: 'boom' }, 500);
    renderEditor();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /儲存/ })).toBeDisabled()
    );
  });

  it('正常資料可進入可存檔狀態', async () => {
    mockFetch({
      ok: true,
      data: { title: '首頁', content: [], metadata: {} },
    });
    renderEditor();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /儲存/ })).not.toBeDisabled()
    );
  });
});
