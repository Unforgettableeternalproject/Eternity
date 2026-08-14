import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetZoneProgressTreeCacheForTest,
  fetchZoneProgressTree,
} from '../zoneProgressTree';

function treeResponse() {
  return {
    ok: true,
    json: async () => ({ ok: true, data: [] }),
  } as Response;
}

describe('fetchZoneProgressTree', () => {
  beforeEach(() => {
    _resetZoneProgressTreeCacheForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('成功結果以 promise 快取，避免同 zone 重複請求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(treeResponse());
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchZoneProgressTree('echoes');
    const second = fetchZoneProgressTree('echoes');

    expect(second).toBe(first);
    await expect(first).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tree 請求失敗時拋出，讓 entity 可見性 fail-closed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce(treeResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchZoneProgressTree('echoes')).rejects.toThrow('HTTP 503');
    // 失敗不快取；下一次啟用 entity 時可重新取得 tree。
    await expect(fetchZoneProgressTree('echoes')).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('payload 不合法時同樣拒絕顯示，不降級成 per-page gate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, data: null }),
      } as Response)
    );

    await expect(fetchZoneProgressTree('visuals')).rejects.toThrow(
      'bad payload'
    );
  });
});
