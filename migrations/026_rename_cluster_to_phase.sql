-- Revert of migration 022: Cluster → Phase
--
-- Motivation: "Cluster" is heavily occupied by quantitative QDA software
-- (k-means, hierarchical clustering, etc.) and imports the wrong
-- ontology. The project follows Dewey/Bentley, whose *phase* is the
-- proper term for a developmental grouping of namings within the
-- situation — the designation gradient collapsed into analytical
-- wholes. This commit restores that terminology at the database level;
-- the code-level rename is in the same commit.

ALTER TABLE cluster_memberships RENAME TO phase_memberships;
ALTER TABLE phase_memberships RENAME COLUMN cluster_id TO phase_id;
ALTER INDEX idx_cm_cluster RENAME TO idx_pm_phase;
ALTER INDEX idx_cm_naming RENAME TO idx_pm_naming;
ALTER INDEX idx_cm_cluster_seq RENAME TO idx_pm_phase_seq;
