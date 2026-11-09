# Primary Situational Map, Doc-Phases, and the Naming→Mapping Flow

Design decision document. Draft of 2026-04-12; how it came about is not documented. Revised 2026-10-31: no resolution demand for unplaced namings, AI-run cues on the map only after a researcher's act, ungrounded is not a deficit, evidence rules per map type, correction on Clarke 2005. Source of the revision: an AI research report on Clarke's norm 2003–2018 and on published SA practice, which BJ endorsed („Ich unterstütze die Schlussfolgerungen.“ — I support the conclusions; October 2026, kept locally, not in this repository); published sources are cited directly. "Foundations" refers to the epistemological foundations of sessions 00–13, a text written by the assistant (kept locally).

*Attributions to Benjamin Jörissen were checked against the session records and corrected on 2026-11-09; formulations of the assistant are marked.*

## The Problem

Situational Analysis describes two activities without specifying their operational relationship:

1. **GTM Coding**: Line-by-line, incident-by-incident engagement with documents — produces codes (namings grounded in passages)
2. **Situational Mapping**: "Dump everything in the situation" onto a map — produces a spatial/relational analytical view

Clarke (2003, p. 560; 2005, p. 84) prefers coded data for mapping but explicitly admits uncoded, carefully read data; she does not require coding first. Clarke/Friese/Washburn (2018, pp. 108f., 132) separate the two activities — they "are to be done one at a time, not blended together" — and keep analytic codes off the situational map unless they are in-vivo codes, i.e. the participants' own terms. Neither edition says how a passage becomes a map element and stays tied to it.

The transact-qda ontology already resolves this at the data level (codes ARE namings, the CCS gradient replaces the open/axial/selective phase distinction), but the UI has no workflow that connects naming in a document to building the situational map. The two activities live on separate pages with no bridge.

## Design Decision: One Primary Situational Map per Project

How BJ's position on the number of maps developed (the April draft itself is not documented). BJ, session 08 (2026-03-11): „Es gibt pro Projekt nur noch eine Map pro Map-Typ, DENN DAS IST BEI CLARKE AUCH SO.“ (From now on there is only one map per map type per project, BECAUSE THAT IS HOW IT IS IN CLARKE TOO.) BJ, session 13 (2026-03-14): „This will need a much more elegant handling of multiple maps. After all, it is quite valid to start one SitMap related e.g. to one complex document in order to explore it.“ BJ, session 26 (2026-03-28): „Behandeln wir Maps als Projektionen eines logisch geordneten Naming-Gefüges, so gibt es IMMER virtuelle Maps“ (if we treat maps as projections of a logically ordered fabric of namings, there are ALWAYS virtual maps).

### Clarke's actual practice

Clarke describes ONE situational map that grows and evolves:

1. Messy Map — first dump, everything as cues
2. Ordered/Working Map — revisions of the same map, forming a phase, relating
3. Relational Maps — analytical operations on pairs of elements FROM the situational map

Relational Maps are not independent maps. They are focused interrogations of the one map. Social Worlds/Arenas Maps and Positional Maps are different map TYPES, not additional situational maps.

### The Situational Map

Each project has one primary Situational Map — simply called **"Situational Map"** in the UI. It is the accumulating analytical space where namings converge. Like Clarke's definite article ("the situational map"), it needs no qualifying name — it IS the analysis.

- Created automatically with the project (or on first naming act)
- Marked as primary (`isPrimary: true` in perspective properties); cannot be deleted while project has namings
- All namings from the reader default to this map — no "which map?" prompt. Cues of the AI run follow only after a researcher's own act (see *AI-Run Cues and the Map*)
- The map starts messy (all cues, no relations, no phases) and becomes ordered through CCS progress
- The stack IS the revision history (messy → ordered is not a mode switch but the aggregate designation state)
- The Situational Map is never "done" — it grows as long as analysis continues

