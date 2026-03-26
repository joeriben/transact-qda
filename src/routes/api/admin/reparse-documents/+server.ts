import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { pool, query } from '$lib/server/db/index.js';
import { reparseDocument } from '$lib/server/documents/parsers/index.js';
import { embedDocumentElements } from '$lib/server/documents/embed-elements.js';

/**
 * Backfill: re-parse all existing documents into document_elements,
 * then compute sentence embeddings.
 * Idempotent — deletes existing elements before re-inserting.
 */
export const POST: RequestHandler = async ({ url }) => {
	const embedOnly = url.searchParams.get('embedOnly') === 'true';

	const docs = await query<{ naming_id: string; full_text: string; mime_type: string }>(
		`SELECT naming_id, full_text, mime_type FROM document_content
		 WHERE full_text IS NOT NULL`
	);

	let parsed = 0;
	let embedded = 0;
	let skipped = 0;

	for (const doc of docs.rows) {
		// Step 1: Re-parse (unless embedOnly)
		if (!embedOnly) {
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
				continue;
			} finally {
				client.release();
			}
		}

		// Step 2: Compute embeddings
		try {
			const count = await embedDocumentElements(doc.naming_id);
			embedded += count;
		} catch (err) {
			console.error(`Failed to embed document ${doc.naming_id}:`, err);
		}
	}

	return json({ parsed, embedded, skipped, total: docs.rows.length });
};
