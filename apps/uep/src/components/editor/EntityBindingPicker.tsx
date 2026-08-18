/**
 * EntityBindingPicker — 指定 entity 在 Echoes／Visuals 的對應內容
 *
 * 兩處共用：條目層級的初始指向（ConceptsEditorBody）與 revision patch 的
 * 後續改指向（PatchEditor）。寫入的值一律是裸 page id。
 *
 * **同一個 entityKey 在該 zone 只有一筆內容時可以不填**——那時走既有的
 * by-key 反查即可。同 key 有多筆候選時**非填不可**：系統不會去猜，
 * 沒登記綁定就是「這個 zone 沒有對應內容」（見 entityBinding.ts）。
 *
 * 候選只列**同一個 entityKey 的非劇情內容**：
 * - 綁定的語意是「這個實體此刻對應到哪一個」，跨實體的內容不是候選——
 *   全部列出來會讓數十首歌擠在同一個下拉，也讓選錯變成常態。
 * - 劇情歌／鑲框室插圖走 `storyKey` 命名空間（與 entityKey 互斥，見
 *   echoes-index.ts），本來就不該由實體綁定接管。按 entityKey 篩已足以
 *   排除，這裡仍明寫一條，不倚賴「兩者互斥」這個隱含前提。
 *
 * 條目還沒填 entityKey 時沒有候選可言，顯示提示而非空下拉。
 */

import { useEffect, useState } from 'react';

import type { EntityBindings } from '../concepts/types';

import { getApiBase } from '../../lib/apiBase';

/**
 * 「不指定」選項的 `<select>` value。
 *
 * 不能用空字串——那會與「清空輸入」混淆；也不能用 page id 可能長成的
 * 樣子。page id 一律是 `{zone}/...` 的路徑形式，故雙底線字面值安全。
 */
const UNSET_VALUE = '__unset__';

interface BindingOption {
  id: string;
  title: string;
  entityKey?: string;
  storyKey?: string;
}

/**
 * 候選清單模組級快取——一個 dossier 頁可能有數十個條目、每個條目多條
 * revision，逐個 picker 各自 fetch 就是對同一個端點掃射（entity tooltip
 * 正是因此被拆掉的，不能同一個坑再踩一次）。
 *
 * 快取的是**全區清單**、篩選在渲染時做：不同 entityKey 的 picker 共用
 * 同一份資料，依 key 分別快取會退化成逐條目 fetch。
 *
 * 走 `getApiBase()` 直接打 worker 而非同源 proxy：echoes/visuals 前綴
 * 沒有 Astro proxy 路由，而這兩個 entity-index 是公開 GET（有 CORS），
 * 前台各處本來就直接打。test mode cookie 由 getApiBase 自己解析。
 */
const bindingOptionCache: Partial<
  Record<'echoes' | 'visuals', Promise<BindingOption[]>>
> = {};

function loadBindingOptions(
  zone: 'echoes' | 'visuals'
): Promise<BindingOption[]> {
  let cached = bindingOptionCache[zone];
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${getApiBase()}/api/${zone}/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok?: boolean;
        data?: {
          entries?: {
            id: string;
            title?: string;
            entityKey?: string;
            storyKey?: string;
          }[];
        };
      };
      if (!json.ok) throw new Error('API returned ok=false');
      return (json.data?.entries || []).map((e) => ({
        id: e.id,
        title: e.title || e.id,
        entityKey: e.entityKey,
        storyKey: e.storyKey,
      }));
    })().catch((err) => {
      delete bindingOptionCache[zone];
      throw err;
    });
    bindingOptionCache[zone] = cached;
  }
  return cached;
}

/** 清空候選快取（測試與新增內容後重抓用） */
export function invalidateBindingOptionCache(): void {
  delete bindingOptionCache.echoes;
  delete bindingOptionCache.visuals;
}

