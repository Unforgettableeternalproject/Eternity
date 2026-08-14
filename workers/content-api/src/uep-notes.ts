/**
 * 便條島便條的儲存拆分（S11 C 段，blob 瘦身）
 *
 * 對客戶端的協定完全不變：progress GET/PUT 照樣整包 ProgressState
 * （含 storageNotes）。worker 在 PUT 時把 storageNotes 剝出來差分寫入
 * `uep_user_notes` 表、GET 時組裝回去——**單一 progress_rev CAS 繼續
 * 罩住便條**，所有既有衝突語意（409 → hydrate 收斂）原封不動。
 *
 * ⚠️ 不變量：凡是把 progress blob 回傳給客戶端的路徑（GET、PUT 的 409
 * conflict、admin 進度檢視）都**必須**經過 `assembleProgress()` 把便條
 * 組裝回去。漏了的話客戶端會拿到沒便條的 state，下一次 PUT 的差分同步
 * 會把整張表清空——那是資料損失，不是 bug 症狀輕微的那種。
 *
 * 既有 blob 內的便條由 lazy migration 搬移（GET/PUT 看到 blob 還有
 * storageNotes 就搬進表、清欄位）：stale 本地鏡像永遠觸發不了重複遷移
 * （遷移條件看的是伺服器 blob 不是客戶端），刪掉的便條不會復活。
 */

/** 便條在 ProgressState JSON 中的形狀（對齊 apps/uep progress/types.ts） */
export interface StorageNoteJson {
  id: string;
  text: string;
  tilt: number;
  createdAt: string;
  updatedAt: string;
  location?: { zone: string; pageLabel: string };
  capturedAt?: string;
}

