// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Search tools available to all AI personas.
// These are AI-callable tools for searching project data, documents, and manual.

import type { ToolDef } from '../client.js';
import { query } from '../../db/index.js';
import { MANUAL } from './manual.js';
import {
	findRelatedToText,
	findRelatedToSequence,
	type RelatedPassage
} from '../../corpus-structure/relatedness.js';

// ── Tool definitions (for AI tool calling) ────────────────────────

export const SEARCH_TOOLS: ToolDef[] = [
	{
		name: 'search_documents',
		description:
			'Full-text search across all documents in the current project. Returns matching passages with document names. Use this to find relevant material for analysis.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'Search query (natural language or keywords)'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of results (default: 5, max: 20)'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'search_namings',
		description:
			'Search across all namings (elements, relations, silences) in the project. Returns matching inscriptions with their designation stage and map locations.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'Search query to match against naming inscriptions'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of results (default: 10, max: 50)'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'search_memos',
		description:
			'Search across all analytical memos in the project. Returns matching memos with their titles and content previews.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'Search query to match against memo titles and content'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of results (default: 5, max: 20)'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'search_related_passages',
		description:
			'Find passages elsewhere in the project that share DISTINCTIVE (rare) vocabulary with a query text, or with a passage you name — and get those shared terms back as the reason. ' +
			'This is the tool to reach for when you want to know whether a reading holds beyond the one passage in front of you, where a theme recurs far away in a long document, or how two cases differ. ' +
			'Unlike search_documents (full-text, document-level, unranked) every hit here states WHY it was returned, so the ground is quotable rather than asserted. ' +
			'Words that occur in more than a tenth of the passages are ignored by construction — discourse markers and topic words of the whole corpus cannot produce a hit. The result reports which of your words counted and which were dropped as too common or too rare. ' +
			'Neighbouring sequences are excluded: adjacency is the default, not a finding. ' +
			'This tool only reads. It creates no naming and designates nothing.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description:
						'Free text: a formulation, a hypothesis in your own words, or a quoted passage. Use content words — function words are dropped. Omit if you give document_id + seq instead.'
				},
				document_id: {
					type: 'string',
					description: 'UUID of a document, when you want the neighbours of one of its sequences.'
				},
				seq: {
					type: 'number',
					description: '1-based sequence number within that document. Requires document_id.'
				},
				scope: {
					type: 'string',
					enum: ['project', 'in-document'],
					description:
						"'project' (default) searches all documents; 'in-document' stays inside document_id — use it to find recurrence within one interview."
				},
				cross_document_only: {
					type: 'boolean',
					description:
						'Exclude the source document entirely. Use for case comparison: what do OTHER cases say in these terms.'
				},
				max_results: {
					type: 'number',
					description: 'Maximum number of passages (default: 8, max: 25)'
				}
			}
		}
	},
	{
		name: 'search_manual',
		description:
			'Search the transact-qda platform manual for information about features, concepts, and how to use the application.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'What to search for in the manual'
				}
			},
			required: ['query']
		}
	}
];

// ── Tool execution ────────────────────────────────────────────────

export async function executeSearchTool(
	toolName: string,
	input: Record<string, unknown>,
	projectId: string
): Promise<{ success: boolean; result: string }> {
	switch (toolName) {
		case 'search_documents':
			return searchDocuments(projectId, input.query as string, Math.min((input.max_results as number) || 5, 20));
		case 'search_namings':
			return searchNamings(projectId, input.query as string, Math.min((input.max_results as number) || 10, 50));
		case 'search_memos':
			return searchMemos(projectId, input.query as string, Math.min((input.max_results as number) || 5, 20));
		case 'search_related_passages':
			return searchRelatedPassages(projectId, input);
		case 'search_manual':
			return searchManual(input.query as string);
		default:
			return { success: false, result: `Unknown search tool: ${toolName}` };
	}
}

