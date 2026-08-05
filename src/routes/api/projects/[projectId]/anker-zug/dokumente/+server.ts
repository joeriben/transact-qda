// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Welche Dokumente gibt es zu diesem Naming, und was ist dort schon gelaufen?
//
//   GET ?namingId=[&kriteriumHash=]
//
// Je Dokument: Zeichen, ZÜGE (der Kostentreiber, deterministisch gerechnet),
// eigene Marken, der jüngste Lauf und ob er mit dem Kriterium lief, das jetzt
// gilt. Ohne Modellaufruf und ohne Kosten — die Auswahl soll VOR der Ausgabe
// stehen, nicht danach.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { namingInProject } from '$lib/server/auth/authz.js';
import { dokumentStand, ladeLauf } from '$lib/server/ai/anchor-expansion/index.js';
import type { Kriterium } from '$lib/server/ai/anchor-expansion/index.js';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId erforderlich');

	const namingId = url.searchParams.get('namingId');
	if (!namingId) error(400, 'namingId erforderlich');
	if (!(await namingInProject(namingId, projectId))) error(404, 'Nicht in diesem Projekt');

	// Das Kriterium darf mitkommen, damit „schon gelaufen" sich auf DAS bezieht,
	// womit jetzt gelaufen würde. Kommt keines, heißt jeder Lauf „nicht aktuell";
	// das ist die ehrliche Antwort und keine Vermutung.
	let kriterium: Kriterium | null = null;
	const roh = url.searchParams.get('kriterium');
	if (roh) {
		try {
			kriterium = JSON.parse(roh) as Kriterium;
		} catch {
			error(400, 'kriterium ist kein gültiges JSON');
		}
	}

	return json({ dokumente: await dokumentStand(projectId, namingId, kriterium) });
};

/** Ein verbuchtes Ergebnis wieder öffnen — ohne einen einzigen Aufruf. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId erforderlich');

	const body = (await request.json().catch(() => null)) as { runId?: string } | null;
	if (!body?.runId) error(400, 'runId erforderlich');

	const lauf = await ladeLauf(projectId, body.runId);
	if (!lauf) error(404, 'Kein solcher Lauf in diesem Projekt');
	return json(lauf);
};
