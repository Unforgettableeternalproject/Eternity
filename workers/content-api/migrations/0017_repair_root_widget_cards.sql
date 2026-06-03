-- Migration 0017: repair partial root widget card content.
-- 若 card 在 0016 之前已被 admin 建出來，INSERT OR IGNORE 不會補上預設欄位。

UPDATE root_cards
SET
  content = json_patch(
    '{"enabled":false,"order":4,"position":"left"}',
    COALESCE(content, '{}')
  ),
  updated_at = datetime('now')
WHERE
  section_id = 'card-portal'
  AND (
    json_extract(content, '$.order') IS NULL
    OR json_extract(content, '$.position') IS NULL
  );

UPDATE root_cards
SET
  content = json_patch(
    '{"enabled":false,"order":5,"position":"left","items":[{"key":"STATUS","value":"Online","color":"green"},{"key":"VERSION","value":"v0.9.8","color":"navy"}]}',
    COALESCE(content, '{}')
  ),
  updated_at = datetime('now')
WHERE
  section_id = 'card-status'
  AND (
    json_extract(content, '$.order') IS NULL
    OR json_extract(content, '$.position') IS NULL
    OR json_extract(content, '$.items') IS NULL
  );

UPDATE root_cards
SET
  content = json_patch(
    '{"enabled":false,"order":6,"position":"left","image":"/uep/Show.webp"}',
    COALESCE(content, '{}')
  ),
  updated_at = datetime('now')
WHERE
  section_id = 'card-uep'
  AND (
    json_extract(content, '$.order') IS NULL
    OR json_extract(content, '$.position') IS NULL
    OR json_extract(content, '$.image') IS NULL
  );
