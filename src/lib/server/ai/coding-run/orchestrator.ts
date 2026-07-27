// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Orchestrator — Run-Management für den Per-Dokument-Coding-Run.
//
// Die Run-Lifecycle-Schicht stammt aus einem älteren Pipeline-Orchestrator
// und ist auf die einfachere Topologie hier angepasst:
//   * (case_id, central_document_id) → (project_id, document_id).
//   * Heuristik-Phasen (h1/h2/h3/h4/h5/meta + scope) → ein einziger
//     Sequenz-Walk mit fixer H1↔H2-Konfrontation. Kein User-wählbarer
//     Modus, kein Sequenz-Cap — der Run läuft über das ganze Dokument,
//     Begrenzung erfolgt über Pause/Cancel.
//   * cleanupSynthesisOutputs, snapshotReviewerMemos, H4-Checkpoint-
//     Cascades: entfallen, weil die zugehörigen Substrate hier fehlen.
//
// Was wir 1:1 übernehmen:
//   * Status-Lifecycle (running/paused/completed/failed/cancelled).
//   * Cancel-Intent-Trennung (pause vs. cancel über cancel_intent-Spalte).
//   * Partial-unique-Slot (1 nicht-terminaler Run pro project+document).
//   * Resume durch erneuten Start (Reactivate des bestehenden Runs statt
//     neuer Eintrag).
//   * updateProgress als zentrale Stelle für last_event_at + accumulated
//     tokens + last_step_label + ALS-Step-Label (für den Stuck-Watchdog
//     und die Activity-Anzeige).
//
// Was hier NEU ist:
//   * segmentation_snapshot: beim fresh Start läuft segmentDocument einmal,
//     die Sequenz-Liste wird in coding_runs gespeichert. Resume liest den
//     Snapshot statt re-segmentation — sonst würde eine Tunable-Änderung
//     oder ein Embedding-Drift das current_index-Mapping zerstören.
//   * sequence_status: Per-Sequenz-Done-Flags, geschrieben vom Loop nach
//     jedem erfolgreichen commitCodedPassage. Resume skippt erledigte
//     Sequenzen, ohne die LLM-Calls neu zu fahren. Server-seitige
//     Idempotenz in commitCodedPassage ist die zweite Linie.
//   * chatWithEmptyRetry pro H1/H2-Step (siehe chat-with-retry.ts):
//     leere/unparseable Antwort → eine zweite Primary-Probe → wenn auch
//     diese leer ist, einmal Eskalation auf resolveFallback(tier) (default
//     Sonnet). Adressiert den MiMo-Token-Meltdown auf langen Sequenzen
//     (Lab-Befund 2026-05-24, v1-DE seg 2/3 produzierten je 0 Codes;
//     Methode hielt, aber das Dokument verlor Sequenzen). Eskalations-
//     Modell und ob überhaupt eskaliert wird sind tier-konfigurierbar.

import { query, queryOne } from '../../db/index.js';
import { logAiInteraction } from '../../db/queries/ai.js';
import type { WriteProvenance } from '../runtime/tool-executor.js';
import { isFatalProviderError } from '../client.js';
import { setStepLabel } from './activity-tracker.js';
import { segmentDocument, type Sequence } from './segmentation.js';
import { resolveTier, resolveFallback } from './model-tiers.js';
import { chatWithEmptyRetry } from './chat-with-retry.js';
import {
	getOrCreateCodingRunNaming,
	commitSequenceNaming,
	type CommitResult
} from './write.js';
import {
	h1ProposeSystem, buildH1ProposeMessage,
	h2ReadSystem, buildH2ReadMessage,
	h2ConfrontSystem, buildH2ConfrontMessage,
	h1ReactSystem, buildH1ReactMessage
} from './prompts.js';
import { runCnameForensicForSequence } from './cname-forensic.js';

import {
	parseJsonArray,
	resolveSurvivors,
	loadDocumentTitle,
	loadExistingCodeLabels,
	loadExistingCNameLabels,
	loadDocumentMemos,
	type CodingRunEvent,
	type CodingRunResult,
	type SequenceTrace,
	type H1Code,
	type H2Verdict,
	type H1Reaction,
	type DocumentMemo
} from './index.js';

// Run-Options-Slot — aktuell leer, reserviert für zukünftige pfad-relevante
// Felder. Wird beim Resume defensiv durchgereicht (mergeOptions).
export type CodingRunOptions = Record<string, never>;

