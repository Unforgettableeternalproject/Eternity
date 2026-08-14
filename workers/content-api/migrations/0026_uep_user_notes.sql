-- 便條島便條移出 progress blob（S11 C 段，blob 瘦身）
--
-- 動機：便條寫滿（60 張 × 400 字）佔 progress blob 86KB / 128KB 額度，
-- 是站點成長天花板的最大單一來源。移出後 blob 只剩每頁固定成本。
--
-- 對客戶端的協定完全不變：worker 在 PUT 時把 storageNotes 剝出來差分
-- 寫入本表、GET 時組裝回去（見 src/uep-notes.ts）。既有 blob 內的便條
-- 由 worker lazy migration 搬移，本 migration 只建空表、不搬資料。
--
-- PK (user_id, note_id) 讓搬移與差分寫入天然冪等（INSERT OR REPLACE），
-- 中途失敗重跑不會產生重複列。
CREATE TABLE IF NOT EXISTS uep_user_notes (
  user_id     INTEGER NOT NULL,
  note_id     TEXT NOT NULL,
  text        TEXT NOT NULL,
  -- 紙張傾斜角度（建立時算一次，SSR/測試穩定）
  tilt        REAL NOT NULL DEFAULT 0,
  -- StorageNoteLocationSnapshot JSON（{zone, pageLabel}），NULL = 未勾選地點
  location    TEXT,
  -- 使用者時區 ISO 8601（含偏移），NULL = 未勾選時間
  captured_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, note_id),
  FOREIGN KEY (user_id) REFERENCES uep_users(id)
);
