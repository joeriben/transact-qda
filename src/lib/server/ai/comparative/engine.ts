// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Comparative dimensionalization engine (CName) — the GTM constant-comparison LOOP that
// develops a SEEDED CONCEPT (a cue) into a set of grounded CONTRAST-DIMENSIONS, then
// optionally persists the result as a concept-naming at cue height, dimensions as memo-acts
// (actant E; cue-only, {aiPersona,aiRunId}-stamped).
//
// This is the production port of the validated `.tmp-ab` harnesses (cat2med loop +
// holistic-clustering saturation + emit). It is the OPERATION, not the per-document coder:
//
//   seeded concept (cue) → per-case in-document retrieval + mode-agnostic verify
//     → medoid seed (most central instance of the anchor case)
//     → pairwise constant comparison (maximize across cases / minimize within case) + grounding vet
//     → holistic clustering (saturation: collapse same-cut dimensions, no forced target count)
//     → contrast-dimension set → optional actant-E write.
//
// Urteilsbasis (validated 2026-06): the pairwise CONTRAST is load-bearing constant comparison;
// the clustering is a light dedup of obvious re-lexicalisations, NOT a drive toward few axes —
// dimensional richness is the correct output. See docs/design-methodological-positioning.md §7.
//
// Reuses existing infra (embed, chat tiers, comparison retrieval, db/queries write-path).
// Scope = actant C/E only: does NOT touch H1/H2 (SName), Richter/D, or runtime/agent.ts.

import { query, queryOne } from '../../db/index.js';
import { chatWithEmptyRetry } from '../coding-run/chat-with-retry.js';
import { resolveTier, resolveFallback, type TierModel } from '../coding-run/model-tiers.js';
import { retrieveComparisonMaterialForText } from '../coding-companion/retrieval.js';
import { embed } from '../../documents/embeddings.js';
import {
	getOrCreateResearcherNaming,
	getDesignationHistory
} from '../../db/queries/namings.js';
import { createOrphanNaming } from '../../db/queries/codes.js';
import { provenanceProps, type WriteProvenance } from '../runtime/tool-executor.js';

const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

// ───────────────────────── types ─────────────────────────

export interface ConceptSeed {
	/** The concept label — becomes the concept-naming's inscription. */
	name: string;
	/** Boundary gloss — what counts / does not count as an instance. Drives retrieval + verify. */
	gloss: string;
}

export interface CaseRef {
	/** Display name (e.g. the interviewee). */
	name: string;
	/** Document naming id for this case. */
	docId: string;
}

export interface VerifiedInstance {
	caseName: string;
	docId: string;
	elementId: string;
	content: string;
	/** Padded surrounding text — the unit actually compared. */
	ctx: string;
	similarity: number;
	/** Mean cosine to the other verified instances of the same (anchor) case; set only during medoid selection. */
	centrality?: number;
}

export interface PairingRec {
	mode: 'maximize' | 'minimize';
	counterpartCase: string;
	counterpartId: string;
	dimension: string | null;
	posA: string | null;
	posB: string | null;
	generic: boolean;
	accepted: boolean;
}

export interface Witness {
	dimension: string;
	mode: string;
	counterpartCase: string;
	counterpartId: string;
}

export interface Axis {
	axisId: number;
	dimension: string;
	posA: string;
	posB: string;
	witnessCount: number;
	witnesses: Witness[];
}

export interface ComparativeResult {
	concept: string;
	model: string;
	seedStrategy: string;
	silence: string | null; // case name with no verified instance, or null
	verified: Record<string, number>;
	anchor: { case: string; elementId: string; centrality: number | null; querySim: number } | null;
	axes: Axis[];
	acceptedPairings: number;
	conceptId: string | null; // set when persisted
	totalTokens: number;
}

