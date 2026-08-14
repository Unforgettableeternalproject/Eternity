-- 站台行為設定（Epic 2 S10-3b T-B3）
--
-- 設計依據：docs/agent/S10_3_ADMIN_DESIGN.md §2-3（D-2／D-4 定案）
--
-- key-value 表，只收「不參與單拍計算」的四項：內容保護模式、遺落書籤
-- 基礎機率、便條數量上限、便條字數上限。這四項的共同性質是一次性讀取
-- （頁面 mount／新增便條／讀完文章 roll 時各讀一次），不進 scroll/IO
-- 熱路徑。迷霧、掃描線、rush 門檻等每 tick 讀取的參數刻意排除，維持
-- 編譯期常數——runtime 值會把非同步依賴插進首拍。
--
-- 空表是合法狀態：GET /api/settings 對缺列回程式碼常數預設值，
-- 不需要 seed 或 backfill。
CREATE TABLE IF NOT EXISTS uep_settings (
  key        TEXT PRIMARY KEY,
  -- JSON 編碼的值（字串或數字）
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
