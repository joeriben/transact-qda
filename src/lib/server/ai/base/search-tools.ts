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
			'Search the transact-qda platform manual for information about features, concepts, and how to use the application. ' +
			'The manual is written in English — search with English terms. Each term counts on its own: passages that contain more of your terms rank first, a passage with only one of them still counts.',
		input_schema: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description: 'One or more English terms, e.g. "silence absence situational map"'
				}
			},
			required: ['query']
		}
	}
];

// ── Suchbegriffe ──────────────────────────────────────────────────
//
// Jede Suche zerlegt die Anfrage in einzelne Begriffe und lässt jeden für sich
// treffen; mehr Treffer heißt weiter vorn. Vorher musste die ganze Anfrage
// wörtlich vorkommen (Namings, Memos, Handbuch) oder jedes Wort (Dokumente) —
// eine Anfrage wie „silence Stille create silence on map mode" fand dann im
// Handbuch nichts, obwohl es Silences behandelt (Testbericht 09.11.2026, Befund 28).

const STOPWORDS = new Set([
	// en
	'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'are', 'be',
	'how', 'what', 'which', 'who', 'do', 'does', 'can', 'my', 'me', 'it', 'this', 'that', 'as', 'an',
	'into', 'about', 'not', 'no', 'any', 'some', 'there', 'their', 'its',
	// de
	'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einen', 'einem', 'eines', 'und',
	'oder', 'zu', 'zum', 'zur', 'im', 'am', 'an', 'auf', 'mit', 'von', 'vom', 'für', 'ist', 'sind', 'wie',
	'was', 'wer', 'ich', 'mein', 'meine', 'meiner', 'es', 'nicht', 'kein', 'keine', 'gar', 'dass', 'also',
	'auch', 'bei', 'aus', 'als', 'man', 'wird', 'werden', 'kann', 'etwas'
]);

