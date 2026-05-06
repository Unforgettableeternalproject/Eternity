/**
 * Content API Client
 * 與 content-api Worker 通訊的客戶端
 */

// ===== 型別定義（與 Worker 共用） =====

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

export interface ContentBlock {
  id: string;
  type: BlockType;
  content: string;
  attrs?: Record<string, unknown>;
}

export type PageStatus = 'synced' | 'modified' | 'local_only';

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

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ===== Client =====

const API_BASE = import.meta.env.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = import.meta.env.CONTENT_API_TOKEN || '';

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const json = (await res.json()) as ApiResponse<T>;

  if (!json.ok) {
    throw new Error(json.error || `API error: ${res.status}`);
  }

  return json.data as T;
}

/** 列出某區域的所有頁面 */
export async function listPages(area: string): Promise<PageListItem[]> {
  return apiFetch<PageListItem[]>(`/api/content/${area}`);
}

/** 取得單一頁面完整內容 */
export async function getPage(area: string, slug: string): Promise<Page> {
  return apiFetch<Page>(`/api/content/${area}/${slug}`);
}

/** 建立或更新頁面 */
export async function savePage(
  area: string,
  slug: string,
  data: {
    title?: string;
    content?: ContentBlock[];
    sortOrder?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<Page> {
  return apiFetch<Page>(`/api/content/${area}/${slug}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 刪除頁面 */
export async function deletePage(area: string, slug: string): Promise<void> {
  await apiFetch(`/api/content/${area}/${slug}`, { method: 'DELETE' });
}

/** 取得同步狀態 */
export async function getSyncStatus(): Promise<{
  pageCounts: { area: string; status: string; count: number }[];
  pendingUpdates: { id: string; area: string; title: string }[];
  lastSync: Record<string, unknown> | null;
}> {
  return apiFetch(`/api/content/sync/status`);
}

/** 批次匯入頁面 */
export async function importPages(
  pages: {
    id: string;
    area: string;
    title: string;
    slug: string;
    sortOrder?: number;
    content: ContentBlock[];
    sourceFile: string;
    contentHash: string;
    metadata?: Record<string, unknown>;
  }[],
  sourceCommit?: string
): Promise<{
  imported: number;
  updated: number;
  skipped: number;
}> {
  return apiFetch(`/api/content/sync/import`, {
    method: 'POST',
    body: JSON.stringify({ pages, sourceCommit }),
  });
}