export interface CodingRunRow {
	id: string;
	project_id: string;
	document_id: string;
	started_by_user_id: string;
	status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
	current_index: number;
	total_sequences: number | null;
	last_step_label: string | null;
	options: CodingRunOptions;
	segmentation_snapshot: Sequence[];
	segmentation_method: Sequence['method'] | null;
	sequence_status: Record<string, 'done'>;
	cancel_requested: boolean;
	cancel_intent: 'pause' | 'cancel' | null;
	error_message: string | null;
	accumulated_input_tokens: number;
	accumulated_output_tokens: number;
	accumulated_cache_read_tokens: number;
	codes_committed: number;
	started_at: string;
	paused_at: string | null;
	resumed_at: string | null;
	completed_at: string | null;
	cancelled_at: string | null;
	last_event_at: string;
}

// ── Run-Lifecycle ─────────────────────────────────────────────────────────

/**
 * Findet den aktiven (running/paused) Run für ein (project, document) oder gibt
 * null zurück. Es kann höchstens einen geben — Unique-Index aus Mig 027.
 */
export async function getActiveRun(
	projectId: string,
	documentId: string
): Promise<CodingRunRow | null> {
	return queryOne<CodingRunRow>(
		`SELECT * FROM coding_runs
		 WHERE project_id = $1 AND document_id = $2
		   AND status IN ('running', 'paused')
		 LIMIT 1`,
		[projectId, documentId]
	);
}

/**
 * Findet den jüngsten Run für (project, document) (egal welcher Status). Für
 * die UI-Status-Anzeige nach Reload.
 */
export async function getLatestRun(
	projectId: string,
	documentId: string
): Promise<CodingRunRow | null> {
	return queryOne<CodingRunRow>(
		`SELECT * FROM coding_runs
		 WHERE project_id = $1 AND document_id = $2
		 ORDER BY started_at DESC
		 LIMIT 1`,
		[projectId, documentId]
	);
}

export async function getRun(runId: string): Promise<CodingRunRow | null> {
	return queryOne<CodingRunRow>(`SELECT * FROM coding_runs WHERE id = $1`, [runId]);
}

/**
 * Erzeugt einen neuen Run oder reaktiviert einen pausierten/laufenden Run für
 * (project, document). Wenn ein aktiver Run existiert, wird er auf
 * status='running' + cancel_requested=false gesetzt und zurückgegeben (Resume).
 *
 * Ein hängengebliebener 'running'-Run wird ebenso reaktiviert — der
 * Stuck-Watchdog hat ihn ggf. nach Server-Restart hinterlassen, der nächste
 * Start nimmt den Faden auf.
 *
 * Beim fresh Start läuft segmentDocument einmal hier, das Snapshot wird mit
 * dem INSERT geschrieben. Resume verwendet den Snapshot ohne Re-Segmentation.
 * Sequenz-Cap gibt es nicht — der Run läuft über das gesamte Dokument.
 */
