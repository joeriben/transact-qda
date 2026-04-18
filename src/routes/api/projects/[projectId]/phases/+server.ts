// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { queryOne } from '$lib/server/db/index.js';
import {
	getProjectPhases,
	getPhaseMembers,
	getPhasePassages,
	createProjectPhase,
	assignToPhase,
	removeFromPhase
} from '$lib/server/db/queries/maps.js';
import { getOrCreateResearcherNaming } from '$lib/server/db/queries/namings.js';

export const GET: RequestHandler = async ({ params }) => {
	const phases = await getProjectPhases(params.projectId);
	return json({ phases });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { action } = body;
	const { projectId } = params;
	const userId = locals.user!.id;

	const readOnlyActions = ['getMembers', 'getPassages'];
	if (!readOnlyActions.includes(action)) {
		const project = await queryOne<{
			properties: Record<string, unknown> | null;
			has_readonly_map: boolean;
		}>(
			`SELECT p.properties,
			        EXISTS (
			        	SELECT 1
			        	FROM appearances a
			        	JOIN namings n ON n.id = a.naming_id
			        	WHERE n.project_id = p.id
			        	  AND n.deleted_at IS NULL
			        	  AND a.naming_id = a.perspective_id
			        	  AND a.mode = 'perspective'
			        	  AND COALESCE((a.properties->>'readOnly')::boolean, false) = true
			        ) AS has_readonly_map
			   FROM projects p
			  WHERE p.id = $1`,
			[projectId]
		);
		if (project?.properties?.readOnly === true || project?.has_readonly_map === true) {
			return json(
				{ error: 'This project is read-only (template). Copy the project to make changes.' },
				{ status: 403 }
			);
		}
	}

	switch (action) {
		case 'create': {
			const { inscription } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const phase = await createProjectPhase(projectId, userId, inscription.trim());
			return json(phase, { status: 201 });
		}

		case 'getMembers': {
			const { phaseId } = body;
			if (!phaseId) return json({ error: 'phaseId required' }, { status: 400 });
			const members = await getPhaseMembers(phaseId);
			return json({ members });
		}

		case 'getPassages': {
			const { phaseId } = body;
			if (!phaseId) return json({ error: 'phaseId required' }, { status: 400 });
			const passages = await getPhasePassages(phaseId, projectId);
			return json({ passages });
		}

		case 'assign': {
			const { phaseId, namingId } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const appearance = await assignToPhase(phaseId, namingId, undefined, undefined, researcherNamingId);
			return json(appearance);
		}

		case 'remove': {
			const { phaseId, namingId } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			await removeFromPhase(phaseId, namingId, researcherNamingId);
			return json({ ok: true });
		}

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