/**
 * 下拉選擇要覆蓋成哪一筆內容，寫入的值是裸 page id。
 *
 * 清單載入失敗時退回純文字輸入——比讓使用者完全無法填要好，
 * 值本來就只是一個 page id 字串。
 */
export function EntityBindingPicker({
  zone,
  entityKey,
  value,
  onChange,
}: {
  zone: 'echoes' | 'visuals';
  /** 條目的實體身分；候選以此篩選。未填時無候選可言 */
  entityKey?: string;
  /** undefined = 不指定（單筆走 by-key、多筆則無對應）、字串 = 明確指向 */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const [options, setOptions] = useState<BindingOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadBindingOptions(zone)
      .then((list) => {
        if (alive) setOptions(list);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [zone]);

  if (failed) {
    return (
      <input
        className="ced-input"
        value={value ?? ''}
        placeholder={`${zone}/... 頁面 id`}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  }

  const key = entityKey?.trim();
  if (!key) {
    return (
      <div className="ced-empty" style={{ margin: 0 }}>
        先填寫 entityKey 才有候選內容
      </div>
    );
  }

  const candidates = (options || []).filter(
    (o) => o.entityKey === key && !o.storyKey
  );

  // 目前值不在候選中（頁面被刪、改名，或 entityKey 被改掉）也要留得住，
  // 否則一開啟就被清成空值——靜默丟失既有綁定比顯示一筆異常值糟得多
  const missing =
    typeof value === 'string' &&
    options &&
    !candidates.some((o) => o.id === value);

  // 只有一筆候選時不指定仍走得通（消費端的 by-key 反查），多筆候選卻
  // 不指定就是「沒有對應內容」——系統不會挑。把後果寫在選項上，
  // 否則作者容易沿用舊行為的印象，以為不填會自動選一個
  const unsetLabel =
    candidates.length > 1 ? '（不指定 — 多筆候選，將無對應）' : '（不指定）';

  return (
    <select
      className="ced-input"
      value={value ?? UNSET_VALUE}
      disabled={!options}
      onChange={(e) =>
        onChange(e.target.value === UNSET_VALUE ? undefined : e.target.value)
      }
    >
      <option value={UNSET_VALUE}>{options ? unsetLabel : '載入中…'}</option>
      {missing && <option value={value}>{`${value}（不在候選中）`}</option>}
      {candidates.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
  );
}

/**
 * 條目層級的兩個綁定欄位（Echoes／Visuals 的初始指向覆蓋）。
 *
 * 空值一律收斂成 `undefined` 並在兩欄都空時整個移除 `bindings`——
 * 留下 `{}` 會讓存檔內容多一層無意義的空物件，同步時也算成差異。
 */
export function EntityBindingsFields({
  entityKey,
  value,
  onChange,
}: {
  entityKey?: string;
  value?: EntityBindings;
  onChange: (bindings: EntityBindings | undefined) => void;
}) {
  const update = (zone: 'echoes' | 'visuals', id: string | undefined) => {
    const next: EntityBindings = { ...value, [zone]: id };
    // 不指定 = 欄位不存在，實際刪掉而不是留一個 undefined
    // （JSON 序列化會丟掉，留著只是讓存檔內容與求值語意對不上）
    if (!next.echoes) delete next.echoes;
    if (!next.visuals) delete next.visuals;
    onChange(next.echoes || next.visuals ? next : undefined);
  };

  return (
    <>
      <div className="ced-field-row">
        <label className="ced-label">綁定歌曲</label>
        <EntityBindingPicker
          zone="echoes"
          entityKey={entityKey}
          value={value?.echoes}
          onChange={(id) => update('echoes', id)}
        />
      </div>
      <div className="ced-field-row">
        <label className="ced-label">綁定畫廊</label>
        <EntityBindingPicker
          zone="visuals"
          entityKey={entityKey}
          value={value?.visuals}
          onChange={(id) => update('visuals', id)}
        />
      </div>
    </>
  );
}
