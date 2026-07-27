// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Forensische CName-Pipeline — Runner pro Sequenz.
//
// Aktanten: A Abduktor → B Gatekeeper → {C Anwalt → D Richter | bypass}
// → E Operativ. Routing-Tags in B/C/D ([TRIVIAL]/[NON-TRIVIAL] usw.) +
// Commit-Block-Zeilen (CODE/MEMO/ANKER) in A und D sind die einzigen
// parsbaren Stellen. Reasoning ist Prosa von Aktant zu Aktant.
//
// Was als "leer" zählt: emptyMode='prose' — text.trim()==='' triggert
// retry/escalate. Eine Antwort wie "KEINE ABDUKTION" ist NICHT leer und
// triggert keinen Retry (das ist eine legitime Abduktor-Antwort).
//
// Defensive Defaults bei fehlgeschlagenem Tag-Parsing:
//   • B ohne Tag → behandle als 'non-trivial' (safe — geht durch C/D)
//   • D ohne Tag oder ohne Commit-Block bei ISOMORPH/PRAEZISIERT → no-code
//   • C ohne Tag → no-code
// AbortError/Provider-Fehler propagieren wie im SName-Pfad.

import {
	chatWithEmptyRetry,
	type ChatWithEmptyRetryResult
} from './chat-with-retry.js';
import { isFatalProviderError } from '../client.js';
import { type DocumentMemo } from './index.js';
import { commitCodedPassage, type CommitResult } from './write.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteProvenance } from '../runtime/tool-executor.js';
import type { TierModel } from './model-tiers.js';
import {
	cnameAbductorSystem,
	buildCnameAbductorMessage,
	cnameGatekeeperSystem,
	buildCnameGatekeeperMessage,
	cnameAdvocateSystem,
	buildCnameAdvocateMessage,
	buildCnameAdvocateMemoMessage,
	cnameJudgeSystem,
	buildCnameJudgeMessage,
	buildCnameJudgeThirdEvidenceMessage,
	parseAbductor,
	parseGatekeeper,
	parseAdvocate,
	parseJudge,
	type AbduktorOutput,
	type GatekeeperOutput,
	type AdvocateOutput,
	type JudgeOutput,
	type CommitForm
} from './cname-forensic-prompts.js';

// ── Result/Trace types ────────────────────────────────────────────────

export interface ActantCall {
	actant: 'A' | 'B' | 'C-1' | 'C-2' | 'D-1' | 'D-2';
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	tokensUsed: number;
}

export type ForensicOutcome =
	| 'commit-new'
	| 'commit-reuse'
	| 'no-code'
	| 'no-abduktion';

export interface ForensicSequenceResult {
	abduktion: Extract<AbduktorOutput, { kind: 'abduktion' }> | null;
	triage: GatekeeperOutput | null;
	advocacy: AdvocateOutput | null;
	judgment: JudgeOutput | null;
	outcome: ForensicOutcome;
	commitResult: CommitResult | null;
	commitForm: CommitForm | null;
	noCodeReason: string | null;
	calls: ActantCall[];
	totalTokens: {
		input: number;
		output: number;
		cacheCreation: number;
		cacheRead: number;
		used: number;
	};
	errors: string[];
}

// ── Per-Run-Forensik-Trace (Dev-Inspektion) ───────────────────────────
//
// Damit Entwickler die A–E-Pipeline live inspizieren können, schreiben wir
// pro Sequenz eine JSONL-Zeile mit dem vollen State (Rohtexte aller
// Aktanten + Parser-Ergebnisse + E-Entscheidung). Datei lebt unter
// `.tmp-forensic-trace/{runId}.jsonl`, ist gitignored, und dient
// ausschließlich der Dev-Forensik — nichts hängt funktional von ihr ab.

const TRACE_DIR = '.tmp-forensic-trace';
let traceDirEnsured = false;

/** Roh-Texte aller Aktanten-Aufrufe einer Sequenz (akkumuliert im Runner). */
export interface ActantRaws {
	A?: string;
	B?: string;
	'C-1'?: string;
	'C-2'?: string;
	'D-1'?: string;
	'D-2'?: string;
	// C-2/D-2 brauchen wissen welche Memos sie *gesehen* haben, sonst ist
	// der Memo-Abruf nicht nachvollziehbar.
	'C-2-memoHits'?: { label: string; memo: string; source: 'cname' | 'sname' }[];
	'D-2-memoHits'?: { label: string; memo: string; source: 'cname' | 'sname' }[];
}

