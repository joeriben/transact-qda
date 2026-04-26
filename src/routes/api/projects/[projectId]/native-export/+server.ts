// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RequestHandler } from './$types.js';
import { exportProjectArchive } from '$lib/server/project-sync/index.js';
import { slugify } from '$lib/server/files/index.js';
import { queryOne } from '$lib/server/db/index.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const member = await queryOne(
		`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[params.projectId, locals.user!.id]
	);
	if (!member) {
		return new Response('Not found', { status: 404 });
	}

	const project = await queryOne<{ name: string }>(
		`SELECT name FROM projects WHERE id = $1`,
		[params.projectId]
	);
	if (!project) {
		return new Response('Not found', { status: 404 });
	}

	const slug = slugify(project.name);
	const buffer = await exportProjectArchive(params.projectId, slug);
	const filename = `${slug || 'project'}.tqda.zip`;

	return new Response(buffer, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Content-Length': buffer.length.toString()
		}
	});
};
