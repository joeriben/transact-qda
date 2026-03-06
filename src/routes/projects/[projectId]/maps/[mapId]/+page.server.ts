import type { PageServerLoad } from './$types.js';
import { getMap, getMapAppearances } from '$lib/server/db/queries/maps.js';
import { getNamingsByProject } from '$lib/server/db/queries/namings.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const map = await getMap(params.mapId, params.projectId);
	if (!map) error(404, 'Map not found');

	const appearances = await getMapAppearances(params.mapId, params.projectId);

	// All project namings for the palette
	const allNamings = await getNamingsByProject(params.projectId);

	return {
		map,
		appearances,
		allNamings,
		projectId: params.projectId
	};
};
