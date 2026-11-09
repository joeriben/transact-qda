// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Cowork auf Abruf: ein Lauf auf einer Map, Antwort als Stream (streamAiRun).
// `done` trägt, wie der Lauf ausging — geschriebene Memos und Cues, „nichts
// anzumerken" mit Grund oder Fehler mit Grund (CoworkOutcome). Früher kam
// der Aufruf über die Map-API mit einem bloßen { ok: true } zurück, und die
// Forscherin erfuhr nie, ob etwas entstanden war (Testbericht 09.11.2026,
// Befund 29).

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runMapAgent } from '$lib/server/ai/runtime/index.js';
import { streamAiRun } from '$lib/server/ai/sse.js';
import { getMap } from '$lib/server/db/queries/maps.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { mapId?: unknown } | null;
	const mapId = typeof body?.mapId === 'string' ? body.mapId : '';
	if (!UUID_RE.test(mapId)) {
		return json({ error: 'mapId required' }, { status: 400 });
	}

	// Die Map muss zu diesem Projekt gehören; Vorlagen-Maps nehmen keine Akte an.
	const map = await getMap(mapId, params.projectId);
	if (!map) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	if (map.properties?.readOnly) {
		return json({ error: 'This map is read-only (template). Copy the project to make changes.' }, { status: 403 });
	}

	return streamAiRun(async ({ signal, send }) => {
		const outcome = await runMapAgent(
			params.projectId,
			mapId,
			{ action: 'requestAnalysis', details: {} },
			{ signal, onStep: (tool) => send({ kind: 'step', tool }) }
		);
		return { outcome };
	});
};
