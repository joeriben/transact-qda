/**
 * Coding Companion — Retrieval Layer
 *
 * Embedding-based retrieval: finds material that should enter the LLM context
 * for constant comparison. Vertically (within a document) and horizontally
 * (across documents). This is a cheap access path into the corpus — NOT an
 * analysis instrument. The actual comparison is performed by the LLM.
 */

import { query } from '../../db/index.js';
import { embed, toPgVector } from '../../documents/embeddings.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PassageCode {
	id: string;
	label: string;
	designation: 'cue' | 'characterization' | 'specification';
}

export interface SimilarPassage {
	elementId: string;
	content: string;
	documentId: string;
	documentTitle: string;
	similarity: number;
	codes: PassageCode[];
}

export interface CodeWithGroundings {
	id: string;
	label: string;
	designation: string;
	groundingCount: number;
	sampleGroundings: Array<{
		text: string;
		documentTitle: string;
		elementId: string;
	}>;
}

export interface RetrievalResult {
	passage: {
		elementId: string;
		content: string;
		documentId: string;
		documentTitle: string;
	};
	similarPassages: SimilarPassage[];
	existingCodes: CodeWithGroundings[];
}

// ── Core retrieval ─────────────────────────────────────────────────────────

/**
 * Retrieve comparison material for a parsed document element.
 * Uses embedding KNN to find topically related passages, then enriches
 * with annotation/code data so the LLM has material to compare against.
 */
export async function retrieveComparisonMaterial(
	projectId: string,
	elementId: string,
	options?: {
		maxSimilar?: number;
		maxCodes?: number;
		maxGroundingsPerCode?: number;
		scope?: 'in-document' | 'cross-document';
	}
): Promise<RetrievalResult> {
	const maxSimilar = options?.maxSimilar ?? 10;
	const maxCodes = options?.maxCodes ?? 10;
	const maxGroundingsPerCode = options?.maxGroundingsPerCode ?? 3;

	// 1. Get the source passage
	const sourceRow = await query<{
		id: string;
		content: string;
		document_id: string;
		document_title: string;
	}>(
		`SELECT e.id, e.content, e.document_id,
		        n.inscription AS document_title
		 FROM document_elements e
		 JOIN namings n ON n.id = e.document_id AND n.deleted_at IS NULL
		 WHERE e.id = $1 AND n.project_id = $2`,
		[elementId, projectId]
	);

	if (sourceRow.rows.length === 0) {
		throw new Error(`Element ${elementId} not found`);
	}

	const source = sourceRow.rows[0];
	const passage = {
		elementId: source.id,
		content: source.content,
		documentId: source.document_id,
		documentTitle: source.document_title
	};

	const scopeDocId = options?.scope === 'in-document' ? source.document_id : undefined;

	// 2. Find similar passages with their codes (parallel)
	const [similarPassages, existingCodes] = await Promise.all([
		findSimilarWithCodes(projectId, elementId, maxSimilar, scopeDocId),
		getCodesWithGroundings(projectId, maxCodes, maxGroundingsPerCode, scopeDocId)
	]);

	return { passage, similarPassages, existingCodes };
}

/**
 * Retrieve comparison material for free text selection (human UI).
 * Computes embedding on the fly, then proceeds as above.
 */
