-- Designation as process: the D/B gradient (cue → characterization → specification)
-- is bidirectional and historicized. Every naming carries its own append-only chain
-- of designation events. No overwriting, no updates — only appending.
--
-- The "by" field references a naming, not a user: the researcher is a naming
-- among namings in the data space. The subject/object asymmetry is not
-- reproduced in the schema.
--
-- Dewey/Bentley, Knowing and the Known (1949), Ch. XI:
--   Cue: "The earliest stage of designation in the evolutionary scale."
--   Characterization: "The intermediate stage... includes the greater part
--     of everyday use of words."
--   Specification: "The most highly perfected naming behavior."

------------------------------------------------------------
-- DESIGNATION HISTORY (append-only)
------------------------------------------------------------

CREATE TABLE naming_designations (
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  designation TEXT NOT NULL CHECK (designation IN (
    'cue',                -- vague, signal-like; something registered but not yet named
    'characterization',   -- provisional naming; everyday language; functional but loose
    'specification'       -- most determined; scientific/analytical precision (never final)
  )),
  by UUID NOT NULL REFERENCES namings(id),  -- who/what designated: a naming, not a user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL
);
CREATE INDEX idx_nd_naming ON naming_designations(naming_id);
CREATE INDEX idx_nd_by ON naming_designations(by);
CREATE INDEX idx_nd_naming_seq ON naming_designations(naming_id, seq);

------------------------------------------------------------
-- RESEARCHER-NAMING: auto-created on first act in project
------------------------------------------------------------
-- No separate table needed. A researcher-naming is simply a naming
-- with a self-referential appearance (mode='perspective') and
-- a participation linking it to the project context.
--
-- The link between users(id) and the researcher-naming is stored
-- in the naming's properties or via a dedicated lookup:

CREATE TABLE researcher_namings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);
