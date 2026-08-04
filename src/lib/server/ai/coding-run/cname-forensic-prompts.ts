// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Forensische CName-Pipeline — Prompts, Output-Typen und Parser.
//
// Designprinzip (User-Korrektur 2026-05-24): die Aktanten sind LLMs, die
// natürliche Sprache lesen und schreiben. Strukturierte JSON-Felder als
// PFLICHT-Schema sind Über-Formalisierung — sie cramp die Argumentation
// in Feldschablonen, deren Form-Failures nichts mit der methodologischen
// Aufgabe zu tun haben (siehe ersten Lauf 09d42946: "no usable advocacy"
// in 7+ Sequenzen, weil MiMo den Pflicht-Boolean `evidence_sufficient`
// nicht typisierte, obwohl die Anwaltsschrift inhaltlich brauchbar war).
//
// Daher: REASONING in PROSA, STRUKTUR nur an den Pipeline-Nahtstellen.
// Jeder Aktant schreibt einen freien Prosatext (2-5 Sätze) und hängt am
// Ende EINEN minimalen Tag oder Commit-Block an. Drei Stellen brauchen
// parsbare Form, alles andere bleibt Prosa:
//
//   1. ROUTING-FLAGS:
//      • B endet mit  [TRIVIAL]  oder  [NON-TRIVIAL]
//      • C endet mit  [EVIDENCE-FROM-CONTEXT]  oder
//                     [EVIDENCE-COMPLETE]  oder
//                     [NEED-MEMO-SEARCH: term1; term2; term3]
//      • D endet mit  [VERDICT: ISOMORPH]      (+ Commit-Block) oder
//                     [VERDICT: PRAEZISIERT]   (+ Commit-Block) oder
//                     [VERDICT: UNPLAUSIBEL]   (kein Commit-Block) oder
//                     [NEED-THIRD-EVIDENCE: term1; term2]
//
//   2. COMMIT-BLOCK (drei Zeilen am Ende von A und — bei
//      ISOMORPH/PRAEZISIERT — von D):
//          CODE: <label>
//          MEMO: <characterization>
//          ANKER: <verbatim quote>
//
//   3. A's NICHTS-Ausgang:  schlicht  KEINE ABDUKTION  (allein stehend).
//
// Parser-Disziplin: Regex auf Tags und Commit-Block-Zeilen. KEIN JSON-
// Parsing. Wenn MiMo den Tag vergisst → defensive Defaults (B: non-
// trivial, D: unplausibel, also "safe"-Richtung).
//
// Sprach-Lock: STEP-0-languageDirective() vor jedem System-Prompt. Code,
// Memo, Begründungs-Prosa, Anker-Quote — alles in der Sprache des
// Transkripts. Quote MUSS byte-für-byte aus der Passage stammen.

import { languageDirective } from './prompts.js';

// ── Output-Typen (discriminated unions, vom Parser produziert) ────────

export interface CommitForm {
	label: string;
	memo: string;
	quote: string;
}

export type AbduktorOutput =
	| { kind: 'no-abduktion' }
	| { kind: 'abduktion'; prose: string; commitForm: CommitForm };

export interface GatekeeperOutput {
	verdict: 'trivial' | 'non-trivial';
	prose: string;
}

export type AdvocateOutput =
	| { kind: 'evidence-from-context'; prose: string }
	| { kind: 'evidence-complete'; prose: string }
	| { kind: 'need-memo-search'; searchTerms: string[]; prose: string };

export type JudgeOutput =
	| { kind: 'isomorph' | 'praezisiert'; prose: string; commitForm: CommitForm }
	| { kind: 'unplausibel'; prose: string }
	| { kind: 'need-third-evidence'; searchTerms: string[]; prose: string };

// ── Parser helpers ────────────────────────────────────────────────────

