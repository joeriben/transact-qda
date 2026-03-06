import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ params }) => {
	const result = await query(
		`SELECT e.id, e.label, e.created_at, dc.mime_type, dc.file_size
		 FROM elements e
		 JOIN document_content dc ON dc.element_id = e.id
		 WHERE e.project_id = $1 AND e.kind = 'document' AND e.deleted_at IS NULL
		 ORDER BY e.created_at DESC`,
		[params.projectId]
	);

	return {
		documents: result.rows,
		projectId: params.projectId
	};
};
