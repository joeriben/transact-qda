# Session 13: Maps as Perspectives — Multi-Map Architecture and Naming Identity

**Date:** 2026-03-14
**Model:** Claude Opus 4.6 (1M context)

---

## The Problem

Working with transact-qda revealed a structural tension: the system had been designed around a single Situational Map per project, with the argument that "it's a stack anyway." But practical work — particularly creating maps to explore individual documents — produced incongruences:

1. **Orphan relations**: Creating namings and participations in the Namings list (ground truth) produced relations whose endpoints had no appearance on the map. The ELK layout engine crashed on edges pointing to non-existent nodes.

2. **Naming duplication**: Creating namings on different maps (or on a map vs. in the list) produced separate namings with identical inscriptions. No mechanism existed to discover or reconcile these duplicates.

3. **Perspectival incompleteness**: A map could not signal that its included namings had participations with namings outside the map's scope.

The question: should maps auto-expand to include all namings (losing perspectival character), or should they be independent perspectives (requiring explicit curation)?

## The Resolution: Three Layers Clarified

The answer was already implicit in the three-layer hierarchy (Session 02) but had not been fully operationalized:

| Layer | What it is | Completeness |
|-------|-----------|-------------|
| **Data structure** | namings, participations, naming_acts | Complete — ONE ground truth |
| **List** (Namings page) | Privileged representation | Complete — shows ALL namings |
| **Maps** (Canvas) | Derivative projections | Selective — curated perspectives |

The **Namings list** already IS the "one complete messy map." It is dimensionless, non-reductive, and shows everything. A Situational Map on the canvas is necessarily selective the moment it arranges things spatially: proximity implies relation, clustering implies category — these are analytical acts, not neutral renderings.

Therefore: **multiple maps are necessary.** They are genuine perspectives, not copies of one ground truth. Clarke herself distinguishes three map types (situational, social worlds/arenas, positional). A single comprehensive map becomes unmanageable with many namings. The architecture already supported this (composite PK `(naming_id, perspective_id)` on appearances), but the UX did not expose the capability.

## Architectural Decisions

### 1. Structural Integrity Within a Map

**Constraint:** If a relation has an appearance on a map, its endpoints must too. This is not "auto-expansion" but constraint enforcement.

**Implementation:** `relateElements` now checks that both source and target have appearances on the map before creating the relation. Missing endpoints are auto-added as entities. The ELK layout engine additionally validates that edge endpoints exist in the graph, skipping orphan edges gracefully.

### 2. Cross-Boundary Signaling

**Principle:** When a naming on Map A has a participation with a naming NOT on Map A, the map shows an indicator — not auto-resolves.

**Implementation:** Each naming's appearance carries an `outside_participation_count`. An amber `+N` badge signals participations outside the current perspective. Clicking reveals the outside namings with a "pull onto map" action.

This respects both ground truth sovereignty (list operations create namings/participations freely) and perspectival independence (maps don't auto-expand). The indicator literally marks what the current perspective leaves uncounted — a direct application of the unmarked (Session 11).

### 3. Naming Identity: Suggestion, Not Enforcement

**Principle:** Two separate naming acts creating "Artificial Intelligence" ARE genuinely two different namings in transactional ontology. Identity is not inscription-equality — it is constituted through the naming act itself.

**Implementation:** The "Add" input on maps now searches existing project namings. The user sees existing namings matching their input and can choose: (a) place an existing naming on this map (creates appearance only), or (b) create a new naming. Deduplication is suggested, never automatic.

### 4. Naming Merge

**When** the user discovers two namings are the same entity, merge transfers all participations, appearances, directed_from/to references, and phase memberships from the merged naming to the survivor. The merged naming is soft-deleted. A confirmation step shows what will transfer. An auto-generated memo documents the absorbed naming's inscription, designation, participations, and map appearances — visible in the survivor's stack.

### 5. Import From Document

**Batch placement:** An "Import" button on the map toolbar shows all project documents with the count of namings (annotation codes) not yet on this map. Clicking imports all annotation-namings from that document as entities.

This supports the workflow: create a new map → import from a specific document → all codes are there → begin relational analysis.

## Processual Implications: Two Legitimate Workflows

### (a) Document → Map (re-naming observed namings)

1. Upload document, annotate passages, create in-vivo codes
2. Create a Situational Map
3. Import codes from the document (batch placement)
4. Begin relational analysis: relate, phase, designate

This is Clarke's standard path: empirical material first, then mapping. The grounding is textual (document anchors). The analytical act is **re-naming** — CCS movement from cue through characterization to specification.

### (b) Direct Map (naming observed unnameds)

1. Create a Situational Map
2. Name what is in the situation directly (without document anchors)
3. Relate, phase, designate
4. Optionally: annotate documents later to ground the namings empirically

This is equally legitimate. It corresponds to operation (b) from Session 11: **naming observed unnameds** — constitutive acts that bring something into countability. The grounding is relational (participations/constellation), not textual.

Both workflows produce the same data structure. Both are available at any time. The system enforces no sequence. This is a direct consequence of the design commitment "no enforced procedure" (diffractory methods, Session 11).

### Cross-pollination via shared ground truth

Because all maps share one ground truth, a naming created on Map A can be placed on Map B without duplication. The search-and-place mechanism enables this. Cross-boundary signaling shows when Map A's namings have relations to namings on Map B (or on no map at all).

This enables a research workflow where different maps represent different analytical angles on the same situation — situational map for the messy/ordered process, social worlds map for arena analysis, positional map for discursive positions — all sharing the same naming pool, all seeing each other's contributions through the cross-boundary indicators.

## Technical Summary

| Feature | File(s) | What |
|---------|---------|------|
| ELK resilience | `layout.ts` | Skip orphan edges, try/catch in initPositions |
| Place existing | `maps.ts`, `+server.ts` | `placeExistingOnMap`, `searchNamingsForPlacement` |
| Autocomplete | `+page.svelte` | Dual-mode input with search dropdown |
| Cross-boundary | `maps.ts`, `+page.svelte` | `outside_participation_count`, amber badges, pull action |
| Naming merge | `namings.ts`, `+server.ts`, `namings/+page.svelte` | Two-step confirm, auto-memo |
| Import from doc | `maps.ts`, `+server.ts`, `+page.svelte` | Batch placement from document annotations |
| Sidebar | `+layout.svelte`, `+layout.server.ts` | All maps grouped by type |
| Structural integrity | `maps.ts` | Auto-add missing endpoints in relateElements |