function writeSequenceTrace(
	runId: string,
	opts: RunForensicOptions,
	result: ForensicSequenceResult,
	raws: ActantRaws
): void {
	try {
		if (!traceDirEnsured) {
			mkdirSync(TRACE_DIR, { recursive: true });
			traceDirEnsured = true;
		}
		const line = JSON.stringify({
			ts: new Date().toISOString(),
			runId,
			seq: opts.sequence.seq,
			charStart: opts.sequence.charStart,
			charEnd: opts.sequence.charEnd,
			sequenceText: opts.sequence.text,
			prevSequenceText: opts.prevSequenceText,
			nextSequenceText: opts.nextSequenceText,
			documentMemoCount: opts.documentMemos.length,
			existingLabelCount: opts.existingCNameLabels.length,
			raws,
			result: {
				outcome: result.outcome,
				noCodeReason: result.noCodeReason,
				abduktion: result.abduktion,
				triage: result.triage,
				advocacy: result.advocacy,
				judgment: result.judgment,
				commitForm: result.commitForm,
				commitResult: result.commitResult,
				calls: result.calls,
				totalTokens: result.totalTokens,
				errors: result.errors
			}
		});
		appendFileSync(join(TRACE_DIR, `${runId}.jsonl`), line + '\n', 'utf-8');
	} catch {
		// Trace ist Dev-Komfort — kein Fail wenn FS hakelt.
	}
}

// ── ANKER-Quote-Lokalisierung ─────────────────────────────────────────

/**
 * Sucht den ANKER-Quote in der Sequenz. Toleriert drei systematische LLM-Artefakte:
 *  (1) Whitespace am Quote-Rand (Trim),
 *  (2) Unicode-Combining-Form-Umlaute (NFC-Normalisierung),
 *  (3) Smart-Quotes statt ASCII-Apostrophen (' " → ' ").
 *
 * Wenn keine dieser Toleranzen greift, ist `foundIdx === -1`. Anders als
 * Edit-Distance- oder Fuzzy-Matching erlauben wir keine Paraphrasen — der
 * Anker MUSS aus dem Quelltext stammen.
 */
function locateQuote(
	sequenceText: string,
	rawQuote: string
): { foundIdx: number; foundQuote: string } {
	const tryFind = (text: string, q: string): { foundIdx: number; foundQuote: string } => {
		if (!q) return { foundIdx: -1, foundQuote: q };
		const idx = text.indexOf(q);
		return { foundIdx: idx, foundQuote: q };
	};
	const trimmed = rawQuote.trim();
	const direct = tryFind(sequenceText, trimmed);
	if (direct.foundIdx >= 0) return direct;
	const nfcText = sequenceText.normalize('NFC');
	const nfcQuote = trimmed.normalize('NFC');
	if (nfcQuote !== trimmed || nfcText !== sequenceText) {
		const nfcHit = tryFind(nfcText, nfcQuote);
		// Wenn der NFC-Match in der Sequenz an gleicher Position liegt (NFC ändert
		// reine ASCII-Strings nicht), darf der Offset direkt verwendet werden.
		if (nfcHit.foundIdx >= 0 && nfcText === sequenceText) {
			return nfcHit;
		}
		// Sonst: gleicher NFC-Treffer im Original an gleicher Stelle? Häufig identisch
		// weil moderne Tokenizer NFC-konform schreiben.
		if (nfcHit.foundIdx >= 0) {
			const directRetry = tryFind(sequenceText, nfcQuote);
			if (directRetry.foundIdx >= 0) return directRetry;
		}
	}
	const dequoted = trimmed
		.replace(/[‘’‚‛′]/g, "'")
		.replace(/[“”„‟″]/g, '"')
		.replace(/[–—]/g, '-');
	if (dequoted !== trimmed) {
		const dequotedHit = tryFind(sequenceText, dequoted);
		if (dequotedHit.foundIdx >= 0) return dequotedHit;
	}
	return { foundIdx: -1, foundQuote: trimmed };
}

/**
 * Beim ANKER-Fail: gib einen Hinweis aus, wie weit der Quote in den Quelltext
 * matcht (längster gemeinsamer Präfix), damit man im Log Paraphrase von
 * Encoding-Mismatch unterscheiden kann.
 */
