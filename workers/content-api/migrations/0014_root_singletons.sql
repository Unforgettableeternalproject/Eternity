-- 主站 singletons：homepage、about、cards
-- Migration 0014: root site singletons and cards

-- ===== root_singletons =====
-- 存放 homepage-zh, homepage-en, about-zh, about-en 等
CREATE TABLE IF NOT EXISTS root_singletons (
  section_id   TEXT PRIMARY KEY,
  content      TEXT NOT NULL DEFAULT '{}',     -- 完整 JSON blob
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== root_cards =====
-- 存放 card-quote, card-music, card-visitor-counter, card-latest-update, card-quick-stats, card-table-of-contents
CREATE TABLE IF NOT EXISTS root_cards (
  section_id   TEXT PRIMARY KEY,
  content      TEXT NOT NULL DEFAULT '{}',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
