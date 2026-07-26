/**
 * interlink.ts — 跨區互聯的 key 唯一性把關（Epic 2 S10-1）
 *
 * 設計依據：docs/agent/S10_INTERLINK_DESIGN.md §3
 *
 * 唯一性判斷刻意**不落地成同步表**，而是存檔當下即時 live-scan：
 * 多一份需要保持同步的衍生資料就多一種資料飄移風險（某條寫入路徑忘記
 * 同步、或既有路徑被重構時漏改，表就會悄悄與 pages.metadata 脫節，且
 * 沒有自我修復機制）。live-scan 每次都讀 pages 現況，天生不會過期，
 * 也讓「軟刪除後 key 自動釋放」不需要任何額外程式碼。
 */

import {
  buildConceptsEntityIndex,
  collectConceptsKeyCandidates,
} from './concepts-index';
import { buildEchoesEntityIndex } from './echoes-index';
import { scanHistoryInterlinkAnchors } from './history-interlink';
import { buildVisualsEntityIndex } from './visuals-index';

/** 唯一性衝突檢查的請求形狀 */
export interface KeyConflictQuery {
  keyType: 'entity' | 'story';
  keyValue: string;
  area: 'concepts' | 'echoes' | 'visuals';
  /** 見 `conceptsScope()`／Echoes 與 Visuals 固定 `'zone'` */
  scope: string;
  /** 排除自身——更新既有頁面時，同一個 key 出現在自己身上不算衝突 */
  excludePageId: string;
}

/** 衝突方的頁面資訊（供錯誤訊息指路） */
export interface KeyConflict {
  pageId: string;
  pageTitle: string;
}

/** Echoes / Visuals 的 scope：整個區塊一個實例，沒有更細的分區 */
export const ZONE_SCOPE = 'zone';

/**
 * Concepts 條目的唯一性範圍。
 *
 * 艾斯維爾 2026-07-26 裁定「Concepts＝每個 stack 內一次」，且明確要求
 * **跨頁**生效——records 容器底下的 character_list / location_list /
 * invera / hostile_creatures 四頁同屬 dossier，同一個 key 在其中兩頁
 * 出現就算違規（現有前端驗證只看單頁，抓不到，正是 S10-1 要補的缺口）。
 *
 * dossier 額外以 variantId 分區：dossier 的 variants 是「同一份檔案的
 * 不同時代版本」，同一個實體本來就必然在多個 variant 各有一條——這是
 * S7 revision 系統的核心設計。若 dossier 也用整個 stack 當範圍，等於
 * 禁止一個角色擁有多個時代的檔案，與產品語意直接衝突。browser /
 * chrono / diff 沒有 variant 概念，範圍就是整個 stack。
 *
 * （設計文件 §3-1 的型別註解把 browser/chrono/diff 寫成 `'{stack}:{pageId}'`，
 * 與同文件 §3-3「要從單頁修成跨頁同 stack」的敘述互相矛盾；此處依艾斯維爾
 * 的裁定與 §3-3 的修正方向採跨頁範圍。）
 */
export function conceptsScope(stack: string, variantId?: string): string {
  return stack === 'dossier' ? `dossier:${variantId ?? ''}` : stack;
}