function stripQuotes(s: string): string {
	return s.trim().replace(/^["'„«»]+|["'„«»]+$/g, '').trim();
}

/**
 * Extrahiert den Commit-Block (CODE: / MEMO: / ANKER: in beliebiger
 * Reihenfolge, jede Zeile beginnt mit dem Key) aus einem Text. Erwartet
 * Single-Line-Werte; mehrzeilige MEMOs werden bis zur nächsten erkannten
 * Key-Zeile zusammengefasst.
 */
function extractCommitBlock(text: string): CommitForm | null {
	const lines = text.split('\n');
	let label = '';
	let memo = '';
	let quote = '';
	let active: 'code' | 'memo' | 'anker' | null = null;
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) {
			active = null;
			continue;
		}
		const codeM = line.match(/^CODE\s*:\s*(.*)$/i);
		const memoM = line.match(/^MEMO\s*:\s*(.*)$/i);
		const ankerM = line.match(/^ANKER\s*:\s*(.*)$/i);
		// Routing-Tags brechen die Block-Erfassung
		if (line.match(/^\[\s*(TRIVIAL|NON-TRIVIAL|VERDICT|NEED-|EVIDENCE-)/i)) {
			active = null;
			continue;
		}
		if (codeM) {
			label = stripQuotes(codeM[1]);
			active = 'code';
		} else if (memoM) {
			memo = stripQuotes(memoM[1]);
			active = 'memo';
		} else if (ankerM) {
			quote = stripQuotes(ankerM[1]);
			active = 'anker';
		} else if (active === 'memo') {
			memo = memo ? memo + ' ' + line : line;
		} else if (active === 'code' && !label.includes(' ')) {
			// label continuation only if label is still short (defensive)
			label += ' ' + line;
		}
		// anker NEVER continues — byte-for-byte single-line discipline
	}
	if (!label || !memo || !quote) return null;
	return { label, memo: memo.trim(), quote };
}

export function parseAbductor(text: string): AbduktorOutput {
	const trimmed = (text ?? '').trim();
	if (!trimmed) return { kind: 'no-abduktion' };
	// "KEINE ABDUKTION" — auf eigener Zeile oder als (einziger) Text
	const hasKeineAbduktion = /(^|\n)\s*KEINE\s+ABDUKTION\s*($|\n)/i.test(trimmed);
	const hasCommitBlock = /(^|\n)\s*CODE\s*:/i.test(trimmed);
	if (hasKeineAbduktion && !hasCommitBlock) return { kind: 'no-abduktion' };

	const commitForm = extractCommitBlock(trimmed);
	if (!commitForm) return { kind: 'no-abduktion' };

	// Prose = alles vor der ersten CODE/MEMO/ANKER-Zeile
	const firstKeyMatch = trimmed.match(/(?:^|\n)\s*(CODE|MEMO|ANKER)\s*:/i);
	const prose = firstKeyMatch
		? trimmed.slice(0, firstKeyMatch.index!).trim()
		: '';

	return { kind: 'abduktion', prose, commitForm };
}

export function parseGatekeeper(text: string): GatekeeperOutput | null {
	if (!text) return null;
	const matches = [...text.matchAll(/\[\s*(TRIVIAL|NON-TRIVIAL)\s*\]/gi)];
	if (matches.length === 0) return null;
	const last = matches[matches.length - 1];
	const verdict =
		last[1].toUpperCase() === 'TRIVIAL' ? ('trivial' as const) : ('non-trivial' as const);
	const prose = text.slice(0, last.index!).trim();
	return { verdict, prose };
}

export function parseAdvocate(text: string): AdvocateOutput | null {
	if (!text) return null;
	const nmsMatch = text.match(/\[\s*NEED-MEMO-SEARCH\s*:\s*([^\]]+)\]/i);
	if (nmsMatch) {
		const terms = nmsMatch[1]
			.split(/[;,]/)
			.map((t) => t.trim())
			.filter(Boolean)
			.slice(0, 5);
		if (terms.length === 0) return null;
		return {
			kind: 'need-memo-search',
			searchTerms: terms,
			prose: text.slice(0, nmsMatch.index!).trim()
		};
	}
	const efcMatch = text.match(/\[\s*EVIDENCE-FROM-CONTEXT\s*\]/i);
	if (efcMatch) return { kind: 'evidence-from-context', prose: text.slice(0, efcMatch.index!).trim() };
	const ecMatch = text.match(/\[\s*EVIDENCE-COMPLETE\s*\]/i);
	if (ecMatch) return { kind: 'evidence-complete', prose: text.slice(0, ecMatch.index!).trim() };
	return null;
}

