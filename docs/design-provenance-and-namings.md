# Provenance, Namings, and the Grounding Layer

Design decision document, written by the assistant in session 08 (2026-03-11). Asked whether the code list should become a derived view of the maps, BJ had answered „-> Ja, das ist nötig.“ After the rebuild that followed in the same session he demanded that it be rolled back („die Namings haben hier alle Funktionien verloren“ — the namings have lost all their functions here), asked whether the plan was „auch bereits wertlos“ (already worthless as well), and in the end chose „Alles behalten, nur uncommitted verwerfen“ (keep everything, discard only what is uncommitted). On 2026-07-03 BJ retired the term "code" („Dann solten wir den Begriff "code/coding" aus dem System vollständig verbannen“); it remains below where the document describes the code system of March 2026.

*Attributions to Benjamin Jörissen were checked against the session records and corrected on 2026-11-09; formulations of the assistant are marked.*

## The Problem

The architecture of March 2026 had a **code system** as a separate ontological domain: codes were created and managed in their own perspective (`code-system` role), independent of situational maps. This is the ATLAS.ti/MAXQDA model — codes as pre-existing categories applied to data.

This is inconsistent with Situational Analysis and the transactional ontology:

- In GTM/SA, codes are namings that **emerge** from engagement with data. They sit on the D/B gradient like everything else.
- The separate code list reifies codes as fixed categories rather than emergent namings.
- It creates an artificial ontological boundary between "codes" (document-level) and "elements" (map-level) that SA explicitly refuses.

## Two Dimensions of the Naming Process

### 1. CCS Gradient (Cue → Characterization → Specification)

The designation chain from Dewey/Bentley. Every naming starts as a cue and may be elaborated:

- **Cue**: The most primitive language-behavior — already verbal, but vague and undifferentiated.
- **Characterization**: A naming that identifies. "This is X."
- **Specification**: A naming that determines precisely. "X in the sense of Y because Z."

This gradient applies to ALL namings — map elements, namings anchored in documents, relations, silences. There is no separate designation process for namings anchored in documents vs. map elements.

### 2. Grounding

Does this naming have evidence in the material corpus?

**Key principle: "There is no such thing as context" (Clarke).** Discourses, theoretical frameworks, policy documents — these are IN the situation, not external frames applied to it. A Foucault chapter, a policy brief, a media article are data, not context. They belong in the corpus as uploadable documents whose passages can be named.

