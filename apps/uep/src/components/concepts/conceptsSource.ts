/**
 * conceptsSource — Concepts 條目索引與頁面資料（單一載入來源）
 *
 * ## 為什麼要集中
 *
 * 索引（`GET /api/concepts/entity-index`）與整頁 JSON
 * （`GET /api/content/{pageId}`）原本在兩個地方各有一份逐行相同的實作
 * 與快取：`islands/concepts/terminalCore`（Terminal 島查詢核心）與
 * `components/concepts/entityBinding`（entity 綁定求值）。
 *
 * 當初的判斷是「重複一次 fetch 的代價遠低於依賴倒置」，那在**只有點擊
 * 時才求值**的前提下成立。但嵌入的可點判定必須與綁定求值走同一套邏輯
 * （否則會出現「看起來可點、按了沒反應」），求值就得在渲染時預先發生
 * ——此時兩份快取會讓索引與 N 個 dossier 頁全部請求翻倍。
 *
 * 放在 components 層而非 islands：islands 可以 import components，
 * 反過來不行；兩邊的消費端都在，方向只有這一種選擇。
 */

import { getApiBase } from '../../lib/apiBase';

import type { GateCondition } from '../../progress/gating';
import type { ConceptsData } from './types';

const API_BASE = getApiBase();

/** Concepts 四種 stack */
export type ConceptsStack = 'dossier' | 'browser' | 'chrono' | 'diff';

/** 索引端點的單筆條目摘要（Worker EntityIndexEntry 的前端鏡像） */
export interface ConceptsIndexEntry {
  name: string;
  stack: ConceptsStack;
  pageId: string;
  pageTitle: string;
  entityKey?: string;
  /** 匹配別名（query／補全的補充匹配詞） */
  aliases?: string[];
  /** base 解鎖條件（條目可見性的唯一閘門，未設 = 永遠可見） */
  baseGate?: GateCondition | null;
  /** 群組解鎖條件（dossier 群組層，未過整組隱藏） */
  groupGate?: GateCondition | null;
  /** revision gate 摘要——只供更動通知水位，不影響可見性 */
  revisionGates?: { id: string; gate: GateCondition | null }[];
  /** 分類標籤（dossier=subcategory、diff=subcat）——ls 分組用 */
  category?: string;
  /** 群組標籤（dossier=group、diff=section） */
  group?: string;
  /** dossier variant id（era，如 'u'） */
  variantId?: string;
  /** chrono period 事件總數（ls clock 顯著時代排序用） */
  eventCount?: number;
}

let indexCache: Promise<ConceptsIndexEntry[]> | null = null;
const pageCache = new Map<string, Promise<ConceptsData | null>>();

/** 載入條目索引（模組級快取；失敗時清快取讓下次重試） */
export function loadConceptsIndex(): Promise<ConceptsIndexEntry[]> {
  if (!indexCache) {
    indexCache = (async () => {
      const res = await fetch(`${API_BASE}/api/concepts/entity-index`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { entries?: ConceptsIndexEntry[] };
        error?: string;
      };
      if (!json.ok) throw new Error(json.error || 'API returned ok=false');
      return json.data?.entries || [];
    })().catch((err) => {
      indexCache = null;
      throw err;
    });
  }
  return indexCache;
}

/**
 * 抓取單頁 Concepts 結構化資料（模組級快取）。
 *
 * 取第一個非 `rich_text` 的 block——四種 stack 的結構化資料各自有自己的
 * block type，但一頁只會有一個。失敗與壞 JSON 一律回 `null`（呼叫端各自
 * 決定是容錯還是 fail closed）。
 */
export function loadConceptsPage(pageId: string): Promise<ConceptsData | null> {
  let cached = pageCache.get(pageId);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(`${API_BASE}/api/content/${pageId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        ok: boolean;
        data?: { content?: { type: string; content: string }[] };
      };
      if (!json.ok) return null;
      const block = (json.data?.content || []).find(
        (b) => b && b.type !== 'rich_text'
      );
      if (!block || typeof block.content !== 'string') return null;
      try {
        return JSON.parse(block.content) as ConceptsData;
      } catch {
        return null;
      }
    })().catch(() => {
      pageCache.delete(pageId);
      return null;
    });
    pageCache.set(pageId, cached);
  }
  return cached;
}

/** 清空索引與頁面快取（測試與資料端更新後重抓用） */
export function invalidateConceptsSource(): void {
  indexCache = null;
  pageCache.clear();
}
