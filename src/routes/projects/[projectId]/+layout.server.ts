// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LayoutServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';
import { getMapsByProject } from '$lib/server/db/queries/maps.js';
import { startPeriodicSync } from '$lib/server/project-sync/index.js';
import { slugify } from '$lib/server/files/index.js';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const project = await queryOne<{ id: string; name: string; description: string | null; role: string; properties: Record<string, unknown> | null }>(
		`SELECT p.id, p.name, p.description, p.properties, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE p.id = $1 AND pm.user_id = $2`,
		[params.projectId, locals.user!.id]
	);

	if (!project) {
		error(404, 'Project not found');
	}

	// Auto-start periodic sync when entering a project
	startPeriodicSync(params.projectId, slugify(project.name));

	// Die Zähler der Übersicht lädt deren eigene Seite (../+page.server.ts),
	// damit sie bei jedem Aufruf frisch sind.

	const maps = await getMapsByProject(params.projectId);
	const mapByType: Record<string, { id: string }> = {};
	const mapsByType: Record<string, { id: string; label: string; isPrimary?: boolean }[]> = {};
	for (const m of maps) {
		const t = m.properties?.mapType;
		if (t) {
			if (!mapByType[t]) mapByType[t] = { id: m.id };
			if (!mapsByType[t]) mapsByType[t] = [];
			mapsByType[t].push({ id: m.id, label: m.label, isPrimary: m.properties?.isPrimary === true });
		}
	}

	const docsResult = await query<{ id: string; label: string }>(
		`SELECT n.id, n.inscription as label
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		 ORDER BY n.inscription`,
		[params.projectId]
	);

	return {
		project,
		mapByType,
		mapsByType,
		documents: docsResult.rows
	};
};