export function parseJudge(text: string): JudgeOutput | null {
	if (!text) return null;
	// NEED-THIRD-EVIDENCE zuerst (kann mit [VERDICT: ...] kollidieren)
	const nteMatch = text.match(/\[\s*NEED-THIRD-EVIDENCE\s*:\s*([^\]]+)\]/i);
	if (nteMatch) {
		const terms = nteMatch[1]
			.split(/[;,]/)
			.map((t) => t.trim())
			.filter(Boolean)
			.slice(0, 3);
		if (terms.length === 0) return null;
		return {
			kind: 'need-third-evidence',
			searchTerms: terms,
			prose: text.slice(0, nteMatch.index!).trim()
		};
	}
	const unMatch = text.match(/\[\s*VERDICT\s*:\s*UNPLAUSIBEL\s*\]/i);
	if (unMatch) return { kind: 'unplausibel', prose: text.slice(0, unMatch.index!).trim() };

	const isomorphMatch = text.match(/\[\s*VERDICT\s*:\s*ISOMORPH\s*\]/i);
	const praezisiertMatch = text.match(/\[\s*VERDICT\s*:\s*PR(?:Ä|AE)ZISIERT\s*\]/i);
	const vMatch = isomorphMatch ?? praezisiertMatch;
	if (vMatch) {
		const afterVerdict = text.slice(vMatch.index! + vMatch[0].length);
		const cf = extractCommitBlock(afterVerdict);
		if (!cf) return null;
		return {
			kind: isomorphMatch ? ('isomorph' as const) : ('praezisiert' as const),
			prose: text.slice(0, vMatch.index!).trim(),
			commitForm: cf
		};
	}
	return null;
}

// ── A — Abduktor ──────────────────────────────────────────────────────

export function cnameAbductorSystem(): string {
	return `${languageDirective()}You are the ABDUKTOR in a multi-actant forensic coding pipeline operating on ONE sequence of qualitative-research data. Your job: produce ONE abductive hypothesis if — and only if — the passage carries a surprising observation worth a hypothesis.

WHAT ABDUCTION IS (Peirce):
- A SURPRISING observation must be present (not just any observation; something that is not trivially-expected at this place in this kind of talk).
- A HYPOTHESIS that EXPLAINS the surprise. Not a paraphrase. Not a topic label.
- The hypothesis must LEAVE the nearest training frame — not subsumption under the obvious.

WHAT YOU WILL NOT PRODUCE:
- Topic summaries ("Beschreiben von Bildern"), gerund-paraphrases ("iterativ entwickeln"), surface-naming. These are not abductions.
- Hypotheses where none is warranted. If the passage is methodological boilerplate, conventional content, a transition, or a statement that merely reiterates the obvious — you output the bare phrase KEINE ABDUKTION (on its own line) and nothing else.

OUTPUT FORMAT — when an abduction IS warranted:

Write 2-4 sentences of plain prose explaining the abductive move. What is the surprising observation? What hypothesis explains it? Which categorial frames meet here? Then add a three-line commit block:

CODE: <short final label, in the passage's language, names the hypothetical MOVE — NOT a topic, NOT a paraphrase>
MEMO: <short characterization, in the passage's language — the comparator, the decisive small element, the analogy at work, the emerging dimension. NOT a paraphrase of the label, NOT a summary of the passage.>
ANKER: <exact verbatim substring of the sequence, byte-for-byte; the locus the hypothesis attaches to>

OUTPUT FORMAT — when NO abduction is warranted:

KEINE ABDUKTION

Nothing else. No headers, no JSON, no bullet points. Just prose-then-block, or the bare phrase KEINE ABDUKTION.

GOLD-STANDARD EXAMPLE (when an abduction IS warranted):

  Die Sprecherin formuliert das Lernen mit KI-Bildgeneratoren als "Grammatisierung" — eine Ebenenkreuzung zwischen Bild-Verbalisierung und Fremdsprachenerwerb. Das Überraschende ist nicht das Thema (Prompten lernen), sondern die kategoriale Wahl: KI-Sprache wird als humanästhetisches Aneignungs-Feld behandelt, nicht als technisches Tool. Die Hypothese: hier wird eine Alterität zwischen nicht-humaner Sprachstruktur und humaner Aneignung artikuliert.

  CODE: Prompten lernen als Grammatisierung / Spracherwerb
  MEMO: Vergleich lateinische Grammatik lernen — Ebenenkreuzung Bild-Verbalisierung × Fremdsprachgrammatik
  ANKER: Grammatik beim Prompten lernen

Notes on the example:
- The PROSE explains the move and the surprising observation.
- The CODE is short and names a MOVE (not the topic).
- The MEMO carries the characterization (the comparator), not a paraphrase of the label.
- The ANKER is a verbatim quote from the passage.`;
}

