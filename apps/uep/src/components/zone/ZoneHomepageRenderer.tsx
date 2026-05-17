import React from 'react';
import type { ZoneData } from '../../data/zones';
import type {
  HomepageBlock,
  ZoneHeaderData,
  UepDialogueItem,
  ArchwayCard,
  OrbCluster,
  CrossRoad,
  TerminalModule,
  StorageLink,
} from '../editor/homepage/types';
import UepDialogue from '../ui/UepDialogue';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';

// ─── 元件 Props ────────────────────────────────────────────────────────────

interface ZoneHomepageRendererProps {
  /** 從 D1 取回並解析過的 HomepageBlock 陣列 */
  blocks: HomepageBlock[];
  /** 當前區域資料（從 zones.ts 取得） */
  zone: ZoneData;
}

// ─── 歷史區專用字元粒子常數 ───────────────────────────────────────────────

const HISTORY_CHARS = '史傳誌卷章序錄書頁遺憶典言述';

// ─── 各區塊渲染函式 ────────────────────────────────────────────────────────

/** 1. zone-header — 區域標題 + 副標題 */
function renderZoneHeader(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  const data = block.data as ZoneHeaderData;

  return (
    <div key={block.id}>
      {/* 麵包屑 kicker */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'var(--ink-mute)',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 36,
            height: 1,
            background: zone.main,
            flexShrink: 0,
          }}
        />
        <span>
          {zone.kicker} · {zone.en.toUpperCase()}
        </span>
      </div>

      {/* 大標題 */}
      <h1
        className="zone-entry-h1"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 500,
          color: 'var(--ink-title)',
          lineHeight: 1,
          margin: '0 0 20px',
          letterSpacing: '-0.02em',
        }}
      >
        {data.title}
      </h1>

      {/* 副標題 */}
      <p
        style={{
          fontFamily: 'var(--font-serif-tc)',
          fontSize: 16,
          color: 'var(--ink-soft)',
          fontStyle: 'italic',
          lineHeight: 1.8,
          marginBottom: 36,
          maxWidth: 560,
        }}
      >
        {data.subtitle}
      </p>
    </div>
  );
}

/** 2. uep-dialogue — UEP 對話泡泡列 */
function renderUepDialogue(block: HomepageBlock): React.ReactNode {
  const items = block.data as UepDialogueItem[];

  return (
    <div key={block.id} style={{ marginBottom: 48 }}>
      {items.map((item, idx) => (
        <UepDialogue
          key={idx}
          side={item.side}
          text={item.text}
          effects={(item.effects ?? []) as Array<'shimmer' | 'glow' | 'halo'>}
        />
      ))}
    </div>
  );
}

/** 3. archway-grid — 拱門卡片格（歷史區用） */
function renderArchwayGrid(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  const { cards } = block.data as { cards: ArchwayCard[] };

  return (
    <div key={block.id}>
      <div
        className="zone-arch-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
          marginBottom: 36,
        }}
      >
        {cards.map((card) => {
          const isOpen = card.state === 'open';
          const isGray = card.state !== 'open';

          return (
            <div
              key={card.tag}
              style={{
                height: 360,
                borderRadius: '160px 160px 4px 4px',
                border: `1px solid ${zone.main}${isGray ? '40' : '80'}`,
                background: isGray
                  ? 'var(--bg-soft)'
                  : `linear-gradient(180deg, ${zone.main}18 0%, ${zone.main}06 100%)`,
                filter: isGray ? 'grayscale(0.8)' : 'none',
                opacity: isGray ? 0.55 : 1,
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 28,
                cursor: isOpen ? 'pointer' : 'default',
              }}
            >
              {/* 拱頂中線 */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 2,
                  height: 28,
                  background: zone.main,
                  opacity: 0.7,
                }}
              />

              {/* 標籤 tag */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  color: zone.main,
                  marginBottom: 16,
                  marginTop: 8,
                }}
              >
                {card.tag}
              </div>

              {/* 開啟狀態：漂浮文字粒子 */}
              {isOpen && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <span
                      key={i}
                      style={
                        {
                          position: 'absolute',
                          left: `${15 + i * 16}%`,
                          top: `${40 + (i % 3) * 15}%`,
                          fontFamily: 'var(--font-display)',
                          fontSize: 11 + (i % 2) * 4,
                          color: zone.main,
                          opacity: 0,
                          animation: `drift ${10 + i * 2}s ${i * 0.8}s linear infinite`,
                          '--drift-x': '4px',
                          '--drift-y': '-50px',
                          '--drift-opacity': '0.3',
                        } as React.CSSProperties
                      }
                    >
                      {HISTORY_CHARS[(i * 3) % HISTORY_CHARS.length]}
                    </span>
                  ))}
                </div>
              )}

              {/* 卡片名稱 */}
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 18,
                  color: 'var(--ink-title)',
                  fontWeight: 500,
                  textAlign: 'center',
                  padding: '0 20px',
                  marginTop: 'auto',
                  marginBottom: 20,
                }}
              >
                {card.name}
              </div>

              {/* 狀態標籤 */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.22em',
                  color: isGray ? 'var(--ink-mute)' : zone.main,
                  marginBottom: 20,
                  textTransform: 'uppercase',
                }}
              >
                {card.stateLabel}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 4. hint-box — 左邊框提示框 */
