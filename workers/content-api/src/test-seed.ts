import type { PageRow } from './types';
import type {
  RootCardRow,
  RootLinkRow,
  RootProjectRow,
  RootSingletonRow,
  RootUpdateRow,
} from './root-types';

const OMITTED_PAGE_TYPES = new Set([
  'section',
  'page',
  'song',
  'stuff',
  'gallery',
]);
const CONTENT_SHELL_TYPES = new Set(['concepts:type']);

export interface TestSeedSnapshot {
  version: 1;
  generatedAt: string;
  pages: PageRow[];
  rootProjects: RootProjectRow[];
  rootLinks: RootLinkRow[];
  rootUpdates: RootUpdateRow[];
  rootSingletons: RootSingletonRow[];
  rootCards: RootCardRow[];
  siteHomepage: Array<{
    section_id: string;
    content: string;
    updated_at: string;
  }>;
}

export interface TestResetResult {
  tables: string[];
  totalRows: number;
  clearedAt: string;
  seeded: {
    pages: number;
    rootProjects: number;
    rootLinks: number;
    rootUpdates: number;
    rootSingletons: number;
    rootCards: number;
    siteHomepage: number;
  };
  resetUserProgress: number;
}

function selectSeedPages(rows: PageRow[]): PageRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedIds = new Set(
    rows
      .filter(
        (row) =>
          !OMITTED_PAGE_TYPES.has(row.page_type) || row.id === 'history/index'
      )
      .map((row) => row.id)
  );

  for (const selectedId of [...selectedIds]) {
    let parentId = byId.get(selectedId)?.parent_id;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) {
        throw new Error(`${selectedId} 的父節點 ${parentId} 不存在`);
      }
      selectedIds.add(parentId);
      parentId = parent.parent_id;
    }
  }

  return rows
    .filter((row) => selectedIds.has(row.id))
    .map((row) => {
      const isRequiredLeafAncestor =
        OMITTED_PAGE_TYPES.has(row.page_type) && row.id !== 'history/index';
      return CONTENT_SHELL_TYPES.has(`${row.area}:${row.page_type}`) ||
        isRequiredLeafAncestor
        ? { ...row, content: '[]' }
        : row;
    })
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        a.sort_order - b.sort_order ||
        a.id.localeCompare(b.id)
    );
}

export async function buildTestSeedSnapshot(
  db: D1Database
): Promise<TestSeedSnapshot> {
  const [pages, projects, links, updates, singletons, cards, siteHomepage] =
    await Promise.all([
      db.prepare('SELECT * FROM pages WHERE deleted_at IS NULL').all<PageRow>(),
      db
        .prepare('SELECT * FROM root_projects WHERE deleted_at IS NULL')
        .all<RootProjectRow>(),
      db
        .prepare('SELECT * FROM root_links WHERE deleted_at IS NULL')
        .all<RootLinkRow>(),
      db
        .prepare('SELECT * FROM root_updates WHERE deleted_at IS NULL')
        .all<RootUpdateRow>(),
      db.prepare('SELECT * FROM root_singletons').all<RootSingletonRow>(),
      db.prepare('SELECT * FROM root_cards').all<RootCardRow>(),
      db
        .prepare('SELECT section_id, content, updated_at FROM site_homepage')
        .all<{ section_id: string; content: string; updated_at: string }>(),
    ]);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pages: selectSeedPages(pages.results || []),
    rootProjects: projects.results || [],
    rootLinks: links.results || [],
    rootUpdates: updates.results || [],
    rootSingletons: singletons.results || [],
    rootCards: cards.results || [],
    siteHomepage: siteHomepage.results || [],
  };
}

export function isTestSeedSnapshot(value: unknown): value is TestSeedSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<TestSeedSnapshot>;
  return (
    snapshot.version === 1 &&
    Array.isArray(snapshot.pages) &&
    Array.isArray(snapshot.rootProjects) &&
    Array.isArray(snapshot.rootLinks) &&
    Array.isArray(snapshot.rootUpdates) &&
    Array.isArray(snapshot.rootSingletons) &&
    Array.isArray(snapshot.rootCards) &&
    (snapshot.siteHomepage === undefined ||
      Array.isArray(snapshot.siteHomepage))
  );
}

const BUSINESS_TABLES = [
  'pages',
  'root_projects',
  'root_links',
  'root_updates',
  'root_singletons',
  'root_cards',
  'site_homepage',
  'deleted_assets',
  'root_deleted_assets',
] as const;

