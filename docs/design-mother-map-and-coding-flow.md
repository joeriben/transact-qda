# Primary Situational Map, Doc-Phases, and the Coding→Mapping Flow

Design decision document. Established session 30 (2026-04-12). Revised 2026-10-31: routing by kind of naming, stated origin for ungrounded elements, evidence rules per map type, correction on Clarke 2005. Source of the revision: a review of Clarke's norm 2003–2018 and of published SA practice (October 2026, kept locally, not in this repository); published sources are cited directly.

## The Problem

Situational Analysis describes two activities without specifying their operational relationship:

1. **GTM Coding**: Line-by-line, incident-by-incident engagement with documents — produces codes (namings grounded in passages)
2. **Situational Mapping**: "Dump everything in the situation" onto a map — produces a spatial/relational analytical view

Clarke (2003, p. 560; 2005, p. 84) prefers coded data for mapping but explicitly admits uncoded, carefully read data; she does not require coding first. Clarke/Friese/Washburn (2018, pp. 108f., 132) separate the two activities — they "are to be done one at a time, not blended together" — and keep analytic codes off the situational map unless they are in-vivo codes, i.e. the participants' own terms. Neither edition says how a passage becomes a map element and stays tied to it.

The transact-qda ontology already resolves this at the data level (codes ARE namings, the CCS gradient replaces the open/axial/selective phase distinction), but the UI has no workflow that connects coding a document to building the situational map. The two activities live on separate pages with no bridge.

## Design Decision: One Primary Situational Map per Project

### Clarke's actual practice

Clarke describes ONE situational map that grows and evolves:

1. Messy Map — first dump, everything as cues
2. Ordered/Working Map — revisions of the same map, forming a phase, relating
3. Relational Maps — analytical operations on pairs of elements FROM the situational map

Relational Maps are not independent maps. They are focused interrogations of the one map. Social Worlds/Arenas Maps and Positional Maps are different map TYPES, not additional situational maps.

### The Situational Map

Each project has one primary Situational Map — simply called **"Situational Map"** in the UI. It is the accumulating analytical space where the namings of the situation converge. Like Clarke's definite article ("the situational map"), it needs no qualifying name — it IS the analysis.

- Created automatically with the project (or on first coding act)
- Marked as primary (`isPrimary: true` in perspective properties); cannot be deleted while project has namings
- Namings from the reader that name an element of the situation, or are in-vivo terms of the participants, default to this map — no "which map?" prompt. The researcher's analytic concepts stay in the reader until lifted deliberately (see *Routing by Kind of Naming*)
- The map starts messy (all cues, no relations, no phases) and becomes ordered through CCS progress
- The stack IS the revision history (messy → ordered is not a mode switch but the aggregate designation state)
- The Situational Map is never "done" — it grows as long as analysis continues

Additional SitMaps are permitted (e.g., for different research questions within one corpus), but only ONE is the primary — the default target for all coding. The primary is visually marked (● in map list). Switching the primary is a deliberate act with a confirmation prompt ("All future coding will target map X").

**Epistemological grounding**: The primary map's **list** is the source of truth — the privileged, complete, dimensionless representation of all namings (per the three-layer hierarchy: data structure → list → canvas). The canvas is a derivative projection. This is not a new concept but the existing architectural principle applied to the coding→mapping bridge: coding produces namings that enter the list; the canvas is where they get spatially situated.

### What "landing on the Situational Map" means

When a researcher names a document passage and the naming routes to the map (see *Routing by Kind of Naming*), that naming:

1. Gets an Appearance on the primary Situational Map's perspective
2. Has **no canvas coordinates** — it exists in the list but not on the canvas
3. Is visible in the left-column list, marked as "unplaced"
4. Waits for the researcher to deliberately drag it onto the canvas

**Placement is a conscious analytical act, not a layout operation.** When the researcher picks up a naming and positions it relative to other namings, they are making an analytical claim about the situation's structure. This act can trigger:

