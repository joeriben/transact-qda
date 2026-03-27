import { json, error } from '@sveltejs/kit';
import { query } from '$lib/server/db/index.js';

export async function DELETE({ params }) {
	const { projectId, docId } = params;

	// Verify document exists and belongs to project
	const doc = await query(
		`SELECT n.id FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[docId, projectId]
	);
	if (doc.rows.length === 0) {
		throw error(404, 'Document not found');
	}

	// Soft-delete the document naming
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1`,
		[docId]
	);

	// Clean up document elements (embeddings, parsed structure)
	await query(
		`DELETE FROM document_elements WHERE document_id = $1`,
		[docId]
	);

	return json({ ok: true });
}
