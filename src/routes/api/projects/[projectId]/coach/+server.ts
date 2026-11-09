// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Coach: Antwort als Stream (streamAiRun) — `step` je Nachschlagen, am Ende
// `done` mit der Antwort oder `failed` mit dem Grund.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runConversation } from '$lib/server/ai/runtime/index.js';
import { streamAiRun } from '$lib/server/ai/sse.js';
import { getMap } from '$lib/server/db/queries/maps.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Turn = { role: 'user' | 'assistant'; content: string };

function isTurn(t: unknown): t is Turn {
	const turn = t as Turn;
	return (
		!!turn &&
		(turn.role === 'user' || turn.role === 'assistant') &&
		typeof turn.content === 'string' &&
		turn.content.trim().length > 0
	);
}

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as {
		message?: unknown;
		history?: unknown;
		currentPage?: unknown;
		currentMapId?: unknown;
	} | null;

	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	if (!message) {
		return json({ error: 'message required' }, { status: 400 });
	}
	const history = Array.isArray(body?.history) ? body.history.filter(isTurn) : [];
	const currentPage = typeof body?.currentPage === 'string' ? body.currentPage : undefined;

	// Die Map aus dem Body gilt nur, wenn sie zu diesem Projekt gehört.
	const rawMapId = typeof body?.currentMapId === 'string' ? body.currentMapId : '';
	const mapId =
		UUID_RE.test(rawMapId) && (await getMap(rawMapId, params.projectId)) ? rawMapId : undefined;

	return streamAiRun(async ({ signal, send }) => {
		try {
			const result = await runConversation('coach', params.projectId, message, history, {
				currentPage,
				mapId,
				signal,
				onStep: (tool) => send({ kind: 'step', tool })
			});
			return { response: result.response };
		} catch (e) {
			console.error('Coach error:', e instanceof Error ? e.message : e);
			throw e;
		}
	});
};
