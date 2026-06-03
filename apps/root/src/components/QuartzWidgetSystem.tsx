/**
 * QuartzWidgetSystem — 主站側邊欄 widget 系統
 * 支援兩種展示模式：工具箱+浮島 (toolbox) / 邊緣吐牌 (edge-tabs)
 * Alt+S 切換模式
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  getWidgetState,
  setWidgetState,
  toggleWidgetMode,
  toggleWidgetPinned,
  updateWidgetPosition,
  WIDGET_META,
  ALL_WIDGETS,
  type WidgetId,
  type WidgetMode,
  type WidgetPosition,
  type WidgetState,
} from '../lib/widgetState';
import { getWidgetData } from './widgets/types';

// Widget 元件
import WidgetMusicPlayer from './widgets/WidgetMusicPlayer';
import WidgetVisitorCounter from './widgets/WidgetVisitorCounter';
import WidgetDailyQuote from './widgets/WidgetDailyQuote';
import WidgetPortal from './widgets/WidgetPortal';
import WidgetStatus from './widgets/WidgetStatus';
import WidgetUEP from './widgets/WidgetUEP';

// ── Widget 渲染映射 ─────────────────────────────────────────

const WIDGET_COMPONENTS: Record<WidgetId, React.FC> = {
  music: WidgetMusicPlayer,
  visitor: WidgetVisitorCounter,
  quote: WidgetDailyQuote,
  portal: WidgetPortal,
  status: WidgetStatus,
  uep: WidgetUEP,
};

// ── 浮島容器 (Mode A) ───────────────────────────────────────

function FloatingIsland({
  id,
  children,
  initialPos,
  onDock,
  docking = false,
  onNearDockChange,
}: {
  id: WidgetId;
  children: ReactNode;
  initialPos?: WidgetPosition;
  onDock: () => void;
  docking?: boolean;
  onNearDockChange?: (near: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [pos, setPos] = useState<WidgetPosition>(() => {
    const p = initialPos || { x: 100, y: 200 };
    // mount 時驗證已存 position 是否在 viewport 內
    if (typeof window !== 'undefined') {
      return {
        x: Math.max(0, Math.min(window.innerWidth - 240, p.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, p.y)),
      };
    }
    return p;
  });
  const [nearDock, setNearDock] = useState(false);

  const DOCK_THRESHOLD = 60; // 拖到左邊 60px 內觸發收回

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.q-island__dock-btn')) return;
      e.preventDefault();
      e.stopPropagation();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      const newX = Math.max(
        0,
        Math.min(window.innerWidth - 240, dragState.current.origX + dx)
      );
      const newY = Math.max(
        0,
        Math.min(window.innerHeight - 100, dragState.current.origY + dy)
      );
      setPos({ x: newX, y: newY });
      // 靠近左邊緣時顯示 dock 提示
      const isNear = newX < DOCK_THRESHOLD;
      if (isNear !== nearDock) {
        setNearDock(isNear);
        onNearDockChange?.(isNear);
      }
    },
    [nearDock, onNearDockChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragState.current = null;
      setNearDock(false);
      onNearDockChange?.(false);

      // 拖到左邊緣 → 收回工具箱
      if (pos.x < DOCK_THRESHOLD) {
        onDock();
        return;
      }

      // 否則存位置
      const finalX = Math.max(0, Math.min(window.innerWidth - 240, pos.x));
      const finalY = Math.max(0, Math.min(window.innerHeight - 100, pos.y));
      updateWidgetPosition(id, { x: finalX, y: finalY });
    },
    [id, pos, onDock]
  );

  const meta = WIDGET_META[id];

  return (
    <div
      ref={ref}
      className={`q-island ${nearDock ? 'q-island--near-dock' : ''} ${docking ? 'q-island--docking' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="q-island__header">
        <span className="q-island__grip">⋮⋮</span>
        <span className="q-island__label">{meta.labelEn}</span>
        <button
          className="q-island__dock-btn"
          onClick={onDock}
          title="收回工具箱"
        >
          ×
        </button>
      </div>
      <div className="q-island__body">{children}</div>
    </div>
  );
}

// ── Mode A: 工具箱 ──────────────────────────────────────────

function ToolboxMode({
  state,
  onStateChange,
}: {
  state: WidgetState;
  onStateChange: (s: WidgetState) => void;
}) {
  const [open, setOpen] = useState(false);
  // 拖曳幽靈：從工具箱拖出時，跟著滑鼠走的預覽
  const [dragGhost, setDragGhost] = useState<{
    id: WidgetId;
    x: number;
    y: number;
    started: boolean; // 是否已超過拖曳門檻
  } | null>(null);
  // 收回動畫中的浮島
  const [dockingId, setDockingId] = useState<WidgetId | null>(null);
  // 有浮島靠近 dock zone 時，工具箱顯示接收提示
  const [readyToReceive, setReadyToReceive] = useState(false);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const data = getWidgetData();

  const DRAG_THRESHOLD = 8; // 超過 8px 才算開始拖曳

  // ── 從工具箱拖出的 pointer events（掛在 document 上）──

  useEffect(() => {
    if (!dragGhost) return;

    const handleMove = (e: PointerEvent) => {
      setDragGhost((prev) => {
        if (!prev) return null;
        const newState = { ...prev, x: e.clientX, y: e.clientY };
        // 檢查是否超過拖曳門檻
        if (!prev.started && dragOriginRef.current) {
          const dx = e.clientX - dragOriginRef.current.x;
          const dy = e.clientY - dragOriginRef.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
            newState.started = true;
          }
        }
        return newState;
      });
    };

    const handleUp = (e: PointerEvent) => {
      if (!dragGhost) return;
      const { id, started } = dragGhost;
      // 超過工具箱範圍且已開始拖曳 → 建立浮島
      if (started && e.clientX > 260) {
        updateWidgetPosition(id, {
          x: Math.max(0, Math.min(window.innerWidth - 240, e.clientX - 100)),
          y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - 20)),
        });
        toggleWidgetPinned(id);
        onStateChange(getWidgetState());
      }
      setDragGhost(null);
      dragOriginRef.current = null;
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [dragGhost, onStateChange]);

  /** 工具箱 item 拖曳開始 */
  const handleItemPointerDown = (id: WidgetId, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
    setDragGhost({ id, x: e.clientX, y: e.clientY, started: false });
  };

  /** 浮島收回（帶動畫） */
  const handleDock = (id: WidgetId) => {
    setDockingId(id);
    setReadyToReceive(true);
    // 等動畫播完再真正 dock
    setTimeout(() => {
      toggleWidgetPinned(id);
      onStateChange(getWidgetState());
      setDockingId(null);
      setReadyToReceive(false);
    }, 250);
  };

  // 哪些在工具箱、哪些在浮島
  const dockedWidgets = state.order.filter(
    (id) => state.enabled[id] && !state.pinned[id] && data.cardEnabled[id]
  );
  const pinnedWidgets = state.order.filter(
    (id) => state.enabled[id] && state.pinned[id] && data.cardEnabled[id]
  );

  return (
    <>
      {/* 工具箱 tab */}
      <button
        className={`q-toolbox-tab ${open ? 'q-toolbox-tab--open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-label="Toggle toolbox"
      >
        <span className="q-toolbox-tab__icon">{open ? '◂' : '▸'}</span>
      </button>

      {/* 工具箱面板 */}
      <div
        className={`q-toolbox ${open ? 'q-toolbox--open' : ''} ${readyToReceive ? 'q-toolbox--receiving' : ''}`}
      >
        <div className="q-toolbox__header">
          <span className="q-toolbox__label">—— TOOLBOX</span>
        </div>
        <div className="q-toolbox__list">
          {dockedWidgets.map((id) => {
            const meta = WIDGET_META[id];
            const Comp = WIDGET_COMPONENTS[id];
            const isDragging = dragGhost?.id === id;
            return (
              <div
                key={id}
                className={`q-toolbox__item ${isDragging ? 'q-toolbox__item--dragging' : ''}`}
              >
                <div
                  className="q-toolbox__item-header"
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  onPointerDown={(e) => handleItemPointerDown(id, e)}
                >
                  <span className="q-toolbox__item-grip">⋮⋮</span>
                  <span className="q-toolbox__item-icon">{meta.icon}</span>
                  <span className="q-toolbox__item-label">{meta.labelEn}</span>
                </div>
                <div className="q-toolbox__item-body">
                  <Comp />
                </div>
              </div>
            );
          })}
          {dockedWidgets.length === 0 && (
            <div className="q-toolbox__empty">所有工具都在外面了</div>
          )}
        </div>
      </div>

      {/* 拖曳幽靈（跟著滑鼠走） */}
      {dragGhost?.started && (
        <div
          className="q-drag-ghost"
          style={{ left: dragGhost.x - 80, top: dragGhost.y - 16 }}
        >
          <span className="q-drag-ghost__icon">
            {WIDGET_META[dragGhost.id].icon}
          </span>
          <span className="q-drag-ghost__label">
            {WIDGET_META[dragGhost.id].labelEn}
          </span>
        </div>
      )}

      {/* 浮島 */}
      {pinnedWidgets.map((id) => {
        const Comp = WIDGET_COMPONENTS[id];
        const isDocking = dockingId === id;
        return (
          <FloatingIsland
            key={id}
            id={id}
            initialPos={state.positions[id]}
            onDock={() => handleDock(id)}
            docking={isDocking}
            onNearDockChange={setReadyToReceive}
          >
            <Comp />
          </FloatingIsland>
        );
      })}
    </>
  );
}

// ── Mode B: 邊緣吐牌 ───────────────────────────────────────

function EdgeTabsMode({ state }: { state: WidgetState }) {
  const [hovering, setHovering] = useState(false);
  const [expandedId, setExpandedId] = useState<WidgetId | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const data = getWidgetData();

  // 偵測滑鼠靠近左邊緣
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientX < 28) {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setHovering(true);
      } else if (e.clientX > 260) {
        // 如果有展開的 widget，不收回 hover
        if (expandedId && e.clientX < 480) return;
        hoverTimeout.current = setTimeout(() => setHovering(false), 300);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    };
  }, [expandedId]);

  // 點擊外部關閉展開面板
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpandedId(null);
      }
    };
    if (expandedId) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [expandedId]);

  const activeWidgets = state.order.filter(
    (id) => state.enabled[id] && data.cardEnabled[id]
  );

  return (
    <div
      ref={panelRef}
      className={`q-edge ${hovering || expandedId ? 'q-edge--visible' : ''}`}
    >
      {/* 吐牌列表 */}
      <div className="q-edge__tabs">
        {activeWidgets.map((id) => {
          const meta = WIDGET_META[id];
          const isExpanded = expandedId === id;
          return (
            <button
              key={id}
              className={`q-edge__tab ${isExpanded ? 'q-edge__tab--active' : ''}`}
              onClick={() => setExpandedId(isExpanded ? null : id)}
              title={meta.label}
            >
              <span className="q-edge__tab-accent" />
              <span className="q-edge__tab-icon">{meta.icon}</span>
              <span className="q-edge__tab-label">{meta.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* 展開面板 */}
      {expandedId && (
        <div className="q-edge__panel">
          <div className="q-edge__panel-header">
            <span className="q-edge__panel-label">
              {WIDGET_META[expandedId].icon} {WIDGET_META[expandedId].labelEn}
            </span>
            <button
              className="q-edge__panel-close"
              onClick={() => setExpandedId(null)}
            >
              ×
            </button>
          </div>
          <div className="q-edge__panel-body">
            {React.createElement(WIDGET_COMPONENTS[expandedId])}
          </div>
        </div>
      )}

      {/* 平時只露出的色塊指示器 */}
      {!hovering && !expandedId && (
        <div className="q-edge__hints">
          {activeWidgets.map((id) => (
            <div key={id} className="q-edge__hint" />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主控制器 ────────────────────────────────────────────────

export default function QuartzWidgetSystem() {
  const [state, setState] = useState<WidgetState>(getWidgetState);
  const [showModeLabel, setShowModeLabel] = useState(false);

  // Alt+S 切換模式
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const next = toggleWidgetMode();
        setState(getWidgetState());
        // 顯示模式標籤
        setShowModeLabel(true);
        setTimeout(() => setShowModeLabel(false), 1500);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // View Transitions 後重新讀取狀態
  useEffect(() => {
    const handler = () => setState(getWidgetState());
    document.addEventListener('astro:page-load', handler);
    return () => document.removeEventListener('astro:page-load', handler);
  }, []);

  return (
    <>
      {/* 模式切換提示 */}
      {showModeLabel && (
        <div className="q-mode-toast">
          {state.mode === 'toolbox' ? '⬒ TOOLBOX' : '⬕ EDGE TABS'}
        </div>
      )}

      {/* 模式切換按鈕（小、不干擾） */}
      <button
        className="q-mode-switch"
        onClick={() => {
          toggleWidgetMode();
          setState(getWidgetState());
          setShowModeLabel(true);
          setTimeout(() => setShowModeLabel(false), 1500);
        }}
        title={`切換模式 (Alt+S) · 目前: ${state.mode}`}
      >
        {state.mode === 'toolbox' ? '⬒' : '⬕'}
      </button>

      {/* 模式渲染 */}
      {state.mode === 'toolbox' ? (
        <ToolboxMode state={state} onStateChange={setState} />
      ) : (
        <EdgeTabsMode state={state} />
      )}
    </>
  );
}
