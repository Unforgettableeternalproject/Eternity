-- 新增 storage 區域的頁面類型：clearing, stuff
-- clearing: 三個空地（箱子遊樂場、零散的紀錄、外界的言語）
-- stuff: 實際的內容頁面（對話劇本、更新公告、部落格文章）
-- subcategory 已存在，storage 可直接複用做可選的中間分層

CREATE TABLE pages_new (
  id                TEXT PRIMARY KEY,
  area              TEXT NOT NULL,
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  content           TEXT,
  source_file       TEXT,
  base_content_hash TEXT,
  status            TEXT NOT NULL DEFAULT 'synced'
    CHECK (status IN ('synced', 'modified', 'local_only')),
  metadata          TEXT DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  parent_id         TEXT REFERENCES pages_new(id) ON DELETE SET NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  page_type         TEXT NOT NULL DEFAULT 'page'
    CHECK (page_type IN ('zone','chapter','arc','section','page','cluster','subcategory','song','homepage','division','gallery','stack','type','context','clearing','stuff')),
  deleted_at        TEXT DEFAULT NULL
);

INSERT INTO pages_new (
  id, area, title, slug, sort_order, content,
  source_file, base_content_hash, status, metadata,
  created_at, updated_at, parent_id, depth, page_type,
  deleted_at
)
SELECT
  id, area, title, slug, sort_order, content,
  source_file, base_content_hash, status, metadata,
  created_at, updated_at, parent_id, depth, page_type,
  deleted_at
FROM pages;

DROP TABLE pages;
ALTER TABLE pages_new RENAME TO pages;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_pages_area ON pages(area);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at);
