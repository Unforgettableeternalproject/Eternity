/**
 * `readContentOrThrow` — 文件站頁面讀取（sync-utils.mjs）
 *
 * 清單／單頁讀取失敗時曾經回 `[]`／`null`，被當成「這一端沒有資料」，
 * 差異表接著要求整份覆蓋。content-api 對未認證的 `include_deleted=true`
 * 回 401，這條路徑一定要中止，而且訊息要指出是缺認證還是 token 被拒。
 */
import { describe, it, expect, vi } from 'vitest';

import { readContentOrThrow } from '../sync-utils.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('readContentOrThrow', () => {
  it('成功時回傳 data，並帶上認證 header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: true, data: [1] }));
    const data = await readContentOrThrow('http://x/api/content/a', {
      headers: { Authorization: 'Bearer t' },
      what: '清單',
      fetchImpl,
    });
    expect(data).toEqual([1]);
    expect(fetchImpl).toHaveBeenCalledWith('http://x/api/content/a', {
      headers: { Authorization: 'Bearer t' },
    });
  });

  it('未帶認證遇 401：丟錯並提示設定 API_TOKEN（含 dry-run）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: false }, 401));
    await expect(
      readContentOrThrow('http://x', { what: '清單', fetchImpl })
    ).rejects.toThrow(/未帶認證.*API_TOKEN.*dry-run/s);
  });

  it('帶認證仍 401：丟錯並指出 token 被拒', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ ok: false }, 401));
    await expect(
      readContentOrThrow('http://x', {
        headers: { Authorization: 'Bearer bad' },
        what: '清單',
        fetchImpl,
      })
    ).rejects.toThrow(/token 被拒絕/);
  });

  it('其他非 ok 狀態、非 JSON、連線失敗一律丟錯，不回空值', async () => {
    await expect(
      readContentOrThrow('http://x', {
        what: '頁面',
        fetchImpl: vi.fn().mockResolvedValue(json({ ok: false }, 500)),
      })
    ).rejects.toThrow(/HTTP 500/);
    await expect(
      readContentOrThrow('http://x', {
        what: '頁面',
        fetchImpl: vi.fn().mockResolvedValue(new Response('<html>')),
      })
    ).rejects.toThrow(/不是預期的 JSON/);
    await expect(
      readContentOrThrow('http://x', {
        what: '頁面',
        fetchImpl: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      })
    ).rejects.toThrow(/無法連線/);
  });
});