/** 取頁面標題（只在確認衝突後才查，正常存檔路徑不付這個成本） */
async function fetchPageTitle(db: D1Database, pageId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT title FROM pages WHERE id = ?`)
    .bind(pageId)
    .first<{ title: string }>();
  return row?.title ?? pageId;
}

/**
 * 檢查某個 key 在指定範圍內是否已被別的頁面使用。
 *
 * 回傳 `null` = 無衝突；否則帶出衝突方頁面資訊。
 *
 * 跨 zone 撞名**完全允許**（那正是互聯的基礎——`xavier-colsono` 目前
 * 同時存在於 Concepts 兩個 stack、Echoes 一首歌、Visuals 一個 gallery），
 * 故本函式只在單一 area 內比對，呼叫端也不該跨 area 反覆呼叫。
 */
export async function findKeyConflict(
  db: D1Database,
  query: KeyConflictQuery
): Promise<KeyConflict | null> {
  const { keyType, keyValue, area, scope, excludePageId } = query;
  if (!keyValue) return null;

  if (area === 'concepts') {
    // storyKey 命名空間不含 Concepts（劇情點只掛 Echoes 歌／Visuals 插圖／
    // History 錨點），故 story 類型在此永遠無衝突
    if (keyType === 'story') return null;

    const entries = await buildConceptsEntityIndex(db);
    const hit = entries.find(
      (e) =>
        e.entityKey === keyValue &&
        e.pageId !== excludePageId &&
        conceptsScope(e.stack, e.variantId) === scope
    );
    return hit ? { pageId: hit.pageId, pageTitle: hit.pageTitle } : null;
  }

  // Echoes / Visuals：整個區塊一個實例。
  //
  // includeHidden 必須為 true——hidden 只是不在前台列表顯示，key 本身
  // 仍是有效的引用目標（echo spot / visual clue 的 by-id 反查刻意不排除
  // hidden）。撞名檢查若看不到隱藏頁，兩首隱藏歌就能共用同一個 key 而
  // 無人攔阻，而且是無聲失效。Visuals 現況超過半數 gallery 是 hidden。
  const entries =
    area === 'echoes'
      ? await buildEchoesEntityIndex(db, { includeHidden: true })
      : await buildVisualsEntityIndex(db, { includeHidden: true });

  const hit = entries.find((e) => {
    if (e.id === excludePageId) return false;
    return keyType === 'entity'
      ? e.entityKey === keyValue
      : e.storyKey === keyValue;
  });
  if (!hit) return null;
  return { pageId: hit.id, pageTitle: await fetchPageTitle(db, hit.id) };
}

// ──────────────────────────────────────────────────────────────
//  存檔路徑：候選 key 抽取
// ──────────────────────────────────────────────────────────────

/** 待檢查的單一 key 候選（附帶給使用者看的欄位名） */
export interface KeyCandidate {
  keyType: 'entity' | 'story';
  keyValue: string;
  scope: string;
  /** 錯誤訊息用的欄位名稱（entityKey / storyKey） */
  field: string;
}

/** 存檔請求中與 key 相關的部分 */
interface KeyBearingBody {
  metadata?: Record<string, unknown> | null;
  content?: unknown;
}

/**
 * 從存檔請求抽出所有需要做唯一性檢查的 key。
 *
 * Echoes/Visuals 一頁最多一個 key（metadata 上的平鋪欄位）；Concepts
 * 一頁可能巢狀出多個（四種 stack 形狀），交給 `collectConceptsKeyCandidates`。
 *
 * 只在 `metadata` 有出現在請求中時才抽 Echoes/Visuals 的 key——PUT 支援
 * 部分更新，沒帶 metadata 就代表這次不動 key，不該拿舊值重新檢查
 * （尤其「更新自己」在排除自身後本來就不會衝突，但沒必要多跑一次掃描）。
 */
export function extractCandidateKeys(
  area: string,
  body: KeyBearingBody
): KeyCandidate[] {
  if (area === 'concepts') {
    if (body.content === undefined) return [];
    return collectConceptsKeyCandidates(body.content, body.metadata).map(
      (candidate) => ({
        keyType: 'entity' as const,
        keyValue: candidate.entityKey,
        scope: conceptsScope(candidate.stack, candidate.variantId),
        field: 'entityKey',
      })
    );
  }

  if (area !== 'echoes' && area !== 'visuals') return [];
  if (!body.metadata) return [];

  const out: KeyCandidate[] = [];
  const entityKey = body.metadata.entityKey;
  if (typeof entityKey === 'string' && entityKey.trim()) {
    out.push({
      keyType: 'entity',
      keyValue: entityKey.trim(),
      scope: ZONE_SCOPE,
      field: 'entityKey',
    });
  }
  const storyKey = body.metadata.storyKey;
  if (typeof storyKey === 'string' && storyKey.trim()) {
    out.push({
      keyType: 'story',
      keyValue: storyKey.trim(),
      scope: ZONE_SCOPE,
      field: 'storyKey',
    });
  }
  return out;
}

/**
 * 重建單一 History 頁的反向索引。
 *
 * 整頁 DELETE + INSERT，不做逐條 diff——單頁標記數量是個位數到十幾個
 * 量級，全量重建的成本遠低於維護 diff 邏輯的複雜度，而且天然冪等：
 * 同一份內容重複存檔會產生完全相同的列。
 *
 * `db.batch()` 保證 DELETE 與 INSERT 在同一個隱含交易內完成，不會出現
 * 「刪了但插入失敗」的半殘狀態（沿 `reindexChildren` 的既有手法）。
 */
export async function rebuildHistoryInterlinkIndex(
  db: D1Database,
  pageId: string,
  content: unknown
): Promise<void> {
  const anchors = scanHistoryInterlinkAnchors(content);
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [
    db
      .prepare(`DELETE FROM history_interlink_index WHERE page_id = ?`)
      .bind(pageId),
  ];
  for (const anchor of anchors) {
    statements.push(
      db
        .prepare(
          `INSERT INTO history_interlink_index
             (page_id, anchor_kind, anchor_id, key_type, key_value, label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          pageId,
          anchor.anchorKind,
          anchor.anchorId,
          anchor.keyType,
          anchor.keyValue,
          anchor.label,
          now,
          now
        )
    );
  }
  await db.batch(statements);
}

/**
 * 清空單一 History 頁的反向索引（軟刪除時呼叫）。
 *
 * 不清的話，已刪除文章的錨點會繼續出現在反查結果裡，把讀者導向
 * 一個不存在的頁面。
 */
