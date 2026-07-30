/**
 * Key 與旗標管理（Admin 後台）
 *
 * 三欄：清單（左）／詳細（中）／用在哪（右）。管理兩套彼此獨立的識別碼：
 * - 互聯 key（`interlink_keys`）：entity／story 的標題與說明
 * - 自訂旗標（`uep_flags`）：註冊表 + 全站巡查結果
 *
 * 全部走同源 SSR proxy（`/api/interlink/*`、`/api/flags/*`）——這些端點都掛
 * `isAuthorized`，而 admin JWT 存在 httpOnly cookie 裡，瀏覽器端讀不到，
 * 必須由 proxy 在 server 端補上 Bearer header（同 UserManager／MediaLibrary）。
 */
/* global RequestInit */
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDialog, getToast } from './editorHelpers';
import './KeysManager.css';

// ===== 型別（與 worker 端的回應形狀對齊）=====

interface InterlinkKeyRow {
  keyType: 'entity' | 'story';
  keyValue: string;
  title: string | null;
  description: string | null;
  updatedAt: string | null;
  /** entity 的權威顯示名稱，來源是 Concepts dossier 條目 */
  derivedName?: string;
  definitionCount: number;
  anchorCount: number;
}

interface FlagReference {
  pageId: string;
  pageTitle: string;
  area: string;
}

interface FlagAuditRow {
  name: string;
  source: 'registered' | 'derived' | 'unregistered';
  label: string | null;
  grantedBy: FlagReference[];
  requiredBy: FlagReference[];
  orphan: boolean;
  unused: boolean;
}

interface FlagRow {
  name: string;
  label: string | null;
  description: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InterlinkDefinition {
  area: 'concepts' | 'echoes' | 'visuals';
  pageId: string;
  pageTitle: string;
  scope: string;
}

interface InterlinkAnchor {
  pageId: string;
  pageTitle: string;
  anchorKind: string;
  anchorId: string | null;
  label: string | null;
}

interface UsageData {
  definitions: InterlinkDefinition[];
  anchors: InterlinkAnchor[];
}

type Selection =
  | { kind: 'key'; keyType: 'entity' | 'story'; keyValue: string }
  | { kind: 'flag'; name: string };

// ===== API 工具 =====

/** 呼叫同源 SSR proxy，認證由 proxy 從 httpOnly cookie 轉發 */
async function apiFetch<T>(
  url: string,
  opts?: RequestInit
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    });
    return (await res.json()) as { ok: boolean; data?: T; error?: string };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** key 的路徑片段（key 值可能含 `:`、空白等需編碼的字元） */
function keyPath(keyType: string, keyValue: string): string {
  return `${keyType}/${encodeURIComponent(keyValue)}`;
}

/**
 * derived 旗標衍生自什麼。
 *
 * derived 旗標沒有可編輯的欄位（名稱是 key 或 pageId 的函數），所以面板不放
 * 空的輸入框——那看起來像「還沒填」而不是「不能填」。改為把它衍生自的東西
 * 解析出來唯讀顯示，說明仍只存在來源那一份上。
 */
type DerivedSource =
  | { kind: 'page'; role: string; pageId: string }
  | { kind: 'image'; role: string; pageId: string; imageId: string }
  | { kind: 'key'; role: string; keyValue: string }
  | { kind: 'retired'; role: string; note: string }
  | { kind: 'unknown'; role: string };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 解析 derived 旗標的來源。
 *
 * ⚠️ 判定順序必須與 worker 的 `classifyFlag` 一致（前綴優先於尾碼），否則
 * `gallery:{pageId}` 會先被 `:gallery` 尾碼吃掉。這裡是**解析器不是分類器**
 * ——是不是 derived 由 worker 回的 `source` 決定，解析失敗只會退回
 * `unknown`，不影響任何權限或註冊判定。
 *
 * 形狀的權威來源是 apps/uep 各產生端函式的 return，不是任何文件的摘要表。
 */