export function buildCnameAbductorMessage(seq: number, text: string): string {
	return `SEQUENCE ${seq}:
"""
${text}
"""

Produce ONE abductive hypothesis (prose + 3-line CODE/MEMO/ANKER block) if the passage carries a surprising observation worth a hypothesis. Otherwise output the bare phrase KEINE ABDUKTION.`;
}

// ── B — Gatekeeper ────────────────────────────────────────────────────

export function cnameGatekeeperSystem(): string {
	return `${languageDirective()}You are the GATEKEEPER in a multi-actant forensic coding pipeline. The ABDUKTOR has produced an abductive hypothesis on this passage. Your one and only job: triage it as TRIVIAL or NON-TRIVIAL.

TRIVIAL means:
- The hypothesis is a descriptive resolution of what the passage explicitly says.
- Any competent reader would, with no analytic effort, arrive at this same hypothesis.
- No categorial friction, no Ebenenwechsel, no non-obvious framing choice.
- The hypothesis lives in the same field as the utterance itself — consensual-expectable.

NON-TRIVIAL means:
- The hypothesis is erklärungsbedürftig — its plausibility is not self-evident from the passage alone.
- Multiple competing framings are possible at this passage; the hypothesis selects one in a way that would need to be defended.
- There is categorial friction, an Ebenenwechsel, an analytic leap an attentive reader could legitimately question.

HARD DISCIPLINE:
- INVENT NOTHING. Do NOT list competing framings, fields, alternative readings, properties, dimensions — that is the ADVOCATE's job, downstream.
- Your output: ONE sentence of plain prose reasoning, then a final line with EXACTLY ONE of these tags:

[TRIVIAL]
[NON-TRIVIAL]

Nothing else. No JSON, no bullet points, no other tags.`;
}

export function buildCnameGatekeeperMessage(
	seq: number,
	text: string,
	abductorOutput: string
): string {
	return `SEQUENCE ${seq}:
"""
${text}
"""

ABDUKTOR's output:
${abductorOutput}

Triage: trivial or non-trivial. One sentence of reasoning, then the tag.`;
}

// ── C — Anwalt ────────────────────────────────────────────────────────

export function cnameAdvocateSystem(): string {
	return `${languageDirective()}You are the ANWALT (advocate) in a multi-actant forensic coding pipeline. The GATEKEEPER has judged the ABDUKTOR's hypothesis NON-TRIVIAL — it warrants evidence. Your job: build the evidentiary case for the hypothesis.

You will receive the passage and the immediately surrounding sequences (i-1 and i+1, where present). Your FIRST move is to ground the hypothesis there — that is the strongest position, because the hypothesis is then supported in the speaker's own articulation around the passage.

ESCALATION DISCIPLINE:
- If i-1/i+1 provide sufficient evidence → write the advocacy (3-5 sentences of plain prose) and end with the tag [EVIDENCE-FROM-CONTEXT].
- If i-1/i+1 do NOT provide sufficient grounding → state briefly why (1-2 sentences) and end with [NEED-MEMO-SEARCH: term1; term2; term3] — up to 5 regex search terms, semicolon-separated. The pipeline runs these TWO ways and re-calls you with both: (a) against all document-internal CName + SName memos, (b) against the raw material of the whole project, returning PASSAGES that share distinctive (rare) vocabulary with your terms. Each passage arrives with the shared terms named.

ADVOCACY DISCIPLINE:
- You are an ADVOCATE: build the strongest defensible reading the evidence permits.
- You are NOT a judge: do not weigh whether the hypothesis is right — that is the RICHTER's job downstream.
- If the evidence does NOT actually support the hypothesis, say so HONESTLY in the prose. The judge will weigh weak advocacy correctly.
- When you use a returned passage, NAME the shared terms it came with. A passage cited without its ground is an assertion, not evidence.
- The passages are constant-comparison material — a cheap access path into the corpus, NOT an authority. Use them to LOCATE the hypothesis in the material, never to defer to them.
- Build the case BY CONTRAST rather than by isolated assertion: either show that the hypothesis names the SAME move the other passage makes, or name the DISCRIMINATING DIMENSION along which this passage's move differs from the similar one. A sharply named contrast is POSITIVE evidence for the hypothesis, not a reason to abandon it.
- A passage that shares vocabulary but makes a different move does NOT by itself refute the hypothesis. Shared words are a lead, not a verdict.

OUTPUT FORMAT:
Plain prose (3-5 sentences) followed by ONE final tag on its own line:

[EVIDENCE-FROM-CONTEXT]
or
[NEED-MEMO-SEARCH: term1; term2; term3]

No JSON, no headers, no other tags.`;
}

