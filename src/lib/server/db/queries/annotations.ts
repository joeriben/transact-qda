// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query, queryOne, transaction } from '../index.js';
import { createNaming, setAppearance, getOrCreateResearcherNaming } from './namings.js';

// The "grounding workspace" perspective is a project-level naming
// that holds orphan in-vivo namings (not yet placed on a map) and
// annotation relation appearances. It is infrastructure, not a
// separate analytical domain.

export async function getOrCreateGroundingWorkspace(projectId: string, userId: string) {
	let perspective = await queryOne<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.project_id = $1 AND a.mode = 'perspective'
		   AND a.properties->>'role' = 'grounding-workspace'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[projectId]
	);

	if (!perspective) {
		const n = await createNaming(projectId, userId, 'Grounding Workspace');
		await setAppearance(n.id, n.id, 'perspective', {
			properties: { role: 'grounding-workspace' }
		});
		perspective = { id: n.id };
	}

	return perspective.id;
}

/**
 * All namings that can be used as annotation anchors.
 * Pulls entities from ALL map perspectives AND the grounding workspace.
 * Prefers map appearances over grounding workspace for color/source info.
 */
export async function getAnnotationCandidates(projectId: string) {
	const result = await query<{
		id: string;
		label: string;
		color: string | null;
		source_map_id: string | null;
		source_map_label: string | null;
		is_orphan: boolean;
		has_document_anchor: boolean;
		has_memo_link: boolean;
		designation: 'cue' | 'characterization' | 'specification' | null;
	}>(
		`SELECT DISTINCT ON (n.id)
		        n.id,
		        n.inscription as label,
		        a.properties->>'color' as color,
		        -- Source map info (NULL for grounding workspace orphans)
		        CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN NULL
		             ELSE a.perspective_id END as source_map_id,
		        CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN NULL
		             ELSE map_n.inscription END as source_map_label,
		        -- Is this an orphan (only on grounding workspace, no map)?
		        CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN true
		             ELSE false END as is_orphan,
		        -- Has document anchor?
		        EXISTS (
		          SELECT 1 FROM appearances ann
		          WHERE ann.directed_from = n.id AND ann.valence = 'codes'
		            AND EXISTS (SELECT 1 FROM namings ann_n WHERE ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL)
		        ) as has_document_anchor,
		        -- Has memo link? (mirrors getAllProjectNamings)
		        EXISTS (
		          SELECT 1 FROM participations mp
		          JOIN namings pn ON pn.id = mp.id AND pn.deleted_at IS NULL
		          JOIN memo_content mc ON mc.naming_id = CASE
		            WHEN mp.naming_id = n.id THEN mp.participant_id
		            ELSE mp.naming_id END
		          JOIN namings mn ON mn.id = mc.naming_id AND mn.deleted_at IS NULL AND NOT (mn.created_by = '00000000-0000-0000-0000-000000000000' AND mc.status IS DISTINCT FROM 'promoted')
		          -- KI-Memos verankern nichts, bis die Forscherin sie hereinholt (promote); ack ist ein Verdikt, kein Hereinholen (Satz IV)
		          WHERE mp.naming_id = n.id OR mp.participant_id = n.id
		        ) as has_memo_link,
		        -- Current designation (latest non-NULL in stack)
		        (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = n.id AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) as designation
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 JOIN appearances pa ON pa.naming_id = a.perspective_id AND pa.perspective_id = a.perspective_id AND pa.mode = 'perspective'
		 LEFT JOIN namings map_n ON map_n.id = a.perspective_id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND (pa.properties ? 'mapType' OR pa.properties->>'role' = 'grounding-workspace')
		 ORDER BY n.id,
		          -- Prefer map appearances over grounding workspace
		          CASE WHEN pa.properties->>'role' = 'grounding-workspace' THEN 1 ELSE 0 END,
		          n.inscription`,
		[projectId]
	);
	return result.rows;
}

/**
 * Create an orphan naming on the grounding workspace.
 * Used for in-vivo naming when no map context is active.
 */
