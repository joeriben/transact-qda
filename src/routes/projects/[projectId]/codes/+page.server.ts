import type { PageServerLoad } from './$types.js';
import { getCodeTree, getAnnotationsByCode } from '$lib/server/db/queries/codes.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ params }) => {
	const codes = await getCodeTree(params.projectId);

	// Get annotation counts per code
	const countResult = await query(
		`SELECT code_id, COUNT(*) as count
		 FROM annotations WHERE project_id = $1
		 GROUP BY code_id`,
		[params.projectId]
	);
	const annotationCounts: Record<string, number> = {};
	for (const row of countResult.rows) {
		annotationCounts[row.code_id] = parseInt(row.count);
	}

	return {
		codes,
		annotationCounts,
		projectId: params.projectId
	};
};
