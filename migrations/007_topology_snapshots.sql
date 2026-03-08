-- Topology snapshots: save/restore canvas layout positions.
-- seq 0 = auto-buffer (overwritten on every canvas leave),
-- seq 1+ = manual saves (immutable history).

CREATE TABLE topology_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES namings(id),
  seq INT NOT NULL DEFAULT 0,
  label TEXT,
  positions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (map_id, seq)
);

CREATE INDEX idx_topology_snapshots_map ON topology_snapshots(map_id, seq);
