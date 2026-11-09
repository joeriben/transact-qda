// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query, queryOne, transaction } from '../index.js';
import { createNaming, setAppearance, getOrCreateResearcherNaming, mergedIntoSql } from './namings.js';
import { namingLabel, type RelationEnds } from '$lib/shared/namingLabel.js';

// Was die Memo-Seite zeigt und die Projektübersicht zählt — eine Definition
// für beide (n = Naming, na = Akt; $1 = Projekt):
// Analytische Memos und Organisationsmemos sind eigene Memo-Namings mit
// Inhalt, ohne die Diskussionsbeiträge zu ihnen.
const ANALYTIC_MEMO_FILTER = `n.project_id = $1 AND n.deleted_at IS NULL
	AND n.inscription NOT LIKE 'MemoDiscussion:%'
	AND n.inscription NOT LIKE 'Discussion:%'`;
// Memos ZU einem Naming sind Akte einer Forscherin mit Memo-Text im Stack
// eines Namings dieses Projekts (keine KI-Begründungen) — auch eines
// Namings, das in ein anderes aufgenommen wurde (Merge): Sie stehen dann
// bei dem, in das es aufging.
const NAMING_MEMO_FILTER = `n.project_id = $1 AND (n.deleted_at IS NULL OR ${mergedIntoSql('n')} IS NOT NULL)
	AND na.memo_text IS NOT NULL AND btrim(na.memo_text) <> ''
	AND EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = na.by AND rn.user_id <> '00000000-0000-0000-0000-000000000000')`;

// Aktuelle Inschrift (letzter Inskriptions-Akt) eines Namings.
function currentInscriptionSql(alias: string): string {
	return `COALESCE((SELECT na_.inscription FROM naming_acts na_
	                   WHERE na_.naming_id = ${alias}.id AND na_.inscription IS NOT NULL
	                   ORDER BY na_.seq DESC LIMIT 1), ${alias}.inscription)`;
}

// Endpunkte, Valenz und Richtung, falls das Naming eine Relation ist (sonst
// NULL) — daraus macht namingLabel() den Titel einer unbenannten Relation.
function relationEndsSql(alias: string): string {
	return `(SELECT json_build_object('source', s_.inscription, 'target', t_.inscription,
	                                  'valence', ra_.valence,
	                                  'directed', ra_.directed_from IS NOT NULL AND ra_.directed_to IS NOT NULL)
	           FROM (SELECT 1) one_
	           LEFT JOIN LATERAL (SELECT a_.valence, a_.directed_from, a_.directed_to
	                                FROM appearances a_
	                               WHERE a_.naming_id = ${alias}.id AND a_.mode = 'relation'
	                               ORDER BY a_.created_at LIMIT 1) ra_ ON true
	           LEFT JOIN participations p_ ON p_.id = ${alias}.id
	           JOIN namings s_ ON s_.id = COALESCE(ra_.directed_from, p_.naming_id)
	                          AND s_.project_id = ${alias}.project_id
	           JOIN namings t_ ON t_.id = COALESCE(ra_.directed_to, p_.participant_id)
	                          AND t_.project_id = ${alias}.project_id
	          LIMIT 1)`;
}

