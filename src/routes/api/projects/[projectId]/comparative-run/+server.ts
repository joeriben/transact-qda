// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Comparative-Run-Endpoint (CName) — projektweiter Lauf der GTM-Konstantvergleich-
// Engine über mehrere Fall-Dokumente, mit Live-Status via Server-Sent Events.
// Bewusst SCHLANK gegenüber der coding-run-Route: ein Comparative-Run ist
// fire-and-forget (eine endliche Folge LLM-Calls, kein Pause/Resume) — es gibt
// daher KEINE comparative_runs-Tabelle, keinen Cancel-Watcher, keinen Stuck-
// Watchdog. Die einzige Abbruchquelle ist der Client-Disconnect; dessen
// request.signal wird direkt in jeden LLM-Call der Engine durchgereicht, sodass
// in-flight fetches mid-Call abreißen.
//
//   GET   — listet die text-tragenden Dokumente des Projekts als wählbare Fälle
//           (UI füllt damit das Fall-Multiselect; Reihenfolge = caseDocIds[0]
//           wird zum Anker-Fall).
//   POST  — startet einen Lauf für { concept:{name,gloss}, caseDocIds[], persist? }
//           und antwortet mit text/event-stream bis 'completed' oder 'failed'.
//
// SSE-Events (Wire-Format: data: <json>\n\n):
//   { kind: 'run-init', concept, cases, persist }
//   …Engine-Events (ComparativeEvent): retrieve | verify | silence | seed |
//     pair | saturate | persist | done
//   { kind: 'completed', result }   — ComparativeResult
//   { kind: 'failed', message }
//   { kind: 'alive', at }           — Heartbeat ~10s

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import {
	runComparativeDimensionalization,
	listCaseDocuments,
	type ConceptSeed,
	type CaseRef
} from '$lib/server/ai/comparative/engine.js';

/** Zugriffs-Check: User ist Mitglied des Projekts. Wirft 403 sonst. */
async function ensureProjectMember(projectId: string, userId: string): Promise<void> {
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!member) error(403, 'Not a member of this project');
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId required');
	await ensureProjectMember(projectId, locals.user.id);

	const cases = await listCaseDocuments(projectId);
	return json({ cases });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId required');
	await ensureProjectMember(projectId, locals.user.id);

	// ── parse + validate body (robust against malformed JSON / wrong types) ──
	const body = (await request.json().catch(() => null)) as {
		concept?: { name?: unknown; gloss?: unknown };
		caseDocIds?: unknown;
		persist?: unknown;
	} | null;

	const rawName = body?.concept?.name;
	const rawGloss = body?.concept?.gloss;
	const name = typeof rawName === 'string' ? rawName.trim() : '';
	const gloss = typeof rawGloss === 'string' ? rawGloss.trim() : '';
	if (!name || !gloss) error(400, 'concept { name, gloss } required (both non-empty strings)');

	const rawIds = body?.caseDocIds;
	const caseDocIds = Array.isArray(rawIds) ? rawIds.filter((x): x is string => typeof x === 'string') : [];
	if (caseDocIds.length < 2) error(400, 'at least 2 case documents required (caseDocIds[0] = anchor case)');

	const persist = body?.persist === true;
	const concept: ConceptSeed = { name, gloss };

	// Resolve ids → CaseRefs against THIS project. Rejects ids from other projects
	// and textless namings, and preserves the submitted order (index 0 = anchor).
	const known = new Map((await listCaseDocuments(projectId)).map((c) => [c.docId, c]));
	const cases: CaseRef[] = [];
	for (const id of caseDocIds) {
		const c = known.get(id);
		if (!c) error(400, `document ${id} is not a text-bearing document in this project`);
		cases.push(c);
	}

	// Single teardown source: client disconnect → abort → engine's in-flight fetch reißt ab.
	const ac = new AbortController();
	request.signal.addEventListener('abort', () => ac.abort());

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder();
			let closed = false;
			const send = (e: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
				} catch {
					/* stream already torn down */
				}
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

			request.signal.addEventListener('abort', () => {
				closed = true;
			});

			// Heartbeat: a single constant-comparison call can run 10-30s; let the UI
			// distinguish „Server lebt" from „Schritt seit langem still".
			const aliveInterval = setInterval(() => send({ kind: 'alive', at: new Date().toISOString() }), 10_000);

			try {
				send({ kind: 'run-init', concept: concept.name, cases: cases.map((c) => c.name), persist });
				const result = await runComparativeDimensionalization({
					projectId,
					concept,
					cases,
					persist,
					signal: ac.signal,
					emit: send
				});
				send({ kind: 'completed', result });
			} catch (err) {
				// Client gone mid-run → AbortError; nothing to report. Otherwise surface it.
				if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
					// no-op
				} else {
					send({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
				}
			} finally {
				clearInterval(aliveInterval);
				if (!ac.signal.aborted) ac.abort();
				close();
			}
		},
		cancel() {
			ac.abort();
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
