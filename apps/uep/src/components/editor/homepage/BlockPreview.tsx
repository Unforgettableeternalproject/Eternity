// ─── 首頁區塊預覽元件 ────────────────────────────────────────────────────────
// 在管理介面中顯示各種區塊類型的簡化視覺預覽

import React from 'react';
import type {
  HomepageBlock,
  HomepageBlockType,
  ZoneHeaderData,
  UepDialogueItem,
  ArchwayCard,
  OrbCluster,
  CrossRoad,
  TerminalModule,
  StorageLink,
} from './types';
import { BLOCK_TYPE_LABELS } from './types';

// ─── Props 型別 ─────────────────────────────────────────────────────────────

interface BlockPreviewProps {
  block: HomepageBlock;
  /** 區域主色（如 '#6b3f2a'），用於強調色 */
  zoneColor: string;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

// ─── 個別類型預覽元件 ────────────────────────────────────────────────────────

/** 區域標題預覽 */
function ZoneHeaderPreview({ data }: { data: ZoneHeaderData }) {
  return (
    <div style={{ padding: '8px 12px' }}>
      <div
        style={{
          fontFamily: 'var(--font-serif-tc)',
          fontSize: '1.25rem',
          color: 'var(--ink-title)',
          marginBottom: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.title || '（未設定標題）'}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-serif-tc)',
          fontSize: '0.8rem',
          fontStyle: 'italic',
          color: 'var(--ink-soft)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.subtitle || '（未設定副標題）'}
      </div>
    </div>
  );
}

/** UEP 對話預覽 */
function UepDialoguePreview({
  data,
  zoneColor,
}: {
  data: UepDialogueItem[];
  zoneColor: string;
}) {
  // 最多顯示 3 條對話氣泡
  const visible = data.slice(0, 3);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無對話內容）
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {visible.map((item, i) => {
        const isRight = item.side === 'right';
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: isRight ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '75%',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: '0.75rem',
                lineHeight: 1.4,
                background: isRight ? zoneColor : 'var(--bg-soft)',
                color: isRight ? '#fff' : 'var(--ink)',
                border: isRight ? 'none' : '1px solid var(--hairline)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.text || '…'}
            </div>
          </div>
        );
      })}
      {data.length > 3 && (
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--ink-mute)',
            textAlign: 'center',
          }}
        >
          …還有 {data.length - 3} 條
        </div>
      )}
    </div>
  );
}

/** 拱門卡片預覽 */
function ArchwayGridPreview({ data }: { data: { cards: ArchwayCard[] } }) {
  const visible = data.cards.slice(0, 4);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無卡片）
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '8px 12px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}
    >
      {visible.map((card, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '4px 8px',
            borderRadius: '12px 12px 4px 4px',
            background: 'var(--bg-soft)',
            border: '1px solid var(--hairline)',
            fontSize: '0.7rem',
            minWidth: 56,
          }}
        >
          <span style={{ color: 'var(--uep-gold)', fontWeight: 600 }}>
            {card.tag || '#'}
          </span>
          <span
            style={{
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 64,
            }}
          >
            {card.name || '—'}
          </span>
          <span style={{ color: 'var(--ink-mute)', fontSize: '0.65rem' }}>
            {card.stateLabel || card.state}
          </span>
        </div>
      ))}
      {data.cards.length > 4 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.7rem',
            color: 'var(--ink-mute)',
          }}
        >
          +{data.cards.length - 4}
        </div>
      )}
    </div>
  );
}

/** 提示文字預覽 */
function HintBoxPreview({
  data,
  zoneColor,
}: {
  data: { text: string };
  zoneColor: string;
}) {
  return (
    <div
      style={{
        margin: '8px 12px',
        padding: '8px 10px',
        borderLeft: `3px solid ${zoneColor}`,
        background: 'var(--bg-soft)',
        fontSize: '0.8rem',
        color: 'var(--ink)',
        lineHeight: 1.5,
        maxHeight: 80,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
      }}
    >
      {data.text || '（未設定提示文字）'}
    </div>
  );
}

/** 回聲集群預覽 */
function OrbClusterGridPreview({ data }: { data: { clusters: OrbCluster[] } }) {
  const visible = data.clusters.slice(0, 5);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無集群）
      </div>
    );
  }

  return (
    <div
      style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 8 }}
    >
      {visible.map((cluster, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: cluster.color || 'var(--uep-gold)',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>
            {cluster.label || '—'}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--ink-mute)' }}>
            ×{cluster.orbCount}
          </span>
        </div>
      ))}
      {data.clusters.length > 5 && (
        <span style={{ fontSize: '0.7rem', color: 'var(--ink-mute)' }}>
          +{data.clusters.length - 5}
        </span>
      )}
    </div>
  );
}

