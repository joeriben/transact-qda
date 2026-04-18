# Grounding Regime and Phase Eligibility

Design decision document. Prepared after the Docker/runtime redo to tighten the ontology before further UI work.

## Problem

The current model treats all `namings` as if they were equally eligible for `phase_memberships`. That is methodologically too coarse.

The concrete failure mode is now visible:

- `Phases` are project-level analytical objects.
- `Positional` map constructs are also analytical objects.
- Both are still `namings`, but they do not belong to the same grounding regime as situational namings.
- Therefore, they must not enter the same membership logic as empirically/situationally grounded namings.

This matches the methodological distinction:

- SitMap namings can be formed into phases.
- Phases do not become members of phases.
- PosMap positions/discourses can derive from SitMap namings, but they are a later analytical step and therefore ontologically distinct.
- In classic GTA terms: axial codes do not become members of axial codes; selective codes do not become members of axial codes either.

## Decision

`Naming` remains universal. Ontological differentiation is expressed through the naming's **self-perspective metadata**, not through a typed `namings` table.

The relevant distinction is the naming's **grounding regime**.

### Self-perspective metadata

The authoritative metadata lives on:

- `appearances.naming_id = appearances.perspective_id`
- `appearances.mode = 'perspective'`

The properties bag on that self-perspective gets two new fields:

```json
{
  "groundingRegime": "empirical | analytic | infrastructural",
  "analyticForm": "phase | position | axis | map | ordered-category | null"
}
```

The existing `role` field remains in use for infrastructure and compatibility:

- `role = 'phase'`
- `role = 'grounding-workspace'`
- `role = 'memo-system'`
- `role = 'docnet'`

### Interpretation

- `empirical`
  SitMap / SWA / ordinary project namings grounded in the situation or corpus. These are phase-eligible.

- `analytic`
  Later-order analytical constructions such as phases, positional positions, axes, ordered categories, maps. These are not phase-eligible.

- `infrastructural`
  System and workspace objects. Never phase-eligible.

### Derived rule

`phaseEligible` is **derived**, not stored.

```text
phase-eligible(naming) := groundingRegime = 'empirical'
```

## Why this fits the existing ontology

This preserves the project's current commitments:

- `namings` stay universal event-objects.
- `appearances` remain the place where perspectival collapse and emergent properties live.
- `naming_acts` remain append-only designation/inscription/mode history.
- `phase_memberships` remain append-only membership history, parallel to naming acts.

Nothing here requires a typed entity hierarchy or a separate table for phases/positions.

## Data model consequences

### 1. Phases

A phase remains a naming with:

- self-perspective role `phase`
- `groundingRegime = 'analytic'`
- `analyticForm = 'phase'`

This extends the current implementation in `createProjectPhase()` instead of replacing it.

### 2. Positional constructs

Positional constructs remain namings, but with:

- `groundingRegime = 'analytic'`
- `analyticForm = 'position'`

Positional axes likewise become:

- `groundingRegime = 'analytic'`
- `analyticForm = 'axis'`

### 3. Maps

Map namings should be explicitly marked:

- `groundingRegime = 'analytic'`
- `analyticForm = 'map'`

### 4. Infrastructure

Grounding workspace / memo system / docnet stay on the self-perspective as:

- `groundingRegime = 'infrastructural'`
- `analyticForm = null`
- existing `role` retained

## Membership vs. derivation vs. revision

Three relations must stay distinct:

### Membership

Implemented through:

- current state: `appearances (naming_id -> phase_id)`
- history: `phase_memberships`

Allowed only for phase-eligible namings.

### Derivation / transformation

Used when a positional construct or other higher-order analytical object arises from situational namings.

This should not use `phase_memberships`.
It should be represented as ordinary relational namings / appearances with explicit valences such as:

- `derives-from`
- `condenses`
- `transforms`

### Revision / supersession

Used when one analytical construct revises or replaces another.

Also not `phase_memberships`. Use ordinary relational namings / appearances with valences such as:

- `revises`
- `supersedes`
- `splits-from`
- `merges-from`

## Constraints to enforce

### Phase membership eligibility

On both current-state and history paths:

- `phase_id` must resolve to `analyticForm = 'phase'`
- `naming_id` must resolve to `phaseEligible = true`

