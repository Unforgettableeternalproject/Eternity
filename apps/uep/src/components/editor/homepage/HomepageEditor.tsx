// ─── 首頁編輯器主元件 ─────────────────────────────────────────────────────────
// 管理單一區域首頁的區塊列表：載入、顯示、新增、排序、編輯、儲存。

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { HomepageBlock, HomepageBlockType, ContentBlock } from './types';
import {
  fromContentBlock,
  toContentBlock,
  BLOCK_TYPE_LABELS,
  ZONE_BLOCK_TYPES,
  createEmptyBlock,
} from './types';
import BlockPreview from './BlockPreview';
import BlockEditor from './BlockEditor';

// ─── Props ───────────────────────────────────────────────────────────────────

interface HomepageEditorProps {
  /** 區域 slug，如 'history'、'echoes'、'visuals' 等 */
  area: string;
  /** 區域顯示名稱，如 '歷史典藏庫' */
  zoneLabel: string;
  /** 區域主色，如 '#6b3f2a' */
  zoneColor: string;
  /** Content API base URL */
  apiBase: string;
}

// ─── 儲存狀態類型 ─────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ─── 區域圖示映射 ─────────────────────────────────────────────────────────────

const ZONE_ICONS: Record<string, string> = {
  history: '❒',
  echoes: '◎',
  visuals: '◈',
  concepts: '⬡',
  storage: '⊞',
};

// ─── 主元件 ──────────────────────────────────────────────────────────────────

