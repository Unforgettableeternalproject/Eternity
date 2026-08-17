/**
 * ConceptsEditorBody — Concepts 區域的結構化 JSON 編輯器
 *
 * 根據 stack_style 分派四種編輯介面：
 * - dossier: 條目列表編輯（subcategories → groups → entries）
 * - browser: 角色檔案編輯（profiles + 層級分類）
 * - chrono: 時間軸編輯（periods → sections → events）
 * - diff: 對照表/術語編輯（subcategories → sections → entries）
 *
 * 資料流：content[0].content (JSON string) → parsed → 編輯 → onDataChange → save
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  API_BASE,
  getDialog,
  buildAssetUrl as buildImageUrl,
  toAssetPath,
  uploadAsset,
} from './editorHelpers';
import { EntityBindingsFields } from './EntityBindingPicker';
import EntityKeyField from './EntityKeyField';
import GateConditionEditor from './GateConditionEditor';
import MiniEditor from './MiniEditor';
import RevisionModal from './RevisionModal';
import { UploadSpinner } from './UploadSpinner';
import type {
  DossierContent,
  DossierVariant,
  DossierSubcat,
  DossierGroup,
  DossierEntry,
  BrowserContent,
  CharacterProfile,
  ChronoContent,
  ChronoPeriod,
  ChronoEra,
  ChronoFieldDef,
  ChronoField,
  ChronoFieldGroup,
  DiffContent,
  DiffSubcat,
  DiffSection,
  DiffEntry,
  ConceptsData,
} from '../concepts/types';
import { padValueLabels, sectionValueColumns } from '../concepts/diffTable';

// ── 型別 ──────────────────────────────────────────────────────────

export type StackStyle = 'dossier' | 'browser' | 'chrono' | 'diff';

export interface ConceptsEditorData {
  stackStyle: StackStyle;
  contentBlockType: string;
  data: ConceptsData;
}

interface ConceptsEditorBodyProps {
  accent: string;
  stackStyle: StackStyle;
  initialData: ConceptsEditorData;
  onDataChange: (data: ConceptsEditorData) => void;
  onDirty: (dirty: boolean) => void;
  /** 查跨頁既有 entityKey 用；未提供時只做同頁比對 */
  apiBase?: string;
  /** 當前頁面 id——跨頁比對要排除自己 */
  pageId?: string;
}

/**
 * 跨頁 entityKey 查詢器：回傳「同 stack 其他頁面已使用的 key」。
 *
 * dossier 的唯一性範圍是 variant（同一個實體本來就會在多個時代的檔案
 * 各有一條），其餘 stack 的範圍是整個 stack。
 */
export type ExternalKeyLookup = (variantId?: string) => Set<string>;

const EMPTY_KEYS: Set<string> = new Set();
const NO_EXTERNAL_KEYS: ExternalKeyLookup = () => EMPTY_KEYS;

// ── 工廠函式 ──────────────────────────────────────────────────────

/** 從 content block 解析為編輯器資料（跳過 rich_text intro block，只取結構化 block） */
export function parseConceptsEditorData(
  contentBlocks: { id: string; type: string; content: string }[],
  metadata: Record<string, unknown>
): ConceptsEditorData {
  const stackStyle = (metadata.stack_style as StackStyle) || 'dossier';
  // 找到第一個非 rich_text 的結構化 block
  const block =
    contentBlocks?.find((b) => b.type !== 'rich_text') || contentBlocks?.[0];
  const contentBlockType =
    block?.type === 'rich_text'
      ? getBlockType(stackStyle)
      : block?.type || getBlockType(stackStyle);

  let data: ConceptsData;
  if (block?.content) {
    try {
      data = JSON.parse(block.content) as ConceptsData;
    } catch {
      data = getEmptyData(stackStyle);
    }
  } else {
    data = getEmptyData(stackStyle);
  }

  // 舊版 dossier 資料相容：若是 {subcategories:[...]} 則包成單一 variant
  if (stackStyle === 'dossier') {
    const d = data as Partial<DossierContent> & {
      subcategories?: DossierSubcat[];
    };
    if (!Array.isArray(d.variants)) {
      const legacySubcats = Array.isArray(d.subcategories)
        ? d.subcategories
        : [];
      data = {
        variants: [
          { id: 'default', label: 'DEFAULT', subcategories: legacySubcats },
        ],
      } as DossierContent;
    } else if (d.variants.length === 0) {
      data = {
        variants: [{ id: 'default', label: 'DEFAULT', subcategories: [] }],
      } as DossierContent;
    }
  }

  return { stackStyle, contentBlockType, data };
}

/** 序列化為 content block 格式（用於 save） */
export function serializeConceptsContent(
  editorData: ConceptsEditorData
): { id: string; type: string; content: string }[] {
  return [
    {
      id: 'content',
      type: editorData.contentBlockType,
      content: JSON.stringify(editorData.data),
    },
  ];
}

function getBlockType(style: StackStyle): string {
  switch (style) {
    case 'dossier':
      return 'dossier';
    case 'browser':
      return 'browser_profile';
    case 'chrono':
      return 'chronograph';
    case 'diff':
      return 'diff_table';
  }
}

function getEmptyData(style: StackStyle): ConceptsData {
  switch (style) {
    case 'dossier':
      return {
        variants: [{ id: 'default', label: 'DEFAULT', subcategories: [] }],
      } as DossierContent;
    case 'browser':
      return { profiles: [] } as BrowserContent;
    case 'chrono':
      return {
        fieldDefs: [
          {
            id: 'main',
            icon: '☀',
            label: '主線事件 / 核心敘事',
            style: 'flat',
          },
          {
            id: 'regional',
            icon: '🏞',
            label: '區域動態 / 地區歷史',
            style: 'grouped',
          },
          { id: 'character', icon: '👤', label: '角色關鍵點', style: 'flat' },
        ],
        periods: [],
      } as ChronoContent;
    case 'diff':
      return { subcategories: [] } as DiffContent;
  }
}

// ── AliasesField — 匹配別名輸入（S7-D-2） ─────────────────────────

/** 別名字串解析：頓號/全半形逗號分隔，trim 後去空、去重 */
export function parseAliases(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,，、]/)) {
    const alias = part.trim();
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
  }
  return out;
}

interface AliasesFieldProps {
  value: string[] | undefined;
  onChange: (aliases: string[] | undefined) => void;
}

/**
 * 匹配別名輸入欄（EntityKeyField 旁，dossier/diff 條目詳情用）。
 * 供自動偵測 suggestion 與 terminal 檢索的補充匹配詞（S7-D 定案 3）。
 *
 * 本地 raw state 保留使用者輸入中的分隔符——controlled 直接
 * split→join 會吃掉剛打出的頓號（分類路徑欄位的既有毛病，不沿用）；
 * 外部值變化（切換條目）時若與本地解析結果不一致才覆蓋顯示值。
 */
export function AliasesField({ value, onChange }: AliasesFieldProps) {
  const [raw, setRaw] = useState(() => (value ?? []).join('、'));
  useEffect(() => {
    const external = (value ?? []).join('、');
    if (external !== parseAliases(raw).join('、')) setRaw(external);
    // raw 刻意不進 deps：只在外部值換內容（切條目）時覆蓋輸入中的字串
  }, [value]);
  return (
    <div className="ced-field-row">
      <label className="ced-label">別名</label>
      <input
        className="ced-input"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const parsed = parseAliases(e.target.value);
          onChange(parsed.length > 0 ? parsed : undefined);
        }}
        placeholder="暱稱/異寫，用、分隔（選填）"
        spellCheck={false}
      />
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────

