-- Ontological metadata for namings lives on the naming's self-perspective.
-- This keeps `namings` universal while allowing methodological distinctions
-- such as empirical vs. analytic grounding.

CREATE OR REPLACE FUNCTION tqda_self_props(p_naming_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT a.properties
      FROM appearances a
      WHERE a.naming_id = p_naming_id
        AND a.perspective_id = p_naming_id
        AND a.mode = 'perspective'
      LIMIT 1
    ),
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION tqda_analytic_form(p_naming_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    tqda_self_props(p_naming_id)->>'analyticForm',
    CASE
      WHEN tqda_self_props(p_naming_id)->>'role' = 'phase' THEN 'phase'
      WHEN tqda_self_props(p_naming_id) ? 'mapType' THEN 'map'
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION tqda_grounding_regime(p_naming_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    tqda_self_props(p_naming_id)->>'groundingRegime',
    CASE
      WHEN tqda_self_props(p_naming_id)->>'role' IN ('grounding-workspace', 'memo-system', 'docnet')
        THEN 'infrastructural'
      WHEN tqda_analytic_form(p_naming_id) IS NOT NULL
        THEN 'analytic'
      ELSE 'empirical'
    END
  );
$$;

CREATE OR REPLACE FUNCTION tqda_phase_eligible(p_naming_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT tqda_grounding_regime(p_naming_id) = 'empirical';
$$;

-- Existing maps are analytic objects.
UPDATE appearances
SET properties = properties
  || jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'map')
WHERE naming_id = perspective_id
  AND mode = 'perspective'
  AND properties ? 'mapType';

-- Existing phases are analytic ordering objects.
UPDATE appearances
SET properties = properties
  || jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'phase')
WHERE naming_id = perspective_id
  AND mode = 'perspective'
  AND properties->>'role' = 'phase';

-- Infrastructure perspectives are not analytically grounded data objects.
UPDATE appearances
SET properties = properties
  || jsonb_build_object('groundingRegime', 'infrastructural')
WHERE naming_id = perspective_id
  AND mode = 'perspective'
  AND properties->>'role' IN ('grounding-workspace', 'memo-system', 'docnet');

-- Positional axes predate self-perspective metadata; add it now.
INSERT INTO appearances (naming_id, perspective_id, mode, properties)
SELECT DISTINCT a.naming_id, a.naming_id, 'perspective',
       jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'axis')
FROM appearances a
JOIN appearances map_self
  ON map_self.naming_id = a.perspective_id
 AND map_self.perspective_id = a.perspective_id
 AND map_self.mode = 'perspective'
 AND map_self.properties->>'mapType' = 'positional'
WHERE a.mode = 'entity'
  AND COALESCE((a.properties->>'isAxis')::boolean, false) = true
  AND NOT EXISTS (
    SELECT 1
    FROM appearances self_app
    WHERE self_app.naming_id = a.naming_id
      AND self_app.perspective_id = a.naming_id
  );

UPDATE appearances
SET properties = properties
  || jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'axis')
WHERE naming_id = perspective_id
  AND mode = 'perspective'
  AND EXISTS (
    SELECT 1
    FROM appearances axis_on_map
    JOIN appearances map_self
      ON map_self.naming_id = axis_on_map.perspective_id
     AND map_self.perspective_id = axis_on_map.perspective_id
     AND map_self.mode = 'perspective'
     AND map_self.properties->>'mapType' = 'positional'
    WHERE axis_on_map.naming_id = appearances.naming_id
      AND axis_on_map.mode = 'entity'
      AND COALESCE((axis_on_map.properties->>'isAxis')::boolean, false) = true
  );
