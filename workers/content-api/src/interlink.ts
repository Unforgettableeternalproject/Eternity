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
  const checker = await createKeyConflictChecker(db, [query.area]);
  return checker.find(query);
}

/** 預載索引後可重複查詢的撞名檢查器（見 `createKeyConflictChecker`） */
export interface KeyConflictChecker {
  find(query: KeyConflictQuery): Promise<KeyConflict | null>;
}

/**
 * 建立撞名檢查器：先把需要的 area 索引各掃一次，之後每次查詢都在
 * 記憶體比對。
 *
 * 存在理由是批次寫入路徑（`/api/content/sync/import` 一次幾百頁）：
 * 逐頁呼叫 `findKeyConflict` 等於每頁重掃一次全 area，頁數一多就是
 * O(頁數 × 全表)。單頁存檔仍直接用 `findKeyConflict`，語意不變。
 *
 * `includeHidden` 一律為 true——hidden 只是不在前台列表顯示，key 本身
 * 仍是有效的引用目標（echo spot / visual clue 的 by-id 反查刻意不排除
 * hidden）。撞名檢查若看不到隱藏頁，兩首隱藏歌就能共用同一個 key 而
 * 無人攔阻，而且是無聲失效。Visuals 現況超過半數 gallery 是 hidden。
 */
export async function createKeyConflictChecker(
  db: D1Database,
  areas: Iterable<KeyConflictQuery['area']>
): Promise<KeyConflictChecker> {
  const wanted = new Set(areas);
  const concepts = wanted.has('concepts')
    ? await buildConceptsEntityIndex(db)
    : [];
  const echoes = wanted.has('echoes')
    ? await buildEchoesEntityIndex(db, { includeHidden: true })
    : [];
  const visuals = wanted.has('visuals')
    ? await buildVisualsEntityIndex(db, { includeHidden: true })
    : [];

  return {
    async find(query: KeyConflictQuery): Promise<KeyConflict | null> {
      const { keyType, keyValue, area, scope, excludePageId } = query;
      if (!keyValue) return null;

      if (area === 'concepts') {
        // storyKey 命名空間不含 Concepts（劇情點只掛 Echoes 歌／Visuals
        // 插圖／History 錨點），故 story 類型在此永遠無衝突
        if (keyType === 'story') return null;

        const hit = concepts.find(
          (e) =>
            e.entityKey === keyValue &&
            e.pageId !== excludePageId &&
            conceptsScope(e.stack, e.variantId) === scope
        );
        return hit ? { pageId: hit.pageId, pageTitle: hit.pageTitle } : null;
      }

      // Echoes / Visuals：整個區塊一個實例
      const entries = area === 'echoes' ? echoes : visuals;
      const hit = entries.find((e) => {
        if (e.id === excludePageId) return false;
        return keyType === 'entity'
          ? e.entityKey === keyValue
          : e.storyKey === keyValue;
      });
      if (!hit) return null;
      return { pageId: hit.id, pageTitle: await fetchPageTitle(db, hit.id) };
    },
  };
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
 * 找出同一批候選中自己撞名的那一筆（回傳第二次出現者）。
 *
 * `findKeyConflict` 只能發現「別的頁面已經用了這個 key」——它以
 * `excludePageId` 排除整個當前頁，同一次存檔的內容裡塞兩個相同的
 * Concepts 條目 key 對它是完全隱形的，新建頁面更是連 DB 記錄都還沒有。
 * 結果就是違規資料被永久保存下來，而且之後每次存檔都同樣通過。
 *
 * 前端 `collectEntityKeyIssues` 會即時警告，但那是提示不是約束——
 * 直接打 API、批次匯入、或前端驗證範圍不完整時都繞得過去。
 *
 * 指紋以 `|` 分隔：scope 本身含 `:`（`dossier:{variantId}`），若拿 `:`
 * 之類會出現在值裡的字元當分隔，不同的 (scope, key) 組合會撞出同一個
 * 指紋。key 受 ENTITY_KEY_PATTERN 約束（kebab-case），不含 `|`。
 */
export function findDuplicateCandidate(
  candidates: KeyCandidate[]
): KeyCandidate | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const fingerprint = [
      candidate.keyType,
      candidate.scope,
      candidate.keyValue,
    ].join('|');
    if (seen.has(fingerprint)) return candidate;
    seen.add(fingerprint);
  }
  return null;
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
 * D1 batch 的分塊大小。
 *
 * 一次匯入可能是幾百頁 × 每頁數個錨點，全部塞進單一 batch 會讓請求
 * 體積失控（Workers 有請求大小與 CPU 時間上限）。分塊之間不共用交易，
 * 但每一塊仍是「先刪該頁、再插該頁」的完整單位，中斷時最壞情況是
 * 後面幾頁尚未重建——重跑一次即收斂（重建本身冪等）。
 */