interface UepNoteRow {
  note_id: string;
  text: string;
  tilt: number;
  location: string | null;
  captured_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 硬上限——與 apps/uep/src/progress/types.ts 的
 * STORAGE_NOTE_HARD_MAX／STORAGE_NOTE_TEXT_HARD_MAX 對齊，改那邊要同步。
 * 站台設定（note.max／note.textMax）的可調範圍以此為邊界。
 */
export const NOTE_HARD_MAX = 60;
export const NOTE_TEXT_HARD_MAX = 400;
const NOTE_LOCATION_LABEL_MAX = 60;
const NOTE_ID_MAX = 64;

/**
 * 逐筆驗證外部傳入的便條陣列（與客戶端 adapters.ts 的載入 sanitize
 * 同一套判準）：欄位型別齊全才留、text 截硬上限、location/capturedAt
 * 逐欄位容錯（型別不符只丟棄該欄位不丟整條）、去重 id、cap 硬上限張數。
 */
export function sanitizeNotes(raw: unknown): StorageNoteJson[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StorageNoteJson[] = [];
  for (const item of raw) {
    if (out.length >= NOTE_HARD_MAX) break;
    if (typeof item !== 'object' || item === null) continue;
    const n = item as Record<string, unknown>;
    if (
      typeof n.id !== 'string' ||
      !n.id ||
      n.id.length > NOTE_ID_MAX ||
      seen.has(n.id) ||
      typeof n.text !== 'string' ||
      typeof n.tilt !== 'number' ||
      !Number.isFinite(n.tilt) ||
      typeof n.createdAt !== 'string' ||
      typeof n.updatedAt !== 'string'
    ) {
      continue;
    }
    seen.add(n.id);
    const note: StorageNoteJson = {
      id: n.id,
      text: n.text.slice(0, NOTE_TEXT_HARD_MAX),
      tilt: n.tilt,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    };
    const loc = n.location as Record<string, unknown> | undefined;
    if (
      typeof loc === 'object' &&
      loc !== null &&
      typeof loc.zone === 'string' &&
      typeof loc.pageLabel === 'string'
    ) {
      note.location = {
        zone: loc.zone,
        pageLabel: loc.pageLabel.slice(0, NOTE_LOCATION_LABEL_MAX),
      };
    }
    if (typeof n.capturedAt === 'string') note.capturedAt = n.capturedAt;
    out.push(note);
  }
  return out;
}

function noteFromRow(row: UepNoteRow): StorageNoteJson {
  const note: StorageNoteJson = {
    id: row.note_id,
    text: row.text,
    tilt: row.tilt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.location) {
    try {
      const loc = JSON.parse(row.location) as {
        zone?: unknown;
        pageLabel?: unknown;
      };
      if (typeof loc.zone === 'string' && typeof loc.pageLabel === 'string') {
        note.location = { zone: loc.zone, pageLabel: loc.pageLabel };
      }
    } catch {
      // location 欄毀損：只丟棄小標，不丟便條本體
    }
  }
  if (row.captured_at) note.capturedAt = row.captured_at;
  return note;
}

/** 讀取使用者全部便條（保留寫入序：created_at 再 note_id 兜底） */
export async function loadNotes(
  db: D1Database,
  userId: number
): Promise<StorageNoteJson[]> {
  const result = await db
    .prepare(
      'SELECT note_id, text, tilt, location, captured_at, created_at, updated_at FROM uep_user_notes WHERE user_id = ? ORDER BY created_at, note_id'
    )
    .bind(userId)
    .all<UepNoteRow>();
  return (result.results || []).map(noteFromRow);
}

/**
 * 把便條組裝回 progress blob。blob 為 null（無進度）時回 null——
 * admin 重置會連帶清便條，正常不會出現「blob 空但表有資料」。
 * blob 內殘留的 storageNotes（尚未遷移的舊 blob）以 blob 版為準疊在
 * 表資料之上（遷移中途的過渡態，blob 才是還沒搬完的最新來源）。
 */
export function assembleProgress(
  blob: Record<string, unknown> | null,
  notes: StorageNoteJson[]
): Record<string, unknown> | null {
  if (!blob) return null;
  const legacy = sanitizeNotes(blob.storageNotes);
  if (legacy.length === 0) return { ...blob, storageNotes: notes };
  const merged = new Map<string, StorageNoteJson>();
  for (const n of notes) merged.set(n.id, n);
  for (const n of legacy) merged.set(n.id, n);
  return { ...blob, storageNotes: [...merged.values()] };
}

/** 從 blob 移除 storageNotes 欄位（回新物件，不動原物件） */
export function stripNotes(
  blob: Record<string, unknown>
): Record<string, unknown> {
  const { storageNotes: _dropped, ...rest } = blob;
  return rest;
}

/**
 * 產出便條差分同步的 SQL 陳述式（供 db.batch 使用）。
 *
 * 只寫有變化的：既有列逐筆比對（欄位齊全比對，不能只看 updatedAt——
 * setStorageNoteLocation／setStorageNoteCapturedAt 不會更新 updatedAt），
 * incoming 缺席的列刪除。全部相同時回空陣列（掃描線 marker 觸發的
 * 高頻 PUT 不該對便條表產生任何寫入）。
 *
 * `guard` 給讀者端 PUT 用：每條陳述式都掛
 * `EXISTS(progress_rev = 讀取時的值)`，與 blob 更新的 CAS 同一批
 * db.batch（batch 具交易性）——rev 已被別人推進時整批便條寫入一起
 * no-op，不會出現「表反映輸家、blob 反映贏家」的撕裂。
 * admin 路徑自己會遞增 rev、且沒有並發競爭語意，傳 null 跳過守門。
 */
export function buildNoteSyncStatements(
  db: D1Database,
  userId: number,
  incoming: StorageNoteJson[],
  existing: StorageNoteJson[],
  guard: { rev: number } | null
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const incomingIds = new Set(incoming.map((n) => n.id));
  const existingMap = new Map(existing.map((n) => [n.id, n]));

  const guardSql = guard
    ? ' AND EXISTS (SELECT 1 FROM uep_users WHERE id = ? AND progress_rev = ?)'
    : '';
  const guardValues = guard ? [userId, guard.rev] : [];

  for (const old of existing) {
    if (incomingIds.has(old.id)) continue;
    statements.push(
      db
        .prepare(
          `DELETE FROM uep_user_notes WHERE user_id = ? AND note_id = ?${guardSql}`
        )
        .bind(userId, old.id, ...guardValues)
    );
  }

  for (const note of incoming) {
    const prev = existingMap.get(note.id);
    if (prev && JSON.stringify(prev) === JSON.stringify(note)) continue;
    const insertGuard = guard
      ? ' WHERE EXISTS (SELECT 1 FROM uep_users WHERE id = ? AND progress_rev = ?)'
      : '';
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO uep_user_notes (user_id, note_id, text, tilt, location, captured_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?${insertGuard}`
        )
        .bind(
          userId,
          note.id,
          note.text,
          note.tilt,
          note.location ? JSON.stringify(note.location) : null,
          note.capturedAt ?? null,
          note.createdAt,
          note.updatedAt,
          ...guardValues
        )
    );
  }

  return statements;
}
