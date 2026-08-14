-- UEP 讀者帳號 + 閱讀進度儲存（Epic 2 S5）
-- 與 admin_users 完全分開：註冊面公開的表不與管理員帳號混用。
-- 進度採最輕量儲存：整個 ProgressState 以 JSON blob 存於 progress 欄，一人一列。
CREATE TABLE IF NOT EXISTS uep_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email         TEXT,
  -- 代稱（註冊時由伺服器端從詞庫隨機組裝）
  alias         TEXT NOT NULL DEFAULT '',
  -- 觀測者印記鏡射欄位（progress blob 內 observerEver 的單向快取，供顯示「已見證的」前綴不必解析 JSON）
  observer_ever INTEGER NOT NULL DEFAULT 0,
  -- ProgressState JSON blob（可為 NULL = 尚未同步過進度）
  progress      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uep_users_username ON uep_users(username);
