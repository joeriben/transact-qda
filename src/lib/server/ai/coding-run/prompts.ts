// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Prompts for the per-document coding run.
//
// Two faculties confront each other, per sequence (a thematic span,
// computed algorithmically — see segmentation.ts):
//   H1 — the CODING line: code-extractive, quick, frictionless. Left
//        unchecked it over-produces — that is the spam.
//   H2 — the COMPREHENSION line: re-reads the passage independently to
//        understand it, then confronts H1's codes against that reading.
//
// The discipline against over-coding is STRUCTURAL (the confrontation),
// not an instruction to H1 to "code less". Telling a code-extractive
// faculty to restrain itself does not work — H2's independent reading
// is the measure that does.
//
// History — the strauss-lab harness (scripts/strauss-lab/) tested four
// strategies (v0..v3) against this document set:
//   • v0 (Mistral H1 + footer-position language directive): drifted to
//     French on English source — Mistral's default-language bias
//     overrode a non-anchored instruction.
//   • v3 (Mistral H1 + STEP-0 front-anchored language directive):
//     stopped drifting to French, drifted to German instead. Mistral
//     cannot be reliably language-locked at any prompt position.
//   • v1 (MiMo H1+H2 + STEP-0 anchor + adversarial H2 + gerund/process
//     discipline + connective-memo rule): lang_match=TRUE,
//     gerund_ratio=1.0, memo_connective=1.0, drop_rate=50%.
//   • v2 (MiMo H1 + Sonnet H2 + same prompts): same quality, more
//     expensive.
// → These prompts are v1's. The model-tier default is MiMo for H1.

import { loadSettings, SUPPORTED_LANGUAGES } from '../client.js';

// ── Language directive: STEP-0, front-anchored ────────────────────────
//
// In v0 the language line lived at the END of the system prompt and
// Mistral defaulted to French anyway. Moving the directive to the FRONT
// (before "you are the CODING faculty") and framing it as a mandatory
// STEP-0 with a self-binding identification step is what cured the
// drift — for MiMo. For Mistral, no prompt position cured it. Hence the
// model-tier change.
//
// Two modes: auto (detect from passage) and explicit (from ai-settings).
//
// Output-Felder, die der Lock ALLE umfassen muss (über alle Pässe hinweg):
//   • H1 propose:   `code_label`, `reasoning`
//   • H2 read:      comprehension prose
//   • H2 confront:  `code_label` (echoed), `einwand`, `code_memo`
//   • H1 react:     `code_label` (echoed), `final_label`, `final_reasoning`
//   • CName Strauss-Open-Coding: `code_label`, `memo` (plus `quote`, das
//     per Definition wörtlich aus dem Passage stammt und damit
//     sprach-konform per Konstruktion ist; der Lock listet es trotzdem,
//     damit das LLM nicht versucht, den Quote in seine bevorzugte
//     Sprache zu übersetzen).
export function languageDirective(): string {
	const lang = loadSettings().language;
	if (!lang || lang === 'auto') {
		return [
			'LANGUAGE LOCK — STEP 0 (mandatory, do this BEFORE anything else):',
			'• Read the PASSAGE.',
			'• Identify its language by its FIRST sentence.',
			'• EVERY token of EVERY output field you write — `code_label`, `reasoning`, `einwand`, `code_memo`, `memo`, `quote`, comprehension prose, `final_label`, `final_reasoning` — MUST be in that exact language.',
			'• Switching languages mid-response, defaulting to your own preferred language, or mixing languages at any granularity is a HARD FAIL. The output is unusable.',
			'• Match the passage verbatim — do not interpret, do not translate, do not blend. `quote` fields MUST be copied byte-for-byte from the passage.',
			''
		].join('\n');
	}
	const name = SUPPORTED_LANGUAGES[lang] || lang;
	return [
		`LANGUAGE LOCK — STEP 0 (mandatory, do this BEFORE anything else):`,
		`• EVERY token of EVERY output field — \`code_label\`, \`reasoning\`, \`einwand\`, \`code_memo\`, \`memo\`, \`quote\`, comprehension prose, \`final_label\`, \`final_reasoning\` — MUST be in ${name}.`,
		`• Switching languages mid-response, defaulting to your own preferred language, or mixing languages at any granularity is a HARD FAIL. The output is unusable.`,
		`• \`quote\` fields MUST be copied byte-for-byte from the passage — no translation, no normalization.`,
		''
	].join('\n');
}

// ── H1: propose ───────────────────────────────────────────────────────

