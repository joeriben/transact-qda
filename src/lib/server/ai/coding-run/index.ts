// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Per-document coding run — Typen + gemeinsam genutzte Helper.
//
// Den Loop selbst besitzt jetzt orchestrator.ts (Run-Persistenz,
// Pause/Resume, Cancel-Intent, Stuck-Watchdog-Anker). Diese
// Datei ist nur noch:
//   * das Vokabular (H1Code, H2Verdict, H1Reaction, Survivor, SequenceTrace,
//     CodingRunResult, CodingRunEvent), das orchestrator, +server.ts und die
//     UI gemeinsam lesen,
//   * die kleinen reinen Helfer (parseJsonArray, resolveSurvivors) und die
//     beiden DB-Lookups (loadDocumentTitle, loadExistingCodeLabels), die der
//     Loop pro Run-Aufruf einmal braucht.
//
// Die Methode (eine einzige, fixe Strategie pro Run — keine User-Auswahl):
//
//   1. H1 schlägt Codes vor (code-extractive, sieht die laufende Code-Liste).
//   2. H2 liest die Sequenz UNABHÄNGIG noch einmal — H1-agnostisch — und
//      erweitert eine kumulative „Verständnislinie" (Erkenntnismedium, kein
//      Naming; Debug-Artefakt).
//   3. H2 konfrontiert H1s Codes gegen diese Lesart: keep / revise / drop,
//      mit einem verbindenden Code-Memo für die Überlebenden.
//   4. H1 reagiert einmal (defend / revise / withdraw). Eine Runde, dann commit.
//
// SA-agnostisch: kein SA-Map-Bezug, keine Positionierung. Es entstehen
// gewöhnliche Codes (siehe write.ts).
//
// Switchbar, nicht automatisch: per Dokument über die Route getriggert. Der
// Run läuft über das ganze Dokument; Begrenzung erfolgt über Pause/Cancel.

import { query, queryOne } from '../../db/index.js';
import type { CommitResult } from './write.js';
import type { Sequence } from './segmentation.js';

// ── LLM-Exchange-Shapes (exported, damit orchestrator + Tests gleich lesen) ──

export interface H1Code {
	code_label: string;
	reasoning: string;
}

export interface H2Verdict {
	code_label: string;
	verdict: 'keep' | 'revise' | 'drop' | string;
	einwand: string;
	code_memo: string;
}

export interface H1Reaction {
	code_label: string;
	action: 'defend' | 'revise' | 'withdraw' | string;
	final_label: string;
	final_reasoning: string;
}

export interface Survivor {
	label: string;
	reasoning: string;
	codeMemo: string;
}

// ── Result / Trace ─────────────────────────────────────────────────────────

/**
 * Diagnostik der CName-Forensic-Pipeline pro Sequenz. Schmaler als
 * ForensicSequenceResult (cname-forensic.ts) — nur die Felder, die der
 * Trace / SSE-Stream / UI weitergeben muss. Reasoning steckt jetzt in
 * Prosa-Strings (`abduktion.prose`, `triage.prose`, `judgment.prose`),
 * weil die Aktanten Prosa lesen und schreiben; die strukturierten
 * Commit-Felder (label/memo/quote) sind die einzigen Pipeline-
 * Nahtstellen, an denen Form erzwungen wird.
 */
export interface CNameForensicTraceFragment {
	/** A's Output. null = KEINE ABDUKTION oder Parser-Fail. */
	abduktion: {
		prose: string;
		label: string;
		memo: string;
		quote: string;
	} | null;
	/** B's Output. null = nicht erreicht. */
	triage: {
		verdict: 'trivial' | 'non-trivial';
		prose: string;
	} | null;
	/** D's finales Urteil. null = nicht erreicht (A leer / B trivial / Parser-Fail). */
	judgment: {
		verdict: 'isomorph' | 'praezisiert' | 'unplausibel';
		prose: string;
		/** Bei `praezisiert`: D's geschärfter Label. Sonst undefined. */
		correctedLabel?: string;
		/** Bei `praezisiert`: D's geschärftes Memo. Sonst undefined. */
		correctedMemo?: string;
	} | null;
	outcome: 'commit-new' | 'commit-reuse' | 'no-code' | 'no-abduktion';
	noCodeReason: string | null;
	/** Anzahl der LLM-Calls für diese Sequenz (1-6). */
	llmCalls: number;
	errors: string[];
}

