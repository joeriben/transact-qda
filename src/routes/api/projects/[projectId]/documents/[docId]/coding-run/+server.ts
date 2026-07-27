// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coding-Run-Endpoint — Per-Dokument-Lauf der H1↔H2-Konfrontation mit Live-
// Status via Server-Sent Events. Übernommen aus der älteren Pipeline-Route
// (mid-call Cancel via ALS-AbortSignal, Cancel-Watcher 500ms, Stuck-Watchdog
// 30s/10min, Heartbeat 10s, run-init/paused/cancelled/completed/failed-
// Framing), angepasst auf (projectId, docId).
//
//   POST   — startet einen neuen Run oder resumed den aktiven (paused/running);
//            antwortet mit text/event-stream bis 'completed', 'paused',
//            'cancelled' oder 'failed'. Body wird ignoriert (keine Optionen) —
//            der Run läuft über das ganze Dokument, eine fixe Coding-Strategie.
//   GET    — gibt den aktiven (oder jüngsten) Run für (projectId, docId)
//            zurück; für Reload/Polling.
//   DELETE — setzt das Cancel-Signal mit Intent (?mode=pause|cancel,
//            Default 'pause'). Der Cancel-Watcher pollt cancel_requested
//            alle 500ms und finalisiert den Run-Status autoritativ (markiert
//            cancelled/paused, schließt den Stream, feuert runAbort.abort()
//            → in-flight LLM-fetch reißt ab).
//
// Pause vs. Cancel (vgl. Migration 027):
//   - mode=pause → status='paused'; belegt den Doc-Slot (partial-unique-index
//     mit WHERE status IN ('running','paused')), erneutes POST resumed denselben Run.
//   - mode=cancel → status='cancelled'; gibt den Slot frei (cancelled ist im
//     Index ausgeschlossen). Bereits Erledigtes ist via sequence_status +
//     commitCodedPassage-Idempotenz vor Doppel-Schreiben geschützt — ein neuer
//     Run nach cancel startet sauber, der cancelled-Eintrag bleibt in der Historie.
//
// SSE-Events (Wire-Format: data: <json>\n\n; siehe CodingRunEvent):
//   { type: 'run-init', runId }
//   { type: 'segmented', total, method }
//   { type: 'sequence-start', index, total, seq }
//   { type: 'sequence-done',  index, total, seq, codesCommitted, tokens, cumulativeTokens }
//   { type: 'paused', runId }
//   { type: 'cancelled', runId }
//   { type: 'completed', result }
//   { type: 'failed', message }
//   { type: 'alive', at }  — Heartbeat alle ~10s, damit die UI „Server lebt"
//                            von „Step-Index seit langem still" unterscheiden kann.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import {
	startOrResumeRun,
	runCodingRunLoop,
	requestCancel,
	getActiveRun,
	getLatestRun,
	markPausedOrCancelled
} from '$lib/server/ai/coding-run/orchestrator.js';
import type { CodingRunEvent } from '$lib/server/ai/coding-run/index.js';
import { withRun, endRun, getActivity } from '$lib/server/ai/coding-run/activity-tracker.js';

/**
 * Zugriffs-Check: Dokument existiert im Projekt UND der User ist Mitglied
 * des Projekts. Wirft 404 bei fehlendem Dokument, 403 bei fehlender
 * Mitgliedschaft.
 */
