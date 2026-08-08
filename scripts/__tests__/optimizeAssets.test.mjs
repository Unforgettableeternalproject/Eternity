import { describe, it, expect } from 'vitest';
import {
  normalizeKey,
  assetPath,
  collectKeys,
  planFor,
  rewriteHtml,
} from '../optimize-assets-utils.mjs';

/**
 * 這些函式決定「哪個 R2 檔案對應內容裡的哪個標籤」。
 * 對錯一個字元的後果是：改寫不到（舊檔被刪但引用還在 → 破圖），
 * 或改寫到不該動的東西。中文路徑的 encode 差異是最容易出錯的地方。
 */

const GIF = 'images/projects/U.E.P 個人虛擬桌面助理/data_processing.gif';
const ENCODED =
  '/images/projects/U.E.P%20%E5%80%8B%E4%BA%BA%E8%99%9B%E6%93%AC%E6%A1%8C%E9%9D%A2%E5%8A%A9%E7%90%86/data_processing.gif';

describe('normalizeKey', () => {
  it('裸 key 原樣通過', () => {
    expect(normalizeKey(GIF)).toBe(GIF);
  });

  it('D1 content 裡的 encoded 本地路徑還原成裸 key', () => {
    expect(normalizeKey(ENCODED)).toBe(GIF);
  });

  it('/api/root/assets/ 前綴的 canonical 路徑還原成裸 key', () => {
    expect(normalizeKey(`/api/root/assets/${encodeURI(GIF)}`)).toBe(GIF);
  });

  it('指向本站資產端點的絕對 URL 還原成裸 key', () => {
    expect(
      normalizeKey(
        `https://example.workers.dev/api/root/assets/${encodeURI(GIF)}`
      )
    ).toBe(GIF);
  });

  it('外部圖床的絕對 URL 不算 R2 資產', () => {
    // 剝掉 origin 後長得跟 key 一樣，但它不是我們的檔案——誤判會導致誤刪
    expect(normalizeKey('https://i.ibb.co/4t3ZsgP/2024-12-25-172521.png')).toBe(
      ''
    );
    expect(normalizeKey('https://i.imgur.com/images/a.png')).toBe('');
  });

  it('外部 URL 即使路徑與真實 key 相同也不算', () => {
    expect(normalizeKey(`https://evil.example.com/${GIF}`)).toBe('');
  });

  it('已解碼的中文路徑不會被 decodeURIComponent 弄壞', () => {
    const key = 'images/projects/一添綠意 - 茶飲電子商務平台/001.png';
    expect(normalizeKey(key)).toBe(key);
  });

  it('含 % 但不是合法 encoding 的檔名不拋錯', () => {
    expect(normalizeKey('images/100%-done.png')).toBe('images/100%-done.png');
  });

  it('空值回空字串而非拋錯', () => {
    expect(normalizeKey(null)).toBe('');
    expect(normalizeKey(undefined)).toBe('');
  });
});

describe('assetPath', () => {
  it('逐段 encode，斜線不被吃掉', () => {
    expect(assetPath('images/a b/c.png')).toBe(
      '/api/root/assets/images/a%20b/c.png'
    );
  });

  it('與 normalizeKey 互為反向', () => {
    expect(normalizeKey(assetPath(GIF))).toBe(GIF);
  });
});

describe('collectKeys', () => {
  it('同時收集 image 欄位與兩種語言的 content', () => {
    const keys = collectKeys({
      image: 'images/projects/demo/cover.png',
      contentZh: `<p><img src="${ENCODED}"></p>`,
      contentEn: '<p><img src="/images/projects/demo/en.png"></p>',
    });
    expect([...keys.keys()].sort()).toEqual(
      [
        GIF,
        'images/projects/demo/cover.png',
        'images/projects/demo/en.png',
      ].sort()
    );
  });

  it('同一 key 出現在多個欄位時合併來源', () => {
    const keys = collectKeys({
      image: 'images/a.png',
      contentZh: '<img src="/images/a.png">',
    });
    expect([...keys.get('images/a.png')].sort()).toEqual([
      'contentZh',
      'image',
    ]);
  });

  it('沒有圖片的專案回空 Map', () => {
    expect(collectKeys({ contentZh: '<p>純文字</p>' }).size).toBe(0);
  });
});

