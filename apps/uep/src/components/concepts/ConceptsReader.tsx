import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ZONES } from '../../data/zones';
import { ReaderShell } from '../zone/ReaderShell';
import UepDialogue from '../ui/UepDialogue';
import renderHtmlWithUep from '../ui/renderHtmlWithUep';
import ZoneAtmosphere from '../ui/ZoneAtmosphere';
import {
  type HomepageBlock,
  type ZoneHeaderData,
  type UepDialogueItem,
  fromContentBlock,
} from '../editor/homepage/types';
import type {
  StackDef,
  DossierContent,
  DossierVariant,
  DossierSubcat,
  BrowserContent,
  CharacterProfile,
  ChronoContent,
  ChronoEra,
  ChronoFieldDef,
  ChronoField,
  DiffContent,
  ConceptsVariationMeta,
} from './types';
import { ZoneBreadcrumb } from '../zone/ZoneBreadcrumb';
import { ZoneStateDisplay } from '../zone/ZoneStateDisplay';
import { useScrollMemory } from '../zone/useScrollMemory';
import ZoneBootArt from '../zone/ZoneBootArt';
import { useZoneBootReady } from '../zone/useZoneBootReady';
import { useZoneRouter, pushUrl, clearUrl } from '../zone/useZoneRouter';
import { isHidden, isLocked } from '../zone/contentVisibility';
import { useEntityDragSource } from '../../islands';
import {
  loadEntityIndex,
  type TerminalIndexEntry,
} from '../../islands/concepts/terminalCore';
import { formatAliasLine } from './aliases';
import BrowserDetailButton from './BrowserDetailButton';
import ConceptsTerminalBadge from './ConceptsTerminalBadge';
import InterlinkTriggerButton from './InterlinkTriggerButton';
import { useProgress } from '../../progress/useProgress';
import { evaluateGate, parseGateCondition } from '../../progress/gating';
import { resolveEffectiveViewForPage } from './revision';
import { subcatValueColumns, subcatValueLabels } from './diffTable';
import {
  getCachedEffectiveView,
  invalidatePageCache,
  clearAllRevisionCache,
} from './revisionCache';
import './ConceptsReader.css';
import { getApiBase } from '../../lib/apiBase';
import { canonicalizePagePath } from '../../lib/pagePath';

// ──────────────────────────────────────────────────────────────────
// 型別
// ──────────────────────────────────────────────────────────────────
interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  pageType: string;
  depth: number;
  status: string;
  metadata: Record<string, unknown>;
  children: PageTreeNode[];
}

interface Page {
  id: string;
  title: string;
  slug: string;
  content: { id: string; type: string; content: string }[];
  metadata: Record<string, unknown>;
  pageType: string;
}

// ──────────────────────────────────────────────────────────────────
// 常數
// ──────────────────────────────────────────────────────────────────
const API_BASE = getApiBase();

