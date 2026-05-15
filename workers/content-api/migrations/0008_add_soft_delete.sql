-- 軟刪除支援：新增 deleted_at 欄位
-- 刪除頁面時改為設定 deleted_at 時間戳，而非硬刪除
-- 同步腳本可透過此欄位追蹤刪除狀態並傳播到另一端

ALTER TABLE pages ADD COLUMN deleted_at TEXT DEFAULT NULL;

-- 索引：加速查詢未刪除 / 已刪除的頁面
CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at);