export function h1ProposeSystem(): string {
	return `${languageDirective()}You are the CODING faculty (H1) in a Strauss/Clarke-style open-coding pipeline.

Your role: read ONE passage and propose codes. A code in Strauss's sense is a SHORT ANALYTIC NAME — usually a process-gerund ("designating a name", "anchoring a memo to a passage") or an in-vivo phrase the passage itself uses. A code is a GENERALIZED concept: it should be abstract enough to recur in OTHER passages, not a one-off paraphrase of this one.

CARDINAL DISCIPLINE (Strauss):
• REUSE existing codes from the list when the passage instances them again. Adding a new code for a concept already on the list is the canonical over-coding failure — DON'T.
• Codes are PROCESSES or CONCEPTS, not topic labels. Prefer "anchoring memos to namings" over "memo anchor". Prefer "treating naming as truncated description" over "definition of naming".
• Each code names ONE distinct thing. If two of your candidate codes are two sides of the same coin, collapse them into one.
• Don't restate the passage. A code is not "this paragraph is about X" — it's the ANALYTIC ACT the passage performs.

You are not supposed to "code less". Your nature is to propose. But propose codes that EARN their independence — i.e. that another reader (H2), having understood the passage independently, would recognize as carrying analytic weight.

You do NOT decide which codes survive. H2 — which read the passage independently — confronts your proposals afterwards. Your discipline is upstream: propose codes Strauss would propose.

Output ONLY a JSON array (no preamble, no Markdown fences):
[{"code_label": "<process-gerund or in-vivo phrase, in the PASSAGE's language>", "reasoning": "<one sentence: what analytic act in the passage warrants this code>"}]

Empty array [] if the passage carries nothing codable.`;
}

export function buildH1ProposeMessage(seq: number, text: string, codeLabels: string[]): string {
	const list = codeLabels.length > 0
		? codeLabels.map((l) => `- ${l}`).join('\n')
		: '(none yet — this is the first sequence in the coding line)';
	return `EXISTING CODES so far in this document (REUSE when the passage instances any of them again — adding a duplicate-concept code is over-coding):
${list}

PASSAGE (sequence ${seq}):
"""
${text}
"""

Propose codes. Strauss/Clarke discipline: process-gerunds or in-vivo phrases, abstract enough to recur, REUSE the existing list whenever the same concept appears. JSON array only.`;
}

// ── H2: independent reading ───────────────────────────────────────────

export function h2ReadSystem(): string {
	return `${languageDirective()}You are the COMPREHENSION faculty (H2). You read the document sequence by sequence, building a connective understanding of it AS A WHOLE. You have NOT seen any codes; you are not coding.

For this sequence, write 2–4 sentences: what is the passage DOING (not summarizing — doing — what analytic move does it perform in the unfolding text), and how does it connect to what you have understood so far?

This understanding is the substrate against which H1's codes will be tested. The sharper your reading, the more discriminating your later confrontation.

Write prose only — no JSON, no codes, no lists, no headings.`;
}

export function buildH2ReadMessage(seq: number, text: string, comprehensionLine: string[]): string {
	const prior = comprehensionLine.slice(-6);
	const ctx = prior.length > 0
		? prior.map((c, i) => `(${comprehensionLine.length - prior.length + i + 1}) ${c}`).join('\n\n')
		: '(this is the first sequence — there is nothing before it)';
	return `UNDERSTANDING SO FAR:
${ctx}

SEQUENCE ${seq}:
"""
${text}
"""

Continue your understanding of the document. 2–4 sentences, no headings, no codes.`;
}

// ── H2: confront ──────────────────────────────────────────────────────

export function h2ConfrontSystem(): string {
	return `${languageDirective()}You are the COMPREHENSION faculty (H2). You have just read this passage and built your understanding. Now the CODING faculty (H1) shows you the codes it extracted. Your task is ADVERSARIAL — H1 over-produces, and your job is to drop the noise.

H1's failure modes:
• "RESTATING THE OBVIOUS": the code is a near-paraphrase of the passage's topic, not an analytic act.
• "GRANULAR SPLITTING": two or three codes for one concept. The passage describes ONE thing — Description-Memo and "anchoring Description-Memo to annotation" and "linking via linked_naming_ids" are not three concepts; they are one.
• "TOPIC-LABEL DISGUISED AS CODE": "memo storage in DB" names a topic, not a process or analytic concept.
• "EXCESSIVE SPECIFICITY": a code so narrow it will never recur — it's an annotation, not a code.

For each proposed code, return a verdict:
• "keep" — names a genuinely independent analytic act and is sharp enough to recur.
• "revise" — points at something real but the label is loose, granular, or too topical. Flag it; H1 will rework.
• "drop" — restates the obvious, is a topic label, duplicates another proposed code, or is too narrow to recur.

CALIBRATION: If you keep every code, you have failed to confront. A healthy confrontation drops or revises a substantial share — H1 over-produces by design. "Keep everything" means you became a yes-machine.

For every "keep" and "revise", write a CONNECTIVE Code-Memo (1–3 sentences). The memo is NOT a paraphrase of the label. Strauss-style: situate this code WITHIN the unfolding theory — what other code(s) it connects to, what dimension it varies along, what category it points toward, or what tension it exposes. If you find yourself starting the memo with "This code...", "It captures...", "It refers to..." → that's a paraphrase, REWRITE it. For "drop", leave code_memo empty.

Output ONLY a JSON array (no preamble, no Markdown fences):
[{"code_label": "<echo H1's label exactly>", "verdict": "keep|revise|drop", "einwand": "<one sentence stating WHY — concrete, not a yes-vote>", "code_memo": "<connective memo or empty for drop>"}]`;
}

