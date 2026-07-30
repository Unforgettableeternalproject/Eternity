/**
 * flags.ts — 自訂旗標註冊表的 CRUD 與全站巡查
 *
 * 註冊表只收自訂旗標（見 `flags-scan.ts` 的分類說明）。規則生成的旗標
 * 不入表，但巡查清單仍會列出——管理者要看得到「這個 completed:* 被誰
 * 要求」，只是不能編輯或刪除它。
 */

import {
  classifyFlag,
  scanGrantedFlags,
  scanRequiredFlags,
} from './flags-scan';

/** 註冊表的一列 */
export interface FlagRow {
  name: string;
  label: string | null;
  description: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 旗標的一處引用（授予端或需求端） */
export interface FlagReference {
  pageId: string;
  pageTitle: string;
  area: string;
}

/** 巡查清單的一列 */
export interface FlagAuditRow {
  name: string;
  /**
   * `derived` = 規則生成（不可編輯不可刪）
   * `registered` = 自訂且已註冊
   * `unregistered` = 自訂但註冊表裡沒有（內容裡卻在用）
   */
  source: 'registered' | 'derived' | 'unregistered';
  label: string | null;
  grantedBy: FlagReference[];
  requiredBy: FlagReference[];
  /** 有人要求但沒有任何地方授予 */
  orphan: boolean;
  /** 有地方授予但沒有任何人要求 */
  unused: boolean;
}

const SELECT_COLS = `name, label, description, category,
  created_at AS createdAt, updated_at AS updatedAt`;

export async function listFlags(
  db: D1Database,
  category?: string | null
): Promise<FlagRow[]> {
  const query = category
    ? `SELECT ${SELECT_COLS} FROM uep_flags WHERE category = ? ORDER BY name ASC`
    : `SELECT ${SELECT_COLS} FROM uep_flags ORDER BY name ASC`;
  const stmt = category ? db.prepare(query).bind(category) : db.prepare(query);
  const result = await stmt.all<FlagRow>();
  return result.results || [];
}

export async function findFlag(
  db: D1Database,
  name: string
): Promise<FlagRow | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM uep_flags WHERE name = ?`)
    .bind(name)
    .first<FlagRow>();
  return row ?? null;
}

/** 空字串與純空白收斂成 NULL */
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface FlagInput {
  label?: unknown;
  description?: unknown;
  category?: unknown;
  /**
   * 保留來源端的時間戳，供 `pnpm sync` 的兩端比對使用。
   *
   * 同步時若一律用寫入當下的時間，被推過去的那筆立刻變成「較新」，
   * 下一次同步就會反向覆蓋回來，兩端永遠在互相推翻。
   */
  updatedAt?: unknown;
}

/** 合法 ISO 時間字串才採用，否則交給呼叫端的預設值 */
function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

/**
 * 註冊一個新旗標。名稱已存在回 `null`（呼叫端轉 409）。
 *
 * 規則生成形狀的名稱一律拒絕（回 `'derived'`）——那類旗標的名稱是 key 的
 * 函數，註冊它等於在 key 定義之外開第二個事實來源。
 */
export async function createFlag(
  db: D1Database,
  name: string,
  input: FlagInput
): Promise<FlagRow | null | 'derived'> {
  if (classifyFlag(name) === 'derived') return 'derived';
  if (await findFlag(db, name)) return null;

  // 同步過來的旗標保留來源時間戳；created_at 一併用同一個值，
  // 否則會出現 created 晚於 updated 的怪狀態
  const stamp = normalizeTimestamp(input.updatedAt) ?? new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO uep_flags (name, label, description, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      name,
      normalizeText(input.label),
      normalizeText(input.description),
      normalizeText(input.category),
      stamp,
      stamp
    )
    .run();
  return findFlag(db, name);
}

/**
 * 更新旗標的 label／description／category。
 *
 * **不改 name**——改名會牽動所有引用，走專屬的三段式流程。
 */
export async function updateFlag(
  db: D1Database,
  name: string,
  input: FlagInput
): Promise<FlagRow | null> {
  if (!(await findFlag(db, name))) return null;
  await db
    .prepare(
      `UPDATE uep_flags
       SET label = ?, description = ?, category = ?, updated_at = ?
       WHERE name = ?`
    )
    .bind(
      normalizeText(input.label),
      normalizeText(input.description),
      normalizeText(input.category),
      normalizeTimestamp(input.updatedAt) ?? new Date().toISOString(),
      name
    )
    .run();
  return findFlag(db, name);
}

export async function deleteFlag(
  db: D1Database,
  name: string
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM uep_flags WHERE name = ?`)
    .bind(name)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 全站掃描，彙整每個旗標的授予端與需求端。
 *
 * 掃的是全表而非單一 area：FlagMarker 掛在所有 zone 共用的 RichEditor，
 * 授予端可能出現在任何 rich_text 內容裡。
 */