/** 十字路口預覽 */
function CrossRoadGridPreview({ data }: { data: { roads: CrossRoad[] } }) {
  // 依方向對應箭頭符號
  const arrowMap: Record<string, string> = {
    fwd: '↑',
    bck: '↓',
    lft: '←',
    rgt: '→',
  };

  const visible = data.roads.slice(0, 4);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無路口）
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {visible.map((road, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8rem',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--uep-gold)',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            {arrowMap[road.area] ?? '•'}
          </span>
          <span
            style={{
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 160,
            }}
          >
            {road.name || '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 終端模組表預覽 */
function TerminalModuleTablePreview({
  data,
}: {
  data: { headerLabel: string; modules: TerminalModule[] };
}) {
  const visible = data.modules.slice(0, 4);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無模組）
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '6px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      {data.headerLabel && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            color: 'var(--uep-gold)',
            marginBottom: 2,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {data.headerLabel}
        </div>
      )}
      {visible.map((mod, i) => (
        <div
          key={i}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--ink-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: mod.state === 'sync' ? '#4caf50' : 'var(--ink-mute)',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 180,
            }}
          >
            {mod.name || mod.en || mod.id}
          </span>
        </div>
      ))}
      {data.modules.length > 4 && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            color: 'var(--ink-mute)',
          }}
        >
          … +{data.modules.length - 4} 個模組
        </div>
      )}
    </div>
  );
}

/** 便條紙預覽 */
function StorageStickyNotePreview({
  data,
}: {
  data: { text: string; attribution: string };
}) {
  return (
    <div
      style={{
        margin: '8px 12px',
        padding: '8px 10px',
        background: '#fef9c3',
        border: '1px solid #fde047',
        borderRadius: 4,
        maxHeight: 90,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: '0.8rem',
          color: '#713f12',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
          overflow: 'hidden',
        }}
      >
        {data.text || '（未設定文字）'}
      </div>
      {data.attribution && (
        <div
          style={{
            fontSize: '0.65rem',
            color: '#92400e',
            marginTop: 4,
            fontStyle: 'italic',
            textAlign: 'right',
          }}
        >
          — {data.attribution}
        </div>
      )}
    </div>
  );
}

/** 儲藏連結列表預覽 */
function StorageLinksListPreview({ data }: { data: { links: StorageLink[] } }) {
  const visible = data.links.slice(0, 4);

  if (visible.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無連結）
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '6px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {visible.map((link, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            fontSize: '0.8rem',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--uep-gold)',
              fontSize: '0.7rem',
              flexShrink: 0,
              minWidth: 20,
            }}
          >
            {link.num || String(i + 1).padStart(2, '0')}
          </span>
          <span
            style={{
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 180,
            }}
          >
            {link.title || link.file || '—'}
          </span>
        </div>
      ))}
      {data.links.length > 4 && (
        <div style={{ fontSize: '0.7rem', color: 'var(--ink-mute)' }}>
          … 還有 {data.links.length - 4} 個連結
        </div>
      )}
    </div>
  );
}

