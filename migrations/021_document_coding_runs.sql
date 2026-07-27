-- Track how many times each document has been coded by Autonoma.
-- Used to avoid re-coding already-coded documents when new documents are added.
ALTER TABLE document_content ADD COLUMN coding_runs INT NOT NULL DEFAULT 0;
