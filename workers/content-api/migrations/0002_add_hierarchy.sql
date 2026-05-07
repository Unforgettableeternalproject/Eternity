-- 新增層級結構欄位
ALTER TABLE pages ADD COLUMN parent_id TEXT REFERENCES pages(id);
ALTER TABLE pages ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'page'
  CHECK (page_type IN ('zone', 'chapter', 'arc', 'section', 'page'));

-- 索引
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
CREATE INDEX IF NOT EXISTS idx_pages_depth ON pages(depth);
