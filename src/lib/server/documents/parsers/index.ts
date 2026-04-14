// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type pg from 'pg';
import type { ParsedElement, ParseResult } from './types.js';
import { parsePlainText } from './plain-text.js';

/**
 * Select parser format based on MIME type and content heuristics.
 * For now only 'plain-text' is implemented; future parsers:
 *   - 'transcript-tiq' (Bohnsack / TiQ / GAT2)
 *   - 'academic' (heading-structured documents)
 */
export function selectFormat(_mimeType: string, _text: string): string {
	// Future: detect transcript patterns, markdown headings, etc.
	return 'plain-text';
}

export function parseDocument(text: string, mimeType: string): ParseResult {
	const format = selectFormat(mimeType, text);
	switch (format) {
		case 'plain-text':
			return parsePlainText(text);
		default:
			return parsePlainText(text);
	}
}

/**
 * Parse document text and store elements in the database.
 * Call within an existing transaction (same as document upload).
 */
export async function parseAndStore(
	client: pg.PoolClient,
	documentId: string,
	fullText: string,
	mimeType: string
): Promise<void> {
	const result = parseDocument(fullText, mimeType);

	// Flatten tree into ordered list for batch insert, tracking parent indices
	const flat: { element: ParsedElement; parentIndex: number | null; seq: number }[] = [];

	function flatten(elements: ParsedElement[], parentIndex: number | null) {
		for (let i = 0; i < elements.length; i++) {
			const el = elements[i];
			const myIndex = flat.length;
			flat.push({ element: el, parentIndex, seq: i });
			if (el.children) {
				flatten(el.children, myIndex);
			}
		}
	}

	flatten(result.elements, null);
	if (flat.length === 0) return;

	// Insert all elements, collecting generated UUIDs
	const ids: string[] = [];
	for (const { element, parentIndex, seq } of flat) {
		const parentId = parentIndex !== null ? ids[parentIndex] : null;
		const res = await client.query<{ id: string }>(
			`INSERT INTO document_elements (document_id, element_type, parent_id, seq, content, char_start, char_end, properties)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING id`,
			[
				documentId,
				element.type,
				parentId,
				seq,
				element.content,
				element.charStart,
				element.charEnd,
				JSON.stringify(element.properties || {})
			]
		);
		ids.push(res.rows[0].id);
	}

	// Insert cross-references (resolve toIndex → UUID)
	for (let i = 0; i < flat.length; i++) {
		const refs = flat[i].element.refs;
		if (!refs) continue;
		for (const ref of refs) {
			if (ref.toIndex >= 0 && ref.toIndex < ids.length) {
				await client.query(
					`INSERT INTO document_element_refs (from_id, to_id, ref_type, properties)
					 VALUES ($1, $2, $3, $4)`,
					[ids[i], ids[ref.toIndex], ref.refType, JSON.stringify(ref.properties || {})]
				);
			}
		}
	}
}

/**
 * Re-parse a single document. Deletes existing elements first.
 */
export async function reparseDocument(
	client: pg.PoolClient,
	documentId: string,
	fullText: string,
	mimeType: string
): Promise<void> {
	await client.query('DELETE FROM document_elements WHERE document_id = $1', [documentId]);
	await parseAndStore(client, documentId, fullText, mimeType);
}
