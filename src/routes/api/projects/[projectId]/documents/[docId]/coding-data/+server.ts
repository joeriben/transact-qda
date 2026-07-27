// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-Document-Cleanup: löscht *alle* Coding-Run-Outputs an einem Dokument
// (CName-Annotationen, SName-Annotationen, orphan gewordene Codes, sowie die
// `coding_runs`-Historie). Hand-typed Codes des Users bleiben unangetastet,
// das Dokument selbst auch — der Forscher kann direkt einen neuen Run
// starten, ohne neu hochladen zu müssen.
//
// Safety-Lock: `?confirm=docId` muss als URL-Param mitgegeben werden und mit
// dem Pfad-Parameter übereinstimmen. Damit ist ein versehentlicher
// DELETE ohne explizite Zustimmung ausgeschlossen.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { deleteAllRunsForDocument } from '$lib/server/db/queries/codes.js';

async function ensureDocAccess(projectId: string, docId: string, userId: string): Promise<void> {
	const doc = await queryOne<{ id: string }>(
		`SELECT id FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[docId, projectId]
	);
	if (!doc) error(404, 'Document not found in this project');
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!member) error(403, 'Not a member of this project');
}

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId and docId required');

	const confirm = url.searchParams.get('confirm');
	if (confirm !== docId) {
		error(400, 'Safety-Lock: ?confirm=<docId> erforderlich, damit dieser Wipe nicht versehentlich passiert.');
	}

	await ensureDocAccess(projectId, docId, locals.user.id);

	const result = await deleteAllRunsForDocument(projectId, docId);
	return json({ ok: true, scope: 'document', documentId: docId, ...result });
};