/** 置物空間地圖預覽 */
function StorageRoomMapPreview({
  data,
}: {
  data: {
    areas: { icon: string; name: string; label: string; slug: string }[];
  };
}) {
  if (data.areas.length === 0) {
    return (
      <div
        style={{
          padding: '8px 12px',
          color: 'var(--ink-mute)',
          fontSize: '0.8rem',
        }}
      >
        （無區域）
      </div>
    );
  }
  return (
    <div
      style={{ padding: '6px 12px', display: 'flex', gap: 8, flexWrap: 'wrap' }}
    >
      {data.areas.map((area, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            border: '1px solid var(--hairline)',
            borderLeft: '2px solid var(--uep-gold)',
            fontSize: '0.8rem',
          }}
        >
          <span style={{ fontSize: '1rem' }}>{area.icon}</span>
          <span style={{ fontWeight: 600, color: 'var(--ink-title)' }}>
            {area.name}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65rem',
              color: 'var(--ink-mute)',
              letterSpacing: '0.1em',
            }}
          >
            {area.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 富文本預覽 */
function RichTextPreview({ data }: { data: { html: string } }) {
  return (
    <div
      style={{
        margin: '8px 12px',
        maxHeight: 100,
        overflow: 'hidden',
        fontSize: '0.8rem',
        color: 'var(--ink-soft)',
        lineHeight: 1.5,
        // 淡出效果
        WebkitMaskImage:
          'linear-gradient(to bottom, black 60%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
      }}
      dangerouslySetInnerHTML={{ __html: data.html || '<p>（無內容）</p>' }}
    />
  );
}

// ─── 區塊預覽分發器 ──────────────────────────────────────────────────────────

function BlockBody({
  block,
  zoneColor,
}: {
  block: HomepageBlock;
  zoneColor: string;
}) {
  const data = block.data as any;

  switch (block.type as HomepageBlockType) {
    case 'zone-header':
      return <ZoneHeaderPreview data={data} />;
    case 'uep-dialogue':
      return (
        <UepDialoguePreview
          data={Array.isArray(data) ? data : []}
          zoneColor={zoneColor}
        />
      );
    case 'archway-grid':
      return <ArchwayGridPreview data={data} />;
    case 'hint-box':
      return <HintBoxPreview data={data} zoneColor={zoneColor} />;
    case 'orb-cluster-grid':
      return <OrbClusterGridPreview data={data} />;
    case 'cross-road-grid':
      return <CrossRoadGridPreview data={data} />;
    case 'terminal-module-table':
      return <TerminalModuleTablePreview data={data} />;
    case 'storage-sticky-note':
      return <StorageStickyNotePreview data={data} />;
    case 'storage-links-list':
      return <StorageLinksListPreview data={data} />;
    case 'storage-room-map':
      return <StorageRoomMapPreview data={data} />;
    case 'rich-text':
      return <RichTextPreview data={data} />;
    default:
      return (
        <div
          style={{
            padding: '8px 12px',
            color: 'var(--ink-mute)',
            fontSize: '0.8rem',
          }}
        >
          （未知區塊類型）
        </div>
      );
  }
}

// ─── 主元件 ──────────────────────────────────────────────────────────────────

export function BlockPreview({
  block,
  zoneColor,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: BlockPreviewProps) {
  const label = BLOCK_TYPE_LABELS[block.type] ?? block.type;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--hairline)',
        borderRadius: 6,
        overflow: 'hidden',
        transition: `box-shadow var(--ease, 0.2s ease)`,
      }}
    >
      {/* 頂部工具列 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          background: 'var(--bg-soft)',
          borderBottom: '1px solid var(--hairline-strong, var(--hairline))',
        }}
      >
        {/* 區塊類型標籤 */}
        <span
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--ink-mute)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>

        {/* 上移按鈕 */}
        {onMoveUp && (
          <button
            onClick={onMoveUp}
            title="上移"
            style={iconButtonStyle}
            aria-label="上移區塊"
          >
            ↑
          </button>
        )}

        {/* 下移按鈕 */}
        {onMoveDown && (
          <button
            onClick={onMoveDown}
            title="下移"
            style={iconButtonStyle}
            aria-label="下移區塊"
          >
            ↓
          </button>
        )}

        {/* 編輯按鈕 */}
        <button
          onClick={onEdit}
          style={{
            ...actionButtonStyle,
            color: 'var(--ink-soft)',
            borderColor: 'var(--hairline)',
          }}
          aria-label="編輯區塊"
        >
          編輯
        </button>

        {/* 刪除按鈕 */}
        <button
          onClick={onDelete}
          style={{
            ...actionButtonStyle,
            color: '#ef4444',
            borderColor: '#fca5a5',
          }}
          aria-label="刪除區塊"
        >
          刪除
        </button>
      </div>

      {/* 區塊內容預覽 */}
      <div style={{ minHeight: 40 }}>
        <BlockBody block={block} zoneColor={zoneColor} />
      </div>
    </div>
  );
}

// ─── 共用按鈕樣式 ────────────────────────────────────────────────────────────

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  padding: 0,
  background: 'transparent',
  border: '1px solid var(--hairline)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: '0.75rem',
  color: 'var(--ink-soft)',
  lineHeight: 1,
};

const actionButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 6px',
  background: 'transparent',
  border: '1px solid',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: '0.7rem',
  fontFamily: 'var(--font-sans)',
  lineHeight: 1.4,
};

export default BlockPreview;