export default function HomepageEditor({
  area,
  zoneLabel,
  zoneColor,
  apiBase,
}: HomepageEditorProps) {
  // ── 狀態 ──
  const [blocks, setBlocks] = useState<HomepageBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 目前正在編輯的區塊 id（null = 無）
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  // 新增區塊下拉選單是否展開
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // 儲存狀態
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // 髒標記（自上次儲存以來是否有變更）
  const [isDirty, setIsDirty] = useState(false);

  // 追蹤最初載入的快照，用來比對 isDirty
  const savedSnapshotRef = useRef<string>('');

  // ── 初始載入 ──────────────────────────────────────────────────────────────

  const fetchHomepage = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${apiBase}/api/content/${area}/homepage`);

      if (res.status === 404) {
        // 尚無首頁內容，從空白開始
        setBlocks([]);
        savedSnapshotRef.current = JSON.stringify([]);
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      const page = json.data ?? json;

      // content 可能是字串或已解析的陣列
      let rawContent: ContentBlock[] = [];
      if (typeof page.content === 'string') {
        try {
          rawContent = JSON.parse(page.content);
        } catch {
          rawContent = [];
        }
      } else if (Array.isArray(page.content)) {
        rawContent = page.content;
      }

      const parsed = rawContent.map(fromContentBlock);
      setBlocks(parsed);
      savedSnapshotRef.current = JSON.stringify(parsed);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, area]);

  useEffect(() => {
    void fetchHomepage();
  }, [fetchHomepage]);

  // ── 點擊外部關閉新增選單 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!showAddMenu) return;

    const handler = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddMenu]);

  // ── 髒標記追蹤 ────────────────────────────────────────────────────────────

  useEffect(() => {
    setIsDirty(JSON.stringify(blocks) !== savedSnapshotRef.current);
  }, [blocks]);

  // ── 區塊操作 ──────────────────────────────────────────────────────────────

  /** 更新單一區塊 */
  const updateBlock = useCallback((updated: HomepageBlock) => {
    setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    setEditingBlockId(null);
  }, []);

  /** 刪除區塊 */
  const deleteBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  /** 切換區塊隱藏狀態 */
  const toggleBlockHidden = useCallback((id: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, hidden: !b.hidden } : b))
    );
  }, []);

  /** 上移區塊 */
  const moveUp = useCallback((index: number) => {
    if (index === 0) return;
    setBlocks((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  /** 下移區塊 */
  const moveDown = useCallback((index: number) => {
    setBlocks((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  /** 新增區塊 */
  const addBlock = useCallback((type: HomepageBlockType) => {
    const newBlock = createEmptyBlock(type);
    setBlocks((prev) => [...prev, newBlock]);
    setShowAddMenu(false);
    // 自動開啟編輯面板
    setEditingBlockId(newBlock.id);
  }, []);

  // ── 儲存 ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    setSaveError(null);

    const contentBlocks: ContentBlock[] = blocks.map(toContentBlock);

    try {
      const res = await fetch(`${apiBase}/api/content/${area}/homepage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${zoneLabel} 首頁`,
          content: contentBlocks,
          pageType: 'homepage',
          parentId: null,
          depth: 0,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}：${errBody}`);
      }

      // 更新快照，清除髒標記
      savedSnapshotRef.current = JSON.stringify(blocks);
      setIsDirty(false);
      setSaveStatus('saved');

      // 3 秒後恢復為 idle
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveStatus('error');
    }
  }, [apiBase, area, zoneLabel, blocks]);

  // ── 目前正在編輯的區塊物件 ────────────────────────────────────────────────

  const editingBlock = editingBlockId
    ? (blocks.find((b) => b.id === editingBlockId) ?? null)
    : null;

  // ── 此區域可用的區塊類型 ──────────────────────────────────────────────────

  const availableTypes: HomepageBlockType[] = ZONE_BLOCK_TYPES[area] ?? [
    'zone-header',
    'rich-text',
  ];

  // ── 圖示 ──────────────────────────────────────────────────────────────────

  const zoneIcon = ZONE_ICONS[area] ?? '◇';

  // ─────────────────────────────────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={rootStyle}>
      {/* ── 頂部標題列 ── */}
      <header style={headerStyle}>
        {/* 左側：圖示 + 標題 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              ...zoneIconCircleStyle,
              borderColor: zoneColor,
              color: zoneColor,
            }}
          >
            {zoneIcon}
          </div>
          <div>
            <div style={headerTitleStyle}>首頁編輯 · {zoneLabel}</div>
            <div style={headerSubtitleStyle}>{area}&nbsp;/&nbsp;homepage</div>
          </div>
        </div>

        {/* 右側：狀態 + 按鈕 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 髒標記提示 */}
          {isDirty && saveStatus !== 'saving' && (
            <span style={dirtyIndicatorStyle}>未儲存的變更</span>
          )}

          {/* 儲存狀態回饋 */}
          {saveStatus === 'saving' && (
            <span style={{ ...statusChipStyle, color: 'var(--ink-soft)' }}>
              儲存中…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ ...statusChipStyle, color: '#4caf50' }}>
              ✓ 已儲存
            </span>
          )}
          {saveStatus === 'error' && (
            <span
              style={{ ...statusChipStyle, color: '#ef4444' }}
              title={saveError ?? ''}
            >
              ✕ 儲存失敗
            </span>
          )}

          {/* 儲存按鈕 */}
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving' || loading}
            style={{
              ...saveButtonStyle,
              background: zoneColor,
              borderColor: zoneColor,
              opacity: saveStatus === 'saving' || loading ? 0.6 : 1,
              cursor:
                saveStatus === 'saving' || loading ? 'not-allowed' : 'pointer',
            }}
          >
            儲存
          </button>

          {/* 返回按鈕 */}
          <a href="/admin" style={backLinkStyle}>
            ← 返回
          </a>
        </div>
      </header>

      {/* ── 錯誤儲存訊息 ── */}
      {saveStatus === 'error' && saveError && (
        <div style={errorBannerStyle}>
          <strong>儲存錯誤：</strong> {saveError}
        </div>
      )}

      {/* ── 主要內容區 ── */}
      <main style={mainStyle}>
        <div style={contentWrapStyle}>
          {/* 載入中 */}
          {loading && (
            <div style={emptyStateStyle}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  color: 'var(--ink-mute)',
                  letterSpacing: '0.06em',
                }}
              >
                載入中…
              </span>
            </div>
          )}

          {/* 載入錯誤 */}
          {!loading && loadError && (
            <div style={loadErrorStyle}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: '#ef4444',
                  marginBottom: 8,
                }}
              >
                ✕ 載入失敗
              </div>
              <div
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--ink-soft)',
                  marginBottom: 12,
                }}
              >
                {loadError}
              </div>
              <button
                onClick={() => void fetchHomepage()}
                style={retryButtonStyle}
              >
                重新載入
              </button>
            </div>
          )}

          {/* 區塊列表 */}
          {!loading && !loadError && (
            <>
              {blocks.length === 0 ? (
                <div style={emptyStateStyle}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      color: 'var(--ink-mute)',
                      marginBottom: 8,
                      letterSpacing: '0.04em',
                    }}
                  >
                    尚無區塊
                  </div>
                  <div
                    style={{ fontSize: '0.75rem', color: 'var(--ink-mute)' }}
                  >
                    點擊下方「＋ 新增區塊」開始編輯首頁內容。
                  </div>
                </div>
              ) : (
                <div style={blockListStyle}>
                  {blocks.map((block, index) => (
                    <BlockPreview
                      key={block.id}
                      block={block}
                      zoneColor={zoneColor}
                      onEdit={() => setEditingBlockId(block.id)}
                      onDelete={() => deleteBlock(block.id)}
                      onToggleHidden={() => toggleBlockHidden(block.id)}
                      onMoveUp={index > 0 ? () => moveUp(index) : undefined}
                      onMoveDown={
                        index < blocks.length - 1
                          ? () => moveDown(index)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

              {/* 新增區塊按鈕 */}
              <div
                ref={addMenuRef}
                style={{ position: 'relative', marginTop: 16 }}
              >
                <button
                  onClick={() => setShowAddMenu((v) => !v)}
                  style={{
                    ...addBlockButtonStyle,
                    borderColor: showAddMenu
                      ? zoneColor
                      : 'var(--hairline-strong)',
                    color: showAddMenu ? zoneColor : 'var(--ink-soft)',
                  }}
                >
                  ＋ 新增區塊
                </button>

                {/* 下拉選單 */}
                {showAddMenu && (
                  <div style={addMenuStyle}>
                    {availableTypes.map((type) => (
                      <button
                        key={type}
                        onClick={() => addBlock(type)}
                        style={addMenuItemStyle}
                        onMouseEnter={(e) => {
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.background = 'var(--bg-soft)';
                          (e.currentTarget as HTMLButtonElement).style.color =
                            zoneColor;
                        }}
                        onMouseLeave={(e) => {
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.background = 'transparent';
                          (e.currentTarget as HTMLButtonElement).style.color =
                            'var(--ink)';
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.65rem',
                            color: 'var(--ink-mute)',
                            letterSpacing: '0.04em',
                            marginRight: 8,
                            flexShrink: 0,
                          }}
                        >
                          {type}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-sans)',
                            fontSize: '0.8rem',
                          }}
                        >
                          {BLOCK_TYPE_LABELS[type]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ── 區塊編輯面板（Modal 浮層） ── */}
      {editingBlock && (
        <BlockEditor
          block={editingBlock}
          zoneColor={zoneColor}
          onSave={updateBlock}
          onCancel={() => setEditingBlockId(null)}
        />
      )}
    </div>
  );
}

// ─── 樣式定義 ────────────────────────────────────────────────────────────────

/** 根容器：全螢幕高度，flex 列 */
const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100dvh',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans)',
  overflow: 'hidden',
};

/** 固定頂部標題列，56px 高 */
const headerStyle: React.CSSProperties = {
  flexShrink: 0,
  height: 56,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 20px',
  background: 'var(--bg-card)',
  borderBottom: '1px solid var(--hairline)',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  zIndex: 100,
};

/** 區域圖示圓框 */
const zoneIconCircleStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  border: '1px solid',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.85rem',
  flexShrink: 0,
};

/** 標題列主標題文字 */
const headerTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '0.9rem',
  color: 'var(--ink-title)',
  letterSpacing: '0.02em',
  lineHeight: 1.2,
};

/** 標題列副標題（path hint） */
const headerSubtitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  color: 'var(--ink-mute)',
  letterSpacing: '0.06em',
  marginTop: 2,
};

/** 「未儲存的變更」提示文字 */
const dirtyIndicatorStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  color: '#f59e0b',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

/** 儲存狀態小徽章 */
const statusChipStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

/** 儲存按鈕 */
const saveButtonStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  padding: '6px 16px',
  border: '1px solid',
  borderRadius: 3,
  color: '#fff',
  fontWeight: 700,
  transition: 'opacity 150ms ease',
  whiteSpace: 'nowrap',
};

/** 返回連結 */
const backLinkStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  color: 'var(--ink-soft)',
  textDecoration: 'none',
  padding: '6px 10px',
  border: '1px solid var(--hairline)',
  borderRadius: 3,
  whiteSpace: 'nowrap',
  transition: 'color 150ms ease',
};

