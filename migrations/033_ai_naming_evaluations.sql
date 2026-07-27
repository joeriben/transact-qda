-- AI-Evaluation audit layer — SEPARABLE from the empirical core.
--
-- Records a researcher's verdict (+ rationale) on an AI-produced naming
-- ("AI code"). This is an AUDIT act over the PROVISIONAL AI-Naming subsystem,
-- NOT an empirical research act — it deliberately does NOT live in the
-- append-only naming_acts stack (which is Forscher-als-Naming / ground truth).
-- The auditing stands outside the audited.
--
-- Separability contract (one-way dependency: audit -> core, never core -> audit):
--   * The empirical core (namings, naming_acts, appearances) has NO reference
--     to this table and never learns the word "verdict".
--   * Removing the AI layer = DROP TABLE ai_naming_evaluations
--     + delete the src/lib/server/ai-eval module + remove the reader UI control.
--     No migration on any core table, no orphaned column anywhere.
--
-- The row is SELF-CONTAINED: it snapshots what a training example needs
-- (document, anchor, the judged label, the verdict, the reasoning), so the
-- accumulated corpus SURVIVES even if the AI machinery (and its namings) is
-- later removed. Live references into the core are soft (ON DELETE SET NULL).
--
-- Append-only by convention: a changed judgment is a NEW row; prior rows are
-- never UPDATEd. The history of judgments is itself the audit record.

CREATE TABLE ai_naming_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope. Hard FK into core (audit -> core): if the whole project is deleted,
  -- its evaluations are meaningless and go with it.
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Soft locators into the core — kept for integrity while they live, nulled
  -- (not cascaded) when the referenced core row is removed, so the corpus
  -- survives the removal of the provisional AI layer.
  document_id       UUID REFERENCES namings(id) ON DELETE SET NULL,
  subject_naming_id UUID REFERENCES namings(id) ON DELETE SET NULL,

  -- Self-contained snapshot of what was judged (independent of the soft refs).
  subject_label TEXT NOT NULL,      -- the AI code's inscription at judgment time
  anchor_pos0   INTEGER,            -- passage offsets — the join key for
  anchor_pos1   INTEGER,            -- aligning parallel human/AI codings
  anchor_text   TEXT,

  -- The judgment.
  verdict        TEXT NOT NULL CHECK (verdict IN ('accept', 'reject', 'revise')),
  rationale      TEXT,              -- the WHY (depth-grounded); the trainable signal
  better_reading TEXT,              -- optional corrected reading = the "chosen"

  -- Audit-plane attribution: a USER, not a naming — deliberately off the
  -- empirical Forscher-als-Naming plane. Soft (SET NULL) to preserve the row.
  evaluator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_eval_project  ON ai_naming_evaluations(project_id);
CREATE INDEX idx_ai_eval_subject  ON ai_naming_evaluations(subject_naming_id);
CREATE INDEX idx_ai_eval_document ON ai_naming_evaluations(document_id);
