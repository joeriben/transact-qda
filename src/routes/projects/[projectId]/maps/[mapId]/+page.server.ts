import type { PageServerLoad } from './$types.js';
import { getMap, getMapElements, getMapRelations } from '$lib/server/db/queries/maps.js';
import { getElementsByProject } from '$lib/server/db/queries/elements.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const map = await getMap(params.mapId, params.projectId);
	if (!map) error(404, 'Map not found');

	const mapElements = await getMapElements(params.mapId, params.projectId);
	const mapRelations = await getMapRelations(params.mapId, params.projectId);

	// All project entities for the palette
	const allEntities = await getElementsByProject(params.projectId, 'entity');

	return {
		map,
		mapElements,
		mapRelations,
		allEntities,
		projectId: params.projectId
	};
};