function renderHintBox(block: HomepageBlock, zone: ZoneData): React.ReactNode {
  const { text } = block.data as { text: string };

  return (
    <div
      key={block.id}
      style={{
        fontFamily: 'var(--font-serif-tc)',
        fontSize: 13,
        color: 'var(--ink-mute)',
        padding: '14px 20px',
        border: `1px solid var(--hairline)`,
        borderLeft: `3px solid ${zone.main}60`,
        background: 'var(--bg-soft)',
        lineHeight: 1.7,
        marginBottom: 24,
      }}
    >
      {text}
    </div>
  );
}

/** 5. orb-cluster-grid — 回聲球集群格（Echoes 區用） */
function renderOrbClusterGrid(block: HomepageBlock): React.ReactNode {
  const { clusters } = block.data as { clusters: OrbCluster[] };

  const orbPulseStyle = `
    @keyframes orb-pulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.85; }
      50% { transform: translate(-50%, -50%) scale(1.12); opacity: 1; }
    }
    @keyframes orb-pulse-sm {
      0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
      50% { transform: translate(-50%, -50%) scale(1.08); opacity: 0.9; }
    }
  `;

  return (
    <div key={block.id}>
      <style>{orbPulseStyle}</style>
      <div
        className="zone-cluster-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {clusters.map((cluster) => {
          const r = 36;
          const orbs = Array.from({ length: cluster.orbCount }, (_, i) => {
            const angle = (i / cluster.orbCount) * Math.PI * 2 - Math.PI / 2;
            const offset = (i % 2) * 10;
            return {
              x: Math.cos(angle) * (r + offset),
              y: Math.sin(angle) * (r + offset),
              size: 7 + (i % 3) * 3,
              orbIndex: i,
            };
          });

          return (
            <div
              key={cluster.label}
              style={{
                padding: '24px 20px',
                background: 'var(--bg-card)',
                border: `1px solid var(--hairline)`,
                borderTop: `2px solid ${cluster.color}`,
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
              }}
            >
              {/* 球形群 */}
              <div
                style={{
                  position: 'relative',
                  width: 110,
                  height: 110,
                  flexShrink: 0,
                }}
              >
                {/* 中心主球 */}
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: cluster.color,
                    boxShadow: `0 0 14px 4px ${cluster.color}55`,
                    animation: 'orb-pulse 3s ease-in-out infinite',
                  }}
                />
                {/* 外圍衛星球 */}
                {orbs.map((orb) => (
                  <div
                    key={orb.orbIndex}
                    style={{
                      position: 'absolute',
                      top: `calc(50% + ${orb.y}px)`,
                      left: `calc(50% + ${orb.x}px)`,
                      width: orb.size,
                      height: orb.size,
                      borderRadius: '50%',
                      background: cluster.color,
                      opacity: 0.55 + (orb.orbIndex % 3) * 0.15,
                      animation: `orb-pulse-sm ${2.5 + orb.orbIndex * 0.3}s ${orb.orbIndex * 0.2}s ease-in-out infinite`,
                    }}
                  />
                ))}
              </div>

              {/* 類別標籤 */}
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 15,
                  color: 'var(--ink-title)',
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              >
                {cluster.label}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: cluster.color,
                  letterSpacing: '0.14em',
                }}
              >
                {cluster.orbCount} echoes
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 6. cross-road-grid — 羅盤十字路口（Visuals 區用） */
function renderCrossRoadGrid(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  const { roads } = block.data as { roads: CrossRoad[] };

  return (
    <div key={block.id} style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gridTemplateRows: '1fr 1fr 1fr',
          gridTemplateAreas: '". fwd ." "lft ctr rgt" ". bck ."',
          gap: 16,
          maxWidth: 680,
          margin: '0 auto',
        }}
      >
        {/* 中心羅盤 SVG */}
        <div
          style={{
            gridArea: 'ctr',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <svg width={110} height={110} viewBox="0 0 110 110">
            <circle
              cx={55}
              cy={55}
              r={48}
              fill="none"
              stroke={zone.main}
              strokeOpacity={0.3}
              strokeWidth={1}
            />
            <circle
              cx={55}
              cy={55}
              r={36}
              fill="none"
              stroke={zone.main}
              strokeOpacity={0.15}
              strokeWidth={0.5}
              strokeDasharray="3 4"
            />
            {/* 十字準心線 */}
            <line
              x1={55}
              y1={7}
              x2={55}
              y2={103}
              stroke={zone.main}
              strokeOpacity={0.4}
              strokeWidth={0.8}
            />
            <line
              x1={7}
              y1={55}
              x2={103}
              y2={55}
              stroke={zone.main}
              strokeOpacity={0.4}
              strokeWidth={0.8}
            />
            {/* 中心符號 */}
            <text
              x={55}
              y={60}
              textAnchor="middle"
              fontFamily="var(--font-display)"
              fontSize={20}
              fill={zone.main}
              fillOpacity={0.85}
            >
              ✦
            </text>
          </svg>
        </div>

        {/* 各方向道路卡片 */}
        {roads.map((road) => (
          <a
            key={road.area}
            href={road.href}
            style={{
              gridArea: road.area,
              textDecoration: 'none',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems:
                road.area === 'lft'
                  ? 'flex-end'
                  : road.area === 'rgt'
                    ? 'flex-start'
                    : 'center',
              padding: '18px 16px',
              border: `1px solid ${zone.main}30`,
              borderRadius: 4,
              background: `${zone.main}06`,
              textAlign:
                road.area === 'lft'
                  ? 'right'
                  : road.area === 'rgt'
                    ? 'left'
                    : 'center',
              transition:
                'background 0.2s var(--ease), border-color 0.2s var(--ease)',
              gap: 6,
            }}
          >
            {/* 方向標籤 */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: zone.main,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              {road.dir}
            </div>
            {/* 地點名稱 */}
            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--ink-title)',
              }}
            >
              {road.name}
            </div>
            {/* 提示文字 */}
            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 12,
                color: 'var(--ink-mute)',
                fontStyle: 'italic',
              }}
            >
              {road.hint}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

/** 7. terminal-module-table — 終端模組列表（Concepts 區用） */
function renderTerminalModuleTable(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  const { headerLabel, modules } = block.data as {
    headerLabel: string;
    modules: TerminalModule[];
  };

  return (
    <div key={block.id} style={{ marginBottom: 24 }}>
      <div
        style={{
          border: `1px solid ${zone.main}50`,
          borderRadius: 4,
          overflow: 'hidden',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {/* 標題列 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            background: `${zone.main}12`,
            borderBottom: `1px solid ${zone.main}30`,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: zone.soft,
              letterSpacing: '0.08em',
            }}
          >
            {headerLabel}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
            {modules.length} units
          </span>
        </div>

        {/* 各模組資料列 */}
        {modules.map((mod, i) => (
          <div
            key={mod.id}
            className="zone-module-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '36px 1fr 1fr 80px 64px 24px',
              alignItems: 'center',
              gap: 12,
              padding: '14px 20px',
              borderBottom:
                i < modules.length - 1 ? `1px solid ${zone.main}18` : 'none',
              background: i % 2 === 0 ? `${zone.main}04` : 'transparent',
            }}
          >
            {/* id 編號 */}
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-mute)',
                letterSpacing: '0.1em',
              }}
            >
              {mod.id}
            </span>
            {/* 中文名稱 */}
            <span
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 15,
                color: 'var(--ink-title)',
                fontWeight: 500,
              }}
            >
              {mod.name}
            </span>
            {/* 英文識別碼 */}
            <span
              className="zone-module-en"
              style={{
                fontSize: 11,
                color: 'var(--ink-mute)',
                letterSpacing: '0.04em',
              }}
            >
              {mod.en}
            </span>
            {/* 狀態指示燈 + 標籤 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background:
                    mod.state === 'sync' ? '#4ade80' : 'var(--ink-mute)',
                  boxShadow:
                    mod.state === 'sync' ? '0 0 6px 2px #4ade8060' : 'none',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: mod.state === 'sync' ? '#4ade80' : 'var(--ink-mute)',
                }}
              >
                {mod.state}
              </span>
            </div>
            {/* 記錄數 */}
            <span
              style={{
                fontSize: 11,
                color: 'var(--ink-mute)',
                textAlign: 'right',
              }}
            >
              {mod.records} rec
            </span>
            {/* 箭頭 */}
            <span style={{ fontSize: 12, color: zone.main, opacity: 0.6 }}>
              ›
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 8. storage-sticky-note — 黃色便條紙（Storage 區用） */
function renderStorageStickyNote(block: HomepageBlock): React.ReactNode {
  const { text, attribution } = block.data as {
    text: string;
    attribution: string;
  };

  // 將換行符轉換為 JSX 行
  const lines = text.split('\n');

  return (
    <div key={block.id} style={{ position: 'relative', marginBottom: 24 }}>
      <div
        style={{
          position: 'relative',
          background: 'linear-gradient(180deg, #FBE782 0%, #F5D960 100%)',
          color: '#3a2f08',
          padding: '28px 28px 24px',
          borderRadius: 2,
          transform: 'rotate(-1.5deg)',
          boxShadow: '2px 4px 18px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
      >
        {/* 折角三角形 */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 0,
            height: 0,
            borderTop: '28px solid #d4b94a',
            borderLeft: '28px solid transparent',
          }}
        />
        {/* 便條文字 */}
        <div
          style={{
            fontFamily: 'var(--font-serif-tc)',
            fontSize: 14,
            lineHeight: 2,
            color: '#3a2f08',
            marginBottom: 20,
          }}
        >
          {lines.map((line, idx) => (
            <React.Fragment key={idx}>
              {line}
              {idx < lines.length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>
        {/* 署名 */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: '#5a4a18',
            letterSpacing: '0.1em',
            textAlign: 'right',
          }}
        >
          {attribution}
        </div>
      </div>
      {/* 便條下方的引述文字 */}
      <p
        style={{
          fontFamily: 'var(--font-serif-tc)',
          fontSize: 13,
          color: 'var(--ink-mute)',
          fontStyle: 'italic',
          marginTop: 16,
          marginLeft: 8,
          lineHeight: 1.7,
        }}
      >
        嗯，是 U.E.P 留的，絕對是的。
      </p>
    </div>
  );
}

/** 9. storage-links-list — 編號連結列表（Storage 區用） */
function renderStorageLinksList(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  const { links } = block.data as { links: StorageLink[] };

  return (
    <div
      key={block.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        marginBottom: 24,
      }}
    >
      {links.map((link) => (
        <a
          key={link.num}
          href={link.href}
          style={{
            textDecoration: 'none',
            display: 'grid',
            gridTemplateColumns: '36px 1fr 20px',
            alignItems: 'center',
            gap: 12,
            padding: '16px 18px',
            border: `1px solid var(--hairline)`,
            borderRadius: 3,
            background: 'var(--bg-card)',
            transition:
              'border-color 0.18s var(--ease), background 0.18s var(--ease)',
          }}
        >
          {/* 編號 */}
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              color: 'var(--ink-mute)',
              fontStyle: 'italic',
              lineHeight: 1,
              opacity: 0.6,
            }}
          >
            {link.num}
          </span>
          {/* 標題 + 檔案路徑 + 提示 */}
          <div>
            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 15,
                color: 'var(--ink-title)',
                fontWeight: 500,
                marginBottom: 3,
              }}
            >
              {link.title}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: zone.soft,
                letterSpacing: '0.08em',
                marginBottom: 3,
              }}
            >
              {link.file}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-serif-tc)',
                fontSize: 12,
                color: 'var(--ink-mute)',
                fontStyle: 'italic',
              }}
            >
              {link.hint}
            </div>
          </div>
          {/* 箭頭 */}
          <span
            style={{
              fontSize: 16,
              color: 'var(--ink-mute)',
              opacity: 0.5,
            }}
          >
            ›
          </span>
        </a>
      ))}
    </div>
  );
}

