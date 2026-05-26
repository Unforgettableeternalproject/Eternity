/**
 * Root Site D1 API Client
 *
 * Typed fetch functions for content-api Worker endpoints.
 * Used in SSR pages to read from D1 instead of Keystatic.
 */

// ───── Types (mirror of root-types.ts from content-api) ─────

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type LinkCategory = 'social' | 'work' | 'creative' | 'other';
export type LinkStatus = 'normal' | 'deprecated' | 'unmaintained';
export type UpdateCategory = 'website' | 'project' | 'announcement' | 'other';

export interface RootProject {
  id: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  contentZh: string;
  contentEn: string;
  tags: string[];
  featured: boolean;
  sortOrder: number;
  status: ProjectStatus;
  image: string | null;
  links: {
    demo: string | null;
    github: string | null;
    website: string | null;
  };
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RootLink {
  id: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  url: string;
  category: LinkCategory;
  status: LinkStatus;
  icon: string | null;
  featured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RootUpdate {
  id: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  contentZh: string;
  contentEn: string;
  date: string;
  category: UpdateCategory;
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RootSingleton {
  sectionId: string;
  content: Record<string, unknown>;
  updatedAt: string;
}

export interface RootCard {
  sectionId: string;
  content: Record<string, unknown>;
  updatedAt: string;
}

// ───── API Client ─────

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function getApiBase(): string {
  return import.meta.env.PUBLIC_CONTENT_API_URL || 'http://localhost:8788';
}

async function apiFetch<T>(path: string): Promise<T | null> {
  const url = `${getApiBase()}${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json: ApiResponse<T> = await res.json();
    return json.ok ? (json.data ?? null) : null;
  } catch (e) {
    console.error(`[api] Failed to fetch ${path}:`, e);
    return null;
  }
}

// ───── Projects ─────

export async function getProjects(): Promise<RootProject[]> {
  return (await apiFetch<RootProject[]>('/api/root/projects')) ?? [];
}

export async function getProject(id: string): Promise<RootProject | null> {
  return apiFetch<RootProject>(`/api/root/projects/${encodeURIComponent(id)}`);
}

// ───── Links ─────

export async function getLinks(): Promise<RootLink[]> {
  return (await apiFetch<RootLink[]>('/api/root/links')) ?? [];
}

// ───── Updates ─────

export async function getUpdates(limit?: number): Promise<RootUpdate[]> {
  const q = limit ? `?limit=${limit}` : '';
  return (await apiFetch<RootUpdate[]>(`/api/root/updates${q}`)) ?? [];
}

export async function getUpdate(id: string): Promise<RootUpdate | null> {
  return apiFetch<RootUpdate>(`/api/root/updates/${encodeURIComponent(id)}`);
}

// ───── Singletons ─────

export async function getSingleton(key: string): Promise<RootSingleton | null> {
  return apiFetch<RootSingleton>(`/api/root/singletons/${key}`);
}

// ───── Cards ─────

export async function getCards(): Promise<RootCard[]> {
  return (await apiFetch<RootCard[]>('/api/root/cards')) ?? [];
}

export async function getCard(key: string): Promise<RootCard | null> {
  return apiFetch<RootCard>(`/api/root/cards/${key}`);
}

// ───── Locale helpers ─────

/** Pick the right text field based on locale */
export function t<T extends { titleZh: string; titleEn: string }>(
  item: T,
  locale: string,
  field: 'title'
): string;
// eslint-disable-next-line no-redeclare
export function t<T extends { descZh: string; descEn: string }>(
  item: T,
  locale: string,
  field: 'desc'
): string;
// eslint-disable-next-line no-redeclare
export function t(
  item: Record<string, unknown>,
  locale: string,
  field: string
): string {
  const zhKey = `${field}Zh`;
  const enKey = `${field}En`;
  return ((locale === 'zh-tw' ? item[zhKey] : item[enKey]) as string) || '';
}

// ───── Asset URL helper ─────

/**
 * 將 R2 key 轉為完整的 asset URL。
 * 支援所有格式：
 *   - 裸 key：`images/projects/xxx/img.png`
 *   - 舊本地路徑：`/images/projects/xxx/img.png`
 *   - 帶 API 前綴：`/api/root/assets/images/...`
 *   - 已 encode 的前綴：`/api/root/assets/images%2F...`
 *   - 完整 URL：`http://...`
 */
export function assetUrl(keyOrPath: string | null | undefined): string {
  if (!keyOrPath) return '';
  // 已經是完整 URL
  if (keyOrPath.startsWith('http')) return keyOrPath;

  const base = getApiBase();
  let key = keyOrPath;

  // strip /api/root/assets/ 前綴
  if (key.startsWith('/api/root/assets/'))
    key = key.slice('/api/root/assets/'.length);
  // strip 舊的 /images/ 開頭（本地 public 路徑）
  else if (key.startsWith('/images/'))
    key = key.slice(1); // → images/...
  else if (key.startsWith('/')) key = key.slice(1);

  // 先 decode（避免雙重 encode），再 encode 每段
  try {
    key = decodeURIComponent(key);
  } catch {
    /* already decoded */
  }

  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `${base}/api/root/assets/${encoded}`;
}
