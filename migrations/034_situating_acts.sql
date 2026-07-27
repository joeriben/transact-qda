-- Situating acts — the append-only record of a naming ENTERING or LEAVING
-- the situation of a map.
--
-- Why this is NOT a naming_act
-- ----------------------------
-- A position is a derivative projection (Drei-Schichten-Hierarchie: data =
-- ground truth, list = privileged representation, canvas = projection). Moving
-- a card does not designate anything, so writing it into naming_acts would
-- inflate the designation stack with topology noise and blur the CCS gradient.
-- The act still deserves a record: deciding that a cue BELONGS in the
-- situation — and taking that back — is an analytical judgment, and the
-- researcher must be able to see and reverse it.
--
-- Granularity: only the THRESHOLD is an act
-- -----------------------------------------
-- unplaced -> placed ('situate') and placed -> unplaced ('unsituate'). Nudging
-- an already-situated card, and every machine layout pass (updatePositions,
-- auto-layout, snapshot restore), are NOT acts and are never logged here —
-- otherwise the log would drown in pixel noise and stop being readable as a
-- history of decisions.
--
-- Reversibility: an 'unsituate' row keeps the coordinates the naming HAD, so
-- the take-back can be undone by re-situating at exactly that point.
--
-- Append-only by construction: no UPDATE, no DELETE path exists in the
-- application. A revised judgment is a NEW row.

CREATE TABLE situating_acts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which map's situation, and which naming entered/left it. Both are namings
  -- (a map IS a naming — the perspective); cascade with the project.
  map_id    UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  -- Forscher-als-Naming: who acted, on the same plane as everything else.
  -- Mirrors naming_acts.by — no categorial break between subject and object.
  by UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  act TEXT NOT NULL CHECK (act IN ('situate', 'unsituate')),

  -- 'situate': where it was put. 'unsituate': where it had been (the undo point).
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_situating_acts_naming ON situating_acts(naming_id, created_at DESC);
CREATE INDEX idx_situating_acts_map    ON situating_acts(map_id, created_at DESC);
