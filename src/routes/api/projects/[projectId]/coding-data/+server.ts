// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Projekt-weiter Cleanup: löscht *alle* Coding-Run-Outputs in *allen*
// Dokumenten des Projekts. Iteriert über `deleteAllRunsForDocument` —
// idempotent, Documents und hand-typed Codes bleiben unangetastet.
//
// Safety-Lock: `?confirm=projectId` muss mit dem Pfad-Parameter
// übereinstimmen, damit ein DELETE nicht versehentlich auftritt.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { deleteAllRunsForProject } from '$lib/server/db/queries/codes.js';

async function ensureProjectAccess(projectId: string, userId: string): Promise<void> {
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!member) error(403, 'Not a member of this project');
	// Owner/Admin-Check könnte hier ergänzt werden, falls Cleanup auf Rollen beschränkt sein soll.
}

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId } = params;
	if (!projectId) error(400, 'projectId required');

	const confirm = url.searchParams.get('confirm');
	if (confirm !== projectId) {
		error(400, 'Safety-Lock: ?confirm=<projectId> erforderlich, damit dieser projektweite Wipe nicht versehentlich passiert.');
	}

	await ensureProjectAccess(projectId, locals.user.id);

	const result = await deleteAllRunsForProject(projectId);
	return json({ ok: true, scope: 'project', projectId, ...result });
};