- **Confirmation**: "Yes, this belongs here, near these other elements"
- **Revision**: "Actually, this naming doesn't hold up when I try to relate it — I need to rename/split/merge it"
- **Decline**: "This naming is not relevant to the situation after all" (→ declined status)

The failure to place is analytically valuable: "this naming fits nowhere" is a finding about the situation.

### Unresolved Namings: Visibility and Analytical Goal

The methodological goal is that **every naming that has routed to the map is decided upon**: either placed on the canvas or consciously declined. "Unresolved" means: neither placed nor declined — the researcher has not yet made an analytical judgment about this naming's place in the situation.

The term is "unresolved" rather than "unplaced" because the resolution can be placement OR decline. A naming that "fits nowhere" is analytically valuable — but the decision must be conscious, not accidental neglect.

**UI elements:**

1. **Toolbar status indicator**: Prominent, always visible. Shows unresolved count:
   ```
   Situational Map          7 unresolved     [show]
   ```
   Clicking [show] filters the list to unresolved namings. When all namings are resolved: `✓ all resolved`.

2. **Filter in the list panel**: Toggle between "all" / "placed" / "unresolved" / "declined"

3. **Visual distinction**: Unresolved namings in the list have a different visual treatment (e.g., dashed border, ○ vs. ● for placed, strikethrough for declined)

4. **Resolution acts**:
   - **Place**: Drag from list onto canvas — analytical claim about situational structure
   - **Decline**: Context menu → "Decline" — conscious judgment that this naming does not belong in the situation (retained in data, hidden from canvas, visible under "declined" filter)
   - **Revise**: Placement attempt reveals the naming doesn't hold up → rename, split, merge, or decline

The indicator is deliberately prominent. The analytical process aims for full resolution — every naming examined, every naming decided. This does not mean rushed: dozens of unresolved namings during active coding phases are normal. But the system communicates that resolution is the direction of travel.

The count covers only namings that have routed to the map (revision 2026-10-31). Analytic concepts that stay in the reader are not open tasks of the map.

## Routing by Kind of Naming (revision 2026-10-31)

### Why

Until this revision every naming anchored in a passage landed on the Situational Map as unresolved (`createAnnotation`, Coding→Mapping bridge in `src/lib/server/db/queries/codes.ts`), cues of the coding run included. That makes coding-first the default — the route Clarke/Friese/Washburn (2018, p. 132) rule out for the situational map.

Their rule hinges on what a naming names, not on whether one coded. Analytic process concepts of the researcher (actions, gerunds) do not belong on the situational map; names of elements of the situation and in-vivo terms do. Where analytic codes are moved onto it, the map shows "results of second order" (Bergold-Caldwell 2020, p. 230): the researcher's ordering instead of the elements of the situation. Much apparent rule-breaking in published studies is descriptive coding that names actors, things and discourses — a topic coding Clarke herself counts as analysis (Whisker 2018, §14). And with hundreds of namings per project, which is normal where coding is heavy, routing all of them turns the map into a code collection and the unresolved count into a backlog.

### Rule

When naming a passage, the researcher states the kind of naming:

| Kind | Examples | Default route |
|------|----------|---------------|
| Element of the situation | actor, actant, discourse, organisation, artefact … | Situational Map, unresolved |
| In-vivo term | a word the participants themselves use | Situational Map, unresolved |
| Analytic concept | the researcher's process or pattern concept | stays in the reader |

- The kind is revisable and part of the naming's history (append-only), like any other act.
- Lifting an analytic concept onto the Situational Map is allowed. It is a deliberate act and stays visible as a departure from the norm.
- AI cues (coding run, any persona) carry no kind: stating it is the researcher's cut. They route only after the researcher has set their kind.
- The unresolved count covers routed namings only.

### The ontological objection

In the transactional ontology every naming has equal standing; separating elements from process concepts looks like a return to a distinction the transaction dissolves. Proposed answer: the kind governs routing, not being. It stays a revisable property of the naming, not a class of entity, and a researcher who wants second-order namings on the map can lift them. Whether this holds has to be checked against migrations 003/009 before anything is built (Open Questions 4).

