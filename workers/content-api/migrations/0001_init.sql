-- Content API D1 Schema
-- 儲存從 U.E.P's Imaginary Space 匯入並可編輯的內容

-- 頁面內容表
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,                          -- 頁面路徑識別碼，例如 "history/chapter-1"
  area TEXT NOT NULL,                           -- 所屬區域：history, echoes, visuals, concepts, storage, portal
  title TEXT NOT NULL DEFAULT '',                -- 頁面標題
  slug TEXT NOT NULL,                           -- URL slug
  sort_order INTEGER NOT NULL DEFAULT 0,        -- 在區域內的排序

  -- 內容（區塊 JSON 格式）
  content TEXT NOT NULL DEFAULT '[]',           -- JSON array of content blocks

  -- 同步追蹤
  source_file TEXT,                             -- 對應子倉庫中的檔案路徑，NULL 表示僅本地
  base_content_hash TEXT,                       -- 上次同步時來源內容的 SHA-256 hash
  status TEXT NOT NULL DEFAULT 'synced'          -- synced | modified | local_only
    CHECK (status IN ('synced', 'modified', 'local_only')),

  -- 後設資料
  metadata TEXT NOT NULL DEFAULT '{}',          -- JSON: 額外的頁面設定（區域特定的配置）

  -- 時間戳記
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pages_area ON pages(area);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_area_sort ON pages(area, sort_order);

-- 同步歷史紀錄表（追蹤每次匯入/同步操作）
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                         -- import | auto_update | manual_merge
  area TEXT,                                    -- 影響的區域，NULL 表示全部
  affected_pages TEXT NOT NULL DEFAULT '[]',    -- JSON array of affected page IDs
  source_commit TEXT,                           -- 子倉庫的 commit hash
  details TEXT NOT NULL DEFAULT '{}',           -- JSON: 操作細節
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
