# Phase Design (Rename Phase → Phase)

## Theoretical Foundation

Dewey/Bentley, "Knowing and the Known" (Ch. X):

> "Characterization develops out of cue through the **forming a phase** of cues and the growth of language."

Forming a phase IS characterization. When a researcher groups related cues and names the group, that name is a characterization — a higher-order naming that truncates the descriptions of its members into a single designation.

In GTA terms: Open Coding produces Cues. Axial Coding is forming a phase — identifying relational regions within the data. The CCS gradient replaces the methodological phase distinction: there is no mode switch between "open" and "axial," only movement along the designation gradient.

### Why "Phase" not "Phase"

"Phase" was originally chosen to evoke superpositional states (physics), not sequential process steps. But for users without that background, "Phase" inevitably suggests sequence ("Phase 1, Phase 2"). "Phase" is:

- D/B-correct ("forming a phase of cues")
- Physically consistent (phases of subatomic particles are superpositional)
- Methodologically neutral (no sequential connotation)
- Descriptively accurate (a named group of related namings)

## Existing Data Structure

The infrastructure for phases already exists as "phases":

### Table: `phase_memberships`
```sql
CREATE TABLE phase_memberships (
  phase_id UUID NOT NULL REFERENCES namings(id),   -- the phase naming
  naming_id UUID NOT NULL REFERENCES namings(id),   -- the member naming
  action TEXT NOT NULL CHECK (action IN ('assign', 'remove')),
  mode TEXT DEFAULT 'entity',
  by UUID NOT NULL REFERENCES namings(id),          -- who assigned (researcher naming)
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL                                     -- append-only history
);
```

### How Phases Work

A phase is a **naming** that:
1. Has its own inscription (the phase's name, e.g. "Selbstwirksamkeit")
2. Has its own CCS designation (starts at `characterization` — forming a phase IS characterizing)
3. Appears as a sub-perspective on maps (`mode: 'perspective'`)
4. Has members tracked via `phase_memberships` (append-only, traceable)
5. Can itself be clustered (recursive — phases of phases)

### Properties on Phase Appearances

Phases on maps carry visual properties in `appearances.properties`:
- `color`: visual identifier
- `mapType`-related props inherited from the map perspective

## What Needs to Change

### 1. Rename (DB + Code + UI)

| Current | New |
|---------|-----|
| `phase_memberships` | `phase_memberships` |
| `phase_id` column | `phase_id` column |
| `phase` in variable names | `phase` |
| "Phase" in UI labels | "Phase" |

Migration: `ALTER TABLE phase_memberships RENAME TO phase_memberships; ALTER TABLE phase_memberships RENAME COLUMN phase_id TO phase_id;`

### 2. Open Phases for Document Coding

Currently phases exist only within map perspectives. For coding workflow:

- **Namings panel (Spalte 3)**: Show phase membership per naming (color badge or grouping)
- **Create phase from coding context**: Select multiple namings → "Create Phase" → name it
- **Assign to phase**: Drag naming to phase, or dropdown/picker
- **Grounding Workspace**: Phases can exist without a map, on the project's grounding workspace perspective

### 3. Bring Coding and SitMapping Closer

The phase is the bridge between document coding and situational mapping:

- **Coding creates Cues** (grounded in passages)
- **Forming a phase characterizes** (groups cues, names the group)
- **Map placement visualizes** the phases and their relations
- **Relational interrogation** between phases produces specification

The Namings panel already shows all project namings. Adding phase grouping there makes the coding→mapping transition seamless — no need to switch to a map to start forming a phase.

### 4. Phase Visibility

| Context | What to Show |
|---------|-------------|
| Namings panel (Spalte 3) | Group namings by phase, show phase name as header |
| Passages panel (Spalte 4) | Phase badge on passage cards (which phase does this code belong to?) |
| Maps | Phases as visual groups (existing phase rendering) |
| `/namings/[namingId]` | Phase membership in the naming's detail view |

## Open Questions

1. **Phase creation from Similar results**: When embedding similarity reveals a group of related passages, should the system suggest phase formation?
2. **Embedding-based phase proposals**: Use the Phase-Analysis method (from embedding analysis table) to propose phases automatically — researcher confirms/rejects.
3. **Phase ↔ Relation**: A phase of related namings implies relations between them. Should forming a phase auto-create relations, or are phases and relations orthogonal?
4. **Cross-map phases**: A naming can appear on multiple maps. Should its phase membership be per-perspective or global?

## References

- Session 29 (2026-03-28/29): Design discussion — Phases → Phases, D/B foundation
- Session 15: Relation-creation advances Cue → Characterization
- Session 25: "well-grounded cue" criteria (2+ passages or analytically articulated)
- Migration 006: `phase_memberships` table
- `docs/design-memo-ontology.md`: Memo types (Description/Analytical)
- Memory: `project_embedding_analysis_methods.md` — 6 embedding-based analysis methods
