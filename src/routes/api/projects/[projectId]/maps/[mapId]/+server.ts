import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMap, getMapAppearances } from '$lib/server/db/queries/maps.js';

export const GET: RequestHandler = async ({ params }) => {
	const map = await getMap(params.mapId, params.projectId);
	if (!map) return json({ error: 'Not found' }, { status: 404 });

	const appearances = await getMapAppearances(params.mapId, params.projectId);

	return json({ map, appearances });
};
