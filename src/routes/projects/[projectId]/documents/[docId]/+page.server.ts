import type { PageServerLoad } from './$types.js';
import { queryOne, query } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const doc = await queryOne<{
		id: string;
		label: string;
		full_text: string | null;
		mime_type: string;
		file_size: number;
	}>(
		`SELECT e.id, e.label, dc.full_text, dc.mime_type, dc.file_size
		 FROM elements e
		 JOIN document_content dc ON dc.element_id = e.id
		 WHERE e.id = $1 AND e.project_id = $2 AND e.kind = 'document' AND e.deleted_at IS NULL`,
		[params.docId, params.projectId]
	);

	if (!doc) error(404, 'Document not found');

	const annotations = await query(
		`SELECT a.id, a.code_id, a.anchor_type, a.anchor, a.comment,
		        c.label as code_label, c.properties as code_properties
		 FROM annotations a
		 JOIN elements c ON c.id = a.code_id
		 WHERE a.document_id = $1 AND a.project_id = $2
		 ORDER BY a.created_at`,
		[params.docId, params.projectId]
	);

	return {
		document: doc,
		annotations: annotations.rows,
		projectId: params.projectId
	};
};
