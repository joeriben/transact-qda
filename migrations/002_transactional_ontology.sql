-- transact-qda: Transactional ontology refactor
-- The fundamental unit is the Naming (act, not substance).
-- A naming is NEITHER entity NOR relation intrinsically —
-- it is a superposition that collapses under observation from a Perspective.
--
-- Three core tables: namings, participations, appearances.
-- Everything else follows.

-- Drop old interactional schema
DROP TABLE IF EXISTS ai_interactions CASCADE;
DROP TABLE IF EXISTS code_hierarchy CASCADE;
DROP TABLE IF EXISTS memo_links CASCADE;
DROP TABLE IF EXISTS memo_content CASCADE;
DROP TABLE IF EXISTS annotations CASCADE;
DROP TABLE IF EXISTS document_content CASCADE;
DROP TABLE IF EXISTS element_aspects CASCADE;
DROP TABLE IF EXISTS elements CASCADE;
DROP TABLE IF EXISTS events CASCADE;

------------------------------------------------------------
-- CORE ONTOLOGY
------------------------------------------------------------

-- The virtual object: pure potentiality.
-- No kind, no direction, no fixed properties.
-- A naming act that constitutes what it names.
CREATE TABLE namings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inscription TEXT NOT NULL,          -- the naming mark
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,             -- soft delete
  seq BIGSERIAL                       -- temporal ordering (the naming IS the event)
);
CREATE INDEX idx_namings_project ON namings(project_id);
CREATE INDEX idx_namings_seq ON namings(seq);
CREATE INDEX idx_namings_inscription ON namings USING GIN (to_tsvector('german', inscription));

-- The relational fabric: undirected bonds between namings.
-- A participation records co-constitution: "these namings participate in each other."
-- NO direction, NO roles, NO types at this level.
-- A participation is itself a naming (its id exists in namings too).
CREATE TABLE participations (
  id UUID PRIMARY KEY REFERENCES namings(id) ON DELETE CASCADE,
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (naming_id, participant_id)
);
CREATE INDEX idx_part_naming ON participations(naming_id);
CREATE INDEX idx_part_participant ON participations(participant_id);

-- Perspectival collapse: how a naming appears FROM a perspective.
-- A perspective is itself a naming.
-- This is where entity/relation/constellation EMERGES.
-- "There is no such thing as context" (Clarke) — a perspective is not a container
-- but a way of seeing that collapses the superposition.
CREATE TABLE appearances (
  naming_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  perspective_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  -- The collapse mode: how this naming appears from this perspective
  mode TEXT NOT NULL CHECK (mode IN (
    'entity',           -- appears as a bounded thing
    'relation',         -- appears as a directed connection
    'constellation',    -- appears as a cluster of relations (zoomed in)
    'process',          -- appears as temporal unfolding
    'silence',          -- explicitly NOT appearing (positions not taken)
    'perspective'       -- appears as a way of seeing (meta)
  )),

  -- If mode='relation': directed READING of participations
  -- (which participant appears as source, which as target — perspectival!)
  directed_from UUID REFERENCES namings(id),
  directed_to UUID REFERENCES namings(id),
  valence TEXT,         -- "enables", "constrains", "constitutes", "contradicts"...

  -- Emergent properties (exist ONLY under this perspective)
  properties JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (naming_id, perspective_id)
);
CREATE INDEX idx_app_perspective ON appearances(perspective_id);
CREATE INDEX idx_app_mode ON appearances(perspective_id, mode);
CREATE INDEX idx_app_properties ON appearances USING GIN (properties);

------------------------------------------------------------
-- CONTENT TABLES (keyed by naming_id)
------------------------------------------------------------

-- Document content: the material trace of a document-naming
CREATE TABLE document_content (
  naming_id UUID PRIMARY KEY REFERENCES namings(id) ON DELETE CASCADE,
  full_text TEXT,
  file_path TEXT,
  mime_type TEXT,
  file_size BIGINT,
  thumbnail_path TEXT
);
CREATE INDEX idx_doc_fulltext ON document_content USING GIN (to_tsvector('german', coalesce(full_text, '')));
CREATE INDEX idx_doc_fulltext_en ON document_content USING GIN (to_tsvector('english', coalesce(full_text, '')));

-- Memo content: the analytical writing trace of a memo-naming
CREATE TABLE memo_content (
  naming_id UUID PRIMARY KEY REFERENCES namings(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'html'
);

------------------------------------------------------------
-- AI INTERACTIONS (unchanged)
------------------------------------------------------------

CREATE TABLE ai_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  naming_id UUID REFERENCES namings(id),
  request_type TEXT NOT NULL,
  model TEXT NOT NULL,
  input_context JSONB,
  response JSONB,
  accepted BOOLEAN,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_project ON ai_interactions(project_id);