function diagnoseQuoteMismatch(sequenceText: string, rawQuote: string): string {
	const q = rawQuote.trim();
	if (!q) return '(empty quote)';
	let bestPrefix = 0;
	let bestSequencePos = -1;
	// Suche das längste Präfix von q, das irgendwo in sequenceText vorkommt.
	for (let len = Math.min(q.length, 40); len >= 8; len--) {
		const prefix = q.slice(0, len);
		const idx = sequenceText.indexOf(prefix);
		if (idx >= 0) {
			bestPrefix = len;
			bestSequencePos = idx;
			break;
		}
	}
	if (bestPrefix === 0) {
		return `(quote starts with text not in sequence: ${JSON.stringify(q.slice(0, 30))})`;
	}
	const divergeAt = bestPrefix;
	const llmTail = q.slice(divergeAt, divergeAt + 30);
	const srcTail = sequenceText.slice(bestSequencePos + divergeAt, bestSequencePos + divergeAt + 30);
	return `(matches first ${bestPrefix} chars; diverges at LLM=${JSON.stringify(llmTail)} vs source=${JSON.stringify(srcTail)})`;
}

// ── Memo-Lookup (Regex) ───────────────────────────────────────────────

function buildMemoSearchPatterns(terms: string[]): RegExp[] {
	const patterns: RegExp[] = [];
	for (const t of terms) {
		const trimmed = (t ?? '').trim();
		if (!trimmed) continue;
		try {
			patterns.push(new RegExp(trimmed, 'i'));
		} catch {
			const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			patterns.push(new RegExp(escaped, 'i'));
		}
	}
	return patterns;
}

function findMemoHits(
	memos: DocumentMemo[],
	terms: string[],
	limit: number
): DocumentMemo[] {
	const patterns = buildMemoSearchPatterns(terms);
	if (patterns.length === 0) return [];
	const hits: DocumentMemo[] = [];
	for (const m of memos) {
		const blob = `${m.label} ${m.memo}`;
		if (patterns.some((p) => p.test(blob))) {
			hits.push(m);
			if (hits.length >= limit) break;
		}
	}
	return hits;
}

// ── Token-Bookkeeping ─────────────────────────────────────────────────

function recordCall(
	calls: ActantCall[],
	actant: ActantCall['actant'],
	resp: ChatWithEmptyRetryResult
): void {
	calls.push({
		actant,
		inputTokens: resp.inputTokens,
		outputTokens: resp.outputTokens,
		cacheCreationTokens: resp.cacheCreationTokens,
		cacheReadTokens: resp.cacheReadTokens,
		tokensUsed: resp.tokensUsed
	});
}

function sumTokens(calls: ActantCall[]): ForensicSequenceResult['totalTokens'] {
	return calls.reduce(
		(acc, c) => ({
			input: acc.input + c.inputTokens,
			output: acc.output + c.outputTokens,
			cacheCreation: acc.cacheCreation + c.cacheCreationTokens,
			cacheRead: acc.cacheRead + c.cacheReadTokens,
			used: acc.used + c.tokensUsed
		}),
		{ input: 0, output: 0, cacheCreation: 0, cacheRead: 0, used: 0 }
	);
}

function rethrowAbortOrFatal(err: unknown): void {
	if (isFatalProviderError(err)) throw err;
	if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
		throw err;
	}
}

// ── Pipeline Runner ───────────────────────────────────────────────────

export interface RunForensicOptions {
	runId: string;
	projectId: string;
	documentId: string;
	bearbeiterNamingId: string;
	sequence: {
		seq: number;
		charStart: number;
		charEnd: number;
		text: string;
	};
	prevSequenceText: string | null;
	nextSequenceText: string | null;
	documentMemos: DocumentMemo[];
	existingCNameLabels: string[];
	existingCNameLabelsLowerSet: Set<string>;
	primary: TierModel;
	fallback: TierModel | null;
	signal?: AbortSignal;
	timeoutMs?: number;
	prov: WriteProvenance;
	onCall?: (call: ActantCall, phaseLabel: string) => Promise<void> | void;
}

const PHASE_LABEL = (opts: RunForensicOptions, sub: string) =>
	`seq ${opts.sequence.seq} ${sub}`;

