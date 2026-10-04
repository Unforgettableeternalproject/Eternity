/* global RequestInit */
import { describe, expect, it, vi } from 'vitest';

import {
  adminAuthHeaders,
  isRedactedMetadata,
  loadAdminEditPage,
  REDACTED_STUB_ERROR,
  redactedSaveBlock,
} from './adminPageRead';

/**
 * 後台編輯頁 SSR 直連 content-api：必須以管理員身分讀取，否則封存頁會拿到
 * 存根（空標題、空 content），編輯器用它初始化後存檔會把原內容覆蓋成空。
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FULL_PAGE = {
  id: 'history/vol-1/sealed',
  title: '封存章節',
  content: [{ id: 'content', type: 'rich_text', content: '<p>原文</p>' }],
  metadata: { locked: true, icon: '❒' },
};

const STUB_PAGE = {
  id: 'history/vol-1/sealed',
  title: '',
  content: [],
  metadata: { locked: true, redacted: true },
};

describe('adminAuthHeaders', () => {
  it('有 JWT 時組出 Bearer header', () => {
    expect(adminAuthHeaders('tok')).toEqual({ Authorization: 'Bearer tok' });
  });

  it('沒有 JWT 時不送 Authorization', () => {
    expect(adminAuthHeaders(undefined)).toEqual({});
    expect(adminAuthHeaders('')).toEqual({});
  });
});

describe('loadAdminEditPage', () => {
  it('以 cookie 中的 JWT 當 Bearer 直連 worker 讀取單頁', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, data: FULL_PAGE })
    );
    const result = await loadAdminEditPage(
      'https://content-api.example',
      'history',
      'vol-1/sealed',
      'admin-jwt',
      fetchImpl as unknown as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://content-api.example/api/content/history/vol-1/sealed'
    );
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer admin-jwt'
    );
    expect(result).toEqual({ page: FULL_PAGE, error: null });
  });

  it('沒有 JWT 時不帶 Authorization', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, data: FULL_PAGE })
    );
    await loadAdminEditPage(
      'https://content-api.example',
      'history',
      'a',
      undefined,
      fetchImpl as unknown as typeof fetch
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('回應仍是存根時拒絕交給編輯器', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, data: STUB_PAGE })
    );
    const result = await loadAdminEditPage(
      'https://content-api.example',
      'history',
      'vol-1/sealed',
      'expired-jwt',
      fetchImpl as unknown as typeof fetch
    );
    expect(result).toEqual({ page: null, error: REDACTED_STUB_ERROR });
  });

  it('worker 回錯誤時帶出錯誤訊息', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, error: 'Page not found' })
    );
    const result = await loadAdminEditPage(
      'https://content-api.example',
      'history',
      'missing',
      'admin-jwt',
      fetchImpl as unknown as typeof fetch
    );
    expect(result).toEqual({ page: null, error: 'Page not found' });
  });

  it('非 JSON 回應視為 API 不可用', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html></html>', {
          headers: { 'Content-Type': 'text/html' },
        })
    );
    const result = await loadAdminEditPage(
      'https://content-api.example',
      'history',
      'a',
      'admin-jwt',
      fetchImpl as unknown as typeof fetch
    );
    expect(result.page).toBeNull();
    expect(result.error).toMatch(/non-JSON/);
  });
});

describe('存根保護網', () => {
  it('isRedactedMetadata 只認 redacted === true', () => {
    expect(isRedactedMetadata({ redacted: true })).toBe(true);
    expect(isRedactedMetadata({ redacted: 'true' })).toBe(false);
    expect(isRedactedMetadata({ locked: true })).toBe(false);
    expect(isRedactedMetadata(null)).toBe(false);
    expect(isRedactedMetadata(undefined)).toBe(false);
    expect(isRedactedMetadata([])).toBe(false);
  });

  it('開頁或存檔前重讀任一為存根即擋下存檔', () => {
    expect(redactedSaveBlock(STUB_PAGE.metadata, FULL_PAGE.metadata)).toBe(
      REDACTED_STUB_ERROR
    );
    expect(redactedSaveBlock(FULL_PAGE.metadata, STUB_PAGE.metadata)).toBe(
      REDACTED_STUB_ERROR
    );
    expect(redactedSaveBlock(FULL_PAGE.metadata, null)).toBeNull();
    expect(redactedSaveBlock(undefined, FULL_PAGE.metadata)).toBeNull();
  });
});