export interface SequenceTrace {
	/** 1-based position of this sequence in the document. */
	seq: number;
	/** Char span of the sequence in full_text — the commit anchor. */
	charStart: number;
	charEnd: number;
	/** How many sentence elements the thematic sequence spans. */
	sentenceCount: number;
	text: string;
	h1Proposed: H1Code[];
	/** H2's independent reading — the hidden Verständnislinie increment. */
	h2Comprehension: string | null;
	h2Verdicts: H2Verdict[];
	h1Reactions: H1Reaction[];
	/** SName commits (H1/H2 sequence-naming pass). */
	committed: CommitResult[];
	commitErrors: string[];
	/** CName-Forensic Pipeline diagnostics (A/B/C/D/E pro Sequenz). */
	cnameForensic: CNameForensicTraceFragment;
	/** CName commit (0 oder 1 pro Sequenz). */
	cnameCommitted: CommitResult[];
}

export interface CodingRunResult {
	runId: string;
	documentId: string;
	documentTitle: string;
	/** Resolved H1 route as "provider/model" — the coding line. */
	h1Model: string;
	/** Resolved H2 route as "provider/model" — the comprehension line. */
	h2Model: string;
	/** How the document was segmented into walk units — 'cohesion'
	 *  (sentence embeddings) or 'char-window' (fallback). */
	segmentationMethod: Sequence['method'];
	sequencesProcessed: number;
	codesCommitted: number;
	tokensUsed: number;
	/** The hidden Verständnislinie: H2's cumulative comprehension. Not a naming. */
	comprehensionLine: string[];
	sequences: SequenceTrace[];
}

/**
 * Live-Progress-Events für den SSE-Stream (Streaming-Pattern aus dem
 * älteren Pipeline-Run). Der Loop in orchestrator.ts emittiert run-init /
 * segmented / sequence-start / sequence-done; +server.ts framet die
 * terminalen completed / failed / paused / cancelled und feuert alive als
 * Heartbeat. Wire-Format: `data: <json>\n\n`.
 */
export type CodingRunEvent =
	| { type: 'run-init'; runId: string }
	| { type: 'segmented'; total: number; method: Sequence['method'] }
	| { type: 'sequence-start'; index: number; total: number; seq: number }
	| {
			type: 'sequence-done';
			index: number;
			total: number;
			seq: number;
			codesCommitted: number;
			tokens: number;
			cumulativeTokens: number;
	  }
	| { type: 'completed'; result: CodingRunResult }
	| { type: 'failed'; message: string }
	| { type: 'paused'; runId: string }
	| { type: 'cancelled'; runId: string }
	| { type: 'alive'; at: string };

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Robuster Parser für ein JSON-Array, das aus einer LLM-Textantwort
 * extrahiert wird. Drei Stufen, weil reale Modelle drei Failure-Modi haben:
 *   1) Sauberes `[ {…}, {…} ]` (der gewünschte Pfad) — auch wenn das Modell
 *      ein Vor- oder Nachwort drangehängt hat, dank Substring-Extraktion.
 *   2) Bare-Object `{ … }` statt Array. MiMo schickt das gelegentlich, wenn
 *      H1 nur einen Code vorschlägt. Wir packen es in `[obj]` ein, statt
 *      den Code zu verlieren — sonst verschluckt der Loop eine ganze Sequenz.
 *   3) JSON-Lines-Stil `{…}\n{…}` ohne Klammerung. Ebenfalls beobachtet.
 * Bei jedem Parse-/Shape-Fehler: leeres Array, der Loop kommt damit klar
 * (eine Sequenz ohne H1-Codes ist legitim).
 */
export function parseJsonArray<T>(text: string): T[] {
	if (!text) return [];
	let s = text.trim();
	// Markdown-Fences abstreifen.
	const fence = s.match(/```(?:json)?\n?([\s\S]*?)```/);
	if (fence) s = fence[1].trim();
	// 1) Reguläres JSON-Array.
	const aOpen = s.indexOf('[');
	const aClose = s.lastIndexOf(']');
	if (aOpen >= 0 && aClose > aOpen) {
		try {
			const v = JSON.parse(s.slice(aOpen, aClose + 1));
			if (Array.isArray(v)) return v as T[];
		} catch {
			/* fall through */
		}
	}
	// 2) Bare-Object {…} → [obj].
	const oOpen = s.indexOf('{');
	const oClose = s.lastIndexOf('}');
	if (oOpen >= 0 && oClose > oOpen) {
		try {
			const v = JSON.parse(s.slice(oOpen, oClose + 1));
			if (v && typeof v === 'object' && !Array.isArray(v)) return [v as T];
		} catch {
			/* fall through */
		}
	}
	// 3) Mehrere Objekte ohne Array-Klammerung. JSON-Lines-Stil.
	const objs: T[] = [];
	const re = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
	let m;
	while ((m = re.exec(s)) !== null) {
		try {
			objs.push(JSON.parse(m[0]) as T);
		} catch {
			/* skip malformed object */
		}
	}
	return objs;
}