const INTERLINK_BATCH_CHUNK = 50;

/**
 * 批次重建多頁的反向索引（匯入 / backfill 用）。
 *
 * 與逐頁呼叫 `rebuildHistoryInterlinkIndex` 的差別只有往返次數：
 * 語意、冪等性、DELETE+INSERT 的順序都完全相同。
 */
export async function rebuildHistoryInterlinkIndexBatch(
  db: D1Database,
  pages: { pageId: string; content: unknown }[]
): Promise<number> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let anchorCount = 0;

  for (const page of pages) {
    statements.push(
      db
        .prepare(`DELETE FROM history_interlink_index WHERE page_id = ?`)
        .bind(page.pageId)
    );
    for (const anchor of scanHistoryInterlinkAnchors(page.content)) {
      anchorCount += 1;
      statements.push(
        db
          .prepare(
            `INSERT INTO history_interlink_index
               (page_id, anchor_kind, anchor_id, key_type, key_value, label, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            page.pageId,
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
  }

  for (let i = 0; i < statements.length; i += INTERLINK_BATCH_CHUNK) {
    await db.batch(statements.slice(i, i + INTERLINK_BATCH_CHUNK));
  }
  return anchorCount;
}

/**
 * 掃描全部 History 頁重建反向索引（migration 0022 的資料補建）。
 *
 * migration 只建了空表——套用之後既有文章的錨點一筆都查不到，觸發模型
 * 對所有舊內容靜默失效（沒有錯誤、只是永遠沒有線索卡）。backfill 不能
 * 寫在 SQL migration 裡：錨點藏在 `content` 的 TipTap JSON 結構中，
 * 需要 `scanHistoryInterlinkAnchors` 逐頁解析。
 *
 * 冪等：每頁都是整頁 DELETE + INSERT，重跑不會累積重複列。
 */
export async function backfillHistoryInterlinkIndex(
  db: D1Database
): Promise<{ pages: number; anchors: number }> {
  const result = await db
    .prepare(
      `SELECT id, content FROM pages
       WHERE area = 'history' AND deleted_at IS NULL`
    )
    .all<{ id: string; content: string }>();

  const pages = (result.results || []).map((row) => {
    let content: unknown = [];
    try {
      content = JSON.parse(row.content || '[]');
    } catch {
      // 壞 JSON 視為無錨點——照樣清掉該頁殘留的索引列
    }
    return { pageId: row.id, content };
  });

  const anchors = await rebuildHistoryInterlinkIndexBatch(db, pages);
  return { pages: pages.length, anchors };
}

/**
 * 掃描全站 key 補建 `interlink_keys` 殼列（migration 0023 的另一半）。
 *
 * 殼列平常只在存檔路徑建立，所以 migration 之前就存在的 key——或是由
 * 遷移腳本直接改寫 metadata 產生的 key——永遠不會有殼列，管理 UI 會
 * 看到空清單。
 *
 * 掃描範圍涵蓋三個 zone：Concepts 條目的 entityKey、Echoes 與 Visuals
 * 的 entityKey 與 storyKey。`INSERT OR IGNORE` 保證不覆蓋既有的標題／
 * 說明，可重複執行。
 */
export async function backfillInterlinkKeys(
  db: D1Database
): Promise<{ storyKeys: number; entityKeys: number }> {
  const [concepts, echoes, visuals] = await Promise.all([
    buildConceptsEntityIndex(db),
    buildEchoesEntityIndex(db, { includeHidden: true }),
    buildVisualsEntityIndex(db, { includeHidden: true }),
  ]);

  const candidates: KeyCandidate[] = [];
  const push = (keyType: 'entity' | 'story', keyValue?: string) => {
    if (!keyValue) return;
    candidates.push({
      keyType,
      keyValue,
      scope: ZONE_SCOPE,
      field: keyType === 'story' ? 'storyKey' : 'entityKey',
    });
  };

  for (const entry of concepts) push('entity', entry.entityKey);
  for (const entry of [...echoes, ...visuals]) {
    push('entity', entry.entityKey);
    push('story', entry.storyKey);
  }

  await ensureInterlinkKeys(db, candidates);
  const count = (keyType: 'entity' | 'story') =>
    new Set(
      candidates.filter((c) => c.keyType === keyType).map((c) => c.keyValue)
    ).size;
  return { storyKeys: count('story'), entityKeys: count('entity') };
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

/** key 的標題／說明（entity 的 title 恆為 NULL，見 `ensureInterlinkKeys`） */
export interface InterlinkKeyMeta {
  title: string | null;
  description: string | null;
}

/** 查單一 key 的標題／說明；查無殼列回 `null` */
export async function findInterlinkKeyMeta(
  db: D1Database,
  keyType: 'entity' | 'story',
  keyValue: string
): Promise<InterlinkKeyMeta | null> {
  const row = await db
    .prepare(
      `SELECT title, description FROM interlink_keys
       WHERE key_type = ? AND key_value = ?`
    )
    .bind(keyType, keyValue)
    .first<InterlinkKeyMeta>();
  return row ?? null;
}

/** 管理清單的單筆 key */
export interface InterlinkKeyListRow {
  keyType: 'entity' | 'story';
  keyValue: string;
  title: string | null;
  description: string | null;
  /**
   * 殼列的最後更新時間；沒有殼列時為 null。
   * `pnpm sync` 用它比對兩端誰較新。
   */
  updatedAt: string | null;
  /**
   * entity 的權威顯示名稱（Concepts 條目的 name）。表裡不存，每次現查——
   * 存下來就會與 dossier 形成兩份會各自漂移的名字。
   */
  derivedName?: string;
  /** 定義端筆數：有幾個地方宣告了這個 key */
  definitionCount: number;
  /** 錨點端筆數：History 內容裡有幾處引用 */
  anchorCount: number;
}

/**
 * 列出全站 key 的管理清單。
 *
 * 三路聯集，缺一不可：
 * - 只看定義端 → 漏掉「定義已刪但說明還在」與「只在 History 被引用過」
 * - 只看殼列表 → 漏掉「有定義但還沒建殼」（遷移腳本直接改 metadata
 *   產生的 key 就是這種，殼列平常只在存檔路徑建立）
 * - 只看錨點端 → 漏掉所有還沒被 History 引用的 key
 */
export async function listInterlinkKeys(
  db: D1Database
): Promise<InterlinkKeyListRow[]> {
  const rows = new Map<string, InterlinkKeyListRow>();
  const touch = (
    keyType: 'entity' | 'story',
    keyValue: string
  ): InterlinkKeyListRow => {
    const mapKey = JSON.stringify([keyType, keyValue]);
    let row = rows.get(mapKey);
    if (!row) {
      row = {
        keyType,
        keyValue,
        title: null,
        description: null,
        updatedAt: null,
        definitionCount: 0,
        anchorCount: 0,
      };
      rows.set(mapKey, row);
    }
    return row;
  };

  // ---- 定義端（live-scan，含 hidden：管理者要看到全部）----
  const [concepts, echoes, visuals] = await Promise.all([
    buildConceptsEntityIndex(db),
    buildEchoesEntityIndex(db, { includeHidden: true }),
    buildVisualsEntityIndex(db, { includeHidden: true }),
  ]);

  for (const entry of concepts) {
    if (!entry.entityKey) continue;
    const row = touch('entity', entry.entityKey);
    row.definitionCount += 1;
    // 同一個 entity 可能橫跨多個 stack，取第一個有名字的當顯示名
    if (!row.derivedName && entry.name) row.derivedName = entry.name;
  }
  for (const entry of [...echoes, ...visuals]) {
    if (entry.entityKey) touch('entity', entry.entityKey).definitionCount += 1;
    if (entry.storyKey) touch('story', entry.storyKey).definitionCount += 1;
  }

  // ---- 錨點端（讀表，排除軟刪除頁的孤兒列）----
  const anchors = await db
    .prepare(
      `SELECT i.key_type AS keyType, i.key_value AS keyValue, COUNT(*) AS cnt
       FROM history_interlink_index i
       JOIN pages p ON p.id = i.page_id
       WHERE p.deleted_at IS NULL
       GROUP BY i.key_type, i.key_value`
    )
    .all<{ keyType: 'entity' | 'story'; keyValue: string; cnt: number }>();
  for (const anchor of anchors.results || []) {
    touch(anchor.keyType, anchor.keyValue).anchorCount = anchor.cnt;
  }

  // ---- 殼列的標題／說明 ----
  const metas = await db
    .prepare(
      `SELECT key_type AS keyType, key_value AS keyValue, title, description,
              updated_at AS updatedAt
       FROM interlink_keys`
    )
    .all<{
      keyType: 'entity' | 'story';
      keyValue: string;
      title: string | null;
      description: string | null;
      updatedAt: string;
    }>();
  for (const meta of metas.results || []) {
    const row = touch(meta.keyType, meta.keyValue);
    row.title = meta.title;
    row.description = meta.description;
    row.updatedAt = meta.updatedAt;
  }

  return [...rows.values()].sort(
    (a, b) =>
      a.keyType.localeCompare(b.keyType) || a.keyValue.localeCompare(b.keyValue)
  );
}

/**
 * 巡查：劇情歌（`metadata.category === 'story'`，與 echoes-song.ts 的
 * songType 對映同一來源）但沒綁 storyKey 的頁。
 *
 * 這些頁在 `buildEchoesEntityIndex` 會被整個跳過（無 key 的頁不進 index），
 * 所以不能從 keys 清單推得，要另掃。判定在 JS 不在 SQL——json_extract
 * 對字串值的比對已在 S10-1 A 段確認是地雷（0.9.15.1）。
 */
export async function findStorySongsWithoutKey(
  db: D1Database
): Promise<{ pageId: string; title: string }[]> {
  const rows = await db
    .prepare(
      `SELECT id, title, metadata FROM pages
       WHERE area = 'echoes' AND deleted_at IS NULL`
    )
    .all<{ id: string; title: string; metadata: string }>();

  const issues: { pageId: string; title: string }[] = [];
  for (const row of rows.results || []) {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(row.metadata || '{}');
    } catch {
      continue;
    }
    const hasStoryKey =
      typeof meta.storyKey === 'string' && meta.storyKey.trim().length > 0;
    if (meta.category === 'story' && !hasStoryKey) {
      issues.push({ pageId: row.id, title: row.title });
    }
  }
  return issues;
}

/** 空字串與純空白視為「沒有內容」，統一收斂成 NULL */
function normalizeMetaText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 更新 key 的標題／說明；殼列不存在就一併建立。
 *
 * PUT 語意：未提供的欄位視為清空，不是「保持原值」。
 *
 * ⚠️ `keyType === 'entity'` 時 `title` 一律寫成 NULL，即使請求體帶了值。
 * entity 的權威名稱在 Concepts dossier 條目上，讓這張表也能存一份
 * 就是製造兩個會各自漂移的名字。這條在資料層擋，不靠前端自律。
 */
export async function updateInterlinkKeyMeta(
  db: D1Database,
  keyType: 'entity' | 'story',
  keyValue: string,
  patch: { title?: unknown; description?: unknown; updatedAt?: unknown }
): Promise<InterlinkKeyMeta> {
  const title = keyType === 'entity' ? null : normalizeMetaText(patch.title);
  const description = normalizeMetaText(patch.description);
  // 同步時保留來源端時間戳，否則被推過去的那筆立刻變「較新」，
  // 下一次同步又反向覆蓋回來，兩端永遠互相推翻
  const stamp =
    typeof patch.updatedAt === 'string' &&
    patch.updatedAt.trim() &&
    !Number.isNaN(Date.parse(patch.updatedAt))
      ? patch.updatedAt.trim()
      : new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO interlink_keys
         (key_type, key_value, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key_type, key_value) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         updated_at = excluded.updated_at`
    )
    .bind(keyType, keyValue, title, description, stamp, stamp)
    .run();

  return { title, description };
}

/**
 * 為候選 key 建立 `interlink_keys` 殼列（entity 與 story 都建）。
 *
 * 存檔路徑先建殼，管理 UI 才能直接 UPDATE，不必再設計一套「首次建檔」
 * 邏輯。`INSERT OR IGNORE` 保證重複存檔不會覆蓋已填好的標題／說明。
 *
 * title 一律建成 NULL：story 的標題由管理者填，entity 的權威名稱在
 * Concepts dossier 條目上，這張表永遠不該持有 entity 的名字。
 */
export async function ensureInterlinkKeys(
  db: D1Database,
  candidates: KeyCandidate[]
): Promise<void> {
  // 去重的 map key 用 JSON 陣列而非字串串接：keyValue 的字元集沒有保證，
  // 任何分隔符都可能出現在值本身而讓兩組不同的 (type, value) 撞成同一把 key
  const seen = new Map<string, KeyCandidate>();
  for (const candidate of candidates) {
    if (!candidate.keyValue) continue;
    seen.set(
      JSON.stringify([candidate.keyType, candidate.keyValue]),
      candidate
    );
  }
  if (seen.size === 0) return;

  const now = new Date().toISOString();
  await db.batch(
    [...seen.values()].map((candidate) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO interlink_keys
             (key_type, key_value, title, description, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, ?, ?)`
        )
        .bind(candidate.keyType, candidate.keyValue, now, now)
    )
  );
}
