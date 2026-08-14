/**
 * 便條釘選 — 內容錨點工具（S9-A.3）
 *
 * 便條被拖曳釘到頁面內容時，我們需要存下「錨在哪個內容元素、偏移多少」，
 * 未來 RWD 重排 / 整頁重載也能重新定位。
 *
 * 三大 API：
 *  - `ensureContentAnchors(root)`：內容 render 後在段落層級元素補穩定 id。
 *    id 來源 = tag + 文件順序中的同 tag 序號（如 p-3、h2-1），
 *    重渲染不洗牌（除非 admin 改內容順序，那時容錯鏈接手）。
 *  - `findNearestAnchor(root, clientX, clientY)`：drop 時找最近的內容錨點，
 *    回 {anchorId, offsetX, offsetY}（釘選時存下）。
 *  - `resolveAnchorRect(root, anchorId)`：由錨點 id 解析出 DOMRect，
 *    附帶容錯鏈：元素找到 → 最近鄰同 tag → 頁首 → 無 root 退 fixed。
 *
 * 範本：History 續讀 `resolveResumeMarkerIdx` + `resolveMarkerResumeTop`
 * ——同樣的「錨定內容元素 + 索引 → 重算位置」思路。
 */

/** 便條可錨點的內容元素選擇器（段落層級） */
export const ANCHOR_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, blockquote, li, img, figure';

/** 錨點屬性名——一律用 data-* 避免與既有 id 衝突 */
export const ANCHOR_ATTR = 'data-uep-anchor-id';

/**
 * 對內容容器內的所有段落層級元素補穩定錨點 id。
 * id 格式：`{tag}-{同 tag 序號}`（如 `p-3` = 第 4 個 p）。
 *
 * 冪等：已有 anchorId 的元素不重寫（未來 admin 改內容順序時，
 * 序號雖會偏移但至少不會在同次 render 內重算兩次）。
 *
 * ⚠️ 支援單一 root 或多個 root（NodeList / 陣列）——**多個 root 時
 * counter 跨容器共用**，避免同一頁多 rich-text block 各自從 0 開始造成
 * `p-0` 重複（S9-A Codex #3）。呼叫端一頁呼叫一次，把所有 prose 容器
 * 一起傳進來，錨點 id 就在該頁全域唯一。
 *
 * 呼叫時機：文字頁 Reader 內容 render 完成後（依 articleHtml/content dep）。
 */
export function ensureContentAnchors(
  root:
    | HTMLElement
    | null
    | ArrayLike<HTMLElement | null | undefined>
    | undefined
): void {
  if (!root) return;
  const roots: HTMLElement[] = [];
  if (root instanceof HTMLElement) {
    roots.push(root);
  } else if (typeof (root as ArrayLike<unknown>).length === 'number') {
    const list = root as ArrayLike<HTMLElement | null | undefined>;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el) roots.push(el);
    }
  }
  if (roots.length === 0) return;
  const counters: Record<string, number> = {};
  for (const r of roots) {
    r.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR).forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const idx = counters[tag] ?? 0;
      counters[tag] = idx + 1;
      if (!el.getAttribute(ANCHOR_ATTR)) {
        el.setAttribute(ANCHOR_ATTR, `${tag}-${idx}`);
      }
    });
  }
}

/** drop 時抓到的錨定結果 */
export interface AnchorHit {
  /** 命中的錨點 id（如 `p-3`） */
  anchorId: string;
  /** drop 點相對錨點左上角的偏移（釘選時存下，還原時直接用） */
  offsetX: number;
  offsetY: number;
  /**
   * 錨點 rect 到 (clientX, clientY) 的曼哈頓距離（0 = drop 點落在錨點內）。
   * 07/25 三驗+：dragToPin 拓寬 anchor-first 判定跨多個 prose 容器選最近時，
   * 需要此距離做排序。單容器呼叫忽略即可。
   */
  distance: number;
}

/**
 * 找出最靠近 (clientX, clientY) 的內容錨點元素。
 *
 * 策略：先看該點是否落在某個錨點元素內（elementFromPoint + closest），
 * 落在就直接回；否則掃所有錨點，找距離最近的（曼哈頓距離已夠用）。
 * 兩者都失敗回 null——呼叫端會退化成 page 級釘選。
 */
