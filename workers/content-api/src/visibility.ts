/**
 * visibility.ts — 公開讀取端點的靜態可見度判定（伺服器端單一事實來源）
 *
 * 只處理「不需讀者進度即可判定、對所有讀者（含觀測者）一律成立」的條件：
 *
 * 1. 排除：軟刪除（deleted_at）與 status='draft'——完全不出現
 * 2. 靜態鎖：`metadata.locked === true`（手動封存）——節點以存根保留
 *    （前端仍需要知道「這裡有東西但鎖著」），內容欄位剝除。
 *    前端 contentVisibility.getLockKind／echoesVisibility／visualsVisibility
 *    對靜態鎖都不給觀測者 bypass，因此屬於對所有人皆鎖的條件。
 *
 * 依讀者身分或進度可解的條件（requiresFlags／pristineOnly／alwaysLocked／
 * progressPage 鏈）一律原樣送出：公開回應走 CDN 共用快取，後端不知道誰
 * 解鎖了，在這裡剝除等於讓可解鎖的讀者永遠拿不回內容。alwaysLocked 對
 * 觀測者放行，同屬此類。
 *
 * 語意對齊前端：`locked` 只看節點本身，不沿容器向子孫繼承（`effectiveGate`
 * 只繼承 progressPage 鏈旗標；progress/tree.ts 對 locked 也只跳過節點本身）。
 *
 * hidden 維持既有語意（列表排除、by-id 反查保留），不在這裡決定。
 */

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

/** 解析 metadata 欄位；壞 JSON 回 null（呼叫端決定要跳過還是當空物件） */
export function parseMetadata(raw: unknown): Dict | null {
  if (raw && typeof raw === 'object') return asDict(raw);
  if (typeof raw !== 'string') return null;
  try {
    return asDict(JSON.parse(raw || '{}'));
  } catch {
    return null;
  }
}

// ===== 頁面層判定 =====

/** 完全不對公開讀取出現的列：軟刪除或草稿 */
export function isExcludedRow(row: {
  status?: string | null;
  deleted_at?: string | null;
}): boolean {
  return !!row.deleted_at || row.status === 'draft';
}

/** 頁面是否靜態鎖定（手動封存） */
export function isStaticallyLocked(meta: Dict | null | undefined): boolean {
  return !!meta && meta.locked === true;
}

/** 從列表排除的 hidden（沿用既有 `=== true || === 1` 口徑） */
export function isHiddenMeta(meta: Dict | null | undefined): boolean {
  return !!meta && (meta.hidden === true || meta.hidden === 1);
}

/**
 * 統計／最近更新這類「公開清單」口徑：排除草稿、hidden 與靜態鎖。
 * 壞 metadata 也排除（無法確認是否公開時不計入）。
 */
export function isPubliclyListed(row: {
  status?: string | null;
  deleted_at?: string | null;
  metadata?: unknown;
}): boolean {
  if (isExcludedRow(row)) return false;
  const meta = parseMetadata(row.metadata);
  if (!meta) return false;
  return !isHiddenMeta(meta) && !isStaticallyLocked(meta);
}

// ===== 存根 =====

/**
 * 存根保留的 metadata 鍵——只留前端判斷「鎖著、怎麼鎖、在進度鏈哪裡」
 * 需要的結構欄位：
 * - locked / hidden：鎖定與列表語意
 * - gate 與平鋪的 requiresFlags / pristineOnly / alwaysLocked：鎖定分類
 *   （getLockKind 先求值 gate，再落到 static；拿掉會改變前端的鎖定呈現）
 * - progressPage / gateExempt：進度鏈與容器繼承的結構
 * - category（Echoes songType）、stack_style（Concepts 頁型）：決定
 *   前端走哪套判定，本身不是內容
 *
 * 標題、內文、音檔、圖片、spoilerRevisions、entityKey／storyKey、
 * 封面、說明等一律不留。
 */
const STUB_METADATA_KEYS = [
  'locked',
  'hidden',
  'gate',
  'requiresFlags',
  'pristineOnly',
  'alwaysLocked',
  'progressPage',
  'gateExempt',
  'category',
  'stack_style',
] as const;

export function stubMetadata(meta: Dict): Dict {
  const out: Dict = {};
  for (const key of STUB_METADATA_KEYS) {
    if (key in meta) out[key] = meta[key];
  }
  out.redacted = true;
  return out;
}

// ===== 快取 =====

/**
 * 依讀者身分決定的快取標頭。
 *
 * 同一個 URL 對管理員與訪客的回應不同：管理員回應一律 `private, no-store`
 * （絕不進任何共用快取），公開回應加 `Vary: Authorization`，讓瀏覽器
 * 不會把未認證的快取副本回給帶認證的請求。
 */
export function viewerCacheHeaders(
  admin: boolean,
  cacheablePublic = true
): Record<string, string> {
  if (admin) {
    return { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
  }
  return cacheablePublic
    ? {
        'Cache-Control':
          'public, s-maxage=60, max-age=10, stale-while-revalidate=300',
        Vary: 'Authorization',
      }
    : { Vary: 'Authorization' };
}

// ===== 回應形狀轉換 =====

/**
 * 頁面存根：保留結構欄位（id／area／slug／parentId／depth／pageType／
 * sortOrder／status／時間戳）與 stubMetadata，title 清空、content 清空、
 * 同步追蹤欄位（sourceFile／baseContentHash）不外流。
 *
 * ⚠️ id 與 slug 無法剝除：進度鏈旗標 `completed:<id>`、父子結構都靠它，
 * 而 slug 常即歌名／畫廊名——這是存根已知的殘留洩漏面。
 */
export function stubPage<
  T extends {
    title: string;
    content: unknown;
    metadata: Record<string, unknown>;
    sourceFile: string | null;
    baseContentHash: string | null;
  },
>(page: T): T {
  return {
    ...page,
    title: '',
    content: [],
    sourceFile: null,
    baseContentHash: null,
    metadata: stubMetadata(page.metadata),
  };
}

/** 樹節點／列表項的 metadata 與 title：靜態鎖 → 存根，否則原樣 */
export function publicNodeFields(
  title: string,
  meta: Dict
): { title: string; metadata: Dict } {
  return isStaticallyLocked(meta)
    ? { title: '', metadata: stubMetadata(meta) }
    : { title, metadata: meta };
}