export default function ConceptsEditorBody({
  accent,
  stackStyle,
  initialData,
  onDataChange,
  onDirty,
  apiBase,
  pageId,
}: ConceptsEditorBodyProps) {
  const [data, setData] = useState<ConceptsEditorData>(initialData);
  const lastSavedSnapshot = useRef(JSON.stringify(initialData.data));

  // 跨頁 entityKey：唯一性規則是「每個 stack 內一次」且跨頁生效，
  // 但各 stack 元件手上只有自己這一頁的資料。records 之類的容器底下
  // 有好幾頁同屬 dossier，同一個 key 在其中兩頁出現就違規，逐頁比對
  // 抓不到——所以這裡補一份跨頁的既有 key。
  //
  // 後端 upsertPage 另有 409 最終防線；這一層是為了讓編輯者在存檔前
  // 就看到警告，而不是送出後才被擋。
  const [externalKeys, setExternalKeys] = useState<Map<string, Set<string>>>(
    () => new Map()
  );

  React.useEffect(() => {
    if (!apiBase) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/concepts/entity-index`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok: boolean;
          data?: {
            entries?: {
              entityKey?: string;
              stack?: string;
              pageId?: string;
              variantId?: string;
            }[];
          };
        };
        if (cancelled || !json.ok) return;
        const byScope = new Map<string, Set<string>>();
        for (const entry of json.data?.entries ?? []) {
          if (!entry.entityKey || entry.stack !== stackStyle) continue;
          // 自己這一頁的 key 由各 stack 元件用當下編輯中的資料判斷，
          // 索引裡的是存檔前的舊值，混進來會誤報
          if (pageId && entry.pageId === pageId) continue;
          const scope = stackStyle === 'dossier' ? (entry.variantId ?? '') : '';
          const set = byScope.get(scope) ?? new Set<string>();
          set.add(entry.entityKey);
          byScope.set(scope, set);
        }
        setExternalKeys(byScope);
      } catch {
        // 查不到就退回同頁比對——後端 409 仍然擋得住
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, pageId, stackStyle]);

  const lookupExternalKeys = React.useMemo<ExternalKeyLookup>(
    () => (variantId?: string) =>
      externalKeys.get(stackStyle === 'dossier' ? (variantId ?? '') : '') ??
      EMPTY_KEYS,
    [externalKeys, stackStyle]
  );

  function update(newContent: ConceptsData) {
    const next = { ...data, data: newContent };
    setData(next);
    onDataChange(next);
    onDirty(JSON.stringify(newContent) !== lastSavedSnapshot.current);
  }

  // 讓 parent 在 save 成功後可以更新 snapshot（透過 window event）
  React.useEffect(() => {
    function handleSaved() {
      lastSavedSnapshot.current = JSON.stringify(data.data);
    }
    window.addEventListener('concepts-editor-saved', handleSaved);
    return () =>
      window.removeEventListener('concepts-editor-saved', handleSaved);
  }, [data.data]);

  return (
    <div
      className="ced"
      style={{ '--ced-accent': accent } as React.CSSProperties}
    >
      <div className="ced-header">
        <span
          className="ced-badge"
          style={{ borderColor: accent, color: accent }}
        >
          {stackStyle.toUpperCase()} EDITOR
        </span>
        <span className="ced-type-label">{data.contentBlockType}</span>
      </div>

      {/* 依 stackStyle 分派（上方 TipTap 由 RichEditor 處理） */}
      {stackStyle === 'dossier' && (
        <DossierEditor
          data={data.data as DossierContent}
          onChange={(d) => update(d)}
          accent={accent}
          externalKeys={lookupExternalKeys}
        />
      )}
      {stackStyle === 'browser' && (
        <BrowserEditor
          data={data.data as BrowserContent}
          onChange={(d) => update(d)}
          accent={accent}
          externalKeys={lookupExternalKeys}
        />
      )}
      {stackStyle === 'chrono' && (
        <ChronoEditor
          data={data.data as ChronoContent}
          onChange={(d) => update(d)}
          accent={accent}
        />
      )}
      {stackStyle === 'diff' && (
        <DiffEditor
          data={data.data as DiffContent}
          onChange={(d) => update(d)}
          accent={accent}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Dossier 編輯器（外層：variant tab 列）
// ══════════════════════════════════════════════════════════════════

function DossierEditor({
  data,
  onChange,
  accent,
  externalKeys = NO_EXTERNAL_KEYS,
}: {
  data: DossierContent;
  onChange: (d: DossierContent) => void;
  accent: string;
  externalKeys?: ExternalKeyLookup;
}) {
  const variants: DossierVariant[] =
    data.variants && data.variants.length > 0
      ? data.variants
      : [{ id: 'default', label: 'DEFAULT', subcategories: [] }];
  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const safeIdx = Math.min(activeVariantIdx, variants.length - 1);
  const currentVariant = variants[safeIdx];

  // 第一次掛載時若 data 沒有 variants，補一個預設讓父層同步
  React.useEffect(() => {
    if (!data.variants || data.variants.length === 0) {
      onChange({ variants });
    }
  }, []); // eslint-disable-line

  function updateVariants(next: DossierVariant[]) {
    onChange({ variants: next });
  }
  function updateCurrentSubcats(subcategories: DossierSubcat[]) {
    updateVariants(
      variants.map((v, i) => (i === safeIdx ? { ...v, subcategories } : v))
    );
  }

  async function addVariant() {
    const idRaw = await getDialog().prompt(
      '輸入新 variant 的 ID（小寫，建議 u/e/p 等 era 代號）：',
      { title: '新增 Variant', placeholder: 'u' }
    );
    if (!idRaw) return;
    const id = idRaw.trim().toLowerCase();
    if (!id) return;
    if (variants.some((v) => v.id === id)) {
      await getDialog().alert(`Variant ID「${id}」已存在。`, {
        title: '無法新增',
      });
      return;
    }
    const labelRaw = await getDialog().prompt(
      '輸入顯示用標籤（會出現在 reader 標題旁，慣例為大寫）：',
      { title: '新增 Variant', placeholder: id.toUpperCase() }
    );
    const label = (labelRaw?.trim() || id).toUpperCase();
    updateVariants([...variants, { id, label, subcategories: [] }]);
    setActiveVariantIdx(variants.length);
  }

  async function renameVariant(idx: number) {
    const v = variants[idx];
    if (!v) return;
    const labelRaw = await getDialog().prompt('變更顯示標籤：', {
      title: '重新命名 Variant',
      placeholder: v.label,
      defaultValue: v.label,
    });
    if (labelRaw === null || labelRaw === undefined) return;
    const label = labelRaw.trim().toUpperCase() || v.label;
    updateVariants(
      variants.map((vv, i) => (i === idx ? { ...vv, label } : vv))
    );
  }

  async function removeVariant(idx: number) {
    if (variants.length <= 1) {
      await getDialog().alert('至少要保留一個 variant。', {
        title: '無法刪除',
      });
      return;
    }
    const v = variants[idx];
    const count = v.subcategories.reduce(
      (s, sc) => s + sc.groups.reduce((g, gr) => g + gr.entries.length, 0),
      0
    );
    const ok = await getDialog().confirm(
      `確定要刪除 variant「${v.label}」(${v.id})？\n此 variant 內有 ${count} 個條目，刪除後無法復原。`,
      { title: '刪除 Variant', confirmText: '刪除', cancelText: '取消' }
    );
    if (!ok) return;
    const next = variants.filter((_, i) => i !== idx);
    updateVariants(next);
    if (safeIdx >= next.length)
      setActiveVariantIdx(Math.max(0, next.length - 1));
    else if (safeIdx > idx) setActiveVariantIdx(safeIdx - 1);
  }

  return (
    <>
      {/* Variant tab 列 */}
      <div className="ced-variant-bar">
        <span className="ced-variant-bar-label">VARIANT</span>
        <div className="ced-variant-tabs">
          {variants.map((v, i) => (
            <div
              key={v.id + '-' + i}
              className={`ced-variant-tab ${i === safeIdx ? 'active' : ''}`}
            >
              <button
                type="button"
                className="ced-variant-tab-btn"
                onClick={() => setActiveVariantIdx(i)}
                onDoubleClick={() => renameVariant(i)}
                title={`${v.id} (雙擊重新命名)`}
                style={{ borderColor: i === safeIdx ? accent : undefined }}
              >
                <span className="ced-variant-tab-label">{v.label}</span>
                <span className="ced-variant-tab-id">{v.id}</span>
              </button>
              {variants.length > 1 && (
                <button
                  type="button"
                  className="ced-variant-tab-del"
                  onClick={() => removeVariant(i)}
                  title="刪除 variant"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ced-variant-add"
          onClick={addVariant}
          style={{ color: accent, borderColor: accent }}
        >
          + 新增 Variant
        </button>
      </div>

      <DossierVariantBody
        key={currentVariant.id}
        subcategories={currentVariant.subcategories}
        onSubcatsChange={updateCurrentSubcats}
        accent={accent}
        externalKeys={externalKeys(currentVariant.id)}
      />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
// Dossier 編輯器（單一 variant 內容）
// ══════════════════════════════════════════════════════════════════

function DossierVariantBody({
  subcategories,
  onSubcatsChange,
  accent,
  externalKeys = EMPTY_KEYS,
}: {
  subcategories: DossierSubcat[];
  onSubcatsChange: (subcats: DossierSubcat[]) => void;
  accent: string;
  /** 同 stack 同 variant 的其他頁面已使用的 key */
  externalKeys?: Set<string>;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [activeGroup, setActiveGroup] = useState(0);
  const [activeEntry, setActiveEntry] = useState<number | null>(null);
  // 右側面板模式：'group'=編輯群組, 'entry'=編輯條目
  const [panelMode, setPanelMode] = useState<'group' | 'entry'>('group');
  const [dragEntryInfo, setDragEntryInfo] = useState<{
    groupIdx: number;
    entryIdx: number;
  } | null>(null);
  const [revModalOpen, setRevModalOpen] = useState(false);
  // 條目列表結構版本：刪除/拖曳會 shift index，active 索引可能指到
  // 不同條目但數值不變——進 MiniEditor key 強制 remount 防內容殘留
  const [listVersion, setListVersion] = useState(0);

  function updateSubcats(subcats: DossierSubcat[]) {
    onSubcatsChange(subcats);
  }
  function addSubcat() {
    updateSubcats([
      ...subcategories,
      { label: '新分類', groups: [{ label: '', entries: [] }] },
    ]);
  }
  function removeSubcat(i: number) {
    updateSubcats(subcategories.filter((_, idx) => idx !== i));
    if (activeTab >= subcategories.length - 1)
      setActiveTab(Math.max(0, subcategories.length - 2));
    setActiveEntry(null);
  }

  const subcat = subcategories[activeTab];

  function updateGroups(groups: DossierGroup[]) {
    updateSubcats(
      subcategories.map((sc, i) => (i === activeTab ? { ...sc, groups } : sc))
    );
  }
  function addGroup() {
    if (!subcat) return;
    updateGroups([...subcat.groups, { label: '新群組', entries: [] }]);
  }

  // 刪除群組：條目移至預設群組或全部刪除
  async function removeGroup(gi: number) {
    if (!subcat || gi === 0) return; // 預設群組（index 0）不可刪
    const g = subcat.groups[gi];
    if (g.entries.length > 0) {
      const ok = await getDialog().confirm(
        `群組「${g.label || '未命名'}」有 ${g.entries.length} 個條目。\n確定 → 條目移至預設群組\n取消 → 不做任何操作`,
        { title: '刪除群組', confirmText: '移動並刪除', cancelText: '取消' }
      );
      if (!ok) return;
      // 移動條目到預設群組（index 0）
      const newGroups = [...subcat.groups];
      newGroups[0] = {
        ...newGroups[0],
        entries: [...newGroups[0].entries, ...g.entries],
      };
      newGroups.splice(gi, 1);
      updateGroups(newGroups);
    } else {
      updateGroups(subcat.groups.filter((_, idx) => idx !== gi));
    }
    if (activeGroup >= gi) setActiveGroup(Math.max(0, activeGroup - 1));
    setActiveEntry(null);
    setPanelMode('group');
  }

  const group = subcat?.groups[activeGroup];

  function updateEntries(entries: DossierEntry[]) {
    if (!subcat) return;
    updateGroups(
      subcat.groups.map((g, i) => (i === activeGroup ? { ...g, entries } : g))
    );
  }
  function addEntry() {
    if (!group) return;
    updateEntries([...group.entries, { name: '' }]);
    setActiveEntry(group.entries.length);
    setPanelMode('entry');
  }
  async function removeEntry(i: number) {
    if (!group) return;
    const target = group.entries[i];
    const ok = await getDialog().confirm(
      `確定要刪除條目「${target?.name || '(空條目)'}」嗎？此操作無法復原。`,
      { title: '刪除條目', confirmText: '刪除', cancelText: '取消' }
    );
    if (!ok) return;
    updateEntries(group.entries.filter((_, idx) => idx !== i));
    setListVersion((v) => v + 1);
    if (activeEntry === i) {
      setActiveEntry(null);
      setPanelMode('group');
    }
  }
  function updateEntry(i: number, patch: Partial<DossierEntry>) {
    if (!group) return;
    updateEntries(
      group.entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    );
  }

  // 拖曳條目到其他群組
  function handleEntryDropOnGroup(targetGroupIdx: number) {
    if (!dragEntryInfo || !subcat) return;
    const { groupIdx: srcGi, entryIdx: srcEi } = dragEntryInfo;
    if (srcGi === targetGroupIdx) return;
    const srcGroup = subcat.groups[srcGi];
    const entry = srcGroup.entries[srcEi];
    const newGroups = subcat.groups.map((g, gi) => {
      if (gi === srcGi)
        return { ...g, entries: g.entries.filter((_, idx) => idx !== srcEi) };
      if (gi === targetGroupIdx)
        return { ...g, entries: [...g.entries, entry] };
      return g;
    });
    updateGroups(newGroups);
    setListVersion((v) => v + 1);
    if (activeGroup === srcGi && activeEntry === srcEi) {
      setActiveEntry(null);
      setPanelMode('group');
    }
    setDragEntryInfo(null);
  }

  // 同群組內拖曳排序
  function handleEntryReorder(targetIdx: number) {
    if (!dragEntryInfo || !group) return;
    if (dragEntryInfo.groupIdx !== activeGroup) return;
    const items = [...group.entries];
    const [moved] = items.splice(dragEntryInfo.entryIdx, 1);
    items.splice(targetIdx, 0, moved);
    updateEntries(items);
    setListVersion((v) => v + 1);
    if (activeEntry === dragEntryInfo.entryIdx) setActiveEntry(targetIdx);
    setDragEntryInfo(null);
  }

  const entry =
    activeEntry !== null && group ? group.entries[activeEntry] : null;

  // entityKey 唯一性範圍 = 同 variant 內（跨 variant 允許同 key，
  // 各 variant 的條目維護自己的 revision 鏈——設計文件 §1-3-a），
  // 且跨頁生效——同屬 dossier 的其他頁面用掉的 key 一併算入
  const usedEntityKeys = React.useMemo(() => {
    const keys = new Set<string>(externalKeys);
    subcategories.forEach((sc, sci) =>
      sc.groups.forEach((g, gi) =>
        g.entries.forEach((ent, ei) => {
          if (sci === activeTab && gi === activeGroup && ei === activeEntry)
            return;
          if (ent.entityKey) keys.add(ent.entityKey);
        })
      )
    );
    return keys;
  }, [subcategories, activeTab, activeGroup, activeEntry, externalKeys]);

  React.useEffect(() => {
    if (subcat && subcat.groups.length === 0)
      updateGroups([{ label: '', entries: [] }]);
  }, [activeTab, subcat?.groups.length]);

  return (
    <div className="ced-section">
      <div className="ced-section-header">
        <span className="ced-section-title">分類</span>
        <button
          className="ced-add-btn"
          onClick={addSubcat}
          style={{ color: accent }}
        >
          + 新增分類
        </button>
      </div>
      {subcategories.length > 0 && (
        <div className="ced-tabs">
          {subcategories.map((sc, i) => (
            <div
              key={i}
              className={`ced-tab ${i === activeTab ? 'active' : ''}`}
            >
              <button
                className="ced-tab-btn"
                onClick={() => {
                  setActiveTab(i);
                  setActiveGroup(0);
                  setActiveEntry(null);
                  setPanelMode('group');
                }}
              >
                {sc.label || '(未命名)'}
              </button>
              <button className="ced-tab-del" onClick={() => removeSubcat(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {subcat && (
        <>
          <div className="ced-field-row">
            <label className="ced-label">分類名稱</label>
            <input
              className="ced-input"
              value={subcat.label}
              onChange={(e) =>
                updateSubcats(
                  subcategories.map((sc, i) =>
                    i === activeTab ? { ...sc, label: e.target.value } : sc
                  )
                )
              }
            />
          </div>

          <div className="ced-browser-split" style={{ minHeight: 250 }}>
            {/* 左側 */}
            <div className="ced-browser-nav">
              <div className="ced-browser-breadcrumb">
                <span style={{ fontWeight: 600 }}>群組</span>
                <button
                  className="ced-add-btn"
                  onClick={addGroup}
                  style={{ color: accent, marginLeft: 'auto', fontSize: 10 }}
                >
                  + 群組
                </button>
              </div>

              {subcat.groups.map((g, gi) => (
                <div key={gi}>
                  <div
                    className={`ced-browser-folder ${gi === activeGroup && panelMode === 'group' ? 'active' : ''}`}
                    onClick={() => {
                      setActiveGroup(gi);
                      setActiveEntry(null);
                      setPanelMode('group');
                    }}
                    style={{
                      borderLeft:
                        gi === activeGroup
                          ? `3px solid ${accent}`
                          : '3px solid transparent',
                    }}
                    onDragOver={
                      dragEntryInfo
                        ? (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add('drag-over');
                          }
                        : undefined
                    }
                    onDragLeave={
                      dragEntryInfo
                        ? (e) => {
                            e.currentTarget.classList.remove('drag-over');
                          }
                        : undefined
                    }
                    onDrop={
                      dragEntryInfo
                        ? (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('drag-over');
                            handleEntryDropOnGroup(gi);
                          }
                        : undefined
                    }
                  >
                    <span
                      className="ced-browser-folder-name"
                      style={{ fontSize: 12 }}
                    >
                      {gi === 0 && !g.label ? '(預設)' : g.label || '(未命名)'}
                    </span>
                    <span className="ced-count">{g.entries.length}</span>
                    {gi > 0 && (
                      <button
                        className="ced-browser-file-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeGroup(gi);
                        }}
                        style={{ opacity: 1 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {gi === activeGroup &&
                    g.entries.map((ent, ei) => (
                      <div
                        key={ei}
                        className={`ced-browser-file ${activeEntry === ei && panelMode === 'entry' ? 'active' : ''} ${dragEntryInfo?.groupIdx === gi && dragEntryInfo?.entryIdx === ei ? 'dragging' : ''}`}
                        onClick={() => {
                          setActiveEntry(ei);
                          setPanelMode('entry');
                        }}
                        style={{ paddingLeft: 20 }}
                        draggable
                        onDragStart={() =>
                          setDragEntryInfo({ groupIdx: gi, entryIdx: ei })
                        }
                        onDragEnd={() => setDragEntryInfo(null)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('drag-over');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('drag-over');
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('drag-over');
                          handleEntryReorder(ei);
                        }}
                      >
                        <span
                          className="ced-browser-file-icon"
                          style={{ fontSize: 10 }}
                        >
                          ◈
                        </span>
                        <span className="ced-browser-file-name">
                          {ent.name || '(空條目)'}
                        </span>
                        <button
                          className="ced-browser-file-del"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEntry(ei);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                </div>
              ))}

              <div className="ced-browser-actions">
                {group && (
                  <button
                    className="ced-add-btn"
                    onClick={addEntry}
                    style={{ color: accent }}
                  >
                    + 新增條目
                  </button>
                )}
              </div>
            </div>

            {/* 右側 */}
            <div className="ced-browser-detail">
              {panelMode === 'entry' && entry ? (
                <>
                  <div className="ced-browser-detail-header">
                    <span>{entry.name || '(空條目)'}</span>
                    <button
                      className="ced-del-btn"
                      onClick={() => removeEntry(activeEntry!)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="ced-field-row">
                    <label className="ced-label">名稱</label>
                    <input
                      className="ced-input"
                      value={entry.name}
                      onChange={(e) =>
                        updateEntry(activeEntry!, { name: e.target.value })
                      }
                    />
                  </div>
                  <EntityKeyField
                    value={entry.entityKey}
                    onChange={(key) =>
                      updateEntry(activeEntry!, { entityKey: key })
                    }
                    existingKeys={usedEntityKeys}
                  />
                  <EntityBindingsFields
                    entityKey={entry.entityKey}
                    value={entry.bindings}
                    onChange={(bindings) =>
                      updateEntry(activeEntry!, { bindings })
                    }
                  />
                  <AliasesField
                    value={entry.aliases}
                    onChange={(aliases) =>
                      updateEntry(activeEntry!, { aliases })
                    }
                  />
                  <div className="ced-field-row">
                    <label className="ced-label">版本</label>
                    <button
                      className="ced-rev-open-btn"
                      onClick={() => setRevModalOpen(true)}
                      style={{ color: accent }}
                    >
                      進度版本 ({entry.revisions?.length ?? 0})
                    </button>
                  </div>
                  <div className="ced-section-header">
                    <span className="ced-section-title">描述</span>
                  </div>
                  {/* key：TipTap content 只吃初始值，切換條目必須 remount，
                      否則殘留前一條目內容（編輯還會把舊內容寫進新條目） */}
                  <MiniEditor
                    key={`${activeTab}-${activeGroup}-${activeEntry}-${listVersion}`}
                    value={entry.content_html || ''}
                    onChange={(html) =>
                      updateEntry(activeEntry!, {
                        content_html: html || undefined,
                      })
                    }
                    placeholder="描述內容..."
                  />
                </>
              ) : group ? (
                <>
                  <div className="ced-browser-detail-header">
                    <span>群組設定{activeGroup === 0 ? ' (預設)' : ''}</span>
                    {activeGroup > 0 && (
                      <button
                        className="ced-del-btn"
                        onClick={() => removeGroup(activeGroup)}
                      >
                        刪除群組
                      </button>
                    )}
                  </div>
                  <div className="ced-field-row">
                    <label className="ced-label">群組名稱</label>
                    <input
                      className="ced-input"
                      value={group.label}
                      onChange={(e) =>
                        updateGroups(
                          subcat.groups.map((g, i) =>
                            i === activeGroup
                              ? { ...g, label: e.target.value }
                              : g
                          )
                        )
                      }
                      placeholder={
                        activeGroup === 0
                          ? '留空則閱讀器不顯示名稱'
                          : '群組名稱'
                      }
                    />
                  </div>
                  <div className="ced-empty" style={{ marginTop: 8 }}>
                    {activeGroup === 0
                      ? '預設群組不可刪除。名稱留空時閱讀器不會顯示群組標題。'
                      : '拖曳左側條目到群組名稱上可移動條目。'}
                  </div>
                  <div className="ced-empty">{group.entries.length} 個條目</div>
                  {/* 群組解鎖條件（S7 驗收 #3）：未過整組隱藏（含全部條目） */}
                  <div className="ced-section-header">
                    <span className="ced-section-title">群組解鎖條件</span>
                  </div>
                  <GateConditionEditor
                    value={group.gate ?? null}
                    onChange={(gate) =>
                      updateGroups(
                        subcat.groups.map((g, i) =>
                          i === activeGroup
                            ? { ...g, gate: gate ?? undefined }
                            : g
                        )
                      )
                    }
                    apiBase={API_BASE}
                    accent={accent}
                    showAlwaysLocked
                  />
                  {group.gate && (
                    <div className="ced-rev-hint">
                      ⓘ 條件未通過時整組隱藏——底下條目自身的 解鎖條件不再求值。
                    </div>
                  )}
                </>
              ) : (
                <div className="ced-browser-empty">
                  <div>選擇一個群組</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {revModalOpen && entry && (
        <RevisionModal
          entryLabel={entry.name || '(未命名條目)'}
          stackStyle="dossier"
          entityKey={entry.entityKey}
          baseEntry={entry as unknown as Record<string, unknown>}
          revisions={entry.revisions ?? []}
          onChange={(revs) =>
            updateEntry(activeEntry!, {
              revisions: revs.length > 0 ? revs : undefined,
            })
          }
          baseGate={entry.gate ?? null}
          onBaseGateChange={(gate) =>
            updateEntry(activeEntry!, { gate: gate ?? undefined })
          }
          onClose={() => setRevModalOpen(false)}
          accent={accent}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Browser 編輯器（資料夾瀏覽器模式 + 拖曳分類）
// ══════════════════════════════════════════════════════════════════

function BrowserEditor({
  data,
  onChange,
  accent,
  externalKeys = NO_EXTERNAL_KEYS,
}: {
  data: BrowserContent;
  onChange: (d: BrowserContent) => void;
  accent: string;
  externalKeys?: ExternalKeyLookup;
}) {
  // 左側：當前瀏覽路徑（分類層級）
  const [navPath, setNavPath] = useState<string[]>([]);
  // 右側：選中的角色 index（null = 顯示目錄）
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // 拖曳中的 profile index
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // 新增分類的輸入
  const [newCatName, setNewCatName] = useState('');
  // 圖片選取器
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<
    { key: string; size: number }[]
  >([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarDeleteOpen, setAvatarDeleteOpen] = useState(false);
  const [revModalOpen, setRevModalOpen] = useState(false);
  // 列表結構版本：刪除角色/區段、區段拖曳會 shift index——
  // 進 MiniEditor key 強制 remount 防內容殘留
  const [listVersion, setListVersion] = useState(0);

  function updateProfiles(profiles: CharacterProfile[]) {
    onChange({ ...data, profiles });
  }

  // 取得當前路徑下的子分類和角色
  const { subcategories, profiles: currentProfiles } = React.useMemo(() => {
    const subcatSet = new Set<string>();
    const profs: { idx: number; profile: CharacterProfile }[] = [];

    // 從 category_tree 提取當前層級的子分類
    if (data.category_tree) {
      let nodes = data.category_tree;
      for (const seg of navPath) {
        const found = nodes.find((n) => n.label === seg);
        nodes = found?.children || [];
      }
      for (const n of nodes) subcatSet.add(n.label);
    }

    // 從 profiles 的 categories 補充
    for (let i = 0; i < data.profiles.length; i++) {
      const p = data.profiles[i];
      const cats = p.categories || [];
      const matchesPath = navPath.every((seg, d) => cats[d] === seg);
      if (!matchesPath) continue;
      if (cats.length > navPath.length) {
        subcatSet.add(cats[navPath.length]);
      } else {
        profs.push({ idx: i, profile: p });
      }
    }
    return { subcategories: [...subcatSet].sort(), profiles: profs };
  }, [data.profiles, data.category_tree, navPath]);

  const profile = activeIdx !== null ? data.profiles[activeIdx] : null;

  // entityKey 唯一性範圍 = 整個 browser stack（跨頁，排除自身條目）
  const usedEntityKeys = React.useMemo(() => {
    const keys = new Set<string>(externalKeys());
    data.profiles.forEach((p, i) => {
      if (i === activeIdx) return;
      if (p.entityKey) keys.add(p.entityKey);
    });
    return keys;
  }, [data.profiles, activeIdx, externalKeys]);

  function updateProfile(patch: Partial<CharacterProfile>) {
    if (activeIdx === null) return;
    updateProfiles(
      data.profiles.map((p, i) => (i === activeIdx ? { ...p, ...patch } : p))
    );
  }
  async function removeProfile(i: number) {
    const name = data.profiles[i]?.name || '(未命名)';
    const ok = await getDialog().confirm(
      `確定要刪除角色「${name}」嗎？此操作無法復原。`,
      { title: '刪除角色', confirmText: '刪除', cancelText: '取消' }
    );
    if (!ok) return;
    updateProfiles(data.profiles.filter((_, idx) => idx !== i));
    setListVersion((v) => v + 1);
    if (activeIdx === i) setActiveIdx(null);
  }
  function addProfileHere() {
    const cats = navPath.length > 0 ? [...navPath] : undefined;
    updateProfiles([...data.profiles, { name: '新角色', categories: cats }]);
    setActiveIdx(data.profiles.length);
  }
  function addSubcategory() {
    if (!newCatName.trim()) return;
    // 在 category_tree 中新增分類節點
    const tree = JSON.parse(
      JSON.stringify(data.category_tree || [])
    ) as import('../concepts/types').TagNode[];
    let nodes = tree;
    for (const seg of navPath) {
      let found = nodes.find((n) => n.label === seg);
      if (!found) {
        found = { label: seg, children: [] };
        nodes.push(found);
      }
      if (!found.children) found.children = [];
      nodes = found.children;
    }
    if (!nodes.find((n) => n.label === newCatName.trim())) {
      nodes.push({ label: newCatName.trim(), children: [] });
    }
    onChange({ ...data, category_tree: tree });
    setNewCatName('');
  }

  // 拖曳：把角色移到某個分類
  function handleDrop(targetPath: string[]) {
    if (dragIdx === null) return;
    const updated = data.profiles.map((p, i) =>
      i === dragIdx
        ? { ...p, categories: targetPath.length > 0 ? targetPath : undefined }
        : p
    );
    updateProfiles(updated);
    setDragIdx(null);
  }

  function updateSections(sections: CharacterProfile['sections']) {
    updateProfile({ sections });
  }
  function addSection() {
    updateSections([
      ...(profile?.sections || []),
      { label: '新區段', content_html: '' },
    ]);
  }
  function removeSection(i: number) {
    updateSections((profile?.sections || []).filter((_, idx) => idx !== i));
    setListVersion((v) => v + 1);
  }
  // 區段拖曳排序
  const [dragSectionIdx, setDragSectionIdx] = useState<number | null>(null);
  function handleSectionDrop(targetIdx: number) {
    if (dragSectionIdx === null || !profile?.sections) return;
    const items = [...profile.sections];
    const [moved] = items.splice(dragSectionIdx, 1);
    items.splice(targetIdx, 0, moved);
    updateSections(items);
    setListVersion((v) => v + 1);
    setDragSectionIdx(null);
  }
  // 麵包屑 drop handler
  function handleBreadcrumbDrop(e: React.DragEvent, targetPath: string[]) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    handleDrop(targetPath);
  }
  function handleDragOverBreadcrumb(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }
  function handleDragLeaveBreadcrumb(e: React.DragEvent) {
    e.currentTarget.classList.remove('drag-over');
  }

  return (
    <div className="ced-section">
      <div className="ced-browser-split">
        {/* ─── 左側：資料夾瀏覽 ─── */}
        <div className="ced-browser-nav">
          {/* 麵包屑 */}
          <div className="ced-browser-breadcrumb">
            <button
              onClick={() => {
                setNavPath([]);
                setActiveIdx(null);
              }}
              className={`${navPath.length === 0 ? 'active' : ''} ${dragIdx !== null ? 'drop-target' : ''}`}
              onDragOver={
                dragIdx !== null ? handleDragOverBreadcrumb : undefined
              }
              onDragLeave={
                dragIdx !== null ? handleDragLeaveBreadcrumb : undefined
              }
              onDrop={
                dragIdx !== null
                  ? (e) => handleBreadcrumbDrop(e, [])
                  : undefined
              }
            >
              全部
            </button>
            {navPath.map((seg, d) => (
              <React.Fragment key={d}>
                <span className="ced-browser-sep">›</span>
                <button
                  onClick={() => {
                    setNavPath((prev) => prev.slice(0, d + 1));
                    setActiveIdx(null);
                  }}
                  className={`${d === navPath.length - 1 ? 'active' : ''} ${dragIdx !== null ? 'drop-target' : ''}`}
                  onDragOver={
                    dragIdx !== null ? handleDragOverBreadcrumb : undefined
                  }
                  onDragLeave={
                    dragIdx !== null ? handleDragLeaveBreadcrumb : undefined
                  }
                  onDrop={
                    dragIdx !== null
                      ? (e) => handleBreadcrumbDrop(e, navPath.slice(0, d + 1))
                      : undefined
                  }
                >
                  {seg}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* 子分類資料夾 */}
          {subcategories.map((cat) => (
            <div
              key={cat}
              className={`ced-browser-folder ${dragIdx !== null ? 'drop-target' : ''}`}
              onClick={() => {
                setNavPath((prev) => [...prev, cat]);
                setActiveIdx(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('drag-over');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                handleDrop([...navPath, cat]);
              }}
            >
              <span className="ced-browser-folder-icon">📁</span>
              <span className="ced-browser-folder-name">{cat}</span>
              <span className="ced-count">
                {
                  data.profiles.filter((p) => {
                    const c = p.categories || [];
                    return (
                      navPath.every((s, d) => c[d] === s) &&
                      c[navPath.length] === cat
                    );
                  }).length
                }
              </span>
              <span className="ced-browser-folder-arrow">›</span>
            </div>
          ))}

          {/* 當前層級的角色 */}
          {currentProfiles.map(({ idx, profile: p }) => (
            <div
              key={idx}
              className={`ced-browser-file ${activeIdx === idx ? 'active' : ''}`}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragEnd={() => setDragIdx(null)}
              onClick={() => setActiveIdx(idx)}
            >
              <span className="ced-browser-file-icon">
                {p.placeholder ? '🔒' : '👤'}
              </span>
              <span className="ced-browser-file-name">
                {p.name || '(未命名)'}
              </span>
              <button
                className="ced-browser-file-del"
                onClick={(e) => {
                  e.stopPropagation();
                  removeProfile(idx);
                }}
                title="刪除"
              >
                ✕
              </button>
            </div>
          ))}

          {/* 操作列 */}
          <div className="ced-browser-actions">
            <button
              className="ced-add-btn"
              onClick={addProfileHere}
              style={{ color: accent }}
            >
              + 新增角色
            </button>
            <div className="ced-browser-add-cat">
              <input
                className="ced-input"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="新分類名稱..."
                onKeyDown={(e) => e.key === 'Enter' && addSubcategory()}
                style={{ fontSize: 11, padding: '4px 8px' }}
              />
              <button
                className="ced-add-btn"
                onClick={addSubcategory}
                style={{ color: accent }}
              >
                + 分類
              </button>
            </div>
          </div>
        </div>

        {/* ─── 右側：角色編輯 ─── */}
        <div className="ced-browser-detail">
          {profile ? (
            <>
              <div className="ced-browser-detail-header">
                <span>{profile.name || '(未命名)'}</span>
                <button
                  className="ced-del-btn"
                  onClick={() => removeProfile(activeIdx!)}
                  title="刪除角色"
                >
                  ✕
                </button>
              </div>

              {/* 頭像 + 名稱 */}
              <div className="ced-avatar-row">
                <div className="ced-avatar-box">
                  {profile.avatar ? (
                    <img
                      src={buildImageUrl(profile.avatar)}
                      alt=""
                      className="ced-avatar-img"
                    />
                  ) : (
                    <span className="ced-avatar-placeholder">
                      {profile.name?.[0] || '?'}
                    </span>
                  )}
                  <div className="ced-avatar-actions">
                    <label
                      className="ced-avatar-upload-btn"
                      style={{ borderColor: accent, color: accent }}
                      title={avatarUploading ? '上傳中...' : '上傳頭像'}
                      aria-busy={avatarUploading}
                    >
                      {avatarUploading ? <UploadSpinner label={null} /> : '⬆'}
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={avatarUploading}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setAvatarUploading(true);
                          try {
                            const result = await uploadAsset(file);
                            if (result)
                              updateProfile({
                                avatar: toAssetPath(result.key),
                              });
                          } finally {
                            setAvatarUploading(false);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                    <button
                      className="ced-avatar-lib-btn"
                      style={{ borderColor: accent, color: accent }}
                      onClick={async () => {
                        setPickerOpen(true);
                        setPickerLoading(true);
                        try {
                          const res = await fetch(
                            `/api/assets?prefix=images/&limit=500`
                          );
                          const json = (await res.json()) as {
                            ok: boolean;
                            data: { items: { key: string; size: number }[] };
                          };
                          if (json.ok) setPickerItems(json.data.items || []);
                        } catch {
                          /* 靜默 */
                        }
                        setPickerLoading(false);
                      }}
                      title="從媒體庫選取"
                    >
                      📂
                    </button>
                    {profile.avatar && (
                      <button
                        className="ced-avatar-del-btn"
                        onClick={() => setAvatarDeleteOpen(true)}
                        title="移除頭像"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="ced-avatar-fields">
                  <div className="ced-field-row">
                    <label className="ced-label">角色名稱</label>
                    <input
                      className="ced-input"
                      value={profile.name}
                      onChange={(e) => updateProfile({ name: e.target.value })}
                    />
                  </div>
                  <div className="ced-field-row">
                    <label className="ced-label">分類路徑</label>
                    <input
                      className="ced-input"
                      value={profile.categories?.join(' › ') || ''}
                      onChange={(e) =>
                        updateProfile({
                          categories: e.target.value
                            ? e.target.value
                                .split('›')
                                .map((s) => s.trim())
                                .filter(Boolean)
                            : undefined,
                        })
                      }
                      placeholder="用 › 分隔"
                    />
                  </div>
                </div>
              </div>
              <EntityKeyField
                value={profile.entityKey}
                onChange={(key) => updateProfile({ entityKey: key })}
                existingKeys={usedEntityKeys}
              />
              <EntityBindingsFields
                entityKey={profile.entityKey}
                value={profile.bindings}
                onChange={(bindings) => updateProfile({ bindings })}
              />
              <div className="ced-field-row">
                <label className="ced-label">版本</label>
                <button
                  className="ced-rev-open-btn"
                  onClick={() => setRevModalOpen(true)}
                  style={{ color: accent }}
                >
                  進度版本 ({profile.revisions?.length ?? 0})
                </button>
              </div>
              <label className="ced-checkbox-row">
                <input
                  type="checkbox"
                  checked={!!profile.placeholder}
                  onChange={(e) =>
                    updateProfile({
                      placeholder: e.target.checked || undefined,
                    })
                  }
                />
                <span>佔位符（鎖定狀態）</span>
              </label>

              {!profile.placeholder && (
                <>
                  <div className="ced-section-header">
                    <span className="ced-section-title">基本資料</span>
                    <button
                      className="ced-add-btn"
                      onClick={async () => {
                        const key = await getDialog().prompt('請輸入欄位名稱', {
                          title: '新增基本資料欄位',
                          placeholder: '如：種族、生日、能力',
                        });
                        if (key) {
                          const basic = { ...(profile.basic || {}), [key]: '' };
                          updateProfile({ basic });
                        }
                      }}
                      style={{ color: accent }}
                    >
                      + 欄位
                    </button>
                  </div>
                  {profile.basic &&
                    Object.entries(profile.basic).map(([k, v]) => (
                      <div key={k} className="ced-field-row">
                        <label className="ced-label ced-label-sm">{k}</label>
                        <input
                          className="ced-input"
                          value={v}
                          onChange={(e) =>
                            updateProfile({
                              basic: { ...profile.basic, [k]: e.target.value },
                            })
                          }
                        />
                        <button
                          className="ced-del-btn"
                          onClick={() => {
                            const next = { ...profile.basic };
                            delete next![k];
                            updateProfile({
                              basic:
                                Object.keys(next!).length > 0
                                  ? next
                                  : undefined,
                            });
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                  <div className="ced-section-header">
                    <span className="ced-section-title">區段</span>
                    <button
                      className="ced-add-btn"
                      onClick={addSection}
                      style={{ color: accent }}
                    >
                      + 區段
                    </button>
                  </div>
                  {(profile.sections || []).map((section, si) => (
                    <div
                      key={si}
                      className={`ced-entry-card ${dragSectionIdx === si ? 'dragging' : ''}`}
                      draggable
                      onDragStart={() => setDragSectionIdx(si)}
                      onDragEnd={() => setDragSectionIdx(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add('drag-over-section');
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.classList.remove('drag-over-section');
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('drag-over-section');
                        handleSectionDrop(si);
                      }}
                    >
                      <div className="ced-entry-top">
                        <span className="ced-drag-handle" title="拖曳排序">
                          ⠿
                        </span>
                        <input
                          className="ced-input ced-input-name"
                          value={section.label}
                          onChange={(e) => {
                            const next = [...(profile.sections || [])];
                            next[si] = { ...next[si], label: e.target.value };
                            updateSections(next);
                          }}
                          placeholder="區段名稱"
                        />
                        <button
                          className="ced-del-btn"
                          onClick={() => removeSection(si)}
                        >
                          ✕
                        </button>
                      </div>
                      {/* key 含 activeIdx：換角色時同 index 的區段
                          會被 React 重用，必須 remount 防內容殘留 */}
                      <MiniEditor
                        key={`${activeIdx}-${si}-${listVersion}`}
                        value={section.content_html}
                        onChange={(html) => {
                          const next = [...(profile.sections || [])];
                          next[si] = { ...next[si], content_html: html };
                          updateSections(next);
                        }}
                        placeholder="區段內容..."
                      />
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <div className="ced-browser-empty">
              <div>選擇角色進行編輯</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                拖曳角色到資料夾可變更分類
              </div>
            </div>
          )}
        </div>
      </div>

      {revModalOpen && profile && (
        <RevisionModal
          entryLabel={profile.name || '(未命名角色)'}
          stackStyle="browser"
          entityKey={profile.entityKey}
          baseEntry={profile as unknown as Record<string, unknown>}
          revisions={profile.revisions ?? []}
          onChange={(revs) =>
            updateProfile({ revisions: revs.length > 0 ? revs : undefined })
          }
          baseGate={profile.gate ?? null}
          onBaseGateChange={(gate) =>
            updateProfile({ gate: gate ?? undefined })
          }
          onClose={() => setRevModalOpen(false)}
          accent={accent}
        />
      )}

      {/* 圖片選取器 overlay */}
      {pickerOpen && (
        <div
          className="ced-picker-overlay"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="ced-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ced-picker-header">
              <strong>從媒體庫選擇頭像</strong>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--ink-mute)',
                  marginLeft: 10,
                }}
              >
                {pickerItems.length} 張圖片
              </span>
              <button
                className="ced-del-btn"
                onClick={() => setPickerOpen(false)}
                style={{ marginLeft: 'auto' }}
              >
                ✕
              </button>
            </div>
            <div className="ced-picker-grid">
              {pickerLoading && <div className="ced-empty">載入中...</div>}
              {!pickerLoading && pickerItems.length === 0 && (
                <div className="ced-empty">媒體庫中沒有圖片</div>
              )}
              {pickerItems.map((item) => (
                <button
                  key={item.key}
                  className={`ced-picker-item ${profile?.avatar === toAssetPath(item.key) ? 'selected' : ''}`}
                  onClick={() => {
                    updateProfile({ avatar: toAssetPath(item.key) });
                    setPickerOpen(false);
                  }}
                >
                  <img src={buildImageUrl(item.key)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 頭像刪除確認 */}
      {avatarDeleteOpen && profile?.avatar && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setAvatarDeleteOpen(false)}
        >
          <div
            style={{
              background: 'var(--bg-card, #1a1a22)',
              border: '1px solid var(--line, #333)',
              borderRadius: 12,
              padding: '24px 28px',
              maxWidth: 400,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, marginBottom: 8, fontSize: '1.05em' }}
            >
              移除頭像
            </div>
            <div
              style={{
                fontSize: '0.85em',
                color: 'var(--ink-mute, #888)',
                marginBottom: 16,
                wordBreak: 'break-all',
              }}
            >
              {profile.avatar.split('/').pop()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => {
                  updateProfile({ avatar: undefined });
                  setAvatarDeleteOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                }}
              >
                📎 僅從此角色移除
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8em',
                    color: 'var(--ink-mute, #888)',
                    marginTop: 2,
                  }}
                >
                  檔案保留在媒體庫中，可供其他頁面使用
                </span>
              </button>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={async () => {
                  const key = profile.avatar!;
                  updateProfile({ avatar: undefined });
                  setAvatarDeleteOpen(false);
                  try {
                    const raw = key.startsWith('/api/assets/')
                      ? key.slice('/api/assets/'.length)
                      : key;
                    const encoded = raw
                      .split('/')
                      .map(encodeURIComponent)
                      .join('/');
                    await fetch(`/api/assets/${encoded}`, {
                      method: 'DELETE',
                    });
                  } catch {
                    /* 靜默 */
                  }
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  textAlign: 'left',
                  borderColor: 'crimson',
                  color: 'crimson',
                }}
              >
                🗑 從媒體庫永久刪除
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.8em',
                    color: 'var(--ink-mute, #888)',
                    marginTop: 2,
                  }}
                >
                  移除引用並從 R2 儲存空間中刪除檔案
                </span>
              </button>
              <button
                type="button"
                className="ned-btn-ghost"
                onClick={() => setAvatarDeleteOpen(false)}
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Chrono 編輯器（時間軸池模式）
// ══════════════════════════════════════════════════════════════════

/** 預設欄位類別 */
const DEFAULT_FIELD_DEFS: ChronoFieldDef[] = [
  { id: 'main', icon: '☀', label: '主線事件 / 核心敘事', style: 'flat' },
  {
    id: 'regional',
    icon: '🏞',
    label: '區域動態 / 地區歷史',
    style: 'grouped',
  },
  { id: 'character', icon: '👤', label: '角色關鍵點', style: 'flat' },
];

/** 時期定義 */
const CHRONO_ERAS: { id: ChronoEra; label: string; maxYear?: number }[] = [
  { id: 'pre-ad', label: 'AD前' },
  { id: 'ad', label: 'AD', maxYear: 1505 },
  { id: 'fa', label: 'FA', maxYear: 1180 },
  { id: 'nw', label: 'NW' },
];

function formatChronoYear(era: ChronoEra, yearNum: number): string {
  const def = CHRONO_ERAS.find((e) => e.id === era);
  return `${def?.label || era} ${yearNum} 年`;
}

function parseChronoYear(yearStr: string): { era: ChronoEra; yearNum: number } {
  const preAd = yearStr.match(/AD前\s*(\d+)/);
  if (preAd) return { era: 'pre-ad', yearNum: parseInt(preAd[1]) || 1 };
  const fa = yearStr.match(/FA\s*(\d+)/);
  if (fa) return { era: 'fa', yearNum: parseInt(fa[1]) || 1 };
  const nw = yearStr.match(/NW\s*(\d+)/);
  if (nw) return { era: 'nw', yearNum: parseInt(nw[1]) || 1 };
  const ad = yearStr.match(/AD\s*(\d+)/);
  if (ad) return { era: 'ad', yearNum: parseInt(ad[1]) || 1 };
  const num = yearStr.match(/(\d+)/);
  return { era: 'ad', yearNum: num ? parseInt(num[1]) : 1 };
}

/** 紀元時序排序權重 */
const ERA_ORDER: Record<ChronoEra, number> = {
  'pre-ad': 0,
  ad: 1,
  fa: 2,
  nw: 3,
};

/** 依紀元＋年份排序（AD前降序，其餘升序） */
function sortChronoPeriods(periods: ChronoPeriod[]): ChronoPeriod[] {
  return [...periods].sort((a, b) => {
    const eraA = ERA_ORDER[a.era] ?? 0;
    const eraB = ERA_ORDER[b.era] ?? 0;
    if (eraA !== eraB) return eraA - eraB;
    if (a.era === 'pre-ad') return b.yearNum - a.yearNum;
    return a.yearNum - b.yearNum;
  });
}

/** 通用陣列排序 */
function reorder<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}

/** 舊格式 → 新格式轉換（向後相容） */
function migrateChronoData(raw: any): ChronoContent {
  // 已是新格式（有 fieldDefs 且 periods 有 era）
  if (raw.fieldDefs && Array.isArray(raw.fieldDefs) && raw.periods?.[0]?.era) {
    return { ...raw, periods: sortChronoPeriods(raw.periods) } as ChronoContent;
  }
  // 有 fieldDefs 但 period 還用 subtitle → 遷移 period 欄位
  if (raw.fieldDefs && Array.isArray(raw.fieldDefs)) {
    const periods: ChronoPeriod[] = (raw.periods || []).map((op: any) => {
      const { era, yearNum } = op.era
        ? { era: op.era, yearNum: op.yearNum }
        : parseChronoYear(op.year || '');
      return {
        era,
        yearNum,
        year: formatChronoYear(era, yearNum),
        title: op.title || op.subtitle,
        fields: op.fields || {},
      };
    });
    return { fieldDefs: raw.fieldDefs, periods: sortChronoPeriods(periods) };
  }
  // 舊格式：periods[].sections[]
  const oldPeriods: {
    year: string;
    subtitle?: string;
    sections?: { icon: string; label: string; events: string[] }[];
  }[] = raw.periods || [];
  const iconMap: Record<string, { icon: string; label: string }> = {};
  for (const p of oldPeriods) {
    for (const s of p.sections || []) {
      if (!iconMap[s.icon]) iconMap[s.icon] = { icon: s.icon, label: s.label };
    }
  }
  const fieldDefs: ChronoFieldDef[] = DEFAULT_FIELD_DEFS.map((d) => {
    if (iconMap[d.icon]) {
      delete iconMap[d.icon];
      return d;
    }
    return d;
  });
  for (const [, v] of Object.entries(iconMap)) {
    fieldDefs.push({
      id: v.label.replace(/\s/g, '_').toLowerCase(),
      icon: v.icon,
      label: v.label,
      style: 'flat',
    });
  }
  const periods: ChronoPeriod[] = oldPeriods.map((op) => {
    const { era, yearNum } = parseChronoYear(op.year);
    const fields: Record<string, ChronoField> = {};
    for (const s of op.sections || []) {
      const def = fieldDefs.find((d) => d.icon === s.icon);
      if (!def) continue;
      if (def.style === 'grouped') {
        fields[def.id] = { groups: [{ label: '未分類', items: s.events }] };
      } else {
        fields[def.id] = { items: s.events };
      }
    }
    return {
      era,
      yearNum,
      year: formatChronoYear(era, yearNum),
      title: op.subtitle,
      fields,
    };
  });
  return { fieldDefs, periods: sortChronoPeriods(periods) };
}

function ChronoEditor({
  data: rawData,
  onChange,
  accent,
}: {
  data: ChronoContent;
  onChange: (d: ChronoContent) => void;
  accent: string;
}) {
  const data = React.useMemo(() => migrateChronoData(rawData), [rawData]);
  const [activePeriod, setActivePeriod] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [revModalOpen, setRevModalOpen] = useState(false);

  // 時間點拖曳排序
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // 欄位內項目拖曳（通用）
  const [itemDrag, setItemDrag] = useState<{
    defId: string;
    type: 'flat' | 'group' | 'groupItem';
    gi?: number;
    idx: number;
  } | null>(null);

  function emit(next: ChronoContent) {
    onChange(next);
  }
  function updatePeriods(periods: ChronoPeriod[], skipSort = false) {
    const sorted = skipSort ? periods : sortChronoPeriods(periods);
    emit({ ...data, fieldDefs: data.fieldDefs, periods: sorted });
  }

  function addPeriod() {
    const fields: Record<string, ChronoField> = {};
    for (const def of data.fieldDefs) {
      fields[def.id] = def.style === 'grouped' ? { groups: [] } : { items: [] };
    }
    const newPeriod: ChronoPeriod = {
      era: 'ad',
      yearNum: 1,
      year: formatChronoYear('ad', 1),
      fields,
    };
    const newPeriods = sortChronoPeriods([...data.periods, newPeriod]);
    const newIdx = newPeriods.findIndex((p) => p === newPeriod);
    emit({ ...data, fieldDefs: data.fieldDefs, periods: newPeriods });
    setActivePeriod(newIdx >= 0 ? newIdx : 0);
  }

  async function removePeriod(i: number) {
    const p = data.periods[i];
    const ok = await getDialog().confirm(`確定要刪除時間點「${p.year}」嗎？`, {
      title: '刪除時間點',
      confirmText: '刪除',
      cancelText: '取消',
    });
    if (!ok) return;
    updatePeriods(
      data.periods.filter((_, idx) => idx !== i),
      true
    );
    if (activePeriod >= data.periods.length - 1)
      setActivePeriod(Math.max(0, data.periods.length - 2));
  }

  function handleDrop(targetIdx: number) {
    if (dragIdx === null) return;
    const items = [...data.periods];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(targetIdx, 0, moved);
    updatePeriods(items, true);
    if (activePeriod === dragIdx) setActivePeriod(targetIdx);
    setDragIdx(null);
  }

  const period = data.periods[activePeriod];

  function updatePeriod(patch: Partial<ChronoPeriod>) {
    updatePeriods(
      data.periods.map((p, i) => (i === activePeriod ? { ...p, ...patch } : p)),
      true
    );
  }

  // 年份變更（era 或 yearNum）— 排序後追蹤 activePeriod
  function setEra(era: ChronoEra) {
    if (!period) return;
    const eraDef = CHRONO_ERAS.find((e) => e.id === era);
    let yearNum = period.yearNum || 1;
    if (eraDef?.maxYear && yearNum > eraDef.maxYear) yearNum = eraDef.maxYear;
    const updated = {
      ...period,
      era,
      yearNum,
      year: formatChronoYear(era, yearNum),
    };
    const newPeriods = sortChronoPeriods(
      data.periods.map((p, i) => (i === activePeriod ? updated : p))
    );
    const newIdx = newPeriods.indexOf(updated);
    emit({ ...data, fieldDefs: data.fieldDefs, periods: newPeriods });
    setActivePeriod(newIdx >= 0 ? newIdx : 0);
  }
  function setYearNum(num: number) {
    if (!period) return;
    const eraDef = CHRONO_ERAS.find((e) => e.id === period.era);
    const clamped = eraDef?.maxYear ? Math.min(num, eraDef.maxYear) : num;
    const yearNum = Math.max(1, clamped);
    const updated = {
      ...period,
      yearNum,
      year: formatChronoYear(period.era, yearNum),
    };
    const newPeriods = sortChronoPeriods(
      data.periods.map((p, i) => (i === activePeriod ? updated : p))
    );
    const newIdx = newPeriods.indexOf(updated);
    emit({ ...data, fieldDefs: data.fieldDefs, periods: newPeriods });
    setActivePeriod(newIdx >= 0 ? newIdx : 0);
  }

  function updateField(defId: string, field: ChronoField) {
    if (!period) return;
    updatePeriod({ fields: { ...period.fields, [defId]: field } });
  }

  // ── 欄位類別管理 ──
  function updateFieldDefs(defs: ChronoFieldDef[]) {
    emit({ ...data, fieldDefs: defs, periods: data.periods });
  }

  async function addFieldDef() {
    const label = await getDialog().prompt('請輸入欄位類別名稱', {
      title: '新增欄位類別',
      placeholder: '如：組織動態、技術發展',
    });
    if (!label) return;
    const id =
      label.replace(/[\s/]/g, '_').toLowerCase() +
      '_' +
      Date.now().toString(36);
    const icon =
      (await getDialog().prompt('圖示（emoji）', {
        title: '欄位圖示',
        placeholder: '◇',
      })) || '◇';
    const styleChoice = await getDialog().confirm(
      '此欄位是否需要分組？\n確定 → 分組模式（如區域動態）\n取消 → 純列表',
      {
        title: '欄位風格',
        confirmText: '分組 (grouped)',
        cancelText: '列表 (flat)',
      }
    );
    const style: 'flat' | 'grouped' = styleChoice ? 'grouped' : 'flat';
    updateFieldDefs([...data.fieldDefs, { id, icon, label, style }]);
  }

  async function removeFieldDef(defId: string) {
    const def = data.fieldDefs.find((d) => d.id === defId);
    if (!def) return;
    const hasData = data.periods.some((p) => {
      const f = p.fields[defId];
      if (!f) return false;
      return (
        (f.items && f.items.length > 0) || (f.groups && f.groups.length > 0)
      );
    });
    const msg = hasData
      ? `欄位「${def.label}」在 ${data.periods.filter((p) => p.fields[defId]?.items?.length || p.fields[defId]?.groups?.length).length} 個時間點有資料。刪除後資料將遺失。`
      : `確定要刪除欄位類別「${def.label}」嗎？`;
    const ok = await getDialog().confirm(msg, {
      title: '刪除欄位類別',
      confirmText: '刪除',
      cancelText: '取消',
    });
    if (!ok) return;
    updateFieldDefs(data.fieldDefs.filter((d) => d.id !== defId));
  }

  function toggleCollapse(defId: string) {
    setCollapsed((prev) => ({ ...prev, [defId]: !prev[defId] }));
  }

  // ── flat 欄位操作 ──
  function addFlatItem(defId: string) {
    const field = period?.fields[defId] || { items: [] };
    updateField(defId, { ...field, items: [...(field.items || []), ''] });
  }
  function updateFlatItem(defId: string, idx: number, text: string) {
    const field = period?.fields[defId] || { items: [] };
    const items = [...(field.items || [])];
    items[idx] = text;
    updateField(defId, { ...field, items });
  }
  function removeFlatItem(defId: string, idx: number) {
    const field = period?.fields[defId] || { items: [] };
    updateField(defId, {
      ...field,
      items: (field.items || []).filter((_, i) => i !== idx),
    });
  }
  function reorderFlatItem(defId: string, from: number, to: number) {
    const field = period?.fields[defId] || { items: [] };
    updateField(defId, {
      ...field,
      items: reorder(field.items || [], from, to),
    });
  }

  // ── grouped 欄位操作 ──
  function addGroup(defId: string) {
    const field = period?.fields[defId] || { groups: [] };
    updateField(defId, {
      ...field,
      groups: [...(field.groups || []), { label: '', items: [''] }],
    });
  }
  function updateGroupLabel(defId: string, gi: number, label: string) {
    const field = period?.fields[defId] || { groups: [] };
    const groups = (field.groups || []).map((g, i) =>
      i === gi ? { ...g, label } : g
    );
    updateField(defId, { ...field, groups });
  }
  function removeGroup(defId: string, gi: number) {
    const field = period?.fields[defId] || { groups: [] };
    updateField(defId, {
      ...field,
      groups: (field.groups || []).filter((_, i) => i !== gi),
    });
  }
  function reorderGroup(defId: string, from: number, to: number) {
    const field = period?.fields[defId] || { groups: [] };
    updateField(defId, {
      ...field,
      groups: reorder(field.groups || [], from, to),
    });
  }
  function addGroupItem(defId: string, gi: number) {
    const field = period?.fields[defId] || { groups: [] };
    const groups = (field.groups || []).map((g, i) =>
      i === gi ? { ...g, items: [...g.items, ''] } : g
    );
    updateField(defId, { ...field, groups });
  }
  function updateGroupItem(
    defId: string,
    gi: number,
    ii: number,
    text: string
  ) {
    const field = period?.fields[defId] || { groups: [] };
    const groups = (field.groups || []).map((g, i) => {
      if (i !== gi) return g;
      const items = [...g.items];
      items[ii] = text;
      return { ...g, items };
    });
    updateField(defId, { ...field, groups });
  }
  function removeGroupItem(defId: string, gi: number, ii: number) {
    const field = period?.fields[defId] || { groups: [] };
    const groups = (field.groups || []).map((g, i) => {
      if (i !== gi) return g;
      return { ...g, items: g.items.filter((_, idx) => idx !== ii) };
    });
    updateField(defId, { ...field, groups });
  }
  function reorderGroupItem(
    defId: string,
    gi: number,
    from: number,
    to: number
  ) {
    const field = period?.fields[defId] || { groups: [] };
    const groups = (field.groups || []).map((g, i) => {
      if (i !== gi) return g;
      return { ...g, items: reorder(g.items, from, to) };
    });
    updateField(defId, { ...field, groups });
  }

  // 欄位總項目數
  function fieldItemCount(f: ChronoField | undefined): number {
    if (!f) return 0;
    if (f.items) return f.items.filter(Boolean).length;
    if (f.groups)
      return f.groups.reduce(
        (sum, g) => sum + g.items.filter(Boolean).length,
        0
      );
    return 0;
  }

  // 拖曳 handlers
  function onItemDragStart(
    defId: string,
    type: 'flat' | 'group' | 'groupItem',
    idx: number,
    gi?: number
  ) {
    setItemDrag({ defId, type, gi, idx });
  }
  function onItemDrop(
    defId: string,
    type: 'flat' | 'group' | 'groupItem',
    targetIdx: number,
    gi?: number
  ) {
    if (!itemDrag || itemDrag.defId !== defId || itemDrag.type !== type) return;
    if (type === 'flat') reorderFlatItem(defId, itemDrag.idx, targetIdx);
    else if (type === 'group') reorderGroup(defId, itemDrag.idx, targetIdx);
    else if (type === 'groupItem' && gi !== undefined && itemDrag.gi === gi)
      reorderGroupItem(defId, gi, itemDrag.idx, targetIdx);
    setItemDrag(null);
  }
  function dragOverHandler(e: React.DragEvent) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }
  function dragLeaveHandler(e: React.DragEvent) {
    e.currentTarget.classList.remove('drag-over');
  }
  function dropHandler(e: React.DragEvent, cb: () => void) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    cb();
  }

  return (
    <div className="ced-section">
      {/* 左右分欄 */}
      <div className="ced-chrono-split">
        {/* 左側：時間軸池 */}
        <div className="ced-chrono-pool">
          <div className="ced-chrono-pool-header">
            <span
              style={{
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
              }}
            >
              時間軸
            </span>
          </div>

          <div className="ced-chrono-pool-list">
            {data.periods.map((p, pi) => (
              <div
                key={pi}
                className={`ced-chrono-node ${pi === activePeriod ? 'active' : ''} ${dragIdx === pi ? 'dragging' : ''}`}
                onClick={() => setActivePeriod(pi)}
                draggable
                onDragStart={() => setDragIdx(pi)}
                onDragEnd={() => setDragIdx(null)}
                onDragOver={dragOverHandler}
                onDragLeave={dragLeaveHandler}
                onDrop={(e) => dropHandler(e, () => handleDrop(pi))}
              >
                <div
                  className="ced-chrono-node-dot"
                  style={{
                    borderColor: accent,
                    background: pi === activePeriod ? accent : undefined,
                  }}
                />
                {pi < data.periods.length - 1 && (
                  <div
                    className="ced-chrono-node-line"
                    style={{ background: accent }}
                  />
                )}
                <div className="ced-chrono-node-info">
                  <span className="ced-chrono-node-year">{p.year}</span>
                  {p.title && (
                    <span className="ced-chrono-node-sub">{p.title}</span>
                  )}
                </div>
                <button
                  className="ced-del-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePeriod(pi);
                  }}
                  style={{ fontSize: 11 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            className="ced-add-btn ced-chrono-add-node"
            onClick={addPeriod}
            style={{ color: accent }}
          >
            + 新增時間點
          </button>
        </div>

        {/* 右側：結構化編輯面板 */}
        <div className="ced-chrono-panel">
          {period ? (
            <>
              {/* 時間點基本資料 */}
              <div className="ced-chrono-panel-header">
                <span className="ced-chrono-panel-title">{period.year}</span>
              </div>

              {/* 年份選擇器 */}
              <div className="ced-field-row">
                <label className="ced-label">年份</label>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flex: 1,
                    alignItems: 'center',
                  }}
                >
                  <select
                    className="ced-select"
                    value={period.era}
                    onChange={(e) => setEra(e.target.value as ChronoEra)}
                  >
                    {CHRONO_ERAS.map((era) => (
                      <option key={era.id} value={era.id}>
                        {era.label}
                        {era.maxYear ? ` (≤${era.maxYear})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    className="ced-input ced-input-sm"
                    type="number"
                    min={1}
                    max={
                      CHRONO_ERAS.find((e) => e.id === period.era)?.maxYear ||
                      undefined
                    }
                    value={period.yearNum}
                    onChange={(e) => setYearNum(parseInt(e.target.value) || 1)}
                    style={{ width: 80 }}
                  />
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--ink-mute)',
                    }}
                  >
                    年
                  </span>
                </div>
              </div>

              <div className="ced-field-row">
                <label className="ced-label">標題</label>
                <input
                  className="ced-input"
                  value={period.title || ''}
                  onChange={(e) =>
                    updatePeriod({ title: e.target.value || undefined })
                  }
                  placeholder="選填"
                />
              </div>

              <div className="ced-field-row">
                <label className="ced-label">版本</label>
                <button
                  className="ced-rev-open-btn"
                  onClick={() => setRevModalOpen(true)}
                  style={{ color: accent }}
                >
                  進度版本 ({period.revisions?.length ?? 0})
                </button>
              </div>

              {/* 各欄位類別 */}
              {data.fieldDefs.map((def, di) => {
                const field = period.fields[def.id];
                const isCollapsed = collapsed[def.id];
                const count = fieldItemCount(field);
                const defCount = data.fieldDefs.length;

                return (
                  <div key={def.id} className="ced-chrono-field-section">
                    <div className="ced-chrono-field-header">
                      <button
                        className="ced-chrono-field-toggle"
                        onClick={() => toggleCollapse(def.id)}
                      >
                        <span className="ced-chrono-field-chevron">
                          {isCollapsed ? '▸' : '▾'}
                        </span>
                        <span className="ced-chrono-field-icon">
                          {def.icon}
                        </span>
                        <span className="ced-chrono-field-label">
                          {def.label}
                        </span>
                        <span className="ced-count">{count}</span>
                      </button>
                      <div className="ced-chrono-field-actions">
                        <div className="ced-chrono-move-btns">
                          <button
                            className="ced-chrono-move-btn"
                            disabled={di === 0}
                            onClick={() =>
                              updateFieldDefs(
                                reorder(data.fieldDefs, di, di - 1)
                              )
                            }
                            title="上移"
                          >
                            ▲
                          </button>
                          <button
                            className="ced-chrono-move-btn"
                            disabled={di === defCount - 1}
                            onClick={() =>
                              updateFieldDefs(
                                reorder(data.fieldDefs, di, di + 1)
                              )
                            }
                            title="下移"
                          >
                            ▼
                          </button>
                        </div>
                        <button
                          className="ced-del-btn"
                          onClick={() => removeFieldDef(def.id)}
                          title="刪除欄位"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="ced-chrono-field-body">
                        {def.style === 'flat' ? (
                          <>
                            {(field?.items || []).map((item, ii) => (
                              <div
                                key={ii}
                                className={`ced-chrono-flat-item ${itemDrag?.defId === def.id && itemDrag?.type === 'flat' && itemDrag?.idx === ii ? 'dragging' : ''}`}
                                draggable
                                onDragStart={() =>
                                  onItemDragStart(def.id, 'flat', ii)
                                }
                                onDragEnd={() => setItemDrag(null)}
                                onDragOver={dragOverHandler}
                                onDragLeave={dragLeaveHandler}
                                onDrop={(e) =>
                                  dropHandler(e, () =>
                                    onItemDrop(def.id, 'flat', ii)
                                  )
                                }
                              >
                                <span
                                  className="ced-drag-handle"
                                  title="拖曳排序"
                                >
                                  ⠿
                                </span>
                                <input
                                  className="ced-input ced-input-sm"
                                  value={item}
                                  onChange={(e) =>
                                    updateFlatItem(def.id, ii, e.target.value)
                                  }
                                  placeholder="事件描述..."
                                />
                                <button
                                  className="ced-del-btn"
                                  onClick={() => removeFlatItem(def.id, ii)}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              className="ced-add-btn"
                              onClick={() => addFlatItem(def.id)}
                              style={{
                                color: accent,
                                fontSize: 11,
                                marginTop: 4,
                              }}
                            >
                              + 新增事件
                            </button>
                          </>
                        ) : (
                          <>
                            {(field?.groups || []).map((group, gi) => {
                              const groupCount = (field?.groups || []).length;
                              return (
                                <div key={gi} className="ced-chrono-group">
                                  <div className="ced-chrono-group-header">
                                    <div className="ced-chrono-move-btns">
                                      <button
                                        className="ced-chrono-move-btn"
                                        disabled={gi === 0}
                                        onClick={() =>
                                          reorderGroup(def.id, gi, gi - 1)
                                        }
                                        title="上移"
                                      >
                                        ▲
                                      </button>
                                      <button
                                        className="ced-chrono-move-btn"
                                        disabled={gi === groupCount - 1}
                                        onClick={() =>
                                          reorderGroup(def.id, gi, gi + 1)
                                        }
                                        title="下移"
                                      >
                                        ▼
                                      </button>
                                    </div>
                                    <input
                                      className="ced-input ced-input-sm ced-input-name"
                                      value={group.label}
                                      onChange={(e) =>
                                        updateGroupLabel(
                                          def.id,
                                          gi,
                                          e.target.value
                                        )
                                      }
                                      placeholder="區域名稱..."
                                    />
                                    <span className="ced-count">
                                      {group.items.filter(Boolean).length}
                                    </span>
                                    <button
                                      className="ced-del-btn"
                                      onClick={() => removeGroup(def.id, gi)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  {group.items.map((item, ii) => (
                                    <div
                                      key={ii}
                                      className={`ced-chrono-group-item ${itemDrag?.defId === def.id && itemDrag?.type === 'groupItem' && itemDrag?.gi === gi && itemDrag?.idx === ii ? 'dragging' : ''}`}
                                      draggable
                                      onDragStart={() =>
                                        onItemDragStart(
                                          def.id,
                                          'groupItem',
                                          ii,
                                          gi
                                        )
                                      }
                                      onDragEnd={() => setItemDrag(null)}
                                      onDragOver={dragOverHandler}
                                      onDragLeave={dragLeaveHandler}
                                      onDrop={(e) =>
                                        dropHandler(e, () =>
                                          onItemDrop(
                                            def.id,
                                            'groupItem',
                                            ii,
                                            gi
                                          )
                                        )
                                      }
                                    >
                                      <span
                                        className="ced-drag-handle"
                                        title="拖曳排序"
                                      >
                                        ⠿
                                      </span>
                                      <input
                                        className="ced-input ced-input-sm"
                                        value={item}
                                        onChange={(e) =>
                                          updateGroupItem(
                                            def.id,
                                            gi,
                                            ii,
                                            e.target.value
                                          )
                                        }
                                        placeholder="事件描述..."
                                      />
                                      <button
                                        className="ced-del-btn"
                                        onClick={() =>
                                          removeGroupItem(def.id, gi, ii)
                                        }
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    className="ced-add-btn"
                                    onClick={() => addGroupItem(def.id, gi)}
                                    style={{
                                      color: accent,
                                      fontSize: 10,
                                      marginLeft: 22,
                                    }}
                                  >
                                    + 事件
                                  </button>
                                </div>
                              );
                            })}
                            <button
                              className="ced-add-btn"
                              onClick={() => addGroup(def.id)}
                              style={{
                                color: accent,
                                fontSize: 11,
                                marginTop: 4,
                              }}
                            >
                              + 新增區域
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 新增欄位區塊 */}
              <button
                className="ced-add-btn"
                onClick={addFieldDef}
                style={{ color: accent, fontSize: 11, marginTop: 12 }}
              >
                + 新增欄位
              </button>
            </>
          ) : (
            <div className="ced-browser-empty" style={{ height: '100%' }}>
              <div>選擇或新增一個時間點</div>
            </div>
          )}
        </div>
      </div>

      {revModalOpen && period && (
        <RevisionModal
          entryLabel={
            period.title ? `${period.year}・${period.title}` : period.year
          }
          stackStyle="chrono"
          baseEntry={period as unknown as Record<string, unknown>}
          revisions={period.revisions ?? []}
          onChange={(revs) =>
            updatePeriod({ revisions: revs.length > 0 ? revs : undefined })
          }
          baseGate={period.gate ?? null}
          onBaseGateChange={(gate) => updatePeriod({ gate: gate ?? undefined })}
          chronoFieldDefs={data.fieldDefs}
          onClose={() => setRevModalOpen(false)}
          accent={accent}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Diff 編輯器（對照表：section 定義值欄位，詞條表格對位填值）
// ══════════════════════════════════════════════════════════════════

/** 表格列的 grid 欄數（詞條欄 + N 個值欄 + 操作欄）交給 CSS 變數 */
function diffColsStyle(columns: number): React.CSSProperties {
  return {
    '--ced-diff-cols': String(Math.max(columns, 1)),
  } as React.CSSProperties;
}

/** 詞條是否帶表格看不見的設定（進階按鈕據此改標記） */
function hasEntryFlags(entry: DiffEntry): boolean {
  return Boolean(
    entry.hidden ||
    entry.locked ||
    entry.gate ||
    (entry.revisions?.length ?? 0) > 0
  );
}

/** 進階按鈕的 tooltip：列出該詞條已設定的項目 */
function entryFlagSummary(entry: DiffEntry): string {
  const flags: string[] = [];
  if (entry.hidden) flags.push('隱藏');
  if (entry.locked) flags.push('鎖定');
  if (entry.gate) flags.push('解鎖條件');
  if (entry.revisions?.length) flags.push(`${entry.revisions.length} 個版本`);
  return flags.length ? `進階設定：${flags.join('、')}` : '進階設定';
}

function DiffEditor({
  data,
  onChange,
  accent,
}: {
  data: DiffContent;
  onChange: (d: DiffContent) => void;
  accent: string;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [activeSection, setActiveSection] = useState(0);
  const [activeEntry, setActiveEntry] = useState<number | null>(null);
  const [panelMode, setPanelMode] = useState<'section' | 'entry'>('section');
  const [dragEntryInfo, setDragEntryInfo] = useState<{
    sectionIdx: number;
    entryIdx: number;
  } | null>(null);
  const [revModalOpen, setRevModalOpen] = useState(false);

  function updateSubcats(subcats: DiffSubcat[]) {
    onChange({ ...data, subcategories: subcats });
  }
  function addSubcat() {
    updateSubcats([
      ...data.subcategories,
      { label: '新分類', sections: [{ label: '', entries: [] }] },
    ]);
  }
  function removeSubcat(i: number) {
    updateSubcats(data.subcategories.filter((_, idx) => idx !== i));
    if (activeTab >= data.subcategories.length - 1)
      setActiveTab(Math.max(0, data.subcategories.length - 2));
    setActiveEntry(null);
  }

  const subcat = data.subcategories[activeTab];

  function updateSections(sections: DiffSection[]) {
    updateSubcats(
      data.subcategories.map((sc, i) =>
        i === activeTab ? { ...sc, sections } : sc
      )
    );
  }
  function addSection() {
    if (!subcat) return;
    updateSections([...subcat.sections, { label: '新區段', entries: [] }]);
  }

  async function removeSection(si: number) {
    if (!subcat || si === 0) return;
    const s = subcat.sections[si];
    if (s.entries.length > 0) {
      const ok = await getDialog().confirm(
        `區段「${s.label || '未命名'}」有 ${s.entries.length} 個條目。\n確定 → 條目移至預設區段\n取消 → 不做任何操作`,
        { title: '刪除區段', confirmText: '移動並刪除', cancelText: '取消' }
      );
      if (!ok) return;
      const newSections = [...subcat.sections];
      newSections[0] = {
        ...newSections[0],
        entries: [...newSections[0].entries, ...s.entries],
      };
      newSections.splice(si, 1);
      updateSections(newSections);
    } else {
      updateSections(subcat.sections.filter((_, idx) => idx !== si));
    }
    if (activeSection >= si) setActiveSection(Math.max(0, activeSection - 1));
    setActiveEntry(null);
    setPanelMode('section');
  }

  React.useEffect(() => {
    if (subcat && subcat.sections.length === 0)
      updateSections([{ label: '', entries: [] }]);
  }, [activeTab, subcat?.sections.length]);

  const section = subcat?.sections[activeSection];

  function updateEntries(entries: DiffEntry[]) {
    if (!subcat) return;
    updateSections(
      subcat.sections.map((s, i) =>
        i === activeSection ? { ...s, entries } : s
      )
    );
  }
  function addEntry() {
    if (!section) return;
    updateEntries([...section.entries, { term: '', values: [''] }]);
    setActiveEntry(section.entries.length);
    setPanelMode('entry');
  }
  /** 表格內新增：值依現有欄數補齊，且不跳離表格 */
  function addEntryInline() {
    if (!section) return;
    updateEntries([
      ...section.entries,
      { term: '', values: Array.from({ length: valueColumns }, () => '') },
    ]);
  }
  async function removeEntry(i: number) {
    if (!section) return;
    const target = section.entries[i];
    const ok = await getDialog().confirm(
      `確定要刪除詞條「${target?.term || '(空詞條)'}」嗎？此操作無法復原。`,
      { title: '刪除詞條', confirmText: '刪除', cancelText: '取消' }
    );
    if (!ok) return;
    updateEntries(section.entries.filter((_, idx) => idx !== i));
    if (activeEntry === i) {
      setActiveEntry(null);
      setPanelMode('section');
    }
  }
  function updateEntry(i: number, patch: Partial<DiffEntry>) {
    if (!section) return;
    updateEntries(
      section.entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    );
  }

  // 跨區段拖曳
  function handleEntryDropOnSection(targetSi: number) {
    if (!dragEntryInfo || !subcat) return;
    const { sectionIdx: srcSi, entryIdx: srcEi } = dragEntryInfo;
    if (srcSi === targetSi) return;
    const srcSection = subcat.sections[srcSi];
    const ent = srcSection.entries[srcEi];
    const newSections = subcat.sections.map((s, si) => {
      if (si === srcSi)
        return { ...s, entries: s.entries.filter((_, idx) => idx !== srcEi) };
      if (si === targetSi) return { ...s, entries: [...s.entries, ent] };
      return s;
    });
    updateSections(newSections);
    if (activeSection === srcSi && activeEntry === srcEi) {
      setActiveEntry(null);
      setPanelMode('section');
    }
    setDragEntryInfo(null);
  }

  // 同區段拖曳排序
  function handleEntryReorder(targetIdx: number) {
    if (!dragEntryInfo || !section) return;
    if (dragEntryInfo.sectionIdx !== activeSection) return;
    const items = [...section.entries];
    const [moved] = items.splice(dragEntryInfo.entryIdx, 1);
    items.splice(targetIdx, 0, moved);
    updateEntries(items);
    if (activeEntry === dragEntryInfo.entryIdx) setActiveEntry(targetIdx);
    setDragEntryInfo(null);
  }

  const entry =
    activeEntry !== null && section ? section.entries[activeEntry] : null;

  // ── 值欄位（section 層的欄位標籤 + 表格編輯） ───────────────────────

  // 欄數規則與閱讀器共用，見 concepts/diffTable.ts
  const valueColumns = React.useMemo(
    () => (section ? sectionValueColumns(section) : 1),
    [section]
  );

  function updateSection(patch: Partial<DiffSection>) {
    if (!subcat) return;
    updateSections(
      subcat.sections.map((s, i) =>
        i === activeSection ? { ...s, ...patch } : s
      )
    );
  }

  /** 現有標籤補齊到 valueColumns 長度，供編輯時對位 */
  function paddedLabels(): string[] {
    return padValueLabels(section?.valueLabels, valueColumns);
  }

  function setValueLabel(col: number, text: string) {
    const labels = paddedLabels();
    labels[col] = text;
    // 全空即視為未命名，寫回 undefined 讓閱讀器退回無表頭呈現
    updateSection({
      valueLabels: labels.some((l) => l.trim()) ? labels : undefined,
    });
  }

  function addValueColumn() {
    if (!section) return;
    updateSection({ valueLabels: [...paddedLabels(), ''] });
  }

  async function removeValueColumn(col: number) {
    if (!section || valueColumns <= 1) return;
    const filled = section.entries.filter((e) => (e.values[col] ?? '').trim());
    if (filled.length > 0) {
      const ok = await getDialog().confirm(
        `第 ${col + 1} 欄有 ${filled.length} 個詞條已填值，刪除欄位會一併移除這些值。`,
        { title: '刪除值欄位', confirmText: '刪除', cancelText: '取消' }
      );
      if (!ok) return;
    }
    const labels = paddedLabels().filter((_, i) => i !== col);
    updateSections(
      subcat!.sections.map((s, i) =>
        i === activeSection
          ? {
              ...s,
              valueLabels: labels.some((l) => l.trim()) ? labels : undefined,
              entries: s.entries.map((e) => ({
                ...e,
                values: e.values.filter((_, vi) => vi !== col),
              })),
            }
          : s
      )
    );
  }

  /** 表格單格寫入——values 不足時先補空字串維持欄位對位 */
  function setCell(entryIdx: number, col: number, text: string) {
    if (!section) return;
    const target = section.entries[entryIdx];
    if (!target) return;
    const values = Array.from(
      { length: Math.max(valueColumns, target.values.length) },
      (_, i) => target.values[i] ?? ''
    );
    values[col] = text;
    updateEntry(entryIdx, { values });
  }

  return (
    <div className="ced-section">
      {/* 分類 Tab */}
      <div className="ced-section-header">
        <span className="ced-section-title">分類</span>
        <button
          className="ced-add-btn"
          onClick={addSubcat}
          style={{ color: accent }}
        >
          + 新增分類
        </button>
      </div>
      {data.subcategories.length > 0 && (
        <div className="ced-tabs">
          {data.subcategories.map((sc, i) => (
            <div
              key={i}
              className={`ced-tab ${i === activeTab ? 'active' : ''}`}
            >
              <button
                className="ced-tab-btn"
                onClick={() => {
                  setActiveTab(i);
                  setActiveSection(0);
                  setActiveEntry(null);
                }}
              >
                {sc.label || '(未命名)'}
              </button>
              <button className="ced-tab-del" onClick={() => removeSubcat(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {subcat && (
        <>
          <div className="ced-field-row">
            <label className="ced-label">分類名稱</label>
            <input
              className="ced-input"
              value={subcat.label}
              onChange={(e) =>
                updateSubcats(
                  data.subcategories.map((sc, i) =>
                    i === activeTab ? { ...sc, label: e.target.value } : sc
                  )
                )
              }
            />
          </div>

          {/* 左右分欄：區段+條目列表 / 條目編輯 */}
          <div className="ced-browser-split" style={{ minHeight: 250 }}>
            {/* 左側：區段和條目導航 */}
            <div className="ced-browser-nav">
              <div className="ced-browser-breadcrumb">
                <span style={{ fontWeight: 600 }}>區段</span>
                <button
                  className="ced-add-btn"
                  onClick={addSection}
                  style={{ color: accent, marginLeft: 'auto', fontSize: 10 }}
                >
                  + 區段
                </button>
              </div>

              {subcat.sections.map((s, si) => (
                <div key={si}>
                  <div
                    className={`ced-browser-folder ${si === activeSection && panelMode === 'section' ? 'active' : ''}`}
                    onClick={() => {
                      setActiveSection(si);
                      setActiveEntry(null);
                      setPanelMode('section');
                    }}
                    style={{
                      borderLeft:
                        si === activeSection
                          ? `3px solid ${accent}`
                          : '3px solid transparent',
                    }}
                    onDragOver={
                      dragEntryInfo
                        ? (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add('drag-over');
                          }
                        : undefined
                    }
                    onDragLeave={
                      dragEntryInfo
                        ? (e) => {
                            e.currentTarget.classList.remove('drag-over');
                          }
                        : undefined
                    }
                    onDrop={
                      dragEntryInfo
                        ? (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('drag-over');
                            handleEntryDropOnSection(si);
                          }
                        : undefined
                    }
                  >
                    <span
                      className="ced-browser-folder-name"
                      style={{ fontSize: 12 }}
                    >
                      {si === 0 && !s.label ? '(預設)' : s.label || '(未命名)'}
                    </span>
                    <span className="ced-count">{s.entries.length}</span>
                    {si > 0 && (
                      <button
                        className="ced-browser-file-del"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSection(si);
                        }}
                        style={{ opacity: 1 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {si === activeSection &&
                    s.entries.map((ent, ei) => (
                      <div
                        key={ei}
                        className={`ced-browser-file ${activeEntry === ei && panelMode === 'entry' ? 'active' : ''} ${dragEntryInfo?.sectionIdx === si && dragEntryInfo?.entryIdx === ei ? 'dragging' : ''}`}
                        onClick={() => {
                          setActiveEntry(ei);
                          setPanelMode('entry');
                        }}
                        style={{ paddingLeft: 20 }}
                        draggable
                        onDragStart={() =>
                          setDragEntryInfo({ sectionIdx: si, entryIdx: ei })
                        }
                        onDragEnd={() => setDragEntryInfo(null)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('drag-over');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('drag-over');
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('drag-over');
                          handleEntryReorder(ei);
                        }}
                      >
                        <span
                          className="ced-browser-file-icon"
                          style={{
                            fontSize: 10,
                            opacity: ent.hidden ? 0.3 : ent.locked ? 0.5 : 1,
                          }}
                        >
                          {ent.hidden ? '◌' : ent.locked ? '🔒' : '◈'}
                        </span>
                        <span className="ced-browser-file-name">
                          {ent.term || '(空詞條)'}
                        </span>
                        <button
                          className="ced-browser-file-del"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEntry(ei);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                </div>
              ))}

              {/* 操作 */}
              <div className="ced-browser-actions">
                {section && (
                  <button
                    className="ced-add-btn"
                    onClick={addEntry}
                    style={{ color: accent }}
                  >
                    + 新增條目
                  </button>
                )}
              </div>
            </div>

            {/* 右側：條目編輯面板 */}
            <div className="ced-browser-detail">
              {panelMode === 'entry' && entry ? (
                <>
                  <div className="ced-browser-detail-header">
                    <span>{entry.term || '(空詞條)'}</span>
                    <button
                      className="ced-del-btn"
                      onClick={() => removeEntry(activeEntry!)}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="ced-field-row">
                    <label className="ced-label">詞條名稱</label>
                    <input
                      className="ced-input"
                      value={entry.term}
                      onChange={(e) =>
                        updateEntry(activeEntry!, { term: e.target.value })
                      }
                    />
                  </div>

                  <div className="ced-field-row">
                    <label className="ced-label">版本</label>
                    <button
                      className="ced-rev-open-btn"
                      onClick={() => setRevModalOpen(true)}
                      style={{ color: accent }}
                    >
                      進度版本 ({entry.revisions?.length ?? 0})
                    </button>
                  </div>

                  {/* 值——欄位由區段定義，這裡逐欄填 */}
                  <div className="ced-section-header">
                    <span className="ced-section-title">值</span>
                    <button
                      className="ced-add-btn"
                      onClick={() => setPanelMode('section')}
                      style={{ color: accent }}
                    >
                      管理欄位
                    </button>
                  </div>
                  {paddedLabels().map((label, vi) => (
                    <div key={vi} className="ced-field-row">
                      <label className="ced-label ced-label-sm">
                        {label || `值 ${vi + 1}`}
                      </label>
                      <input
                        className="ced-input"
                        value={entry.values[vi] ?? ''}
                        onChange={(e) =>
                          setCell(activeEntry!, vi, e.target.value)
                        }
                      />
                    </div>
                  ))}

                  {/* 可見性 */}
                  <div className="ced-section-header">
                    <span className="ced-section-title">可見性</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label className="ced-checkbox-row">
                      <input
                        type="checkbox"
                        checked={!!entry.hidden}
                        onChange={(e) =>
                          updateEntry(activeEntry!, {
                            hidden: e.target.checked || undefined,
                          })
                        }
                      />
                      <span>隱藏（未出現）</span>
                    </label>
                    <label className="ced-checkbox-row">
                      <input
                        type="checkbox"
                        checked={!!entry.locked}
                        onChange={(e) =>
                          updateEntry(activeEntry!, {
                            locked: e.target.checked || undefined,
                          })
                        }
                      />
                      <span>鎖定（已提及未解釋）</span>
                    </label>
                  </div>
                </>
              ) : section ? (
                <>
                  <div className="ced-browser-detail-header">
                    <span>區段設定{activeSection === 0 ? ' (預設)' : ''}</span>
                    {activeSection > 0 && (
                      <button
                        className="ced-del-btn"
                        onClick={() => removeSection(activeSection)}
                      >
                        刪除區段
                      </button>
                    )}
                  </div>
                  <div className="ced-field-row">
                    <label className="ced-label">區段名稱</label>
                    <input
                      className="ced-input"
                      value={section.label}
                      onChange={(e) =>
                        updateSections(
                          subcat.sections.map((s, i) =>
                            i === activeSection
                              ? { ...s, label: e.target.value }
                              : s
                          )
                        )
                      }
                      placeholder={
                        activeSection === 0
                          ? '留空則閱讀器不顯示名稱'
                          : '區段名稱'
                      }
                    />
                  </div>
                  <div className="ced-empty" style={{ marginTop: 8 }}>
                    {activeSection === 0
                      ? '預設區段不可刪除。名稱留空時閱讀器不會顯示區段標題。'
                      : '拖曳左側條目到區段名稱上可移動條目。'}
                  </div>

                  {/* 值欄位標籤——本區段所有詞條依序對位這些欄位 */}
                  <div className="ced-section-header">
                    <span className="ced-section-title">
                      值欄位 ({valueColumns})
                    </span>
                    <button
                      className="ced-add-btn"
                      onClick={addValueColumn}
                      style={{ color: accent }}
                    >
                      + 欄位
                    </button>
                  </div>
                  <div className="ced-diff-cols">
                    {paddedLabels().map((label, ci) => (
                      <div key={ci} className="ced-diff-col-chip">
                        <input
                          className="ced-input ced-input-sm"
                          value={label}
                          placeholder={`值 ${ci + 1}`}
                          onChange={(e) => setValueLabel(ci, e.target.value)}
                        />
                        {valueColumns > 1 && (
                          <button
                            className="ced-del-btn"
                            title="刪除此欄位"
                            onClick={() => removeValueColumn(ci)}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="ced-empty">
                    欄位名稱留空時閱讀器不顯示表頭。
                  </div>

                  {/* 詞條表格——直接在格內編輯，⚙ 開進階設定 */}
                  <div className="ced-section-header">
                    <span className="ced-section-title">
                      詞條 ({section.entries.length})
                    </span>
                    <button
                      className="ced-add-btn"
                      onClick={addEntryInline}
                      style={{ color: accent }}
                    >
                      + 新增詞條
                    </button>
                  </div>
                  {section.entries.length === 0 ? (
                    <div className="ced-empty">尚無詞條</div>
                  ) : (
                    <div className="ced-diff-table">
                      <div
                        className="ced-diff-trow ced-diff-thead"
                        style={diffColsStyle(valueColumns)}
                      >
                        <span>詞條</span>
                        {paddedLabels().map((label, ci) => (
                          <span key={ci}>{label || `值 ${ci + 1}`}</span>
                        ))}
                        <span />
                      </div>
                      {section.entries.map((ent, ei) => (
                        <div
                          key={ei}
                          className={`ced-diff-trow ${ei === activeEntry ? 'active' : ''}`}
                          style={diffColsStyle(valueColumns)}
                        >
                          <input
                            className="ced-input ced-input-sm"
                            value={ent.term}
                            placeholder="詞條"
                            onChange={(e) =>
                              updateEntry(ei, { term: e.target.value })
                            }
                          />
                          {Array.from({ length: valueColumns }, (_, ci) => (
                            <input
                              key={ci}
                              className="ced-input ced-input-sm"
                              value={ent.values[ci] ?? ''}
                              placeholder={paddedLabels()[ci] || `值 ${ci + 1}`}
                              onChange={(e) => setCell(ei, ci, e.target.value)}
                            />
                          ))}
                          <div className="ced-diff-trow-actions">
                            <button
                              className="ced-diff-trow-btn"
                              title={entryFlagSummary(ent)}
                              onClick={() => {
                                setActiveEntry(ei);
                                setPanelMode('entry');
                              }}
                            >
                              {hasEntryFlags(ent) ? '◆' : '⚙'}
                            </button>
                            <button
                              className="ced-del-btn"
                              onClick={() => removeEntry(ei)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="ced-browser-empty">
                  <div>選擇一個區段</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {revModalOpen && entry && (
        <RevisionModal
          entryLabel={entry.term || '(未命名詞條)'}
          stackStyle="diff"
          baseEntry={entry as unknown as Record<string, unknown>}
          revisions={entry.revisions ?? []}
          onChange={(revs) =>
            updateEntry(activeEntry!, {
              revisions: revs.length > 0 ? revs : undefined,
            })
          }
          baseGate={entry.gate ?? null}
          onBaseGateChange={(gate) =>
            updateEntry(activeEntry!, { gate: gate ?? undefined })
          }
          onClose={() => setRevModalOpen(false)}
          accent={accent}
        />
      )}
    </div>
  );
}
