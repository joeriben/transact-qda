import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { pool, query } from '$lib/server/db/index.js';
import { reparseDocument } from '$lib/server/documents/parsers/index.js';

/**
 * Backfill: re-parse all existing documents into document_elements.
 * Idempotent — deletes existing elements before re-inserting.
 */
export const POST: RequestHandler = async () => {
	const docs = await query<{ naming_id: string; full_text: string; mime_type: string }>(
		`SELECT naming_id, full_text, mime_type FROM document_content
		 WHERE full_text IS NOT NULL`
	);

	let parsed = 0;
	let skipped = 0;

	for (const doc of docs.rows) {
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await reparseDocument(client, doc.naming_id, doc.full_text, doc.mime_type);
			await client.query('COMMIT');
			parsed++;
		} catch (err) {
			await client.query('ROLLBACK');
			console.error(`Failed to reparse document ${doc.naming_id}:`, err);
			skipped++;
		} finally {
			client.release();
		}
	}

	return json({ parsed, skipped, total: docs.rows.length });
};