// The "memo system" perspective — lazily created per project
async function getOrCreateMemoSystemPerspective(projectId: string, userId: string) {
	let perspective = await queryOne<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.project_id = $1 AND a.mode = 'perspective'
		   AND a.properties->>'role' = 'memo-system'
		   AND n.deleted_at IS NULL
		 LIMIT 1`,
		[projectId]
	);

	if (!perspective) {
		const n = await createNaming(projectId, userId, 'Memo System');
		await setAppearance(n.id, n.id, 'perspective', {
			properties: { role: 'memo-system' }
		});
		perspective = { id: n.id };
	}

	return perspective.id;
}

export async function createMemo(
	projectId: string,
	userId: string,
	label: string,
	content: string = '',
	linkedNamingIds: string[] = [],
	status: string = 'active'
) {
	return transaction(async (client) => {
		const perspectiveId = await getOrCreateMemoSystemPerspective(projectId, userId);

		// Create memo naming
		const memoRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const memo = memoRes.rows[0];

		// It appears as entity from the memo-system perspective
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $2, 'entity', '{}')`,
			[memo.id, perspectiveId]
		);

		// Store content
		await client.query(
			`INSERT INTO memo_content (naming_id, content, format, status) VALUES ($1, $2, 'html', $3)`,
			[memo.id, content, status]
		);

		// Create participations for links (skip invalid IDs gracefully)
		for (const targetId of linkedNamingIds) {
			// Verify target exists before creating participation
			const targetExists = await client.query(
				`SELECT 1 FROM namings WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
				[targetId]
			);
			if (targetExists.rows.length === 0) continue;

			const partNaming = await client.query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING id`,
				[projectId, `memo ${memo.id} ↔ ${targetId}`, userId]
			);
			await client.query(
				`INSERT INTO participations (id, naming_id, participant_id)
				 VALUES ($1, $2, $3)`,
				[partNaming.rows[0].id, memo.id, targetId]
			);
			// Appears as reference relation from memo perspective
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
				 VALUES ($1, $2, 'relation', $3, $4, 'references', '{}')`,
				[partNaming.rows[0].id, perspectiveId, memo.id, targetId]
			);
		}

		return memo;
	});
}

export async function getMemosByProject(projectId: string) {
	const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

	// Get all memos (excluding discussion entries)
	const memos = (
		await query(
			`SELECT n.id, n.inscription as label, n.created_at, n.created_by, mc.content, mc.format, mc.status
			 FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE ${ANALYTIC_MEMO_FILTER}
			 ORDER BY n.created_at DESC`,
			[projectId]
		)
	).rows;

	const memoIds = memos.map((m: any) => m.id);
	if (memoIds.length === 0) return [];

	// Get linked elements for all memos (element name + mode)
	const links = await query(
		`SELECT
			CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.naming_id ELSE p.participant_id END as memo_id,
			t.id as target_id,
			${currentInscriptionSql('t')} as target_inscription,
			${relationEndsSql('t')} as target_relation,
			COALESCE((SELECT a.mode FROM appearances a WHERE a.naming_id = t.id LIMIT 1), 'entity') as target_mode
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings t ON t.id = CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.participant_id ELSE p.naming_id END
		 WHERE (p.naming_id = ANY($1::uuid[]) OR p.participant_id = ANY($1::uuid[]))
		   AND t.deleted_at IS NULL AND NOT (t.id = ANY($1::uuid[]))
		   AND t.inscription NOT LIKE 'MemoDiscussion:%'
		   AND t.inscription NOT LIKE 'Discussion:%'
		   AND NOT EXISTS (SELECT 1 FROM memo_content mc2 WHERE mc2.naming_id = t.id)`,
		[memoIds]
	);
	const linkMap = new Map<string, any[]>();
	for (const row of links.rows) {
		if (!linkMap.has(row.memo_id)) linkMap.set(row.memo_id, []);
		linkMap.get(row.memo_id)!.push({
			id: row.target_id,
			label: namingLabel(row.target_inscription, row.target_relation as RelationEnds | null),
			mode: row.target_mode
		});
	}

	// Get discussion threads for all memos
	const discRows = await query(
		`SELECT DISTINCT d.id, d.inscription as label, dc.content, d.created_at, d.created_by,
		        CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.naming_id ELSE p.participant_id END as parent_memo_id
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings d ON d.id = CASE WHEN p.naming_id = ANY($1::uuid[]) THEN p.participant_id ELSE p.naming_id END
		 JOIN memo_content dc ON dc.naming_id = d.id
		 WHERE (p.naming_id = ANY($1::uuid[]) OR p.participant_id = ANY($1::uuid[]))
		   AND d.deleted_at IS NULL
		   AND NOT (d.id = ANY($1::uuid[]))
		   AND d.inscription LIKE 'MemoDiscussion:%'
		 ORDER BY d.created_at ASC`,
		[memoIds]
	);
	const discMap = new Map<string, any[]>();
	for (const row of discRows.rows) {
		const parentId = row.parent_memo_id;
		if (!discMap.has(parentId)) discMap.set(parentId, []);
		discMap.get(parentId)!.push({
			id: row.id,
			role: row.created_by === AI_SYSTEM_UUID ? 'ai' as const : 'researcher' as const,
			type: row.label?.includes(': researcher') ? 'researcher'
				: row.label?.includes(': revise') ? 'revise'
				: 'response',
			content: row.content,
			created_at: row.created_at,
		});
	}

	return memos.map((m: any) => ({
		id: m.id,
		label: m.label,
		content: m.content,
		format: m.format,
		status: m.status || 'active',
		created_at: m.created_at,
		created_by: m.created_by,
		isAiAuthored: m.created_by === AI_SYSTEM_UUID,
		links: linkMap.get(m.id) || [],
		discussion: discMap.get(m.id) || [],
	}));
}

export type NamingMemo = {
	naming_id: string;
	seq: string;
	created_at: string;
	memo_text: string;
	/** Titel des Namings; bei einer unbenannten Relation „Quelle —valenz→ Ziel". */
	naming_label: string;
	/** Das Memo stand im Stack eines Namings, das in dieses aufgenommen wurde. */
	merged_from: string | null;
	by_label: string;
	/** Das Memo gilt einer Passage dieses Namings (Dokumentansicht). */
	passage_document: string | null;
	linked: { id: string; label: string }[];
	/** Welchen Akt das Memo begründet: Umbenennung (von …) und/oder Designation (alt → neu); null = reines Memo. */
	act: string | null;
};

// Memos ZU einem Naming sind Akte in dessen Stack (noteOnNaming), keine
// eigenen Namings. Die Memo-Seite zeigt sie neben den analytischen Memos.
export async function getNamingMemosByProject(projectId: string): Promise<NamingMemo[]> {
	const rows = (
		await query<{
			naming_id: string;
			seq: string;
			created_at: string;
			memo_text: string;
			merged_from: string | null;
			act_inscription: string | null;
			act_designation: string | null;
			prev_inscription: string | null;
			prev_designation: string | null;
			naming_inscription: string | null;
			naming_relation: RelationEnds | null;
			by_label: string;
			passage_document: string | null;
			linked: { id: string; inscription: string | null; relation: RelationEnds | null }[];
		}>(
			`SELECT h.id AS naming_id, na.seq, na.created_at, na.memo_text,
			        CASE WHEN h.id <> n.id THEN ${currentInscriptionSql('n')} END AS merged_from,
			        na.inscription AS act_inscription, na.designation AS act_designation,
			        (SELECT p.inscription FROM naming_acts p
			          WHERE p.naming_id = na.naming_id AND p.seq < na.seq AND p.inscription IS NOT NULL
			          ORDER BY p.seq DESC LIMIT 1) AS prev_inscription,
			        (SELECT p.designation FROM naming_acts p
			          WHERE p.naming_id = na.naming_id AND p.seq < na.seq AND p.designation IS NOT NULL
			          ORDER BY p.seq DESC LIMIT 1) AS prev_designation,
			        ${currentInscriptionSql('h')} AS naming_inscription,
			        ${relationEndsSql('h')} AS naming_relation,
			        b.inscription AS by_label,
			        (SELECT doc.inscription
			           FROM appearances pa
			           JOIN namings doc ON doc.id = pa.directed_to AND doc.project_id = $1
			          WHERE pa.naming_id = ANY(na.linked_naming_ids)
			            AND pa.directed_from = na.naming_id
			            AND pa.valence IN ('codes', 'thematizes')
			          LIMIT 1) AS passage_document,
			        COALESCE((SELECT json_agg(json_build_object('id', l.id,
			                                                    'inscription', ${currentInscriptionSql('l')},
			                                                    'relation', ${relationEndsSql('l')})
			                                  ORDER BY l.inscription)
			                    FROM namings l
			                   -- ein aufgenommenes Naming: das, in das es aufging
			                   WHERE l.id IN (SELECT COALESCE(${mergedIntoSql('l0')}, l0.id)
			                                    FROM namings l0 WHERE l0.id = ANY(na.linked_naming_ids))
			                     AND l.id <> h.id
			                     AND l.deleted_at IS NULL
			                     AND l.project_id = $1
			                     AND NOT EXISTS (SELECT 1 FROM appearances pa
			                                      WHERE pa.naming_id = l.id AND pa.directed_from = na.naming_id
			                                        AND pa.valence IN ('codes', 'thematizes'))),
			                 '[]'::json) AS linked
			   FROM naming_acts na
			   JOIN namings n ON n.id = na.naming_id
			   JOIN namings h ON h.id = COALESCE(${mergedIntoSql('n')}, n.id)
			   JOIN namings b ON b.id = na.by
			  WHERE ${NAMING_MEMO_FILTER}
			  ORDER BY na.created_at DESC, na.seq DESC`,
			[projectId]
		)
	).rows;

	return rows.map((r) => ({
		naming_id: r.naming_id,
		seq: r.seq,
		created_at: r.created_at,
		memo_text: r.memo_text,
		naming_label: namingLabel(r.naming_inscription, r.naming_relation),
		merged_from: r.merged_from,
		by_label: r.by_label,
		passage_document: r.passage_document,
		linked: (r.linked ?? []).map((l) => ({ id: l.id, label: namingLabel(l.inscription, l.relation) })),
		act: describeAct(r)
	}));
}

/** „renamed from “X”" und/oder „cue → characterization" — was der Akt setzt, zu dem das Memo gehört. */
function describeAct(r: {
	act_inscription: string | null;
	act_designation: string | null;
	prev_inscription: string | null;
	prev_designation: string | null;
}): string | null {
	const parts: string[] = [];
	if (r.act_inscription && r.prev_inscription && r.act_inscription !== r.prev_inscription) {
		parts.push(`renamed from “${r.prev_inscription}”`);
	}
	if (r.act_designation && r.act_designation !== r.prev_designation) {
		parts.push(r.prev_designation ? `${r.prev_designation} → ${r.act_designation}` : r.act_designation);
	}
	return parts.length > 0 ? parts.join(' · ') : null;
}

/** So viele Memos, wie die Memo-Seite zeigt: analytische und Memos zu Namings. */
export async function countProjectMemos(projectId: string): Promise<number> {
	const row = await queryOne<{ analytic: string; on_namings: string }>(
		`SELECT (SELECT COUNT(*) FROM namings n JOIN memo_content mc ON mc.naming_id = n.id
		          WHERE ${ANALYTIC_MEMO_FILTER}) AS analytic,
		        (SELECT COUNT(*) FROM naming_acts na JOIN namings n ON n.id = na.naming_id
		          WHERE ${NAMING_MEMO_FILTER}) AS on_namings`,
		[projectId]
	);
	return parseInt(row?.analytic || '0') + parseInt(row?.on_namings || '0');
}

export async function updateMemoStatus(memoId: string, status: string) {
	await query(
		`UPDATE memo_content SET status = $1 WHERE naming_id = $2`,
		[status, memoId]
	);
}

/**
 * Ein Memo dezidiert zu einem Naming machen (Session 16: „solange man sie nicht
 * dezidiert zu einem Naming macht"): legt das Naming an,
 * verknüpft es mit dem Memo und setzt den Status auf promoted — auf der Map
 * (mit Platzierung) wie auf der Memo-Seite (mapId = null, ohne Platzierung).
 * Ein schon beförderter Memo wird nicht ein zweites Mal Naming.
 */
export async function promoteMemoToNaming(
	projectId: string,
	userId: string,
	memoId: string,
	mapId: string | null
) {
	return transaction(async (client) => {
		// Get memo content
		const memo = await client.query(
			`SELECT n.inscription, mc.content, mc.status,
			        n.created_by = '00000000-0000-0000-0000-000000000000' AS is_ai
			   FROM namings n
			 JOIN memo_content mc ON mc.naming_id = n.id
			 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
			[memoId, projectId]
		);
		if (memo.rows.length === 0) throw new Error('Memo not found');
		if (memo.rows[0].status === 'promoted') throw new Error('This memo has already been made a naming.');

		// Das Naming gehört der Forscherin, die es macht: Der Autor-Präfix eines
		// KI-Memos („Cowork: …") gehört nicht in seinen Namen (Testlauf 09.11.:
		// der Coach schrieb das übernommene Naming danach Cowork zu).
		const raw = String(memo.rows[0].inscription ?? '').trim();
		const name = (memo.rows[0].is_ai ? raw.replace(/^[\p{L}-]+:\s+/u, '') : raw) || raw;
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, name, userId]
		);
		const naming = namingRes.rows[0];

		// Place it on the map as entity (von der Memo-Seite aus: keine Map)
		if (mapId) {
			await client.query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $2, 'entity', '{}')`,
				[naming.id, mapId]
			);
		}

		// Erster Akt: Inschrift als Cue, mit Verweis auf das Memo, aus dem das
		// Naming hervorgeht — der Stack sagt, woher es kommt.
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, inscription, designation, linked_naming_ids)
			 VALUES ($1, $2, $3, 'cue', $4)`,
			[naming.id, researcherNamingId, name, [memoId]]
		);

		// Link the original memo to the new naming via participation
		const partRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, `promoted memo ${memoId} → ${naming.id}`, userId]
		);
		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partRes.rows[0].id, memoId, naming.id]
		);

		// Update memo status to 'promoted'
		await client.query(
			`UPDATE memo_content SET status = 'promoted' WHERE naming_id = $1`,
			[memoId]
		);

		return naming;
	});
}

