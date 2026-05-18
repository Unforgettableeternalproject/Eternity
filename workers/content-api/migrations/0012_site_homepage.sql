-- 網站首頁可編輯內容
CREATE TABLE IF NOT EXISTS site_homepage (
  section_id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