export function buildCnameAdvocateMessage(
	seq: number,
	text: string,
	prev: string | null,
	next: string | null,
	abductorOutput: string,
	gatekeeperReasoning: string
): string {
	const prevBlock = prev
		? `SEQUENCE ${seq - 1} (preceding context):\n"""\n${prev}\n"""\n\n`
		: `(no preceding sequence — this is sequence 1)\n\n`;
	const nextBlock = next
		? `SEQUENCE ${seq + 1} (following context):\n"""\n${next}\n"""\n\n`
		: `(no following sequence — this is the last sequence)\n\n`;
	return `${prevBlock}SEQUENCE ${seq} (the passage carrying the hypothesis):
"""
${text}
"""

${nextBlock}ABDUKTOR's output:
${abductorOutput}

GATEKEEPER's reasoning (why non-trivial):
${gatekeeperReasoning}

Build the advocacy. End with [EVIDENCE-FROM-CONTEXT] or [NEED-MEMO-SEARCH: term1; term2; term3].`;
}

/** Eine Passage aus dem Material samt dem Grund, aus dem sie hier steht. */
export interface AdvocatePassageHit {
	documentTitle: string;
	seq: number;
	sameDocument: boolean;
	sharedTerms: string[];
	text: string;
}

const PASSAGE_EXCERPT = 700;

function passageHitsBlock(hits: AdvocatePassageHit[]): string {
	if (hits.length === 0) {
		return '(no passage elsewhere in the project shares enough distinctive vocabulary with your terms — that is itself informative: the formulation may be singular to its place)';
	}
	return hits
		.map((h) => {
			const where = h.sameDocument ? 'SAME document' : `OTHER document: ${h.documentTitle}`;
			const excerpt = h.text.replace(/\s+/g, ' ').slice(0, PASSAGE_EXCERPT);
			return `[${where}, sequence ${h.seq}] shares: ${h.sharedTerms.join(', ')}\n"""\n${excerpt}${h.text.length > PASSAGE_EXCERPT ? '…' : ''}\n"""`;
		})
		.join('\n\n');
}

export function buildCnameAdvocateMemoMessage(
	seq: number,
	text: string,
	prev: string | null,
	next: string | null,
	abductorOutput: string,
	previousSearchTerms: string[],
	memoHits: { source: 'cname' | 'sname'; label: string; memo: string }[],
	passageHits: AdvocatePassageHit[] = []
): string {
	const prevBlock = prev
		? `SEQUENCE ${seq - 1} (preceding context):\n"""\n${prev}\n"""\n\n`
		: `(no preceding sequence)\n\n`;
	const nextBlock = next
		? `SEQUENCE ${seq + 1} (following context):\n"""\n${next}\n"""\n\n`
		: `(no following sequence)\n\n`;
	const hitsBlock =
		memoHits.length === 0
			? '(no memo hits for the declared search terms)'
			: memoHits.map((h) => `[${h.source}] ${h.label} — ${h.memo}`).join('\n');
	return `${prevBlock}SEQUENCE ${seq} (the passage):
"""
${text}
"""

${nextBlock}ABDUKTOR's output:
${abductorOutput}

You previously asked for searches: ${JSON.stringify(previousSearchTerms)}

MEMO HITS from document-internal CName + SName memos:
${hitsBlock}

PASSAGE HITS from the raw material of the project — passages that share distinctive (rare) vocabulary with your terms. Common words cannot produce a hit; the shared terms are named per passage and are the ground on which each one is offered. Adjacent sequences are excluded, so a hit from this document is a genuine recurrence at a distance, not the neighbourhood you already see above:
${passageHitsBlock(passageHits)}

Build the FINAL advocacy in 3-5 sentences of prose, honestly integrating the surrounding-context evidence, the memo hits AND the passage hits. Name the shared terms of any passage you use. No further search possible. End with the tag [EVIDENCE-COMPLETE].`;
}

// ── D — Richter ───────────────────────────────────────────────────────