Additional SitMaps are permitted (e.g., for different research questions within one corpus), but only ONE is the primary — the default target for all namings from the reader. The primary is visually marked (● in map list). Switching the primary is a deliberate act with a confirmation prompt ("All future namings will target map X").

**Epistemological grounding**: Ground truth is the data structure; the list is its most complete representation; the maps are not simply secondary. BJ, session 09 (2026-03-12): „Die Datenstruktur und Datenbank IST die Ground truth. Die Liste ist die ideale Darstellungsform, weil sie nicht zB auf 2 Dimensionen beschränkt die Zusammenhänge darstellen muss“ (the data structure and database IS the ground truth; the list is the ideal form of representation, because it need not show the relations restricted to, e.g., two dimensions) and „Aber wir ARBEITEN nicht ind er Liste i.d.R., weil Menschen damit kognitiv überfordert sind.“ (but as a rule we do not WORK in the list, because it overwhelms people cognitively). Later in the same session: the maps are „nciht einfach sekundär“ (not simply secondary), since „irgendwo müssen ja die Superpositionen konkretisiert werden“ (the superpositions have to be concretized somewhere). Applied to the naming→mapping bridge: namings made in the reader enter the data structure and the list; the map is where they get spatially situated and where the work happens.

### What "landing on the Situational Map" means

When a researcher names a document passage, that naming:

1. Gets an Appearance on the primary Situational Map's perspective
2. Has **no canvas coordinates** — it exists in the list but not on the canvas
3. Is visible in the left-column list, marked as "unplaced"
4. Waits for the researcher to deliberately drag it onto the canvas

**Placement is a conscious analytical act, not a layout operation.** When the researcher picks up a naming and positions it relative to other namings, they are making an analytical claim about the situation's structure. This act can trigger:

- **Confirmation**: "Yes, this belongs here, near these other elements"
- **Revision**: "Actually, this naming doesn't hold up when I try to relate it — I need to rename/split/merge it"
- **Decline**: "This naming is not relevant to the situation after all" (→ declined status)

The failure to place is analytically valuable: "this naming fits nowhere" is a finding about the situation.

### Unplaced Namings (revised 2026-10-31)

A naming at the edge of the map has not been situated. That is a state, not a task. Placing is an analytical act, and so is declining ("fits nowhere" is a finding). Leaving a naming unplaced is equally legitimate: the namings list is the complete messy map, a map is a perspective that selects, and what enters the situation is the researcher's cut (Foundations §13). *(Formulation of the assistant.)* BJ's rule for such selection, session 26 (2026-03-28): „dann kann ich nciht willkürlich Namings aus der Map ausschließen, sondern nur systematisch (z.B. keine Cues anzeigen, nur char und spec).“ (then I cannot exclude namings from the map arbitrarily, only systematically, e.g. show no cues, only char and spec). Earlier, BJ, session 09 (2026-03-12): „ob die St Map IMMER ALLE Namings enthalten muss. Ich denke: ja.“ (whether the Sit Map must ALWAYS contain ALL namings. I think: yes.)

**UI elements:**

1. **Filter in the list panel**: Toggle between "all" / "placed" / "unplaced" / "declined"

2. **Visual distinction**: ○ unplaced, ● placed, strikethrough for declined

3. **Acts**:
   - **Place**: Drag from list onto canvas — analytical claim about situational structure
   - **Decline**: Context menu → "Decline" — conscious judgment that this naming does not belong in the situation (retained in data, hidden from canvas, visible under "declined" filter)
   - **Revise**: Placement attempt reveals the naming doesn't hold up → rename, split, merge, or decline

No counter frames unplaced namings as open work.

*Withdrawn 2026-10-31:* The draft of 2026-04-12 made full resolution the goal ("every naming examined, every naming decided") and gave it a prominent indicator (`7 unresolved [show]` → `✓ all resolved`). With hundreds of namings per project, which is normal where passages are named closely, that turns every naming into a backlog item and pushes the map toward a collection of codes — the coding-first default Clarke/Friese/Washburn (2018, pp. 108f., 132) warn against.

## AI-Run Cues and the Map (revision 2026-10-31)

