// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reset-Coding-Seite — Form-Action für den project-weiten Cleanup. Nutzt
// SvelteKit-Form-Actions, damit weder DevTools-Konsole noch Cookie-Probe
// nötig sind. Die Session liegt durch das normale Page-Routing schon vor.

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { deleteAllRunsForProject } from '$lib/server/db/queries/codes.js';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const project = await queryOne<{ id: string; inscription: string }>(
		`SELECT id, inscription FROM namings
		 WHERE id = $1 AND deleted_at IS NULL`,
		[params.projectId]
	);
	if (!project) error(404, 'Project not found');
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[params.projectId, locals.user.id]
	);
	if (!member) error(403, 'Not a member');
	return { projectId: project.id, projectName: project.inscription };
};

export const actions: Actions = {
	reset: async ({ params, locals, request }) => {
		if (!locals.user) error(401, 'Not authenticated');
		const form = await request.formData();
		const confirm = String(form.get('confirm') ?? '');
		if (confirm !== params.projectId) {
			return fail(400, { error: 'Safety-Lock: projectId in Bestätigungs-Feld stimmt nicht.' });
		}
		const member = await queryOne<{ role: string }>(
			`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
			[params.projectId, locals.user.id]
		);
		if (!member) error(403, 'Not a member');

		const result = await deleteAllRunsForProject(params.projectId);
		return { success: true as const, ...result };
	}
};
