// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Naming Companion — Retrieval Layer
 *
 * Embedding-based retrieval: finds material that should enter the LLM context
 * for constant comparison. Vertically (within a document) and horizontally
 * (across documents). This is a cheap access path into the corpus — NOT an
 * analysis instrument. The actual comparison is performed by the LLM.
 */

import { query } from '../../db/index.js';
import { embed, toPgVector } from '../../documents/embeddings.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PassageNaming {
	id: string;
	label: string;
	designation: 'cue' | 'characterization' | 'specification';
	/** Naming des Forschers (siehe ownNamingSql), nicht bloß ein KI-Hinweis. */
	own: boolean;
}

export interface SimilarPassage {
	elementId: string;
	content: string;
	documentId: string;
	documentTitle: string;
	similarity: number;
	namings: PassageNaming[];
}

export interface NamingWithGroundings {
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
	existingNamings: NamingWithGroundings[];
}

// ── Core retrieval ─────────────────────────────────────────────────────────

/**
 * Retrieve comparison material for a parsed document element.
 * Uses embedding KNN to find topically related passages, then enriches
 * with annotation/naming data so the LLM has material to compare against.
 */
export async function retrieveComparisonMaterial(
	projectId: string,
	elementId: string,
	options?: {
		maxSimilar?: number;
		maxNamings?: number;
		maxGroundingsPerNaming?: number;
		scope?: 'in-document' | 'cross-document';
	}
): Promise<RetrievalResult> {
	const maxSimilar = options?.maxSimilar ?? 10;
	const maxNamings = options?.maxNamings ?? 10;
	const maxGroundingsPerNaming = options?.maxGroundingsPerNaming ?? 3;

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

	// 2. Find similar passages with their namings (parallel)
	const [similarPassages, existingNamings] = await Promise.all([
		findSimilarWithNamings(projectId, elementId, maxSimilar, scopeDocId),
		getNamingsWithGroundings(projectId, maxNamings, maxGroundingsPerNaming, scopeDocId)
	]);

	return { passage, similarPassages, existingNamings };
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
		maxNamings?: number;
		maxGroundingsPerNaming?: number;
		scope?: 'in-document' | 'cross-document';
	}
): Promise<RetrievalResult> {
	const maxSimilar = options?.maxSimilar ?? 10;
	const maxNamings = options?.maxNamings ?? 10;
	const maxGroundingsPerNaming = options?.maxGroundingsPerNaming ?? 3;
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

	const [found, existingNamings] = await Promise.all([
		findSimilarToTextWithNamings(projectId, text, maxSimilar + 1, scopeDocId),
		getNamingsWithGroundings(projectId, maxNamings, maxGroundingsPerNaming, scopeDocId)
	]);
	// Die Stelle, in der die Markierung selbst steht, ist ihr eigener
	// nächster Nachbar; als „ähnliche Stelle" sagt sie nichts.
	const marked = text.trim();
	const similarPassages = found
		.filter((p) => !(p.documentId === documentId && marked && p.content.includes(marked)))
		.slice(0, maxSimilar);

	return { passage, similarPassages, existingNamings };
}

// ── Internal queries ───────────────────────────────────────────────────────

/**
 * Vergleichsgrund sind die Namings des Forschers, nicht die Hinweise der KI.
 * Eigen ist ein Naming ohne KI-Provenienz — oder ein KI-Cue, an dem ein
 * Forscher selbst gehandelt hat (designiert, umbenannt, revidiert): dann
 * steht sein Akt im Stack. Ein ungeprüfter oder verworfener Cue ist ein
 * Hinweis, keine Kategorie; ohne diese Grenze verglich das Modell eine
 * Passage überwiegend mit Ausgaben des Naming-Runs.
 *
 * Das Urteil der Auditschicht (ai_naming_evaluations) wird hier bewusst
 * nicht gelesen — sie muss sich restlos entfernen lassen.
 */
