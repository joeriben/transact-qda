-- Mark the first situational map per project as isPrimary.
-- For projects without a situational map, no action needed —
-- the primary will be auto-created on next project access or coding act.

UPDATE appearances a
SET properties = a.properties || '{"isPrimary": true}'::jsonb
FROM (
  SELECT DISTINCT ON (n.project_id) a2.naming_id, a2.perspective_id
  FROM appearances a2
  JOIN namings n ON n.id = a2.naming_id
  WHERE a2.naming_id = a2.perspective_id
    AND a2.mode = 'perspective'
    AND a2.properties->>'mapType' = 'situational'
    AND n.deleted_at IS NULL
  ORDER BY n.project_id, n.created_at ASC
) sub
WHERE a.naming_id = sub.naming_id
  AND a.perspective_id = sub.perspective_id;