export function findNearestAnchor(
  root: HTMLElement | null,
  clientX: number,
  clientY: number
): AnchorHit | null {
  if (!root) return null;

  // 先試「點就在某個錨點內」（jsdom 無 elementFromPoint→ 直接走 fallback）
  if (typeof document.elementFromPoint === 'function') {
    const under = document.elementFromPoint(clientX, clientY);
    if (under && root.contains(under)) {
      const anchor = under.closest<HTMLElement>(`[${ANCHOR_ATTR}]`);
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        return {
          anchorId: anchor.getAttribute(ANCHOR_ATTR)!,
          offsetX: clientX - rect.left,
          offsetY: clientY - rect.top,
          distance: 0,
        };
      }
    }
  }

  // fallback：掃所有錨點找最近
  const nodes = root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`);
  if (nodes.length === 0) return null;

  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  nodes.forEach((el) => {
    const rect = el.getBoundingClientRect();
    // 計算 (clientX, clientY) 到 rect 邊界的距離；rect 內部距離為 0
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const dist = dx + dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  });

  if (!best) return null;
  const bestEl = best as HTMLElement;
  const rect = bestEl.getBoundingClientRect();
  return {
    anchorId: bestEl.getAttribute(ANCHOR_ATTR)!,
    offsetX: clientX - rect.left,
    offsetY: clientY - rect.top,
    distance: bestDist,
  };
}

/** 錨點解析的結果種類（容錯鏈的層級記錄） */
export type AnchorResolveKind = 'exact' | 'nearest' | 'top' | 'fixed';

export interface ResolvedAnchor {
  /** 解析方式：命中原元素 / 最近鄰同 tag / 退頁首 / 無 root 退 fixed */
  kind: AnchorResolveKind;
  /** 錨點元素相對於 viewport 的位置；kind=fixed 時為 null（呼叫端用 offset 當 viewport 座標） */
  rect: DOMRect | null;
  /** 命中的元素（僅 exact/nearest 有值） */
  element: HTMLElement | null;
}

/**
 * 由 anchorId 解析出定位資訊，附帶容錯鏈。
 *
 * 容錯順序（艾斯維爾 07/21 定案）：
 * 1. **exact**：直接找到 `[data-uep-anchor-id="{id}"]`
 * 2. **nearest**：找不到 exact → 找同 tag 序號最接近的
 *    （admin 增刪段落時，第 4 個 p 消失時退用第 3 個 p 保留大致位置）
 * 3. **top**：連同 tag 也沒有 → 退容器頂端（rect = root.rect）
 * 4. **fixed**：root 本身不存在（極端邊界，如頁面尚未 render）→
 *    回 rect=null，呼叫端用 viewport 固定座標當退路
 */
export function resolveAnchorRect(
  root: HTMLElement | null,
  anchorId: string
): ResolvedAnchor {
  if (!root) {
    return { kind: 'fixed', rect: null, element: null };
  }

  // 1. exact
  const exact = root.querySelector<HTMLElement>(
    `[${ANCHOR_ATTR}="${cssEscape(anchorId)}"]`
  );
  if (exact) {
    return {
      kind: 'exact',
      rect: exact.getBoundingClientRect(),
      element: exact,
    };
  }

  // 2. nearest 同 tag（parse anchorId 抽 tag + idx）
  const parsed = parseAnchorId(anchorId);
  if (parsed) {
    const siblings = Array.from(
      root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`)
    ).filter((el) => el.tagName.toLowerCase() === parsed.tag);
    if (siblings.length > 0) {
      // 找 idx 距離最近者（同 idx 優先，否則距離最小）
      let bestEl = siblings[0];
      let bestDiff = Infinity;
      siblings.forEach((el) => {
        const p = parseAnchorId(el.getAttribute(ANCHOR_ATTR) || '');
        if (!p) return;
        const diff = Math.abs(p.idx - parsed.idx);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestEl = el;
        }
      });
      return {
        kind: 'nearest',
        rect: bestEl.getBoundingClientRect(),
        element: bestEl,
      };
    }
  }

  // 3. top：容器頂端（root 本身的 rect）
  return { kind: 'top', rect: root.getBoundingClientRect(), element: null };
}

/** 解析錨點 id → tag + idx；格式不合回 null */
export function parseAnchorId(id: string): { tag: string; idx: number } | null {
  const m = /^([a-z][a-z0-9]*)-(\d+)$/.exec(id);
  if (!m) return null;
  return { tag: m[1], idx: parseInt(m[2], 10) };
}

/**
 * 輕量 CSS.escape shim——jsdom 舊版可能缺此 API。
 * anchorId 只含 [a-z0-9-]，實務上不需要 escape，但保險起見補一層。
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^\w-]/g, '\\$&');
}
