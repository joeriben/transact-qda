-- Inscription history: every re-naming is an event.
-- The current inscription in namings.inscription is always the latest,
-- but the full history is here. A naming IS its history of inscriptions.
-- Parallel structure to naming_designations.

CREATE TABLE naming_inscriptions (
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  inscription TEXT NOT NULL,
  by UUID NOT NULL REFERENCES namings(id),  -- who/what re-named: a naming, not a user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL
);
CREATE INDEX idx_ni_naming ON naming_inscriptions(naming_id);
CREATE INDEX idx_ni_naming_seq ON naming_inscriptions(naming_id, seq);