function ownNamingSql(alias: string): string {
	return `(NOT EXISTS (SELECT 1 FROM appearances ai
	                    WHERE ai.naming_id = ${alias}.id AND ai.properties->>'aiPersona' IS NOT NULL)
	         OR EXISTS (SELECT 1 FROM naming_acts fa
	                    JOIN researcher_namings rn ON rn.naming_id = fa.by AND rn.project_id = ${alias}.project_id
	                     AND rn.user_id <> '00000000-0000-0000-0000-000000000000'
	                    WHERE fa.naming_id = ${alias}.id))`;
}

/** Im Reader ausgeblendete Verankerungen zählen nicht als Material. */
const NOT_HIDDEN = `COALESCE(ann.properties->>'hidden', 'false') <> 'true'`;

/**
 * Find similar passages (by element embedding) enriched with the namings anchored there.
 */
async function findSimilarWithNamings(
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
		naming_id: string | null;
		naming_label: string | null;
		naming_designation: string | null;
		naming_own: boolean | null;
	}>(
		`WITH source AS (
		   SELECT embedding FROM document_elements WHERE id = $1
		 )
		 SELECT e2.id AS element_id,
		        e2.content,
		        e2.document_id,
		        doc.inscription AS document_title,
		        1 - (e2.embedding <=> s.embedding) AS similarity,
		        nm.id AS naming_id,
		        nm.inscription AS naming_label,
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = nm.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS naming_designation,
		        ${ownNamingSql('nm')} AS naming_own
		 FROM document_elements e2
		 CROSS JOIN source s
		 JOIN namings doc ON doc.id = e2.document_id AND doc.deleted_at IS NULL
		 -- LEFT JOIN: annotation whose char-range overlaps this element.
		 -- Namings anchor by char-offset (pos0/pos1); elementId is optional and
		 -- usually absent, so match [pos0,pos1) against [char_start,char_end).
		 LEFT JOIN appearances ann ON ann.directed_to = e2.document_id
		   AND ann.valence = 'codes'
		   AND ${NOT_HIDDEN}
		   AND (ann.properties->'anchor'->>'pos0') ~ '^[0-9]+$'
		   AND (ann.properties->'anchor'->>'pos1') ~ '^[0-9]+$'
		   AND (ann.properties->'anchor'->>'pos0')::int < e2.char_end
		   AND (ann.properties->'anchor'->>'pos1')::int > e2.char_start
		   AND EXISTS (SELECT 1 FROM namings an WHERE an.id = ann.naming_id AND an.deleted_at IS NULL)
		 LEFT JOIN namings nm ON nm.id = ann.directed_from AND nm.deleted_at IS NULL
		 WHERE e2.embedding IS NOT NULL
		   AND e2.id != $1
		   AND doc.project_id = $2
		   ${scopeClause}
		 ORDER BY e2.embedding <=> s.embedding
		 LIMIT $3`,
		params
	);

	return groupPassageNamings(result.rows);
}

/**
 * Find similar passages by free-text embedding, enriched with namings.
 */
async function findSimilarToTextWithNamings(
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
		naming_id: string | null;
		naming_label: string | null;
		naming_designation: string | null;
		naming_own: boolean | null;
	}>(
		`SELECT e.id AS element_id,
		        e.content,
		        e.document_id,
		        doc.inscription AS document_title,
		        1 - (e.embedding <=> $1::vector) AS similarity,
		        nm.id AS naming_id,
		        nm.inscription AS naming_label,
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = nm.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS naming_designation,
		        ${ownNamingSql('nm')} AS naming_own
		 FROM document_elements e
		 JOIN namings doc ON doc.id = e.document_id AND doc.deleted_at IS NULL
		 LEFT JOIN appearances ann ON ann.directed_to = e.document_id
		   AND ann.valence = 'codes'
		   AND ${NOT_HIDDEN}
		   AND (ann.properties->'anchor'->>'pos0') ~ '^[0-9]+$'
		   AND (ann.properties->'anchor'->>'pos1') ~ '^[0-9]+$'
		   AND (ann.properties->'anchor'->>'pos0')::int < e.char_end
		   AND (ann.properties->'anchor'->>'pos1')::int > e.char_start
		   AND EXISTS (SELECT 1 FROM namings an WHERE an.id = ann.naming_id AND an.deleted_at IS NULL)
		 LEFT JOIN namings nm ON nm.id = ann.directed_from AND nm.deleted_at IS NULL
		 WHERE e.embedding IS NOT NULL
		   AND doc.project_id = $2
		   ${scopeClause}
		 ORDER BY e.embedding <=> $1::vector
		 LIMIT $3`,
		params
	);

	return groupPassageNamings(result.rows);
}