const MEMO_HITS_LIMIT_C = 10;
const MEMO_HITS_LIMIT_D = 5;

function baseChatOpts(opts: RunForensicOptions, phaseLabel: string) {
	return {
		primary: opts.primary,
		fallback: opts.fallback,
		emptyMode: 'prose' as const,
		runId: opts.runId,
		phaseLabel,
		documentIds: [opts.documentId],
		timeoutMs: opts.timeoutMs
	};
}

export async function runCnameForensicForSequence(
	opts: RunForensicOptions
): Promise<ForensicSequenceResult> {
	const calls: ActantCall[] = [];
	const errors: string[] = [];
	const raws: ActantRaws = {};

	const finish = (
		partial: Omit<ForensicSequenceResult, 'calls' | 'totalTokens' | 'errors'>
	): ForensicSequenceResult => {
		const result: ForensicSequenceResult = {
			...partial,
			calls,
			totalTokens: sumTokens(calls),
			errors
		};
		writeSequenceTrace(opts.runId, opts, result, raws);
		return result;
	};

	// ── A: Abduktor ────────────────────────────────────────────────
	let aResp: ChatWithEmptyRetryResult;
	const aPhase = PHASE_LABEL(opts, 'A abduktor');
	try {
		aResp = await chatWithEmptyRetry({
			...baseChatOpts(opts, aPhase),
			system: cnameAbductorSystem(),
			messages: [{ role: 'user', content: buildCnameAbductorMessage(opts.sequence.seq, opts.sequence.text) }]
		});
	} catch (err) {
		rethrowAbortOrFatal(err);
		errors.push(`A: ${err instanceof Error ? err.message : String(err)}`);
		return finish({
			abduktion: null,
			triage: null,
			advocacy: null,
			judgment: null,
			outcome: 'no-abduktion',
			commitResult: null,
			commitForm: null,
			noCodeReason: 'A threw non-fatally — treated as no-abduktion'
		});
	}
	recordCall(calls, 'A', aResp);
	raws.A = aResp.text;
	if (opts.onCall) await opts.onCall(calls[calls.length - 1], aPhase);

	const aParsed = parseAbductor(aResp.text);
	if (aParsed.kind === 'no-abduktion') {
		return finish({
			abduktion: null,
			triage: null,
			advocacy: null,
			judgment: null,
			outcome: 'no-abduktion',
			commitResult: null,
			commitForm: null,
			noCodeReason: aResp.text.trim()
				? 'A produced no parseable abduction (no commit block found)'
				: 'A produced KEINE ABDUKTION'
		});
	}

	// ── B: Gatekeeper ──────────────────────────────────────────────
	let bResp: ChatWithEmptyRetryResult;
	const bPhase = PHASE_LABEL(opts, 'B gatekeeper');
	const abductorRawForDownstream = aResp.text.trim();
	try {
		bResp = await chatWithEmptyRetry({
			...baseChatOpts(opts, bPhase),
			system: cnameGatekeeperSystem(),
			messages: [
				{
					role: 'user',
					content: buildCnameGatekeeperMessage(
						opts.sequence.seq,
						opts.sequence.text,
						abductorRawForDownstream
					)
				}
			]
		});
	} catch (err) {
		rethrowAbortOrFatal(err);
		errors.push(`B: ${err instanceof Error ? err.message : String(err)}`);
		const triage: GatekeeperOutput = {
			verdict: 'non-trivial',
			prose: '<B threw, defaulting non-trivial>'
		};
		return await continueAtCDE(
			opts,
			aParsed,
			abductorRawForDownstream,
			triage,
			calls,
			errors,
			raws,
			finish
		);
	}
	recordCall(calls, 'B', bResp);
	raws.B = bResp.text;
	if (opts.onCall) await opts.onCall(calls[calls.length - 1], bPhase);

	const bParsed = parseGatekeeper(bResp.text);
	const triage: GatekeeperOutput =
		bParsed ??
		(() => {
			errors.push(
				`B: no [TRIVIAL]/[NON-TRIVIAL] tag in output — defaulting non-trivial (safe). raw=${JSON.stringify(bResp.text.slice(0, 300))}`
			);
			return { verdict: 'non-trivial' as const, prose: '<B parse failed>' };
		})();

	if (triage.verdict === 'trivial') {
		// Bypass C/D — use A's commit form directly.
		return await runEAndFinish(
			opts,
			aParsed,
			triage,
			null,
			null,
			aParsed.commitForm,
			calls,
			errors,
			finish
		);
	}

	return await continueAtCDE(
		opts,
		aParsed,
		abductorRawForDownstream,
		triage,
		calls,
		errors,
		raws,
		finish
	);
}

