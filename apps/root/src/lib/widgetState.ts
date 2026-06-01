/**
 * Widget 狀態管理模組
 * 管理側邊欄 widget 的展示模式、可見性、位置等設定
 * 所有狀態存儲於 localStorage
 */

// ── 型別定義 ──────────────────────────────────────────────

export type WidgetMode = 'toolbox' | 'edge-tabs';

export type WidgetId =
  | 'music'
  | 'visitor'
  | 'quote'
  | 'portal'
  | 'status'
  | 'uep';

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface WidgetState {
  /** 目前展示模式 */
  mode: WidgetMode;
  /** 各 widget 是否啟用（在工具箱/吐牌中顯示） */
  enabled: Record<WidgetId, boolean>;
  /** 各 widget 是否已「拉出」為浮島（Mode A 專用） */
  pinned: Record<WidgetId, boolean>;
  /** 浮島位置（Mode A 專用） */
  positions: Partial<Record<WidgetId, WidgetPosition>>;
  /** widget 排列順序 */
  order: WidgetId[];
}

// ── 常數 ──────────────────────────────────────────────────

const STORAGE_KEY = 'root-widget-state';

export const ALL_WIDGETS: WidgetId[] = [
  'music',
  'visitor',
  'quote',
  'portal',
  'status',
  'uep',
];

export const WIDGET_META: Record<
  WidgetId,
  { icon: string; label: string; labelEn: string }
> = {
  music: { icon: '♪', label: '音樂播放器', labelEn: 'MUSIC' },
  visitor: { icon: '●', label: '訪客計數', labelEn: 'VISITORS' },
  quote: { icon: '❝', label: '本日名言', labelEn: 'QUOTE' },
  portal: { icon: '◎', label: '隨機探索', labelEn: 'PORTAL' },
  status: { icon: '◆', label: '網站狀態', labelEn: 'STATUS' },
  uep: { icon: 'U', label: 'U.E.P', labelEn: 'U.E.P' },
};

const DEFAULT_STATE: WidgetState = {
  mode: 'edge-tabs',
  enabled: {
    music: true,
    visitor: true,
    quote: true,
    portal: true,
    status: true,
    uep: true,
  },
  pinned: {
    music: false,
    visitor: false,
    quote: false,
    portal: false,
    status: false,
    uep: false,
  },
  positions: {},
  order: [...ALL_WIDGETS],
};

// ── SSR 安全的 localStorage 存取 ──────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** 取得完整的 widget 狀態 */
export function getWidgetState(): WidgetState {
  if (!isBrowser()) return { ...DEFAULT_STATE };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };

    const parsed = JSON.parse(raw) as Partial<WidgetState>;

    // 合併預設值，確保新增的 widget 不會遺失
    return {
      mode: parsed.mode ?? DEFAULT_STATE.mode,
      enabled: { ...DEFAULT_STATE.enabled, ...parsed.enabled },
      pinned: { ...DEFAULT_STATE.pinned, ...parsed.pinned },
      positions: { ...parsed.positions },
      order: (() => {
        if (!parsed.order?.length) return [...ALL_WIDGETS];
        // 保留使用者排序，過濾掉已移除的 widget，補上新增的
        const valid = parsed.order.filter((id: WidgetId) =>
          ALL_WIDGETS.includes(id)
        );
        const missing = ALL_WIDGETS.filter((id) => !valid.includes(id));
        return [...valid, ...missing];
      })(),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** 更新 widget 狀態（partial merge） */
export function setWidgetState(partial: Partial<WidgetState>): WidgetState {
  if (!isBrowser()) return { ...DEFAULT_STATE };

  const current = getWidgetState();
  const next: WidgetState = {
    ...current,
    ...partial,
    enabled: partial.enabled
      ? { ...current.enabled, ...partial.enabled }
      : current.enabled,
    pinned: partial.pinned
      ? { ...current.pinned, ...partial.pinned }
      : current.pinned,
    positions: partial.positions
      ? { ...current.positions, ...partial.positions }
      : current.positions,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 可能已滿，忽略
  }

  return next;
}

/** 重置為預設狀態 */
export function resetWidgetState(): WidgetState {
  if (!isBrowser()) return { ...DEFAULT_STATE };

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }

  return { ...DEFAULT_STATE };
}

/** 切換展示模式 */
export function toggleWidgetMode(): WidgetMode {
  const current = getWidgetState();
  const nextMode: WidgetMode =
    current.mode === 'toolbox' ? 'edge-tabs' : 'toolbox';
  setWidgetState({ mode: nextMode });
  return nextMode;
}

/** 切換單一 widget 的浮島狀態（Mode A） */
export function toggleWidgetPinned(id: WidgetId): boolean {
  const current = getWidgetState();
  const nextPinned = !current.pinned[id];
  setWidgetState({
    pinned: { ...current.pinned, [id]: nextPinned },
  });
  return nextPinned;
}

/** 更新浮島位置 */
export function updateWidgetPosition(id: WidgetId, pos: WidgetPosition): void {
  const current = getWidgetState();
  setWidgetState({
    positions: { ...current.positions, [id]: pos },
  });
}
