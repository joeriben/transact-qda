-- Migration 018: Object-oriented document elements
-- Replaces plain-text + char-offset approach with addressable document graph.
-- Documents are parsed at import into elements (paragraphs, sentences, etc.)
-- that the AI agent can reference by stable UUID instead of passage quoting.

CREATE TABLE document_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  element_type TEXT NOT NULL,  -- 'paragraph', 'sentence', 'turn', 'heading', ...
  parent_id UUID REFERENCES document_elements(id) ON DELETE CASCADE,
  seq INT NOT NULL,            -- ordering among siblings
  content TEXT,                -- text content (leaf nodes); container nodes NULL
  char_start INT NOT NULL,     -- start offset in original full_text
  char_end INT NOT NULL,       -- end offset in original full_text
  properties JSONB NOT NULL DEFAULT '{}'
);

-- Non-hierarchical graph edges (overlaps, cross-references, etc.)
CREATE TABLE document_element_refs (
  from_id UUID NOT NULL REFERENCES document_elements(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES document_elements(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,      -- 'overlap_at', 'cross_ref', ...
  properties JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (from_id, to_id, ref_type)
);

CREATE INDEX idx_elements_document ON document_elements(document_id);
CREATE INDEX idx_elements_parent ON document_elements(parent_id);
CREATE INDEX idx_element_refs_to ON document_element_refs(to_id);