/** 10. storage-room-map — 置物空間導航地圖（Storage 區用） */
function renderStorageRoomMap(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  const { areas } = block.data as {
    areas: { icon: string; name: string; label: string; hint: string; slug: string }[];
  };

  return (
    <div
      key={block.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        margin: '18px 0 24px',
      }}
    >
      {areas.map((area) => (
        <a
          key={area.slug}
          href={`?clearing=${area.slug}`}
          style={{
            textDecoration: 'none',
            display: 'grid',
            gridTemplateColumns: '48px 1fr 24px',
            alignItems: 'center',
            gap: 16,
            padding: '18px 20px',
            border: '1px solid var(--hairline)',
            borderLeft: `3px solid ${zone.main || '#D5B618'}`,
            background: 'var(--bg-card)',
            color: 'inherit',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
        >
          <span
            style={{
              width: 42,
              height: 42,
              display: 'grid',
              placeItems: 'center',
              fontSize: 20,
              color: zone.main || '#D5B618',
              border: `1px solid color-mix(in srgb, ${zone.main || '#D5B618'} 30%, transparent)`,
            }}
          >
            {area.icon}
          </span>
          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.22em',
                textTransform: 'uppercase' as const,
                color: zone.main || '#D5B618',
              }}
            >
              {area.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--ink-title)',
              }}
            >
              {area.name}
            </div>
            {area.hint && (
              <div
                style={{
                  fontFamily: 'var(--font-serif-tc)',
                  fontSize: 12,
                  color: 'var(--ink-soft)',
                  fontStyle: 'italic',
                  marginTop: 2,
                }}
              >
                {area.hint}
              </div>
            )}
          </div>
          <span style={{ fontSize: 16, color: zone.main || '#D5B618' }}>→</span>
        </a>
      ))}
    </div>
  );
}

