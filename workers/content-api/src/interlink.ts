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

import { buildConceptsEntityIndex } from './concepts-index';
import { buildEchoesEntityIndex } from './echoes-index';
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
