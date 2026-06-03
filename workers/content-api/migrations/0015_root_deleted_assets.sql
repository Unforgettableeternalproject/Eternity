-- 主站 R2 資產刪除追蹤
-- 記錄已刪除的主站 R2 資產 key，讓 sync-root 同步腳本能區分「被刪除」與「從未存在」
-- 與文件站的 deleted_assets 表完全隔離，互不干擾

CREATE TABLE IF NOT EXISTS root_deleted_assets (
  key TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_root_deleted_assets_at ON root_deleted_assets(deleted_at);
