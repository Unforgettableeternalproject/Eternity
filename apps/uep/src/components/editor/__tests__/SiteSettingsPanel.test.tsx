/**
 * SiteSettingsPanel 測試
 *
 * 重點契約：走同源 proxy、儲存只送改過的鍵（PUT 是局部更新）、
 * 數字欄清空時不可儲存（NaN 不送出）。
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import SiteSettingsPanel from '../SiteSettingsPanel';

const SETTINGS = {
  'protection.mode': 'env',
  'bookmark.baseChancePct': 20,
  'note.max': 30,
  'note.textMax': 200,
};

function mockApi() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/settings' && init?.method === 'PUT') {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: { settings: { ...SETTINGS, ...patch } },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ ok: true, data: { settings: SETTINGS } }),
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls };
}

describe('SiteSettingsPanel', () => {
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    ({ calls } = mockApi());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('掛載時透過同源 proxy 載入設定並填入表單', async () => {
    render(<SiteSettingsPanel />);
    await screen.findByLabelText('數量上限');
    expect(calls[0]?.url).toBe('/api/settings');
    expect(screen.getByLabelText('數量上限')).toHaveValue(30);
    expect(screen.getByRole('radio', { name: /跟隨環境/ })).toBeChecked();
  });

  it('沒有變更時儲存按鈕停用', async () => {
    render(<SiteSettingsPanel />);
    await screen.findByLabelText('數量上限');
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
  });

  it('儲存只送改過的鍵', async () => {
    render(<SiteSettingsPanel />);
    const input = await screen.findByLabelText('數量上限');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      const put = calls.find(
        (c) => c.url === '/api/settings' && c.init?.method === 'PUT'
      );
      expect(put).toBeDefined();
      expect(JSON.parse(String(put!.init!.body))).toEqual({ 'note.max': 12 });
    });
    // 儲存成功後回到乾淨狀態
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled()
    );
  });

  it('切換保護模式後可儲存，PUT 帶三態值', async () => {
    render(<SiteSettingsPanel />);
    await screen.findByLabelText('數量上限');
    fireEvent.click(screen.getByRole('radio', { name: /恆關/ }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      const put = calls.find(
        (c) => c.url === '/api/settings' && c.init?.method === 'PUT'
      );
      expect(JSON.parse(String(put!.init!.body))).toEqual({
        'protection.mode': 'never',
      });
    });
  });

  it('數字欄清空（NaN）時儲存停用，不會送出壞值', async () => {
    render(<SiteSettingsPanel />);
    const input = await screen.findByLabelText('數量上限');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
  });
});
