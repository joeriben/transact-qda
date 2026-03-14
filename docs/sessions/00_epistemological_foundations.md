# Epistemological Foundations — Transact-QDA

Compressed reference from Sessions 00–02 + key clarifications from Sessions 09, 11–13.
Every fresh session MUST read this before making architectural decisions.

---

## 1. Transactional Ontology (Dewey/Bentley)

The basic unit is the **naming act** (Ereignis), not the entity and not the relation.
A naming IS neither entity nor relation intrinsically — it is a **superposition** that collapses under observation from a perspective.

Dewey/Bentley (*Knowing and the Known*, 1949): **trans-actions**, not inter-actions between pre-given entities. The system does not presuppose fixed entities that then enter relations. Entity/relation distinction emerges **perspectivally**.

Traditional QDA (ATLAS.ti): entities (codes, categories) are pre-defined, then applied.
Here: a naming **is the event itself**. It has no inherent "kind" until it appears under a perspective.

## 2. The 3-Table Model

| Table | Role | Ontological Status |
|-------|------|-------------------|
| **namings** | Virtual objects, superpositions. A naming IS the event of its constitution — inscription chain + designation chain. No fixed `kind` field. | Ground truth atoms |
| **participations** | Undirected bonds. Symmetric, co-constitutive. A participation IS itself a naming. | Relational fabric (pure, unobserved) |
| **appearances** | Perspectival collapse. Entity/relation/silence **emerges** here. Direction, valence, properties exist only under a perspective. | Collapsed view from somewhere |

Key: same naming can appear as entity, relation, silence, or perspective — depending on observer's position. A perspective is itself a naming.

## 3. Designation Gradient (CCS)

Dewey/Bentley's naming taxonomy, implemented as **bidirectional, append-only chain**:

- **Cue**: The most primitive language-behavior — already verbal, but vague and undifferentiated. (The pre-linguistic, perceptive-manipulative stage is **Signal** in Dewey/Bentley's taxonomy, which precedes Cue and falls outside the naming process proper.)
- **Characterization**: Develops out of cue through clustering of cues and growth of language. Provisional naming. Everyday language. Functional but loose.
- **Specification**: The perfected (and ever-perfecting) stage of naming. Analytical precision (never final).

"Messy vs. Ordered" is NOT a mode — it's the **aggregated designation state** of elements at a given point.

The gradient is **reversible**. A well-specified naming can dissolve back (de-specification). This honors Barad's destructive interference: the zero-point is not absence but a concrete effect.

## 4. Three-Layer Hierarchy

1. **Datenstruktur** (DB tables) = **ground truth**. This is what IS.
2. **Liste** = privileged representation. Complete, dimensionally non-reductive. Shows all namings with current state. No arbitrary dimensional collapse.
3. **Canvas/Maps** = derivative projections. Cognitively helpful but epistemically subordinate. Trade complete coverage for intelligibility.

"The database IS the ground truth. The list best maps its logic because it doesn't dimensionally reduce. But humans need cognitive help — that's why we have maps."

## 5. Researcher-as-Naming

No ontological break between subject and object. Every user is a **naming in the data space** (`researcher_namings` table). The `by` field in naming acts references a naming — which may be a researcher-naming.

Barad: "intra-action" — participants mutually constitute each other.
Haraway: "situated perspectives" — knowledge always comes from somewhere.

The researcher's naming acts (designations, inscriptions, memos) are **traceable events in the relational fabric**, not external annotations.

## 6. Silences

Barad-inspired: "Empirically reconstructable because they leave traces — not as presence, but as patterns of non-presence."

- `mode: 'silence'` in appearances
- A silence can have participations (what dynamics produce this non-presence)
- Silences are **positive findings**, not absences to ignore
- Mathematical analogy: zero in wave interference is a specific state (overlapping crests and troughs)

## 7. Perspectival Collapse

A naming does **not have** a history; a naming **IS** its history (its stack).

Stack = inscription chain + designation chain + participations + appearances.
NOT "history" but "constitution."

Different perspectives collapse this stack differently via `collapseAt` (sequence number). Phase A sees cue at level 1, Phase B sees specification at level 3 — neither is more "true."

## 8. Provenance: Two Orthogonal Axes

| Dimension | Axis | Values |
|-----------|------|--------|
| **CCS Gradient** | Designation processing | cue <-> characterization <-> specification |
| **Grounding** | Empirical anchoring | doc-anchored / memo-linked / ungrounded |

Orthogonal: a cue CAN be document-anchored; a specification CAN be ungrounded.
Memo = CCS movement (analytical work), NOT grounding.
Document anchor = concrete attachment to corpus material.

Clarke: "There is no such thing as context." All material belongs in the corpus.

## 9. The Namings-Page Ontology (Session 09 — Critical Clarification)

**Initial (wrong) claim**: "Designate, Relate, Withdraw are perspectivally bound — they need a Map context."

**Correction by examining the data structure**:
- `naming_acts` has `naming_id`, `designation`, `by`. **No `perspective_id`**. Designation belongs to the naming itself — NOT perspectivally bound.
- `deleted_at` on namings — global, not perspective-bound.
- `participations` — global bonds. The appearance of a relation is perspectival, but the participation itself is not.
- Inscription chain and designation chain belong to the naming. Perspective-independent.

**Consequence**: Core operations (designate, rename, relate, withdraw, stack) operate **on the naming itself**, not on its appearance on a map. A Namings page with mutations is NOT a contradiction — it's consequent: operating directly on namings, independent of any specific perspective.

**But**: An HTML page IS always a perspective. There is no perspectiveless access to data. The Namings page is the **least-reduced** perspective — complete, dimensionless, most faithful to the data structure. Maps are more reduced (2D, visual filters, collapseAt).

**The Namings page is a privileged perspective**: it shows uncollapsed stacks, all namings, no dimensional reduction. It is the closest a UI can get to the data structure itself. Maps are derivative. The Namings page is the primary workspace.

## 10. Key Theoretical References

- **Dewey/Bentley** (*Knowing and the Known*): Transactional philosophy, CCS taxonomy, trans-action vs. inter-action
- **Karen Barad** (*Meeting the Universe Halfway*): Intra-action, destructive interference, silences as positive findings
- **Adele Clarke** (*Situational Analysis*): "There is no context"; situational mapping; relational pragmatism
- **Donna Haraway**: Situated knowledges, positioned perspectives, accountability
- **Harrison C. White**: Relational domains, identities from positions in networks

---

## Naming Acts (unified stack, Migration 009)

`naming_acts` replaces the former separate `naming_inscriptions` + `naming_designations` tables.
Each act carries all dimensions: inscription, designation, mode, valence — NULL = unchanged.
The current state = latest non-NULL value per dimension.
Mode and valence changes are first-class naming acts.

---

## 11. Clarke's Situational Matrix — The "Situation of Action"

Clarke's central methodological move: **the situation itself is the unit of analysis.** Not actors, not processes, not social worlds — the situation of action/inquiry.

This replaces Strauss's Conditional Matrix (concentric micro→macro layers implying hierarchy and inside/outside). Clarke flattens: everything is ON ONE PLANE, inside the situation.

### Formal Properties

1. **No outside.** "There is no such thing as context" (Clarke). What traditional research calls context — institutions, discourses, politics, history — is **constitutive of** the situation, not external framing.
2. **Relational constitution.** Elements do not pre-exist the situation. They are constituted through their relations within it. (Dewey/Bentley: trans-action, not inter-action.)
3. **Heterogeneous composition.** Human actors, nonhuman actants, discourses, political-economic forces, symbols — all on the same ontological footing.
4. **Empirical determination.** The situation is not given a priori — it must be analytically articulated. The situational map IS the method for this.
5. **The conditional IS the situational.** Clarke's explicit break from Strauss: conditions are not layers around the situation, they are elements within it.

### The 12 Heuristic Element Categories

From Clarke's Situational Matrix (dashed outer boundary = permeable, open-ended):

1. Human Elements (Individual & Collective)
2. Nonhuman Elements
3. Discursive Constructions of Actors
4. Political Economic Elements
5. Organizational / Institutional Elements
6. Major Contested Issues
7. Local to Global Elements
8. Sociocultural Elements
9. Symbolic Elements
10. Popular & Other Discourses
11. Spatial & Temporal Elements
12. Other Empirical Elements TBA

**Critical design principle:** These are **heuristic prompts** (sensitizing concepts), NOT ontological kinds. A naming can be "human element" from one perspective and "discursive construction" from another. They must NEVER become fixed `kind` fields. In our architecture, they function as CCS-level characterizations or researcher annotations — perspectival, not intrinsic.

### Clarke's Procedural Method and Its Limits

Clarke's analytical sequence: (1) messy map — lay out all elements; (2) ordered/working version — sort elements into the 12 categories; (3) relational analysis — take each element, systematically interrogate its relation to every other (n*(n-1)/2 pairs).

**Value of the procedure:**
- Comprehensiveness — forces attention beyond the researcher's default gaze (esp. nonhuman elements, discourses, silences)
- Against premature closure — exhaustive engagement prevents abductive insight from crystallizing too early
- Democratization — a transmittable procedure that doesn't depend on theoretical cultivation
- Material for abduction — the memo (not the map) is where abductive breakthroughs occur; the procedure generates the saturation from which insight can fire

**Critique:**
- The procedure is **inter-actional, not trans-actional**. Elements are listed FIRST (they "exist"), then relations are asked about SECOND (as interpretive overlays). This presupposes pre-given entities that subsequently enter relations — exactly what Dewey/Bentley's trans-action refuses. Clarke claims Dewey but operationalizes Strauss.
- The 12 categories embed an **implicit social theory** (Strauss's "general orders") that is applied and simultaneously withdrawn from critique by being declared "optional." What "political" means remains untheorized (Habermas? Rancière? Foucault?).
- The ordered version risks **reification**: Clarke warns against "slavishly filling in blank categories," but providing categories as structure IS the affordance that produces this behavior. The warning cannot undo what the form interpellates.
- The exhaustive pairwise interrogation is **inductive rather than abductive** — procedural rather than Gestalt-oriented. After 200 systematically examined pairs, the cognitive state needed for constellational perception (Benjamin, Adorno) is likely suppressed. Clarke does not theorize the relationship between systematic exhaustion and abductive emergence.
- Path dependency: categorized and exhaustively related elements tend to become the **ground truth** of the inquiry rather than its starting point. Only disciplined memo-ing can counteract this.

### Material-Mediality: Paper as Unacknowledged Actant

Clarke's method was developed for paper. Paper's material affordances enforce inter-actional analysis — and this is a non-reflected nonhuman actant in SA methodology:

- **On paper, a label IS a thing.** Once written in a box, it cannot transform into a relation. The entity/relation distinction is materially fixed.
- **On paper, a line between boxes is NOT a nameable object.** It has no stack, no inscription chain, no designation history, no provenance. Relations are second-class: ink connecting pre-given entities.
- **The messy → ordered → relational sequence is medium-determined.** It's not just methodology — it's what paper demands. The analytical procedure is shaped by what the material can and cannot do.
- **Iteration is materially costly.** Redoing a paper map means physically redrawing it. This material resistance reinforces path dependency.

**Consequence for transact-qda:** The digital platform doesn't just make SA more convenient — it makes a **different SA possible**. One where the trans-actional ontology that Clarke claims but paper can't deliver becomes operative in analytical practice:

- A naming on the canvas IS a superposition — it reveals its stack, other appearances, participations on interaction
- A relation IS a naming — clickable, inscribable, designatable, with its own provenance chain
- The same naming can appear as entity on one map and relation on another — and the researcher can see this
- Iteration is cheap — the material resistance that locks paper maps into path dependency doesn't exist
- The in-between (which for Clarke lives between map versions) starts **in the objects on the map**

Clarke's method is a method-for-paper that was theorized as method-as-such. Recognizing the material-mediality of the analytical medium is itself an SA-consistent move: attending to nonhuman actants in the research situation.

### Design Commitments: Beyond Clarke (Session 10)

Three commitments that reinterpret Clarke's SA through the transactional ontology:

#### 1. Clarke's Categories as Relational Namings — and the Inversion

Many of Clarke's categories (discursive constructions, political elements, temporal elements, major issues, symbolic elements, related discourses) are already relational in nature — they are not entities but relational namings. Since the architecture covers relation-namings connecting to relation-namings, these aspects require no special category treatment.

Clarke's relational analysis ("center on one element, draw lines to all others, specify the nature of each line") is offered as one possible approach — but with a trans-actional extension: **"center on a relation and attach entities to it"** is equally valid. The entity/relation distinction is perspectival, not sequential.

The pairwise procedure is available but not enforced. A deeper reason: a naming IS its stack. Engaging with it in relational context #47 potentially CHANGES it (new naming act, designation shift, new participation). The "same" naming after 200 engagements is not the same naming. The procedure presupposes entity-stability that the transactional ontology denies.

#### 2. No Enforced Procedure — Diffractory Methods

The platform does not enforce Clarke's sequential procedure (messy → ordered → relational). It is available for those who want it, but not normative. Instead, the platform encourages exploring the non-identical, superpositional nature of namings through multiple methods:

- **Differing narrations** (inspired by Oevermann's Entwurf principle): multiple competing narrative drafts about the same map/phase — each a different reading, not converging toward consensus but producing difference patterns
- **Aesthetic/artistic approaches**: visual, compositional, spatial means of engaging with the analytical material
- **Diffractory methods** (Barad): not reflection (mirroring the same) but diffraction (making difference patterns visible). Map iterations are understood not as linear progress but as **superpositions** — each version a perspective that may include "progress" but is not reducible to it. Older maps remain valuable as perspectives, not as superseded drafts.

The key insight: diffraction is already architecturally supported. Different `collapseAt` values on the same naming, different phases of the same map, literally different superposition collapses placed side by side — this IS diffraction.

#### 3. Social Theories as Namings on the Map

To prevent hidden social theories from entering the empirical process as unexamined dogmata, the platform encourages placing theoretical commitments ON the map as explicit namings — with their own inscription chains, designation histories, and provenance.

This is not a meta-level mixing problem. From the transactional standpoint (D/B, Adorno, Bourdieu, Rheinberger, Barad), the distinction between "empirical situation" and "research situation" is itself inter-actional (two separate domains, one containing the other). Transactionally: institutions are already constituted through theories (organizational theory, theories of power). Theories are already empirical in their effects (e.g., alt-right strategies structured around patterns derived from Foucault and Gramsci). The hospital is already theoretical; Foucault is already empirical.

The practical resolution: the distinction between what belongs to the "researched situation" vs. the "research situation" will emerge through the analytical process itself — different phases, different maps, different perspectival collapses. It does not need to be imposed a priori through ontological levels.

### Architectural Consequence

The 12 categories are NOT built into the tool as structural features (no fixed `kind` fields, no category UI that interpellates bureaucratic filling-in). Instead:

- **Comprehensiveness** is achieved through the collaborative research process: multiple researchers with different positionalities + the AI as context-sensitive interlocutor
- **The AI** uses the categories as sensitizing lenses in its co-researcher capacity — posing "have we considered X?" based on actual analytical state, not by iterating a fixed list
- **Deconstructive awareness** (discursive constructions, implicated actors) is an analytical sensibility, not a category to fill in
- **The map shows back**: the platform makes visible that namings are superpositions, that relations are namings, that the entity/relation boundary is perspectival — what paper cannot show
- **Centering on relations**: the UI supports centering on a relation-naming and attaching entities, not only the reverse
- **Theories on the map**: theoretical commitments are nameable, relatable, designatable — visible actants, not invisible lenses

Reference images: `~/Pictures/Clarkes-Situational-Matrix.png`, `~/Pictures/Abstract-Situational-Map-Messy-Working-Version.png`, `~/Pictures/Abstract-Situational-Map-Ordered-Working-Version.png`

---

## 12. The Unmarked — Extended Critique of Clarke's Categories (Session 11)

### Pre-Analytical Ontologization

Clarke's ordered working map requires the researcher to KNOW before analysis what is "human," "nonhuman," "discourse," etc. — instead of discovering through analysis what the human/nonhuman moments of a thing ARE. This is a **performative contradiction**: Clarke claims Foucault (discursive construction, power/knowledge), but "Human Actors" as category #1 presupposes the very anthropological figure whose historical constitution is Foucault's analytical object. The category performs exactly the pre-discursive subject constitution that Foucault dismantles.

Similarly, "Nonhuman Elements" as a category presupposes a human/nonhuman boundary that Haraway's entire project transgresses — despite Clarke claiming Haraway as a theoretical foundation. The ordered map operationalizes distinctions its own theoretical commitments deconstruct.

### The Structure of the Unmarked (Spencer-Brown / Luhmann / Rancière)

Every naming act draws a distinction (Spencer-Brown, *Laws of Form*). Every distinction simultaneously produces a **marked space** (what is named) and an **unmarked space** (what the naming leaves undesignated). The unmarked is not homogeneous — it has structure:

1. **Named exclusion**: the marked side of exclusion. Explicitly excluded from the category but recognized within the distinction's horizon. "Non-stakeholders" who are known to exist and known to not be stakeholders. Countable but excluded.

2. **The uncounted** (Rancière, *Disagreement*): everything the distinction cannot count. Not excluded (exclusion presupposes countability) but **structurally uncountable**. Glaciers, spirits, atmospheric CO2 concentrations, future generations, the naming act itself — all equally uncountable within a "stakeholder" frame, **no differentiation possible or necessary** from within the frame. They are not "absent" — they are present but as noise, not as signal.

The distinction between (1) and (2) is not a typology to apply but a structural property of every naming act: every distinction simultaneously defines what it counts and constitutes a horizon beyond which countability fails.

**The political/analytical act** is not differentiating WITHIN the uncounted but **making-countable** what was uncountable — which retroactively restructures the entire distinction. (Example: nominating a glacier for presidential election in Iceland is not arguing the glacier is a good candidate but disrupting the counting frame itself.)

### Clarke's Categories and the Unmarked

Clarke's categories pre-determine what is countable. "Human Actors" as a category does not just exclude glaciers from the human category — it renders the QUESTION of glacier-agency ontologically unaskable within the method. The categories not only pre-ontologize the marked; they simultaneously **fix the horizon of the unmarked**. What CAN'T appear as "human" or "nonhuman" becomes structurally invisible, and the fact of this structural invisibility is itself invisible — because the category presents itself as merely organizing what exists, not as constituting the boundary of countability.

**The ordered map destroys precisely the analytical capacity it claims to enable**: the messy map and the discursive map (especially Clarke's attention to implicated actors) are powerful tools for naming the unnamed. But the ordering step undermines this by pre-determining the counting frame. The damage is specifically in the ORDERED version — the messy version and the discursive map do not have this problem.

### Two Observation Levels of the Unmarked

Two distinct phenomena must not be conflated:

1. **Observed unmarked**: what the actors/discourses/institutions in the researched situation leave uncounted. The Spencer-Brown distinction operating in the **object of inquiry**. A policy document naming "stakeholders" produces an unmarked space — this is IN the data.

2. **Analytical unmarked**: what our own naming efforts leave uncounted. Second-order observation of our own observation. Reflexive awareness that WE haven't named something — this is about our research practice.

Both levels have the same structure (named exclusion + the uncounted). The key insight: Clarke's categories damage the **analytical level** specifically — they fix OUR counting frame, which then determines what we can see as uncounted in the observed situation. If our categories can't count glaciers-as-actors, we can't observe the glacier's uncountedness in the researched situation either.

### Inquiry as Dual Operation

Inquiry consists of two complementary operations:

**(a) Re-naming observed namings**: The observed naming already exists as empirical material (document-anchored). Our analytical act is a re-naming — CCS movement from cue through characterization to specification. Provenance: observed naming → our re-naming. This is what the current architecture handles well.

**(b) Naming observed unnameds**: Here there IS no observed naming to re-name. The analytical act is **constitutive** — it brings something into countability for the first time. The unnamed cannot be derived from a single document passage because the unmarked is not locatable in one place — it is a structural property of the PATTERN of namings. It arises as a cue through pattern analysis of relationings — through the **between** of namings, not from any single naming. It is a structural hole that becomes visible through the constellation (Benjamin/Adorno) of relational patterns.

### Constellation Grounding

The provenance of an observed-unnamed (type b) is not a document anchor but a **set of participations**. The silence is grounded by its relations to the namings whose pattern produces it. The silence names the hole; its participations point to the namings that constitute the boundary of the hole.

This is architecturally supported: a silence with `mode='silence'` can have participations to multiple other namings. The provenance is relational (participations), not textual (document anchor). No new provenance type is needed — the existing architecture handles this through the relational fabric.

### Deconstructive AI — Questions About Distinctions, Not Category Prompts

The AI must NOT reproduce Clarke's categories as questions. Not "did you consider nonhuman actors?" (which reinstates the category as slot) but questions that **challenge the distinction itself**:

- "What are the hybrid human/nonhuman moments in this element?" (questions the boundary)
- "What is the genealogy of this categorization?" (historicizes the frame)
- "What does this naming make uncountable?" (attends to the unmarked)
- "Which discourse constitutes this as a 'human' element?" (Foucault)
- "What is the relational pattern around this absence?" (constellation grounding)

The categories become questions ABOUT the distinctions, not prompts to fill in the distinctions. The AI operates **deconstructively**, not categorically. The structure of the unmarked (named exclusion / the uncounted) functions as a sensitizing reminder — "when you name something, ask what your naming makes uncountable" — not as a typology to apply.

### Architectural Consequence (extending Section 11)

- The AI's co-researcher capacity uses the 12 categories as **relational differances** (not axial codes, not real categories) — each category is a provocation to examine the distinction it draws, not a slot to fill
- The AI's methodology advisor capacity includes attention to the **frame of countability** — not just what's missing, but what the current constellation of namings makes structurally unnameable
- **Silences** grounded through participations (constellation grounding) are architecturally complete — no additional provenance type needed
- The distinction observed-unmarked / analytical-unmarked is articulated through **inscription and memos**, not through structural properties — this avoids pre-determining the distinction that should emerge through analysis

---

## 13. Maps as Perspectives (Session 13)

The Namings list IS the "one complete messy map" — complete, dimensionless, the privileged representation. Maps (canvas) are **curated perspectives** that select a subset of namings and collapse them into 2D space. Multiple maps are necessary — they are genuine perspectives, not copies.

### Three principles for multi-map architecture

1. **Structural integrity within a map**: If a relation appears on a map, its endpoints must too (auto-enforced, not manual).
2. **Cross-boundary signaling**: Maps show indicators for participations with namings outside the perspective. This marks what the map leaves uncounted — a direct application of the unmarked (Section 11). The user decides whether to pull outside namings in.
3. **Naming identity is suggestion-based**: Two separate naming acts creating the same inscription ARE two different namings. The system suggests existing namings when adding to a map; merge is available as explicit ground-truth surgery when duplicates are discovered.

### Two legitimate workflows

**(a) Document → Map** (re-naming observed namings): Import annotation-codes from documents, then relate and designate. Grounding is textual (document anchors). This is Clarke's standard path.

**(b) Direct Map** (naming observed unnameds): Name what is in the situation without documents first. Grounding is relational (participations/constellation). This corresponds to operation (b) from Section 11.

Both produce the same data structure. Both are available at any time. No enforced sequence — diffractory methods (Section 12).