export type ComparativeEvent =
	| { kind: 'retrieve'; case: string; candidates: number }
	| { kind: 'verify'; case: string; similarity: number; verdict: string }
	| { kind: 'silence'; missing: string }
	| { kind: 'seed'; case: string; elementId: string; centrality: number | null }
	| { kind: 'pair'; mode: string; counterpartCase: string; dimension: string | null; accepted: boolean }
	| { kind: 'saturate'; axisCount: number; from: number }
	| { kind: 'persist'; conceptId: string }
	| { kind: 'done'; axes: number };

export interface ComparativeParams {
	projectId: string;
	concept: ConceptSeed;
	/** ≥2 cases. cases[0] is the ANCHOR case (medoid + minimize pool); cases[1..] are the maximize pool. */
	cases: CaseRef[];
	perCaseCandidates?: number; // default 10
	maxMaximize?: number; // default 7
	maxMinimize?: number; // default 3
	/** Write the result as a concept-naming + CCS chain (actant E). Default false (read-only). */
	persist?: boolean;
	/** User id attributed as the acting system for `by` (researcher-naming). Default AI_SYSTEM. */
	byUserId?: string;
	/** Override the H2 tier (e.g. when the default route is degraded). Default resolveTier('coding-run.h2'). */
	modelOverride?: TierModel;
	/** Abort signal — propagated to every LLM call so a client disconnect tears down in-flight fetches. */
	signal?: AbortSignal;
	emit?: (e: ComparativeEvent) => void;
}

// ───────────────────────── helpers ─────────────────────────