async function ensureDocAccess(projectId: string, docId: string, userId: string): Promise<void> {
	const doc = await queryOne<{ id: string }>(
		`SELECT id FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[docId, projectId]
	);
	if (!doc) error(404, 'Document not found in this project');
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!member) error(403, 'Not a member of this project');
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId and docId required');

	const userId = locals.user.id;
	await ensureDocAccess(projectId, docId, userId);

	const { run, resumed } = await startOrResumeRun(projectId, docId, userId);

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			const send = (e: CodingRunEvent) => {
				if (closed) return;
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
			};
			const close = () => {
				if (closed) return;
				closed = true;
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};

			// Auf Client-Disconnect: Cancel anfordern, damit der Loop sauber
			// abwickelt (Default-Intent 'pause' — Resume bleibt möglich).
			request.signal.addEventListener('abort', () => {
				closed = true;
				requestCancel(run.id).catch(() => {});
			});

			send({ type: 'run-init', runId: run.id });
			// Wenn wir einen pausierten/laufenden Run wieder aufgenommen haben,
			// zeigt die UI den aktuellen Stand mit `resumed` an. Das ist hier
			// implizit über run.current_index/sequence_status sichtbar; ein
			// eigenes Flag lassen wir weg, weil unsere Event-Form schlanker
			// ist und der initiale Loop-Tick ohnehin `segmented` mit
			// totalSequences emittiert.
			void resumed;

			// Heartbeat: alle 10s ein 'alive'-Event. Wenn ein einzelner LLM-Call
			// minutenlang dauert, sieht die UI trotzdem, dass der Server lebt.
			const HEARTBEAT_MS = 10_000;
			const aliveInterval = setInterval(() => {
				send({ type: 'alive', at: new Date().toISOString() });
			}, HEARTBEAT_MS);

			// Cancel-Watcher: autoritativ. Pollt cancel_requested alle 500ms;
			// sobald gesetzt:
			//   1) markiert den Run direkt (cancelled/paused je nach cancel_intent)
			//      — wartet NICHT, dass der Loop das Flag liest, weil ein
			//      in-flight LLM-Call das ggf. minutenlang hinauszögern würde
			//   2) sendet das finale SSE-Event ans Client
			//   3) schließt den Stream
			//   4) feuert runAbort.abort() — Signal propagiert via ALS in
			//      getRunAbortSignal() → AbortSignal.any() → SDK; in-flight
			//      fetch wirft AbortError, Loop-Catch sieht 'AbortError' und
			//      gibt sauber zurück (markFailed ist status-guarded und
			//      überschreibt 'cancelled'/'paused' nicht).
			const runAbort = new AbortController();
			const CANCEL_POLL_MS = 500;
			let cancelHandled = false;
			const cancelWatcher = setInterval(async () => {
				if (cancelHandled) return;
				try {
					const r = await queryOne<{ cancel_requested: boolean; cancel_intent: string | null }>(
						'SELECT cancel_requested, cancel_intent FROM coding_runs WHERE id = $1',
						[run.id]
					);
					if (!r?.cancel_requested) return;

					cancelHandled = true;
					clearInterval(cancelWatcher);

					await markPausedOrCancelled(run.id);
					send({
						type: r.cancel_intent === 'cancel' ? 'cancelled' : 'paused',
						runId: run.id
					});
					close();
					runAbort.abort(new Error('cancel_requested'));
				} catch {
					// Transient DB-Fehler — nächster Tick versucht es erneut.
				}
			}, CANCEL_POLL_MS);

			// Stuck-Run-Watchdog: System-Failsafe gegen Hänger, die weder den
			// per-Call-Timeout (wall-clock + AbortSignal in chat()) noch das
			// Cancel-Signal greifen. Schwelle 10min last_event_at-Staleness,
			// Poll 30s — Reaktion innerhalb ~30s nach Überschreitung.
			// Verbirgt KEINE Fehler, sondern zeigt sie als failed-Run an.
			const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
			const STUCK_POLL_MS = 30_000;
			let stuckHandled = false;
			const stuckWatcher = setInterval(async () => {
				if (stuckHandled || cancelHandled) return;
				try {
					const r = await queryOne<{
						status: string;
						last_event_at: string;
						last_step_label: string | null;
					}>(
						`SELECT status, last_event_at, last_step_label
						 FROM coding_runs WHERE id = $1`,
						[run.id]
					);
					if (!r || r.status !== 'running') return;
					const staleMs = Date.now() - new Date(r.last_event_at).getTime();
					if (staleMs < STUCK_THRESHOLD_MS) return;

					stuckHandled = true;
					clearInterval(stuckWatcher);

					const stuckMinutes = Math.round(staleMs / 60_000);
					const label = r.last_step_label ?? '(no current step)';
					const msg = `Stuck-Run-Watchdog: kein Fortschritt seit ${stuckMinutes} min am Schritt „${label}". Run wurde automatisch abgebrochen.`;
					console.warn(`[coding-run/${run.id}] ${msg}`);

					// Status-Guard: nur überschreiben, wenn noch 'running' — der
					// Cancel-Watcher könnte parallel cancelled/paused gesetzt haben.
					await query(
						`UPDATE coding_runs
						 SET status = 'failed',
						     completed_at = now(),
						     last_event_at = now(),
						     error_message = $2
						 WHERE id = $1 AND status = 'running'`,
						[run.id, msg.slice(0, 500)]
					);
					send({ type: 'failed', message: msg });
					close();
					runAbort.abort(new Error('stuck_watchdog'));
				} catch {
					// Transient DB-Fehler — nächster Tick versucht es erneut.
				}
			}, STUCK_POLL_MS);

			try {
				// withRun öffnet AsyncLocalStorage mit { runId, signal } — `chat()`
				// liest das Signal via getRunAbortSignal() und kombiniert es per
				// AbortSignal.any() mit timeoutSignal + opts.signal. Damit reißt
				// der in-flight fetch mid-Call ab, sobald runAbort feuert.
				await withRun(run.id, runAbort.signal, () => runCodingRunLoop(run.id, send));
			} catch (err) {
				// Cancel-Path: AbortError vom Watcher → der Watcher hat schon
				// gefeuert (cancelled/paused-Event und close()), wir tun nichts.
				if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
					// no-op
				} else {
					const message = err instanceof Error ? err.message : String(err);
					send({ type: 'failed', message });
				}
			} finally {
				clearInterval(cancelWatcher);
				clearInterval(stuckWatcher);
				if (!runAbort.signal.aborted) runAbort.abort(new Error('run_ended'));
				endRun(run.id);
				clearInterval(aliveInterval);
				close();
			}
		},
		cancel() {
			// ReadableStream.cancel: Client hat den Stream geschlossen, bevor
			// das request.signal-Abort durchschlug. Defensiv Cancel anfordern.
			requestCancel(run.id).catch(() => {});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store, no-transform',
			'X-Accel-Buffering': 'no',
			Connection: 'keep-alive'
		}
	});
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId and docId required');
	await ensureDocAccess(projectId, docId, locals.user.id);

	const active = await getActiveRun(projectId, docId);
	const latest = active ?? (await getLatestRun(projectId, docId));
	// Activity ist Live-State des laufenden Prozesses (was tut der Server
	// gerade konkret?). Existiert nur, solange ein Run im aktuellen Node-
	// Prozess aktiv ist — nach Server-Restart leer, der Loop muss erst neu
	// starten/resumen, bevor wieder etwas erscheint.
	const activity = active ? getActivity(active.id) : null;
	return json({ run: latest, activity });
};

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId and docId required');
	await ensureDocAccess(projectId, docId, locals.user.id);

	const modeParam = url.searchParams.get('mode');
	const intent: 'pause' | 'cancel' = modeParam === 'cancel' ? 'cancel' : 'pause';

	const active = await getActiveRun(projectId, docId);
	if (!active) {
		return json({ ok: true, paused: false, message: 'No active run' });
	}
	await requestCancel(active.id, intent);
	return json({
		ok: true,
		paused: intent === 'pause',
		cancelled: intent === 'cancel',
		runId: active.id
	});
};