/** 錯誤橫幅（儲存失敗時顯示在 header 下方） */
const errorBannerStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '8px 20px',
  background: '#450a0a',
  borderBottom: '1px solid #7f1d1d',
  fontSize: '0.8rem',
  color: '#fca5a5',
  fontFamily: 'var(--font-sans)',
};

/** 可捲動主體 */
const mainStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** 內容區最大寬度容器 */
const contentWrapStyle: React.CSSProperties = {
  maxWidth: 920,
  margin: '0 auto',
  padding: '24px',
};

/** 區塊列表 flex 容器 */
const blockListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** 空狀態或載入中的佔位容器 */
const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '64px 24px',
  textAlign: 'center',
};

/** 載入錯誤卡片 */
const loadErrorStyle: React.CSSProperties = {
  padding: '24px',
  background: 'var(--bg-card)',
  border: '1px solid #7f1d1d',
  borderRadius: 6,
  textAlign: 'center',
};

/** 重新載入按鈕 */
const retryButtonStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  letterSpacing: '0.06em',
  padding: '6px 14px',
  background: 'transparent',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 3,
  color: 'var(--ink-soft)',
  cursor: 'pointer',
};

/** [+ 新增區塊] 虛線按鈕 */
const addBlockButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '12px',
  background: 'transparent',
  border: '1px dashed',
  borderRadius: 4,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  letterSpacing: '0.06em',
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'color 150ms ease, border-color 150ms ease',
};

/** 下拉選單容器 */
const addMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  background: 'var(--bg-card)',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 4,
  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  zIndex: 500,
  overflow: 'hidden',
};

/** 下拉選單項目 */
const addMenuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--hairline)',
  cursor: 'pointer',
  textAlign: 'left',
  color: 'var(--ink)',
  transition: 'background 100ms ease, color 100ms ease',
  gap: 4,
};
