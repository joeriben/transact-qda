// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Anker-Zug — ein Strukturmuster des Forschers an einem Dokument prüfen.
//
//   GET  ?namingId=&documentId=[&neu=1]
//        Legt vor, was vor einem Lauf auf dem Tisch liegen muss: die Sichtung
//        des Dokuments, die Belegstelle mit Anlauf, und das KRITERIUM. Liegt
//        eines abgelegt vor, kommt DAS zurück — ohne Aufruf und ohne dass die
//        Korrektur des Forschers durch eine zweite Ableitung ersetzt wird.
//        `neu=1` verwirft das abgelegte und leitet neu ab (ein Aufruf). Der
//        Lauf beginnt nicht — das Kriterium geht erst an den Forscher zurück.
//
//   PUT  { namingId, kriterium }
//        Das Kriterium festhalten, ohne zu laufen. Eine Korrektur gilt damit ab
//        dem Tippen und nicht erst ab dem nächsten Durchgang.
//
//   POST { namingId, documentId, kriterium, ohneProbe? }
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
//   { kind: 'done',     runId, stellen, unlesbar, nichtBelegt, geprueft, geprueftJePosition, probe }
//   { kind: 'failed',   message[, abbruch, status] }  — abbruch: kein Modellzugang
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
	speichereKriterium,
	LaufAbbruch,
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
			kriterium: null,
			kriteriumVonHand: false,
			kriteriumAbgelegtSeit: null
		});
	}

	try {
		// `neu=1` verwirft das abgelegte Kriterium und leitet neu ab — ausdrücklich,
		// damit eine Korrektur nicht nebenbei verlorengeht.
		return json(
			await vorbereiten(projectId, namingId!, documentId!, {
				neu: url.searchParams.get('neu') === '1',
				userId: locals.user?.id ?? null
			})
		);
	} catch (err) {
		// Kein Zugang zum Modell ist etwas anderes als eine unbrauchbare Antwort.
		if (err instanceof LaufAbbruch) {
			error(503, `Kein Zugang zum Modell (${err.kennung}): ${err.message}`);
		}
		error(502, err instanceof Error ? err.message : 'Das Kriterium kam nicht auswertbar zurück');
	}
};

/**
 * Das Kriterium festhalten, ohne zu laufen.
 *
 * Ohne das galt eine Änderung erst, wenn ein Durchgang startete: Wer das
 * Kriterium korrigierte und das Panel schloss, fand beim nächsten Öffnen die
 * alte Fassung — während im Panel stand, es bleibe stehen. Ein Kriterium ist
 * eine Einstellung, und eine Einstellung sichert sich selbst.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId erforderlich');

	const body = (await request.json().catch(() => null)) as {
		namingId?: string;
		kriterium?: unknown;
	} | null;
	const namingId = body?.namingId;
	if (!namingId) error(400, 'namingId erforderlich');
	if (!(await namingInProject(namingId, projectId))) error(404, 'Nicht in diesem Projekt');

	const kriterium = parseKriterium(body?.kriterium);
	if (!kriterium) {
		error(400, 'kriterium erforderlich — Akteur, mindestens ein Bestandteil, mindestens eine Relation');
	}

	const updatedAt = await speichereKriterium(projectId, namingId, kriterium, {
		vonHand: true,
		userId: locals.user?.id ?? null
	});
	return json({ ok: true, updatedAt });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId erforderlich');

	const body = (await request.json().catch(() => null)) as {
		namingId?: string;
		documentId?: string;
		kriterium?: unknown;
		ohneProbe?: unknown;
	} | null;

	const namingId = body?.namingId;
	const documentId = body?.documentId;
	await scope(projectId, namingId, documentId);

	const kriterium = parseKriterium(body?.kriterium);
	if (!kriterium) {
		error(400, 'kriterium erforderlich — Akteur, mindestens ein Bestandteil, mindestens eine Relation');
	}
	const ohneProbe = body?.ohneProbe === true;

	// Womit gelaufen wird, gilt ab jetzt. Es kam aus dem Panel, also aus der Hand
	// des Forschers — auch wenn er nichts geändert hat, hat er es stehen lassen.
	await speichereKriterium(projectId, namingId!, kriterium, {
		vonHand: true,
		userId: locals.user?.id ?? null
	});

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

			const t0 = Date.now();
			try {
				const stellen: Stelle[] = [];
				const result = await durchgehen(projectId, namingId!, documentId!, kriterium, {
					signal: ac.signal,
					ohneProbe,
					onProgress: (done, total) => send({ kind: 'progress', done, total }),
					onStelle: (s) => {
						stellen.push(s);
						send({ kind: 'stelle', stelle: s });
					}
				});
				// Verbuchen, bevor gemeldet wird: Wer das Ergebnis sieht, soll es
				// wiederfinden können, ohne den Durchgang ein zweites Mal zu bezahlen.
				const runId = await verbucheLauf({
					projectId,
					namingId: namingId!,
					documentId: documentId!,
					kriterium,
					provider: result.modell.provider,
					model: result.modell.model,
					zuegeGesamt: result.zuegeGesamt,
					geprueft: result.geprueft,
					stellen: result.stellen,
					unlesbar: result.unlesbar.length,
					nichtBelegt: result.nichtBelegt.length,
					verbrauch: result.verbrauch,
					sekunden: Math.round((Date.now() - t0) / 1000),
					userId: locals.user?.id ?? null
				});
				send({
					kind: 'done',
					runId,
					probe: result.probe,
					stellen: result.stellen,
					unlesbar: result.unlesbar.length,
					nichtBelegt: result.nichtBelegt.length,
					geprueft: result.geprueft,
					geprueftJePosition: result.geprueftJePosition
				});
			} catch (err) {
				if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
					/* Client weg — nichts zu melden */
				} else if (err instanceof LaufAbbruch) {
					// Kein Zugang zum Modell. Das ist ein Ausfall und kein Befund über
					// dieses Dokument — es wird als Ausfall verbucht und als Ausfall
					// gemeldet, damit „nichts gefunden" nicht danebensteht.
					await verbucheLauf({
						projectId,
						namingId: namingId!,
						documentId: documentId!,
						kriterium,
						provider: 'unbekannt',
						model: 'unbekannt',
						zuegeGesamt: 0,
						geprueft: 0,
						stellen: [],
						unlesbar: 0,
						nichtBelegt: 0,
						verbrauch: { aufrufe: 0, eingabe: 0, ausgabe: 0, cacheGeschrieben: 0, cacheGelesen: 0 },
						sekunden: Math.round((Date.now() - t0) / 1000),
						abgebrochen: true,
						fehler: `Ausfall ${err.kennung}: ${err.message}`.slice(0, 300),
						userId: locals.user?.id ?? null
					}).catch(() => undefined);
					send({ kind: 'failed', abbruch: true, status: err.status, message: err.message });
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