export async function startOrResumeRun(
	projectId: string,
	documentId: string,
	userId: string
): Promise<{ run: CodingRunRow; resumed: boolean }> {
	const existing = await getActiveRun(projectId, documentId);
	if (existing) {
		const updated = await queryOne<CodingRunRow>(
			`UPDATE coding_runs
			 SET status = 'running',
			     cancel_requested = false,
			     cancel_intent = NULL,
			     resumed_at = now(),
			     paused_at = NULL,
			     last_event_at = now()
			 WHERE id = $1
			 RETURNING *`,
			[existing.id]
		);
		return { run: updated!, resumed: true };
	}

	// Fresh start: Segmentation einmal hier, Snapshot mit INSERT.
	const doc = await queryOne<{ full_text: string | null }>(
		`SELECT dc.full_text FROM document_content dc
		 JOIN namings n ON n.id = dc.naming_id
		 WHERE dc.naming_id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[documentId, projectId]
	);
	if (!doc) throw new Error('Document not found in this project');
	const fullText = doc.full_text || '';
	const sequences = await segmentDocument(documentId, fullText);
	if (sequences.length === 0) {
		throw new Error('No segmentable content in document');
	}
	const segmentationMethod = sequences[0].method;

	const created = await queryOne<CodingRunRow>(
		`INSERT INTO coding_runs
		   (project_id, document_id, started_by_user_id, status,
		    segmentation_snapshot, segmentation_method, total_sequences)
		 VALUES ($1, $2, $3, 'running', $4, $5, $6)
		 RETURNING *`,
		[
			projectId,
			documentId,
			userId,
			JSON.stringify(sequences),
			segmentationMethod,
			sequences.length
		]
	);
	return { run: created!, resumed: false };
}

/**
 * Setzt das Cancel-Signal mit Intent (Pause oder endgültiger Abbruch). Der
 * Cancel-Watcher in +server.ts pollt cancel_requested alle 500ms und ruft
 * markPausedOrCancelled, sobald gesetzt; der Loop selbst prüft das Flag an
 * Idempotenz-Grenzen (zwischen Sequenzen) ebenfalls.
 *
 * Last-write-wins auf cancel_intent: nachträgliches Cancel (intent='cancel')
 * überschreibt vorhergehendes Pause, und umgekehrt.
 *
 * Bei intent='cancel': Status wird synchron auf 'cancelled' geflippt — sowohl
 * für 'running' als auch für 'paused'. Grund: der Cancel-Watcher in +server.ts
 * läuft nur, solange der SSE-Stream offen ist. Bricht der Stream weg (Client-
 * Disconnect, Server-Restart, Crash), bleibt der Run sonst als Zombie mit
 * status='running' im Slot stehen und blockiert neue Runs. Synchrones
 * Statusflippen ist idempotent (Status-Guard auf 'running'/'paused') und
 * race-fest gegen mehrfachen Cancel-Klick.
 *
 * Ein noch im Stream laufender Run wird vom Cancel-Watcher zusätzlich via
 * runAbort.abort() unterbrochen, sobald cancel_requested=true gelesen wird —
 * der Loop schließt dann sauber über die AbortError-Catch-Branch. Die
 * Statusflippung selbst ist also kein Eingriff in den Loop, nur eine Garantie,
 * dass der Slot frei ist, selbst wenn der Loop schon nicht mehr läuft.
 */
export async function requestCancel(
	runId: string,
	intent: 'pause' | 'cancel' = 'pause'
): Promise<void> {
	if (intent === 'cancel') {
		await query(
			`UPDATE coding_runs
			 SET status = 'cancelled',
			     cancelled_at = now(),
			     completed_at = now(),
			     cancel_intent = 'cancel',
			     cancel_requested = true,
			     last_event_at = now()
			 WHERE id = $1 AND status IN ('running', 'paused')`,
			[runId]
		);
		return;
	}
	await query(
		`UPDATE coding_runs
		 SET cancel_requested = true,
		     cancel_intent = 'pause',
		     last_event_at = now()
		 WHERE id = $1 AND status IN ('running', 'paused')`,
		[runId]
	);
}

/**
 * Wird aus dem Loop an Idempotenz-Grenzen aufgerufen, wenn cancel_requested
 * erkannt wird. Liest cancel_intent und setzt den Status entsprechend
 * ('paused' bei intent='pause' oder NULL, 'cancelled' bei intent='cancel').
 *
 * Auch direkt vom Cancel-Watcher in +server.ts aufrufbar — der wartet nicht,
 * dass die Loop das Flag liest (ein in-flight LLM-Call würde das minutenlang
 * verzögern), sondern markiert sofort und feuert dann runAbort.abort().
 */
export async function markPausedOrCancelled(runId: string, reason?: string): Promise<void> {
	if (reason !== undefined) {
		await query(
			`UPDATE coding_runs
			 SET status = CASE WHEN cancel_intent = 'cancel' THEN 'cancelled' ELSE 'paused' END,
			     paused_at = CASE WHEN cancel_intent = 'cancel' THEN paused_at ELSE now() END,
			     cancelled_at = CASE WHEN cancel_intent = 'cancel' THEN now() ELSE cancelled_at END,
			     completed_at = CASE WHEN cancel_intent = 'cancel' THEN now() ELSE completed_at END,
			     last_event_at = now(),
			     error_message = $2
			 WHERE id = $1`,
			[runId, reason]
		);
	} else {
		await query(
			`UPDATE coding_runs
			 SET status = CASE WHEN cancel_intent = 'cancel' THEN 'cancelled' ELSE 'paused' END,
			     paused_at = CASE WHEN cancel_intent = 'cancel' THEN paused_at ELSE now() END,
			     cancelled_at = CASE WHEN cancel_intent = 'cancel' THEN now() ELSE cancelled_at END,
			     completed_at = CASE WHEN cancel_intent = 'cancel' THEN now() ELSE completed_at END,
			     last_event_at = now()
			 WHERE id = $1`,
			[runId]
		);
	}
}

async function markCompleted(runId: string): Promise<void> {
	// Status-Guard analog zu markFailed: nur überschreiben, wenn noch 'running'.
	// Verhindert, dass eine in-flight letzte Sequenz, deren cancel zwischen
	// Pre-Check und Sequenz-Ende eintraf, den vom Cancel-Watcher (oder von
	// requestCancel) bereits gesetzten 'cancelled'-Status auf 'completed'
	// zurücksetzt.
	await query(
		`UPDATE coding_runs
		 SET status = 'completed',
		     completed_at = now(),
		     last_event_at = now(),
		     last_step_label = NULL
		 WHERE id = $1 AND status = 'running'`,
		[runId]
	);
}

async function markFailed(runId: string, message: string): Promise<void> {
	// Status-Guard: nur überschreiben, wenn der Run noch
	// 'running' ist. Sonst würde markFailed einen vom Cancel-Watcher bereits
	// finalisierten Run (status='cancelled'/'paused') auf 'failed' zurück-
	// setzen — z.B. wenn die in-flight chat() durch Cancel-Abort throwt und
	// der äußere Catch markFailed aufruft. Cancel-Watcher ist autoritativ.
	await query(
		`UPDATE coding_runs
		 SET status = 'failed',
		     completed_at = now(),
		     last_event_at = now(),
		     error_message = $2
		 WHERE id = $1 AND status = 'running'`,
		[runId, message.slice(0, 500)]
	);
}

/**
 * Zentrale Schreibstelle für Run-State-Updates im Loop:
 * last_event_at (Anker für den Stuck-Watchdog!), current_index,
 * last_step_label, accumulated tokens, sequence_status.
 *
 * Setzt zusätzlich das Step-Label im ALS-Context — damit `chat()` die
 * Activity mit dem aktuellen Label meldet und der Status-Endpoint sieht,
 * was gerade läuft.
 */
async function updateProgress(
	runId: string,
	currentIndex: number,
	label: string,
	tokenDelta: { input: number; output: number; cacheRead: number },
	sequenceStatusPatch?: Record<string, 'done'>,
	codesCommittedDelta = 0
): Promise<void> {
	setStepLabel(label);
	if (sequenceStatusPatch) {
		await query(
			`UPDATE coding_runs
			 SET current_index = $2,
			     last_step_label = $3,
			     last_event_at = now(),
			     accumulated_input_tokens = accumulated_input_tokens + $4,
			     accumulated_output_tokens = accumulated_output_tokens + $5,
			     accumulated_cache_read_tokens = accumulated_cache_read_tokens + $6,
			     sequence_status = sequence_status || $7::jsonb,
			     codes_committed = codes_committed + $8
			 WHERE id = $1`,
			[
				runId,
				currentIndex,
				label,
				tokenDelta.input,
				tokenDelta.output,
				tokenDelta.cacheRead,
				JSON.stringify(sequenceStatusPatch),
				codesCommittedDelta
			]
		);
	} else {
		await query(
			`UPDATE coding_runs
			 SET current_index = $2,
			     last_step_label = $3,
			     last_event_at = now(),
			     accumulated_input_tokens = accumulated_input_tokens + $4,
			     accumulated_output_tokens = accumulated_output_tokens + $5,
			     accumulated_cache_read_tokens = accumulated_cache_read_tokens + $6,
			     codes_committed = codes_committed + $7
			 WHERE id = $1`,
			[
				runId,
				currentIndex,
				label,
				tokenDelta.input,
				tokenDelta.output,
				tokenDelta.cacheRead,
				codesCommittedDelta
			]
		);
	}
}

/**
 * Per-Sequenz-Pre-Check: lädt cancel_requested und sequence_status FRISCH aus
 * der DB. Wird VOR jedem Sequenz-Trip aufgerufen — der Cancel-Watcher in
 * +server.ts hat sein eigenes 500ms-Polling, aber der Loop muss an seinen
 * Idempotenz-Grenzen selber checken (und sequence_status sehen, falls eine
 * parallel-laufende DB-Operation das Flag setzt; selten, aber möglich).
 */
async function loadRunCheckpoint(
	runId: string
): Promise<{ cancelRequested: boolean; sequenceStatus: Record<string, 'done'> }> {
	const row = await queryOne<{ cancel_requested: boolean; sequence_status: Record<string, 'done'> }>(
		`SELECT cancel_requested, sequence_status FROM coding_runs WHERE id = $1`,
		[runId]
	);
	return {
		cancelRequested: row?.cancel_requested ?? false,
		sequenceStatus: row?.sequence_status ?? {}
	};
}

// ── Loop ──────────────────────────────────────────────────────────────────

/**
 * Top-Level-Loop. Wird vom +server.ts INNERHALB des withRun-Blocks gerufen
 * (damit `chat()` das per-Run-AbortSignal via ALS lesen und durchreichen
 * kann; Mid-Call-Cancel wird mit dem Stream-Disconnect wirksam, nicht erst
 * zwischen Sequenzen).
 *
 * Emits die SSE-Progress-Events; das terminale 'completed'/'failed'/'paused'/
 * 'cancelled' framet +server.ts.
 *
 * Idempotenz: skippt Sequenzen, deren Index in sequence_status='done' steht
 * (Resume-Skip). commitCodedPassage ist server-seitig zusätzlich idempotent
 * (write.ts) — Doppel-Linie für den Fall, dass ein Crash zwischen
 * commitCodedPassage und sequence_status-Update liegt.
 */
export async function runCodingRunLoop(
	runId: string,
	emit: (e: CodingRunEvent) => void
): Promise<void> {
	const run = await getRun(runId);
	if (!run) throw new Error(`Run ${runId} not found`);

	const prov: WriteProvenance = { persona: 'coding-run', runId };

	const h1Tier = resolveTier('coding-run.h1');
	const h2Tier = resolveTier('coding-run.h2');
	const h1Fallback = resolveFallback('coding-run.h1');
	const h2Fallback = resolveFallback('coding-run.h2');
	const h1Model = `${h1Tier.provider}/${h1Tier.model}`;
	const h2Model = `${h2Tier.provider}/${h2Tier.model}`;

	const bearbeiter = await getOrCreateCodingRunNaming(run.project_id);
	const { title } = await loadDocumentTitle(run.project_id, run.document_id);

	// Snapshot lesen, nicht re-segmentieren — Header-Begründung siehe oben.
	const sequences: Sequence[] = run.segmentation_snapshot;
	const segmentationMethod: Sequence['method'] = run.segmentation_method ?? 'char-window';

	emit({ type: 'run-init', runId });
	emit({ type: 'segmented', total: sequences.length, method: segmentationMethod });

	const codeLabels = await loadExistingCodeLabels(run.project_id);
	const seenLower = new Set(codeLabels.map((l) => l.toLowerCase()));

	// CName-Forensic-Pipeline-Material (Pass 2). Beides dokument-scoped, kein
	// Quer-Gedächtnis über Dokumente. Mutable: die Pipeline appendt neue
	// Labels + Memos nach jedem erfolgreichen Commit, damit spätere Sequenzen
	// die intra-document Constant Comparison sehen.
	const cnameLabels = await loadExistingCNameLabels(run.project_id, run.document_id);
	const cnameSeenLower = new Set(cnameLabels.map((l) => l.toLowerCase()));
	const documentMemos: DocumentMemo[] = await loadDocumentMemos(
		run.project_id,
		run.document_id
	);

	const trace: SequenceTrace[] = [];
	const comprehensionLine: string[] = [];
	// Tokens dieses Loop-Aufrufs. Bei Resume zählt die DB-Spalte
	// accumulated_*_tokens den Gesamtstand kumulativ; das hier ist der Anteil
	// dieser einen Loop-Iteration für die SSE-Events.
	let tokensInThisLoop = 0;
	let codesCommitted = 0;

	for (const [i, sequence] of sequences.entries()) {
		// Pre-Check an der Idempotenz-Grenze: schon erledigt? Cancel-Signal
		// gesetzt? (Cancel-Watcher hat sein eigenes 500ms-Polling — aber der
		// Loop muss auch hier prüfen, damit ein zwischen-Sequenz-Cancel ohne
		// Watcher-Hop greift.)
		const checkpoint = await loadRunCheckpoint(runId);
		if (checkpoint.cancelRequested) {
			await markPausedOrCancelled(runId);
			return; // +server.ts emittet 'paused'/'cancelled' aus dem Cancel-Watcher
		}
		const seqKey = String(i);
		if (checkpoint.sequenceStatus[seqKey] === 'done') {
			// Skip — diese Sequenz war ein früherer Lauf erledigt. Wir
			// emittieren trotzdem ein sequence-done für die UI-Konsistenz,
			// markieren codesCommitted: 0 (die Codes stehen schon in der DB).
			emit({
				type: 'sequence-done',
				index: i + 1,
				total: sequences.length,
				seq: sequence.seq,
				codesCommitted: 0,
				tokens: 0,
				cumulativeTokens: tokensInThisLoop
			});
			continue;
		}

		emit({ type: 'sequence-start', index: i + 1, total: sequences.length, seq: sequence.seq });
		const tokensAtStart = tokensInThisLoop;

		try {
			// ── 1. H1 proposes ────────────────────────────────────────
			const h1Resp = await chatWithEmptyRetry({
				system: h1ProposeSystem(),
				messages: [{ role: 'user', content: buildH1ProposeMessage(sequence.seq, sequence.text, codeLabels) }],
				primary: h1Tier,
				fallback: h1Fallback,
				emptyMode: 'json-array',
				runId,
				phaseLabel: `seq ${i + 1}/${sequences.length} H1 propose`,
				responseFormat: 'json',
				documentIds: [run.document_id]
			});
			tokensInThisLoop += h1Resp.tokensUsed;
			await updateProgress(
				runId,
				i,
				`Sequenz ${i + 1}/${sequences.length} · H1 propose`,
				{ input: h1Resp.inputTokens, output: h1Resp.outputTokens, cacheRead: h1Resp.cacheReadTokens }
			);
			const h1Proposed = parseJsonArray<H1Code>(h1Resp.text).filter((c) => c && c.code_label);
			if (h1Proposed.length === 0 && h1Resp.text.trim().length > 0) {
				console.warn(
					`[coding-run ${runId}] seq ${i + 1}/${sequences.length} H1 propose parsed 0 codes from ${h1Resp.text.length} chars. raw=${JSON.stringify(h1Resp.text.slice(0, 800))}`
				);
			}

			let h2Comprehension: string | null = null;
			let h2Verdicts: H2Verdict[] = [];
			let h1Reactions: H1Reaction[] = [];

			// ── 2. H2 re-reads independently (H1-agnostic) ─────────
			const h2ReadResp = await chatWithEmptyRetry({
				system: h2ReadSystem(),
				messages: [{ role: 'user', content: buildH2ReadMessage(sequence.seq, sequence.text, comprehensionLine) }],
				primary: h2Tier,
				fallback: h2Fallback,
				emptyMode: 'prose',
				runId,
				phaseLabel: `seq ${i + 1}/${sequences.length} H2 read`,
				documentIds: [run.document_id]
			});
			tokensInThisLoop += h2ReadResp.tokensUsed;
			await updateProgress(
				runId,
				i,
				`Sequenz ${i + 1}/${sequences.length} · H2 read`,
				{ input: h2ReadResp.inputTokens, output: h2ReadResp.outputTokens, cacheRead: h2ReadResp.cacheReadTokens }
			);
			h2Comprehension = h2ReadResp.text.trim();
			comprehensionLine.push(h2Comprehension);

			// ── 3. H2 confronts H1's codes ─────────────────────────
			if (h1Proposed.length > 0) {
				const h2ConfrontResp = await chatWithEmptyRetry({
					system: h2ConfrontSystem(),
					messages: [
						{ role: 'user', content: buildH2ConfrontMessage(sequence.seq, sequence.text, h2Comprehension, h1Proposed) }
					],
					primary: h2Tier,
					fallback: h2Fallback,
					emptyMode: 'json-array',
					runId,
					phaseLabel: `seq ${i + 1}/${sequences.length} H2 confront`,
					responseFormat: 'json',
					documentIds: [run.document_id]
				});
				tokensInThisLoop += h2ConfrontResp.tokensUsed;
				await updateProgress(
					runId,
					i,
					`Sequenz ${i + 1}/${sequences.length} · H2 confront`,
					{ input: h2ConfrontResp.inputTokens, output: h2ConfrontResp.outputTokens, cacheRead: h2ConfrontResp.cacheReadTokens }
				);
				h2Verdicts = parseJsonArray<H2Verdict>(h2ConfrontResp.text).filter((v) => v && v.code_label);
				if (h2Verdicts.length === 0 && h2ConfrontResp.text.trim().length > 0) {
					console.warn(
						`[coding-run ${runId}] seq ${i + 1}/${sequences.length} H2 confront parsed 0 verdicts from ${h2ConfrontResp.text.length} chars (h1 had ${h1Proposed.length} codes). raw=${JSON.stringify(h2ConfrontResp.text.slice(0, 800))}`
					);
				}
			}

			// ── 4. H1 reacts (one round, only if objected) ─────────
			const objected = h2Verdicts.filter((v) => v.verdict === 'revise' || v.verdict === 'drop');
			if (objected.length > 0) {
				const h1ReactResp = await chatWithEmptyRetry({
					system: h1ReactSystem(),
					messages: [{ role: 'user', content: buildH1ReactMessage(sequence.seq, sequence.text, h1Proposed, objected) }],
					primary: h1Tier,
					fallback: h1Fallback,
					emptyMode: 'json-array',
					runId,
					phaseLabel: `seq ${i + 1}/${sequences.length} H1 react`,
					responseFormat: 'json',
					documentIds: [run.document_id]
				});
				tokensInThisLoop += h1ReactResp.tokensUsed;
				await updateProgress(
					runId,
					i,
					`Sequenz ${i + 1}/${sequences.length} · H1 react`,
					{ input: h1ReactResp.inputTokens, output: h1ReactResp.outputTokens, cacheRead: h1ReactResp.cacheReadTokens }
				);
				h1Reactions = parseJsonArray<H1Reaction>(h1ReactResp.text).filter((r) => r && r.code_label);
				if (h1Reactions.length === 0 && h1ReactResp.text.trim().length > 0) {
					console.warn(
						`[coding-run ${runId}] seq ${i + 1}/${sequences.length} H1 react parsed 0 reactions from ${h1ReactResp.text.length} chars. raw=${JSON.stringify(h1ReactResp.text.slice(0, 800))}`
					);
				}
			}

			const survivors = resolveSurvivors(h1Proposed, h2Verdicts, h1Reactions);
			if (h1Proposed.length > 0 && survivors.length === 0) {
				console.warn(
					`[coding-run ${runId}] seq ${i + 1}/${sequences.length} 0 survivors out of ${h1Proposed.length} H1 codes after H2 confront (${h2Verdicts.length} verdicts) / H1 react (${h1Reactions.length} reactions). verdicts=${JSON.stringify(h2Verdicts)} reactions=${JSON.stringify(h1Reactions)}`
				);
			}

			// ── 5. Commit SNames (Sequence-Namings, TOC-Klasse) ────────
			// Die Überlebenden der H1↔H2-Konfrontation sind Sequenz-Namings
			// (SNames): thematische Bögen über die ganze Sequenz, die das
			// Dokument als „Inhaltsverzeichnis" erschließen. Anker = ganze
			// Sequenz-Spanne; landen NICHT auf der Situational Map, sondern
			// als TOC-Klasse links neben dem Dokument (Migration 032 +
			// design-mother-map-and-coding-flow.md). Die D/B-Operation
			// dahinter ist „Forming a phase" — Cues → Characterization auf
			// Absatz-Granularität. Strauss-Open-Coding (CNames) ist ein
			// SEPARATER zweiter Pass auf Inzident-Granularität, siehe unten.
			const committed: CommitResult[] = [];
			const commitErrors: string[] = [];
			for (const s of survivors) {
				if (!s.label || !s.label.trim()) continue;
				try {
					const res = await commitSequenceNaming({
						projectId: run.project_id,
						bearbeiterNamingId: bearbeiter,
						documentId: run.document_id,
						codeLabel: s.label.trim(),
						anchor: { pos0: sequence.charStart, pos1: sequence.charEnd, text: sequence.text },
						reasoning: s.reasoning,
						codeMemo: s.codeMemo,
						prov,
						sequenceMeta: { seq: sequence.seq, sentenceCount: sequence.sentenceCount }
					});
					committed.push(res);
					codesCommitted++;
					if (!seenLower.has(res.codeLabel.toLowerCase())) {
						seenLower.add(res.codeLabel.toLowerCase());
						codeLabels.push(res.codeLabel);
					}
				} catch (err) {
					commitErrors.push(`SName ${s.label}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			// ── 6. CName Pass: Forensische Aktanten-Pipeline ───────────
			// Pass 2 auf derselben Sequenz: A Abduktor → B Gatekeeper →
			// {C Anwalt → D Richter | bypass} → E Operativ. Die Pipeline
			// trägt die Hermeneutik in die STRUKTUR (Aktantenwechsel +
			// strukturell erzwungenes Nicht-Wissen pro Pass), nicht in
			// einen einzelnen Prompt. CName-Codes landen via
			// commitCodedPassage auf der primären Situational Map und
			// erscheinen unresolved in der Namings-Spalte rechts neben
			// dem Dokument. Modell-Tier: H2 — Reasoning-Klasse, dieselbe
			// Schärfe wie H2-Comprehension.
			const cnameCommitted: CommitResult[] = [];
			const prevSequenceText = i > 0 ? sequences[i - 1].text : null;
			const nextSequenceText =
				i + 1 < sequences.length ? sequences[i + 1].text : null;
			const forensicResult = await runCnameForensicForSequence({
				runId,
				projectId: run.project_id,
				documentId: run.document_id,
				bearbeiterNamingId: bearbeiter,
				sequence: {
					seq: sequence.seq,
					charStart: sequence.charStart,
					charEnd: sequence.charEnd,
					text: sequence.text
				},
				prevSequenceText,
				nextSequenceText,
				documentMemos,
				existingCNameLabels: cnameLabels,
				existingCNameLabelsLowerSet: cnameSeenLower,
				primary: h2Tier,
				fallback: h2Fallback,
				prov,
				onCall: async (call, phase) => {
					tokensInThisLoop += call.tokensUsed;
					await updateProgress(runId, i, `Sequenz ${i + 1}/${sequences.length} · ${phase}`, {
						input: call.inputTokens,
						output: call.outputTokens,
						cacheRead: call.cacheReadTokens
					});
				}
			});

			if (forensicResult.commitResult) {
				cnameCommitted.push(forensicResult.commitResult);
				codesCommitted++;
			}

			if (forensicResult.errors.length > 0) {
				console.warn(
					`[coding-run ${runId}] seq ${i + 1}/${sequences.length} CName forensic errors: ${forensicResult.errors.join(' | ')}`
				);
			}

			const cnameForensicFragment = {
				abduktion: forensicResult.abduktion
					? {
							prose: forensicResult.abduktion.prose,
							label: forensicResult.abduktion.commitForm.label,
							memo: forensicResult.abduktion.commitForm.memo,
							quote: forensicResult.abduktion.commitForm.quote
						}
					: null,
				triage: forensicResult.triage
					? {
							verdict: forensicResult.triage.verdict,
							prose: forensicResult.triage.prose
						}
					: null,
				judgment:
					forensicResult.judgment &&
					(forensicResult.judgment.kind === 'isomorph' ||
						forensicResult.judgment.kind === 'praezisiert' ||
						forensicResult.judgment.kind === 'unplausibel')
						? forensicResult.judgment.kind === 'unplausibel'
							? {
									verdict: 'unplausibel' as const,
									prose: forensicResult.judgment.prose
								}
							: {
									verdict: forensicResult.judgment.kind as 'isomorph' | 'praezisiert',
									prose: forensicResult.judgment.prose,
									correctedLabel: forensicResult.judgment.commitForm.label,
									correctedMemo: forensicResult.judgment.commitForm.memo
								}
						: null,
				outcome: forensicResult.outcome,
				noCodeReason: forensicResult.noCodeReason,
				llmCalls: forensicResult.calls.length,
				errors: forensicResult.errors
			};

			trace.push({
				seq: sequence.seq,
				charStart: sequence.charStart,
				charEnd: sequence.charEnd,
				sentenceCount: sequence.sentenceCount,
				text: sequence.text,
				h1Proposed,
				h2Comprehension,
				h2Verdicts,
				h1Reactions,
				committed,
				commitErrors,
				cnameForensic: cnameForensicFragment,
				cnameCommitted
			});

			// Sequenz fertig: sequence_status[i]='done' setzen. Damit ist die
			// Idempotenz-Grenze überschritten — ein Resume würde diese
			// Sequenz skippen. codesCommittedDelta = SName + CName.
			await updateProgress(
				runId,
				i + 1,
				`Sequenz ${i + 1}/${sequences.length} · committed`,
				{ input: 0, output: 0, cacheRead: 0 },
				{ [seqKey]: 'done' },
				committed.length + cnameCommitted.length
			);

			emit({
				type: 'sequence-done',
				index: i + 1,
				total: sequences.length,
				seq: sequence.seq,
				codesCommitted: committed.length + cnameCommitted.length,
				tokens: tokensInThisLoop - tokensAtStart,
				cumulativeTokens: tokensInThisLoop
			});
		} catch (err) {
			// Fataler Provider-Fehler (401/402/403/non-retryable 429) → Loop
			// abbrechen, markFailed. Sonstige Fehler werfen
			// nach oben, wo +server.ts den catch hat.
			if (isFatalProviderError(err)) {
				const msg = err instanceof Error ? err.message : String(err);
				await markFailed(runId, `Fatal provider error on sequence ${i + 1}: ${msg}`);
				throw err;
			}
			// AbortError vom Cancel-Watcher → Pause/Cancel-Status ist vom
			// Watcher schon gesetzt; sauber zurück, +server.ts schließt.
			if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
				return;
			}
			// Anderer Fehler → rethrow nach oben.
			throw err;
		}
	}

	// Alle Sequenzen erledigt.
	await markCompleted(runId);

	const result: CodingRunResult = {
		runId,
		documentId: run.document_id,
		documentTitle: title,
		h1Model,
		h2Model,
		segmentationMethod,
		sequencesProcessed: sequences.length,
		codesCommitted,
		tokensUsed: tokensInThisLoop,
		comprehensionLine,
		sequences: trace
	};

	// Debug-Artefakt — der volle Trace landet im ai_interactions-Log.
	try {
		await logAiInteraction(
			run.project_id,
			bearbeiter,
			'coding-run',
			`${h1Model} + ${h2Model}`,
			{ documentId: run.document_id, sequencesProcessed: sequences.length },
			result as unknown as Record<string, unknown>,
			tokensInThisLoop,
			h1Tier.provider
		);
	} catch {
		// Logging ist best-effort.
	}

	emit({ type: 'completed', result });
}
