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

/** 改名的 dryRun 預覽（與實際寫入是同一份計算） */
interface RenamePreview {
  from: string;
  to: string;
  dryRun: boolean;
  totalHits: number;
  pages: {
    pageId: string;
    area: string;
    title: string;
    contentHits: number;
    metadataHits: number;
  }[];
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

const FLAG_USE_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'used', label: '已使用' },
  { id: 'unused', label: '未使用' },
] as const;

/**
 * 這個旗標在內容裡有沒有任何引用（授予端或需求端任一）。
 *
 * ⚠️ 與 `row.unused` 不是同一件事：`row.unused` 是「有授予、沒人要求」
 * （UI 標示為「無人要求」），這裡問的是「內容裡到底提過它沒有」。
 * 完全沒引用的旗標多半是註冊表殼列——旗標刪掉了、改名了，或當初打錯字。
 */
function isFlagUsed(row: FlagAuditRow): boolean {
  return row.grantedBy.length > 0 || row.requiredBy.length > 0;
}

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
  /** flag 分頁的使用狀態篩選：對照「註冊了但還沒真的用上」最快的入口 */
  const [flagUseFilter, setFlagUseFilter] = useState<'all' | 'used' | 'unused'>(
    'all'
  );
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

  /* 改名（三段式） */
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTo, setRenameTo] = useState('');
  const [renamePreview, setRenamePreview] = useState<RenamePreview | null>(
    null
  );
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

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

  /**
   * 丟掉右欄與衍生來源的既有結果，並讓進行中的請求失效。
   *
   * 一併關掉改名面板：面板裡的預覽是綁在某個特定旗標上的，選別的項目還開著
   * 就會出現「拿 A 的預覽確認 B 的改名」。
   */
  const clearLookups = () => {
    usageGen.current += 1;
    derivedGen.current += 1;
    setUsage(null);
    setUsageLoading(false);
    setDerivedPage(null);
    closeRename();
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
    closeRename();
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

  /* ── 改名（三段式：輸入 → 預覽 → 寫入）── */

  /**
   * 改名一律先預覽。
   *
   * 漏改任何一處引用的症狀是靜默永久鎖死（需求端等一個再也不會被授予的旗標，
   * 沒有錯誤訊息，那一頁就是永遠打不開），所以先讓人看到會動到哪幾頁再寫入。
   */
  const previewRename = async () => {
    if (!selectedFlag) return;
    setRenaming(true);
    setRenameError(null);
    const res = await apiFetch<RenamePreview>(
      `/api/flags/${encodeURIComponent(selectedFlag.name)}/rename`,
      {
        method: 'POST',
        body: JSON.stringify({ to: renameTo, dryRun: true }),
      }
    );
    if (res.ok && res.data) setRenamePreview(res.data);
    else setRenameError(res.error || '預覽失敗');
    setRenaming(false);
  };

  const commitRename = async () => {
    if (!selectedFlag || !renamePreview) return;
    const from = selectedFlag.name;
    const to = renamePreview.to;
    setRenaming(true);
    setRenameError(null);
    const res = await apiFetch<RenamePreview>(
      `/api/flags/${encodeURIComponent(from)}/rename`,
      { method: 'POST', body: JSON.stringify({ to }) }
    );
    if (res.ok) {
      getToast().success(`已改名為 ${to}`);
      closeRename();
      // 選取跟著移到新名字上，否則中欄會停在一個已經不存在的旗標
      setSelected({ kind: 'flag', name: to });
      await loadAll();
    } else {
      setRenameError(res.error || '改名失敗');
    }
    setRenaming(false);
  };

  const closeRename = () => {
    setRenameOpen(false);
    setRenameTo('');
    setRenamePreview(null);
    setRenameError(null);
  };

  /* ── 左欄資料整理 ── */

  const needle = search.trim().toLowerCase();

  const matchKey = (row: InterlinkKeyRow) =>
    !needle ||
    row.keyValue.toLowerCase().includes(needle) ||
    (row.title || '').toLowerCase().includes(needle) ||
    (row.derivedName || '').toLowerCase().includes(needle);

  /** 搜尋與「只顯示有問題的」——使用狀態篩選另外套，好讓 chip 標得出筆數 */
  const matchFlagBase = (row: FlagAuditRow) =>
    (!needle ||
      row.name.toLowerCase().includes(needle) ||
      (row.label || '').toLowerCase().includes(needle)) &&
    (!problemsOnly || row.source === 'unregistered' || row.orphan);

  const entityKeys = keys.filter((k) => k.keyType === 'entity' && matchKey(k));
  const storyKeys = keys.filter((k) => k.keyType === 'story' && matchKey(k));
  const searchedFlags = audit.filter(matchFlagBase);
  const usedFlags = searchedFlags.filter(isFlagUsed);
  const unusedFlags = searchedFlags.filter((f) => !isFlagUsed(f));
  const visibleFlags =
    flagUseFilter === 'used'
      ? usedFlags
      : flagUseFilter === 'unused'
        ? unusedFlags
        : searchedFlags;

  const unregisteredRows = visibleFlags.filter(
    (f) => f.source === 'unregistered'
  );
  const flagGroups: Array<{
    id: FlagAuditRow['source'];
    label: string;
    rows: FlagAuditRow[];
    hint?: string;
    hintTone?: 'warn';
  }> = [
    // 未註冊在自動註冊（0.9.16.8）之後只剩兩條產生路徑：`?force=true` 強制
    // 刪掉仍被引用的註冊，以及繞過 API 的直接 DB 寫入（seed／手動 SQL）。
    // 常態是 0，所以空的時候整組不畫——它是不一致偵測器，不是常設分類
    ...(unregisteredRows.length > 0
      ? [
          {
            id: 'unregistered' as const,
            label: '未註冊',
            rows: unregisteredRows,
            hint: '內容裡在用但註冊表沒有。正常存檔會自動註冊，所以會出現在這裡的只有兩種：強制刪除過註冊，或資料是繞過 API 直接寫進 DB 的。點進去補註冊即可。',
            hintTone: 'warn' as const,
          },
        ]
      : []),
    {
      id: 'registered',
      label: '已註冊',
      rows: visibleFlags.filter((f) => f.source === 'registered'),
    },
    {
      id: 'derived',
      // 標題就講清楚這一組的收錄條件。少了這句會讓人把筆數讀成「系統裡
      // 只有這幾個」——每一頁都能產生 completed:*，這裡只列被引用的
      label: '規則生成（內容裡有引用）',
      rows: visibleFlags.filter((f) => f.source === 'derived'),
      hint: 'completed:* 只在被當成前置條件時出現，沒有任何頁面要求它的不會列在這裡。每一頁的進度狀態要看 /admin/behavior 的全樹總覽。這一份掃的是內容怎麼寫，與讀者進度無關。',
    },
  ];
  const orphanCount = audit.filter((f) => f.orphan).length;
  const noDemandCount = audit.filter((f) => f.unused).length;

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
            {/* 「無人要求」而非「未使用」：它確實被授予了，只是沒人拿它當
                條件。上方 chip 的「未使用」問的是另一件事（內容裡完全沒
                引用），兩者同名會互相打架 */}
            {row.unused && (
              <span className="km-badge km-badge--mute">無人要求</span>
            )}
            {!isFlagUsed(row) && (
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
    render: (row: T) => ReactElement,
    hint?: string,
    hintTone?: 'warn'
  ): ReactElement {
    return (
      <div className="km-group" key={label}>
        <div className="km-group-title">
          {label}
          <span className="km-group-count">{rows.length}</span>
        </div>
        {hint && (
          <div
            className={`km-group-hint ${hintTone === 'warn' ? 'km-group-hint--warn' : ''}`}
          >
            ⓘ {hint}
          </div>
        )}
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
                className="km-btn"
                disabled={saving || renaming}
                onClick={() =>
                  renameOpen ? closeRename() : setRenameOpen(true)
                }
              >
                {renameOpen ? '取消改名' : '改名'}
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

        {renameOpen && renderRenamePanel(row.name)}
      </>
    );
  };

  /**
   * 改名面板：輸入新名 → 預覽影響 → 確認寫入。
   *
   * 預覽與實際寫入打的是同一個端點（只差 dryRun），所以清單上的筆數就是真的
   * 會被改的東西，不是另外算的估計值。
   */
  const renderRenamePanel = (from: string) => {
    // 改了名字就讓舊預覽失效，避免拿 A 的預覽去確認 B 的改名
    const previewStale =
      !!renamePreview && renamePreview.to !== renameTo.trim();
    return (
      <div className="km-rename">
        <div className="km-field-label">改名</div>
        <input
          className="km-field-input"
          value={renameTo}
          spellCheck={false}
          placeholder="新的旗標名稱"
          aria-label="新的旗標名稱"
          onChange={(e) => setRenameTo(e.target.value)}
        />
        <div className="km-field-hint">
          會一併改寫所有引用：授予端的標記與需求端的解鎖條件。被改到的頁面
          `updated_at` 會更新，同步狀態因此標成 modified，下次{' '}
          <code>pnpm sync</code> 會把它們算成有變動。
        </div>

        {renameError && <div className="km-rename-error">{renameError}</div>}

        {renamePreview && !previewStale && (
          <div className="km-rename-preview">
            <div className="km-rename-preview-head">
              將把 {renamePreview.pages.length} 頁的 {renamePreview.totalHits}{' '}
              處引用從 <code>{renamePreview.from}</code> 改為{' '}
              <code>{renamePreview.to}</code>
            </div>
            {renamePreview.pages.length === 0 ? (
              <div className="km-group-empty">
                目前沒有任何頁面引用它，只會改註冊表這一列。
              </div>
            ) : (
              renamePreview.pages.map((page) => (
                <div className="km-usage-item" key={page.pageId}>
                  <div className="km-usage-title">
                    {page.title || page.pageId}
                  </div>
                  <div className="km-usage-meta">
                    {page.area} · 授予 {page.contentHits} · 需求{' '}
                    {page.metadataHits}
                  </div>
                  <a
                    className="km-usage-link"
                    href={`/admin/edit/${page.pageId}`}
                  >
                    跳到該頁編輯 →
                  </a>
                </div>
              ))
            )}
          </div>
        )}

        <div className="km-detail-actions">
          <button
            type="button"
            className="km-btn"
            disabled={!renameTo.trim() || renaming}
            onClick={previewRename}
          >
            {renaming && !renamePreview ? '計算中…' : '預覽影響'}
          </button>
          <button
            type="button"
            className="km-btn km-btn--primary"
            disabled={!renamePreview || previewStale || renaming}
            title={
              previewStale
                ? '名稱已變更，請重新預覽'
                : `改名 ${from} → ${renameTo}`
            }
            onClick={commitRename}
          >
            {renaming && renamePreview ? '改名中…' : '確認改名'}
          </button>
        </div>
      </div>
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
          <div className="km-list-toolbar km-list-toolbar--stack">
            <div
              className="km-chips"
              role="group"
              aria-label="旗標使用狀態篩選"
            >
              {FLAG_USE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`km-chip ${flagUseFilter === filter.id ? 'active' : ''}`}
                  aria-pressed={flagUseFilter === filter.id}
                  onClick={() => setFlagUseFilter(filter.id)}
                >
                  {filter.label}
                  <span className="km-group-count">
                    {filter.id === 'used'
                      ? usedFlags.length
                      : filter.id === 'unused'
                        ? unusedFlags.length
                        : searchedFlags.length}
                  </span>
                </button>
              ))}
            </div>
            <div className="km-toolbar-row">
              <label className="km-check">
                <input
                  type="checkbox"
                  checked={problemsOnly}
                  onChange={(e) => setProblemsOnly(e.target.checked)}
                />
                <span>只顯示有問題的</span>
              </label>
              <span className="km-list-stats">
                孤兒 {orphanCount} · 無人要求 {noDemandCount}
              </span>
            </div>
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
              renderGroup(
                group.label,
                group.rows,
                renderFlagRow,
                group.hint,
                group.hintTone
              )
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
