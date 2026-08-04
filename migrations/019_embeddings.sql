-- Migration 019: Sentence embeddings for document elements
-- Requires the pgvector extension. The installers enable it as the postgres
-- superuser before running migrations; on a hand-built database it has to be
-- created by a superuser beforehand, because the app role may not do so itself.
-- Adds a 768-dimension vector column to document_elements for sentence-level embeddings
-- (nomic-embed-text via Ollama). HNSW index for fast approximate nearest neighbor search.

-- Ensure pgvector is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (768 dims = nomic-embed-text)
ALTER TABLE document_elements ADD COLUMN embedding vector(768);

-- HNSW index for cosine distance — fast KNN queries
CREATE INDEX idx_elements_embedding ON document_elements
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
