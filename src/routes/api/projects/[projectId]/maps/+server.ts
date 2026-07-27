// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMapsByProject, createMap, duplicateMap } from '$lib/server/db/queries/maps.js';

export const GET: RequestHandler = async ({ params }) => {
	const maps = await getMapsByProject(params.projectId);
	return json(maps);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { action, label, mapType, properties, sourceMapId } = await request.json();

	if (action === 'duplicate') {
		if (!sourceMapId) return json({ error: 'sourceMapId required' }, { status: 400 });
		const map = await duplicateMap(params.projectId, locals.user!.id, sourceMapId, label || 'Copy');
		return json(map, { status: 201 });
	}

	if (!label || !mapType) return json({ error: 'label and mapType required' }, { status: 400 });
	const map = await createMap(params.projectId, locals.user!.id, label, mapType, properties);
	return json(map, { status: 201 });
};
