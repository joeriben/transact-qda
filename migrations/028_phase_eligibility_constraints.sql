-- Only empirically grounded namings may become members of phases.
-- Phases themselves and other analytic/infrastructural constructs are excluded.

CREATE OR REPLACE FUNCTION tqda_assert_phase_membership_allowed(
  p_phase_id UUID,
  p_naming_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF tqda_analytic_form(p_phase_id) IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'Perspective % is not a phase', p_phase_id;
  END IF;

  IF NOT tqda_phase_eligible(p_naming_id) THEN
    RAISE EXCEPTION 'Naming % is not phase-eligible', p_naming_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION tqda_guard_phase_membership_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action = 'assign' THEN
    PERFORM tqda_assert_phase_membership_allowed(NEW.phase_id, NEW.naming_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tqda_guard_phase_membership_appearance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.naming_id <> NEW.perspective_id
     AND tqda_analytic_form(NEW.perspective_id) = 'phase' THEN
    PERFORM tqda_assert_phase_membership_allowed(NEW.perspective_id, NEW.naming_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_phase_memberships_guard ON phase_memberships;
CREATE TRIGGER trg_phase_memberships_guard
BEFORE INSERT ON phase_memberships
FOR EACH ROW
EXECUTE FUNCTION tqda_guard_phase_membership_history();

DROP TRIGGER IF EXISTS trg_phase_appearance_guard ON appearances;
CREATE TRIGGER trg_phase_appearance_guard
BEFORE INSERT OR UPDATE OF naming_id, perspective_id, mode ON appearances
FOR EACH ROW
EXECUTE FUNCTION tqda_guard_phase_membership_appearance();
