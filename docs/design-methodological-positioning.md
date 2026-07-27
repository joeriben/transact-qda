# Methodological Positioning — transact-qda and the "Verteilte Interpretation" Program (Schäffer / Lieder)

*Claude Opus 4.8, with Benjamin Jörissen — June 13, 2026. A cross-reference memo: situates transact-qda relative to the KISOFT / DokuMet QDA research program of B. Schäffer's group. Applies transact-qda's own principle — theories as visible namings (Manual §6.3) — to transact-qda itself.*

---

## 0. Why this memo

transact-qda and the Munich **KISOFT** project (B. Schäffer, F. R. Lieder; **DokuMet QDA**) independently build *AI-supported reconstructive* QDA. They are the two most theoretically explicit attempts of this kind, and they diverge in instructive ways. Recording the relationship keeps the methodological commitments visible rather than implicit.

Primary reference: Schäffer & Lieder (2023), *Distributed interpretation*, JRTE 55(1), 111–124. Program arc: Lieder & Schäffer (2023 → 2025 → 2026, *Reconstructive Social Research Prompting*) culminating in Schäffer, Lieder & Krämer (2026), *Interpretieren zusammen mit KI*.

---

## 1. Two branches of computational reconstructive method

Both projects descend from American pragmatism, through *different* reconstructive lineages:

- **Schäffer / Lieder — documentary-method branch.** Bohnsack ← Mannheim, Garfinkel; praxeological sociology of knowledge; the *group* as carrier of *collective orientations* (modus operandi, conjunctive experience); interpretation in two moves — *formulating* (FI: what is said) and *reflecting* (RI: the frame-of-orientation, reconstructed **comparatively**). Operationalized as **Reconstructive Social Research Prompting (RSRP)**: a modular few-shot prompt (3 FI/RI exemplars + 1 passage to interpret) plus iterative human–LLM refinement. Note: the method is *not* group-discussion-bound; GD is its classic empirical object, not its scope.
- **transact-qda — situational-analysis branch.** Clarke ← Strauss, corrected by Dewey/Bentley's trans-action and Barad/Haraway. The *naming act* as unit; CCS designation gradient; relations as first-class namings; researcher and AI as namings; **document/collection-type agnostic** (no primary/secondary corpus, Manual §2.5).

They are not the same method twice computationalized but **two species of one genus** — Nelson (2020), *computational grounded theory*, is the shared ancestor reference (Schäffer names a "computational documentary method"; transact-qda is, in effect, a computational situational analysis).

---

## 2. Shared pragmatist ground

- **Abduction (Peirce / Reichertz).** Schäffer: AI generates "abductive leaps" by irritation. transact-qda: CName actant **A (Abduktor)** is explicitly Peircean — *"a SURPRISING observation … a HYPOTHESIS that EXPLAINS the surprise … must LEAVE the nearest training frame"* (`src/lib/server/ai/coding-run/cname-forensic-prompts.ts`).
- **Anti-subsumptive.** Both refuse content-analytic coding (Mayring) as the default inscription of CAQDAS.
- **Reflexive researcher.** Schäffer: interpretation distributed across a collective. transact-qda: Forscher-als-Naming — the researcher is a participant in the situation (Barad: intra-action; Haraway: situated knowledges), `by`-attributed.
- **Flat human/nonhuman.** Latour's hybrid actor ↔ Clarke/Barad heterogeneous actants + naming-as-actant.

---

## 3. Where transact-qda articulates what the program *names*

The program offers *concepts*; transact-qda gives several of them *ontological/operational form*.