function norm(s: string): string {
	return (s || '').trim().toLowerCase();
}

/**
 * Resolve which codes survive the H1↔H2 confrontation.
 * - no verdict / "keep"  → survives (H1 label, H2 Code-Memo).
 * - "revise" → H1 reaction decides: "revise" adopts final_label,
 *   anything else (incl. missing) defends the original label.
 * - "drop"   → survives only if H1 explicitly "defend"s; missing
 *   reaction means the drop stands (conservative — fewer codes).
 */
export function resolveSurvivors(h1: H1Code[], verdicts: H2Verdict[], reactions: H1Reaction[]): Survivor[] {
	const out: Survivor[] = [];
	for (const c of h1) {
		const v = verdicts.find((x) => norm(x.code_label) === norm(c.code_label));
		if (!v || v.verdict === 'keep') {
			out.push({
				label: c.code_label,
				reasoning: c.reasoning || '',
				codeMemo: (v?.code_memo || '').trim() || c.reasoning || ''
			});
			continue;
		}
		const r = reactions.find((x) => norm(x.code_label) === norm(c.code_label));
		if (v.verdict === 'revise') {
			const label =
				r && r.action === 'revise' && r.final_label && r.final_label.trim()
					? r.final_label.trim()
					: c.code_label;
			out.push({
				label,
				reasoning: (r?.final_reasoning || '').trim() || c.reasoning || '',
				codeMemo: (v.code_memo || '').trim() || c.reasoning || ''
			});
			continue;
		}
		if (v.verdict === 'drop') {
			if (r && r.action === 'defend') {
				out.push({
					label: c.code_label,
					reasoning: (r.final_reasoning || '').trim() || c.reasoning || '',
					codeMemo: (v.code_memo || '').trim() || c.reasoning || ''
				});
			}
			// withdrawn / no reaction → excluded
			continue;
		}
		// Unknown verdict → keep, conservative toward H1.
		out.push({ label: c.code_label, reasoning: c.reasoning || '', codeMemo: c.reasoning || '' });
	}
	return out;
}

/**
 * Title-Only-Lookup für den Loop. Der Volltext wird vom Loop NICHT mehr
 * gelesen — orchestrator.startOrResumeRun macht die Segmentation einmal beim
 * fresh Start und persistiert die Sequenz-Liste in segmentation_snapshot;
 * runCodingRunLoop liest aus dem Snapshot.
 *
 * Verwirft den Fall „Document not found in this project" (vor allem für die
 * Wiederaufnahme nach gelöschten Dokumenten — der Loop soll dann nicht
 * stillschweigend leere Sequenzen abarbeiten).
 */
