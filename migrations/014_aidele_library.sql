-- Aidele reference library: methodological texts for the didactic AI persona.
-- Installation-wide (not per-project). Texts are chunked for retrieval.

CREATE TABLE IF NOT EXISTS aidele_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  filename TEXT,                    -- original uploaded filename
  format TEXT NOT NULL DEFAULT 'text', -- 'pdf' | 'text' | 'markdown'
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aidele_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id UUID NOT NULL REFERENCES aidele_references(id) ON DELETE CASCADE,
  section TEXT,                     -- chapter/section heading (if detected)
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,     -- order within the reference
  word_count INTEGER NOT NULL DEFAULT 0,
  tsv TSVECTOR                      -- full-text search vector
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_aidele_chunks_tsv ON aidele_chunks USING GIN (tsv);

-- Auto-update tsvector on insert/update
CREATE OR REPLACE FUNCTION aidele_chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('simple', coalesce(NEW.section, '')), 'A')
          || setweight(to_tsvector('simple', NEW.content), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_aidele_chunks_tsv ON aidele_chunks;
CREATE TRIGGER trg_aidele_chunks_tsv
  BEFORE INSERT OR UPDATE OF content, section ON aidele_chunks
  FOR EACH ROW EXECUTE FUNCTION aidele_chunks_tsv_trigger();
