-- 主站專案「私人 repo」標記
--
-- 標記為私人的專案在前台不輸出 GitHub 連結，改顯示「私人儲存庫」標示；
-- link_github 仍保留原值供後台編輯使用。

ALTER TABLE root_projects
  ADD COLUMN is_private_repo INTEGER NOT NULL DEFAULT 0
  CHECK (is_private_repo IN (0, 1));
