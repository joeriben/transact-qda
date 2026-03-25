-- AI-generated reading index for Aidele reference library.
-- Aidele preprocesses each reference: scans TOC/sections, notes what questions
-- each passage answers, builds a compact orientation map for fast retrieval.

ALTER TABLE aidele_references
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS index_data JSONB,
  ADD COLUMN IF NOT EXISTS text_file TEXT;  -- path to extracted .txt on disk

-- Per-chunk AI annotations (populated during preprocessing)
ALTER TABLE aidele_chunks
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS questions TEXT[],
  ADD COLUMN IF NOT EXISTS key_concepts TEXT[],
  ADD COLUMN IF NOT EXISTS relevance TEXT;  -- 'high' | 'medium' | 'low'

-- Index for searching chunk summaries + questions
CREATE INDEX IF NOT EXISTS idx_aidele_chunks_summary_tsv
  ON aidele_chunks USING GIN (to_tsvector('simple', coalesce(summary, '')));
