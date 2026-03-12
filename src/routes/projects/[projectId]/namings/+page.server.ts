import type { PageServerLoad } from './$types.js';
import { getAllProjectNamings } from '$lib/server/db/queries/namings.js';

export const load: PageServerLoad = async ({ params }) => {
	const namings = await getAllProjectNamings(params.projectId);
	return { namings, projectId: params.projectId };
};