Cues of the AI run currently reach the map like the researcher's own namings (`createAnnotation`, Naming→Mapping bridge in `src/lib/server/db/queries/annotations.ts`, relied on by `coding-run/write.ts`). They belong at the map's edge only once a researcher's own act stands in their stack — the criterion the comparison in the reader already uses for "own namings". Until then they stay in the reader, attributable and hideable as before. What enters the situation is the researcher's cut; the machine may point, not draw (the assistant's formulation; `design-begleiten.md`).

### Withdrawn the same day: routing by "kind of naming"

Commit f0081be routed namings by a kind stated at the naming act (element of the situation / in-vivo term / analytic concept), following Clarke/Friese/Washburn (2018, p. 132). Withdrawn, because it contradicts the foundations: a naming has no kind before it appears under a perspective, and there is deliberately no `kind` field (Foundations §1–2); Clarke's categories must never become one, theories belong on the map as namings, and the line between researched situation and research situation is to emerge in the analysis, not to be set beforehand (§11). Clarke's distinction remains available to the researcher's judgment when situating; the tool does not encode it.

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

Published SA studies rarely trace a map element back to its data. The closest model is a card per element with map number, source, search term, date and memo (Pérez & Cannella 2013, reprinted in Clarke/Friese/Washburn 2015, ch. 6). Doc-Phases make that chain visible inside the tool. Extension: an export of the chain per element — anchoring passages, participations, memos, the map versions it appeared on — so that a study can report it.

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

1. **D/B's Phase is ontological, not methodological.** A fact presents itself in phases — that describes reality. A Relational Map is a researcher's deliberate analytical reduction — that describes method. Conflating the two levels would be the kind of reification D/B criticize.
2. **The term is taken** (rewritten 2026-11-09, see below). "Phase" names the grouping of namings (`phase_memberships`). Using it for map types as well would give one word two concepts in code and docs.

Secondary maps are simply **maps with a type**. No umbrella term needed.

**"Phase" and "Cluster".** On 2026-03-29 BJ renamed the grouping from "Phase" to "Cluster" (migration 022). The reason the draft of 2026-04-12 gave for that rename — users read "Phase 1, Phase 2" as sequential — was the assistant's (session 29). BJ argued differently, session 29 (2026-03-29): „…als impliziter Reminder dass alle ENtitäen Superpositionen sind.“ (as an implicit reminder that all entities are superpositions) and „Ich denke Phases sind besser als CLuster benannt. Physikalisch ist das auch konsistent; Cluster von subatomaren Tielchen sind auch superpositional.“ (I think phases are better named as clusters. Physically that is consistent too; clusters of subatomic particles are superpositional as well.) BJ, session 30 (2026-03-29): „Phases SIND jetzt Cluster. Cluster SIND eine Frage der Datenorganisation, nciht der Maps.“ (Phases ARE clusters now. Clusters ARE a matter of data organisation, not of the maps.) On 2026-04-14 "Cluster" was renamed back to "Phase" across code, database and documents (migration 026); there is no record of who decided this. That global replacement also garbled this section: the draft's sentence "'Phase' was renamed to 'Cluster'" came to read "'Phase' was renamed to 'Phase'", and its argument about migration 022 came to read "`phase_memberships` → `phase_memberships`".

## The Naming→Mapping Workflow (Model C: Fluid)

There is no fixed sequence. The workflow is bidirectional:

### Naming in documents → Map (grounding-first)

```
1. Open document, select passage, create naming (= grounded cue)
2. Naming appears in Situational Map list (unplaced)
3. Switch to Situational Map (or open in second tab)
4. See new unplaced namings in list
5. Drag onto canvas — analytical placement act
6. Forming a phase and relating follow naturally
```

### Map → Naming in documents (theory-first)

```
1. On Situational Map, create naming from analytical intuition (= ungrounded cue, ∅)
2. Provenance indicator shows: ∅ (no document anchor)
3. Open documents, look for evidence
4. Anchor passages to the existing naming (= grounding the cue)
5. Provenance indicator updates: 📄
```

Grounding is one possible continuation, not a required one (revision 2026-10-31, see below).

### The provenance matrix as compass

| State | Meaning | Action |
|-------|---------|--------|
| ∅ ungrounded, unplaced | Fresh idea, not yet situated | Place on map; anchor it in documents, relations or a memo |
| 📄 grounded, unplaced | Named in the material, not yet situated | Place on map |
| ∅ ungrounded, placed | Situated element without document anchor | Legitimate; its provenance is its participations and memos |
| 📄 grounded, placed | Fully situated | Continue specifying (CCS) |

The system shows these states. The researcher decides the order. "Messy" is when most namings are ∅/cue. "Ordered" is when most are characterized/specified. The transition is gradual, not a mode switch.

### Ungrounded is not a deficit (revision 2026-10-31)

Elements of the situational map come from the data and from the researcher's prior knowledge (Clarke/Friese/Washburn 2018); the messy map holds whatever comes to mind from data and experience (Clarke/Friese/Washburn 2015, introduction to part III). The foundations already provide for this: naming without documents first is one of two legitimate workflows, grounded relationally through participations (Foundations §13); a silence is grounded by the namings whose pattern produces it, and no further provenance type is needed (§12). Grounding stays = document anchor (`design-provenance-and-namings.md`). Where an ungrounded naming comes from is articulated in inscription and memo, not stored as a type.

No AI actant treats ∅ as something to flag. (Today `cowork.ts` does: "Elements marked ∅ lack grounding — ask about these".)

### Evidence rules per map type (revision 2026-10-31)

*Content from the AI research report BJ endorsed (see header).*

| Map type | Rule |
|----------|------|
| Situational Map | Loose provenance. ∅ is legitimate (see above). |
| Positional Map | Positions come from the data. Each position carries its anchoring passages and the speaker role (model: Dys & Carder 2022); a position without anchor is marked. Clarke asks for supporting quotes per position (Clarke & Keller 2014, FQS 15(2), §115f.; not rechecked against the full text). |
| Relational Map | The content of a relation is its memo (`design-mapping-redesign.md` §4.5). |
| Social Worlds/Arenas | No rule yet. |

### Early design maps (revision 2026-10-31)

*Content from the AI research report BJ endorsed (see header).* Clarke/Friese/Washburn (2018, epilogue) recommend mapping before data collection. A map drawn before the material exists is kept as its own labelled version (topology snapshot), so it stays visible which elements were set before data collection.

## Implementation Considerations

### Situational Map creation
- Auto-created with project, or on first naming act that needs a map
- Marked as `isPrimary: true` in perspective properties (JSONB)
- Default inscription: "Situational Map"
- Cannot be deleted while project has namings
- Additional SitMaps permitted; only one can be `isPrimary: true` at a time

### Unplaced namings
- Appearance record exists (naming is on this map's perspective) but `properties.x` and `properties.y` are null AND not declined
- Declined namings: `properties.declined: true` (or similar flag) — decided but not placed
- List panel filters: "all" / "placed" / "unplaced" / "declined"
- No resolution counter (revision 2026-10-31). Today `MapToolbar.svelte` still shows `N unresolved` — to be changed

### Doc-Phases
- Not stored in `phase_memberships` — computed at query time
- Query: `SELECT DISTINCT code_id FROM annotations WHERE document_id = $1`
- Intersected with current map's appearances to produce the highlight set
- Cached per page load, invalidated on annotation changes

### Document page integration
- When creating an annotation, the naming automatically gets an Appearance on the Situational Map (if not already present). Exception (revision 2026-10-31): cues of the AI run get it only once a researcher's own act stands in their stack; today the bridge in `codes.ts` still gives it to them directly — to be changed. Appearances that already exist stay; nothing is rewritten retroactively
- No UI prompt for map selection
- The document page could show a subtle indicator: "3 new namings → Situational Map" after a naming session

## Relation to Existing Design Documents

- **design-provenance-and-namings.md**: Grounded namings as a derived view from maps — the Situational Map IS where they live. The former "code list" is a query on the Situational Map's grounded namings.
- **design-clusters.md** (file name from the March naming „Cluster“): Phases as characterization — manual phases on the Situational Map are the primary grouping mechanism. Doc-Phases extend this with query-based provenance phases.
- **design-documents-and-docnets.md**: DocNets group documents. A DocNet-Phase would be the union of its documents' Doc-Phases. The "Generate SitMap from DocNet" operation (point 4) becomes: "Generate a secondary map from the Situational Map, filtered to namings grounded in this DocNet's documents."

## Resolved Questions (draft of 2026-04-12, origin not documented)

1. **Name**: "Situational Map" — definite article, like Clarke. No qualifying name needed for the primary. Additional SitMaps (if created) require names.
2. **Multiple SitMaps**: Permitted, but only one is primary (`isPrimary: true`). The primary is the default target for all namings from the reader. Ground truth is the data structure, the list is its most complete representation, and the maps are „nciht einfach sekundär“ (BJ, session 09 (2026-03-12); see *Epistemological grounding*). Switching primary requires confirmation.
3. **Unresolved indicator**: Prominent. Full resolution (placed or declined) is the methodological goal. The system communicates this clearly: `7 unresolved [show]` → `✓ all resolved`. *(Withdrawn 2026-10-31, see Unplaced Namings.)*
4. **No "Phase" for secondary maps**: Rejected after critical examination. D/B's "Phase" is ontological (aspects of fact), not methodological (researcher's analytical operations). The draft added that the UX confusion which motivated the Phase→Cluster rename applies equally here; that reason was the assistant's, and the rename was reversed on 2026-04-14 (see *Why not "Phase" for secondary maps*). Secondary maps are simply maps with a type attribute.

## Resolved Questions (Revision 2026-10-31)

*Answers 5–8 come from the AI research report BJ endorsed (see header).*

5. **No resolution demand.** Unplaced is a state, not a task; the goal and indicator of question 3 are withdrawn.
6. **Ungrounded is not a deficit.** Its provenance is its participations and memos. Positions keep an evidence duty.
7. **AI-run cues** reach the map only after a researcher's own act in their stack.
8. **Correction:** Clarke 2005 does not require coding first (see *The Problem*).
9. **Routing by "kind of naming" withdrawn** (commit f0081be, same day): it contradicts the foundations (see *AI-Run Cues and the Map*).

## Open Questions

1. **Doc-Phase performance**: For projects with many documents, computing Doc-Phases on every page load may be expensive. Consider materialized view or caching strategy.
2. **Unresolved → Aidele integration**: Should the didactic persona (Phase 4 roadmap) reference the unresolved count? E.g., "You have 12 unresolved namings — in Clarke's process, this would be a good moment to work on your situational map." *(Obsolete 2026-10-31: there is no resolution count.)*
3. **Secondary map creation UX**: How does a researcher create a Relational Map from the Situational Map? Select two elements → "Create Relational Map"? Or a dedicated "New Map from selection" action?
4. **AI run on transcripts** (2026-10-31): The foundations give the AI's own work a different object than positive cues on passages — what the namings leave unnamed, in the observed material and in the researcher's own naming (Foundations §12). The AI writes silences only as cues; a human can ground, harden and specify a silence, without a special rule. BJ, 2026-07-03: „ob der Cue kletter als Silence, wieso nicht, wenn Human die Slience grounded erhärten und spezifizieren kann. Keine technische Sonderregel hier.“ (whether the cue climbs as a silence: why not, if a human can ground, harden and specify the silence. No special technical rule here.) Today the run does nothing with silences. Whether its own work on transcripts moves there, and whether the cue pass then stays, is open — see `design-begleiten.md` §4.
5. **Existing projects** (2026-10-31): AI-run cues already at the map's edge stay in the data; whether the view hides them until a researcher has acted on them is open.
