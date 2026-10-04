import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl, getProjects, t } from './api';

describe('assetUrl', () => {
  const base = 'http://localhost:8788/api/root/assets';

  it('空值回傳空字串', () => {
    expect(assetUrl(null)).toBe('');
    expect(assetUrl(undefined)).toBe('');
    expect(assetUrl('')).toBe('');
  });

  it('完整 URL 原樣回傳', () => {
    const url = 'https://example.com/images/demo.png';
    expect(assetUrl(url)).toBe(url);
  });

  it('裸 R2 key 會轉成 root assets URL 並逐段 encode', () => {
    expect(
      assetUrl('images/projects/LBN 大巨巢系統模擬/Admin Screen.png')
    ).toBe(
      `${base}/images/projects/LBN%20%E5%A4%A7%E5%B7%A8%E5%B7%A2%E7%B3%BB%E7%B5%B1%E6%A8%A1%E6%93%AC/Admin%20Screen.png`
    );
  });

  it('舊 public /images 路徑會正規化為 R2 key', () => {
    expect(assetUrl('/images/projects/demo.png')).toBe(
      `${base}/images/projects/demo.png`
    );
  });

  it('/api/root/assets 前綴不會被重複套用', () => {
    expect(assetUrl('/api/root/assets/images/projects/demo.png')).toBe(
      `${base}/images/projects/demo.png`
    );
  });

  it('已 encode 的 key 不會被雙重 encode', () => {
    expect(
      assetUrl('/api/root/assets/images%2Fprojects%2Fdemo%20image.png')
    ).toBe(`${base}/images/projects/demo%20image.png`);
  });
});

describe('t', () => {
  const item = {
    titleZh: '繁中標題',
    titleEn: 'English title',
    descZh: '繁中描述',
    descEn: 'English description',
  };

  it('依 locale 選擇標題與描述', () => {
    expect(t(item, 'zh-tw', 'title')).toBe('繁中標題');
    expect(t(item, 'en', 'title')).toBe('English title');
    expect(t(item, 'zh-tw', 'desc')).toBe('繁中描述');
    expect(t(item, 'en', 'desc')).toBe('English description');
  });
});

describe('getProjects', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(github: string | null) {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: [{ id: 'p', isPrivateRepo: true, links: { github } }],
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('帶 token 時送出 Authorization，且不與公開讀取共用快取', async () => {
    const base = 'http://api.test-get-projects';

    const publicFetch = stubFetch(null);
    const publicResult = await getProjects(base);
    expect(publicResult[0].links.github).toBeNull();
    const publicInit = publicFetch.mock.calls[0] as unknown[];
    expect(publicInit[1]).toBeUndefined();

    const adminFetch = stubFetch('https://github.com/example/secret');
    const adminResult = await getProjects(base, 'admin-jwt');
    expect(adminFetch).toHaveBeenCalledTimes(1);
    const [url, init] = adminFetch.mock.calls[0] as unknown as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(url).toBe(`${base}/api/root/projects`);
    expect(new Headers(init.headers).get('Authorization')).toBe(
      'Bearer admin-jwt'
    );
    expect(adminResult[0].links.github).toBe(
      'https://github.com/example/secret'
    );

    // 公開讀取仍命中先前的公開快取，不會拿到管理員的完整資料
    const afterFetch = stubFetch('https://github.com/example/leak');
    const again = await getProjects(base);
    expect(afterFetch).not.toHaveBeenCalled();
    expect(again[0].links.github).toBeNull();
  });
});
