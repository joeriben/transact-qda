import type { PageServerLoad } from './$types.js';
import { getMemosByProject } from '$lib/server/db/queries/memos.js';

export const load: PageServerLoad = async ({ params }) => {
	const memos = await getMemosByProject(params.projectId);
	return { memos, projectId: params.projectId };
};
