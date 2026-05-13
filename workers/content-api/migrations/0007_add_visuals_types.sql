-- 新增 Visuals 區域專用頁面類型：division（分館）和 gallery（畫廊）
-- SQLite 不支援 ALTER CHECK constraint，需要重建表

CREATE TABLE pages_new (
  id                TEXT PRIMARY KEY,
  area              TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  slug              TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  content           TEXT NOT NULL DEFAULT '[]',
  source_file       TEXT,
  base_content_hash TEXT,
  status            TEXT NOT NULL DEFAULT 'synced'
    CHECK (status IN ('synced', 'modified', 'local_only')),
  metadata          TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  parent_id         TEXT REFERENCES pages_new(id) ON DELETE SET NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  page_type         TEXT NOT NULL DEFAULT 'page'
    CHECK (page_type IN ('zone','chapter','arc','section','page','cluster','subcategory','song','homepage','division','gallery'))
);

INSERT INTO pages_new (
  id, area, title, slug, sort_order, content,
  source_file, base_content_hash, status, metadata,
  created_at, updated_at, parent_id, depth, page_type
)
SELECT
  id, area, title, slug, sort_order, content,
  source_file, base_content_hash, status, metadata,
  created_at, updated_at, parent_id, depth, page_type
FROM pages;

DROP TABLE pages;
ALTER TABLE pages_new RENAME TO pages;

CREATE INDEX IF NOT EXISTS idx_pages_area ON pages(area);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
