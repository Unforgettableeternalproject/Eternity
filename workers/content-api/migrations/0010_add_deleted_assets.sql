-- R2 資產刪除追蹤
-- 記錄已刪除的 R2 資產 key，讓同步腳本能區分「被刪除」與「從未存在」

CREATE TABLE IF NOT EXISTS deleted_assets (
  key TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deleted_assets_at ON deleted_assets(deleted_at);
