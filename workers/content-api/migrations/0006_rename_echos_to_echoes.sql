-- 修正區域名稱拼寫：echos → echoes
-- 使用暫存表繞過 parent_id → id 的外鍵約束

CREATE TABLE _echos_parents (new_id TEXT PRIMARY KEY, new_parent TEXT);
INSERT INTO _echos_parents
  SELECT 'echoes' || SUBSTR(id, 6), 'echoes' || SUBSTR(parent_id, 6)
  FROM pages WHERE area = 'echos' AND parent_id LIKE 'echos/%';

UPDATE pages SET parent_id = NULL WHERE area = 'echos';
UPDATE pages SET id = 'echoes' || SUBSTR(id, 6) WHERE id LIKE 'echos/%';
UPDATE pages SET area = 'echoes' WHERE area = 'echos';

UPDATE pages SET parent_id = (SELECT new_parent FROM _echos_parents WHERE new_id = pages.id)
  WHERE id IN (SELECT new_id FROM _echos_parents);

DROP TABLE _echos_parents;
