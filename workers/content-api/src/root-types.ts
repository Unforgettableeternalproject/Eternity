// ===== 主站（apps/root）資料型別 =====

// --- Projects ---

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface RootProjectRow {
  id: string;
  title_zh: string;
  title_en: string;
  desc_zh: string;
  desc_en: string;
  content_zh: string;
  content_en: string;
  tags: string; // JSON array
  featured: number; // 0 | 1
  sort_order: number;
  status: ProjectStatus;
  image: string | null;
  link_demo: string | null;
  link_github: string | null;
  link_website: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

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

export interface UpsertRootProjectRequest {
  titleZh?: string;
  titleEn?: string;
  descZh?: string;
  descEn?: string;
  contentZh?: string;
  contentEn?: string;
  tags?: string[];
  featured?: boolean;
  sortOrder?: number;
  status?: ProjectStatus;
  image?: string | null;
  links?: {
    demo?: string | null;
    github?: string | null;
    website?: string | null;
  };
  startDate?: string | null;
  endDate?: string | null;
}

// --- Links ---

export type LinkCategory = 'social' | 'work' | 'creative' | 'other';
export type LinkStatus = 'normal' | 'deprecated' | 'unmaintained';

export interface RootLinkRow {
  id: string;
  title_zh: string;
  title_en: string;
  desc_zh: string;
  desc_en: string;
  url: string;
  category: LinkCategory;
  status: LinkStatus;
  icon: string | null;
  featured: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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

export interface UpsertRootLinkRequest {
  titleZh?: string;
  titleEn?: string;
  descZh?: string;
  descEn?: string;
  url?: string;
  category?: LinkCategory;
  status?: LinkStatus;
  icon?: string | null;
  featured?: boolean;
  sortOrder?: number;
}

// --- Updates ---

export type UpdateCategory = 'website' | 'project' | 'announcement' | 'other';

export interface RootUpdateRow {
  id: string;
  title_zh: string;
  title_en: string;
  desc_zh: string;
  desc_en: string;
  content_zh: string;
  content_en: string;
  date: string;
  category: UpdateCategory;
  featured: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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

export interface UpsertRootUpdateRequest {
  titleZh?: string;
  titleEn?: string;
  descZh?: string;
  descEn?: string;
  contentZh?: string;
  contentEn?: string;
  date?: string;
  category?: UpdateCategory;
  featured?: boolean;
}

// --- Singletons & Cards ---

export interface RootSingletonRow {
  section_id: string;
  content: string; // JSON string
  updated_at: string;
}

export interface RootSingleton {
  sectionId: string;
  content: Record<string, unknown>;
  updatedAt: string;
}

export interface RootCardRow {
  section_id: string;
  content: string;
  updated_at: string;
}

export interface RootCard {
  sectionId: string;
  content: Record<string, unknown>;
  updatedAt: string;
}
