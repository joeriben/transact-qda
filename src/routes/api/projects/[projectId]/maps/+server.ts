import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMapsByProject, createMap } from '$lib/server/db/queries/maps.js';

export const GET: RequestHandler = async ({ params }) => {
	const maps = await getMapsByProject(params.projectId);
	return json(maps);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label, mapType, properties } = await request.json();
	if (!label || !mapType) return json({ error: 'label and mapType required' }, { status: 400 });

	const map = await createMap(params.projectId, locals.user!.id, label, mapType, properties);
	return json(map, { status: 201 });
};
