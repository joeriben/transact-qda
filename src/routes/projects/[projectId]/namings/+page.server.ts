// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';
import { getAllProjectNamings } from '$lib/server/db/queries/namings.js';
import { getProjectPhases } from '$lib/server/db/queries/maps.js';

export const load: PageServerLoad = async ({ params }) => {
	const [namings, phases, researchers, axes, absent] = await Promise.all([
		getAllProjectNamings(params.projectId),
		getProjectPhases(params.projectId),
		// Die Forschenden als Namings: gekennzeichnet, nicht zusammenführbar,
		// nicht zurückziehbar.
		query<{ naming_id: string }>(
			`SELECT naming_id FROM researcher_namings WHERE project_id = $1`,
			[params.projectId]
		),
		// Achsen einer Positional Map, damit die Liste sie als Achse zeigt.
		query<{ naming_id: string; dimension: string | null; map_label: string }>(
			`SELECT a.naming_id, a.properties->>'axisDimension' AS dimension, m.inscription AS map_label
			   FROM appearances a
			   JOIN namings n ON n.id = a.naming_id AND n.project_id = $1 AND n.deleted_at IS NULL
			   JOIN namings m ON m.id = a.perspective_id AND m.project_id = $1 AND m.deleted_at IS NULL
			   JOIN appearances ms ON ms.naming_id = m.id AND ms.perspective_id = m.id
			    AND ms.mode = 'perspective' AND ms.properties->>'mapType' = 'positional'
			  WHERE a.mode = 'entity' AND a.properties->>'isAxis' = 'true'
			  ORDER BY m.inscription`,
			[params.projectId]
		),
		// Abwesende Positionen einer Positional Map (Clarke: eine Position, die
		// im Material nicht eingenommen wird) — die Liste kennzeichnet sie.
		query<{ naming_id: string; map_label: string }>(
			`SELECT a.naming_id, m.inscription AS map_label
			   FROM appearances a
			   JOIN namings n ON n.id = a.naming_id AND n.project_id = $1 AND n.deleted_at IS NULL
			   JOIN namings m ON m.id = a.perspective_id AND m.project_id = $1 AND m.deleted_at IS NULL
			   JOIN appearances ms ON ms.naming_id = m.id AND ms.perspective_id = m.id
			    AND ms.mode = 'perspective' AND ms.properties->>'mapType' = 'positional'
			  WHERE a.properties->>'absent' = 'true'
			  ORDER BY m.inscription`,
			[params.projectId]
		)
	]);
	return {
		namings,
		phases,
		researcherNamingIds: researchers.rows.map((r) => r.naming_id),
		axes: axes.rows,
		absentPositions: absent.rows,
		projectId: params.projectId
	};
};
