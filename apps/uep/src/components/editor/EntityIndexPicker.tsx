/**
 * EntityIndexPicker — 條目級 entity 引用選擇器（Epic 2 S7-D-1）
 *
 * RichEditor entity 面板的「從 Concepts 選擇」改造：原本瀏覽頁面樹
 * 寫入 page 級 ref（concepts/xxx），改為吃 entity-index 端點列出
 * 「可嵌入條目」——dossier/diff 帶 entityKey 的條目（S7-D 定案 1：
 * 掛 key 才成為嵌入目標，純翻譯類不掛 key 自然排除），選中寫入
 * `entity:{entityKey}` 新格式 ref。
 *
 * kind 推斷（inferEntityKind）：索引的 category 是敘事分類
 * （「三區」「未知之境…」），不含人物/地點語意——改以 pageId（英文
 * slug）+ pageTitle 關鍵字推斷，僅作為帶入建議，kind 下拉仍可手動改。
 *
 * 索引快取：模組級 promise（同 session 重開面板不重抓），
 * 比照 terminalCore 慣例；invalidateEntityPickerCache 供測試/重試。
 */
import React, { useEffect, useMemo, useState } from 'react';

import type { EntityKind } from '../../embed/marks';

/** 索引端點的條目摘要（僅取 picker 需要的欄位；Worker EntityIndexEntry 子集） */
export interface EntityPickerEntry {
  name: string;
  stack: 'dossier' | 'browser' | 'chrono' | 'diff';
  pageId: string;
  pageTitle: string;
  entityKey?: string;
  category?: string;
  group?: string;
  variantId?: string;
}

/** 分組後的顯示結構（category → 條目） */
export interface EntityPickerGroup {
  category: string;
  entries: EntityPickerEntry[];
}

// ── 純函式（可測試） ───────────────────────────────────────────────

/**
 * 可嵌入目標過濾：dossier/diff 且帶 entityKey（S7-D 定案 1）。
 * 同 entityKey 去重（dossier 各 variant 維護同 key 條目、
 * dossier/diff 可能同 key）——取索引順序第一筆。
 */
export function embeddableEntries(
  entries: EntityPickerEntry[]
): EntityPickerEntry[] {
  const seen = new Set<string>();
  const out: EntityPickerEntry[] = [];
  for (const entry of entries) {
    if (entry.stack !== 'dossier' && entry.stack !== 'diff') continue;
    if (!entry.entityKey) continue;
    if (seen.has(entry.entityKey)) continue;
    seen.add(entry.entityKey);
    out.push(entry);
  }
  return out;
}

/**
 * kind 推斷：pageId（英文 slug）優先、pageTitle 關鍵字補位。
 * 推不出來一律 term（如魔獸/固有力/翻譯條目）。
 */
export function inferEntityKind(entry: EntityPickerEntry): EntityKind {
  const id = entry.pageId.toLowerCase();
  const title = entry.pageTitle;
  if (id.includes('character') || title.includes('人物')) return 'character';
  if (
    id.includes('location') ||
    title.includes('地點') ||
    title.includes('地區') ||
    title.includes('場景')
  ) {
    return 'location';
  }
  return 'term';
}

/**
 * 關鍵字過濾 + category 分組。
 * 比對 name / entityKey / category / group（不分大小寫 includes）；
 * 空關鍵字列出全部（picker 是有界清單，與 terminal 補全的
 * 「預設空」語意不同——這裡瀏覽本身就是目的）。
 * 分組鍵 = `{pageTitle}｜{category}`（不同頁面的同名分類不合併）。
 */
export function groupPickerEntries(
  entries: EntityPickerEntry[],
  keyword: string
): EntityPickerGroup[] {
  const kw = keyword.trim().toLowerCase();
  const hit = (entry: EntityPickerEntry): boolean => {
    if (!kw) return true;
    return [entry.name, entry.entityKey, entry.category, entry.group]
      .filter((v): v is string => typeof v === 'string')
      .some((v) => v.toLowerCase().includes(kw));
  };
  const groups: EntityPickerGroup[] = [];
  const byLabel = new Map<string, EntityPickerGroup>();
  for (const entry of entries) {
    if (!hit(entry)) continue;
    const label = entry.category
      ? `${entry.pageTitle}｜${entry.category}`
      : entry.pageTitle;
    let group = byLabel.get(label);
    if (!group) {
      group = { category: label, entries: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

// ── 索引載入（模組級快取） ─────────────────────────────────────────

let pickerIndexCache: Promise<EntityPickerEntry[]> | null = null;

/** 清空索引快取（載入失敗重試 / 測試隔離用） */
export function invalidateEntityPickerCache(): void {
  pickerIndexCache = null;
}

function loadPickerIndex(apiBase: string): Promise<EntityPickerEntry[]> {
  if (!pickerIndexCache) {
    pickerIndexCache = (async () => {
      const res = await fetch(`${apiBase}/api/concepts/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: EntityPickerEntry[] };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      return json.data?.entries || [];
    })().catch((err) => {
      pickerIndexCache = null;
      throw err;
    });
  }
  return pickerIndexCache;
}

// ── 元件 ───────────────────────────────────────────────────────────

interface EntityIndexPickerProps {
  apiBase: string;
  /** 選中條目：ref = `entity:{key}`，kind = 推斷建議值 */
  onPick: (ref: string, kind: EntityKind) => void;
}

/** stack 徽章（沿用 terminal 指令語彙：log / compare） */
const STACK_BADGES: Record<string, string> = {
  dossier: 'L',
  diff: 'C',
};

export default function EntityIndexPicker({
  apiBase,
  onPick,
}: EntityIndexPickerProps) {
  const [entries, setEntries] = useState<EntityPickerEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    loadPickerIndex(apiBase)
      .then((all) => {
        if (!cancelled) setEntries(embeddableEntries(all));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, reloadTick]);

  const groups = useMemo(
    () => (entries ? groupPickerEntries(entries, keyword) : []),
    [entries, keyword]
  );

  if (error) {
    return (
      <div className="tb-entity-picker">
        <div className="tb-link-loading">
          條目索引載入失敗
          <button
            className="tb-embed-browse"
            type="button"
            onClick={() => {
              invalidateEntityPickerCache();
              setEntries(null);
              setReloadTick((t) => t + 1);
            }}
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tb-entity-picker">
      <input
        className="tb-link-input"
        type="text"
        placeholder="搜尋條目（名稱 / entityKey / 分類）"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <div className="tb-link-page-tree">
        {entries === null ? (
          <div className="tb-link-loading">載入條目索引中...</div>
        ) : groups.length === 0 ? (
          <div className="tb-link-loading">
            {entries.length === 0
              ? '沒有可嵌入的條目（dossier/diff 需先掛 entityKey）'
              : '沒有符合的條目'}
          </div>
        ) : (
          groups.map((group) => (
            <React.Fragment key={group.category}>
              <div className="tb-entity-picker-cat">{group.category}</div>
              {group.entries.map((entry) => (
                <button
                  key={entry.entityKey}
                  className="tb-link-page-item"
                  type="button"
                  title={`${entry.pageTitle} · entity:${entry.entityKey}`}
                  onClick={() =>
                    onPick(`entity:${entry.entityKey}`, inferEntityKind(entry))
                  }
                >
                  <span className="tb-link-page-type">
                    {STACK_BADGES[entry.stack] ?? '?'}
                  </span>
                  {entry.name}
                  <span className="tb-entity-picker-key">
                    {entry.entityKey}
                  </span>
                </button>
              ))}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}