export async function clearHistoryInterlinkIndex(
  db: D1Database,
  pageId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM history_interlink_index WHERE page_id = ?`)
    .bind(pageId)
    .run();
}

// ──────────────────────────────────────────────────────────────
//  查詢：反查某個 key 的 History 錨點 / 完整使用狀況
// ──────────────────────────────────────────────────────────────

/** `/api/interlink/anchors` 的單筆錨點 */
export interface InterlinkAnchorRow {
  pageId: string;
  pageTitle: string;
  anchorKind: string;
  anchorId: string | null;
  label: string | null;
}

/**
 * 查某個 key 在 History 有哪些錨點（觸發模型的資料來源）。
 *
 * 走 `idx_hii_key` 索引；join `pages` 取現行標題，並排除已軟刪除的頁面——
 * 索引清理掛在軟刪除路徑上，但直接改 DB 或舊資料仍可能留下孤兒列，
 * 這裡再擋一層。
 */
export async function findInterlinkAnchors(
  db: D1Database,
  keyType: 'entity' | 'story',
  keyValue: string
): Promise<InterlinkAnchorRow[]> {
  const result = await db
    .prepare(
      `SELECT i.page_id AS pageId, p.title AS pageTitle,
              i.anchor_kind AS anchorKind, i.anchor_id AS anchorId, i.label
       FROM history_interlink_index i
       JOIN pages p ON p.id = i.page_id
       WHERE i.key_type = ? AND i.key_value = ? AND p.deleted_at IS NULL
       ORDER BY p.sort_order ASC, i.id ASC`
    )
    .bind(keyType, keyValue)
    .all<InterlinkAnchorRow>();
  return result.results || [];
}

/** `/api/interlink/usage` 的定義端單筆 */
export interface InterlinkDefinitionRow {
  area: 'concepts' | 'echoes' | 'visuals';
  pageId: string;
  pageTitle: string;
  /** Concepts 才有意義，其餘固定 `'zone'` */
  scope: string;
}

/**
 * 查某個 key 的**定義端**（誰宣告了這個 key）。
 *
 * 與錨點端不同，這裡是 live-scan 現查而非讀表——理由同 `findKeyConflict`：
 * 定義散在各 zone 的 metadata / 結構化內容裡，掃描結果永遠是當下真相，
 * 不需要維護一份會過期的衍生資料。
 *
 * 這裡刻意不排除 hidden：反查管理 UI 要看到全部使用位置，包括隱藏頁，
 * 否則「這個 key 用在哪」會漏掉一半（Visuals 超過半數 gallery 是 hidden）。
 */
export async function findInterlinkDefinitions(
  db: D1Database,
  keyType: 'entity' | 'story',
  keyValue: string
): Promise<InterlinkDefinitionRow[]> {
  const out: InterlinkDefinitionRow[] = [];

  if (keyType === 'entity') {
    for (const entry of await buildConceptsEntityIndex(db)) {
      if (entry.entityKey !== keyValue) continue;
      out.push({
        area: 'concepts',
        pageId: entry.pageId,
        pageTitle: entry.pageTitle,
        scope: conceptsScope(entry.stack, entry.variantId),
      });
    }
  }

  const echoes = await buildEchoesEntityIndex(db, { includeHidden: true });
  const visuals = await buildVisualsEntityIndex(db, { includeHidden: true });
  const matches = (entry: { entityKey?: string; storyKey?: string }) =>
    keyType === 'entity'
      ? entry.entityKey === keyValue
      : entry.storyKey === keyValue;

  for (const [area, entries] of [
    ['echoes', echoes],
    ['visuals', visuals],
  ] as const) {
    for (const entry of entries) {
      if (!matches(entry)) continue;
      out.push({
        area,
        pageId: entry.id,
        pageTitle: await fetchPageTitle(db, entry.id),
        scope: ZONE_SCOPE,
      });
    }
  }

  return out;
}

/** 劇情點的標題／說明（S10-1 全程為 NULL，S10-3 才有編輯 UI） */
export async function findStoryPoint(
  db: D1Database,
  storyKey: string
): Promise<{ title: string | null; description: string | null } | null> {
  const row = await db
    .prepare(`SELECT title, description FROM story_points WHERE story_key = ?`)
    .bind(storyKey)
    .first<{ title: string | null; description: string | null }>();
  return row ?? null;
}

/**
 * 為候選 key 中的 storyKey 建立 `story_points` 殼列。
 *
 * S10-1 全程不寫 title/description（編輯 UI 屬 S10-3），先建殼是為了讓
 * S10-3 直接 UPDATE，不必再設計一套「首次建檔」邏輯。`INSERT OR IGNORE`
 * 保證重複存檔不會覆蓋 S10-3 之後填進去的內容。
 */
export async function ensureStoryPoints(
  db: D1Database,
  candidates: KeyCandidate[]
): Promise<void> {
  const storyKeys = [
    ...new Set(
      candidates.filter((c) => c.keyType === 'story').map((c) => c.keyValue)
    ),
  ];
  if (storyKeys.length === 0) return;

  const now = new Date().toISOString();
  await db.batch(
    storyKeys.map((key) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO story_points
             (story_key, title, description, created_at, updated_at)
           VALUES (?, NULL, NULL, ?, ?)`
        )
        .bind(key, now, now)
    )
  );
}
