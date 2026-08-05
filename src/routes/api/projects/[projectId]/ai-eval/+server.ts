// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI-Evaluation, projektweit — das letzte Urteil je beurteiltem Naming.
//
// Teil der SEPARABLEN AI-Evaluation-Auditschicht (siehe src/lib/server/ai-eval).
// Die Karte zeigt Namings ohne Dokumentkontext; sie braucht deshalb nicht die
// Passagen-Historie eines Dokuments, sondern nur den Rand: welches Naming zuletzt
// verworfen wurde. Entfernen der KI-Schicht = diesen Ordner löschen; kein
// Kern-Endpunkt ändert sich.
//
// Projekt-Mitgliedschaft wird zweifach geprüft: zentral in hooks.server.ts und
// hier noch einmal (defense in depth).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { getLatestVerdictsForProject } from '$lib/server/ai-eval/index.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId required');

	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, locals.user.id]
	);
	if (!member) error(403, 'Not a member of this project');

	const latest = await getLatestVerdictsForProject(projectId);
	return json({
		latest,
		rejected: latest.filter((v) => v.verdict === 'reject').map((v) => v.subjectNamingId)
	});
};