/** 11. rich-text — 純 HTML 富文本 */
function renderRichText(block: HomepageBlock): React.ReactNode {
  const { html } = block.data as { html: string };

  return (
    <div
      key={block.id}
      className="prose"
      style={{
        fontFamily: 'var(--font-serif-tc)',
        fontSize: 15,
        lineHeight: 1.8,
        color: 'var(--ink-soft)',
        marginBottom: 24,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Storage 區使用雙欄版面，便條紙 + 連結並排 ──────────────────────────

/**
 * 判斷是否需要將 storage-sticky-note 與 storage-links-list
 * 組合成雙欄版面（仿照原始 StorageEntry 的 zone-storage-grid）。
 */
function renderBlocksWithStorageLayout(
  blocks: HomepageBlock[],
  zone: ZoneData
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    // 若偵測到連續的 storage-sticky-note + storage-links-list，合併為雙欄
    if (
      block.type === 'storage-sticky-note' &&
      i + 1 < blocks.length &&
      blocks[i + 1].type === 'storage-links-list'
    ) {
      result.push(
        <div
          key={`storage-2col-${i}`}
          className="zone-storage-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 36,
            alignItems: 'start',
            marginBottom: 24,
          }}
        >
          {/* 左欄：便條紙 */}
          <div>{renderStorageStickyNote(block)}</div>
          {/* 右欄：連結列表 */}
          <div>{renderStorageLinksList(blocks[i + 1], zone)}</div>
        </div>
      );
      i += 2;
      continue;
    }

    // 一般區塊正常渲染
    result.push(renderSingleBlock(block, zone));
    i++;
  }

  return result;
}

/** 單一區塊分派函式 */
function renderSingleBlock(
  block: HomepageBlock,
  zone: ZoneData
): React.ReactNode {
  switch (block.type) {
    case 'zone-header':
      return renderZoneHeader(block, zone);
    case 'uep-dialogue':
      return renderUepDialogue(block);
    case 'archway-grid':
      return renderArchwayGrid(block, zone);
    case 'hint-box':
      return renderHintBox(block, zone);
    case 'orb-cluster-grid':
      return renderOrbClusterGrid(block);
    case 'cross-road-grid':
      return renderCrossRoadGrid(block, zone);
    case 'terminal-module-table':
      return renderTerminalModuleTable(block, zone);
    case 'storage-sticky-note':
      return renderStorageStickyNote(block);
    case 'storage-links-list':
      return renderStorageLinksList(block, zone);
    case 'storage-room-map':
      return renderStorageRoomMap(block, zone);
    case 'rich-text':
      return renderRichText(block);
    default:
      // 未知區塊類型：開發時顯示佔位符
      return (
        <div
          key={block.id}
          style={{
            padding: '12px 16px',
            border: '1px dashed var(--hairline)',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--ink-mute)',
            marginBottom: 12,
          }}
        >
          [未知區塊類型: {block.type}]
        </div>
      );
  }
}

// ─── 主元件 ────────────────────────────────────────────────────────────────

/**
 * ZoneHomepageRenderer
 *
 * 讀取 HomepageBlock[] 並渲染完整的視覺區域入口頁面內容，
 * 取代原本硬編碼的 HistoryEntry / EchoesEntry 等元件。
 *
 * 注意：ZoneAtmosphere 及裝飾粒子等背景效果應由外層的
 * ZoneEntryPage 負責渲染，本元件只處理主要內容區塊。
 */
export default function ZoneHomepageRenderer({
  blocks,
  zone,
}: ZoneHomepageRendererProps) {
  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      {/* 區域氛圍背景（繼承原始各區域的視覺效果） */}
      <ZoneAtmosphere zone={zone} intensity="subtle" />

      {/* 主要內容容器 */}
      <div
        className="zone-entry-content"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {renderBlocksWithStorageLayout(blocks, zone)}
      </div>
    </div>
  );
}