function resolveAssetUrl(ref: string): string {
  if (ref.startsWith('/api/assets/')) {
    const path = ref.slice('/api/assets/'.length);
    return `${API_BASE}/api/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  return `${API_BASE}/api/assets/${ref.split('/').map(encodeURIComponent).join('/')}`;
}

const CONCEPTS_ZONE = ZONES.find((z) => z.id === 'concepts')!;
const CONC_MAIN = '#2D6A4F';
const CONC_SOFT = '#74C69D';

const STACKS: StackDef[] = [
  {
    id: 'server/records',
    slug: 'server/records',
    label: '永續紀錄主機',
    labelEn: 'PERSISTENT_LOG_SERVER',
    icon: 'Σ',
    style: 'dossier',
    intro:
      '一台不會中斷運作的大型電腦，連接著後方的印表機，不知道都在記錄些甚麼呢？這裡保存著所有關於世界基礎設定的資料——角色列表、地區條列、魔獸紀錄，以及各式理論體系。',
    uepNote:
      '這台印表機的紀錄永遠不會停止喔！因為有新的冒險就會有新的東西需要被記錄下來~ (๑•̀ᗝ•́)و',
  },
  {
    id: 'server/browser',
    slug: 'server/browser',
    label: '個性瀏覽器',
    labelEn: 'IDENTITY_BROWSER',
    icon: 'Φ',
    style: 'browser',
    intro:
      '很多全息投影的視窗在移動著，每一個都正動態地顯示著各種人物的資訊。這裡是角色的深度分析模組——記錄著他們的背景故事、人際關係、以及隱藏的秘密。',
    uepNote:
      '每個人都有屬於自己的祕密呢，不過透過這些視窗你可以稍微看到一些~ (≧▽≦)',
  },
  {
    id: 'server/time_logs',
    slug: 'server/time_logs',
    label: '原質震盪時鐘',
    labelEn: 'ESSENCE_OSCILLATOR',
    icon: '⟳',
    style: 'chrono',
    intro:
      '從遠處就能聽到的鐘擺聲，其真身是一座巨大的電子時鐘。時間軸上的每一個刻度都記載著某個重要的事件，從創世到終結，一切都被精確地標記著。',
    uepNote:
      '時間是很有趣的東西呢！它看起來是直線的，但實際上...嘻嘻，你會慢慢知道的~ ✧',
  },
  {
    id: 'server/translation',
    slug: 'server/translation',
    label: '認知對照平台',
    labelEn: 'COGNITION_COMPARE',
    icon: '⇌',
    style: 'diff',
    intro:
      '在這面大鏡子的前方有一座漂浮著的平台。各種名詞、術語和概念在這裡被翻譯成不同的語言，讓來自不同世界的觀察者都能理解。',
    uepNote: '名字是很重要的喔！同一個人可能在不同地方有不同的稱呼呢~ ( •̀ᴗ•́ )/',
  },
];

const ESSENCE_SYMBOLS = [
  'Σ',
  '∑',
  '∮',
  '∇',
  '∂',
  'Φ',
  'Ψ',
  'Ω',
  'λ',
  'δ',
  'ε',
  'θ',
];

const SYMBOL_ITEMS = ESSENCE_SYMBOLS.map((s, i) => ({
  char: s,
  idx: i,
  style: {
    left: `${(i * 37) % 96}%`,
    top: `${(i * 23) % 92}%`,
    fontSize: 12 + (i % 4) * 5,
    animationDuration: `${24 + (i % 7)}s`,
    animationDelay: `${(i * 0.55) % 14}s`,
  },
}));

// 駭客風飄落字元池（混入二進位、十六進位、特殊符號，盡量看起來像資料流）
const RAIN_GLYPHS = '01010110ABCDEF{}[]<>/\\|+-*=#$%@?!~';

/** 數位雨欄位定義 — 模組層級常數，避免每次 render 重建物件觸發多餘 diff */
const RAIN_COLUMNS = Array.from({ length: 8 }, (_, i) => {
  const seed = i * 37 + 13;
  const len = 6 + (seed % 6);
  return {
    style: {
      left: `${(seed * 7) % 98}%`,
      fontSize: `${11 + (seed % 4)}px`,
      animationDuration: `${24 + ((seed * 3) % 10)}s`,
      animationDelay: `${((seed * 0.6) % 14) - 6}s`,
    },
    chars: Array.from({ length: len }, (_, j) => ({
      char: RAIN_GLYPHS[(seed + j * 5) % RAIN_GLYPHS.length],
      style: {
        animationDuration: `${1.6 + (j % 3) * 0.4}s`,
        animationDelay: `${(j * 0.18) % 1.2}s`,
      },
    })),
  };
});

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/** 將 dossier 資料正規化為 variants 陣列，相容舊版 {subcategories} 結構 */
function normalizeDossierVariants(data: unknown): DossierVariant[] {
  const d = data as Partial<DossierContent> & {
    subcategories?: DossierSubcat[];
  };
  if (d && Array.isArray(d.variants) && d.variants.length > 0)
    return d.variants;
  if (d && Array.isArray(d.subcategories)) {
    return [
      { id: 'default', label: 'DEFAULT', subcategories: d.subcategories },
    ];
  }
  return [{ id: 'default', label: 'DEFAULT', subcategories: [] }];
}

// ──────────────────────────────────────────────────────────────────
// 子元件：ReaderDossier（records stack）
// 接收已選定 variant 的 subcategories；variant 切換由父層控制
// ──────────────────────────────────────────────────────────────────
function ReaderDossier({
  subcategories,
  onOpenBrowserDetail,
}: {
  subcategories: DossierSubcat[];
  /** 導向某 entity 的 browser 檔案（「詳細」按鈕用） */
  onOpenBrowserDetail: (pageId: string, entityKey: string) => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [activeGroup, setActiveGroup] = useState(0);
  /*
   * dossier 條目是 canonical entity 的所在地，也是唯一可以被拖進便條島的
   * 條目型態（艾斯維爾 2026-07-27 定案）——browser／chrono／diff 的同名
   * 條目是引用，不是命名來源，因此那三個 Reader 不掛拖曳來源。
   */
  const entityDrag = useEntityDragSource();

  /*
   * Concepts entity 索引：決定每個條目要不要長出「詳細」按鈕
   * （守門是「browser 查得到已解鎖條目才出現」）。
   * 「相關」按鈕自己載 Echoes／Visuals 兩份索引——它也掛在 browser
   * profile 上，從這裡穿 props 反而要多繞一層。
   */
  const [entityIndex, setEntityIndex] = useState<TerminalIndexEntry[] | null>(
    null
  );
  useEffect(() => {
    let cancelled = false;
    void loadEntityIndex()
      .then((entries) => {
        if (!cancelled) setEntityIndex(entries);
      })
      .catch(() => {
        /* 失敗維持 null——安全預設是不長按鈕 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // effective view 過濾後可能留下空群組/空分類（條目全部未解鎖）——
  // 一律不渲染（含預設「未分類」群組），整頁無可見條目時走 empty fallback
  const visibleSubcats = useMemo(
    () =>
      subcategories
        .map((sc) => ({
          ...sc,
          groups: sc.groups.filter((g) => g.entries.length > 0),
        }))
        .filter((sc) => sc.groups.length > 0),
    [subcategories]
  );

  const subcat = visibleSubcats[activeTab];
  const groups = subcat?.groups || [];
  const currentGroup = groups[activeGroup];

  // 切換 subcat 時重置 group
  useEffect(() => {
    setActiveGroup(0);
  }, [activeTab]);

  // 若 activeTab 超出範圍（variant 切換 / 解鎖狀態變化後 subcats 變少），重置
  useEffect(() => {
    if (activeTab >= visibleSubcats.length) setActiveTab(0);
  }, [visibleSubcats.length, activeTab]);

  // 整頁沒有任何可見條目：終端風格 empty fallback
  if (visibleSubcats.length === 0) {
    return (
      <div className="conc-dossier-empty-page">
        <div className="conc-dossier-list-bar">
          <span>$ ls ./records/</span>
          <span>0 records</span>
        </div>
        <div className="conc-dossier-empty-msg">
          目前沒有可讀取的記錄——隨著閱讀進度推進，這裡會逐漸浮現內容。
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Subcat 選擇器 — 終端路徑風格 */}
      {visibleSubcats.length > 1 && (
        <div className="conc-subcat-selector">
          <div className="conc-subcat-prompt">
            <span className="conc-subcat-prompt-symbol">$</span>
            <span className="conc-subcat-prompt-text">cd ~/records/</span>
          </div>
          <div className="conc-subcat-options">
            {visibleSubcats.map((sc, i) => (
              <button
                key={i}
                className={`conc-subcat-option ${i === activeTab ? 'active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                <span className="conc-subcat-indicator" />
                <span className="conc-subcat-label">{sc.label}</span>
                <span className="conc-subcat-count">
                  {sc.groups.reduce((s, g) => s + g.entries.length, 0)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 左右分欄：group 列表 / group 內容 */}
      <div className="conc-dossier-grid">
        {/* 左欄：group 分類列表 */}
        <div className="conc-dossier-groups">
          <div className="conc-dossier-list-bar">
            <span>$ ls ./{subcat?.label || 'all'}/</span>
            <span>{groups.length} dirs</span>
          </div>
          {groups.map((group, i) => (
            <button
              key={i}
              className={`conc-dossier-group ${i === activeGroup ? 'active' : ''}`}
              onClick={() => setActiveGroup(i)}
            >
              <span className="conc-dossier-group-arrow">
                {i === activeGroup ? '▸' : '·'}
              </span>
              <div className="conc-dossier-group-info">
                <div className="conc-dossier-group-name">
                  {group.label || '未分類'}
                </div>
                <div className="conc-dossier-group-count">
                  {group.entries.length} entries
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* 右欄：條目列表 */}
        <div className="conc-dossier-entries">
          {currentGroup ? (
            <>
              <div className="conc-dossier-detail-bar">
                <span>· {currentGroup.label || '未分類'} ·</span>
                <span className="conc-hl">
                  {currentGroup.entries.length} records
                </span>
              </div>
              <div
                className="conc-dossier-entries-body"
                {...entityDrag.handlers}
              >
                {currentGroup.entries.map((entry, i) => (
                  <div
                    key={i}
                    className="conc-dossier-entry-card"
                    data-entity-key={entry.entityKey}
                  >
                    <div className="conc-dossier-entry-header">
                      <span className="conc-dossier-entry-idx">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="conc-dossier-entry-name">
                        {entry.name}
                      </span>
                      <InterlinkTriggerButton
                        entityKey={entry.entityKey}
                        label={entry.name}
                      />
                      <BrowserDetailButton
                        entityKey={entry.entityKey}
                        label={entry.name}
                        index={entityIndex}
                        onNavigate={onOpenBrowserDetail}
                      />
                    </div>
                    {formatAliasLine(entry.aliases) && (
                      <div className="conc-dossier-entry-aliases">
                        {formatAliasLine(entry.aliases)}
                      </div>
                    )}
                    {entry.content_html && (
                      <>
                        {renderHtmlWithUep(
                          entry.content_html,
                          entry.name,
                          'conc-dossier-entry-content'
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="conc-dossier-detail-empty">選擇一個分類</div>
          )}
        </div>
        {entityDrag.ghost}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 子元件：ReaderBrowserTabs（browser stack）— wiki 瀏覽器式導航
// ──────────────────────────────────────────────────────────────────
function ReaderBrowserTabs({
  data,
  focusEntityKey,
}: {
  data: BrowserContent;
  /** 從 dossier「詳細」按鈕過來時要直接展開的 entity（S10-1） */
  focusEntityKey?: string;
}) {
  const [navPath, setNavPath] = useState<string[]>([]);
  /*
   * 從「詳細」按鈕過來時直接展開對應的 profile。
   *
   * 用 lazy initializer 而非 useEffect 同步：`renderReading()` 外層的
   * `<div key={transitionKey}>` 在每次換頁都 bump，整個子樹強制 remount
   * ——初始值每次都會重算，不需要額外的同步邏輯。
   *
   * ⚠️ findIndex 找不到會回 -1，一定要轉成 null；直接塞 -1 會被
   * `viewingIdx !== null` 判為「有選中」而展開錯誤的第一筆。
   */
  const [viewingIdx, setViewingIdx] = useState<number | null>(() => {
    if (!focusEntityKey) return null;
    const idx = data.profiles.findIndex((p) => p.entityKey === focusEntityKey);
    return idx >= 0 ? idx : null;
  });

  // 過濾掉佔位 profile（名稱為空或括號包裹的臨時名稱）
  const validProfiles = useMemo(
    () =>
      data.profiles
        .map((p, i) => ({ ...p, _idx: i }))
        .filter((p) => p.name && !p.name.match(/^\(.*\)$/)),
    [data.profiles]
  );

  // 當前路徑下的子分類和角色
  const { subcategories, profiles: currentProfiles } = useMemo(() => {
    const subcatSet = new Set<string>();
    const profs: (CharacterProfile & { _idx: number })[] = [];

    if (data.category_tree) {
      let nodes = data.category_tree;
      for (const seg of navPath) {
        const f = nodes.find((n) => n.label === seg);
        nodes = f?.children || [];
      }
      for (const n of nodes) subcatSet.add(n.label);
    }

    for (const p of validProfiles) {
      const cats = p.categories || [];
      if (!navPath.every((seg, d) => cats[d] === seg)) continue;
      if (cats.length > navPath.length) subcatSet.add(cats[navPath.length]);
      else profs.push(p);
    }
    return { subcategories: [...subcatSet].sort(), profiles: profs };
  }, [validProfiles, data.category_tree, navPath]);

  function countInCategory(catPath: string[]): number {
    return validProfiles.filter((p) => {
      const c = p.categories || [];
      return catPath.every((s, d) => c[d] === s);
    }).length;
  }

  const activeProfile = viewingIdx !== null ? data.profiles[viewingIdx] : null;
  const realProfileCount = validProfiles.filter((p) => !p.placeholder).length;

  // 統一導航列
  const pathSegments = activeProfile
    ? [...(activeProfile.categories || []), activeProfile.name]
    : navPath;

  return (
    <div>
      <div className="conc-enc">
        {/* 統一導航列：地址欄 + 麵包屑 */}
        <div className="conc-enc-navbar">
          <div className="conc-enc-addr-row">
            <span className="conc-enc-addr-icon">Φ</span>
            <span className="conc-enc-addr-text">
              identity://registry
              {pathSegments.length > 0
                ? `/${pathSegments.map((s) => s.toLowerCase().replace(/\s+/g, '_')).join('/')}`
                : ''}
            </span>
            <span className="conc-enc-addr-count">
              {realProfileCount} profiles
            </span>
          </div>
          {(navPath.length > 0 || activeProfile) && (
            <div className="conc-enc-breadcrumb-row">
              <button
                className="conc-enc-nav-btn"
                onClick={() => {
                  if (activeProfile) setViewingIdx(null);
                  else setNavPath((prev) => prev.slice(0, -1));
                }}
              >
                ‹
              </button>
              <button
                className="conc-enc-crumb"
                onClick={() => {
                  setNavPath([]);
                  setViewingIdx(null);
                }}
              >
                首頁
              </button>
              {navPath.map((seg, d) => (
                <React.Fragment key={d}>
                  <span className="conc-enc-crumb-sep">›</span>
                  <button
                    className="conc-enc-crumb"
                    onClick={() => {
                      setNavPath((prev) => prev.slice(0, d + 1));
                      setViewingIdx(null);
                    }}
                  >
                    {seg}
                  </button>
                </React.Fragment>
              ))}
              {activeProfile && (
                <>
                  <span className="conc-enc-crumb-sep">›</span>
                  <span className="conc-enc-crumb-current">
                    {activeProfile.name}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="conc-enc-body">
          {activeProfile ? (
            /* ─── 角色檔案頁 ─── */
            <div className="conc-enc-detail-view">
              {activeProfile.placeholder ? (
                <div className="conc-enc-locked">
                  <div className="conc-enc-locked-sigil">?</div>
                  <div className="conc-enc-locked-name">
                    {activeProfile.name}
                  </div>
                  <div className="conc-enc-locked-msg">
                    access restricted · 此檔案目前無法存取
                  </div>
                </div>
              ) : (
                <div className="conc-enc-profile">
                  <div className="conc-enc-profile-header">
                    <div className="conc-enc-sigil-box">
                      {activeProfile.avatar ? (
                        <img
                          src={resolveAssetUrl(activeProfile.avatar)}
                          alt=""
                          className="conc-enc-avatar-img"
                        />
                      ) : (
                        <span className="conc-enc-sigil">
                          {activeProfile.name?.[0] || '?'}
                        </span>
                      )}
                    </div>
                    <div className="conc-enc-profile-intro">
                      {activeProfile.categories && (
                        <div className="conc-enc-section-tag">
                          {activeProfile.categories.join(' › ')}
                        </div>
                      )}
                      <h3 className="conc-enc-profile-name">
                        {activeProfile.name}
                        <InterlinkTriggerButton
                          entityKey={activeProfile.entityKey}
                          label={activeProfile.name}
                        />
                      </h3>
                    </div>
                  </div>

                  {activeProfile.basic &&
                    Object.keys(activeProfile.basic).length > 0 && (
                      <div className="conc-enc-block">
                        <div className="conc-enc-block-label">
                          <span className="conc-enc-label-icon">◈</span>{' '}
                          基本資料
                        </div>
                        <div className="conc-enc-basic-grid">
                          {Object.entries(activeProfile.basic).map(([k, v]) => (
                            <div key={k} className="conc-enc-basic-row">
                              <span className="conc-enc-basic-key">{k}</span>
                              <span className="conc-enc-basic-val">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {activeProfile.sections?.map((section, si) => (
                    <div key={si} className="conc-enc-block">
                      <div className="conc-enc-block-label">
                        <span className="conc-enc-label-icon">◈</span>{' '}
                        {section.label}
                      </div>
                      <>
                        {renderHtmlWithUep(
                          section.content_html,
                          section.label,
                          'conc-enc-section-content'
                        )}
                      </>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ─── 目錄瀏覽頁 ─── */
            <div className="conc-enc-browse">
              {subcategories.length > 0 && (
                <div className="conc-enc-folders">
                  {subcategories.map((cat) => (
                    <button
                      key={cat}
                      className="conc-enc-folder-card"
                      onClick={() => setNavPath((prev) => [...prev, cat])}
                    >
                      <div className="conc-enc-folder-icon" aria-hidden="true">
                        DIR
                      </div>
                      <div className="conc-enc-folder-info">
                        <div className="conc-enc-folder-name">{cat}</div>
                        <div className="conc-enc-folder-count">
                          {countInCategory([...navPath, cat])} 筆資料
                        </div>
                      </div>
                      <span className="conc-enc-entry-arrow">›</span>
                    </button>
                  ))}
                </div>
              )}

              {currentProfiles.length > 0 && (
                <div className="conc-enc-entries">
                  {subcategories.length > 0 && (
                    <div className="conc-enc-entries-divider">此層級的角色</div>
                  )}
                  {currentProfiles.map((p) => (
                    <button
                      key={p._idx}
                      className={`conc-enc-entry ${p.placeholder ? 'locked' : ''}`}
                      onClick={() => !p.placeholder && setViewingIdx(p._idx)}
                    >
                      <div className="conc-enc-entry-sigil-box">
                        {!p.placeholder && p.avatar ? (
                          <img
                            src={resolveAssetUrl(p.avatar)}
                            alt=""
                            className="conc-enc-entry-avatar"
                          />
                        ) : (
                          <span>{p.placeholder ? '?' : p.name[0]}</span>
                        )}
                      </div>
                      <div className="conc-enc-entry-info">
                        <div className="conc-enc-entry-name">{p.name}</div>
                        {!p.placeholder && p.basic && (
                          <div className="conc-enc-entry-sub">
                            {Object.entries(p.basic)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(' · ')}
                          </div>
                        )}
                        {p.placeholder && (
                          <div className="conc-enc-entry-sub locked-sub">
                            access restricted
                          </div>
                        )}
                      </div>
                      <span className="conc-enc-entry-arrow">
                        {p.placeholder ? 'LOCK' : '›'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {subcategories.length === 0 && currentProfiles.length === 0 && (
                <div
                  style={{
                    padding: '40px 16px',
                    textAlign: 'center',
                    color: 'var(--ink-mute)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                >
                  此分類下暫無資料
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 子元件：ReaderChronograph（oscillator stack）— 水平拖曳時間軸
// ──────────────────────────────────────────────────────────────────
const CHRONO_ERA_ORDER: Record<ChronoEra, number> = {
  'pre-ad': 0,
  ad: 1,
  fa: 2,
  nw: 3,
};

function ReaderChronograph({ data: rawData }: { data: ChronoContent }) {
  const data = useMemo(() => {
    const sorted = [...rawData.periods].sort((a, b) => {
      const eaOrd = CHRONO_ERA_ORDER[a.era] ?? 0;
      const ebOrd = CHRONO_ERA_ORDER[b.era] ?? 0;
      if (eaOrd !== ebOrd) return eaOrd - ebOrd;
      if (a.era === 'pre-ad') return b.yearNum - a.yearNum;
      return a.yearNum - b.yearNum;
    });
    return { ...rawData, periods: sorted };
  }, [rawData]);

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [chronoClosing, setChronoClosing] = useState(false);
  function closeChronoExpanded() {
    setChronoClosing(true);
    setTimeout(() => {
      setExpandedIdx(null);
      setChronoClosing(false);
    }, 250);
  }
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fadeLRef = useRef<HTMLDivElement>(null);
  const fadeRRef = useRef<HTMLDivElement>(null);
  const offsetX = useRef(0);
  const dragging = useRef(false);
  const hasDragged = useRef(false);
  const dragStartX = useRef(0);
  const offsetStart = useRef(0);

  // 使用 transform 移動內部容器
  function applyTransform(x: number) {
    if (!innerRef.current || !viewportRef.current) return;
    const vw = viewportRef.current.clientWidth;
    const iw = innerRef.current.scrollWidth;
    const minX = -iw;
    const maxX = vw;
    const clamped = Math.max(minX, Math.min(maxX, x));
    offsetX.current = clamped;
    innerRef.current.style.transform = `translateX(${clamped}px)`;

    // 碰到邊界時在對應側顯示紅光提示
    fadeLRef.current?.classList.toggle('hit', clamped >= maxX);
    fadeRRef.current?.classList.toggle('hit', clamped <= minX);
  }

  // pointer 事件同時支援滑鼠與手機觸控。
  function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    hasDragged.current = false;
    dragStartX.current = e.clientX;
    offsetStart.current = offsetX.current;
    if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dx = e.clientX - dragStartX.current;
    if (Math.abs(dx) > 5) hasDragged.current = true;
    applyTransform(offsetStart.current + dx);
  }

  function handleDragEnd(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
    fadeLRef.current?.classList.remove('hit');
    fadeRRef.current?.classList.remove('hit');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div className="conc-chrono">
      {/* 時間軸舞台 — 將時鐘與時間軸包在獨立容器，避免下方展開卡片把時鐘擠開 */}
      <div className="conc-chrono-stage">
        {/* 背景時鐘裝飾 */}
        <div className="conc-chrono-clock" aria-hidden="true">
          <svg viewBox="0 0 200 200" className="conc-chrono-clock-svg">
            <circle
              cx="100"
              cy="100"
              r="90"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
              opacity="0.15"
            />
            <circle
              cx="100"
              cy="100"
              r="70"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.3"
              opacity="0.1"
              strokeDasharray="4 8"
            />
            {/* 時鐘刻度 */}
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 30 - 90) * (Math.PI / 180);
              const x1 = 100 + 82 * Math.cos(angle);
              const y1 = 100 + 82 * Math.sin(angle);
              const x2 = 100 + 90 * Math.cos(angle);
              const y2 = 100 + 90 * Math.sin(angle);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth={i % 3 === 0 ? '1.2' : '0.5'}
                  opacity={i % 3 === 0 ? 0.25 : 0.12}
                />
              );
            })}
            {/* 旋轉指針 */}
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="30"
              stroke="currentColor"
              strokeWidth="0.6"
              opacity="0.12"
              className="conc-chrono-hand-slow"
            />
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="45"
              stroke="currentColor"
              strokeWidth="0.4"
              opacity="0.08"
              className="conc-chrono-hand-fast"
            />
            <circle
              cx="100"
              cy="100"
              r="3"
              fill="currentColor"
              opacity="0.15"
            />
          </svg>
        </div>

        {/* 水平時間軸 */}
        <div
          className="conc-chrono-viewport"
          ref={viewportRef}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          {/* 軌道線——固定在 viewport，不隨拖曳移動 */}
          <div className="conc-chrono-rail" />

          <div className="conc-chrono-track" ref={innerRef}>
            {data.periods.map((period, pi) => (
              <div
                key={pi}
                className={`conc-chrono-node ${expandedIdx === pi ? 'expanded' : ''}`}
              >
                {/* 時間點 */}
                <button
                  className={`conc-chrono-dot ${expandedIdx === pi ? 'active' : ''}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (expandedIdx === pi) closeChronoExpanded();
                    else setExpandedIdx(pi);
                  }}
                >
                  <span className="conc-chrono-dot-inner" />
                </button>
                {/* 年份標籤——也可點擊展開 */}
                <div
                  className="conc-chrono-year-label"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (expandedIdx === pi) closeChronoExpanded();
                    else setExpandedIdx(pi);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="conc-chrono-year">{period.year}</span>
                  {(period.title || (period as any).subtitle) && (
                    <span className="conc-chrono-subtitle">
                      {period.title || (period as any).subtitle}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 兩端淡出 */}
          <div className="conc-chrono-fade-left" ref={fadeLRef} />
          <div className="conc-chrono-fade-right" ref={fadeRRef} />
        </div>

        {/* 拖曳提示 */}
        <div className="conc-chrono-drag-hint">
          <span>↔ 拖曳瀏覽時間軸 · 點擊時間點展開</span>
        </div>
      </div>
      {/* /conc-chrono-stage */}

      {/* 展開的時間點詳細內容 */}
      {expandedIdx !== null &&
        data.periods[expandedIdx] &&
        (() => {
          const ep = data.periods[expandedIdx];
          // 新格式（fieldDefs + fields）或舊格式（sections）向後相容
          const hasNewFormat =
            !!(data as any).fieldDefs && !!(ep as any).fields;
          const fieldDefs: ChronoFieldDef[] = hasNewFormat
            ? (data as any).fieldDefs
            : ((ep as any).sections || []).map((s: any, i: number) => ({
                id: `legacy_${i}`,
                icon: s.icon,
                label: s.label,
                style: 'flat' as const,
              }));
          const fields: Record<string, ChronoField> = hasNewFormat
            ? (ep as any).fields
            : Object.fromEntries(
                ((ep as any).sections || []).map((s: any, i: number) => [
                  `legacy_${i}`,
                  { items: s.events },
                ])
              );

          return (
            <div
              className={`conc-chrono-expanded ${chronoClosing ? 'is-closing' : ''}`}
            >
              <div className="conc-chrono-expanded-header">
                <span className="conc-chrono-expanded-icon">⟳</span>
                <span className="conc-chrono-expanded-year">{ep.year}</span>
                {(ep.title || (ep as any).subtitle) && (
                  <span className="conc-chrono-expanded-sub">
                    {ep.title || (ep as any).subtitle}
                  </span>
                )}
                <button
                  className="conc-chrono-expanded-close"
                  onClick={closeChronoExpanded}
                >
                  ✕
                </button>
              </div>
              <div className="conc-chrono-expanded-body">
                {(() => {
                  const rendered = fieldDefs
                    .map((def) => {
                      const field = fields[def.id];
                      if (!field) return null;
                      const hasContent =
                        (field.items && field.items.length > 0) ||
                        (field.groups && field.groups.length > 0);
                      if (!hasContent) return null;
                      return (
                        <div key={def.id} className="conc-chrono-section">
                          <div className="conc-chrono-section-header">
                            <span className="conc-chrono-section-icon">
                              {def.icon}
                            </span>
                            <span className="conc-chrono-section-label">
                              {def.label}
                            </span>
                          </div>
                          {field.items &&
                            field.items.map((ev, ei) => (
                              <div key={ei} className="conc-chrono-event">
                                · {ev}
                              </div>
                            ))}
                          {field.groups &&
                            field.groups.map((group, gi) => (
                              <div
                                key={gi}
                                className="conc-chrono-section"
                                style={{ marginLeft: 8, marginBottom: 8 }}
                              >
                                <div
                                  className="conc-chrono-section-header"
                                  style={{
                                    borderBottom: 'none',
                                    paddingBottom: 2,
                                  }}
                                >
                                  <span
                                    className="conc-chrono-section-label"
                                    style={{ fontSize: 12, fontWeight: 600 }}
                                  >
                                    {group.label}
                                  </span>
                                </div>
                                {group.items.map((ev, ei) => (
                                  <div key={ei} className="conc-chrono-event">
                                    · {ev}
                                  </div>
                                ))}
                              </div>
                            ))}
                        </div>
                      );
                    })
                    .filter(Boolean);
                  if (rendered.length === 0) {
                    return (
                      <div className="conc-chrono-empty">此時間點尚無記錄</div>
                    );
                  }
                  return rendered;
                })()}
              </div>
            </div>
          );
        })()}

      {/* 佔位符（下方） */}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 子元件：ReaderDiff（compare stack）— 查詢平台風格
// ──────────────────────────────────────────────────────────────────

/** 無意義的 group label 清單 */
const MEANINGLESS_LABELS = ['', '未被歸類', '未分類', 'uncategorized'];

/** 對照表列的 grid 欄數（詞條欄 + N 個值欄）交給 CSS 變數 */
function diffGridStyle(columns: number): React.CSSProperties {
  return {
    '--diff-cols': String(Math.max(columns, 1)),
  } as React.CSSProperties;
}

/** 欄位標籤表頭；未定義標籤時不渲染（維持既有無表頭外觀） */
function DiffValueHead({
  labels,
  columns,
}: {
  labels: string[];
  columns: number;
}) {
  if (!labels.length) return null;
  return (
    <div
      className="conc-diff-row conc-diff-head"
      style={diffGridStyle(columns)}
    >
      <span className="conc-diff-term">詞條</span>
      {Array.from({ length: columns }, (_, i) => (
        <span key={i} className="conc-diff-val">
          {labels[i] ?? '—'}
        </span>
      ))}
    </div>
  );
}

/** 對照表單列——值依欄數補齊，讓各列欄位對齊 */
function DiffRow({
  entry,
  alt,
  columns,
}: {
  entry: { term: string; values: string[] };
  alt: boolean;
  columns: number;
}) {
  return (
    <div
      className={`conc-diff-row ${alt ? 'alt' : ''}`}
      style={diffGridStyle(columns)}
    >
      <span className="conc-diff-term">{entry.term}</span>
      {Array.from({ length: columns }, (_, vi) => (
        <span key={vi} className="conc-diff-val">
          {entry.values[vi] || '—'}
        </span>
      ))}
    </div>
  );
}

function ReaderDiff({ data }: { data: DiffContent }) {
  const [activeTab, setActiveTab] = useState(0);
  const [filter, setFilter] = useState('');
  const subcat = data.subcategories[activeTab];

  // 判斷是多欄對照（有多 values 或已定義欄位標籤）還是術語定義
  const isTable = subcat?.sections?.some(
    (s) =>
      (s.valueLabels?.length ?? 0) > 1 ||
      s.entries.some((e) => e.values.length > 1)
  );

  // 欄位標籤與欄數（規則與編輯器共用，見 diffTable.ts）
  const fallbackLabels = useMemo(() => subcatValueLabels(subcat), [subcat]);
  const valueColumns = useMemo(() => subcatValueColumns(subcat), [subcat]);

  // 展平並過濾所有條目
  const allEntries = useMemo(() => {
    if (!subcat) return [];
    const entries: {
      term: string;
      values: string[];
      sectionLabel: string;
      spoiler?: number;
    }[] = [];
    for (const section of subcat.sections) {
      for (const entry of section.entries) {
        entries.push({ ...entry, sectionLabel: section.label });
      }
    }
    return entries;
  }, [subcat]);

  const filtered = useMemo(() => {
    if (!filter) return allEntries;
    const q = filter.toLowerCase();
    return allEntries.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.values.some((v) => v.toLowerCase().includes(q))
    );
  }, [allEntries, filter]);

  // 是否只有一個無意義 section（不需要分組顯示）
  const hasMeaningfulSections = subcat?.sections.some(
    (s) => !MEANINGLESS_LABELS.includes(s.label.trim().toLowerCase())
  );

  return (
    <div>
      <div className="conc-diff-platform">
        {/* 平台控制列 */}
        <div className="conc-diff-toolbar">
          <div className="conc-diff-toolbar-left">
            <span className="conc-diff-toolbar-icon">⇌</span>
            <span className="conc-diff-toolbar-title">COGNITION_COMPARE</span>
          </div>
          <div className="conc-diff-toolbar-right">
            <span className="conc-diff-toolbar-stat">
              {filtered.length} / {allEntries.length} entries
            </span>
            <div className="conc-diff-search">
              <span className="conc-diff-search-icon">⌕</span>
              <input
                className="conc-diff-filter"
                placeholder="搜尋詞條..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Tab bar */}
        {data.subcategories.length > 1 && (
          <div className="conc-diff-tabbar">
            {data.subcategories.map((sc, i) => (
              <button
                key={i}
                className={`conc-diff-tab ${i === activeTab ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(i);
                  setFilter('');
                }}
              >
                {sc.label}
              </button>
            ))}
          </div>
        )}

        {/* 內容 */}
        {allEntries.length === 0 ? (
          <div className="conc-diff-empty">
            <div className="conc-diff-empty-icon">⇌</div>
            <div className="conc-diff-empty-text">此分類尚無條目資料</div>
            <div className="conc-diff-empty-sub">內容將隨故事進展逐步出現</div>
          </div>
        ) : subcat && isTable ? (
          /* 多欄對照表 */
          <div className="conc-diff-table-body">
            {hasMeaningfulSections
              ? subcat.sections.map((section, si) => {
                  const sectionEntries = filter
                    ? section.entries.filter(
                        (e) =>
                          e.term.toLowerCase().includes(filter.toLowerCase()) ||
                          e.values.some((v) =>
                            v.toLowerCase().includes(filter.toLowerCase())
                          )
                      )
                    : section.entries;
                  if (sectionEntries.length === 0) return null;
                  const showLabel = !MEANINGLESS_LABELS.includes(
                    section.label.trim().toLowerCase()
                  );
                  return (
                    <div key={si}>
                      {showLabel && (
                        <div className="conc-diff-section-label">
                          {section.label}
                        </div>
                      )}
                      <DiffValueHead
                        labels={section.valueLabels ?? fallbackLabels}
                        columns={valueColumns}
                      />
                      {sectionEntries.map((entry, ei) => (
                        <DiffRow
                          key={ei}
                          entry={entry}
                          alt={ei % 2 === 1}
                          columns={valueColumns}
                        />
                      ))}
                    </div>
                  );
                })
              : [
                  <DiffValueHead
                    key="head"
                    labels={fallbackLabels}
                    columns={valueColumns}
                  />,
                  ...filtered.map((entry, ei) => (
                    <DiffRow
                      key={ei}
                      entry={entry}
                      alt={ei % 2 === 1}
                      columns={valueColumns}
                    />
                  )),
                ]}
          </div>
        ) : (
          /* 術語定義列表 */
          <div className="conc-diff-defs-body">
            {hasMeaningfulSections ? (
              subcat?.sections.map((section, si) => {
                const showLabel = !MEANINGLESS_LABELS.includes(
                  section.label.trim().toLowerCase()
                );
                const sectionEntries = filter
                  ? section.entries.filter(
                      (e) =>
                        e.term.toLowerCase().includes(filter.toLowerCase()) ||
                        e.values.some((v) =>
                          v.toLowerCase().includes(filter.toLowerCase())
                        )
                    )
                  : section.entries;
                if (sectionEntries.length === 0) return null;
                return (
                  <div key={si} className="conc-diff-defs">
                    {showLabel && (
                      <h3 className="conc-diff-defs-title">{section.label}</h3>
                    )}
                    {sectionEntries.map((entry, ei) => (
                      <div key={ei} className="conc-diff-def-item">
                        <span className="conc-diff-def-term">{entry.term}</span>
                        {entry.values[0] && (
                          <span className="conc-diff-def-desc">
                            {entry.values[0]}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })
            ) : (
              <div className="conc-diff-defs">
                {filtered.map((entry, ei) => (
                  <div key={ei} className="conc-diff-def-item">
                    <span className="conc-diff-def-term">{entry.term}</span>
                    {entry.values[0] && (
                      <span className="conc-diff-def-desc">
                        {entry.values[0]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 底部狀態列 */}
        <div className="conc-diff-footer">
          <span>mode: {isTable ? 'table_compare' : 'definition_lookup'}</span>
          <span>
            {subcat?.label || '—'} ·{' '}
            {filter ? `filtered: "${filter}"` : 'showing all'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// 主元件
// ──────────────────────────────────────────────────────────────────
export default function ConceptsReader() {
  // === 進度狀態（Epic 2 S7：條目級進度閘） ===
  // 訂閱全域 ProgressState——旗標/視角變化時重渲，effective view 隨之重算。
  // SSR 時回傳初始狀態（base 內容），hydrate 後才呈現個人化狀態（設計文件 2-4）。
  const progress = useProgress();
  // Reader 卸載時清空 revision 快取（頁面間記憶體不殘留）
  useEffect(() => () => clearAllRevisionCache(), []);

  // === 內容狀態 ===
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [homepageBlocks, setHomepageBlocks] = useState<HomepageBlock[]>([]);
  const {
    contentReady,
    markContentReady,
    setNavPending: setBootNavPending,
  } = useZoneBootReady({ minDisplayMs: 2000 });

  // === 導航狀態 ===
  type View = 'landing' | 'stack' | 'reading';
  const [view, setView] = useState<View>('landing');
  const [activeStackId, setActiveStackId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [stackPage, setStackPage] = useState<Page | null>(null);
  const [readingPage, setReadingPage] = useState<Page | null>(null);
  // 轉場 key — 資料載入完成時才遞增，讓動畫在內容就緒後才播放
  const [transitionKey, setTransitionKey] = useState(0);
  /**
   * 從 dossier「詳細」按鈕導過來時，要在 browser 頁直接展開的 entity。
   * 每次 navigateToPage 都會重設（含設回 undefined），所以不會殘留到
   * 下一次用其他方式進入的 browser 頁。
   */
  const [browserFocusKey, setBrowserFocusKey] = useState<string | undefined>();
  // dossier 的 variant 切換索引（每次切換 readingPage 時重置）
  const [dossierVariantIdx, setDossierVariantIdx] = useState(0);
  useEffect(() => {
    setDossierVariantIdx(0);
  }, [readingPage?.id]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { saveScroll, restoreScroll } = useScrollMemory(scrollRef, [
    view,
    activeStackId,
    readingPage?.id,
  ]);

  // === 衍生資料 ===
  const stackNodes = useMemo(() => {
    for (const node of tree) {
      if (node.pageType === 'homepage' && node.children) return node.children;
    }
    return tree.filter((n) => n.pageType === 'stack');
  }, [tree]);

  const flatNodes = useMemo(() => {
    const acc: PageTreeNode[] = [];
    (function walk(nodes: PageTreeNode[]) {
      for (const n of nodes) {
        acc.push(n);
        walk(n.children || []);
      }
    })(tree);
    return acc;
  }, [tree]);

  const hpHeader = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'zone-header');
    return b ? (b.data as ZoneHeaderData) : null;
  }, [homepageBlocks]);
  const hpDialogues = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'uep-dialogue');
    return b ? (b.data as UepDialogueItem[]) : null;
  }, [homepageBlocks]);
  const hpRichTexts = useMemo(
    () =>
      homepageBlocks
        .filter((b) => b.type === 'rich-text')
        .map((b) => (b.data as { html: string }).html),
    [homepageBlocks]
  );
  const hpModules = useMemo(() => {
    const b = homepageBlocks.find((b) => b.type === 'terminal-module-table');
    return b
      ? (b.data as {
          headerLabel: string;
          modules: {
            id: string;
            name: string;
            en: string;
            state: string;
          }[];
        })
      : null;
  }, [homepageBlocks]);

  // ── 初始化 ─────────────────────────────────────────────────────
  useEffect(() => {
    void fetchTree();
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/content/concepts/homepage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: any) => {
        if (!json?.ok || !json.data?.content) return;
        const raw =
          typeof json.data.content === 'string'
            ? JSON.parse(json.data.content)
            : json.data.content;
        if (Array.isArray(raw) && raw.length > 0)
          setHomepageBlocks(raw.map(fromContentBlock));
      })
      .catch(() => {})
      .finally(() => {
        markContentReady();
      });
  }, []);

  // ── URL 路由（useZoneRouter 統一管理初始 deep link + popstate）──
  useZoneRouter({
    routes: [
      { param: 'page', handler: (value) => navigateToPage(value, false) },
      { param: 'stack', handler: (value) => navigateToStack(value, false) },
    ],
    onLanding: () => navigateToLanding(false),
    treeReady: !treeLoading && tree.length > 0,
    setBootNavPending: setBootNavPending,
  });

  // ── 資料載入 ───────────────────────────────────────────────────
  async function fetchTree() {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch(`${API_BASE}/api/content/concepts/tree`);
      const json = await res.json();
      if (json.ok && json.data) setTree(json.data as PageTreeNode[]);
    } catch (err) {
      setTreeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeLoading(false);
    }
  }

  async function fetchPageData(slug: string): Promise<Page | null> {
    try {
      const res = await fetch(`${API_BASE}/api/content/concepts/${slug}`);
      const json = await res.json();
      if (json.ok && json.data) {
        const page = json.data;
        return {
          ...page,
          content:
            typeof page.content === 'string'
              ? JSON.parse(page.content)
              : page.content || [],
        } as Page;
      }
    } catch {
      /* 靜默 */
    }
    return null;
  }

  // ── 滾動位置 key ────────────────────────────────────────────────
  /** 回傳當前視圖對應的滾動記憶 key */
  function currentScrollKey(): string {
    if (readingPage) return `page:${readingPage.id}`;
    if (activeStackId) return `stack:${activeStackId}`;
    return 'landing';
  }

  // ── 導航 ───────────────────────────────────────────────────────
  function navigateToLanding(push = true) {
    saveScroll(currentScrollKey());
    setView('landing');
    setActiveStackId(null);
    setActivePageId(null);
    setStackPage(null);
    setReadingPage(null);
    setTransitionKey((k) => k + 1);
    if (push) clearUrl();
    restoreScroll('landing');
  }

  function navigateToStack(stackSlug: string, push = true) {
    saveScroll(currentScrollKey());
    const fullId = canonicalizePagePath(
      stackSlug.startsWith('concepts/')
        ? stackSlug
        : ['concepts', stackSlug].join('/')
    );
    const slug = fullId.replace('concepts/', '');
    setActiveStackId(fullId);
    setActivePageId(null);
    if (push) pushUrl({ stack: slug });
    fetchPageData(slug).then((p) => {
      setStackPage(p);
      setReadingPage(null);
      setView('stack');
      setTransitionKey((k) => k + 1);
      restoreScroll(`stack:${fullId}`);
      setBootNavPending(false);
    });
  }

  /**
   * @param focusEntityKey 到頁後要直接展開的 entity（dossier「詳細」按鈕
   *   用）。只對 browser stack 有意義，其餘 stack 忽略。刻意**不進 URL**
   *   ——這顆按鈕是「順手跳過去看」，不是需要分享或用上一頁還原的狀態；
   *   要 deep-link 化的話得在既有的 `page` route handler 內自己讀
   *   `?entity=`，不能另加一條 useZoneRouter route（它只認第一個命中的
   *   param，新 route 永遠不會觸發）。
   */
  function navigateToPage(
    pageSlug: string,
    push = true,
    focusEntityKey?: string
  ) {
    saveScroll(currentScrollKey());
    const fullId = canonicalizePagePath(
      pageSlug.startsWith('concepts/')
        ? pageSlug
        : ['concepts', pageSlug].join('/')
    );
    const slug = fullId.replace('concepts/', '');
    setBrowserFocusKey(focusEntityKey);
    setActivePageId(fullId);
    if (push) pushUrl({ page: slug });
    const stackDef = STACKS.find((s) => slug.startsWith(s.slug));
    if (stackDef) setActiveStackId(`concepts/${stackDef.slug}`);
    fetchPageData(slug).then((p) => {
      // 新載入的頁面資料使快取失效（admin 編輯後重訪不吃到舊 view）
      if (p) invalidatePageCache(p.id);
      setReadingPage(p);
      setView('reading');
      setTransitionKey((k) => k + 1);
      // 頁面 id 在資料載入後才確定，直接用 fullId 作為 key
      restoreScroll(`page:${fullId}`);
      setBootNavPending(false);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Landing
  // ══════════════════════════════════════════════════════════════
  function renderLanding() {
    return (
      <section className="conc-landing">
        <div className="conc-landing-inner">
          {/* zone-header */}
          <div className="conc-kicker">Volume IV · CONCEPTS</div>
          <div className="conc-landing-title-row">
            <h1 className="conc-landing-title">
              {hpHeader?.title || '概念調整房'}
            </h1>
            <ConceptsTerminalBadge />
          </div>
          {(hpHeader?.subtitle || '') && (
            <p className="conc-landing-subtitle">{hpHeader?.subtitle}</p>
          )}

          {/* uep-dialogue */}
          {hpDialogues && (
            <div className="conc-landing-uep">
              {hpDialogues.map((d, i) => (
                <UepDialogue
                  key={i}
                  text={d.text}
                  side={d.side}
                  effects={d.effects as never[]}
                />
              ))}
            </div>
          )}

          {/* rich-text */}
          {hpRichTexts.map((html, i) => (
            <React.Fragment key={i}>
              {renderHtmlWithUep(html, i, 'conc-prose')}
            </React.Fragment>
          ))}

          {/* terminal-module-table */}
          {hpModules && (
            <div className="conc-module-table">
              <div className="conc-module-table-bar">
                <span>{hpModules.headerLabel}</span>
                <span>{hpModules.modules.length} units</span>
              </div>
              {hpModules.modules.map((mod, i) => (
                <button
                  key={mod.id}
                  className="conc-module-row"
                  onClick={() => {
                    const s = STACKS[i];
                    if (s) navigateToStack(s.slug);
                  }}
                >
                  <span className="conc-mod-num">{mod.id}</span>
                  <span className="conc-mod-name">{mod.name}</span>
                  <span className="conc-mod-en">{mod.en}</span>
                  <span className={`conc-mod-state ${mod.state}`}>
                    <span className="conc-mod-dot" />
                    {mod.state}
                  </span>
                  <span className="conc-mod-arrow">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Stack 頁面
  // ══════════════════════════════════════════════════════════════
  function renderStack() {
    const stackDef = STACKS.find((s) => `concepts/${s.slug}` === activeStackId);
    const stackNode = stackNodes.find((n) => n.id === activeStackId);
    if (!stackDef || !stackNode) return null;
    const children = stackNode.children || [];
    // 頁面層進度閘（Epic 2 S7）：gate 未通過的子頁完全隱藏
    // （不顯示 LOCK 佔位，設計文件 3-3）；靜態 locked 仍顯示 sealed
    const visibleChildren = children.filter(
      (child) =>
        !isHidden(child) &&
        evaluateGate(progress, parseGateCondition(child.metadata))
    );

    // 從 D1 載入的 stackPage 取得動態內容
    const stackTitle = stackPage?.title || stackDef.label;
    const stackDesc =
      typeof stackPage?.metadata?.description === 'string'
        ? (stackPage.metadata.description as string)
        : '';
    // stack 頁面的 content 是 rich_text 格式
    const stackContentHtml = stackPage?.content?.[0]?.content || '';

    return (
      <div className="conc-stack-page">
        <ZoneBreadcrumb
          segments={[
            { label: '概念調整房', onClick: () => navigateToLanding() },
            { label: stackDef.labelEn },
          ]}
          color="var(--concepts-main)"
        />

        <div className="conc-stack-title-row">
          <span className="conc-stack-icon">{stackDef.icon}</span>
          <h1 className="conc-stack-title">{stackTitle}</h1>
          <div className="conc-stack-sync-badge">
            <span className="conc-mod-dot sync" />
            {visibleChildren.length} types · sync ok
          </div>
        </div>
        <div className="conc-stack-path">
          {stackDef.labelEn}
          <span className="conc-stack-motto">// {stackDef.style}.layout</span>
        </div>
        {stackDesc && <p className="conc-reading-desc">{stackDesc}</p>}
        <div className="conc-gradient-line" />

        {/* 從 D1 讀取的 stack 介紹內容，若無則 fallback 到硬編碼 */}
        {stackContentHtml ? (
          <>
            {renderHtmlWithUep(
              stackContentHtml,
              'stack-intro',
              'conc-stack-intro conc-prose'
            )}
          </>
        ) : (
          <p className="conc-stack-intro">
            <span className="conc-drop-cap">{stackDef.intro[0]}</span>
            {stackDef.intro.slice(1)}
          </p>
        )}

        <div className="conc-stack-uep">
          <UepDialogue
            side="left"
            effects={['shimmer', 'halo'] as never[]}
            text={stackDef.uepNote}
          />
        </div>

        {/* 終端目錄列表 */}
        <div className="conc-dir-listing">
          <div className="conc-dir-bar">
            <span>$ ls ./{stackDef.slug.split('/').pop()} --long</span>
            <span>{visibleChildren.length} entries</span>
          </div>
          <div className="conc-dir-header-row">
            <span>#</span>
            <span>name</span>
            <span>identifier</span>
            <span>state</span>
            <span />
          </div>
          {visibleChildren.map((child, i) => {
            const locked = isLocked(child);
            return (
              <button
                key={child.id}
                className={`conc-dir-row ${i % 2 ? 'alt' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => !locked && navigateToPage(child.slug)}
              >
                <span className="conc-dir-num">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="conc-dir-name-cell">
                  <div className="conc-dir-name">{child.title}</div>
                  <div className="conc-dir-hint">
                    {locked
                      ? ''
                      : typeof child.metadata?.description === 'string'
                        ? (child.metadata.description as string).slice(0, 50)
                        : ''}
                  </div>
                </div>
                <span className="conc-dir-en">
                  {locked ? '—' : child.slug.split('/').pop()}
                </span>
                <span
                  className={`conc-dir-state ${locked ? 'sealed' : 'sync'}`}
                >
                  <span className="conc-mod-dot" />
                  {locked ? 'sealed' : 'sync'}
                </span>
                <span className="conc-dir-arrow">{locked ? 'LOCK' : '›'}</span>
              </button>
            );
          })}
          <div className="conc-dir-tip">
            <span className="conc-dir-tip-prompt">$</span>
            <span>
              tip — 被標記為 <span className="conc-hl">sealed</span>{' '}
              的類別會隨著故事進度自動解鎖
            </span>
            <span className="conc-cursor" />
          </div>
        </div>

        <div className="conc-back-bar">
          <button className="conc-back-btn" onClick={() => navigateToLanding()}>
            ← 返回概念調整房
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Reading 頁面 — 分派四種 Reader
  // ══════════════════════════════════════════════════════════════
  function renderReading() {
    if (!readingPage) return <ZoneStateDisplay kind="not-found" large />;

    // 頁面層進度閘（deep link 守門）：gate 未通過視同不存在——
    // 「未解鎖 = 隱藏」語意，不顯示鎖定佔位（設計文件 3-3）
    if (!evaluateGate(progress, parseGateCondition(readingPage.metadata))) {
      return <ZoneStateDisplay kind="not-found" large />;
    }

    const meta = readingPage.metadata as Partial<ConceptsVariationMeta>;
    const locked = isLocked(readingPage);
    const stackDef = STACKS.find((s) => readingPage.slug.startsWith(s.slug));
    const style = meta.stack_style || stackDef?.style || 'dossier';

    // 多 block 支援：rich_text block 為上方富文本，其他為結構化資料
    const introBlock = readingPage.content?.find(
      (b: { type: string }) => b.type === 'rich_text'
    );
    const structBlock =
      readingPage.content?.find(
        (b: { type: string }) => b.type !== 'rich_text'
      ) || readingPage.content?.[0];
    const introHtml = introBlock?.content || '';
    let parsed:
      | DossierContent
      | BrowserContent
      | ChronoContent
      | DiffContent
      | null = null;
    if (!locked && structBlock?.content && structBlock.type !== 'rich_text') {
      try {
        parsed = JSON.parse(structBlock.content);
      } catch {
        /* 靜默 */
      }
    }

    // 條目級進度閘（Epic 2 S7）：套用 revision effective view——
    // 未解鎖條目過濾、已解鎖條目按旗標疊加 patch。快取以
    // (pageId, 進度指紋) 為 key，同頁重渲不重跑疊加。
    if (parsed) {
      const source = parsed;
      parsed = getCachedEffectiveView(readingPage.id, progress, () =>
        resolveEffectiveViewForPage(source, progress)
      );
    }

    // dossier 的 variant 處理
    const dossierVariants =
      style === 'dossier' && parsed ? normalizeDossierVariants(parsed) : [];
    const dossierIdx =
      dossierVariants.length > 0
        ? dossierVariantIdx % dossierVariants.length
        : 0;
    const currentDossierVariant = dossierVariants[dossierIdx];
    const hasMultipleVariants = dossierVariants.length > 1;

    // 標題旁 badge 顯示內容：dossier 時為 variant.label，其他為 meta.era
    const badgeLabel =
      style === 'dossier' && currentDossierVariant
        ? currentDossierVariant.label
        : meta.era && meta.era !== 'default'
          ? meta.era.toUpperCase()
          : null;

    function cycleDossierVariant() {
      if (!hasMultipleVariants) return;
      setDossierVariantIdx((i) => (i + 1) % dossierVariants.length);
    }

    // 麵包屑
    const crumbs = readingPage.slug.split('/').filter(Boolean);

    return (
      <div className="conc-reading-page">
        <ZoneBreadcrumb
          segments={[
            { label: '概念調整房', onClick: () => navigateToLanding() },
            ...(stackDef
              ? [
                  {
                    label: stackDef.labelEn,
                    onClick: () => navigateToStack(stackDef.slug),
                  },
                ]
              : []),
            {
              label: crumbs[crumbs.length - 1]?.toUpperCase() || '',
            },
          ]}
          color="var(--concepts-main)"
        />

        {/* 子頁面標題（不帶 icon，與 echoes/visuals 一致） */}
        <div className="conc-stack-title-row" style={{ marginTop: 14 }}>
          <h1 className="conc-stack-title">{readingPage.title}</h1>
          {badgeLabel && hasMultipleVariants && (
            <button
              type="button"
              className="conc-era-badge conc-era-badge--switch"
              onClick={cycleDossierVariant}
              title={`切換 variant（共 ${dossierVariants.length} 個）`}
              aria-label={`目前 variant: ${badgeLabel}，點擊切換`}
            >
              <span className="conc-era-badge__label">{badgeLabel}</span>
              <span className="conc-era-badge__arrow">▸</span>
            </button>
          )}
        </div>
        {!locked && typeof readingPage.metadata?.description === 'string' && (
          <p className="conc-reading-desc">
            {readingPage.metadata.description as string}
          </p>
        )}
        <div className="conc-gradient-line" />

        {/* 上方富文本（TipTap 內容） */}
        {!locked && introHtml && introHtml !== '<p></p>' && (
          <>{renderHtmlWithUep(introHtml, 'intro', 'conc-prose')}</>
        )}

        {/* 分派 Reader */}
        <div className="conc-reader-body">
          {locked ? (
            <div className="conc-locked-notice">
              <div className="conc-locked-notice-icon">LOCK</div>
              <div className="conc-locked-notice-title">ACCESS RESTRICTED</div>
              <div className="conc-locked-notice-text">
                此內容尚未在故事中揭露，隨著劇情推進將自動解鎖。
              </div>
            </div>
          ) : parsed ? (
            style === 'dossier' && currentDossierVariant ? (
              <ReaderDossier
                key={currentDossierVariant.id + ':' + dossierIdx}
                subcategories={currentDossierVariant.subcategories}
                onOpenBrowserDetail={(pageId, entityKey) =>
                  navigateToPage(pageId, true, entityKey)
                }
              />
            ) : style === 'browser' ? (
              <ReaderBrowserTabs
                data={parsed as BrowserContent}
                focusEntityKey={browserFocusKey}
              />
            ) : style === 'chrono' ? (
              <ReaderChronograph data={parsed as ChronoContent} />
            ) : style === 'diff' ? (
              <ReaderDiff data={parsed as DiffContent} />
            ) : (
              <div className="conc-prose">無法識別的內容格式</div>
            )
          ) : (
            <div className="conc-page-loading">此頁面尚無結構化內容</div>
          )}
        </div>

        <div className="conc-back-bar">
          {stackDef ? (
            <button
              className="conc-back-btn"
              onClick={() => navigateToStack(stackDef.slug)}
            >
              ← 返回{stackDef.label}
            </button>
          ) : (
            <button
              className="conc-back-btn"
              onClick={() => navigateToLanding()}
            >
              ← 返回概念調整房
            </button>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 主渲染
  // ══════════════════════════════════════════════════════════════
  return (
    <ReaderShell zoneId="concepts" className="concepts-reader">
      {/* CRT 開機入場動畫 — 黑底 + scanline 紋理 + 終端文字 + 一道掃描線；contentReady 後淡出 */}
      <div
        aria-hidden="true"
        className={`conc-boot ${contentReady ? 'is-ready' : ''}`}
      >
        <div className="conc-boot-scanlines" />
        <div className="conc-boot-sweep" />
        <div className="conc-boot-center">
          <div className="conc-boot-line">
            {'> mount /dev/concepts ............... [ OK ]'}
          </div>
          <div className="conc-boot-line">
            {'> loading essence_oscillator ........ [ OK ]'}
          </div>
          <div className="conc-boot-line">
            {'> ready'}
            <span className="conc-boot-cursor" />
          </div>
        </div>
        <ZoneBootArt zoneId="concepts" />
      </div>

      <div className="conc-main">
        <ZoneAtmosphere zone={CONCEPTS_ZONE} intensity="subtle" skipGlyphs />

        {/* 背景網格 — 整體基底，極淡，並有水平閃光偶爾掠過 */}
        <div className="conc-grid-bg" aria-hidden="true">
          <div className="conc-grid-flash" />
        </div>

        {/* 數位雨 — 駭客風飄落字元，透明度低 */}
        <div className="conc-rain" aria-hidden="true">
          {RAIN_COLUMNS.map((col, i) => (
            <div key={i} className="conc-rain-col" style={col.style}>
              {col.chars.map((ch, j) => (
                <span key={j} className="conc-rain-char" style={ch.style}>
                  {ch.char}
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* 飄移符號 */}
        <div className="conc-symbols" aria-hidden="true">
          {SYMBOL_ITEMS.map((item) => (
            <span key={item.idx} className="conc-symbol" style={item.style}>
              {item.char}
            </span>
          ))}
        </div>

        <div className="conc-content" ref={scrollRef}>
          {/* 頁面轉場 — transitionKey 在資料就緒後才遞增，動畫不會卡在 loading 態 */}
          <div key={transitionKey} className="conc-page-transition">
            {treeError && view === 'landing' && (
              <ZoneStateDisplay
                kind="error"
                message={treeError}
                onRetry={() => void fetchTree()}
                large
              />
            )}
            {!treeError && view === 'landing' && renderLanding()}
            {view === 'stack' && renderStack()}
            {view === 'reading' && renderReading()}
          </div>
        </div>
      </div>
    </ReaderShell>
  );
}
