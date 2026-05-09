// ─── 首頁區塊類型定義 ───────────────────────────────────────────────────────

/** 所有區塊類型名稱 */
export type HomepageBlockType =
  | 'zone-header'
  | 'uep-dialogue'
  | 'archway-grid'
  | 'hint-box'
  | 'orb-cluster-grid'
  | 'cross-road-grid'
  | 'terminal-module-table'
  | 'storage-sticky-note'
  | 'storage-links-list'
  | 'rich-text';

// ─── 各區塊資料結構 ─────────────────────────────────────────────────────────

export interface ZoneHeaderData {
  title: string;
  subtitle: string;
}

export interface UepDialogueItem {
  text: string;
  side: 'left' | 'right';
  effects?: string[];
}

export interface ArchwayCard {
  tag: string;
  name: string;
  state: 'open' | 'corrupted' | 'sealed';
  stateLabel: string;
}

export interface OrbCluster {
  color: string;
  label: string;
  orbCount: number;
}

export interface CrossRoad {
  area: string; // CSS grid-area: fwd/lft/rgt/bck
  dir: string;
  name: string;
  hint: string;
  href: string;
}

export interface TerminalModule {
  id: string;
  name: string;
  en: string;
  state: 'sync' | 'idle';
  records: number;
}

export interface StorageLink {
  num: string;
  title: string;
  file: string;
  hint: string;
  href: string;
}

// ─── 區塊聯合型別 ───────────────────────────────────────────────────────────

export type HomepageBlockData =
  | { type: 'zone-header'; data: ZoneHeaderData }
  | { type: 'uep-dialogue'; data: UepDialogueItem[] }
  | { type: 'archway-grid'; data: { cards: ArchwayCard[] } }
  | { type: 'hint-box'; data: { text: string } }
  | { type: 'orb-cluster-grid'; data: { clusters: OrbCluster[] } }
  | { type: 'cross-road-grid'; data: { roads: CrossRoad[] } }
  | { type: 'terminal-module-table'; data: { headerLabel: string; modules: TerminalModule[] } }
  | { type: 'storage-sticky-note'; data: { text: string; attribution: string } }
  | { type: 'storage-links-list'; data: { links: StorageLink[] } }
  | { type: 'rich-text'; data: { html: string } };

/** 完整的區塊（含 id） */
export interface HomepageBlock {
  id: string;
  type: HomepageBlockType;
  data: HomepageBlockData['data'];
}

// ─── D1 ContentBlock ↔ HomepageBlock 轉換 ───────────────────────────────────

export interface ContentBlock {
  id: string;
  type: string;
  content: string;
  attrs?: Record<string, unknown>;
}

/** D1 ContentBlock → HomepageBlock */
export function fromContentBlock(cb: ContentBlock): HomepageBlock {
  let data: HomepageBlockData['data'];
  try {
    data = JSON.parse(cb.content);
  } catch {
    data = { html: cb.content } as { html: string };
  }
  return { id: cb.id, type: cb.type as HomepageBlockType, data };
}

/** HomepageBlock → D1 ContentBlock */
export function toContentBlock(block: HomepageBlock): ContentBlock {
  return {
    id: block.id,
    type: block.type,
    content: JSON.stringify(block.data),
    attrs: {},
  };
}

/** 產生唯一區塊 id */
export function genBlockId(): string {
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── 區塊類型顯示名稱 ──────────────────────────────────────────────────────

export const BLOCK_TYPE_LABELS: Record<HomepageBlockType, string> = {
  'zone-header': '區域標題',
  'uep-dialogue': 'UEP 對話',
  'archway-grid': '拱門卡片',
  'hint-box': '提示文字',
  'orb-cluster-grid': '回聲集群',
  'cross-road-grid': '十字路口',
  'terminal-module-table': '終端模組表',
  'storage-sticky-note': '便條紙',
  'storage-links-list': '儲藏連結列表',
  'rich-text': '富文本',
};

/** 各區域可用的區塊類型 */
export const ZONE_BLOCK_TYPES: Record<string, HomepageBlockType[]> = {
  history: ['zone-header', 'uep-dialogue', 'archway-grid', 'hint-box', 'rich-text'],
  echoes: ['zone-header', 'uep-dialogue', 'orb-cluster-grid', 'rich-text'],
  visuals: ['zone-header', 'uep-dialogue', 'cross-road-grid', 'rich-text'],
  concepts: ['zone-header', 'uep-dialogue', 'terminal-module-table', 'rich-text'],
  storage: ['zone-header', 'uep-dialogue', 'storage-sticky-note', 'storage-links-list', 'rich-text'],
};

/** 建立空區塊 */
export function createEmptyBlock(type: HomepageBlockType): HomepageBlock {
  const id = genBlockId();
  const defaults: Record<HomepageBlockType, HomepageBlockData['data']> = {
    'zone-header': { title: '', subtitle: '' },
    'uep-dialogue': [],
    'archway-grid': { cards: [] },
    'hint-box': { text: '' },
    'orb-cluster-grid': { clusters: [] },
    'cross-road-grid': { roads: [] },
    'terminal-module-table': { headerLabel: '', modules: [] },
    'storage-sticky-note': { text: '', attribution: '' },
    'storage-links-list': { links: [] },
    'rich-text': { html: '' },
  };
  return { id, type, data: defaults[type] };
}
