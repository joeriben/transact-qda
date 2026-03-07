import type { PageServerLoad } from './$types.js';
import { getMap, getMapStructure } from '$lib/server/db/queries/maps.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const map = await getMap(params.mapId, params.projectId);
	if (!map) error(404, 'Map not found');

	const structure = await getMapStructure(params.mapId, params.projectId);

	return {
		map,
		...structure,
		projectId: params.projectId
	};
};
