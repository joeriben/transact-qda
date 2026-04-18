-- Normalize current phase state after grounding-regime backfills:
-- non-phase-eligible namings must not remain current members of phases.
--
-- Preserve append-only history by recording a synthetic removal act before
-- deleting the invalid current appearance. This keeps export/copy logic,
-- which still reconstructs phase state from phase_memberships, aligned with
-- the current-state source of truth in appearances.

WITH invalid_current AS (
  SELECT a.phase_id,
         a.naming_id,
         a.mode,
         a.properties
  FROM (
    SELECT ap.perspective_id AS phase_id,
           ap.naming_id,
           ap.mode,
           ap.properties
    FROM appearances ap
    WHERE ap.naming_id <> ap.perspective_id
      AND tqda_analytic_form(ap.perspective_id) = 'phase'
      AND NOT tqda_phase_eligible(ap.naming_id)
  ) a
)
INSERT INTO phase_memberships (phase_id, naming_id, action, mode, by, properties)
SELECT ic.phase_id,
       ic.naming_id,
       'remove',
       COALESCE(ic.mode, 'entity'),
       ic.phase_id,
       jsonb_build_object(
         'normalizedByMigration', '030_remove_invalid_current_phase_memberships',
         'previousAppearanceProperties', COALESCE(ic.properties, '{}'::jsonb)
       )
FROM invalid_current ic;

DELETE FROM appearances ap
WHERE ap.naming_id <> ap.perspective_id
  AND tqda_analytic_form(ap.perspective_id) = 'phase'
  AND NOT tqda_phase_eligible(ap.naming_id);
