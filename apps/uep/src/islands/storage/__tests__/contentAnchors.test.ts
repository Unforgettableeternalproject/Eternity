/**
 * contentAnchors 工具測試（S9-A.3）
 *
 * 純 DOM 操作，用 jsdom 建假容器直接測。
 * 覆蓋：ensureContentAnchors id 分配、冪等；findNearestAnchor 命中 + 最近鄰；
 * resolveAnchorRect 容錯鏈四層（exact / nearest / top / fixed）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  ANCHOR_ATTR,
  ensureContentAnchors,
  findNearestAnchor,
  parseAnchorId,
  resolveAnchorRect,
} from '../contentAnchors';

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

/* ────────────────────────────────────────
 * ensureContentAnchors
 * ──────────────────────────────────────── */

describe('ensureContentAnchors', () => {
  it('對段落層級元素補 data-uep-anchor-id，格式 {tag}-{同 tag 序號}', () => {
    root.innerHTML = `
      <h2>標題一</h2>
      <p>段落一</p>
      <p>段落二</p>
      <h3>子標題</h3>
      <p>段落三</p>
      <blockquote>引言</blockquote>
    `;
    ensureContentAnchors(root);
    const anchors = Array.from(
      root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`)
    ).map((el) => el.getAttribute(ANCHOR_ATTR));
    expect(anchors).toEqual([
      'h2-0',
      'p-0',
      'p-1',
      'h3-0',
      'p-2',
      'blockquote-0',
    ]);
  });

  it('冪等：已有 anchorId 的元素不重寫（避免同次 render 內覆蓋）', () => {
    root.innerHTML = `<p data-uep-anchor-id="p-legacy">既有</p><p>新增</p>`;
    ensureContentAnchors(root);
    const anchors = Array.from(
      root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`)
    ).map((el) => el.getAttribute(ANCHOR_ATTR));
    // 第一個保留 legacy 值；第二個從 idx=1 開始（因為第一個已佔用 idx=0）
    expect(anchors[0]).toBe('p-legacy');
    expect(anchors[1]).toBe('p-1');
  });

  it('null root 靜默忽略，不噴錯', () => {
    expect(() => ensureContentAnchors(null)).not.toThrow();
  });

  it('選擇器只覆蓋段落層級（不掃 div/span 等）', () => {
    root.innerHTML = `<div>不算</div><span>不算</span><p>算</p>`;
    ensureContentAnchors(root);
    expect(root.querySelectorAll(`[${ANCHOR_ATTR}]`)).toHaveLength(1);
    expect(root.querySelector('p')?.getAttribute(ANCHOR_ATTR)).toBe('p-0');
  });

  it('img / figure / li 也是錨點目標', () => {
    root.innerHTML = `
      <ul><li>項一</li><li>項二</li></ul>
      <figure><img src="a.png" alt=""/></figure>
    `;
    ensureContentAnchors(root);
    expect(
      root.querySelectorAll(`[${ANCHOR_ATTR}]`).length
    ).toBeGreaterThanOrEqual(4);
  });
});

/* ────────────────────────────────────────
 * findNearestAnchor
 * ──────────────────────────────────────── */