/**
 * Group flat rows (one row per passage×naming) into SimilarPassage objects
 * with nested namings arrays.
 */
function groupPassageNamings(
	rows: Array<{
		element_id: string;
		content: string;
		document_id: string;
		document_title: string;
		similarity: number;
		naming_id: string | null;
		naming_label: string | null;
		naming_designation: string | null;
		naming_own: boolean | null;
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
				namings: []
			};
			map.set(row.element_id, entry);
		}
		// A naming can overlap one element via several groundings → dedup by id
		// (range-overlap matching makes this reachable; elementId matching did not).
		if (row.naming_id && row.naming_label && !entry.namings.some((n) => n.id === row.naming_id)) {
			entry.namings.push({
				id: row.naming_id,
				label: row.naming_label,
				designation: (row.naming_designation as PassageNaming['designation']) ?? 'cue',
				own: row.naming_own === true
			});
		}
	}

	return [...map.values()];
}

/**
 * The researcher's own namings (ownNamingSql) that are anchored in the
 * material, with sample anchors — the analytic categories a passage is
 * compared against.
 */
async function getNamingsWithGroundings(
	projectId: string,
	maxNamings: number,
	maxGroundingsPerNaming: number,
	scopeDocumentId?: string
): Promise<NamingWithGroundings[]> {
	// Ordered by anchor count. When scoped to a document, only namings
	// anchored in that document.
	const scopeClause = scopeDocumentId ? `AND ann.directed_to = $3` : '';
	const params: any[] = [projectId, maxNamings];
	if (scopeDocumentId) params.push(scopeDocumentId);

	const namingsResult = await query<{
		naming_id: string;
		naming_label: string;
		designation: string | null;
		grounding_count: number;
	}>(
		`SELECT nm.id AS naming_id,
		        nm.inscription AS naming_label,
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = nm.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS designation,
		        COUNT(ann.naming_id) AS grounding_count
		 FROM namings nm
		 JOIN appearances ann ON ann.directed_from = nm.id AND ann.valence = 'codes'
		   AND ${NOT_HIDDEN}
		 JOIN namings ann_n ON ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL
		 WHERE nm.project_id = $1 AND nm.deleted_at IS NULL
		   AND ${ownNamingSql('nm')}
		   ${scopeClause}
		 GROUP BY nm.id, nm.inscription
		 ORDER BY grounding_count DESC
		 LIMIT $2`,
		params
	);

	// For each naming, get sample groundings
	const namings: NamingWithGroundings[] = [];
	for (const row of namingsResult.rows) {
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
			   AND ${NOT_HIDDEN}
			   AND ann_n.project_id = $2
			 ORDER BY ann_n.created_at
			 LIMIT $3`,
			[row.naming_id, projectId, maxGroundingsPerNaming]
		);

		namings.push({
			id: row.naming_id,
			label: row.naming_label,
			designation: row.designation ?? 'cue',
			groundingCount: Number(row.grounding_count),
			sampleGroundings: groundings.rows
				.filter(g => g.text)
				.map(g => ({ text: g.text, documentTitle: g.document_title, elementId: g.element_id }))
		});
	}

	return namings;
}