describe('planFor', () => {
  it('小於門檻不處理', () => {
    expect(planFor('a.png', 100 * 1024, 150)).toBeNull();
  });

  it('GIF 轉 MP4', () => {
    const plan = planFor(GIF, 12 * 1024 * 1024, 150);
    expect(plan.kind).toBe('gif→mp4');
    expect(plan.newKey).toBe(GIF.replace(/\.gif$/, '.mp4'));
    expect(plan.contentType).toBe('video/mp4');
  });

  it('PNG／JPEG 轉 WebP', () => {
    expect(planFor('a/b.png', 999 * 1024, 150).newKey).toBe('a/b.webp');
    expect(planFor('a/b.jpg', 999 * 1024, 150).newKey).toBe('a/b.webp');
    expect(planFor('a/b.jpeg', 999 * 1024, 150).newKey).toBe('a/b.webp');
  });

  it('已經是輕量格式的不再處理（冪等）', () => {
    expect(planFor('a/b.webp', 999 * 1024, 150)).toBeNull();
    expect(planFor('a/b.mp4', 999 * 1024, 150)).toBeNull();
  });

  it('副檔名大小寫不影響判斷', () => {
    expect(planFor('a/B.PNG', 999 * 1024, 150).newKey).toBe('a/B.webp');
  });

  it('不認得的格式一律不動（svg、ico）', () => {
    expect(planFor('a/b.svg', 999 * 1024, 150)).toBeNull();
    expect(planFor('a/b.ico', 999 * 1024, 150)).toBeNull();
  });
});

describe('rewriteHtml', () => {
  it('圖片轉圖片只換 src，其餘屬性保留', () => {
    const html = '<p><img src="/images/a.png" alt="說明" class="x"></p>';
    const { html: out, changed } = rewriteHtml(
      html,
      'images/a.png',
      'images/a.webp',
      false
    );
    expect(changed).toBe(1);
    expect(out).toContain('src="/api/root/assets/images/a.webp"');
    expect(out).toContain('alt="說明"');
    expect(out).toContain('class="x"');
  });

  it('轉影片時整個 img 標籤換成 video', () => {
    const html = `<p><img src="${ENCODED}" alt=""></p>`;
    const { html: out, changed } = rewriteHtml(
      html,
      GIF,
      GIF.replace('.gif', '.mp4'),
      true
    );
    expect(changed).toBe(1);
    expect(out).not.toContain('<img');
    expect(out).toContain('<video');
    expect(out).toContain('autoplay loop muted playsinline');
  });

  it('不動其他圖片', () => {
    const html = '<img src="/images/a.png"><img src="/images/b.png">';
    const { html: out, changed } = rewriteHtml(
      html,
      'images/a.png',
      'images/a.webp',
      false
    );
    expect(changed).toBe(1);
    expect(out).toContain('/images/b.png');
  });

  it('同一張圖出現多次全部改寫', () => {
    const html =
      '<img src="/images/a.png"><p>中間</p><img src="/images/a.png">';
    const { changed } = rewriteHtml(
      html,
      'images/a.png',
      'images/a.webp',
      false
    );
    expect(changed).toBe(2);
  });

  it('已改寫過的內容再跑一次不會重複改（冪等）', () => {
    const first = rewriteHtml(
      '<img src="/images/a.png">',
      'images/a.png',
      'images/a.webp',
      false
    );
    const second = rewriteHtml(
      first.html,
      'images/a.png',
      'images/a.webp',
      false
    );
    expect(second.changed).toBe(0);
    expect(second.html).toBe(first.html);
  });

  it('空內容不拋錯', () => {
    expect(rewriteHtml('', 'a', 'b', false).changed).toBe(0);
    expect(rewriteHtml(null, 'a', 'b', false).changed).toBe(0);
  });
});
