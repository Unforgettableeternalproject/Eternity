-- 主站 collections：projects、links、updates
-- Migration 0013: root site collections

-- ===== root_projects =====
CREATE TABLE IF NOT EXISTS root_projects (
  id           TEXT PRIMARY KEY,              -- URL-safe slug, e.g. "gdg-portal"
  title_zh     TEXT NOT NULL DEFAULT '',
  title_en     TEXT NOT NULL DEFAULT '',
  desc_zh      TEXT NOT NULL DEFAULT '',
  desc_en      TEXT NOT NULL DEFAULT '',
  content_zh   TEXT NOT NULL DEFAULT '',       -- 原始 markdoc 字串
  content_en   TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  featured     INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  image        TEXT,                           -- R2 key or public path
  link_demo    TEXT,
  link_github  TEXT,
  link_website TEXT,
  start_date   TEXT,                           -- ISO date YYYY-MM-DD
  end_date     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_root_projects_featured ON root_projects(featured);
CREATE INDEX IF NOT EXISTS idx_root_projects_status ON root_projects(status);
CREATE INDEX IF NOT EXISTS idx_root_projects_sort ON root_projects(sort_order);
CREATE INDEX IF NOT EXISTS idx_root_projects_deleted ON root_projects(deleted_at);

-- ===== root_links =====
CREATE TABLE IF NOT EXISTS root_links (
  id           TEXT PRIMARY KEY,
  title_zh     TEXT NOT NULL DEFAULT '',
  title_en     TEXT NOT NULL DEFAULT '',
  desc_zh      TEXT NOT NULL DEFAULT '',
  desc_en      TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('social', 'work', 'creative', 'other')),
  status       TEXT NOT NULL DEFAULT 'normal'
    CHECK (status IN ('normal', 'deprecated', 'unmaintained')),
  icon         TEXT,
  featured     INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_root_links_featured ON root_links(featured);
CREATE INDEX IF NOT EXISTS idx_root_links_category ON root_links(category);
CREATE INDEX IF NOT EXISTS idx_root_links_deleted ON root_links(deleted_at);

-- ===== root_updates =====
CREATE TABLE IF NOT EXISTS root_updates (
  id           TEXT PRIMARY KEY,
  title_zh     TEXT NOT NULL DEFAULT '',
  title_en     TEXT NOT NULL DEFAULT '',
  desc_zh      TEXT NOT NULL DEFAULT '',
  desc_en      TEXT NOT NULL DEFAULT '',
  content_zh   TEXT NOT NULL DEFAULT '',
  content_en   TEXT NOT NULL DEFAULT '',
  date         TEXT NOT NULL,                  -- ISO date YYYY-MM-DD
  category     TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('website', 'project', 'announcement', 'other')),
  featured     INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_root_updates_date ON root_updates(date);
CREATE INDEX IF NOT EXISTS idx_root_updates_featured ON root_updates(featured);
CREATE INDEX IF NOT EXISTS idx_root_updates_deleted ON root_updates(deleted_at);