export async function createOrphanNaming(
	projectId: string,
	userId: string,
	label: string,
	opts?: {
		color?: string;
		description?: string;
		provenance?: Record<string, unknown>;
		placeOnPrimaryMap?: boolean;
	}
) {
	return transaction(async (client) => {
		const perspectiveId = await getOrCreateGroundingWorkspace(projectId, userId);

		// Check for duplicate label (case-insensitive) across ALL entity appearances
		const existing = await client.query(
			`SELECT n.id FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND LOWER(n.inscription) = LOWER($2)
			 LIMIT 1`,
			[projectId, label]
		);
		if (existing.rows.length > 0) {
			throw new Error(`Naming "${label}" already exists`);
		}

		// Create the naming
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const naming = namingRes.rows[0];

		// It appears as entity from the grounding workspace
		const props: Record<string, unknown> = { ...(opts?.provenance || {}) };
		if (opts?.color) props.color = opts.color;
		if (opts?.description) props.description = opts.description;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', $3)`,
			[naming.id, perspectiveId, JSON.stringify(props)]
		);

		// Optionally place on primary Situational Map (unresolved — no x/y).
		// SNames (sequence-namings) skip this: they are TOC-class, not SitMap-class.
		// Default true preserves existing CName behavior.
		const placeOnMap = opts?.placeOnPrimaryMap !== false;
		if (placeOnMap) {
			const primaryMap = await client.query(
				`SELECT n.id FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				   AND a.mode = 'perspective'
				   AND a.properties->>'mapType' = 'situational'
				   AND (a.properties->>'isPrimary')::boolean = true
				 LIMIT 1`,
				[projectId]
			);
			if (primaryMap.rows.length > 0) {
				const primaryProps = opts?.provenance ? JSON.stringify(opts.provenance) : '{}';
				await client.query(
					`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
					 VALUES ($1, $2, 'entity', $3)
					 ON CONFLICT (naming_id, perspective_id) DO NOTHING`,
					[naming.id, primaryMap.rows[0].id, primaryProps]
				);
			}
		}

		return { ...naming, properties: props };
	});
}

export async function createAnnotation(
	projectId: string,
	userId: string,
	namingId: string,
	documentId: string,
	anchorType: 'text' | 'image_region',
	anchor: Record<string, unknown>,
	comment?: string,
	provenance?: Record<string, unknown>,
	opts?: {
		valence?: 'codes' | 'thematizes';
		annotationKind?: 'code-naming' | 'sequence-naming';
		extraProperties?: Record<string, unknown>;
	}
) {
	const valence = opts?.valence ?? 'codes';
	const annotationKind = opts?.annotationKind ?? (valence === 'thematizes' ? 'sequence-naming' : 'code-naming');
	const extraProperties = opts?.extraProperties ?? {};

	return transaction(async (client) => {
		const perspectiveId = await getOrCreateGroundingWorkspace(projectId, userId);

		// Duplicate check: same naming + document + same anchor position + same valence
		const existing = await client.query(
			`SELECT a.naming_id as id FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 WHERE a.directed_from = $1 AND a.directed_to = $2 AND a.valence = $7
			   AND n.project_id = $3
			   AND a.properties->>'anchorType' = $4
			   AND a.properties->'anchor'->>'pos0' = $5
			   AND a.properties->'anchor'->>'pos1' = $6`,
			[namingId, documentId, projectId, anchorType,
			 String(anchor.pos0 ?? ''), String(anchor.pos1 ?? ''), valence]
		);
		if (existing.rows.length > 0) {
			return existing.rows[0];
		}

		// The annotation is a naming
		const annNaming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, comment || `annotation: ${namingId} → ${documentId}`, userId]
		);
		const annId = annNaming.rows[0].id;

		// It participates with both the naming and the document
		for (const targetId of [namingId, documentId]) {
			const partNaming = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[projectId, `annotation ${annId} ↔ ${targetId}`, userId]
			);
			await client.query(
				`INSERT INTO participations (id, naming_id, participant_id)
				 VALUES ($1, $2, $3)`,
				[partNaming.rows[0].id, annId, targetId]
			);
		}

		// From the grounding workspace, the annotation appears as a directed relation.
		// annotationKind distinguishes 'code-naming' (CName, valence='codes') vs
		// 'sequence-naming' (SName, valence='thematizes') in the property bag, so
		// callers/queries can filter without joining on valence alone.
		const relProps = {
			anchorType,
			anchor,
			comment: comment || null,
			annotationKind,
			...extraProperties,
			...(provenance || {})
		};
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, 'relation', $3, $4, $5, $6)`,
			[annId, perspectiveId, namingId, documentId, valence, JSON.stringify(relProps)]
		);

		// Naming→Mapping-Bridge: NUR für valence='codes' (CNames).
		// SNames sind TOC-Einträge, keine SitMap-Knoten — sie überspringen die Bridge.
		if (valence === 'codes') {
			const primaryMap = await client.query(
				`SELECT n.id FROM namings n
				 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				   AND a.mode = 'perspective'
				   AND a.properties->>'mapType' = 'situational'
				   AND (a.properties->>'isPrimary')::boolean = true
				 LIMIT 1`,
				[projectId]
			);
			if (primaryMap.rows.length > 0) {
				const mapId = primaryMap.rows[0].id;
				await client.query(
					`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
					 VALUES ($1, $2, 'entity', '{}')
					 ON CONFLICT (naming_id, perspective_id) DO NOTHING`,
					[namingId, mapId]
				);
			}
		}

		// If comment provided, record a naming_act on the NAMING (not the annotation)
		// This makes the passage-specific note part of the naming's designation stack
		// Ein Memo zu einem Naming hebt es von cue auf characterization — im
		// selben Akt („MEMOS ADVANCEN EINE ENTITÄT VOM CUE ZUR CHARACTERIZATION",
		// BJ 09.11.2026; noteLiftsCue in namings.ts). Gelesen über den
		// Transaktions-Client: ein hier eben angelegtes Naming steht schon auf cue.
		if (comment && comment.trim()) {
			const byId = await getOrCreateResearcherNaming(projectId, userId);
			const cur = await client.query(
				`SELECT designation FROM naming_acts
				 WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
				[namingId]
			);
			const lift = !cur.rows[0] || cur.rows[0].designation === 'cue';
			await client.query(
				`INSERT INTO naming_acts (naming_id, by, memo_text, linked_naming_ids, designation)
				 VALUES ($1, $2, $3, $4, $5)`,
				[namingId, byId, comment.trim(), [annId], lift ? 'characterization' : null]
			);
		}

		return annNaming.rows[0];
	});
}

