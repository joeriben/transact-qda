-- Split tokens_used into input_tokens + output_tokens for cost tracking.
-- Add provider column to know which provider was used.

ALTER TABLE ai_interactions
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS provider TEXT;

-- Backfill: existing rows have tokens_used but no split — assign all to input as rough estimate
UPDATE ai_interactions
  SET input_tokens = tokens_used, output_tokens = 0
  WHERE input_tokens IS NULL AND tokens_used IS NOT NULL;