// ── C/D-Pfad ──────────────────────────────────────────────────────────

async function continueAtCDE(
	opts: RunForensicOptions,
	abduktion: Extract<AbduktorOutput, { kind: 'abduktion' }>,
	abductorRaw: string,
	triage: GatekeeperOutput,
	calls: ActantCall[],
	errors: string[],
	raws: ActantRaws,
	finish: (
		partial: Omit<ForensicSequenceResult, 'calls' | 'totalTokens' | 'errors'>
	) => ForensicSequenceResult
): Promise<ForensicSequenceResult> {
	// ── C-1: Anwalt mit i±1 ────────────────────────────────────────
	let c1Resp: ChatWithEmptyRetryResult;
	const c1Phase = PHASE_LABEL(opts, 'C-1 advocate');
	try {
		c1Resp = await chatWithEmptyRetry({
			...baseChatOpts(opts, c1Phase),
			system: cnameAdvocateSystem(),
			messages: [
				{
					role: 'user',
					content: buildCnameAdvocateMessage(
						opts.sequence.seq,
						opts.sequence.text,
						opts.prevSequenceText,
						opts.nextSequenceText,
						abductorRaw,
						triage.prose
					)
				}
			]
		});
	} catch (err) {
		rethrowAbortOrFatal(err);
		errors.push(`C-1: ${err instanceof Error ? err.message : String(err)}`);
		return finish({
			abduktion,
			triage,
			advocacy: null,
			judgment: null,
			outcome: 'no-code',
			commitResult: null,
			commitForm: null,
			noCodeReason: 'C-1 failed non-fatally — no advocacy possible'
		});
	}
	recordCall(calls, 'C-1', c1Resp);
	raws['C-1'] = c1Resp.text;
	if (opts.onCall) await opts.onCall(calls[calls.length - 1], c1Phase);

	let advocacy = parseAdvocate(c1Resp.text);
	if (!advocacy) {
		errors.push(
			`C-1: no recognized advocacy tag — raw=${JSON.stringify(c1Resp.text.slice(0, 300))}`
		);
		return finish({
			abduktion,
			triage,
			advocacy: null,
			judgment: null,
			outcome: 'no-code',
			commitResult: null,
			commitForm: null,
			noCodeReason: 'C-1 produced no parseable advocacy tag'
		});
	}

	// ── C-2 (Eskalation auf Memo-Treffer) ──────────────────────────
	if (advocacy.kind === 'need-memo-search') {
		const searchTerms = advocacy.searchTerms;
		const memoHits = findMemoHits(opts.documentMemos, searchTerms, MEMO_HITS_LIMIT_C);
		raws['C-2-memoHits'] = memoHits.map((m) => ({
			label: m.label,
			memo: m.memo,
			source: m.source
		}));
		let c2Resp: ChatWithEmptyRetryResult | null = null;
		const c2Phase = PHASE_LABEL(opts, 'C-2 advocate-memo');
		try {
			c2Resp = await chatWithEmptyRetry({
				...baseChatOpts(opts, c2Phase),
				system: cnameAdvocateSystem(),
				messages: [
					{
						role: 'user',
						content: buildCnameAdvocateMemoMessage(
							opts.sequence.seq,
							opts.sequence.text,
							opts.prevSequenceText,
							opts.nextSequenceText,
							abductorRaw,
							searchTerms,
							memoHits
						)
					}
				]
			});
		} catch (err) {
			rethrowAbortOrFatal(err);
			errors.push(`C-2: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (c2Resp) {
			recordCall(calls, 'C-2', c2Resp);
			raws['C-2'] = c2Resp.text;
			if (opts.onCall) await opts.onCall(calls[calls.length - 1], c2Phase);
			const c2Parsed = parseAdvocate(c2Resp.text);
			if (c2Parsed && c2Parsed.kind === 'evidence-complete') {
				advocacy = c2Parsed;
			} else {
				errors.push(
					`C-2: no [EVIDENCE-COMPLETE] tag — using C-1 advocacy as-is. raw=${JSON.stringify(c2Resp.text.slice(0, 300))}`
				);
				// Fall back to C-1's prose; treat as evidence-complete for D
				advocacy = { kind: 'evidence-complete', prose: advocacy.prose };
			}
		} else {
			// C-2 threw non-fatally; use C-1 prose
			advocacy = { kind: 'evidence-complete', prose: advocacy.prose };
		}
	}

	const advocateProse = advocacy.prose;

	// ── D-1: Richter ────────────────────────────────────────────────
	let d1Resp: ChatWithEmptyRetryResult;
	const d1Phase = PHASE_LABEL(opts, 'D-1 judge');
	try {
		d1Resp = await chatWithEmptyRetry({
			...baseChatOpts(opts, d1Phase),
			system: cnameJudgeSystem(),
			messages: [
				{
					role: 'user',
					content: buildCnameJudgeMessage(
						opts.sequence.seq,
						opts.sequence.text,
						abductorRaw,
						advocateProse,
						triage.prose
					)
				}
			]
		});
	} catch (err) {
		rethrowAbortOrFatal(err);
		errors.push(`D-1: ${err instanceof Error ? err.message : String(err)}`);
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment: null,
			outcome: 'no-code',
			commitResult: null,
			commitForm: null,
			noCodeReason: 'D-1 failed non-fatally — judgment unavailable'
		});
	}
	recordCall(calls, 'D-1', d1Resp);
	raws['D-1'] = d1Resp.text;
	if (opts.onCall) await opts.onCall(calls[calls.length - 1], d1Phase);

	let judgment = parseJudge(d1Resp.text);
	if (!judgment) {
		errors.push(
			`D-1: no recognized verdict tag — defaulting unplausibel (safe). raw=${JSON.stringify(d1Resp.text.slice(0, 400))}`
		);
		judgment = { kind: 'unplausibel', prose: '<D-1 parse failed>' };
	}

	// ── D-2 (Eskalation auf drittes Belegstück) ────────────────────
	if (judgment.kind === 'need-third-evidence') {
		const searchTerms = judgment.searchTerms;
		const memoHits = findMemoHits(opts.documentMemos, searchTerms, MEMO_HITS_LIMIT_D);
		raws['D-2-memoHits'] = memoHits.map((m) => ({
			label: m.label,
			memo: m.memo,
			source: m.source
		}));
		let d2Resp: ChatWithEmptyRetryResult | null = null;
		const d2Phase = PHASE_LABEL(opts, 'D-2 judge-third');
		try {
			d2Resp = await chatWithEmptyRetry({
				...baseChatOpts(opts, d2Phase),
				system: cnameJudgeSystem(),
				messages: [
					{
						role: 'user',
						content: buildCnameJudgeThirdEvidenceMessage(
							opts.sequence.seq,
							opts.sequence.text,
							abductorRaw,
							advocateProse,
							searchTerms,
							memoHits
						)
					}
				]
			});
		} catch (err) {
			rethrowAbortOrFatal(err);
			errors.push(`D-2: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (d2Resp) {
			recordCall(calls, 'D-2', d2Resp);
			raws['D-2'] = d2Resp.text;
			if (opts.onCall) await opts.onCall(calls[calls.length - 1], d2Phase);
			const d2Parsed = parseJudge(d2Resp.text);
			if (d2Parsed && d2Parsed.kind !== 'need-third-evidence') {
				judgment = d2Parsed;
			} else {
				errors.push(
					`D-2: no terminal verdict — defaulting unplausibel (safe). raw=${JSON.stringify(d2Resp.text.slice(0, 400))}`
				);
				judgment = { kind: 'unplausibel', prose: '<D-2 parse failed>' };
			}
		} else {
			judgment = { kind: 'unplausibel', prose: '<D-2 failed>' };
		}
	}

	if (judgment.kind === 'unplausibel') {
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment,
			outcome: 'no-code',
			commitResult: null,
			commitForm: null,
			noCodeReason: judgment.prose || 'verdict unplausibel'
		});
	}

	// ISOMORPH oder PRAEZISIERT → E
	return await runEAndFinish(
		opts,
		abduktion,
		triage,
		advocacy,
		judgment,
		judgment.commitForm,
		calls,
		errors,
		finish
	);
}