### Terminology

- Working term: *kind of naming* (Benennungsart). The source review says "Designationsart"; that collides with designation = CCS level and is not used.
- "in-vivo" in the code (`createOrphanNaming` in `codes.ts`, `renameNaming` in `namings.ts`) means any naming created in the reader. Clarke's in-vivo means the participants' own terms. Before routing depends on the kind, the code term has to be narrowed or renamed.

## Doc-Phases: Provenance as Lens

### The concept

A **Doc-Phase** is a query-based phase that shows all namings on the Situational Map grounded in a specific document. It is not manually assigned — it is derived from the document-anchor relationship.

```
Manual Phase:  phase_memberships → naming_ids → highlight on map
Doc-Phase:     annotations WHERE document = X → naming_ids → highlight on map
```

### UI integration

Doc-Phases appear in the PhasesSidebar alongside manual phases, visually distinguished (e.g., 📄 icon, different border style):

```
Phases
  ├── [manual] Selbstwirksamkeit (5)
  ├── [manual] Institutionelle Diskurse (3)
  ├── ─── Documents ───
  ├── [📄] Interview_Meier.txt (8)
  ├── [📄] Policy_Brief_2024.pdf (4)
  └── [📄] Foucault_Ch3.txt (2)
```

Clicking a Doc-Phase applies the same highlight/dim logic as manual phases: elements grounded in that document are highlighted, everything else dims. This answers: "Which elements on my map came from this document?"

### Overlap visibility

A naming can be grounded in multiple documents. Doc-Phases naturally overlap. This is analytically meaningful: a naming grounded in both Interview_Meier and Policy_Brief is an element that bridges those data sources.

### Provenance chain per element (revision 2026-10-31)

Published SA studies rarely trace a map element back to its data. The closest model is a card per element with map number, source, search term, date and memo (Pérez & Cannella 2013, reprinted in Clarke/Friese/Washburn 2015, ch. 6). Doc-Phases make that chain visible inside the tool. Extension: an export of the chain per element — anchoring passages, memos, stated origin, the map versions it appeared on — so that a study can report it.

## Secondary Maps: Projections, Not Parallel Worlds

The Situational Map is the primary analytical space. Other maps are **projections** — not independent worlds but focused views derived from the same naming pool.

| Map Type | Function | Relation to Situational Map |
|----------|----------|----------------------------|
| Situational Map (primary) | Accumulating analytical space | — |
| Relational Map | Focus on a pair/group of elements | Draws elements FROM Situational Map |
| Social Worlds/Arenas | Higher aggregation level | Groups Situational Map elements |
| Positional Map | Positions on controversy axes | Different projection of same namings |
| Comparative Map | DocNet A vs. B | Filtered views of Situational Map |

All secondary maps share namings with the Situational Map. A naming placed on a Relational Map is the same naming — it just appears in a different spatial arrangement for a specific analytical purpose.

**Consequence**: Secondary maps do not have their own "unresolved namings." They draw from the Situational Map's pool. Creating a Relational Map = selecting elements from the Situational Map and arranging them in a new spatial configuration.

### Why not "Phase" for secondary maps

D/B define Phase as: "Aspect of fact in sufficiently developed statement to exhibit definite spatial and temporal localizations." Secondary maps ARE aspects of the same analytical fact. However:

1. **The UX problem persists.** "Phase" was renamed to "Phase" precisely because users read "Phase 1, Phase 2" as sequential. Using "Phase" for map types reintroduces the same ambiguity.
2. **D/B's Phase is ontological, not methodological.** A fact presents itself in phases — that describes reality. A Relational Map is a researcher's deliberate analytical reduction — that describes method. Conflating the two levels would be the kind of reification D/B criticize.
3. **The term is codebase-burned.** `phase_memberships` → `phase_memberships` was a conscious migration. Reintroducing "Phase" for a different concept invites confusion in code and docs.

