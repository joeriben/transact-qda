# Memo Ontology

*Attributions to Benjamin Jörissen were checked against the session records and corrected on 2026-11-09; formulations of the assistant are marked.*

Foundation: Dewey/Bentley, "Knowing and the Known" (Ch. VI, Specification).

> "A name is in effect a truncated description. A description is an expanding naming."

This applies to ONE naming. Inquiry itself is not a naming — it is the medium in which namings are produced. *(Formulation of the assistant in session 16 (2026-03-16), in reply to BJ's question „Ist ein Memo dann überhaupt ein eigenständiges Naming oder integraler Teil dieses inquiry-Prozesses?“ — is a memo a naming of its own at all, or an integral part of this inquiry process? BJ agreed to the two memo modes below: „Ja, zwei Modi“.)*

## Memo Types

| Type | Mode | Where | Purpose | Implementation |
|------|------|-------|---------|----------------|
| **Description-Memo** | Stack-integral | `naming_acts.memo_text` | Expanding form of a single naming. Captures passage-specific nuance. | Created during annotation (Naming-Memo field) or retroactively (+ Memo on passage card). Linked to annotation via `linked_naming_ids`. Part of the naming's designation stack. |
| **Analytical Memo** | Inquiry-medium | `memo_content` table | Reflexive inquiry spanning constellations or the research process. Incl. organizational memos (sampling strategy, data collection); BJ, session 16 (2026-03-16): „Und es gibt natürlich auch noch organization Memos, die sich z.B. auf die Erhebugnsstrategie beziehen“. Filing them under analytical memos was decided by a review agent of the assistant in session 16, not by BJ. | Created in `/memos` or inline (document memo). Not a naming as long as the researcher does not explicitly make it one; BJ, session 16 (2026-03-16): „kein Naming, solange man sie nicht dezidiert zu einem Naming macht“. Can be **promoted** to map-visible naming. *Current implementation:* stored as a naming in the DB, without appearances on map perspectives. |

## Key Principles

### No AI/Human binary
*(Formulation of the assistant, session 16; "co-inquirers" and "separate UI flows" are not BJ's words.)*
Analytical memos are the shared medium of the **Interpretations-Kollektiv** (researcher + AI as co-inquirers). The distinction is **provenance** (who authored, when, with what epistemic authority) — not type. One memo system, one discussion mechanism, one visibility pattern. Provenance markers signal epistemic status without creating separate UI flows.

"Interpretations-Kollektiv" was BJ's question, and he set three conditions; BJ, session 16 (2026-03-16): „Korrekt ist, AI Memos müssen immer human-filtered werden. Aber wurden human-memos überhaupt bedacht?“ — „Und zwar als Interpretations-kollektiv? - Ich will hier nicht alle genetischen Spuren verwischen, und AI-Kritik muss ein maßgebliches Moment sein auf der Strukturebene.“ (AI memos must always be human-filtered; were human memos considered at all — as an interpretation collective? I do not want to erase all genetic traces, and AI critique must be a decisive moment at the structural level.) The three conditions: AI memos are always filtered by a human; the genetic traces stay visible; AI critique works at the level of structure.

### Description-Memo lifecycle
1. During annotation: optional Naming-Memo captures why this passage is named this way
2. Retroactively: `+ Memo` on any expanded passage card in the Passages panel
3. Storage: `naming_acts` row on the **naming** (not the annotation), with `linked_naming_ids: [annotationId]`
4. Visibility: appears in the naming's designation stack (Namings panel, expanded), and on the passage card

### Analytical Memo lifecycle
1. Created: in `/memos` page, or via document memo input (Namings panel footer)
2. Can link to documents or other namings
3. Can be **promoted** to a map-visible naming (explicit transition from inquiry-medium to data-structure)
4. Both AI and researcher produce these. AI memos are always filtered by a human (BJ, see above) and have a lifecycle of their own (proposed by the assistant, approved by BJ, session 16).

### Stack relationship
A naming's stack = its `naming_acts` entries ordered by `seq`. This includes:
- Designation changes (CCS: cue → characterization → specification)
- Inscription changes (renames)
- Description-Memos (passage-specific observations)

A Description-Memo is itself a designation act in the stack: a memo on a cue lifts it to characterization. BJ, session 08 (2026-03-11): „"reflected" ist doch falsch. ein reflected cue ist mindestens eine characeriztation“ (a reflected cue is at least a characterization). BJ, 2026-11-09: „Wenn ich ZU einem Naming ein MEMO anlege, dann kann das ja wohl logischerweise kein EIGENES NAMING sein“ (if I create a memo ON a naming, it logically cannot be a naming OF ITS OWN).

A naming **IS** its stack — it does not *have* a history the way a file has metadata.

## References
- Session 16: ontological foundation
- Session 28: Code-Memo field added to annotation workflow
- Session 29: retroactive passage memo, Namings panel shows stack + memos
- D/B: Dewey & Bentley (1949), Knowing and the Known, Chapter VI