This forbids:

- phase in phase
- position in phase
- axis in phase
- other analytic constructs in phase

### Map compatibility

Later, after auditing data, map placement should be constrained too:

- empirical namings may appear on situational / social-worlds / network maps
- analytic positions/axes may appear on positional maps
- phases never appear as ordinary map elements
- infrastructure never appears as ordinary map elements

This should be implemented only after the data has been normalized, not in the first pass.

## Migration sequence

### 027_grounding_regime_meta.sql

Add helper SQL functions and backfill self-perspective metadata.

Targets:

- maps -> `analytic/map`
- phases -> `analytic/phase`
- positional axes -> `analytic/axis`
- grounding-workspace / memo-system / docnet -> `infrastructural`

Ordinary namings default to `empirical` via helper function fallback; no mass self-perspective creation required.

### 028_phase_eligibility_constraints.sql

Add trigger/function guards for:

- `appearances` writes that create/remove phase membership state
- `phase_memberships` history writes

### 029_query_fallbacks_for_grounding_regime.sql

Update queries to read `analyticForm = 'phase'` with fallback to current `role = 'phase'`.

This keeps the transition safe while old data still exists.

### 030_creation_path_updates.sql

Update application write paths:

- `createMap()`
- `createProjectPhase()`
- positional axis creation
- positional position creation path

### 031_audit_queries.sql

Add repeatable audit queries for invalid memberships and ambiguous cross-regime namings.

### 032_map_compatibility_constraints.sql

Optional later step.
Only after cleanup and manual validation.

## Compatibility commitment

Future schema evolution must not assume that all already-saved projects are
opened only through in-place SQL migrations.

Native export/import and QDPX import must therefore be treated as a
**graceful migration boundary**:

- older exports must remain importable into newer transact-qda versions
- import must detect older structural variants and normalize them forward
- ontology upgrades must come with explicit import/update logic where needed
- the burden of compatibility should sit at import/export boundaries whenever
  that is safer than guessing directly inside a live database

For this ontology change, that means:

- older projects with simple codes and maps should still import as ordinary
  empirical namings plus analytic maps
- explicit phases should be normalized to `analyticForm = 'phase'`
- future exports should carry enough metadata to restore grounding regime
  distinctions without heuristic guessing

This is not optional polish. It is part of the data-integrity contract.

## Required query changes

### `maps.ts`

- `getProjectPhases()`
- `getMapPhases()`
- all phase lookups currently keyed only by `role = 'phase'`

These should move to:

- prefer `analyticForm = 'phase'`
- fallback to `role = 'phase'`

### `namings.ts`

Current phase reporting still reconstructs current membership from `phase_memberships`.
That is conceptually wrong because `phase_memberships` is history.

Current state must come from `appearances`.
History remains in `phase_memberships`.

### Phase/sidebar UI

Current UI confusion comes from mixing:

- project-level phase list
- current-map item grouping
- project-wide phase mutation from a map-local context

The later UI split must distinguish:

- `Project phases`
- `On this map`

But the data invariants should be fixed first.

## Audit requirements before strict rollout

The following data conditions must be checked before compatibility constraints become hard errors:

1. analytic construct currently assigned to a phase
2. phase assigned to phase
3. naming that appears both as empirical map element and as positional analytical construct
4. historical `phase_memberships` that refer to now-invalid ontological states

The exact SQL skeletons for these checks live in the companion prep file:

- `docs/grounding-regime-sql-skeletons.sql`

## Affected implementation files

Primary candidates for later code changes:

- `migrations/027_grounding_regime_meta.sql`
- `migrations/028_phase_eligibility_constraints.sql`
- `src/lib/server/db/queries/maps.ts`
- `src/lib/server/db/queries/namings.ts`
- `src/routes/api/projects/[projectId]/maps/[mapId]/+server.ts`
- `src/routes/api/projects/[projectId]/phases/+server.ts`
- any positional naming creation path once located and isolated

## Non-goals for the first pass

- no immediate UI redesign
- no forced data rewrite of all historical artifacts
- no typed `namings.kind` column
- no new ontology table hierarchy

The first pass is about making the core invariants explicit and enforceable without abandoning the current architecture.
