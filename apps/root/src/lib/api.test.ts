import { describe, expect, it } from 'vitest';
import { assetUrl, t } from './api';

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