// ── E: Operativ (deterministisch, kein LLM-Call) ──────────────────────

async function runEAndFinish(
	opts: RunForensicOptions,
	abduktion: Extract<AbduktorOutput, { kind: 'abduktion' }>,
	triage: GatekeeperOutput,
	advocacy: AdvocateOutput | null,
	judgment: JudgeOutput | null,
	commitForm: CommitForm,
	calls: ActantCall[],
	errors: string[],
	finish: (
		partial: Omit<ForensicSequenceResult, 'calls' | 'totalTokens' | 'errors'>
	) => ForensicSequenceResult
): Promise<ForensicSequenceResult> {
	// 1. Quote byte-für-byte in der Sequenz?
	// LLM-Tokenizer machen drei systematische Dinge mit Quotes, die nie semantisch
	// gemeint sind: Trailing-/Leading-Whitespace, Unicode-Combining-Form-Umlaute,
	// und Smart-Quotes statt ASCII-Apostrophen. Wir tolerieren genau diese drei
	// Klassen, ansonsten muss die ANKER-Stelle byte-identisch sein.
	const rawQuote = commitForm.quote;
	const { foundIdx: localIdx, foundQuote: quote } = locateQuote(opts.sequence.text, rawQuote);
	if (localIdx < 0) {
		const diag = diagnoseQuoteMismatch(opts.sequence.text, rawQuote);
		errors.push(
			`E: ANKER not byte-for-byte in sequence — quote=${JSON.stringify(rawQuote.slice(0, 80))} ${diag}`
		);
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment,
			outcome: 'no-code',
			commitResult: null,
			commitForm,
			noCodeReason: 'ANKER quote not byte-for-byte in sequence'
		});
	}

	// 2. Label und Memo Mindest-Substanz
	const normalizedLabel = commitForm.label.trim();
	if (!normalizedLabel) {
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment,
			outcome: 'no-code',
			commitResult: null,
			commitForm,
			noCodeReason: 'CODE empty after normalization'
		});
	}
	const normalizedMemo = commitForm.memo.trim();
	if (!normalizedMemo) {
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment,
			outcome: 'no-code',
			commitResult: null,
			commitForm,
			noCodeReason: 'MEMO empty — no characterization to anchor the code'
		});
	}
	if (normalizedMemo.toLowerCase() === normalizedLabel.toLowerCase()) {
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment,
			outcome: 'no-code',
			commitResult: null,
			commitForm,
			noCodeReason: 'MEMO duplicates CODE — no characterization'
		});
	}

	// 3. Reuse-Check (dokument-scoped)
	const isReuse = opts.existingCNameLabelsLowerSet.has(normalizedLabel.toLowerCase());

	// 4. Commit
	const pos0 = opts.sequence.charStart + localIdx;
	const pos1 = pos0 + quote.length;
	let commitResult: CommitResult;
	try {
		commitResult = await commitCodedPassage({
			projectId: opts.projectId,
			bearbeiterNamingId: opts.bearbeiterNamingId,
			documentId: opts.documentId,
			codeLabel: normalizedLabel,
			anchor: { pos0, pos1, text: quote },
			reasoning: normalizedMemo,
			codeMemo: normalizedMemo,
			prov: opts.prov
		});
	} catch (err) {
		errors.push(`E commit: ${err instanceof Error ? err.message : String(err)}`);
		return finish({
			abduktion,
			triage,
			advocacy,
			judgment,
			outcome: 'no-code',
			commitResult: null,
			commitForm,
			noCodeReason: `commit failed: ${err instanceof Error ? err.message : String(err)}`
		});
	}

	// 5. Mutable Pools aktualisieren — spätere Sequenzen sehen den neuen Code/Memo
	if (!opts.existingCNameLabelsLowerSet.has(commitResult.codeLabel.toLowerCase())) {
		opts.existingCNameLabelsLowerSet.add(commitResult.codeLabel.toLowerCase());
		opts.existingCNameLabels.push(commitResult.codeLabel);
	}
	opts.documentMemos.push({
		source: 'cname',
		label: commitResult.codeLabel,
		memo: normalizedMemo
	});

	return finish({
		abduktion,
		triage,
		advocacy,
		judgment,
		outcome: isReuse ? 'commit-reuse' : 'commit-new',
		commitResult,
		commitForm,
		noCodeReason: null
	});
}
