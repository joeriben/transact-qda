/**
 * Compute and store embeddings for document elements.
 * Called after parseAndStore — outside the upload transaction
 * (embedding is a network call to Ollama, shouldn't block DB).
 */

import { query, pool } from '../db/index.js';
import { embed, toPgVector } from './embeddings.js';

/**
 * Compute embeddings for all sentence-level elements of a document
 * that don't have an embedding yet.
 */
export async function embedDocumentElements(documentId: string): Promise<number> {
	// Get all leaf elements (sentences) without embeddings
	const elements = (await query<{ id: string; content: string }>(
		`SELECT id, content FROM document_elements
		 WHERE document_id = $1 AND content IS NOT NULL AND embedding IS NULL
		 ORDER BY char_start`,
		[documentId]
	)).rows;

	if (elements.length === 0) return 0;

	let embedded = 0;
	for (const el of elements) {
		if (!el.content.trim()) continue;

		try {
			const vec = await embed(el.content);
			await query(
				`UPDATE document_elements SET embedding = $1::vector WHERE id = $2`,
				[toPgVector(vec), el.id]
			);
			embedded++;
		} catch (err) {
			console.error(`Embedding failed for element ${el.id}:`, err);
			// Continue with remaining elements — don't fail the whole batch
		}
	}

	return embedded;
}

/**
 * Embed all documents in a project that have parsed elements but no embeddings.
 */
export async function embedAllDocuments(projectId?: string): Promise<{ embedded: number; documents: number }> {
	const whereClause = projectId
		? `AND n.project_id = $1`
		: '';
	const params = projectId ? [projectId] : [];

	const docs = (await query<{ document_id: string }>(
		`SELECT DISTINCT e.document_id
		 FROM document_elements e
		 JOIN namings n ON n.id = e.document_id AND n.deleted_at IS NULL
		 WHERE e.content IS NOT NULL AND e.embedding IS NULL
		 ${whereClause}`,
		params
	)).rows;

	let totalEmbedded = 0;
	for (const doc of docs) {
		const count = await embedDocumentElements(doc.document_id);
		totalEmbedded += count;
	}

	return { embedded: totalEmbedded, documents: docs.length };
}
