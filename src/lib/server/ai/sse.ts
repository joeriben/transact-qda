// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Server-Sent Events for map-level AI notifications.
// In-memory EventEmitter per map (single-server architecture).
// Clients subscribe via GET /api/projects/[projectId]/maps/[mapId]/events

type MapEventData = {
	type: string;
	payload: unknown;
};

type Listener = (data: MapEventData) => void;

const mapListeners = new Map<string, Set<Listener>>();

export function subscribe(mapId: string, listener: Listener): () => void {
	if (!mapListeners.has(mapId)) {
		mapListeners.set(mapId, new Set());
	}
	mapListeners.get(mapId)!.add(listener);

	return () => {
		const listeners = mapListeners.get(mapId);
		if (listeners) {
			listeners.delete(listener);
			if (listeners.size === 0) mapListeners.delete(mapId);
		}
	};
}

export function emit(mapId: string, type: string, payload: unknown) {
	const listeners = mapListeners.get(mapId);
	if (!listeners) return;
	for (const listener of listeners) {
		listener({ type, payload });
	}
}

// ── Ein KI-Lauf als Antwort-Stream ───────────────────────────────
//
// Coach und Cowork laufen mehrere Modellaufrufe lang, mit hoher Reasoning-
// Stärke oft Minuten. Die Antwort kommt deshalb als text/event-stream auf
// denselben POST (Muster: comparative-run): `step` je Werkzeugaufruf, `alive`
// alle 10 s — das hält die Verbindung über Lesefristen eines Proxys hinweg
// offen —, am Ende genau ein `done` oder `failed`. Bricht der Client ab,
// reißen die laufenden Modellaufrufe mit ab.

export type AiRunEvent = { kind: string } & Record<string, unknown>;

export function streamAiRun(
	run: (ctx: { signal: AbortSignal; send: (event: AiRunEvent) => void }) => Promise<Record<string, unknown>>
): Response {
	const ac = new AbortController();
	const utf8 = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			const send = (event: AiRunEvent) => {
				if (closed) return;
				try {
					controller.enqueue(utf8.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					closed = true;
				}
			};
			const alive = setInterval(() => send({ kind: 'alive' }), 10_000);
			try {
				send({ kind: 'start' });
				const result = await run({ signal: ac.signal, send });
				send({ kind: 'done', ...result });
			} catch (err) {
				if (!ac.signal.aborted) {
					send({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
				}
			} finally {
				clearInterval(alive);
				closed = true;
				try {
					controller.close();
				} catch {
					/* already closed */
				}
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
}