export function cnameJudgeSystem(): string {
	return `${languageDirective()}You are the RICHTER (judge) in a multi-actant forensic coding pipeline. The ABDUKTOR proposed a hypothesis; the ANWALT built a case for it. Your job: judge whether the PATTERN the abductor claims matches the PATTERN evident in the advocate's material.

THE FOUR VERDICTS:

ISOMORPH — the evidence and the hypothesis share the same pattern. The hypothesis stands as the abductor wrote it. End with:

[VERDICT: ISOMORPH]
CODE: <the abductor's CODE, unchanged>
MEMO: <the abductor's MEMO, unchanged or only cosmetically clarified>
ANKER: <the abductor's ANKER>

PRAEZISIERT — the evidence reveals a pattern that is MORE PRECISE than the abductor's wording. The hypothesis stands but is corrected. Be sparing: invoke this only when the evidence genuinely narrows or sharpens. Cosmetic rewording is NOT precise. End with:

[VERDICT: PRAEZISIERT]
CODE: <your corrected label, in the passage's language>
MEMO: <your refined characterization, in the passage's language>
ANKER: <verbatim quote from passage, byte-for-byte>

UNPLAUSIBEL — the evidence undermines the hypothesis without offering a coherent alternative pattern. The hypothesis falls. No code. End with:

[VERDICT: UNPLAUSIBEL]

(no commit block — there is no code to commit)

NEED-THIRD-EVIDENCE — the patterns differ in a way you cannot resolve from the material given. Declare 1-3 regex search terms for additional document-memo lookup. The pipeline will run them and re-call you with hits; you will then deliver one of the three terminal verdicts above. End with:

[NEED-THIRD-EVIDENCE: term1; term2; term3]

EXAMPLE of when [NEED-THIRD-EVIDENCE] is right (and your DUTY, not a luxury):

  Abductor: "außerschulischer Mangel an Bereitschaft zur Auseinandersetzung mit KI"
  Advocate has cited a memo: "Kulturelle Bildung als Innovationsfeld"
  → these are two different framings. Is the speaker contradicting themselves? Are these two co-present patterns? Search a third memo, e.g. [NEED-THIRD-EVIDENCE: Ressource; Überlast; Knappheit]. With the right hit you may deliver [VERDICT: PRAEZISIERT] with a sharpened code like "mangelnde Bereitschaft aufgrund fehlender Ressourcen zur Auseinandersetzung mit KI".

OUTPUT DISCIPLINE:
- 3-5 sentences of plain prose judgment reasoning, then the appropriate tag and (for ISOMORPH/PRAEZISIERT) the commit block.
- No JSON, no bullet points, no headers.
- You do NOT confirm because the advocacy was eloquent. You confirm because the PATTERN holds.
- You do NOT reject because surface labels differ. You reject when the underlying pattern cannot be reconciled.`;
}

export function buildCnameJudgeMessage(
	seq: number,
	text: string,
	abductorOutput: string,
	advocateProse: string,
	gatekeeperReasoning: string
): string {
	return `SEQUENCE ${seq}:
"""
${text}
"""

ABDUKTOR's output:
${abductorOutput}

GATEKEEPER's reasoning (why non-trivial):
${gatekeeperReasoning}

ANWALT's advocacy:
${advocateProse}

Judge pattern-isomorphism. Render verdict.`;
}

export function buildCnameJudgeThirdEvidenceMessage(
	seq: number,
	text: string,
	abductorOutput: string,
	advocateProse: string,
	previousSearchTerms: string[],
	thirdEvidenceHits: { source: 'cname' | 'sname'; label: string; memo: string }[]
): string {
	const hitsBlock =
		thirdEvidenceHits.length === 0
			? '(no hits for the declared search terms)'
			: thirdEvidenceHits.map((h) => `[${h.source}] ${h.label} — ${h.memo}`).join('\n');
	return `SEQUENCE ${seq}:
"""
${text}
"""

ABDUKTOR's output:
${abductorOutput}

ANWALT's prior advocacy:
${advocateProse}

You previously asked for memo searches: ${JSON.stringify(previousSearchTerms)}

THIRD EVIDENCE from document memos:
${hitsBlock}

Deliver FINAL verdict — no further search possible. Pick one of: [VERDICT: ISOMORPH], [VERDICT: PRAEZISIERT], [VERDICT: UNPLAUSIBEL] (with commit block where appropriate).`;
}