export async function getAnnotationsByDocument(projectId: string, documentId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as naming_id, a.directed_to as document_id,
			        a.properties, a.valence,
			        a.properties->>'annotationKind' as annotation_kind,
			        nm.inscription as naming_label,
			        -- Resolve color from ANY entity appearance (any map or grounding workspace)
			        (SELECT ca.properties->>'color'
			         FROM appearances ca
			         WHERE ca.naming_id = nm.id AND ca.mode = 'entity'
			           AND ca.properties->>'color' IS NOT NULL
			         LIMIT 1) as naming_color,
			        -- Passage-specific stack entry (naming_act on the naming referencing this annotation)
			        (SELECT na.memo_text
			         FROM naming_acts na
			         WHERE na.naming_id = nm.id
			           AND a.naming_id = ANY(na.linked_naming_ids)
			           AND na.memo_text IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as stack_memo
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings nm ON nm.id = a.directed_from
			 WHERE a.directed_to = $1 AND a.valence IN ('codes', 'thematizes')
			   AND n.project_id = $2
			 ORDER BY n.created_at`,
			[documentId, projectId]
		)
	).rows;
}

export async function getAnnotationsByNaming(projectId: string, namingId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as naming_id, a.directed_to as document_id,
			        a.properties, a.valence,
			        a.properties->>'annotationKind' as annotation_kind,
			        doc.inscription as document_label
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings doc ON doc.id = a.directed_to
			 WHERE a.directed_from = $1 AND a.valence IN ('codes', 'thematizes')
			   AND n.project_id = $2
			 ORDER BY n.created_at`,
			[namingId, projectId]
		)
	).rows;
}

export async function getAnnotationsByProject(projectId: string) {
	return (
		await query(
			`SELECT a.naming_id as id, a.directed_from as naming_id, a.directed_to as document_id,
			        a.properties, a.valence,
			        a.properties->>'annotationKind' as annotation_kind,
			        nm.inscription as naming_label,
			        doc.inscription as document_label,
			        (SELECT ca.properties->>'color'
			         FROM appearances ca
			         WHERE ca.naming_id = nm.id AND ca.mode = 'entity'
			           AND ca.properties->>'color' IS NOT NULL
			         LIMIT 1) as naming_color,
			        (SELECT na.memo_text
			         FROM naming_acts na
			         WHERE na.naming_id = nm.id
			           AND a.naming_id = ANY(na.linked_naming_ids)
			           AND na.memo_text IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as stack_memo
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
			 JOIN namings nm ON nm.id = a.directed_from
			 JOIN namings doc ON doc.id = a.directed_to AND doc.deleted_at IS NULL
			 WHERE a.valence IN ('codes', 'thematizes')
			   AND n.project_id = $1
			 ORDER BY doc.inscription, n.created_at`,
			[projectId]
		)
	).rows;
}

