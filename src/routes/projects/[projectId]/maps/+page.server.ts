import type { PageServerLoad } from './$types.js';
import { getMapsByProject } from '$lib/server/db/queries/maps.js';

export const load: PageServerLoad = async ({ params }) => {
	const maps = await getMapsByProject(params.projectId);
	return { maps, projectId: params.projectId };
};