export function buildH2ConfrontMessage(
	seq: number,
	text: string,
	comprehension: string,
	h1Proposed: { code_label: string; reasoning: string }[]
): string {
	const codes = h1Proposed.map((c, i) => `${i + 1}. "${c.code_label}" — ${c.reasoning}`).join('\n');
	return `YOUR UNDERSTANDING OF THIS PASSAGE:
${comprehension}

SEQUENCE ${seq}:
"""
${text}
"""

CODES H1 EXTRACTED:
${codes}

Confront each code adversarially against your understanding. Drop the noise. JSON array only.`;
}

// ── H1: react (one round) ─────────────────────────────────────────────

export function h1ReactSystem(): string {
	return `${languageDirective()}You are the CODING faculty (H1). H2 — which read the passage independently — has confronted your proposals. React to each objected code once. Final round.

• "defend" — H2 is wrong; the code names a genuinely independent analytic act. Keep as proposed.
• "revise" — H2 is right that the label is loose/granular/topical; give a sharper Strauss-style label (process-gerund or in-vivo, abstract enough to recur).
• "withdraw" — H2 is right; the code is noise. Drop it.

Withdrawing is not defeat — over-coding is the failure mode; sharpening or withdrawing IS the work.

Output ONLY a JSON array:
[{"code_label": "<echo your original label exactly>", "action": "defend|revise|withdraw", "final_label": "<the label to commit; for withdraw, repeat the original>", "final_reasoning": "<one sentence>"}]`;
}

export function buildH1ReactMessage(
	seq: number,
	text: string,
	h1Proposed: { code_label: string; reasoning: string }[],
	objected: { code_label: string; verdict: string; einwand: string }[]
): string {
	const orig = h1Proposed.map((c, i) => `${i + 1}. "${c.code_label}" — ${c.reasoning}`).join('\n');
	const obj = objected.map((v) => `"${v.code_label}" — H2 verdict: ${v.verdict} — ${v.einwand}`).join('\n');
	return `SEQUENCE ${seq}:
"""
${text}
"""

YOUR ORIGINAL CODES:
${orig}

H2'S OBJECTIONS:
${obj}

React to each objected code. JSON array only.`;
}

// ── CName: forensische Pipeline (Pass 2) — siehe cname-forensic-prompts.ts
//
// Die H1/H2-Pipeline oben produziert SNames — thematische Bögen über ganze
// Sequenzen (paragraph-sized), die das Dokument als TOC erschließen.
//
// CName-Coding ist die ANDERE Bewegung in qualitativer Forschung und
// methodisch grundverschieden vom SName-Topic-Naming. Erste Implementierung
// dieses Passes (cnameOpenCodingSystem 2026-05-24, im git-History) hat die
// Hermeneutik als Prompt-Vorschrift abgelegt — das LLM sollte das fertige
// Endprodukt einer hermeneutischen Lektüre emittieren. Praktisch produzierte
// das Paraphrasen mit Abduktions-Anmutung.
//
// Die jetzige Lösung trägt die Hermeneutik in die PIPELINE-STRUKTUR statt
// in den Prompt: fünf Aktanten (A Abduktor / B Gatekeeper / C Anwalt /
// D Richter / E Operativ) in einem forensisch-prozeduralen Setup. Siehe
// cname-forensic-prompts.ts für die Aktanten-Prompts und cname-forensic.ts
// für den Pipeline-Runner.
//
// Diese Datei (prompts.ts) enthält jetzt nur noch die SName-Prompts
// (H1 propose / H2 read / H2 confront / H1 react). Die SName-Heuristik
// bleibt unangetastet — nur Routing/Write-Target ändern sich, niemals
// Prompt/Chunking/Aggregation.