/**
 * Count how many annotations reference a given naming (excluding a specific annotation).
 */
export async function countNamingUsages(namingId: string, projectId: string, excludeAnnotationId?: string) {
	const result = await queryOne<{ count: string }>(
		`SELECT COUNT(*) as count
		 FROM appearances a
		 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
		 WHERE a.directed_from = $1 AND a.valence = 'codes'
		   AND n.project_id = $2
		   ${excludeAnnotationId ? `AND a.naming_id != $3` : ''}`,
		excludeAnnotationId ? [namingId, projectId, excludeAnnotationId] : [namingId, projectId]
	);
	return parseInt(result?.count || '0', 10);
}

/**
 * Add a memo to an existing annotation (naming_act on the naming, linked to the annotation).
 */
export async function addAnnotationMemo(
	projectId: string,
	userId: string,
	annotationId: string,
	namingId: string,
	memoText: string
) {
	const byId = await getOrCreateResearcherNaming(projectId, userId);
	// Memo zu einem Naming hebt cue auf characterization, im selben Akt.
	const cur = await queryOne<{ designation: string }>(
		`SELECT designation FROM naming_acts
		 WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
		[namingId]
	);
	const lift = !cur || cur.designation === 'cue';
	await query(
		`INSERT INTO naming_acts (naming_id, by, memo_text, linked_naming_ids, designation)
		 VALUES ($1, $2, $3, $4, $5)`,
		[namingId, byId, memoText.trim(), [annotationId], lift ? 'characterization' : null]
	);
}

/**
 * Blendet eine Passage aus oder wieder ein (`properties.hidden`).
 *
 * Kein Löschen: der Akt bleibt in der Datenstruktur, ausweisbar und rückholbar
 * (Invariante „jeder KI-Akt ist ausweisbar, rückholbar, ausblendbar"). Nur die
 * Sichtbarkeit im Reader ändert sich. Auf das Projekt gescopt, damit eine
 * fremde annotationId nicht ausblendbar ist.
 */
export async function setAnnotationHidden(
	projectId: string,
	annotationId: string,
	hidden: boolean
): Promise<boolean> {
	const res = await query(
		`UPDATE appearances a
		 SET properties = a.properties || $3::jsonb, updated_at = now()
		 FROM namings n
		 WHERE a.naming_id = $1 AND n.id = a.naming_id
		   AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[annotationId, projectId, JSON.stringify({ hidden })]
	);
	return (res.rowCount ?? 0) > 0;
}

/**
 * Delete an annotation. If the naming has no other usages, also delete the naming.
 * Returns { annotationDeleted: true, namingDeleted: boolean, namingLabel?: string }
 */
export async function deleteAnnotation(annotationId: string, projectId: string) {
	return transaction(async (client) => {
		// Find the naming this annotation references
		const ann = await client.query(
			`SELECT a.directed_from as naming_id, nm.inscription as naming_label
			 FROM appearances a
			 JOIN namings nm ON nm.id = a.directed_from
			 WHERE a.naming_id = $1 AND a.valence = 'codes'`,
			[annotationId]
		);
		const namingId = ann.rows[0]?.naming_id;
		const namingLabel = ann.rows[0]?.naming_label;

		// Soft-delete the annotation
		await client.query(
			`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
			[annotationId, projectId]
		);

		let namingDeleted = false;
		if (namingId) {
			// Count remaining usages of this naming
			const remaining = await client.query(
				`SELECT COUNT(*) as count
				 FROM appearances a
				 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
				 WHERE a.directed_from = $1 AND a.valence = 'codes'
				   AND n.project_id = $2`,
				[namingId, projectId]
			);
			if (parseInt(remaining.rows[0].count, 10) === 0) {
				// No more usages — also soft-delete the naming
				await client.query(
					`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
					[namingId, projectId]
				);
				namingDeleted = true;
			}
		}

		return { annotationDeleted: true, namingDeleted, namingLabel };
	});
}

