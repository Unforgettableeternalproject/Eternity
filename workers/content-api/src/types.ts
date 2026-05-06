// ===== 環境綁定 =====

export interface Env {
  CONTENT_DB: D1Database;
  ALLOWED_ORIGINS: string;
  API_TOKEN?: string;
}

// ===== 內容區塊系統 =====

/** 區塊類型 — 可依區域需求擴充 */
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'code'
  | 'image'
  | 'divider'
  | 'hint'
  | 'spoiler'
  | 'list'
  | 'audio';

/** 單一內容區塊 */
export interface ContentBlock {
  id: string;
  type: BlockType;
  content: string;
  /** 區塊專屬屬性，例如 heading 的 level、hint 的 variant */
  attrs?: Record<string, unknown>;
}

// ===== 頁面資料 =====

export type PageStatus = 'synced' | 'modified' | 'local_only';

/** 資料庫中的頁面原始列 */
export interface PageRow {
  id: string;
  area: string;
  title: string;
  slug: string;
  sort_order: number;
  content: string;       // JSON string of ContentBlock[]
  source_file: string | null;
  base_content_hash: string | null;
  status: PageStatus;
  metadata: string;      // JSON string
  created_at: string;
  updated_at: string;
}

/** API 回傳用的頁面資料（已解析 JSON） */
export interface Page {
  id: string;
  area: string;
  title: string;
  slug: string;
  sortOrder: number;
  content: ContentBlock[];
  sourceFile: string | null;
  baseContentHash: string | null;
  status: PageStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** 建立/更新頁面的請求 */
export interface UpsertPageRequest {
  title?: string;
  slug?: string;
  sortOrder?: number;
  content?: ContentBlock[];
  metadata?: Record<string, unknown>;
}

/** 匯入頁面的請求（從子倉庫來源） */
export interface ImportPageRequest {
  id: string;
  area: string;
  title: string;
  slug: string;
  sortOrder?: number;
  content: ContentBlock[];
  sourceFile: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}

// ===== 同步紀錄 =====

export interface SyncLogEntry {
  id: number;
  action: 'import' | 'auto_update' | 'manual_merge';
  area: string | null;
  affectedPages: string[];
  sourceCommit: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

// ===== API 回應 =====

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PageListItem {
  id: string;
  area: string;
  title: string;
  slug: string;
  sortOrder: number;
  status: PageStatus;
  sourceFile: string | null;
  updatedAt: string;
}