export async function getMemo(memoId: string, projectId: string) {
	const memo = await queryOne<{
		id: string;
		label: string;
		created_at: string;
		content: string;
		format: string;
		is_ai: boolean;
		status: string | null;
	}>(
		`SELECT n.id, n.inscription as label, n.created_at,
		        mc.content, mc.format,
		        n.created_by = '00000000-0000-0000-0000-000000000000' AS is_ai,
		        mc.status
		 FROM namings n
		 JOIN memo_content mc ON mc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[memoId, projectId]
	);
	if (!memo) return null;

	// Get linked namings (via participations) — eine Zeile je Verweis
	const links = await query<{
		id: string;
		target_id: string;
		target_inscription: string | null;
		target_relation: RelationEnds | null;
		target_mode: string;
	}>(
		`SELECT p.id, t.id as target_id,
		        ${currentInscriptionSql('t')} as target_inscription,
		        ${relationEndsSql('t')} as target_relation,
		        COALESCE((SELECT a.mode FROM appearances a WHERE a.naming_id = t.id
		                  ORDER BY (a.mode = 'perspective') LIMIT 1), 'entity') as target_mode
		 FROM participations p
		 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
		 JOIN namings t ON t.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
		 WHERE (p.naming_id = $1 OR p.participant_id = $1)
		   AND t.deleted_at IS NULL AND t.id != $1 AND t.project_id = $2`,
		[memoId, projectId]
	);

	return {
		...memo,
		links: links.rows.map((r) => ({
			id: r.id,
			target_id: r.target_id,
			target_label: namingLabel(r.target_inscription, r.target_relation),
			target_mode: r.target_mode
		}))
	};
}

export async function getMemosForNaming(namingId: string, projectId: string) {
	return (
		await query(
			`SELECT DISTINCT m.id, m.inscription as label, mc.content, m.created_at
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings m ON m.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
			 JOIN memo_content mc ON mc.naming_id = m.id
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			   AND m.project_id = $2
			   AND m.deleted_at IS NULL
			   AND m.id != $1
			 ORDER BY m.created_at DESC`,
			[namingId, projectId]
		)
	).rows;
}

export async function updateMemoContent(memoId: string, content: string) {
	await query(
		`UPDATE memo_content SET content = $1 WHERE naming_id = $2`,
		[content, memoId]
	);
}
