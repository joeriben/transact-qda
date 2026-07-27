# Provenance, Codes, and the Grounding Layer

Design decision document. Established session 08 (2026-03-11).

## The Problem

The current architecture has a **code system** as a separate ontological domain: codes are created and managed in their own perspective (`code-system` role), independent of situational maps. This is the ATLAS.ti/MAXQDA model — codes as pre-existing categories applied to data.

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

This gradient applies to ALL namings — map elements, codes, relations, silences. There is no separate designation process for codes vs. map elements.

### 2. Grounding

Does this naming have evidence in the material corpus?

**Key principle: "There is no such thing as context" (Clarke).** Discourses, theoretical frameworks, policy documents — these are IN the situation, not external frames applied to it. A Foucault chapter, a policy brief, a media article are data, not context. They belong in the corpus as uploadable, codeable documents.

**Consequence: Grounding = document anchor. Period.**

Whether the document is an interview transcript, a photograph, a policy text, or a theoretical chapter — it's in the corpus, it's codeable, and a naming grounded in it gets empirical provenance (📄).

### Provenance Matrix

|  | No memo | Has memo (📝) |
|---|---|---|
| **No document anchor** | ∅ Ungrounded | Reflected but ungrounded — flag this |
| **Has document anchor (📄)** | Grounded but unreflected | Fully accountable |

- **📄 (empirical grounding)**: This naming has evidence in the material corpus. The corpus includes ALL material in the situation — primary data, discourse texts, theoretical references, policy documents. No primary/secondary distinction.
- **📝 (analytical reflection)**: The researcher has documented their reasoning about this naming. This is the reflexive process, not a grounding mechanism.
- **∅ (ungrounded)**: Legitimate early in analysis (fresh cues), but should be resolved. The AI agent flags these.

The 📝-without-📄 case is methodologically problematic from an SA perspective: "you've reflected on it but where's the evidence in the situation?" The resolution is to incorporate the relevant material into the corpus and create document anchors.

## Architectural Consequence: Codes as Derived View

### Current state (inconsistent)

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
[Code list]        ← derived view: "namings that have document anchors"
```

Codes are not a separate kind of naming. They are map elements (or any naming) that have been used to annotate documents. The "code list" becomes a convenience view that shows all namings with document anchors — a query, not an ontological domain.

### What changes

1. **No separate code creation UI.** Codes emerge from the mapping process. When a researcher creates an element on a situational map, that element can be used to annotate documents. Using it as an annotation anchor IS what makes it a "code."

2. **The annotation sidebar shows map elements**, not a separate code list. When annotating a text passage or image region, the researcher picks from namings that exist on their maps (filtered, searchable).

3. **The `code-system` perspective is retired.** Codes are appearances on map perspectives, not a separate perspective.

4. **The "codes" page becomes a "grounding" view**: which namings have document anchors? Which don't? This is an analytical dashboard, not a management interface.

5. **In-vivo coding still works** but creates a naming that immediately appears on the active map (or a designated "coding map") as a cue. The act of selecting text/image and naming it IS a naming act on the map.

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
- Epistemological status: co-analyst

### Document-level AI (future, deferred)
- Operates in the grounding layer
- Helps produce empirical anchors: region suggestions, code-to-region matching
- Epistemological status: grounding assistant
- Must be multimodal (image input) for visual analysis
- Distinct from map-level AI — different tools, different prompts, different epistemological claims

## Visual Analysis Traditions and the Grounding Layer

All visual analysis approaches share the basic operation of marking and annotating image regions. Phase 1 (rectangle region coding) is the shared foundation.

The grounding layer supports multiple traditions:
- **Panofsky**: Same region, multiple annotations at different CCS levels
- **Imdahl**: Future composition tools (lines/shapes) stored with `valence: 'composition'` — epistemologically distinct, D-pole instruments
- **Bohnsack**: Region coding + composition overlays
- **Breckner**: Future masking/segmentation
- **Serial-iconographic**: Future gallery/comparison view

The key design constraint: Imdahl's composition drawings are NOT grounding acts. They are instruments for maintaining indeterminacy (staying at D-pole). If built, they must be stored separately from annotation anchors and must NOT produce 📄 provenance. They serve a fundamentally different epistemological function.

## Implementation Sequence

1. **This document** — establish the design decision
2. **Refactor: codes as derived view from maps** — retire `code-system` perspective, annotation sidebar draws from map elements
3. **Update provenance indicators** — clarify 📄 as corpus grounding (no primary/secondary), 📝 as reflexive process
4. **AI grounding assistant** — deferred, depends on multimodal client extension