export async function resetAndSeedTestData(
  db: D1Database,
  snapshot: TestSeedSnapshot
): Promise<TestResetResult> {
  const counts = await Promise.all(
    BUSINESS_TABLES.map((table) =>
      db
        .prepare(`SELECT COUNT(*) as cnt FROM ${table}`)
        .first<{ cnt: number }>()
    )
  );
  const totalRows = counts.reduce((sum, row) => sum + (row?.cnt ?? 0), 0);
  const statements: D1PreparedStatement[] = BUSINESS_TABLES.map((table) =>
    db.prepare(`DELETE FROM ${table}`)
  );
  statements.push(
    db.prepare(
      `UPDATE uep_users
       SET progress = NULL, observer_ever = 0, updated_at = datetime('now')
       WHERE progress IS NOT NULL OR observer_ever != 0`
    )
  );

  for (const row of snapshot.pages) {
    statements.push(
      db
        .prepare(
          `INSERT INTO pages
           (id, area, title, slug, sort_order, content, source_file,
            base_content_hash, status, metadata, parent_id, depth, page_type,
            created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          row.id,
          row.area,
          row.title,
          row.slug,
          row.sort_order,
          row.content,
          row.source_file,
          row.base_content_hash,
          row.status,
          row.metadata,
          row.parent_id,
          row.depth,
          row.page_type,
          row.created_at,
          row.updated_at,
          null
        )
    );
  }

  for (const row of snapshot.rootProjects) {
    statements.push(
      db
        .prepare(
          `INSERT INTO root_projects
           (id, title_zh, title_en, desc_zh, desc_en, content_zh, content_en,
            tags, featured, sort_order, status, image, link_demo, link_github,
            link_website, start_date, end_date, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          row.id,
          row.title_zh,
          row.title_en,
          row.desc_zh,
          row.desc_en,
          row.content_zh,
          row.content_en,
          row.tags,
          row.featured,
          row.sort_order,
          row.status,
          row.image,
          row.link_demo,
          row.link_github,
          row.link_website,
          row.start_date,
          row.end_date,
          row.created_at,
          row.updated_at,
          null
        )
    );
  }

  for (const row of snapshot.rootLinks) {
    statements.push(
      db
        .prepare(
          `INSERT INTO root_links
           (id, title_zh, title_en, desc_zh, desc_en, url, category, status,
            icon, featured, sort_order, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          row.id,
          row.title_zh,
          row.title_en,
          row.desc_zh,
          row.desc_en,
          row.url,
          row.category,
          row.status,
          row.icon,
          row.featured,
          row.sort_order,
          row.created_at,
          row.updated_at,
          null
        )
    );
  }

  for (const row of snapshot.rootUpdates) {
    statements.push(
      db
        .prepare(
          `INSERT INTO root_updates
           (id, title_zh, title_en, desc_zh, desc_en, content_zh, content_en,
            date, category, featured, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          row.id,
          row.title_zh,
          row.title_en,
          row.desc_zh,
          row.desc_en,
          row.content_zh,
          row.content_en,
          row.date,
          row.category,
          row.featured,
          row.created_at,
          row.updated_at,
          null
        )
    );
  }

  for (const row of snapshot.rootSingletons) {
    statements.push(
      db
        .prepare(
          `INSERT INTO root_singletons (section_id, content, updated_at)
           VALUES (?, ?, ?)`
        )
        .bind(row.section_id, row.content, row.updated_at)
    );
  }

  for (const row of snapshot.rootCards) {
    statements.push(
      db
        .prepare(
          `INSERT INTO root_cards (section_id, content, updated_at)
           VALUES (?, ?, ?)`
        )
        .bind(row.section_id, row.content, row.updated_at)
    );
  }

  for (const row of snapshot.siteHomepage ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT INTO site_homepage (section_id, content, updated_at)
           VALUES (?, ?, ?)`
        )
        .bind(row.section_id, row.content, row.updated_at)
    );
  }

  const results = await db.batch(statements);
  const resetUserProgress = results[BUSINESS_TABLES.length]?.meta.changes ?? 0;

  return {
    tables: [...BUSINESS_TABLES],
    totalRows,
    clearedAt: new Date().toISOString(),
    seeded: {
      pages: snapshot.pages.length,
      rootProjects: snapshot.rootProjects.length,
      rootLinks: snapshot.rootLinks.length,
      rootUpdates: snapshot.rootUpdates.length,
      rootSingletons: snapshot.rootSingletons.length,
      rootCards: snapshot.rootCards.length,
      siteHomepage: snapshot.siteHomepage?.length ?? 0,
    },
    resetUserProgress,
  };
}