/**
 * Cleanup-Operation: löscht alle Outputs *eines Naming-Runs an einem Dokument*.
 * Soft-löscht alle Annotationen (CName + SName), die per `properties.aiPersona
 * = 'coding-run'` markiert sind und auf das Dokument zeigen. Soft-löscht
 * Namings, die nach dieser Bereinigung keine aktive Annotation mehr haben.
 * Hard-löscht zugehörige `coding_runs`-Records.
 *
 * Von Hand angelegte Namings bleiben unangetastet (deren Annotationen tragen
 * keinen aiPersona-Marker). Documents bleiben unangetastet.
 *
 * Idempotent: zweimal aufrufen ist sicher.
 */
export async function deleteAllRunsForDocument(
	projectId: string,
	documentId: string
): Promise<{
	annotationsDeleted: number;
	namingsDeleted: number;
	runsDeleted: number;
}> {
	return transaction(async (client) => {
		// 1. Welche Annotationen wurden vom Naming-Run an diesem Dokument erzeugt?
		const aiAnns = await client.query<{ annotation_id: string; naming_id: string }>(
			`SELECT a.naming_id AS annotation_id, a.directed_from AS naming_id
			 FROM appearances a
			 JOIN namings ann ON ann.id = a.naming_id AND ann.deleted_at IS NULL
			 WHERE a.directed_to = $1
			   AND a.properties->>'aiPersona' = 'coding-run'
			   AND a.valence IN ('codes', 'thematizes')`,
			[documentId]
		);
		const annotationIds = aiAnns.rows.map((r) => r.annotation_id);
		const touchedNamingIds = [...new Set(aiAnns.rows.map((r) => r.naming_id))];

		// 2. Soft-delete der Annotationen.
		if (annotationIds.length > 0) {
			await client.query(
				`UPDATE namings
				 SET deleted_at = now()
				 WHERE id = ANY($1::uuid[])
				   AND project_id = $2
				   AND deleted_at IS NULL`,
				[annotationIds, projectId]
			);
		}

		// 3. Namings, die jetzt keine aktive Annotation mehr haben, soft-löschen.
		let namingsDeleted = 0;
		if (touchedNamingIds.length > 0) {
			const orphans = await client.query<{ id: string }>(
				`SELECT n.id
				 FROM namings n
				 WHERE n.id = ANY($1::uuid[])
				   AND n.project_id = $2
				   AND n.deleted_at IS NULL
				   AND NOT EXISTS (
				     SELECT 1
				     FROM appearances a
				     JOIN namings ann ON ann.id = a.naming_id AND ann.deleted_at IS NULL
				     WHERE a.directed_from = n.id
				       AND a.valence IN ('codes', 'thematizes')
				   )`,
				[touchedNamingIds, projectId]
			);
			if (orphans.rows.length > 0) {
				const orphanIds = orphans.rows.map((r) => r.id);
				await client.query(
					`UPDATE namings SET deleted_at = now()
					 WHERE id = ANY($1::uuid[]) AND project_id = $2`,
					[orphanIds, projectId]
				);
				namingsDeleted = orphanIds.length;
			}
		}

		// 4. Hard-delete der coding_runs-Records (Run-Historie für dieses Dokument).
		const runsDel = await client.query(
			`DELETE FROM coding_runs WHERE document_id = $1 AND project_id = $2`,
			[documentId, projectId]
		);

		return {
			annotationsDeleted: annotationIds.length,
			namingsDeleted,
			runsDeleted: runsDel.rowCount ?? 0
		};
	});
}

/**
 * Project-weite Variante: ruft `deleteAllRunsForDocument` für jedes
 * Dokument im Projekt auf. Documents bleiben unangetastet.
 */
export async function deleteAllRunsForProject(projectId: string): Promise<{
	documentsProcessed: number;
	annotationsDeleted: number;
	namingsDeleted: number;
	runsDeleted: number;
}> {
	const docs = await query<{ id: string }>(
		`SELECT DISTINCT n.id
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL`,
		[projectId]
	);
	let annotationsDeleted = 0;
	let namingsDeleted = 0;
	let runsDeleted = 0;
	for (const d of docs.rows) {
		const r = await deleteAllRunsForDocument(projectId, d.id);
		annotationsDeleted += r.annotationsDeleted;
		namingsDeleted += r.namingsDeleted;
		runsDeleted += r.runsDeleted;
	}
	return {
		documentsProcessed: docs.rows.length,
		annotationsDeleted,
		namingsDeleted,
		runsDeleted
	};
}
