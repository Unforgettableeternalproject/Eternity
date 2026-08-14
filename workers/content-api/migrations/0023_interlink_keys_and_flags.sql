-- key 說明表泛化 + 旗標註冊表（Epic 2 S10-3）
--
-- 設計依據：docs/agent/S10_3_ADMIN_DESIGN.md §2-1、§2-2
--
-- 本 migration 做兩件事：把 story_points 泛化成同時容納 entity 與 story
-- 的 interlink_keys，以及新增自訂旗標的註冊表。

-- ===== 旗標註冊表 =====
--
-- 只收「自訂旗標」——編輯器手填、由 FlagMarker 授予或 gate 條件要求的那些。
-- 規則生成的旗標（completed:{pageId}、{storyKey}:song、{entityKey}:gallery、
-- {galleryId}:image:{imageId}、zone:visited:*）一律不入表：它們的名稱是 key
-- 或 pageId 的函數，改 key 就等於改旗標，入表等於製造第二事實來源。
-- 巡查儀表板仍會列出這類旗標（live-scan 掃出來），但標為 derived 且不可編輯。
--
-- 註冊是強制的：存檔時掃出未註冊的自訂旗標即 409。旗標打錯字的症狀是
-- 「授予端與需求端永遠對不上」的靜默永久鎖死，沒有任何錯誤訊息，值得用
-- 存檔失敗換取。強制化的遷移成本為零——本表建立時全站尚無任何自訂旗標。
CREATE TABLE IF NOT EXISTS uep_flags (
  -- 旗標字串本體，即 data-grants-flags / gate.requiresFlags 裡的值
  name        TEXT PRIMARY KEY,
  -- 人看的名稱與說明（僅管理用途，不進前台）
  label       TEXT,
  description TEXT,
  -- 分組：'story' | 'system' | 'debug' | NULL
  category    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_uep_flags_category ON uep_flags(category);

-- ===== key 說明表（取代 story_points）=====
--
-- entity 與 story 的說明行為完全對稱——都是「這個 key 叫什麼、是什麼」——
-- 所以共用一張表而非開兩張同構的表。兩張表會讓 usage handler、殼列建立、
-- backfill、seed/reset 全部長出 keyType 分支，且 schema 要手動保持同步。
--
-- ⚠️ entity 列的 title 永遠是 NULL。entity 的權威顯示名稱來自 Concepts
-- dossier 條目的 name（見 concepts-index.ts 的 EntityIndexEntry.name），
-- 寫進這裡就是與 dossier 打對台的第二事實來源。API 層在寫入時直接忽略
-- entity 的 title 欄位，不靠前端自律。story 沒有等價的名稱來源，
-- 它的 title 正是本表存在的主要理由。
CREATE TABLE IF NOT EXISTS interlink_keys (
  key_type    TEXT NOT NULL CHECK (key_type IN ('entity', 'story')),
  key_value   TEXT NOT NULL,
  title       TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key_type, key_value)
);

-- 既有 story_points 的內容原樣搬過來（本表建立時 title/description 全為
-- NULL，只有殼列，所以這句實際上只是搬 key 與時間戳）。
INSERT OR IGNORE INTO interlink_keys
  (key_type, key_value, title, description, created_at, updated_at)
SELECT 'story', story_key, title, description, created_at, updated_at
FROM story_points;

DROP TABLE story_points;

-- ⚠️ 套用本 migration 後必須跑一次 backfillInterlinkKeys（scripts/reindex-interlink.mjs）。
-- 上面的 INSERT 只搬得到既有的 story 殼列，全站既有的 entityKey 一筆殼列都沒有
-- （殼列平常只在存檔路徑建立），不補建的話管理 UI 會看到空清單。
-- 這件事無法寫進 SQL：entityKey 藏在 metadata JSON 的巢狀結構裡，要逐頁解析。