export async function loadDocumentTitle(
	projectId: string,
	documentId: string
): Promise<{ title: string }> {
	const row = await queryOne<{ title: string }>(
		`SELECT inscription AS title FROM namings
		 WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[documentId, projectId]
	);
	if (!row) throw new Error('Document not found in this project');
	return { title: row.title };
}

/** All labels that currently count as codes in the project (the running comparison list). */
export async function loadExistingCodeLabels(projectId: string): Promise<string[]> {
	const res = await query<{ label: string }>(
		`SELECT DISTINCT n.inscription AS label
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN appearances pa ON pa.naming_id = a.perspective_id
		   AND pa.perspective_id = a.perspective_id AND pa.mode = 'perspective'
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND (pa.properties ? 'mapType' OR pa.properties->>'role' = 'grounding-workspace')
		 ORDER BY n.inscription
		 LIMIT 200`,
		[projectId]
	);
	return res.rows.map((r) => r.label);
}

/**
 * CName-only labels for the Strauss-Open-Coding constant-comparison list —
 * **document-scoped**, NOT project-scoped.
 *
 * Filtert auf Namings mit mindestens einer code-naming-Annotation
 * (valence='codes', annotationKind='code-naming') **am übergebenen
 * Dokument** (`appearances.directed_to = documentId`). Schließt damit
 * Sequenz-Namings (valence='thematizes') systematisch aus.
 *
 * Warum dokument-scoped (2026-05-24): projekt-weite Constant Comparison
 * kippt bei LLMs in deduktive Subsumption — sie tragen Codes aus Dok A
 * als Anker in Dok B, und nach n Dokumenten ist Dok n+1 nur noch ein
 * Abklatsch der Anfangs-Codes. Menschen können sich an einen vergebenen
 * Code erinnern, ohne ihn als Subsumptions-Schablone zu verwenden; LLMs
 * können das nicht trennen. Deshalb: KEIN Quer-Gedächtnis pro Lauf.
 * Cross-document collapse (zu Stacks) und axiale Codierung (Phases)
 * gehören in einen separaten, manuell ausgelösten Pass — out of scope
 * für den per-Dokument-Coding-Run.
 */
export async function loadExistingCNameLabels(
	projectId: string,
	documentId: string
): Promise<string[]> {
	const res = await query<{ label: string }>(
		`SELECT DISTINCT n.inscription AS label
		 FROM namings n
		 JOIN appearances ann ON ann.directed_from = n.id
		   AND ann.mode = 'relation'
		   AND ann.valence = 'codes'
		   AND ann.directed_to = $2
		   AND ann.properties->>'annotationKind' = 'code-naming'
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		 ORDER BY n.inscription
		 LIMIT 200`,
		[projectId, documentId]
	);
	return res.rows.map((r) => r.label);
}

/**
 * Eine dokument-interne Memo-Quelle für die forensische CName-Pipeline.
 * `source` unterscheidet CName- (an Cue-Naming gehängt) von SName-Memos
 * (an Sequenz-Thematisierung gehängt). `label` ist das Naming-Label
 * (= Cue-Bezeichner / Sequenz-Thema); `memo` ist der naming_act.memo_text.
 */
export interface DocumentMemo {
	source: 'cname' | 'sname';
	label: string;
	memo: string;
}

/**
 * Alle Memos am Dokument, beide Granularitäten zusammen. Versorgt die
 * forensische CName-Pipeline (Pass C und Pass D) als Material für
 * Regex-basierte laterale Suche. Memos OHNE Text werden gefiltert —
 * für Regex-Matching unnütz.
 *
 * Wachstum während des Laufs: der Orchestrator hält die Rückgabe als
 * mutables Array, das die Pipeline nach jedem CName-Commit appenden
 * darf. Damit sehen spätere Sequenzen die Codes/Memos früherer Sequenzen
 * desselben Laufs — die *intra-document* Constant-Comparison-Disziplin.
 */
export async function loadDocumentMemos(
	projectId: string,
	documentId: string
): Promise<DocumentMemo[]> {
	const res = await query<{ source: 'cname' | 'sname'; label: string; memo: string }>(
		`(SELECT 'cname'::text AS source, n.inscription AS label, na.memo_text AS memo
		  FROM namings n
		  JOIN appearances ann ON ann.directed_from = n.id
		    AND ann.mode = 'relation'
		    AND ann.valence = 'codes'
		    AND ann.directed_to = $2
		    AND ann.properties->>'annotationKind' = 'code-naming'
		  JOIN naming_acts na ON na.naming_id = n.id
		    AND na.memo_text IS NOT NULL
		    AND length(trim(na.memo_text)) > 0
		  WHERE n.project_id = $1 AND n.deleted_at IS NULL)
		 UNION ALL
		 (SELECT 'sname'::text AS source, n.inscription AS label, na.memo_text AS memo
		  FROM namings n
		  JOIN appearances ann ON ann.directed_from = n.id
		    AND ann.mode = 'relation'
		    AND ann.valence = 'thematizes'
		    AND ann.directed_to = $2
		    AND ann.properties->>'annotationKind' = 'sequence-naming'
		  JOIN naming_acts na ON na.naming_id = n.id
		    AND na.memo_text IS NOT NULL
		    AND length(trim(na.memo_text)) > 0
		  WHERE n.project_id = $1 AND n.deleted_at IS NULL)
		 ORDER BY source, label
		 LIMIT 500`,
		[projectId, documentId]
	);
	return res.rows;
}