**Consequence: Grounding = document anchor** (set provisionally in session 08; the wording is the assistant's).

Whether the document is an interview transcript, a photograph, a policy text, or a theoretical chapter — it's in the corpus, its passages can be named, and a naming grounded in it gets empirical provenance (📄).

### Provenance Matrix

|  | No memo | Has memo (📝) |
|---|---|---|
| **No document anchor** | ∅ Ungrounded | ∅ with memo — legitimate on situational maps |
| **Has document anchor (📄)** | 📄 Grounded, no memo | Fully accountable |

A memo is not a grounding category. It is a movement on the CCS gradient: a memo on a cue lifts it to characterization. BJ, session 08 (2026-03-11): „"reflected" ist doch falsch. ein reflected cue ist mindestens eine characeriztation“ (a reflected cue is at least a characterization).

- **📄 (empirical grounding)**: This naming has evidence in the material corpus. The corpus includes ALL material in the situation — primary data, discourse texts, theoretical references, policy documents. No primary/secondary distinction.
- **📝 (analytical reflection)**: The researcher has documented their reasoning about this naming. This is the reflexive process, not a grounding mechanism.
- **∅ (ungrounded)**: Legitimate on situational maps (Clarke/Friese/Washburn 2018). Its provenance is relational — participations and memos (Foundations §12–13). No AI actant flags these. Positions are the exception: they need document anchors. *(Revised 2026-10-31, following an AI research report that BJ endorsed: „Ich unterstütze die Schlussfolgerungen.“ — I support the conclusions. See `design-mother-map-and-naming-flow.md`; previously: "should be resolved. The AI agent flags these.")*

*Revised 2026-10-31 (same source):* The 📝-without-📄 case is the normal form of an element from prior knowledge: the memo states where it comes from. Incorporating the relevant material into the corpus remains possible and is the way to ground literature and discourse texts. Only on positional maps is 📝-without-📄 a gap. *(Previously: "methodologically problematic from an SA perspective".)*

## Architectural Consequence: Grounded Namings as a Derived View

*(Plan of the assistant, session 08, built on BJ's „-> Ja, das ist nötig.“; on the rollback of the rebuild see the header.)*

### State in March 2026 (inconsistent)

```
[Code System]     ← separate perspective, separate management UI
    codes         ← pre-created categories
        ↓ apply
[Documents]       ← text/image annotation layer
        ↓ feed
[Situational Maps] ← analytical center
```

### Target state (consistent)

```
[Situational Maps] ← analytical center, where namings emerge
    elements       ← namings on the CCS gradient
        ↓ when used as annotation anchors, they ground themselves
[Documents]        ← grounding layer (text + image annotation)
        ↓ evidence flows up
[Grounded namings] ← derived view: "namings that have document anchors"
```

Codes in the former sense are not a separate kind of naming. They are map elements (or any naming) that have been used to annotate documents. The former "code list" becomes a convenience view that shows all namings with document anchors — a query, not an ontological domain.

### What changes

1. **No separate code creation UI.** Namings emerge from the mapping process. When a researcher creates an element on a situational map, that element can be used to annotate documents. Using it as an annotation anchor IS what makes it a "code."

2. **The annotation sidebar shows map elements**, not a separate code list. When annotating a text passage or image region, the researcher picks from namings that exist on their maps (filtered, searchable).

3. **The `code-system` perspective is retired.** Namings used as annotation anchors are appearances on map perspectives, not a separate perspective.

4. **The "codes" page becomes a "grounding" view**: which namings have document anchors? Which don't? This is an analytical dashboard, not a management interface.

5. **In-vivo naming still works** but creates a naming that immediately appears on the active map (or a designated "coding map") as a cue. The act of selecting text/image and naming it IS a naming act on the map.

## Document Annotation as Grounding Layer

Text annotation (CSS Custom Highlight API, `pos0`/`pos1` anchors) and image annotation (rectangle regions, normalized coordinates) are correctly positioned OUTSIDE the situational maps. They are the **grounding layer** — where researchers produce the empirical evidence (📄) that map elements draw on.

The grounding layer:
- Serves the maps, not the other way around
- Connects namings (from maps) to specific passages/regions in documents
- Is where the 📄 provenance indicator gets produced
- Is the natural place for AI grounding assistance (future: "I see something in this image that might connect to element X on your map")

## AI Assistance: Two Levels

### Map-level AI (existing)
- Operates within the analytical space
- Produces naming acts: elements, relations, silences
- All suggestions start as cues

### Document-level AI (future, deferred)
- Operates in the grounding layer
- Helps produce empirical anchors: region suggestions, naming-to-region matching
- Epistemological status: grounding assistant
- Must be multimodal (image input) for visual analysis
- Distinct from map-level AI — different tools, different prompts, different epistemological claims

## Visual Analysis Traditions and the Grounding Layer

All visual analysis approaches share the basic operation of marking and annotating image regions. Phase 1 (rectangle region naming) is the shared foundation.

BJ's list of traditions, session 07 (2026-03-10): „classical (panofsky, Marotzki), less classical (imdahl, BOhnsack), deconstructive (Breckner), seriell (Mietzner/Pilarczyk)“. The assignments below are a draft of the assistant.

The grounding layer supports multiple traditions:
- **Panofsky**: Same region, multiple annotations at different CCS levels
- **Marotzki**: named by BJ among the classical approaches, with Panofsky; no assignment drafted yet
- **Imdahl**: Future composition tools (lines/shapes) stored with `valence: 'composition'` — epistemologically distinct, D-pole instruments
- **Bohnsack**: Region naming + composition overlays
- **Breckner**: Future masking/segmentation
- **Serial-iconographic**: Future gallery/comparison view

The key design constraint: Imdahl's composition drawings are NOT grounding acts. They are instruments for maintaining indeterminacy (staying at D-pole). If built, they must be stored separately from annotation anchors and must NOT produce 📄 provenance. They serve a fundamentally different epistemological function.

## Implementation Sequence

1. **This document** — establish the design decision
2. **Refactor: codes as derived view from maps** — retire `code-system` perspective, annotation sidebar draws from map elements
3. **Update provenance indicators** — clarify 📄 as corpus grounding (no primary/secondary), 📝 as reflexive process
4. **AI grounding assistant** — deferred, depends on multimodal client extension