// both vectors L2-normalized (embeddings.ts normalize:true) → cosine = dot product
function cosine(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function parseTag(text: string, tag: string): string | null {
	const m = text.match(new RegExp(`${tag}\\s*:\\s*(.+)`, 'i'));
	return m ? m[1].trim() : null;
}

const fullTextCache = new Map<string, string>();
async function getFullText(docId: string): Promise<string> {
	if (fullTextCache.has(docId)) return fullTextCache.get(docId)!;
	const r = await query<{ full_text: string }>(
		`SELECT full_text FROM document_content WHERE naming_id = $1`,
		[docId]
	);
	const t = r.rows[0]?.full_text ?? '';
	fullTextCache.set(docId, t);
	return t;
}

async function expandContext(elementId: string, docId: string, pad = 260): Promise<string> {
	const r = await query<{ char_start: number; char_end: number }>(
		`SELECT char_start, char_end FROM document_elements WHERE id = $1`,
		[elementId]
	);
	const row = r.rows[0];
	const ft = await getFullText(docId);
	if (!row || !ft) return '';
	const a = Math.max(0, row.char_start - pad);
	const b = Math.min(ft.length, row.char_end + pad);
	return ft.slice(a, b).trim();
}

/** A chat() bound to the resolved tier + the case documents (for trace context). */
function makeChat(
	concept: ConceptSeed,
	primary: TierModel,
	fallback: TierModel | null,
	docIds: string[],
	runId: string,
	onTokens: (n: number) => void,
	signal?: AbortSignal
) {
	return async function chat(system: string, content: string, phase: string): Promise<string> {
		const r = await chatWithEmptyRetry({
			primary,
			fallback,
			emptyMode: 'prose',
			runId,
			phaseLabel: phase,
			documentIds: docIds,
			timeoutMs: 120000,
			signal,
			system,
			messages: [{ role: 'user', content }]
		});
		onTokens(r.tokensUsed || 0);
		return r.text ?? '';
	};
}

// ───────────────────────── prompts ─────────────────────────

function verifySystem(c: ConceptSeed): string {
	return `Du prüfst, ob ein Textausschnitt aus einem Interview eine ECHTE Instanz des Konzepts «${c.name}» ist.
Definition: ${c.gloss}
WICHTIG: Es zählt JEDER Modus — ob das Phänomen positiv/produktiv ODER problematisch/widerständig auftritt. Beides ist eine Instanz, solange es um das Konzept im eigenen Geschehen der sprechenden Person geht.
KEINE Instanz: reine Interviewer-Fragen, oder allgemeine Reflexion ohne Bezug zum konkreten Konzept im eigenen Setting.
Gib 1-2 Sätze Begründung, dann GENAU eine Schlusszeile:
VERDICT: instance | not-instance | unsure`;
}

function compareSystem(c: ConceptSeed): string {
	return `Du führst eine GTM-Konstantvergleich-Operation aus. Gegeben zwei Incidents DESSELBEN Phänomens «${c.name}».
Die Incidents können aus demselben oder verschiedenen Fällen stammen und dasselbe Thema in unterschiedlichem MODUS oder FOKUS bearbeiten.
Frage: worin gleich, worin verschieden — und ENTLANG WELCHER EIGENSCHAFT (Dimension)?
Benenne (a) die EINE diskriminierende Dimension (tertium comparationis), (b) die Position von A und von B darauf.
WICHTIG: Subsumiere nicht unter ein fertiges Label. Wenn die Dimension auf BEIDE gleich zutrifft oder auf jede beliebige Äußerung passte, oder wenn die beiden Incidents auf der Eigenschaft praktisch GLEICH liegen (kein echter Unterschied), ist sie zu generisch — sag das offen mit GENERIC: yes.
Kurze Analyse, dann GENAU diese vier Schlusszeilen:
DIMENSION: <kurzer Name der Dimension>
POS_A: <Position von Incident A>
POS_B: <Position von Incident B>
GENERIC: yes | no`;
}

const VET_SYSTEM = `Du bist ein STRENGER Prüfer einer aus einem Konstantvergleich vorgeschlagenen Dimension. Im Zweifel ABLEHNEN.
Prüfe drei Dinge:
(a) Trennt die Dimension das Paar wirklich (echter Unterschied, keine Distinktion ohne Differenz, die Incidents liegen nicht praktisch gleich)?
(b) Sind BEIDE Positionen TEXTLICH in den jeweiligen Incidents belegt (nicht hineingelesen)?
(c) Ist die Dimension NICHT-GENERISCH (sie gilt nicht für jede beliebige Interviewäußerung gleich, sie trägt Information)?
Gib kurze Begründung, dann GENAU:
ACCEPT: yes | no`;

function clusterSystem(c: ConceptSeed): string {
	return `Du führst den SÄTTIGUNGS-Schritt einer GTM-Konstantvergleich-Analyse aus; alle Dimensionen betreffen dasselbe Phänomen «${c.name}».

Du bekommst die VOLLSTÄNDIGE Liste der Vergleichs-Dimensionen, jede aus einem Paarvergleich gewonnen. Aufgabe: Partitioniere die Liste in EIGENSTÄNDIGE ACHSEN. Jede Achse bündelt alle Dimensionen, die DENSELBEN Schnitt durchs Material legen.

Entscheidungskriterium (allein maßgeblich): Zwei Dimensionen gehören zur DERSELBEN Achse, wenn sie dasselbe tertium comparationis verwenden — also die Incidents nach DERSELBEN Eigenschaft sortieren —, auch wenn sie sprachlich verschieden formuliert sind. Sie gehören zu VERSCHIEDENEN Achsen, wenn sie einen ANDEREN Schnitt durchs Material legen.

Du siehst ALLE Dimensionen gleichzeitig — bündle nur Dimensionen, die denselben Schnitt unter anderem Namen legen (bloße Re-Lexikalisierung). Erzwinge KEINE Zielzahl: so viele Achsen wie es echte Schnitte gibt. Dimensionale Reichhaltigkeit ist erwünscht; verschiedene Aspekte desselben Themas (WAS positioniert wird vs. WIE STABIL vs. WELCHE FUNKTION) sind verschiedene Achsen. Jede Dimension gehört zu GENAU einer Achse.

Gib zuerst eine kurze Gesamtbegründung, dann für JEDE Achse GENAU dieses Format:
ACHSE <n>: <prägnanter Achsenname>
MITGLIEDER: <Komma-Liste der Dimensions-Nummern>`;
}

// ───────────────────────── steps ─────────────────────────

async function verifyInstance(
	chat: ReturnType<typeof makeChat>,
	concept: ConceptSeed,
	content: string,
	label: string
): Promise<'instance' | 'not-instance' | 'unsure'> {
	const raw = await chat(
		verifySystem(concept),
		`Ausschnitt:\n«${content}»\n\nIst das eine echte Instanz von «${concept.name}»?`,
		`verify ${label}`
	);
	const t = (parseTag(raw, 'VERDICT') ?? 'unsure').toLowerCase();
	return t.startsWith('instance') ? 'instance' : t.startsWith('not') ? 'not-instance' : 'unsure';
}

async function compareIncidents(
	chat: ReturnType<typeof makeChat>,
	concept: ConceptSeed,
	aCtx: string,
	aCase: string,
	bCtx: string,
	bCase: string,
	label: string
) {
	const raw = await chat(
		compareSystem(concept),
		`Incident A (Fall ${aCase}):\n«${aCtx}»\n\nIncident B (Fall ${bCase}):\n«${bCtx}»`,
		`compare ${label}`
	);
	return {
		dimension: parseTag(raw, 'DIMENSION'),
		posA: parseTag(raw, 'POS_A'),
		posB: parseTag(raw, 'POS_B'),
		generic: (parseTag(raw, 'GENERIC') ?? '').toLowerCase().startsWith('y')
	};
}

async function vet(
	chat: ReturnType<typeof makeChat>,
	dimension: string,
	posA: string,
	posB: string,
	aCtx: string,
	bCtx: string,
	label: string
): Promise<boolean> {
	const raw = await chat(
		VET_SYSTEM,
		`Dimension: ${dimension}\nPosition A: ${posA}\nPosition B: ${posB}\n\nIncident A:\n«${aCtx}»\n\nIncident B:\n«${bCtx}»`,
		`vet ${label}`
	);
	return (parseTag(raw, 'ACCEPT') ?? 'no').toLowerCase().startsWith('y');
}

/** Holistic saturation: one partition pass over all accepted dimensions → axes. Degrades to no-merge. */
async function clusterDimensions(
	chat: ReturnType<typeof makeChat>,
	concept: ConceptSeed,
	accepted: PairingRec[]
): Promise<Axis[]> {
	const noMerge = (): Axis[] =>
		accepted.map((p, i) => ({
			axisId: i + 1,
			dimension: p.dimension ?? `Dimension ${i + 1}`,
			posA: p.posA ?? '∅',
			posB: p.posB ?? '∅',
			witnessCount: 1,
			witnesses: [
				{ dimension: p.dimension ?? '', mode: p.mode, counterpartCase: p.counterpartCase, counterpartId: p.counterpartId }
			]
		}));

	if (accepted.length <= 1) return noMerge();

	const block = accepted
		.map((p, i) => `Dimension ${i + 1}:\n  ${p.dimension}\n  Pol A: ${p.posA ?? '∅'}\n  Pol B: ${p.posB ?? '∅'}`)
		.join('\n\n');
	const raw = await chat(clusterSystem(concept), `Dimensionen (${accepted.length}):\n\n${block}`, 'saturate');

	// parse ACHSE blocks → member indices (1-based, into `accepted`)
	const clean = raw.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
	const groups: { name: string; members: number[] }[] = [];
	let cur: { name: string; members: number[] } | null = null;
	for (const line of clean.split('\n').map((l) => l.trim())) {
		const head = line.match(/^ACHSE\s*\d+\s*[:：．.\-–—]\s*(.*)$/i);
		if (head) {
			if (cur) groups.push(cur);
			cur = { name: head[1].trim(), members: [] };
			continue;
		}
		const mem = line.match(/^MITGLIEDER\s*[:：]\s*(.+)$/i);
		if (mem && cur) cur.members = (mem[1].match(/\d+/g) ?? []).map(Number).filter((n) => n >= 1 && n <= accepted.length);
	}
	if (cur) groups.push(cur);

	// validate coverage; on any gap/dup fall back to no-merge (safe, faithful to inputs)
	const seen = new Set<number>();
	for (const g of groups) for (const m of g.members) seen.add(m);
	const valid = groups.length > 0 && seen.size === accepted.length && groups.every((g) => g.members.length > 0);
	if (!valid) return noMerge();

	return groups.map((g, gi) => {
		const members = [...new Set(g.members)].map((m) => accepted[m - 1]);
		const rep = members[0];
		return {
			axisId: gi + 1,
			dimension: g.name || rep.dimension || `Achse ${gi + 1}`,
			posA: rep.posA ?? '∅',
			posB: rep.posB ?? '∅',
			witnessCount: members.length,
			witnesses: members.map((p) => ({
				dimension: p.dimension ?? '',
				mode: p.mode,
				counterpartCase: p.counterpartCase,
				counterpartId: p.counterpartId
			}))
		};
	});
}

/** Medoid: the verified anchor-case instance with highest mean cosine to the others. */
async function selectMedoid(instances: VerifiedInstance[]): Promise<VerifiedInstance> {
	if (instances.length === 1) return instances[0];
	const vecs = await Promise.all(instances.map((c) => embed(c.ctx)));
	let bestIdx = 0;
	let bestMean = -Infinity;
	for (let i = 0; i < instances.length; i++) {
		let sum = 0;
		for (let j = 0; j < instances.length; j++) if (i !== j) sum += cosine(vecs[i], vecs[j]);
		const mean = sum / (instances.length - 1);
		instances[i].centrality = Number(mean.toFixed(4));
		if (mean > bestMean) {
			bestMean = mean;
			bestIdx = i;
		}
	}
	return instances[bestIdx];
}

// ───────────────────────── orchestrator ─────────────────────────

function axisMemo(ax: Axis): string {
	const wit = ax.witnesses
		.map((w) => `  - [${w.mode}] vs ${w.counterpartCase} ${w.counterpartId}: ${w.dimension}`)
		.join('\n');
	return [`Achse ${ax.axisId}: ${ax.dimension}`, `Pol A: ${ax.posA}`, `Pol B: ${ax.posB}`, `Zeugen (${ax.witnessCount}):`, wit].join('\n');
}

/**
 * Run the comparative dimensionalization loop for one seeded concept over the given cases.
 * Read-only unless `persist` is set. Returns the contrast-dimension set (+ conceptId if persisted).
 */
export async function runComparativeDimensionalization(params: ComparativeParams): Promise<ComparativeResult> {
	const {
		projectId,
		concept,
		cases,
		perCaseCandidates = 10,
		maxMaximize = 7,
		maxMinimize = 3,
		persist = false,
		byUserId = AI_SYSTEM_UUID,
		modelOverride,
		signal,
		emit = () => {}
	} = params;

	if (cases.length < 2) throw new Error('comparative engine needs ≥2 cases (cases[0] = anchor case).');

	const primary = modelOverride ?? resolveTier('coding-run.h2');
	const fallback = resolveFallback('coding-run.h2');
	let totalTokens = 0;
	const runId = `comparative-${projectId.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
	const docIds = cases.map((c) => c.docId);
	const chat = makeChat(concept, primary, fallback, docIds, runId, (n) => (totalTokens += n), signal);
	const queryText = `${concept.name}: ${concept.gloss}`;
	const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

	const base = (): ComparativeResult => ({
		concept: concept.name,
		model: `${primary.provider}/${primary.model}`,
		seedStrategy: 'medoid (most-central verified instance of the anchor case)',
		silence: null,
		verified: {},
		anchor: null,
		axes: [],
		acceptedPairings: 0,
		conceptId: null,
		totalTokens
	});

	// ── 1. per-case in-document retrieval + mode-agnostic verify ──
	const verified: Record<string, VerifiedInstance[]> = {};
	for (const c of cases) {
		const ret = await retrieveComparisonMaterialForText(projectId, queryText, c.docId, {
			maxSimilar: perCaseCandidates * 3,
			scope: 'in-document'
		});
		const seen = new Set<string>();
		const candidates: VerifiedInstance[] = [];
		for (const p of ret.similarPassages) {
			const cc = norm(p.content);
			if (cc.length < 30 || seen.has(cc)) continue;
			seen.add(cc);
			candidates.push({ caseName: c.name, docId: c.docId, elementId: p.elementId, content: p.content, ctx: p.content, similarity: p.similarity });
			if (candidates.length >= perCaseCandidates) break;
		}
		emit({ kind: 'retrieve', case: c.name, candidates: candidates.length });

		verified[c.name] = [];
		for (const cand of candidates) {
			cand.ctx = (await expandContext(cand.elementId, c.docId)) || cand.content;
			const v = await verifyInstance(chat, concept, cand.ctx, `${c.name} ${cand.elementId.slice(0, 8)}`);
			emit({ kind: 'verify', case: c.name, similarity: cand.similarity, verdict: v });
			if (v === 'instance') verified[c.name].push(cand);
		}
	}
	const result = base();
	result.verified = Object.fromEntries(cases.map((c) => [c.name, verified[c.name].length]));

	// silence: any case with no verified instance is a positive finding (Barad / CLAUDE.md §5)
	const anchorCase = cases[0];
	const missing = cases.find((c) => verified[c.name].length === 0);
	if (missing) {
		result.silence = missing.name;
		emit({ kind: 'silence', missing: missing.name });
		result.totalTokens = totalTokens;
		return result;
	}

	// ── 2. medoid seed over the anchor case ──
	const anchor = await selectMedoid(verified[anchorCase.name]);
	result.anchor = { case: anchorCase.name, elementId: anchor.elementId, centrality: anchor.centrality ?? null, querySim: anchor.similarity };
	emit({ kind: 'seed', case: anchorCase.name, elementId: anchor.elementId, centrality: anchor.centrality ?? null });

	// ── 3. pairings: maximize across other cases, minimize within the anchor case ──
	const maximizePool = cases
		.slice(1)
		.flatMap((c) => verified[c.name].map((inst) => ({ inst, mode: 'maximize' as const })))
		.slice(0, maxMaximize);
	const minimizePool = verified[anchorCase.name]
		.filter((c) => c.elementId !== anchor.elementId)
		.slice(0, maxMinimize)
		.map((inst) => ({ inst, mode: 'minimize' as const }));
	const counterparts = [...maximizePool, ...minimizePool];

	const accepted: PairingRec[] = [];
	for (const { inst, mode } of counterparts) {
		const lbl = `${mode} ${inst.caseName} ${inst.elementId.slice(0, 8)}`;
		const cmp = await compareIncidents(chat, concept, anchor.ctx, anchorCase.name, inst.ctx, inst.caseName, lbl);
		let ok = false;
		if (cmp.dimension && !cmp.generic) {
			ok = await vet(chat, cmp.dimension, cmp.posA ?? '', cmp.posB ?? '', anchor.ctx, inst.ctx, lbl);
		}
		emit({ kind: 'pair', mode, counterpartCase: inst.caseName, dimension: cmp.dimension, accepted: ok });
		if (ok) {
			accepted.push({
				mode,
				counterpartCase: inst.caseName,
				counterpartId: inst.elementId,
				dimension: cmp.dimension,
				posA: cmp.posA,
				posB: cmp.posB,
				generic: cmp.generic,
				accepted: true
			});
		}
	}
	result.acceptedPairings = accepted.length;

	// ── 4. holistic saturation → axes ──
	const axes = await clusterDimensions(chat, concept, accepted);
	result.axes = axes;
	emit({ kind: 'saturate', axisCount: axes.length, from: accepted.length });

	// ── 5. optional actant-E persist ──
	if (persist && axes.length > 0) {
		const prov: WriteProvenance = { persona: 'comparative', runId };
		const conceptId = await persistConceptProfile(projectId, byUserId, concept, result.seedStrategy, result.model, axes, prov);
		result.conceptId = conceptId;
		emit({ kind: 'persist', conceptId });
	}

	result.totalTokens = totalTokens;
	emit({ kind: 'done', axes: axes.length });
	return result;
}

/**
 * Actant E (Zug 4): persist the saturated profile as a concept-naming at CUE height.
 * Mirrors findOrCreateNaming (coding-run/write.ts): createOrphanNaming (provenance via the
 * shared provenanceProps → {aiPersona,aiRunId}) → 'cue' act → one memo-act per axis carrying
 * the dimensional analysis. cue-only — NO auto-promotion to characterization: that gradient
 * step is the researcher's terminal act, not the engine's (design-begleiten Satz I / CLAUDE.md
 * C). The {aiPersona,aiRunId} stamp makes the write hide-filterable (queries/namings.ts) and
 * rollback-addressable (reset-coding), exactly like every other AI write.
 * Returns the concept-naming id (undo: DELETE FROM namings WHERE id = … cascades).
 */
export async function persistConceptProfile(
	projectId: string,
	byUserId: string,
	concept: ConceptSeed,
	seedStrategy: string,
	model: string,
	axes: Axis[],
	prov: WriteProvenance
): Promise<string> {
	const by = await getOrCreateResearcherNaming(projectId, byUserId);
	const naming = await createOrphanNaming(projectId, byUserId, concept.name, {
		description: `GTM-Konstantvergleich: ${axes.length} Dimensionen (seed=${seedStrategy}, model=${model})`,
		provenance: provenanceProps(prov),
		placeOnPrimaryMap: false
	});
	// The concept enters the gradient as a cue and STAYS there (cue-only). The analytic
	// content (dimensions, tertium comparationis, witnesses) rides along as memo-acts at
	// cue height — nothing is lost, it just lands on Cue-Höhe; the human designates upward.
	await query(`INSERT INTO naming_acts (naming_id, designation, by) VALUES ($1, 'cue', $2)`, [naming.id, by]);
	for (const ax of axes) {
		await query(`INSERT INTO naming_acts (naming_id, by, memo_text) VALUES ($1, $2, $3)`, [naming.id, by, axisMemo(ax)]);
	}
	return naming.id;
}

/** A project's text-bearing documents as cases (naming_id + inscription), oldest first, deleted excluded. */
export async function listCaseDocuments(projectId: string): Promise<CaseRef[]> {
	const r = await query<{ naming_id: string; title: string }>(
		`SELECT dc.naming_id, n.inscription AS title
		   FROM document_content dc
		   JOIN namings n ON n.id = dc.naming_id
		  WHERE n.project_id = $1 AND n.deleted_at IS NULL AND coalesce(dc.full_text, '') <> ''
		  ORDER BY n.created_at ASC`,
		[projectId]
	);
	return r.rows.map((row) => ({ name: row.title, docId: row.naming_id }));
}

/** Round-trip read of a persisted concept's CCS chain — for verification / UI. */
export async function readConceptProfile(conceptId: string) {
	const history = await getDesignationHistory(conceptId);
	const r = await query<{ seq: string; memo_text: string }>(
		`SELECT seq, memo_text FROM naming_acts WHERE naming_id = $1 AND memo_text IS NOT NULL ORDER BY seq ASC`,
		[conceptId]
	);
	return { designations: history.map((d: any) => d.designation), memos: r.rows.map((m) => m.memo_text) };
}
