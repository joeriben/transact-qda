// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sichtung eines Dokuments — wie der Text gebaut ist, bevor irgendetwas
// gelesen wird. Deterministisch, ohne Modell, ohne Kosten.
//
//   GET  → { gestalt, zuegeGesamt }
//
// Die Projekt-Mitgliedschaft prüft hooks.server.ts für jede
// /api/projects/<uuid>/*-Route zentral; die Dokument-UUID wird hier gegen das
// Projekt gescopt, indem der Volltext nur mit passender project_id geladen wird.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { ladeVolltext, sichten, zuegeOf } from '$lib/server/ai/anchor-expansion/index.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId und docId erforderlich');

	let fullText: string;
	try {
		fullText = await ladeVolltext(projectId, docId);
	} catch {
		error(404, 'Dokument ohne Volltext in diesem Projekt');
	}

	const gestalt = sichten(fullText);
	return json({ gestalt, zuegeGesamt: zuegeOf(fullText, gestalt).length });
};
