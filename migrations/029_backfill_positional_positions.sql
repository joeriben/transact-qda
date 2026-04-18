-- Existing positional-map elements predate explicit self-perspective metadata.
-- Backfill only the unambiguous cases: namings that appear as non-axis entities
-- on positional maps and do not also appear on non-positional maps.

WITH positional_entities AS (
  SELECT DISTINCT a.naming_id
  FROM appearances a
  JOIN appearances map_self
    ON map_self.naming_id = a.perspective_id
   AND map_self.perspective_id = a.perspective_id
   AND map_self.mode = 'perspective'
   AND map_self.properties->>'mapType' = 'positional'
  WHERE a.mode = 'entity'
    AND a.naming_id <> a.perspective_id
    AND COALESCE((a.properties->>'isAxis')::boolean, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM appearances other_a
      JOIN appearances other_map_self
        ON other_map_self.naming_id = other_a.perspective_id
       AND other_map_self.perspective_id = other_a.perspective_id
       AND other_map_self.mode = 'perspective'
       AND other_map_self.properties ? 'mapType'
      WHERE other_a.naming_id = a.naming_id
        AND other_a.naming_id <> other_a.perspective_id
        AND other_map_self.properties->>'mapType' <> 'positional'
    )
)
INSERT INTO appearances (naming_id, perspective_id, mode, properties)
SELECT pe.naming_id,
       pe.naming_id,
       'perspective',
       jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'position')
FROM positional_entities pe
WHERE NOT EXISTS (
  SELECT 1
  FROM appearances self_app
  WHERE self_app.naming_id = pe.naming_id
    AND self_app.perspective_id = pe.naming_id
    AND self_app.mode = 'perspective'
);

WITH positional_entities AS (
  SELECT DISTINCT a.naming_id
  FROM appearances a
  JOIN appearances map_self
    ON map_self.naming_id = a.perspective_id
   AND map_self.perspective_id = a.perspective_id
   AND map_self.mode = 'perspective'
   AND map_self.properties->>'mapType' = 'positional'
  WHERE a.mode = 'entity'
    AND a.naming_id <> a.perspective_id
    AND COALESCE((a.properties->>'isAxis')::boolean, false) = false
    AND NOT EXISTS (
      SELECT 1
      FROM appearances other_a
      JOIN appearances other_map_self
        ON other_map_self.naming_id = other_a.perspective_id
       AND other_map_self.perspective_id = other_a.perspective_id
       AND other_map_self.mode = 'perspective'
       AND other_map_self.properties ? 'mapType'
      WHERE other_a.naming_id = a.naming_id
        AND other_a.naming_id <> other_a.perspective_id
        AND other_map_self.properties->>'mapType' <> 'positional'
    )
)
UPDATE appearances self_app
SET properties = COALESCE(self_app.properties, '{}'::jsonb)
  || jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'position')
FROM positional_entities pe
WHERE self_app.naming_id = pe.naming_id
  AND self_app.perspective_id = pe.naming_id
  AND self_app.mode = 'perspective'
  AND tqda_analytic_form(self_app.naming_id) IS NULL;