1. **Distributed interpretation → transactional distribution.** Pea's "distributed intelligence," for Schäffer a *description of practice*, becomes a *property of the substrate*: every `naming_acts.by` references a naming, and both researcher and AI are namings. The "collective of interpreters" = a relational fabric of attributable acts. Dewey/Bentley's trans-action supplies the ontological grammar Pea's frame leaves implicit.
2. **Hidden-layer problem → append-only provenance.** Schäffer's central problem (the abductive step is unreconstructable, doubled by the net's hidden layers) he resolves by *acceptance* — Ungewissheitstoleranz (Luhmann). transact-qda resolves it differently in kind: not by opening the net but by forcing the *interpretive product* into accountability — every act an append-only `naming_act` with designation, memo, grounding. It converts Ungewissheitstoleranz from a subjective attitude into an **infrastructural property** (provenance × contestability). *Limit:* provenance records *that* the AI named, not *how* it interpreted; genesis stays hidden (§4.1).
3. **The "new method skill" of rejecting AI offers.** Two loci. (a) *Human* — AI namings enter at `cue` (`write.ts` forces `'cue'`); only the researcher elevates; "discussion, not accept/reject" (Manual §5.7). (b) *Machine* — H1/H2 confrontation models rejection *inside* the pipeline (H2 drops H1's noise). The second locus is a tension, not a virtue (§4.2).
4. **Productive irritation → cue-level offers on the bidirectional gradient.** "Another way of reading" = a low-designation naming awaiting CCS work; because designation is bidirectional, AI irritation can dissolve a human specification back to a cue (Barad's destructive interference).
5. **Hybrid research workshop → collaboration + memo lifecycle.** Multi-user (roles enforced), researcher/AI-as-namings, the memo lifecycle (active → … → promoted/dismissed) and researcher↔AI threads model the workshop's discursive negotiation. A candidate *infrastructure* for the hybride Forschungswerkstatt — on a transactional substrate.
6. **Computational reconstructive method — siblings.** "computational documentary method" ↔ "computational situational analysis."

---

## 4. Tensions

1. **Verifiability vs. Ungewissheitstoleranz.** Provenance accounts for the *act*, not the LLM's *reasoning*. The Herstellungsprozess (abductive genesis) remains as hidden here as anywhere; provenance is *traceability*, not transparency-of-genesis. This is a real fortification of accountability — and a real limit a documentary purist would name.

2. **Rejection automated, not cultivated — the HITL inversion.** The document-coding pipeline is **AI-autonomous**: H1/H2 survivors *and* CName commits are written directly as namings at `cue`-level, with **no human approval gate** (`orchestrator.ts`; `write.ts`). The human is *on* the loop (post-hoc designate / withdraw), not *in* it. The critical-rejection competence (H2) and the justification procedure (CName Anwalt/Richter: ISOMORPH / PRÄZISIERT / UNPLAUSIBEL) run **among LLM actants**. Schäffer's whole point is that *the human collective* performs the sifting and justification ("zwangloser Zwang des besseren Arguments," Habermas — among *researchers*). Staging that argument among AI personae inverts his model: human as auditor, not interpreter — the "becoming comfortable as a researcher" his participants feared.
   - **Internal inconsistency.** The Richter's `UNPLAUSIBEL` verdict commits nothing — the machine's *rejected* abductions leave no trace. transact-qda's own doctrine: the unmarked / patterns of non-presence are **positive findings** (Manual §2.4; Foundations §11). The pipeline discards exactly what the doctrine says to keep. *(Partly addressed by the §7.1 spike: UNPLAUSIBEL verdicts are now logged append-only — branch `spike/cname-comparanda`, not yet merged.)*
   - **Mitigation.** Everything commits at `cue` — the lowest designation, never a "finding"; elevation is human-only. So the pipeline is a *cue-generator at scale* (mass irritation) and preserves designation authority. But CName *adjudicates* before depositing, so the human sees the survivors of a machine tribunal, not the alternatives. The mitigation holds for raw H1, weakens for CName.
   - **Counter-posture.** The *canvas* AI is Schäffer-aligned — cue-only, Socratic, "discussion not accept/reject," researcher as epistemic authority (Manual §5.7). transact-qda holds **two opposite HITL postures** in its two halves.

3. **Collective as interaction, not as carrier.** Multi-user supports researcher *interaction* (shared memo threads). But every `naming_act` has a single `by`: there is no supra-individual object for a *collective orientation* (Bohnsack's conjunctive modus operandi). transact-qda is **methodologically individualist at the attribution layer**. The primitives (phase / perspective-naming / constellation-grounded silence) could *build* a shared-orientation object, but none is modeled as such. And roles are *permissions* (owner/admin/member/viewer), not a *learning trajectory* (Lave & Wenger's legitimate peripheral participation) — the *pedagogical* core of Schäffer's collective has no representation.

4. **One AI vs. a plurality of standpoints.** Schäffer's desideratum: AI "should simulate different persons who all offer different interpretations of the same passage" (the spider sifting many readings; Licklider). transact-qda has *one* AI-naming per project. CName stages multiple AI personae, but as a *procedural division of labor* (a tribunal), not a *plurality of perspectives*. Perspective-differentiated AI — several AI-namings, each bound to a theoretical perspective (§6), each depositing cues — would be both Schäffer-aligned and transact-qda-consistent (situated knowledges, diffraction).

5. **FI/RI vs. CCS / open-coding.** transact-qda has no documentary (formulating/reflecting) pass. RSRP is FI/RI-shaped. Incorporating it = a *separate* pass alongside SName (open-coding) and CName (abductive-forensic) — **never** a modification of the H1/H2 heuristic. And FI/RI presupposes the conjunctive/praxeological frame (Orientierungsrahmen, comparative analysis) that transact-qda's Clarke/Barad substrate does not natively carry.

---

## 5. Crosswalk

| Schäffer / Lieder (KISOFT / DokuMet QDA) | transact-qda articulation | Status |
|---|---|---|
| Distributed interpretation (Pea) | `by`-attributed naming acts; Forscher- & KI-als-Naming | **ontologized** |
| Hidden-layer problem | append-only `naming_acts` + provenance (CCS × grounding) | **reframed** (act accountable, net not transparent) |
| Opaque other / oracle | AI-as-Naming, cue-only, contestable | partial convergence |
| Method skill: reject the offer | designate/withdraw (human) + H1/H2 confrontation (machine) | **operationalized**, with HITL inversion (§4.2) |
| Productive irritation / "another reading" | cue-namings on the bidirectional CCS gradient | **ontologized** |
| Research workshop / community of practice | multi-user + memo lifecycle + researcher↔AI threads | infrastructural analogue (no learning trajectory) |
| Collective orientation (Bohnsack) | *(none)* — single `by` per act; pattern over participations at best | **divergent** (§4.3) |
| Plurality of AI interpreters (Licklider) | one AI-naming; CName = procedural tribunal | **divergent / opening** (§4.4) |
| RSRP (modular FI/RI prompting) | *(absent)* — would be a separate pass | **divergent / opening** (§4.5) |
| Ungewissheitstoleranz (Luhmann) | provenance + contestability as infrastructure | **converse strategies** |
| Computational documentary method (Nelson) | computational situational analysis (transactional) | sibling species |

---

## 6. Theories on the map: grounding ≠ truth

"Theories as visible namings" (Manual §6.3; Foundations §12) is currently a docs principle — `mode='perspective'` exists but no user action places a theory as one (`namings.ts setAppearance` is internal-only). *Where* should it be concretized? **Not as grounding.**

- **Grounding ≠ truth.** Grounding = a document anchor = empirical *traceability* to a corpus location (Manual §2.5). There is no validity field anywhere; validity lives in the contestable append-only stack. "Ground truth" (the data-structure layer, §4) and "grounded" (has a 📄) are *different senses of ground*. A naming anchored to a Bourdieu passage is *traceable*, not *true*.
- **Orthogonality already houses theory.** CCS ⊥ grounding: *"a specification CAN be ungrounded — a theoretical construct not yet tied to empirical material"* (Manual §2.5). A theory's natural home is a **well-specified, ungrounded** naming (📝-reflected, not 📄-anchored).
- **Apply theory as a perspective, not a ground.** A theory is a *way of seeing*: model its *application* as `mode='perspective'` + `collapseAt` + participations to the namings it illuminates — exactly transact-qda's diffraction machinery. A perspective is constitutively a standpoint, never a ground; the "grounded truth" worry dissolves. The theory *text* remains separately groundable (traceability) without thereby becoming *true*.
- **Branch divergence.** Making theory a co-present, applicable naming is a *Clarke/SA* move ("there is no context; the hospital is already theoretical, Foucault already empirical," Foundations §12). The *documentary* stance brackets theory (epoché) during reconstruction, admitting it only at Typenbildung. The reflex "then a theory-interpretation becomes grounded truth" is itself a *documentary-method reflex* — the fear that theory contaminates reconstruction. transact-qda's SA-consistent answer is theory-as-contestable-perspective; a documentary purist would still bracket. This divergence is worth keeping explicit.

---

## 7. Open questions / minimal increments

Each with a kill criterion; none touches the H1/H2 heuristic.

**The strand these converge on.** The critique-attractor (∃-negation is game-theoretically cheap; the *adjudicating* actant — here the CName Richter — drifts to the cheap `UNPLAUSIBEL` verdict) is defeated not by *more standpoints* but by *constructive* reflection: comparison. Comparison is endogenous to t-qda's own lineage — GTM constant comparison = reconstruct-by-contrast, not match. The asymmetry to fix: comparison is wired for the **human** (ComparisonPanel; embedding "similar passages") but no LLM-naming-agent reasons comparatively, and the one agent-side use (the Autonoma >0.85 dedup) is *subsumptive* (match→copy) — the content-analytic logic the tool opposes. (t-qda has NO "cop" roles — the "bad cop" figure belongs to a different design. t-qda's CName is advocate (Anwalt, constructive) vs. judge (Richter), so the drift is an *under-resourced advocate*, not a mandated critic.)

1. **Comparanda for the CName Anwalt — PRIMARY.** Feed the existing embedding retrieval (`findSimilarWithCodes` / `retrieveComparisonMaterialForText`, `src/lib/server/ai/coding-companion/retrieval.ts`) into actant **C only** (additive to its keyword memo-search); instruct C to build the case *by contrast* (instance an existing naming, or name the discriminating dimension). Leave **D (Richter) untouched** — let better evidence shift the verdict organically. Pair with: log `UNPLAUSIBEL` (silence-doctrine: a rejected abduction is a positive finding — and the measurement substrate for the test). *Test:* on one already-coded document, does the verdict distribution shift `UNPLAUSIBEL → PRÄZISIERT`, with substantive contrasts (a discriminating dimension, not a restatement)? *Kill:* no shift / vacuous contrasts → revert; the drift is not comparanda-limited.
   *Built 2026-06-13, not yet merged:* `retrieveComparisonMaterialForText` (cross-document, ≤6 similar passages + their codes) is injected into the Anwalt's **C-1 and C-2** messages, gated by `TQDA_CNAME_COMPARANDA` (default off → baseline byte-identical), with one added system instruction to build the case *by contrast* (reuse an existing naming, or name the discriminating dimension). Retrieval failure degrades to the baseline Anwalt; **D (Richter) and the H1/H2 SName pass are untouched**. `UNPLAUSIBEL` verdicts are logged append-only to `.tmp-cname-unplausibel/{runId}.jsonl` — a positive finding, *not* a reified DB trace-object (see the silence doctrine in `design-begleiten.md`). **A/B procedure:** on one already-coded document, run CName twice — `TQDA_CNAME_COMPARANDA` unset vs. `=1`, same model tier — then compare the verdict distribution in `.tmp-forensic-trace/{runId}.jsonl` (count ISOMORPH / PRÄZISIERT / UNPLAUSIBEL). The test passes iff the treatment arm shifts `UNPLAUSIBEL → PRÄZISIERT` **and** the PRÄZISIERT memos cite a discriminating dimension drawn from a comparison passage (not a restatement).
2. **Rejection as a positive trace (researcher side).** Make researcher-rejection a first-class logged act (a downward designation, or withdraw-with-reason, `by = researcher`), so "what the collective rejected, and why" is analyzable — consistent with the silence-as-positive-finding doctrine. *Kill:* if rejections are never revisited analytically, drop.
3. **FI/RI as a separate, document-agnostic pass.** Revisit only *if* (1) shows reconstruction still starves. Prototype one formulating/reflecting reconstruction on one document; test whether its *reflecting* move (Orientierungsrahmen) yields cues distinct from SName open-coding and CName abduction. *Kill:* no analytic distinctness → drop.
4. **A collective-orientation object.** Explore whether a phase / perspective-naming can carry a *shared* orientation (across researchers or cases) without collapsing to a single `by`. *Kill:* if indistinguishable from an ordinary phase, drop.

*Superseded:* "perspective-differentiated AI / multiply standpoints" — rejected by the critique-attractor (more standpoints multiply critics, not readings).

---

## References

- Schäffer, B. & Lieder, F. R. (2023). Distributed interpretation – teaching reconstructive methods in the social sciences supported by artificial intelligence. *Journal of Research on Technology in Education*, 55(1), 111–124.
- Lieder, F. R. & Schäffer, B. (2026). Reconstructive Social Research Prompting. Distributed Interpretation Between AI and Researchers. In: *Digital Hermeneutics II*, LNCS 14566. Springer.
- Lieder, F. & Schäffer, B. (2023). Lehren und Lernen rekonstruktiver Forschungsmethoden mit generativen Sprachmodellen in hybriden Forschungswerkstätten. *Journal für Psychologie*, 31(2), 131–154.
- Lieder, F. & Schäffer, B. (2025). Qualitative Methodenausbildung zusammen mit generativen Sprachmodellen. Zur Verteilten Interpretation in hybriden Forschungswerkstätten. SocArXiv preprint tx6y4.
- Schäffer, B., Lieder, F. & Krämer, F. (2026). *Interpretieren zusammen mit KI*. Springer VS.
- Nelson, L. K. (2020). Computational Grounded Theory. *Sociological Methods & Research*, 49(1), 3–42.
- Bohnsack, R. (2010 / 2014). Documentary method and group discussions / Documentary method.
- Pea, R. D. (1993). Practices of distributed intelligence and designs for education.
- Internal: `docs/manual.md`, `docs/design-begleiten.md`, `docs/design-provenance-and-codes.md`, `src/lib/server/ai/coding-run/` (SName H1/H2; CName forensic A–E).