function parseDerivedSource(name: string): DerivedSource {
  const flag = name.trim();

  if (flag.startsWith('completed:')) {
    return {
      kind: 'page',
      role: '頁面完成標記',
      pageId: flag.slice('completed:'.length),
    };
  }
  if (flag.startsWith('zone:visited:')) {
    return {
      kind: 'retired',
      role: '區域足跡',
      note: '2026-07-26 起不再授予。既有讀者進度裡仍留著這些旗標，刻意不清理，所以巡查清單還會看到它。',
    };
  }
  if (flag.startsWith('met:')) {
    return {
      kind: 'retired',
      role: 'entity 認識標記',
      note: 'S7-C 起在嵌入判定線退役——嵌入全可點，內容由 Concepts revision 卡控。entityKey 只用來對應資料，與解鎖條件無關。僅舊格式 fallback 仍消費，停增不刪。',
    };
  }
  // deriveImageUnlockFlag 對兩段 id 都做了 encodeURIComponent，所以段內不會
  // 有裸冒號，切兩段是安全的
  if (flag.startsWith('image:')) {
    const parts = flag.slice('image:'.length).split(':');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        kind: 'image',
        role: '單張圖片解鎖',
        pageId: safeDecode(parts[0]),
        imageId: safeDecode(parts[1]),
      };
    }
    return { kind: 'unknown', role: '單張圖片解鎖' };
  }
  if (flag.startsWith('gallery:')) {
    return {
      kind: 'page',
      role: '展廊解鎖（該展廊沒有 entityKey）',
      pageId: flag.slice('gallery:'.length),
    };
  }
  if (flag.endsWith(':song')) {
    return {
      kind: 'key',
      role: '曲目解鎖',
      keyValue: flag.slice(0, -':song'.length),
    };
  }
  if (flag.endsWith(':gallery')) {
    return {
      kind: 'key',
      role: '展廊解鎖',
      keyValue: flag.slice(0, -':gallery'.length),
    };
  }
  return { kind: 'unknown', role: '規則生成' };
}

const KEY_TYPE_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'entity', label: 'entity' },
  { id: 'story', label: 'story' },
] as const;

// ===== 元件 =====

