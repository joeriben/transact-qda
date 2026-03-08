-- Phase membership history: every assign/remove is an act.
-- Parallel to naming_inscriptions and naming_designations:
-- append-only, traceable, linked to a naming-as-actor.
--
-- The appearances table remains the source of truth for CURRENT membership.
-- This table records the HISTORY of membership acts.

CREATE TABLE phase_memberships (
  phase_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('assign', 'remove')),
  mode TEXT DEFAULT 'entity',
  by UUID NOT NULL REFERENCES namings(id),  -- who assigned/removed: a naming, not a user
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL
);
CREATE INDEX idx_pm_phase ON phase_memberships(phase_id);
CREATE INDEX idx_pm_naming ON phase_memberships(naming_id);
CREATE INDEX idx_pm_phase_seq ON phase_memberships(phase_id, seq);
