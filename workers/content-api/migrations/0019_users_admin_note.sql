-- 使用者管理擴充：admin 備註 + 軟刪除（Epic 2 S5.5）
-- 支援 admin 後台的使用者管理 CRUD

ALTER TABLE uep_users ADD COLUMN admin_note TEXT;
ALTER TABLE uep_users ADD COLUMN deleted_at TEXT;