Secondary maps are simply **maps with a type**. No umbrella term needed.

## The Coding→Mapping Workflow (Model C: Fluid)

There is no fixed sequence. The workflow is bidirectional:

### Coding → Map (grounding-first)

```
1. Open document, select passage, create naming (= grounded cue)
2. Naming appears in Situational Map list (unplaced)
3. Switch to Situational Map (or open in second tab)
4. See new unplaced namings in list
5. Drag onto canvas — analytical placement act
6. Forming a phase and relating follow naturally
```

### Map → Coding (theory-first)

```
1. On Situational Map, create naming from analytical intuition (= ungrounded cue, ∅)
2. Provenance indicator shows: ∅ (no document anchor)
3. Open documents, look for evidence
4. Code passages with the existing naming (= grounding the cue)
5. Provenance indicator updates: 📄
```

Grounding is one possible continuation, not a required one (revision 2026-10-31, see below).

### The provenance matrix as compass

| State | Meaning | Action |
|-------|---------|--------|
| ∅ ungrounded, unplaced | Fresh idea, not yet situated | Place on map; state its origin or ground it |
| 📄 grounded, unplaced | Named in the material, not yet situated | Place on map |
| ∅ ungrounded, placed | Situated element without document anchor | Complete once its origin is stated; grounding optional |
| 📄 grounded, placed | Fully situated | Continue specifying (CCS) |

The system shows these states. The researcher decides the order. "Messy" is when most namings are ∅/cue. "Ordered" is when most are characterized/specified. The transition is gradual, not a mode switch.

### Ungrounded is not a deficit (revision 2026-10-31)

Elements of the situational map come from the data and from the researcher's prior knowledge (Clarke/Friese/Washburn 2018); the messy map holds whatever comes to mind from data and experience (Clarke/Friese/Washburn 2015, introduction to part III). Grounding stays = document anchor (`design-provenance-and-codes.md`). What changes is the status of ∅: an ungrounded element whose origin is stated is in a valid end state. Origins:

- prior knowledge or experience
- literature or theory not in the corpus (texts in the corpus are grounded as usual)
- absence / silence
- participants (workshop, participatory mapping)
- another procedure (e.g. SKAD, sequence analysis, typology), with a reference to its result
- analytic memo work

No AI actant treats ∅ as something to flag. (Today `cowork.ts` does: "Elements marked ∅ lack grounding — ask about these".)

### Evidence rules per map type (revision 2026-10-31)

| Map type | Rule |
|----------|------|
| Situational Map | Loose provenance. ∅ with stated origin is complete. |
| Positional Map | Positions come from the data. Each position carries its anchoring passages and the speaker role (model: Dys & Carder 2022); a position without anchor is marked. Clarke asks for supporting quotes per position (Clarke & Keller 2014, FQS 15(2), §115f.; not rechecked against the full text). |
| Relational Map | The content of a relation is its memo (`design-mapping-redesign.md` §4.5). |
| Social Worlds/Arenas | No rule yet. |

### Early design maps (revision 2026-10-31)

Clarke/Friese/Washburn (2018, epilogue) recommend mapping before data collection. A map drawn before the material exists is kept as its own labelled version (topology snapshot), so it stays visible which elements were set before data collection.

## Implementation Considerations

### Situational Map creation
- Auto-created with project, or on first naming act that needs a map
- Marked as `isPrimary: true` in perspective properties (JSONB)
- Default inscription: "Situational Map"
- Cannot be deleted while project has namings
- Additional SitMaps permitted; only one can be `isPrimary: true` at a time