export async function auditFlags(db: D1Database): Promise<FlagAuditRow[]> {
  const registered = new Map(
    (await listFlags(db)).map((flag) => [flag.name, flag])
  );

  const rows = new Map<string, FlagAuditRow>();
  const touch = (name: string): FlagAuditRow => {
    let row = rows.get(name);
    if (!row) {
      const kind = classifyFlag(name);
      const reg = registered.get(name);
      row = {
        name,
        // derived 形狀優先於註冊狀態：規則生成的旗標即使被誤註冊，
        // 也不該在 UI 上顯示為可編輯
        source:
          kind === 'derived' ? 'derived' : reg ? 'registered' : 'unregistered',
        label: reg?.label ?? null,
        grantedBy: [],
        requiredBy: [],
        orphan: false,
        unused: false,
      };
      rows.set(name, row);
    }
    return row;
  };

  const pages = await db
    .prepare(
      `SELECT id, title, area, content, metadata FROM pages
       WHERE deleted_at IS NULL`
    )
    .all<{
      id: string;
      title: string;
      area: string;
      content: string | null;
      metadata: string | null;
    }>();

  for (const page of pages.results || []) {
    const ref: FlagReference = {
      pageId: page.id,
      pageTitle: page.title,
      area: page.area,
    };

    for (const flag of scanGrantedFlags(page.content)) {
      touch(flag).grantedBy.push(ref);
    }

    let metadata: unknown = null;
    try {
      metadata = JSON.parse(page.metadata || 'null');
    } catch {
      // 壞 JSON 視為無 gate——巡查是輔助功能，不該因一頁壞資料整份失敗
    }
    for (const flag of scanRequiredFlags(metadata)) {
      touch(flag).requiredBy.push(ref);
    }
  }

  // 註冊了但內容裡完全沒用到的旗標也要出現在清單上
  for (const name of registered.keys()) touch(name);

  for (const row of rows.values()) {
    // ⚠️ derived 旗標不參與孤兒判定：它們的授予端是程式（掃描線通過文末
    // 哨兵授予 completed:*、echo spot 觸發授予 {storyKey}:song），內容裡
    // 本來就找不到授予點。把它們算進來的話，每一個 gate 用的 completed:*
    // 都會變成假警報，巡查清單直接失去可讀性
    row.orphan =
      row.source !== 'derived' &&
      row.requiredBy.length > 0 &&
      row.grantedBy.length === 0;
    row.unused = row.grantedBy.length > 0 && row.requiredBy.length === 0;
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 從一批旗標中挑出「自訂且尚未註冊」的（存檔前的強制檢查）。
 *
 * derived 旗標一律豁免——它們的名稱由程式依 key 推導，本來就不該註冊。
 */
export async function findUnregisteredFlags(
  db: D1Database,
  flags: string[]
): Promise<string[]> {
  const custom = [...new Set(flags)].filter(
    (flag) => classifyFlag(flag) === 'custom'
  );
  if (custom.length === 0) return [];

  const placeholders = custom.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT name FROM uep_flags WHERE name IN (${placeholders})`)
    .bind(...custom)
    .all<{ name: string }>();
  const registered = new Set((result.results || []).map((row) => row.name));
  return custom.filter((flag) => !registered.has(flag));
}

/**
 * 把尚未註冊的自訂旗標補進註冊表，回傳實際新增的名稱。
 *
 * 兩條路徑共用：批次匯入（`/api/content/sync/import`）與單頁存檔
 * （`upsertPage`，2026-07-30 D-1 反轉後改走這裡，原本是 409 攔截）。
 *
 * 為什麼不擋：
 * - 匯入若擋，`uep_flags` 不在 `pnpm sync` 的同步範圍內（sync 只搬 pages 與
 *   root_* 業務表），本地註冊好的旗標推到遠端時遠端註冊表是空的，一擋就等於
 *   整個同步流程卡死。而且擋下來並不會讓資料變乾淨——旗標已經在內容裡了。
 * - 單頁存檔若擋，就與 `entityKey`／`storyKey` 的模式不一致（那兩者是自由填 →
 *   `ensureInterlinkKeys` 建殼列 → 事後補說明），而且會連帶關掉 derived 旗標
 *   的需求端（gate 想要求 `{storyKey}:song` 時那個旗標依設計不可註冊）。
 *
 * 代價是打錯字的旗標會靜默進入註冊表，所以呼叫端必須把新增清單回報出去
 * （sync 腳本會印、存檔回應帶 `autoRegisteredFlags`），並靠巡查的
 * orphan／unused 配對把 typo 撈出來。
 *
 * ⚠️ 建出來的是**殼列**：`label`／`description`／`category` 全為 NULL，比照
 * `ensureInterlinkKeys` 的殼列語意。不要塞「自動註冊」這類佔位說明——那幾個
 * 欄位是要給人填的，塞了字進去反而得先刪掉才能寫真正的說明。
 */
export async function ensureFlagsRegistered(
  db: D1Database,
  flags: string[]
): Promise<string[]> {
  const missing = await findUnregisteredFlags(db, flags);
  if (missing.length === 0) return [];

  const now = new Date().toISOString();
  await db.batch(
    missing.map((name) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO uep_flags
             (name, label, description, category, created_at, updated_at)
           VALUES (?, NULL, NULL, NULL, ?, ?)`
        )
        .bind(name, now, now)
    )
  );
  return missing;
}

/** 某個旗標目前的全部引用（刪除前的檢查） */
export async function findFlagReferences(
  db: D1Database,
  name: string
): Promise<{ grantedBy: FlagReference[]; requiredBy: FlagReference[] }> {
  const row = (await auditFlags(db)).find((flag) => flag.name === name);
  return {
    grantedBy: row?.grantedBy ?? [],
    requiredBy: row?.requiredBy ?? [],
  };
}
