import type { PageServerLoad } from './$types.js';
import { getCodeTree } from '$lib/server/db/queries/codes.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ params }) => {
	const codes = await getCodeTree(params.projectId);

	// Count annotations per code (appearances with valence='codes')
	const countResult = await query(
		`SELECT a.directed_from as code_id, COUNT(*) as count
		 FROM appearances a
		 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
		 WHERE a.valence = 'codes' AND n.project_id = $1
		 GROUP BY a.directed_from`,
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