### Unresolved namings
- Appearance record exists (naming is on this map's perspective) but `properties.x` and `properties.y` are null AND not declined
- Declined namings: `properties.declined: true` (or similar flag) — resolved but not placed
- List panel filters: "all" / "placed" / "unresolved" / "declined"
- Toolbar status: prominent unresolved count with [show] action; "✓ all resolved" when count = 0

### Doc-Phases
- Not stored in `phase_memberships` — computed at query time
- Query: `SELECT DISTINCT code_id FROM annotations WHERE document_id = $1`
- Intersected with current map's appearances to produce the highlight set
- Cached per page load, invalidated on annotation changes

### Coding page integration
- When creating an annotation, the naming gets an Appearance on the Situational Map only if its kind routes there (element, in-vivo). Today the code still routes every annotation with valence `codes`, coding-run cues included (`codes.ts`, Coding→Mapping bridge) — to be changed (revision 2026-10-31). Appearances that already exist stay; nothing is rewritten retroactively
- No UI prompt for map selection
- The document page could show a subtle indicator: "3 new namings → Situational Map" after a coding session

## Relation to Existing Design Documents

- **design-provenance-and-codes.md**: Codes as derived view from maps — the Situational Map IS where codes live. The "code list" is a query on the Situational Map's grounded namings.
- **design-phases.md**: Phases as characterization — manual phases on the Situational Map are the primary forming a phase mechanism. Doc-Phases extend this with query-based provenance phases.
- **design-documents-and-docnets.md**: DocNets group documents. A DocNet-Phase would be the union of its documents' Doc-Phases. The "Generate SitMap from DocNet" operation (point 4) becomes: "Generate a secondary map from the Situational Map, filtered to namings grounded in this DocNet's documents."

## Resolved Questions (Session 30)

1. **Name**: "Situational Map" — definite article, like Clarke. No qualifying name needed for the primary. Additional SitMaps (if created) require names.
2. **Multiple SitMaps**: Permitted, but only one is primary (`isPrimary: true`). The primary is the default target for all coding. Its list is the source of truth (three-layer hierarchy). Switching primary requires confirmation.
3. **Unresolved indicator**: Prominent. Full resolution (placed or declined) is the methodological goal. The system communicates this clearly: `7 unresolved [show]` → `✓ all resolved`.
4. **No "Phase" for secondary maps**: Rejected after critical examination. D/B's "Phase" is ontological (aspects of fact), not methodological (researcher's analytical operations). The UX confusion that motivated Phase→Phase rename applies equally here. Secondary maps are simply maps with a type attribute.

## Resolved Questions (Revision 2026-10-31)

5. **Routing follows the kind of naming.** Elements of the situation and in-vivo terms route to the Situational Map by default; analytic concepts stay in the reader until lifted.
6. **∅ with stated origin is a valid end state** on the Situational Map. Positions keep an evidence duty.
7. **AI cues do not route** to the Situational Map until the researcher has set their kind.
8. **Correction:** Clarke 2005 does not require coding first (see *The Problem*).

## Open Questions

1. **Doc-Phase performance**: For projects with many documents, computing Doc-Phases on every page load may be expensive. Consider materialized view or caching strategy.
2. **Unresolved → Aidele integration**: Should the didactic persona (Phase 4 roadmap) reference the unresolved count? E.g., "You have 12 unresolved namings — in Clarke's process, this would be a good moment to work on your situational map."
3. **Secondary map creation UX**: How does a researcher create a Relational Map from the Situational Map? Select two elements → "Create Relational Map"? Or a dedicated "New Map from selection" action?
4. **Kind of naming — storage and ontology** (2026-10-31): A new dimension of `naming_acts` (append-only, `by` = naming, AI provenance visible) or something else? Does a kind reintroduce the element/process separation the transaction dissolves, or does it stay a routing property? Name in UI and code.
5. **Preselection in the naming input** (2026-10-31): none, last used, or "element"? Preselecting "element" restores the old default.
6. **Origin of ∅ elements** (2026-10-31): a structured value, or the memo that states it?
7. **Coding run on transcripts** (2026-10-31): whether it keeps setting its own cues or only produces the table of contents (SNames) — see `design-begleiten.md` §4.
8. **Existing projects** (2026-10-31): namings routed under the old rule stay where they are; how they receive a kind is open.