describe('findNearestAnchor', () => {
  /**
   * jsdom 的 getBoundingClientRect 全回 0——我們手動 patch 每個元素的
   * rect，模擬三段垂直排列的段落：
   *  p-0：y=0-50
   *  p-1：y=100-150
   *  p-2：y=200-250
   * 寬度都是 0-300。
   */
  function stubRects(
    pages: Array<{ el: HTMLElement; top: number; bottom: number }>
  ) {
    pages.forEach(({ el, top, bottom }) => {
      el.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 300,
          top,
          bottom,
          width: 300,
          height: bottom - top,
          x: 0,
          y: top,
          toJSON: () => {},
        }) as DOMRect;
    });
  }

  it('drop 點落在某錨點內 → 直接命中該錨點', () => {
    root.innerHTML = `<p>一</p><p>二</p><p>三</p>`;
    ensureContentAnchors(root);
    const [p0, p1, p2] = Array.from(root.querySelectorAll('p'));
    stubRects([
      { el: p0, top: 0, bottom: 50 },
      { el: p1, top: 100, bottom: 150 },
      { el: p2, top: 200, bottom: 250 },
    ]);

    // 落在 p-1 內部
    const hit = findNearestAnchor(root, 150, 120);
    expect(hit).not.toBeNull();
    // elementFromPoint 在 jsdom 可能回 null——這裡即使走 fallback（掃全部找最近），
    // p-1 也仍是最近（距離 0）
    expect(hit!.anchorId).toBe('p-1');
    expect(hit!.offsetY).toBe(20); // 120 - 100
  });

  it('drop 點在錨點之間 → 找距離最近的（曼哈頓距離）', () => {
    root.innerHTML = `<p>一</p><p>二</p><p>三</p>`;
    ensureContentAnchors(root);
    const [p0, p1, p2] = Array.from(root.querySelectorAll('p'));
    stubRects([
      { el: p0, top: 0, bottom: 50 },
      { el: p1, top: 100, bottom: 150 },
      { el: p2, top: 200, bottom: 250 },
    ]);

    // y=75 落在 p-0 (bottom=50) 與 p-1 (top=100) 之間，距 p-1 較近
    const hit = findNearestAnchor(root, 150, 80);
    expect(hit!.anchorId).toBe('p-1');
  });

  it('root 為 null 或內部無錨點 → 回 null', () => {
    expect(findNearestAnchor(null, 0, 0)).toBeNull();
    // root 存在但無錨點
    expect(findNearestAnchor(root, 100, 100)).toBeNull();
  });
});

/* ────────────────────────────────────────
 * resolveAnchorRect + parseAnchorId
 * ──────────────────────────────────────── */

describe('parseAnchorId', () => {
  it('解析合法錨點 id', () => {
    expect(parseAnchorId('p-3')).toEqual({ tag: 'p', idx: 3 });
    expect(parseAnchorId('h2-0')).toEqual({ tag: 'h2', idx: 0 });
    expect(parseAnchorId('blockquote-12')).toEqual({
      tag: 'blockquote',
      idx: 12,
    });
  });

  it('格式不合回 null', () => {
    expect(parseAnchorId('legacy-id')).toBeNull(); // idx 段必須是純數字，'id' 不合
    expect(parseAnchorId('nothing')).toBeNull();
    expect(parseAnchorId('')).toBeNull();
    expect(parseAnchorId('p-')).toBeNull();
    expect(parseAnchorId('-3')).toBeNull();
  });
});

describe('resolveAnchorRect 容錯鏈', () => {
  beforeEach(() => {
    root.innerHTML = `<p>一</p><p>二</p><p>三</p><h2>標題</h2>`;
    ensureContentAnchors(root);
  });

  it('exact：找到原元素', () => {
    const res = resolveAnchorRect(root, 'p-1');
    expect(res.kind).toBe('exact');
    expect(res.element).toBe(root.querySelectorAll('p')[1]);
  });

  it('nearest：原元素消失時退用同 tag idx 最近者', () => {
    // 刪掉 p-2 → 找 p-2 時應退到 p-1 或 p-0（距離最近）
    root.querySelectorAll('p')[2].remove();
    const res = resolveAnchorRect(root, 'p-2');
    expect(res.kind).toBe('nearest');
    // p-1 idx=1，跟目標 p-2 差 1；p-0 差 2 → 應選 p-1
    expect(res.element?.getAttribute(ANCHOR_ATTR)).toBe('p-1');
  });

  it('top：同 tag 完全沒有 → 退容器頂端', () => {
    // 找一個不存在的 tag
    const res = resolveAnchorRect(root, 'article-0');
    expect(res.kind).toBe('top');
    expect(res.element).toBeNull();
    expect(res.rect).not.toBeNull();
  });

  it('fixed：root 為 null → 呼叫端要退 fixed page 級', () => {
    const res = resolveAnchorRect(null, 'p-0');
    expect(res.kind).toBe('fixed');
    expect(res.rect).toBeNull();
    expect(res.element).toBeNull();
  });

  it('anchorId 格式不合 + 元素也不存在 → top', () => {
    const res = resolveAnchorRect(root, 'garbled');
    expect(res.kind).toBe('top');
  });
});
