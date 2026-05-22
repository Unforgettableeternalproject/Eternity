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
  return (
    import.meta.env.PUBLIC_CONTENT_API_URL ||
    'https://eternity-content-api.ptyc4076.workers.dev'
  );
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
export function t<T extends { descZh: string; descEn: string }>(
  item: T,
  locale: string,
  field: 'desc'
): string;
export function t(
  item: Record<string, unknown>,
  locale: string,
  field: string
): string {
  const zhKey = `${field}Zh`;
  const enKey = `${field}En`;
  return ((locale === 'zh-tw' ? item[zhKey] : item[enKey]) as string) || '';
}
