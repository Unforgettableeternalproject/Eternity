-- Migration 0016: seed root widget cards added after the original root_cards migration
-- 這三張 card 是主站 widget 系統的正式設定項，不應只依賴前端 fallback。

INSERT OR IGNORE INTO root_cards (section_id, content, updated_at)
VALUES
  (
    'card-portal',
    '{"enabled":false,"order":4,"position":"left"}',
    datetime('now')
  ),
  (
    'card-status',
    '{"enabled":false,"order":5,"position":"left","items":[{"key":"STATUS","value":"Online","color":"green"},{"key":"VERSION","value":"v0.9.8","color":"navy"}]}',
    datetime('now')
  ),
  (
    'card-uep',
    '{"enabled":false,"order":6,"position":"left","image":"/uep/Show.webp"}',
    datetime('now')
  );