export default function KeysManager() {
  const [tab, setTab] = useState<'keys' | 'flags'>('keys');
  const [keys, setKeys] = useState<InterlinkKeyRow[]>([]);
  const [audit, setAudit] = useState<FlagAuditRow[]>([]);
  const [registry, setRegistry] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  /** key 分頁的類型篩選：entity 動輒數十筆，混在一起會把 story 淹掉 */
  const [keyTypeFilter, setKeyTypeFilter] = useState<
    'all' | 'entity' | 'story'
  >('all');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);

  /* 中欄草稿 */
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [draftCategory, setDraftCategory] = useState('');

  /* 右欄反查（key 專用；flag 的反查資料 audit 已經有了） */
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  /** 反查請求的世代序號：切換選取時舊回應後到會蓋掉新結果 */
  const usageGen = useRef(0);

  /** derived 旗標衍生來源頁的標題（旗標名裡只有 pageId，標題要現查） */
  const [derivedPage, setDerivedPage] = useState<{
    pageId: string;
    title: string | null;
    missing: boolean;
  } | null>(null);
  const derivedGen = useRef(0);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [keysRes, auditRes, registryRes] = await Promise.all([
      apiFetch<{ keys: InterlinkKeyRow[] }>('/api/interlink/keys'),
      apiFetch<{ flags: FlagAuditRow[] }>('/api/flags/audit'),
      apiFetch<{ flags: FlagRow[] }>('/api/flags'),
    ]);
    if (keysRes.ok && keysRes.data) setKeys(keysRes.data.keys);
    else getToast().error(`載入 key 清單失敗：${keysRes.error || '未知錯誤'}`);
    if (auditRes.ok && auditRes.data) setAudit(auditRes.data.flags);
    else getToast().error(`載入旗標巡查失敗：${auditRes.error || '未知錯誤'}`);
    if (registryRes.ok && registryRes.data) setRegistry(registryRes.data.flags);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** 註冊表以 name 索引：audit 只帶 label，說明與類別要從註冊表取 */
  const registryByName = useMemo(
    () => new Map(registry.map((flag) => [flag.name, flag])),
    [registry]
  );

  const selectedKey = useMemo(() => {
    if (selected?.kind !== 'key') return null;
    return (
      keys.find(
        (row) =>
          row.keyType === selected.keyType && row.keyValue === selected.keyValue
      ) ?? null
    );
  }, [selected, keys]);

  const selectedFlag = useMemo(() => {
    if (selected?.kind !== 'flag') return null;
    return audit.find((row) => row.name === selected.name) ?? null;
  }, [selected, audit]);

  /* ── 選取 ── */

  /**
   * 切分頁時一併清掉選取。
   *
   * 兩個分頁的清單不相交，留著選取會出現「中欄顯示的項目在左欄看不到」的
   * 狀態，右欄的反查也跟著對不上。
   */
  const switchTab = (next: 'keys' | 'flags') => {
    if (next === tab) return;
    setTab(next);
    setSelected(null);
    clearLookups();
  };

  /** 丟掉右欄與衍生來源的既有結果，並讓進行中的請求失效 */
  const clearLookups = () => {
    usageGen.current += 1;
    derivedGen.current += 1;
    setUsage(null);
    setUsageLoading(false);
    setDerivedPage(null);
  };

  const selectKey = (row: InterlinkKeyRow) => {
    setSelected({
      kind: 'key',
      keyType: row.keyType,
      keyValue: row.keyValue,
    });
    setDraftTitle(row.title || '');
    setDraftDescription(row.description || '');
    setDerivedPage(null);
    derivedGen.current += 1;
    void loadUsage(row.keyType, row.keyValue);
  };

  const selectFlag = (row: FlagAuditRow) => {
    setSelected({ kind: 'flag', name: row.name });
    const reg = registryByName.get(row.name);
    setDraftLabel(reg?.label || '');
    setDraftDescription(reg?.description || '');
    setDraftCategory(reg?.category || '');
    // flag 的反查來自 audit，不需要另外請求；清掉上一個 key 的結果
    clearLookups();
    if (row.source === 'derived') {
      const source = parseDerivedSource(row.name);
      if (source.kind === 'page' || source.kind === 'image') {
        void loadDerivedPage(source.pageId);
      }
    }
  };

  /**
   * 查衍生來源頁的標題。
   *
   * 查不到（頁面已刪或 id 對不上）本身就是有用的資訊——那代表這個 derived
   * 旗標的來源不見了，所以標成 missing 顯示出來，而不是靜默留白。
   */
  const loadDerivedPage = async (pageId: string) => {
    const gen = ++derivedGen.current;
    const res = await apiFetch<{ title?: string }>(`/api/content/${pageId}`);
    if (gen !== derivedGen.current) return;
    setDerivedPage({
      pageId,
      title: res.ok ? res.data?.title || null : null,
      missing: !res.ok,
    });
  };

  /** 從 derived 旗標的衍生來源跳到對應的 key */
  const jumpToKey = (keyValue: string) => {
    const row = keys.find((k) => k.keyValue === keyValue);
    if (!row) return;
    setTab('keys');
    selectKey(row);
  };

  const loadUsage = async (keyType: string, keyValue: string) => {
    const gen = ++usageGen.current;
    setUsageLoading(true);
    setUsage(null);
    const res = await apiFetch<UsageData>(
      `/api/interlink/usage?keyType=${encodeURIComponent(keyType)}&key=${encodeURIComponent(keyValue)}`
    );
    if (gen !== usageGen.current) return;
    setUsage(res.ok && res.data ? res.data : { definitions: [], anchors: [] });
    setUsageLoading(false);
    if (!res.ok)
      getToast().error(`載入使用位置失敗：${res.error || '未知錯誤'}`);
  };

  /* ── 儲存 ── */

  const saveKey = async () => {
    if (!selectedKey) return;
    setSaving(true);
    const res = await apiFetch(
      `/api/interlink/keys/${keyPath(selectedKey.keyType, selectedKey.keyValue)}`,
      {
        method: 'PUT',
        // PUT 是全覆蓋語意（未提供欄位視為清空），兩個欄位一律都送
        body: JSON.stringify({
          title: selectedKey.keyType === 'entity' ? null : draftTitle,
          description: draftDescription,
        }),
      }
    );
    if (res.ok) {
      getToast().success('已儲存');
      await loadAll();
    } else {
      getToast().error(res.error || '儲存失敗');
    }
    setSaving(false);
  };

  const saveFlag = async () => {
    if (!selectedFlag) return;
    setSaving(true);
    const res = await apiFetch(
      `/api/flags/${encodeURIComponent(selectedFlag.name)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          label: draftLabel,
          description: draftDescription,
          category: draftCategory,
        }),
      }
    );
    if (res.ok) {
      getToast().success('已儲存');
      await loadAll();
    } else {
      getToast().error(res.error || '儲存失敗');
    }
    setSaving(false);
  };

  /** 把內容裡已在用但沒註冊的旗標補進註冊表 */
  const registerFlag = async () => {
    if (!selectedFlag) return;
    setSaving(true);
    const res = await apiFetch('/api/flags', {
      method: 'POST',
      body: JSON.stringify({
        name: selectedFlag.name,
        label: draftLabel,
        description: draftDescription,
        category: draftCategory,
      }),
    });
    if (res.ok) {
      getToast().success('已註冊');
      await loadAll();
    } else {
      getToast().error(res.error || '註冊失敗');
    }
    setSaving(false);
  };

  const deleteFlag = async () => {
    if (!selectedFlag) return;
    const name = selectedFlag.name;
    const ok = await getDialog().confirm(`確定要刪除旗標「${name}」的註冊嗎？`);
    if (!ok) return;
    setSaving(true);
    let res = await apiFetch<{ references?: unknown }>(
      `/api/flags/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    );
    // worker 預設擋有引用的旗標，並在 409 的 data 帶回引用清單。認 references
    // 而不是比對錯誤訊息文字——訊息會隨文案調整，這個欄位是契約。
    // 確認後才帶 force：刪掉註冊不會動內容，內容裡的旗標會變成未註冊，
    // 下次存檔那一頁就會被擋。
    if (!res.ok && res.data?.references) {
      const forceOk = await getDialog().confirm(
        `${res.error || '這個旗標仍有引用'}。強制刪除後，引用它的頁面下次存檔會被「旗標尚未註冊」擋住。仍要刪除嗎？`
      );
      if (!forceOk) {
        setSaving(false);
        return;
      }
      res = await apiFetch(
        `/api/flags/${encodeURIComponent(name)}?force=true`,
        { method: 'DELETE' }
      );
    }
    if (res.ok) {
      getToast().success('已刪除註冊');
      setSelected(null);
      await loadAll();
    } else {
      getToast().error(res.error || '刪除失敗');
    }
    setSaving(false);
  };

  /* ── 左欄資料整理 ── */

  const needle = search.trim().toLowerCase();

  const matchKey = (row: InterlinkKeyRow) =>
    !needle ||
    row.keyValue.toLowerCase().includes(needle) ||
    (row.title || '').toLowerCase().includes(needle) ||
    (row.derivedName || '').toLowerCase().includes(needle);

  const matchFlag = (row: FlagAuditRow) =>
    (!needle ||
      row.name.toLowerCase().includes(needle) ||
      (row.label || '').toLowerCase().includes(needle)) &&
    (!problemsOnly || row.source === 'unregistered' || row.orphan);

  const entityKeys = keys.filter((k) => k.keyType === 'entity' && matchKey(k));
  const storyKeys = keys.filter((k) => k.keyType === 'story' && matchKey(k));
  const visibleFlags = audit.filter(matchFlag);
  const flagGroups: Array<{
    id: FlagAuditRow['source'];
    label: string;
    rows: FlagAuditRow[];
  }> = [
    {
      id: 'unregistered',
      label: '未註冊',
      rows: visibleFlags.filter((f) => f.source === 'unregistered'),
    },
    {
      id: 'registered',
      label: '已註冊',
      rows: visibleFlags.filter((f) => f.source === 'registered'),
    },
    {
      id: 'derived',
      label: '規則生成',
      rows: visibleFlags.filter((f) => f.source === 'derived'),
    },
  ];
  const orphanCount = audit.filter((f) => f.orphan).length;
  const unusedCount = audit.filter((f) => f.unused).length;

  /* ── 渲染：左欄 ── */

  const renderKeyRow = (row: InterlinkKeyRow) => {
    const active =
      selected?.kind === 'key' &&
      selected.keyType === row.keyType &&
      selected.keyValue === row.keyValue;
    const display =
      row.keyType === 'entity' ? row.derivedName : row.title || undefined;
    return (
      <button
        key={`${row.keyType}/${row.keyValue}`}
        className={`km-row ${active ? 'active' : ''}`}
        onClick={() => selectKey(row)}
      >
        <div className="km-row-main">
          <div className="km-row-name">{row.keyValue}</div>
          <div className="km-row-sub">
            {display || <span className="km-muted">（未命名）</span>}
          </div>
        </div>
        <div className="km-row-counts">
          <span title="定義端">{row.definitionCount}</span>
          <span className="km-row-counts-sep">·</span>
          <span title="錨點端">{row.anchorCount}</span>
        </div>
      </button>
    );
  };

  const renderFlagRow = (row: FlagAuditRow) => {
    const active = selected?.kind === 'flag' && selected.name === row.name;
    return (
      <button
        key={row.name}
        className={`km-row ${active ? 'active' : ''}`}
        onClick={() => selectFlag(row)}
      >
        <div className="km-row-main">
          <div className="km-row-name">{row.name}</div>
          <div className="km-row-sub">
            {row.label || <span className="km-muted">（無標籤）</span>}
            {row.orphan && (
              <span className="km-badge km-badge--warn">孤兒</span>
            )}
            {row.unused && (
              <span className="km-badge km-badge--mute">未使用</span>
            )}
          </div>
        </div>
        <div className="km-row-counts">
          <span title="授予端">{row.grantedBy.length}</span>
          <span className="km-row-counts-sep">·</span>
          <span title="需求端">{row.requiredBy.length}</span>
        </div>
      </button>
    );
  };

  function renderGroup<T>(
    label: string,
    rows: T[],
    render: (row: T) => ReactElement
  ): ReactElement {
    return (
      <div className="km-group" key={label}>
        <div className="km-group-title">
          {label}
          <span className="km-group-count">{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <div className="km-group-empty">（無）</div>
        ) : (
          rows.map(render)
        )}
      </div>
    );
  }

  /* ── 渲染：中欄 ── */

  const renderKeyDetail = (row: InterlinkKeyRow) => {
    const isEntity = row.keyType === 'entity';
    const dirty =
      (isEntity ? false : draftTitle !== (row.title || '')) ||
      draftDescription !== (row.description || '');
    return (
      <>
        <div className="km-detail-head">
          <span className="km-kind-tag">{row.keyType}</span>
          <span className="km-detail-key">{row.keyValue}</span>
        </div>

        <div className="km-field">
          <label className="km-field-label" htmlFor="km-title">
            標題
          </label>
          {isEntity ? (
            <>
              <input
                id="km-title"
                className="km-field-input"
                value={row.derivedName || ''}
                disabled
                readOnly
              />
              <div className="km-field-hint">
                來源：Concepts dossier 條目的名稱。entity 的權威名稱只有一份，
                這裡不可編輯。
              </div>
            </>
          ) : (
            <input
              id="km-title"
              className="km-field-input"
              value={draftTitle}
              spellCheck={false}
              placeholder="劇情點的顯示名稱"
              onChange={(e) => setDraftTitle(e.target.value)}
            />
          )}
        </div>

        <div className="km-field">
          <label className="km-field-label" htmlFor="km-desc">
            說明
          </label>
          <textarea
            id="km-desc"
            className="km-field-input km-field-input--area"
            value={draftDescription}
            rows={5}
            onChange={(e) => setDraftDescription(e.target.value)}
          />
        </div>

        <div className="km-detail-actions">
          <button
            type="button"
            className="km-btn km-btn--primary"
            disabled={!dirty || saving}
            onClick={saveKey}
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          {row.updatedAt && (
            <span className="km-detail-stamp">
              最後更新 {new Date(row.updatedAt).toLocaleString('zh-TW')}
            </span>
          )}
        </div>
      </>
    );
  };

  /**
   * derived 旗標的來源區塊。
   *
   * 這裡刻意不放任何輸入框：derived 旗標沒有可寫欄位，擺三個空的 disabled
   * 欄位只會讓人以為是「還沒填」。改為把它衍生自的東西攤開，說明仍只存在
   * 來源那一份上（頁面的說明在頁面上、key 的說明在 key 上）。
   */
  const renderDerivedSource = (name: string) => {
    const source = parseDerivedSource(name);
    const keyRow =
      source.kind === 'key'
        ? keys.find((k) => k.keyValue === source.keyValue)
        : undefined;
    return (
      <div className="km-field">
        <div className="km-field-label">衍生來源</div>
        <dl className="km-source">
          <dt>類型</dt>
          <dd>{source.role}</dd>

          {source.kind === 'retired' && (
            <>
              <dt>狀態</dt>
              <dd className="km-source-retired">已退役 · {source.note}</dd>
            </>
          )}

          {(source.kind === 'page' || source.kind === 'image') && (
            <>
              <dt>來源頁面</dt>
              <dd>
                <div className="km-source-main">
                  {derivedPage?.pageId === source.pageId
                    ? derivedPage.missing
                      ? '查不到這一頁——來源可能已被刪除'
                      : derivedPage.title || source.pageId
                    : '載入中…'}
                </div>
                <div className="km-source-sub">{source.pageId}</div>
                <a
                  className="km-usage-link"
                  href={`/admin/edit/${source.pageId}`}
                >
                  跳到該頁編輯 →
                </a>
              </dd>
            </>
          )}

          {source.kind === 'image' && (
            <>
              <dt>圖片 id</dt>
              <dd>{source.imageId}</dd>
            </>
          )}

          {source.kind === 'key' && (
            <>
              <dt>來源 key</dt>
              <dd>
                <div className="km-source-main">
                  {keyRow
                    ? keyRow.title || keyRow.derivedName || source.keyValue
                    : source.keyValue}
                </div>
                <div className="km-source-sub">
                  {keyRow
                    ? `${keyRow.keyType} · ${source.keyValue}`
                    : '這個 key 不在清單上——定義可能已被刪除'}
                </div>
                {keyRow && (
                  <button
                    type="button"
                    className="km-source-jump"
                    onClick={() => jumpToKey(source.keyValue)}
                  >
                    去編輯這個 key 的說明 →
                  </button>
                )}
              </dd>
            </>
          )}

          {source.kind === 'unknown' && (
            <>
              <dt>狀態</dt>
              <dd>
                認得出是規則生成的形狀，但解不出來源。可能是舊版命名或形狀已變更。
              </dd>
            </>
          )}
        </dl>
      </div>
    );
  };

  const renderFlagDetail = (row: FlagAuditRow) => {
    const reg = registryByName.get(row.name);
    const isDerived = row.source === 'derived';
    const isUnregistered = row.source === 'unregistered';
    const dirty =
      draftLabel !== (reg?.label || '') ||
      draftDescription !== (reg?.description || '') ||
      draftCategory !== (reg?.category || '');

    if (isDerived) {
      return (
        <>
          <div className="km-detail-head">
            <span className="km-kind-tag km-kind-tag--derived">derived</span>
            <span className="km-detail-key">{row.name}</span>
          </div>
          <div className="km-notice">
            規則生成的旗標：名稱由程式依 key 或頁面 id 推導，不進註冊表，
            也不受註冊強制。它沒有自己的標籤與說明——那些寫在下面的來源上，
            改來源就等於改它。
          </div>
          {renderDerivedSource(row.name)}
        </>
      );
    }

    return (
      <>
        <div className="km-detail-head">
          <span className={`km-kind-tag km-kind-tag--${row.source}`}>
            {isUnregistered ? 'unregistered' : 'flag'}
          </span>
          <span className="km-detail-key">{row.name}</span>
        </div>

        {isUnregistered && (
          <div className="km-notice km-notice--warn">
            內容裡在用但註冊表沒有這個旗標。任何用到它的頁面下次存檔都會被擋，
            先在這裡補註冊。
          </div>
        )}

        <div className="km-field">
          <label className="km-field-label" htmlFor="km-label">
            標籤
          </label>
          <input
            id="km-label"
            className="km-field-input"
            value={draftLabel}
            spellCheck={false}
            placeholder="給人看的短名稱"
            onChange={(e) => setDraftLabel(e.target.value)}
          />
        </div>

        <div className="km-field">
          <label className="km-field-label" htmlFor="km-category">
            類別
          </label>
          <input
            id="km-category"
            className="km-field-input"
            value={draftCategory}
            spellCheck={false}
            placeholder="分組用，可留空"
            onChange={(e) => setDraftCategory(e.target.value)}
          />
        </div>

        <div className="km-field">
          <label className="km-field-label" htmlFor="km-flag-desc">
            說明
          </label>
          <textarea
            id="km-flag-desc"
            className="km-field-input km-field-input--area"
            value={draftDescription}
            rows={4}
            onChange={(e) => setDraftDescription(e.target.value)}
          />
        </div>

        <div className="km-detail-actions">
          {isUnregistered ? (
            <button
              type="button"
              className="km-btn km-btn--primary"
              disabled={saving}
              onClick={registerFlag}
            >
              {saving ? '註冊中…' : '註冊這個旗標'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="km-btn km-btn--primary"
                disabled={!dirty || saving}
                onClick={saveFlag}
              >
                {saving ? '儲存中…' : '儲存'}
              </button>
              <button
                type="button"
                className="km-btn km-btn--danger"
                disabled={saving}
                onClick={deleteFlag}
              >
                刪除註冊
              </button>
            </>
          )}
        </div>
      </>
    );
  };

  /* ── 渲染：右欄 ── */

  const renderUsageEntry = (
    pageId: string,
    pageTitle: string,
    meta: string
  ) => (
    <div className="km-usage-item" key={`${pageId}/${meta}`}>
      <div className="km-usage-title">{pageTitle || pageId}</div>
      <div className="km-usage-meta">{meta}</div>
      <a className="km-usage-link" href={`/admin/edit/${pageId}`}>
        跳到該頁編輯 →
      </a>
    </div>
  );

  const renderUsage = () => {
    if (!selected) {
      return <div className="km-empty">選一個 key 或旗標</div>;
    }
    if (selected.kind === 'flag') {
      const row = selectedFlag;
      if (!row) return <div className="km-empty">找不到這個旗標</div>;
      return (
        <>
          <div className="km-usage-group">
            <div className="km-usage-group-title">
              授予端
              <span className="km-group-count">{row.grantedBy.length}</span>
            </div>
            {row.grantedBy.length === 0 ? (
              <div className="km-group-empty">
                {row.source === 'derived'
                  ? '（由程式授予）'
                  : '（沒有任何地方授予）'}
              </div>
            ) : (
              row.grantedBy.map((ref) =>
                renderUsageEntry(ref.pageId, ref.pageTitle, ref.area)
              )
            )}
          </div>
          <div className="km-usage-group">
            <div className="km-usage-group-title">
              需求端
              <span className="km-group-count">{row.requiredBy.length}</span>
            </div>
            {row.requiredBy.length === 0 ? (
              <div className="km-group-empty">（沒有任何頁面要求）</div>
            ) : (
              row.requiredBy.map((ref) =>
                renderUsageEntry(ref.pageId, ref.pageTitle, ref.area)
              )
            )}
          </div>
        </>
      );
    }
    if (usageLoading) return <div className="km-empty">載入中…</div>;
    if (!usage) return <div className="km-empty">—</div>;
    return (
      <>
        <div className="km-usage-group">
          <div className="km-usage-group-title">
            定義端
            <span className="km-group-count">{usage.definitions.length}</span>
          </div>
          {usage.definitions.length === 0 ? (
            <div className="km-group-empty">（沒有任何地方宣告）</div>
          ) : (
            usage.definitions.map((def) =>
              renderUsageEntry(
                def.pageId,
                def.pageTitle,
                `${def.area} · ${def.scope}`
              )
            )
          )}
        </div>
        <div className="km-usage-group">
          <div className="km-usage-group-title">
            錨點端
            <span className="km-group-count">{usage.anchors.length}</span>
          </div>
          {usage.anchors.length === 0 ? (
            <div className="km-group-empty">（History 內容裡沒有引用）</div>
          ) : (
            usage.anchors.map((anchor) =>
              renderUsageEntry(
                anchor.pageId,
                anchor.pageTitle,
                [anchor.anchorKind, anchor.label].filter(Boolean).join(' · ')
              )
            )
          )}
        </div>
      </>
    );
  };

  return (
    <div className="km">
      {/* 左欄：清單 */}
      <div className="km-list">
        <div className="km-tabs">
          <button
            className={`km-tab ${tab === 'keys' ? 'active' : ''}`}
            onClick={() => switchTab('keys')}
          >
            key
            <span className="km-group-count">{keys.length}</span>
          </button>
          <button
            className={`km-tab ${tab === 'flags' ? 'active' : ''}`}
            onClick={() => switchTab('flags')}
          >
            flag
            <span className="km-group-count">{audit.length}</span>
          </button>
        </div>

        <div className="km-search-bar">
          <input
            type="text"
            className="km-search-input"
            placeholder={tab === 'keys' ? '搜尋 key、名稱…' : '搜尋旗標、標籤…'}
            value={search}
            spellCheck={false}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {tab === 'keys' ? (
          <div className="km-list-toolbar">
            <div className="km-chips" role="group" aria-label="key 類型篩選">
              {KEY_TYPE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`km-chip ${keyTypeFilter === filter.id ? 'active' : ''}`}
                  aria-pressed={keyTypeFilter === filter.id}
                  onClick={() => setKeyTypeFilter(filter.id)}
                >
                  {filter.label}
                  <span className="km-group-count">
                    {filter.id === 'entity'
                      ? entityKeys.length
                      : filter.id === 'story'
                        ? storyKeys.length
                        : entityKeys.length + storyKeys.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="km-list-toolbar">
            <label className="km-check">
              <input
                type="checkbox"
                checked={problemsOnly}
                onChange={(e) => setProblemsOnly(e.target.checked)}
              />
              <span>只顯示有問題的</span>
            </label>
            <span className="km-list-stats">
              孤兒 {orphanCount} · 未使用 {unusedCount}
            </span>
          </div>
        )}

        <div className="km-list-scroll">
          {loading ? (
            <div className="km-empty">載入中…</div>
          ) : tab === 'keys' ? (
            <>
              {keyTypeFilter !== 'story' &&
                renderGroup('entity', entityKeys, renderKeyRow)}
              {keyTypeFilter !== 'entity' &&
                renderGroup('story', storyKeys, renderKeyRow)}
            </>
          ) : (
            flagGroups.map((group) =>
              renderGroup(group.label, group.rows, renderFlagRow)
            )
          )}
        </div>
      </div>

      {/* 中欄：詳細 */}
      <div className="km-detail">
        {selected === null ? (
          <div className="km-empty">從左欄選一個項目</div>
        ) : selected.kind === 'key' ? (
          selectedKey ? (
            renderKeyDetail(selectedKey)
          ) : (
            <div className="km-empty">找不到這個 key</div>
          )
        ) : selectedFlag ? (
          renderFlagDetail(selectedFlag)
        ) : (
          <div className="km-empty">找不到這個旗標</div>
        )}
      </div>

      {/* 右欄：用在哪 */}
      <div className="km-usage">
        <div className="km-usage-head">用在哪</div>
        <div className="km-usage-scroll">{renderUsage()}</div>
      </div>
    </div>
  );
}