export async function retrieveComparisonMaterialForText(
	projectId: string,
	text: string,
	documentId: string,
	options?: {
		maxSimilar?: number;
		maxCodes?: number;
		maxGroundingsPerCode?: number;
		scope?: 'in-document' | 'cross-document';
	}
): Promise<RetrievalResult> {
	const maxSimilar = options?.maxSimilar ?? 10;
	const maxCodes = options?.maxCodes ?? 10;
	const maxGroundingsPerCode = options?.maxGroundingsPerCode ?? 3;
	const scope = options?.scope ?? 'in-document';

	// Get document title
	const docRow = await query<{ inscription: string }>(
		`SELECT inscription FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[documentId, projectId]
	);
	const documentTitle = docRow.rows[0]?.inscription ?? 'Unknown';

	const passage = {
		elementId: '',
		content: text,
		documentId,
		documentTitle
	};

	const scopeDocId = scope === 'in-document' ? documentId : undefined;

	const [similarPassages, existingCodes] = await Promise.all([
		findSimilarToTextWithCodes(projectId, text, maxSimilar, scopeDocId),
		getCodesWithGroundings(projectId, maxCodes, maxGroundingsPerCode, scopeDocId)
	]);

	return { passage, similarPassages, existingCodes };
}

// ── Internal queries ───────────────────────────────────────────────────────

/**
 * Find similar passages (by element embedding) enriched with their code annotations.
 */
async function findSimilarWithCodes(
	projectId: string,
	elementId: string,
	limit: number,
	scopeDocumentId?: string
): Promise<SimilarPassage[]> {
	const scopeClause = scopeDocumentId ? `AND e2.document_id = $4` : '';
	const params: any[] = [elementId, projectId, limit];
	if (scopeDocumentId) params.push(scopeDocumentId);

	const result = await query<{
		element_id: string;
		content: string;
		document_id: string;
		document_title: string;
		similarity: number;
		code_id: string | null;
		code_label: string | null;
		code_designation: string | null;
	}>(
		`WITH source AS (
		   SELECT embedding FROM document_elements WHERE id = $1
		 )
		 SELECT e2.id AS element_id,
		        e2.content,
		        e2.document_id,
		        doc.inscription AS document_title,
		        1 - (e2.embedding <=> s.embedding) AS similarity,
		        code.id AS code_id,
		        code.inscription AS code_label,
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = code.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS code_designation
		 FROM document_elements e2
		 CROSS JOIN source s
		 JOIN namings doc ON doc.id = e2.document_id AND doc.deleted_at IS NULL
		 -- LEFT JOIN: annotation that codes this element
		 LEFT JOIN appearances ann ON ann.directed_to = e2.document_id
		   AND ann.valence = 'codes'
		   AND (ann.properties->'anchor'->>'elementId') = e2.id::text
		   AND EXISTS (SELECT 1 FROM namings an WHERE an.id = ann.naming_id AND an.deleted_at IS NULL)
		 LEFT JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
		 WHERE e2.embedding IS NOT NULL
		   AND e2.id != $1
		   AND doc.project_id = $2
		   ${scopeClause}
		 ORDER BY e2.embedding <=> s.embedding
		 LIMIT $3`,
		params
	);

	return groupPassageCodes(result.rows);
}

/**
 * Find similar passages by free-text embedding, enriched with codes.
 */
async function findSimilarToTextWithCodes(
	projectId: string,
	text: string,
	limit: number,
	scopeDocumentId?: string
): Promise<SimilarPassage[]> {
	const vec = await embed(text);
	const pgVec = toPgVector(vec);

	const scopeClause = scopeDocumentId ? `AND e.document_id = $4` : '';
	const params: any[] = [pgVec, projectId, limit];
	if (scopeDocumentId) params.push(scopeDocumentId);

	const result = await query<{
		element_id: string;
		content: string;
		document_id: string;
		document_title: string;
		similarity: number;
		code_id: string | null;
		code_label: string | null;
		code_designation: string | null;
	}>(
		`SELECT e.id AS element_id,
		        e.content,
		        e.document_id,
		        doc.inscription AS document_title,
		        1 - (e.embedding <=> $1::vector) AS similarity,
		        code.id AS code_id,
		        code.inscription AS code_label,
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = code.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS code_designation
		 FROM document_elements e
		 JOIN namings doc ON doc.id = e.document_id AND doc.deleted_at IS NULL
		 LEFT JOIN appearances ann ON ann.directed_to = e.document_id
		   AND ann.valence = 'codes'
		   AND (ann.properties->'anchor'->>'elementId') = e.id::text
		   AND EXISTS (SELECT 1 FROM namings an WHERE an.id = ann.naming_id AND an.deleted_at IS NULL)
		 LEFT JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
		 WHERE e.embedding IS NOT NULL
		   AND doc.project_id = $2
		   ${scopeClause}
		 ORDER BY e.embedding <=> $1::vector
		 LIMIT $3`,
		params
	);

	return groupPassageCodes(result.rows);
}

/**
 * Group flat rows (one row per passage×code) into SimilarPassage objects
 * with nested codes arrays.
 */
function groupPassageCodes(
	rows: Array<{
		element_id: string;
		content: string;
		document_id: string;
		document_title: string;
		similarity: number;
		code_id: string | null;
		code_label: string | null;
		code_designation: string | null;
	}>
): SimilarPassage[] {
	const map = new Map<string, SimilarPassage>();

	for (const row of rows) {
		let entry = map.get(row.element_id);
		if (!entry) {
			entry = {
				elementId: row.element_id,
				content: row.content,
				documentId: row.document_id,
				documentTitle: row.document_title,
				similarity: row.similarity,
				codes: []
			};
			map.set(row.element_id, entry);
		}
		if (row.code_id && row.code_label) {
			entry.codes.push({
				id: row.code_id,
				label: row.code_label,
				designation: (row.code_designation as PassageCode['designation']) ?? 'cue'
			});
		}
	}

	return [...map.values()];
}

/**
 * Get all existing codes in the project with sample groundings.
 * These represent the researcher's analytical categories.
 */
async function getCodesWithGroundings(
	projectId: string,
	maxCodes: number,
	maxGroundingsPerCode: number,
	scopeDocumentId?: string
): Promise<CodeWithGroundings[]> {
	// Get codes that have document anchors, ordered by grounding count
	// When scoped to a document, only return codes grounded in that document
	const scopeClause = scopeDocumentId ? `AND ann.directed_to = $3` : '';
	const params: any[] = [projectId, maxCodes];
	if (scopeDocumentId) params.push(scopeDocumentId);

	const codesResult = await query<{
		code_id: string;
		code_label: string;
		designation: string | null;
		grounding_count: number;
	}>(
		`SELECT code.id AS code_id,
		        code.inscription AS code_label,
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = code.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS designation,
		        COUNT(ann.naming_id) AS grounding_count
		 FROM namings code
		 JOIN appearances ann ON ann.directed_from = code.id AND ann.valence = 'codes'
		 JOIN namings ann_n ON ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL
		 WHERE code.project_id = $1 AND code.deleted_at IS NULL
		   ${scopeClause}
		 GROUP BY code.id, code.inscription
		 ORDER BY grounding_count DESC
		 LIMIT $2`,
		params
	);

	// For each code, get sample groundings
	const codes: CodeWithGroundings[] = [];
	for (const row of codesResult.rows) {
		const groundings = await query<{
			text: string;
			document_title: string;
			element_id: string;
		}>(
			`SELECT
			   COALESCE(
			     e.content,
			     ann.properties->'anchor'->>'text'
			   ) AS text,
			   doc.inscription AS document_title,
			   COALESCE(
			     (ann.properties->'anchor'->>'elementId'),
			     ''
			   ) AS element_id
			 FROM appearances ann
			 JOIN namings ann_n ON ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL
			 JOIN namings doc ON doc.id = ann.directed_to AND doc.deleted_at IS NULL
			 LEFT JOIN document_elements e ON e.id::text = (ann.properties->'anchor'->>'elementId')
			 WHERE ann.directed_from = $1 AND ann.valence = 'codes'
			   AND ann_n.project_id = $2
			 ORDER BY ann_n.created_at
			 LIMIT $3`,
			[row.code_id, projectId, maxGroundingsPerCode]
		);

		codes.push({
			id: row.code_id,
			label: row.code_label,
			designation: row.designation ?? 'cue',
			groundingCount: Number(row.grounding_count),
			sampleGroundings: groundings.rows
				.filter(g => g.text)
				.map(g => ({ text: g.text, documentTitle: g.document_title, elementId: g.element_id }))
		});
	}

	return codes;
}