async function searchDocuments(projectId: string, searchQuery: string, limit: number): Promise<{ success: boolean; result: string }> {
	try {
		// Use German FTS primarily (most projects), fall back to English
		const words = searchQuery.trim().split(/\s+/).filter(w => w.length > 1);
		if (words.length === 0) return { success: false, result: 'Empty search query' };

		const tsquery = words.map(w => `${w}:*`).join(' & ');

		const results = await query(
			`SELECT n.inscription as title,
			        ts_headline('german', dc.full_text, to_tsquery('german', $1),
			          'StartSel=>>>, StopSel=<<<, MaxFragments=3, MaxWords=50, MinWords=20') as headline,
			        LEFT(dc.full_text, 200) as preview
			 FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $2 AND n.deleted_at IS NULL
			   AND dc.full_text IS NOT NULL
			   AND (
			     to_tsvector('german', dc.full_text) @@ to_tsquery('german', $1)
			     OR to_tsvector('english', dc.full_text) @@ to_tsquery('english', $1)
			     OR dc.full_text ILIKE '%' || $3 || '%'
			   )
			 LIMIT $4`,
			[tsquery, projectId, words[0], limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No documents found matching "${searchQuery}"` };
		}

		const parts = [`Found ${results.rows.length} document(s) matching "${searchQuery}":\n`];
		for (const row of results.rows) {
			parts.push(`📄 "${row.title}"`);
			parts.push(row.headline || row.preview);
			parts.push('');
		}
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return { success: false, result: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

async function searchNamings(projectId: string, searchQuery: string, limit: number): Promise<{ success: boolean; result: string }> {
	try {
		const results = await query(
			`SELECT DISTINCT n.id, n.inscription,
			        COALESCE(
			          (SELECT na.designation FROM naming_acts na
			           WHERE na.naming_id = n.id AND na.designation IS NOT NULL
			           ORDER BY na.seq DESC LIMIT 1),
			          'cue'
			        ) as designation,
			        array_agg(DISTINCT a.mode) FILTER (WHERE a.mode IS NOT NULL) as modes,
			        array_agg(DISTINCT p_map.inscription) FILTER (WHERE p_map.inscription IS NOT NULL) as map_names
			 FROM namings n
			 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode IN ('entity','relation','silence')
			 LEFT JOIN namings p_map ON p_map.id = a.perspective_id AND p_map.id != n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription ILIKE '%' || $2 || '%'
			 GROUP BY n.id, n.inscription
			 ORDER BY n.inscription
			 LIMIT $3`,
			[projectId, searchQuery, limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No namings found matching "${searchQuery}"` };
		}

		const parts = [`Found ${results.rows.length} naming(s) matching "${searchQuery}":\n`];
		for (const row of results.rows) {
			const modes = row.modes?.join(', ') || 'no appearances';
			const maps = row.map_names?.join(', ') || 'no maps';
			parts.push(`  [${row.designation}] "${row.inscription}" — ${modes} — on: ${maps}`);
		}
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return { success: false, result: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

async function searchMemos(projectId: string, searchQuery: string, limit: number): Promise<{ success: boolean; result: string }> {
	try {
		const results = await query(
			`SELECT n.inscription as title, LEFT(mc.content, 300) as preview, n.created_at
			 FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription NOT LIKE 'Discussion:%'
			   AND n.inscription NOT LIKE 'MemoDiscussion:%'
			   AND (n.inscription ILIKE '%' || $2 || '%' OR mc.content ILIKE '%' || $2 || '%')
			 ORDER BY n.created_at DESC
			 LIMIT $3`,
			[projectId, searchQuery, limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No memos found matching "${searchQuery}"` };
		}

		const parts = [`Found ${results.rows.length} memo(s) matching "${searchQuery}":\n`];
		for (const row of results.rows) {
			parts.push(`📝 "${row.title}"`);
			parts.push(`   ${row.preview}`);
			parts.push('');
		}
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return { success: false, result: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

// Verwandte Passagen mit ausgewiesenem Grund.
//
// Der Rückgabetext nennt zu jedem Treffer die geteilten seltenen Terme. Das
// ist nicht Zierrat: ein Aktant, der eine Stelle als Beleg anführt, muss
// sagen können, woran sie hängt — eine Zahl allein ist keine Auskunft. Die
// Termliste ist zugleich der Kandidat für die unterscheidende Dimension.
async function searchRelatedPassages(
	projectId: string,
	input: Record<string, unknown>
): Promise<{ success: boolean; result: string }> {
	const limit = Math.min((input.max_results as number) || 8, 25);
	const documentId = typeof input.document_id === 'string' ? input.document_id : undefined;
	const opts = {
		scope: input.scope === 'in-document' ? ('in-document' as const) : ('project' as const),
		scopeDocumentId: documentId,
		crossDocumentOnly: input.cross_document_only === true,
		limit
	};

	try {
		let passages: RelatedPassage[];
		let header: string;
		let termNote = '';

		if (documentId && typeof input.seq === 'number') {
			const r = await findRelatedToSequence(projectId, documentId, input.seq, opts);
			if (!r.source) {
				return { success: false, result: `No sequence ${input.seq} in that document.` };
			}
			passages = r.passages;
			header = `Passages related to sequence ${input.seq} (of ${r.corpusUnits} sequences searched):`;
		} else if (typeof input.query === 'string' && input.query.trim().length > 0) {
			const r = await findRelatedToText(projectId, input.query, opts);
			passages = r.passages;
			header = `Passages related to "${input.query}" (of ${r.corpusUnits} sequences searched):`;
			const dropped: string[] = [];
			if (r.queryTerms.tooCommon.length > 0)
				dropped.push(`too common to distinguish: ${r.queryTerms.tooCommon.join(', ')}`);
			if (r.queryTerms.tooRare.length > 0)
				dropped.push(`not in this corpus: ${r.queryTerms.tooRare.join(', ')}`);
			termNote =
				r.queryTerms.used.length === 0
					? '\nNONE of your words could be counted' +
						(dropped.length ? ` (${dropped.join('; ')})` : '') +
						'. Try more specific content words.'
					: `\nCounted: ${r.queryTerms.used.join(', ')}` +
						(dropped.length ? ` — dropped (${dropped.join('; ')})` : '');
		} else {
			return {
				success: false,
				result: 'Provide either query, or document_id together with seq.'
			};
		}

		if (passages.length === 0) {
			return {
				success: true,
				result:
					'No related passages found — nothing in this project shares enough distinctive vocabulary.' +
					termNote +
					'\nThat is itself informative: the formulation may be singular to its place.'
			};
		}

		const parts = [header + termNote, ''];
		for (const p of passages) {
			const excerpt = p.text.replace(/\s+/g, ' ').slice(0, 400);
			parts.push(
				`📄 ${p.documentTitle} · sequence ${p.seq} · shared: ${p.sharedTerms.join(' · ')}`
			);
			parts.push(`   "${excerpt}${p.text.length > 400 ? '…' : ''}"`);
			parts.push('');
		}
		parts.push(
			'The shared terms are the ground of each hit — name them when you use a passage as evidence.'
		);
		return { success: true, result: parts.join('\n') };
	} catch (e) {
		return {
			success: false,
			result: `Related-passage search failed: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}

function searchManual(searchQuery: string): { success: boolean; result: string } {
	if (!MANUAL) {
		return { success: false, result: 'Manual not loaded' };
	}

	const queryLower = searchQuery.toLowerCase();
	const lines = MANUAL.split('\n');
	const matches: { section: string; content: string }[] = [];
	let currentSection = '';

	for (let i = 0; i < lines.length; i++) {
		// Track section headers
		if (lines[i].startsWith('#')) {
			currentSection = lines[i].replace(/^#+\s*/, '');
		}

		// Check for query match
		if (lines[i].toLowerCase().includes(queryLower)) {
			// Grab context: 2 lines before and 5 after
			const start = Math.max(0, i - 2);
			const end = Math.min(lines.length, i + 6);
			const context = lines.slice(start, end).join('\n');
			matches.push({ section: currentSection, content: context });

			if (matches.length >= 5) break;
			i = end; // skip ahead to avoid overlapping matches
		}
	}

	if (matches.length === 0) {
		return { success: true, result: `No manual entries found matching "${searchQuery}"` };
	}

	const parts = [`Found ${matches.length} section(s) in the manual matching "${searchQuery}":\n`];
	for (const m of matches) {
		parts.push(`── ${m.section} ──`);
		parts.push(m.content);
		parts.push('');
	}
	return { success: true, result: parts.join('\n') };
}