/** Inhaltswörter der Anfrage, klein geschrieben, ohne Dubletten. Nur Buchstaben und Ziffern — sicher für LIKE und tsquery. */
export function searchTerms(searchQuery: string): string[] {
	const words = (searchQuery ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	return Array.from(new Set(words.filter((w) => w.length >= 2 && !STOPWORDS.has(w))));
}

/** LIKE-Muster je Begriff (Begriffe enthalten weder % noch _). */
function likePatterns(terms: string[]): string[] {
	return terms.map((t) => `%${t}%`);
}

function noTermsMessage(searchQuery: string): string {
	return `Nothing to search for in "${searchQuery ?? ''}": the search uses words of two or more letters or digits, and skips words like "the" or "und".`;
}

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
		const terms = searchTerms(searchQuery);
		if (terms.length === 0) return { success: false, result: noTermsMessage(searchQuery) };

		// Jeder Begriff trifft für sich (ODER); Dokumente mit mehr Begriffen zuerst.
		const tsquery = terms.map((t) => `${t}:*`).join(' | ');

		const results = await query(
			`SELECT n.inscription as title,
			        ts_headline('german', dc.full_text, to_tsquery('german', $1),
			          'StartSel=>>>, StopSel=<<<, MaxFragments=3, MaxWords=50, MinWords=20') as headline,
			        LEFT(dc.full_text, 200) as preview,
			        (SELECT count(*) FROM unnest($3::text[]) AS p(pat) WHERE dc.full_text ILIKE p.pat)::int AS hits
			 FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $2 AND n.deleted_at IS NULL
			   AND dc.full_text IS NOT NULL
			   AND (
			     to_tsvector('german', dc.full_text) @@ to_tsquery('german', $1)
			     OR to_tsvector('english', dc.full_text) @@ to_tsquery('english', $1)
			     OR dc.full_text ILIKE ANY($3::text[])
			   )
			 ORDER BY hits DESC, n.inscription
			 LIMIT $4`,
			[tsquery, projectId, likePatterns(terms), limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No documents contain any of: ${terms.join(', ')}` };
		}

		const parts = [`Found ${results.rows.length} document(s) for any of: ${terms.join(', ')} (most matching terms first):\n`];
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
		const terms = searchTerms(searchQuery);
		if (terms.length === 0) return { success: false, result: noTermsMessage(searchQuery) };

		const results = await query(
			`SELECT n.id, n.inscription,
			        COALESCE(
			          (SELECT na.designation FROM naming_acts na
			           WHERE na.naming_id = n.id AND na.designation IS NOT NULL
			           ORDER BY na.seq DESC LIMIT 1),
			          'cue'
			        ) as designation,
			        array_agg(DISTINCT a.mode) FILTER (WHERE a.mode IS NOT NULL) as modes,
			        array_agg(DISTINCT p_map.inscription) FILTER (WHERE p_map.inscription IS NOT NULL) as map_names,
			        (SELECT count(*) FROM unnest($2::text[]) AS p(pat) WHERE n.inscription ILIKE p.pat)::int AS hits
			 FROM namings n
			 LEFT JOIN appearances a ON a.naming_id = n.id AND a.mode IN ('entity','relation','silence')
			 LEFT JOIN namings p_map ON p_map.id = a.perspective_id AND p_map.id != n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription ILIKE ANY($2::text[])
			 GROUP BY n.id, n.inscription
			 ORDER BY hits DESC, n.inscription
			 LIMIT $3`,
			[projectId, likePatterns(terms), limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No namings contain any of: ${terms.join(', ')}` };
		}

		const parts = [`Found ${results.rows.length} naming(s) for any of: ${terms.join(', ')} (most matching terms first):\n`];
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
		const terms = searchTerms(searchQuery);
		if (terms.length === 0) return { success: false, result: noTermsMessage(searchQuery) };

		const results = await query(
			`SELECT n.inscription as title, LEFT(mc.content, 300) as preview, n.created_at,
			        (SELECT count(*) FROM unnest($2::text[]) AS p(pat)
			         WHERE n.inscription ILIKE p.pat OR mc.content ILIKE p.pat)::int AS hits
			 FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND n.inscription NOT LIKE 'Discussion:%'
			   AND n.inscription NOT LIKE 'MemoDiscussion:%'
			   AND (n.inscription ILIKE ANY($2::text[]) OR mc.content ILIKE ANY($2::text[]))
			 ORDER BY hits DESC, n.created_at DESC
			 LIMIT $3`,
			[projectId, likePatterns(terms), limit]
		);

		if (results.rows.length === 0) {
			return { success: true, result: `No memos contain any of: ${terms.join(', ')}` };
		}

		const parts = [`Found ${results.rows.length} memo(s) for any of: ${terms.join(', ')} (most matching terms first):\n`];
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

// Handbuch nach Absätzen, je mit seiner Überschrift — einmal gebaut.
type ManualParagraph = { section: string; text: string; lower: string; sectionLower: string };
let manualParagraphCache: ManualParagraph[] | null = null;

function manualParagraphs(): ManualParagraph[] {
	if (manualParagraphCache) return manualParagraphCache;
	const out: ManualParagraph[] = [];
	let section = '';
	let block: string[] = [];
	const flush = () => {
		const text = block.join('\n').trim();
		if (text) out.push({ section, text, lower: text.toLowerCase(), sectionLower: section.toLowerCase() });
		block = [];
	};
	for (const line of MANUAL.split('\n')) {
		if (/^#{1,6}\s/.test(line)) {
			flush();
			section = line.replace(/^#+\s*/, '').trim();
		} else if (line.trim() === '') {
			flush();
		} else {
			block.push(line);
		}
	}
	flush();
	manualParagraphCache = out;
	return out;
}

const MANUAL_MAX_PASSAGES = 6;

function searchManual(searchQuery: string): { success: boolean; result: string } {
	if (!MANUAL) {
		return { success: false, result: 'Manual not loaded' };
	}
	const terms = searchTerms(searchQuery);
	if (terms.length === 0) {
		return { success: false, result: noTermsMessage(searchQuery) };
	}

	const paragraphs = manualParagraphs();
	const inParagraph = (p: ManualParagraph, t: string) => p.lower.includes(t) || p.sectionLower.includes(t);
	// Ein Begriff, der in vielen Absätzen steht, unterscheidet wenig.
	const df = new Map(terms.map((t) => [t, paragraphs.filter((p) => inParagraph(p, t)).length]));
	const found = terms.filter((t) => (df.get(t) ?? 0) > 0);
	const missing = terms.filter((t) => (df.get(t) ?? 0) === 0);

	if (found.length === 0) {
		return {
			success: true,
			result: `No manual passage contains any of: ${terms.join(', ')}. The manual is written in English — try English terms.`
		};
	}

	// Gewicht je Begriff: Seltenheit im Handbuch × wie oft die Anfrage ihn nennt.
	const queryWords = (searchQuery.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
	const termWeight = (t: string) =>
		Math.log(1 + paragraphs.length / (df.get(t) ?? 1)) * queryWords.filter((w) => w === t).length;

	const ranked = paragraphs
		.map((p, index) => {
			const hits = found.filter((t) => inParagraph(p, t));
			const weight = hits.reduce((sum, t) => sum + termWeight(t) * (p.lower.includes(t) ? 1 : 0.5), 0);
			return { p, index, hits, weight };
		})
		.filter((r) => r.hits.length > 0)
		.sort((a, b) => b.weight - a.weight || b.hits.length - a.hits.length || a.index - b.index)
		.slice(0, MANUAL_MAX_PASSAGES);

	const parts = [
		`Manual passages for: ${found.join(', ')}` +
			(missing.length > 0 ? ` (not in the manual: ${missing.join(', ')} — it is written in English)` : '') +
			'. Best matches first.\n'
	];
	for (const r of ranked) {
		parts.push(`── ${r.p.section || 'Manual'} ── (${r.hits.join(', ')})`);
		parts.push(r.p.text);
		parts.push('');
	}
	return { success: true, result: parts.join('\n') };
}
