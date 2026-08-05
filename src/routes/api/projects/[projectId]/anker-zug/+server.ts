// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Anker-Zug — ein Strukturmuster des Forschers an einem Dokument prüfen.
//
//   GET  ?namingId=&documentId=
//        Legt vor, was vor einem Lauf auf dem Tisch liegen muss: die Sichtung
//        des Dokuments, die Belegstelle mit Anlauf, und das aus Naming, Memo
//        und Belegstelle abgeleitete KRITERIUM. Ein Modellaufruf. Der Lauf
//        beginnt nicht — das Kriterium geht erst an den Forscher zurück.
//
//   POST { namingId, documentId, kriterium, belegstelleMitpruefen? }
//        Geht das Dokument mit dem freigegebenen Kriterium durch. Antwortet als
//        text/event-stream, weil ein Durchgang über ein großes Dokument Minuten
//        läuft und der erste Fund schon etwas wert ist.
//
// Fire-and-forget wie comparative-run: keine Tabelle, kein Pause/Resume, kein
// Watchdog. Einzige Abbruchquelle ist der Client-Disconnect; dessen Signal geht
// in jeden Modellaufruf, sodass laufende Anfragen mitten im Call abreißen.
//
// SSE-Ereignisse (data: <json>\n\n):
//   { kind: 'init',     zuegeGesamt, geprueft, geprueftJePosition, gestalt }
//   { kind: 'stelle',   stelle }            — sofort bei jedem Fund
//   { kind: 'progress', done, total }
//   { kind: 'done',     runId, stellen, unlesbar, nichtBelegt, geprueft, geprueftJePosition }
//   { kind: 'failed',   message }
//   { kind: 'alive',    at }                — Heartbeat ~10 s
//
// Diese Route SCHREIBT NICHT in den Datenraum. Was sie zurückgibt, sind
// Hinweise; ob daraus ein Anker wird, entscheidet ein Akt des Forschers über
// die Annotations-Route.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { namingInProject } from '$lib/server/auth/authz.js';
import {
	vorbereiten,
	durchgehen,
	belegstelleOf,
	ladeMuster,
	ladeVolltext,
	sichten,
	zuegeOf,
	verbucheLauf,
	type Kriterium,
	type Stelle
} from '$lib/server/ai/anchor-expansion/index.js';

/** Body-/Query-UUIDs gegen DIESES Projekt scopen — sonst beweist die Mitgliedschaft nichts. */
async function scope(projectId: string, ...ids: (string | undefined)[]): Promise<void> {
	for (const id of ids) {
		if (!id) error(400, 'namingId und documentId erforderlich');
		if (!(await namingInProject(id, projectId))) error(404, 'Nicht in diesem Projekt');
	}
}

/**
 * Prüft, was aus dem Netz kommt, bevor es in einen Prompt geht. Ein Kriterium
 * mit erfundenen Feldern würde sonst als Systemtext beim Modell landen.
 */
function parseKriterium(raw: unknown): Kriterium | null {
	if (!raw || typeof raw !== 'object') return null;
	const k = raw as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const akteur = str(k.akteur);
	const adressat = str(k.adressat);
	const bestandteile = Array.isArray(k.bestandteile)
		? k.bestandteile
				.map((b) => ({ name: str((b as any)?.name), kenntlich: str((b as any)?.kenntlich) }))
				.filter((b) => b.name.length > 0)
		: [];
	const relationen = Array.isArray(k.relationen)
		? k.relationen
				.map((r) => ({
					name: str((r as any)?.name),
					bedingung: str((r as any)?.bedingung),
					ertrag: str((r as any)?.ertrag)
				}))
				.filter((r) => r.name.length > 0)
		: [];
	if (!akteur || bestandteile.length === 0 || relationen.length === 0) return null;
	return { akteur, adressat, bestandteile, relationen };
}

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId erforderlich');

	const namingId = url.searchParams.get('namingId') ?? undefined;
	const documentId = url.searchParams.get('documentId') ?? undefined;
	await scope(projectId, namingId, documentId);

	// Ohne Belegstelle in diesem Dokument gibt es kein Muster zu prüfen. Das ist
	// kein Fehler, sondern die Auskunft, die der Forscher braucht: Er muss erst
	// eine Stelle markieren.
	const muster = await ladeMuster(projectId, namingId!);
	const fullText = await ladeVolltext(projectId, documentId!);
	const gestalt = sichten(fullText);
	const zuege = zuegeOf(fullText, gestalt);
	if (!belegstelleOf(zuege, muster.anchors, documentId!, fullText)) {
		return json({
			gestalt,
			zuegeGesamt: zuege.length,
			belegstelle: null,
			belegZuege: [],
			inscription: muster.inscription,
			memos: muster.memos,
			kriterium: null
		});
	}

	try {
		return json(await vorbereiten(projectId, namingId!, documentId!));
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'Das Kriterium kam nicht auswertbar zurück');
	}
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId erforderlich');

	const body = (await request.json().catch(() => null)) as {
		namingId?: string;
		documentId?: string;
		kriterium?: unknown;
		belegstelleMitpruefen?: unknown;
	} | null;

	const namingId = body?.namingId;
	const documentId = body?.documentId;
	await scope(projectId, namingId, documentId);

	const kriterium = parseKriterium(body?.kriterium);
	if (!kriterium) {
		error(400, 'kriterium erforderlich — Akteur, mindestens ein Bestandteil, mindestens eine Relation');
	}
	const belegstelleMitpruefen = body?.belegstelleMitpruefen === true;

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
					/* Strom bereits abgebaut */
				}
			};
			const close = () => {
				if (closed) return;
				closed = true;
				try {
					controller.close();
				} catch {
					/* bereits geschlossen */
				}
			};
			request.signal.addEventListener('abort', () => {
				closed = true;
			});

			const alive = setInterval(() => send({ kind: 'alive', at: new Date().toISOString() }), 10_000);

			try {
				const stellen: Stelle[] = [];
				const result = await durchgehen(projectId, namingId!, documentId!, kriterium, {
					signal: ac.signal,
					belegstelleMitpruefen,
					onProgress: (done, total) => send({ kind: 'progress', done, total }),
					onStelle: (s) => {
						stellen.push(s);
						send({ kind: 'stelle', stelle: s });
					}
				});
				send({
					kind: 'done',
					stellen: result.stellen,
					unlesbar: result.unlesbar.length,
					nichtBelegt: result.nichtBelegt.length,
					geprueft: result.geprueft,
					geprueftJePosition: result.geprueftJePosition
				});
			} catch (err) {
				if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
					/* Client weg — nichts zu melden */
				} else {
					send({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
				}
			} finally {
				clearInterval(alive);
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
