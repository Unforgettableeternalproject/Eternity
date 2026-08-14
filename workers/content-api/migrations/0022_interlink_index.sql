-- 跨區互聯：History 反向索引 + 劇情點資料表（Epic 2 S10-1）
--
-- 設計依據：docs/agent/S10_INTERLINK_DESIGN.md §2-4、§4-2
--
-- 兩張表一起在同一個 migration 新增，因為它們是同一個功能的兩半，
-- 且都只在 S10-1 才開始被寫入。
--
-- 為什麼 History 的錨點需要持久化索引，而 key 的「定義端」不需要：
-- entityKey/storyKey 的定義散在 Concepts/Echoes/Visuals 的 metadata JSON
-- 欄位，可以用既有的 live-scan 建構器現查（掃全表、逐列 try/catch），
-- 每次呼叫都讀當下的真實資料，天生不會過期。但 History 的三種標記是
-- 埋在 TipTap 序列化後的 HTML 字串裡（content 欄位的 rich_text block），
-- 「找出所有提到某個 key 的 History 段落」若不建索引，就得每次查詢時
-- 把全站 History 內容抓下來做字串掃描——這是唯一沒有 live-scan 等價解
-- 的查詢方向，故落地成表。

-- ===== History 三種標記的反向索引 =====
--
-- 粒度是「頁」：History 頁存檔時整頁 DELETE + INSERT 重建（db.batch()
-- 同一隱含交易內完成），天然冪等，同一份內容重複存檔產生完全相同的列。
-- 不做逐條 diff——單頁標記數量是個位數到十幾個量級，全量重建的成本
-- 遠低於維護 diff 邏輯的複雜度。
CREATE TABLE IF NOT EXISTS history_interlink_index (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- History 文章頁 id（重建索引的粒度單位；軟刪除時一併清空該頁的列）
  page_id     TEXT NOT NULL,
  anchor_kind TEXT NOT NULL CHECK (anchor_kind IN (
                'entity-mark', 'echo-spot',
                'visual-clue-start', 'visual-clue-gate', 'visual-clue-end'
              )),
  -- echoSpot.spotId / visualClue.clueId；entity mark 是 span 沒有穩定 id，存 NULL
  anchor_id   TEXT,
  key_type    TEXT NOT NULL CHECK (key_type IN ('entity', 'story')),
  key_value   TEXT NOT NULL,
  -- 顯示快照（歌名／圖說／entity 顯示文字）。過期只影響清單顯示，
  -- 不影響查找——實際內容前台觸發時走即時反查。
  label       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 主查詢方向：給一個 key，找出所有 History 錨點（/api/interlink/anchors）
CREATE INDEX IF NOT EXISTS idx_hii_key ON history_interlink_index(key_type, key_value);
-- 重建與清理方向：整頁 DELETE
CREATE INDEX IF NOT EXISTS idx_hii_page ON history_interlink_index(page_id);

-- ===== 劇情點 =====
--
-- 標題／說明刻意不掛在任何一個定義頁的 metadata 上：一個劇情點的三個
-- 可能掛點（Echoes 劇情歌、Visuals 插圖、History 錨點）沒有一個是必然
-- 存在的——可能只掛歌不掛圖、只掛圖不掛歌，甚至先在 History 出現、
-- 稍後才補歌補圖。掛在任一邊都會有「另一邊沒有這個資訊」的問題。
--
-- S10-1 只建表 + 存檔時 INSERT OR IGNORE 建殼（title/description 全程
-- 為 NULL、無讀取端消費），編輯 UI 屬 S10-3。先建殼是為了讓 S10-3 直接
-- UPDATE 即可，不必再設計一套「首次建檔」邏輯。
CREATE TABLE IF NOT EXISTS story_points (
  story_key   TEXT PRIMARY KEY,
  title       TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
