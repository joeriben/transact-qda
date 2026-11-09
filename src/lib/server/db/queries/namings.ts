// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query, queryOne, transaction } from '../index.js';
import type { CollapseMode } from '$lib/shared/types/index.js';
import { createMemo } from './memos.js';

/**
 * Der Merge-Akt (mergeNamings): Er setzt nichts und verweist nur auf das
 * aufgenommene Naming. Kein anderer Pfad schreibt einen solchen Akt.
 */
export function mergeActSql(a: string): string {
	return `(${a}.memo_text IS NULL AND ${a}.inscription IS NULL AND ${a}.designation IS NULL
	         AND ${a}.mode IS NULL AND ${a}.valence IS NULL AND cardinality(${a}.linked_naming_ids) > 0)`;
}

/** Das Naming, in das ein (soft-gelöschtes) Naming aufgenommen wurde, sonst NULL. */
export function mergedIntoSql(alias: string): string {
	return `(SELECT mi_.naming_id FROM naming_acts mi_
	           JOIN namings ms_ ON ms_.id = mi_.naming_id AND ms_.deleted_at IS NULL
	          WHERE ${alias}.deleted_at IS NOT NULL AND ${alias}.id = ANY(mi_.linked_naming_ids)
	            AND ${mergeActSql('mi_')}
	          ORDER BY mi_.seq DESC LIMIT 1)`;
}

// ---- Researcher-naming: the user as naming in the data space ----

export async function getOrCreateResearcherNaming(
	projectId: string,
	userId: string
): Promise<string> {
	// Check if researcher-naming already exists
	const existing = await queryOne<{ naming_id: string }>(
		`SELECT naming_id FROM researcher_namings WHERE user_id = $1 AND project_id = $2`,
		[userId, projectId]
	);
	if (existing) return existing.naming_id;

	// Create researcher-naming in a transaction
	return transaction(async (client) => {
		// Get user display name for the inscription
		const user = await client.query(
			`SELECT display_name, username FROM users WHERE id = $1`,
			[userId]
		);
		const name = user.rows[0]?.display_name || user.rows[0]?.username || 'unknown';

		// Create the naming
		const naming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, name, userId]
		);
		const namingId = naming.rows[0].id;

		// Self-referential appearance: the researcher appears as perspective from itself
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', '{"role": "researcher"}')`,
			[namingId]
		);

		// Register the link
		await client.query(
			`INSERT INTO researcher_namings (user_id, project_id, naming_id)
			 VALUES ($1, $2, $3)`,
			[userId, projectId, namingId]
		);

		// Initial act: the researcher characterizes itself
		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'characterization', $1)`,
			[namingId]
		);

		return namingId;
	});
}

// ---- Notiz zu einem Akt ----
// Ein Naming IST sein Stack: Umschreiben und Designieren sind Akte in der
// Geschichte derselben, nicht-identischen Entität. Was die Forscherin dazu
// notiert und worauf sie dabei verweist, steht in diesem Akt
// (naming_acts.memo_text / linked_naming_ids, Migration 009) — nicht in einem
// eigenen Memo-Naming mit Verknüpfungs-Naming daneben.
export interface ActNote {
	text?: string | null;
	linkedNamingIds?: string[] | null;
}
function noteText(note: ActNote): string | null {
	const t = note.text?.trim();
	return t ? t : null;
}
function noteLinks(note: ActNote): string[] | null {
	const ids = (note.linkedNamingIds ?? []).filter((id) => typeof id === 'string' && id);
	return ids.length > 0 ? ids : null;
}

/** Ein Naming gilt als zurückgezogen, wenn ALLE seine Erscheinungen unter
 *  Perspektiven zurückgezogen sind; hat es keine, entscheidet die eigene. */
export function WITHDRAWN_SQL(alias: string): string {
	const flag = (a: string) =>
		`(COALESCE((${a}.properties->>'withdrawn')::boolean, false) OR COALESCE((${a}.properties->>'aiWithdrawn')::boolean, false))`;
	return `(CASE WHEN EXISTS (SELECT 1 FROM appearances wa WHERE wa.naming_id = ${alias}.id AND wa.perspective_id <> ${alias}.id)
	              THEN NOT EXISTS (SELECT 1 FROM appearances wa WHERE wa.naming_id = ${alias}.id AND wa.perspective_id <> ${alias}.id AND NOT ${flag('wa')})
	              ELSE EXISTS (SELECT 1 FROM appearances wa WHERE wa.naming_id = ${alias}.id AND wa.perspective_id = ${alias}.id AND ${flag('wa')})
	         END)`;
}

/** Nur Namings dieses Projekts dürfen als Verweis in einen Akt. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function scopeNamingIds(ids: unknown, projectId: string): Promise<string[]> {
	if (!Array.isArray(ids) || ids.length === 0) return [];
	const r = await query<{ id: string }>(
		`SELECT id FROM namings
		 WHERE id = ANY($1::uuid[]) AND project_id = $2 AND deleted_at IS NULL`,
		[ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)), projectId]
	);
	return r.rows.map((row) => row.id);
}

// ---- Core naming operations ----

export async function createNaming(
	projectId: string,
	userId: string,
	inscription: string
) {
	// Ensure researcher-naming exists (first act creates it)
	const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

	const res = await queryOne<{ id: string; inscription: string; created_at: string; seq: string }>(
		`INSERT INTO namings (project_id, inscription, created_by)
		 VALUES ($1, $2, $3) RETURNING *`,
		[projectId, inscription, userId]
	);
	const naming = res!;

	// Initial act: inscription + designation in one stack entry
	await query(
		`INSERT INTO naming_acts (naming_id, by, inscription, designation)
		 VALUES ($1, $2, $3, 'characterization')`,
		[naming.id, researcherNamingId, inscription]
	);

	return naming;
}

/**
 * Ein Naming umschreiben — der Akt tritt in die Designations-Kette ein.
 *
 * Nur für Namings, die etwas AM MATERIAL auszeichnen: Cues aus dem Lauf,
 * in-vivo-Namings, Sequenz-Titel. NICHT für Dokumente: deren Anzeigename ist
 * ein Behälteretikett, kein Zuschreiben, und gehört nicht in den Gradienten
 * (siehe api/projects/[projectId]/documents/[docId]/+server.ts).
 */
export async function renameNaming(
	namingId: string,
	projectId: string,
	userId: string,
	inscription: string,
	note: ActNote = {}
) {
	const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
	// Umschreiben MIT Notiz ist ein reflektierter Akt: auf einem Cue trägt er
	// die Characterization (siehe noteLiftsCue). Ohne Notiz bleibt die
	// Designation, wie sie ist.
	const lift = noteText(note) ? await noteLiftsCue(namingId) : false;

	return transaction(async (client) => {
		// Was bisher dastand, festhalten, BEVOR es überschrieben wird. Namings aus
		// Naming-Run und in-vivo entstehen ohne Inskriptions-Akt (nur Designation);
		// ohne diesen Nachtrag ginge beim Umschreiben verloren, was umgeschrieben
		// wurde — die Kette begänne mit der neuen Lesart. Der Nachtrag geht dem
		// Umschreib-Akt in der seq voraus, trägt aber das Datum der Entstehung.
		const prior = await client.query(
			`SELECT 1 FROM naming_acts WHERE naming_id = $1 AND inscription IS NOT NULL LIMIT 1`,
			[namingId]
		);
		if (prior.rowCount === 0) {
			const cur = await client.query(
				`SELECT inscription, created_at FROM namings
				 WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
				[namingId, projectId]
			);
			const origin = await client.query(
				`SELECT by FROM naming_acts WHERE naming_id = $1 ORDER BY seq ASC LIMIT 1`,
				[namingId]
			);
			if (cur.rows[0]?.inscription && cur.rows[0].inscription !== inscription) {
				await client.query(
					`INSERT INTO naming_acts (naming_id, by, inscription, created_at)
					 VALUES ($1, $2, $3, $4)`,
					[
						namingId,
						origin.rows[0]?.by ?? researcherNamingId,
						cur.rows[0].inscription,
						cur.rows[0].created_at
					]
				);
			}
		}

		// Update current inscription
		const result = await client.query(
			`UPDATE namings SET inscription = $1
			 WHERE id = $2 AND project_id = $3 AND deleted_at IS NULL
			 RETURNING *`,
			[inscription, namingId, projectId]
		);

		// Record in stack — die Notiz zum Umschreiben gehört in denselben Akt.
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, inscription, memo_text, linked_naming_ids, designation)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[namingId, researcherNamingId, inscription, noteText(note), noteLinks(note), lift ? 'characterization' : null]
		);

		return result.rows[0];
	});
}

export async function getInscriptionHistory(namingId: string) {
	return (
		await query(
			`SELECT na.seq, na.inscription, na.created_at, n.inscription as by_inscription
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.by
			 WHERE na.naming_id = $1 AND na.inscription IS NOT NULL
			 ORDER BY na.seq ASC`,
			[namingId]
		)
	).rows;
}

export async function softDelete(namingId: string, projectId: string) {
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
		[namingId, projectId]
	);
}

export async function getNaming(namingId: string, projectId: string) {
	return queryOne(
		`SELECT * FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[namingId, projectId]
	);
}

/** Der Vermerk im Stack eines als technischer Fehler ausgeblendeten Eintrags. */
export const TECHNICAL_ERROR_NOTE = 'Als technischer Fehler markiert und ausgeblendet.';

/**
 * Einen Eintrag als technischen Fehler markieren und dauerhaft ausblenden.
 *
 * BJ, 09.11.2026: „füge eine Möglichkeit hinzu technische Fehler zu beheben";
 * „markieren als techn. Fehler und permanent ausblenden reicht auch, sollte
 * Datenintegrität ein Problem sein für Löschfunktionen". Gemeint sind
 * Einträge, die ein Fehler der Software erzeugt hat (etwa doppelte Memos aus
 * dem kaputten Memo-Formular), keine analytische Entscheidung; die ist
 * Withdraw und bleibt sichtbar.
 *
 * Gelöscht wird nichts. Das Naming bekommt einen Akt mit dem Vermerk in
 * seinen Stack; es selbst und die Participation-Namings, an denen es
 * beteiligt ist (Verknüpfungen eines Memos, Relationen), bekommen deleted_at
 * und verschwinden damit aus allen Ansichten. Zurückholen lässt es sich nur
 * in der Datenbank (deleted_at = NULL).
 */
export async function markTechnicalError(
	namingId: string,
	projectId: string,
	userId: string
): Promise<{ hidden: number }> {
	const by = await getOrCreateResearcherNaming(projectId, userId);
	return transaction(async (client) => {
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, memo_text) VALUES ($1, $2, $3)`,
			[namingId, by, TECHNICAL_ERROR_NOTE]
		);
		const res = await client.query(
			`UPDATE namings SET deleted_at = now()
			  WHERE project_id = $2 AND deleted_at IS NULL
			    AND (id = $1 OR id IN (
			      SELECT p.id FROM participations p
			       WHERE p.naming_id = $1 OR p.participant_id = $1))
			  RETURNING id`,
			[namingId, projectId]
		);
		return { hidden: res.rowCount ?? 0 };
	});
}

export async function getNamingsByProject(projectId: string) {
	return (
		await query(
			`SELECT * FROM namings WHERE project_id = $1 AND deleted_at IS NULL ORDER BY seq`,
			[projectId]
		)
	).rows;
}

// ---- Participation operations ----

export async function createParticipation(
	projectId: string,
	userId: string,
	namingId: string,
	participantId: string,
	inscription?: string
) {
	return transaction(async (client) => {
		// A participation IS a naming
		const partNaming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING id`,
			[projectId, inscription || `${namingId} ↔ ${participantId}`, userId]
		);
		const partId = partNaming.rows[0].id;

		await client.query(
			`INSERT INTO participations (id, naming_id, participant_id)
			 VALUES ($1, $2, $3)`,
			[partId, namingId, participantId]
		);

		return { id: partId, namingId, participantId };
	});
}

export async function getParticipations(namingId: string) {
	return (
		await query(
			`SELECT p.*, n.inscription as participant_inscription
			 FROM participations p
			 JOIN namings n ON n.id = p.participant_id
			 WHERE p.naming_id = $1 AND n.deleted_at IS NULL
			 UNION
			 SELECT p.*, n.inscription as participant_inscription
			 FROM participations p
			 JOIN namings n ON n.id = p.naming_id
			 WHERE p.participant_id = $1 AND n.deleted_at IS NULL`,
			[namingId]
		)
	).rows;
}

export async function removeParticipation(participationId: string, projectId: string) {
	// Soft-delete the participation naming
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
		[participationId, projectId]
	);
}

// ---- Appearance operations ----

export async function setAppearance(
	namingId: string,
	perspectiveId: string,
	mode: CollapseMode,
	opts?: {
		directedFrom?: string;
		directedTo?: string;
		valence?: string;
		properties?: Record<string, unknown>;
	}
) {
	return queryOne(
		`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (naming_id, perspective_id)
		 DO UPDATE SET
		   mode = $3,
		   directed_from = $4,
		   directed_to = $5,
		   valence = COALESCE($6, appearances.valence),
		   properties = appearances.properties || $7::jsonb,
		   updated_at = now()
		 RETURNING *`,
		[
			namingId,
			perspectiveId,
			mode,
			opts?.directedFrom || null,
			opts?.directedTo || null,
			opts?.valence || null,
			JSON.stringify(opts?.properties || {})
		]
	);
}

export async function getAppearance(namingId: string, perspectiveId: string) {
	return queryOne(
		`SELECT * FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, perspectiveId]
	);
}

export async function getAppearances(namingId: string) {
	return (
		await query(
			`SELECT a.*, p.inscription as perspective_inscription
			 FROM appearances a
			 JOIN namings p ON p.id = a.perspective_id
			 WHERE a.naming_id = $1`,
			[namingId]
		)
	).rows;
}

export async function getAppearancesInPerspective(perspectiveId: string, opts?: { mode?: CollapseMode }) {
	const conditions = ['a.perspective_id = $1', 'n.deleted_at IS NULL'];
	const params: unknown[] = [perspectiveId];

	if (opts?.mode) {
		conditions.push(`a.mode = $2`);
		params.push(opts.mode);
	}

	return (
		await query(
			`SELECT a.*, n.inscription, n.created_at as naming_created_at, n.seq
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE ${conditions.join(' AND ')}
			 ORDER BY n.seq`,
			params
		)
	).rows;
}

export async function removeAppearance(namingId: string, perspectiveId: string) {
	await query(
		`DELETE FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, perspectiveId]
	);
}

// ---- Convenience: create naming + appearance in one transaction ----

export async function createNamedAppearance(
	projectId: string,
	userId: string,
	inscription: string,
	perspectiveId: string,
	mode: CollapseMode,
	opts?: {
		directedFrom?: string;
		directedTo?: string;
		valence?: string;
		properties?: Record<string, unknown>;
	}
) {
	return transaction(async (client) => {
		const namingRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, inscription, userId]
		);
		const naming = namingRes.rows[0];

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				naming.id,
				perspectiveId,
				mode,
				opts?.directedFrom || null,
				opts?.directedTo || null,
				opts?.valence || null,
				JSON.stringify(opts?.properties || {})
			]
		);

		return naming;
	});
}

// ---- Designation operations (append-only) ----

export async function designate(
	namingId: string,
	designation: 'cue' | 'characterization' | 'specification',
	byNamingId: string,
	note: ActNote = {}
) {
	return queryOne(
		`INSERT INTO naming_acts (naming_id, designation, by, memo_text, linked_naming_ids)
		 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
		[namingId, designation, byNamingId, noteText(note), noteLinks(note)]
	);
}

/**
 * Hebt eine Notiz der Forscherin dieses Naming von cue auf characterization?
 *
 * „ein reflected cue ist mindestens eine characeriztation" (BJ, Session 08,
 * 11.03.2026); „MEMOS ADVANCEN EINE ENTITÄT VOM CUE ZUR CHARACTERIZATION"
 * (BJ, 09.11.2026). Das gilt auch für Silences: „ob der Cue kletter als
 * Silence, wieso nicht, wenn Human die Slience grounded erhärten und
 * spezifizieren kann. Keine technische Sonderregel hier." (BJ, 03.07.2026).
 * Die einzige Schranke ist die allgemeine: Hier schreiben nur Forschende,
 * KI-Pfade schreiben Cues.
 */
export async function noteLiftsCue(namingId: string): Promise<boolean> {
	const r = await queryOne<{ designation: string | null }>(
		`SELECT (SELECT na.designation FROM naming_acts na
		         WHERE na.naming_id = $1 AND na.designation IS NOT NULL
		         ORDER BY na.seq DESC LIMIT 1) AS designation`,
		[namingId]
	);
	if (!r) return false;
	return r.designation === null || r.designation === 'cue';
}

/**
 * Memo zu einem Naming = ein Akt in seinem Stack.
 *
 * Ein Memo ZU einem Naming ist dessen Description — „a description may be
 * called an expanding naming" (Dewey/Bentley) — und gehört in seinen Stack
 * (Session 16, 16.03.2026: Vorschlag des Assistenten „zwei Modi", von BJ
 * mit „Ja, zwei Modi" bestätigt; BJs eigener Satz dort: Memos sind „dann doch
 * kein Naming, solange man sie nicht dezidiert zu einem Naming macht"; er
 * ergänzte die Organisationsmemos als dritte Art. 09.11.2026: „Wenn ich ZU
 * einem Naming ein MEMO anlege, dann kann das ja wohl logischerweise kein
 * EIGENES NAMING sein"). Es entsteht also kein Memo-Naming und kein
 * Verknüpfungs-Naming: der Akt trägt den Text (memo_text) und die Namings,
 * die man beim Schreiben im Sinn hat (linked_naming_ids; Session 05, BJs
 * Vorschlag für die Beschriftung: „Namings I have in mind writing this
 * memo"). Steht das Naming auf cue, trägt derselbe Akt die Characterization
 * (noteLiftsCue).
 *
 * Analytische Memos über Konstellationen und Organisationsmemos sind etwas
 * anderes (Inquiry-Medium, eigener Lebenszyklus) und laufen über memos.ts.
 * Nur Forschende schreiben hier — KI-Pfade schreiben nur Cues.
 */
export async function noteOnNaming(
	namingId: string,
	projectId: string,
	userId: string,
	note: ActNote
) {
	const text = noteText(note);
	if (!text) throw new Error('note text required');
	const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
	const lift = await noteLiftsCue(namingId);
	const links = noteLinks({ linkedNamingIds: (note.linkedNamingIds ?? []).filter((id) => id !== namingId) });
	return queryOne(
		`INSERT INTO naming_acts (naming_id, by, memo_text, linked_naming_ids, designation)
		 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
		[namingId, researcherNamingId, text, links, lift ? 'characterization' : null]
	);
}

export async function getCurrentDesignation(namingId: string) {
	return queryOne<{ designation: string; by: string; created_at: string }>(
		`SELECT designation, by, created_at FROM naming_acts
		 WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
		[namingId]
	);
}

export async function getDesignationHistory(namingId: string) {
	return (
		await query(
			`SELECT na.seq, na.designation, na.created_at, n.inscription as by_inscription
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.by
			 WHERE na.naming_id = $1 AND na.designation IS NOT NULL
			 ORDER BY na.seq ASC`,
			[namingId]
		)
	).rows;
}

// ---- Aggregated view: everything known about a single naming ----

export async function getAggregatedNaming(namingId: string, projectId: string) {
	const { getNamingStack } = await import('./maps.js');

	const [naming, stack, appearances, participations] = await Promise.all([
		queryOne<{
			id: string; inscription: string; created_at: string; seq: string; created_by: string;
		}>(
			`SELECT id, inscription, created_at, seq, created_by FROM namings
			 WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
			[namingId, projectId]
		),
		getNamingStack(namingId, projectId),
		// All map perspectives this naming appears on (excluding self-refs and infrastructure)
		query<{
			perspective_id: string; perspective_label: string; map_type: string;
			mode: string; valence: string | null; properties: Record<string, any>;
			directed_from: string | null; directed_to: string | null;
			phase_id: string | null; phase_label: string | null;
		}>(
			`SELECT a.perspective_id, m.inscription as perspective_label,
			        ma.properties->>'mapType' as map_type,
			        a.mode, a.valence, a.properties,
			        a.directed_from, a.directed_to,
			        -- Phase membership (if any)
			        (SELECT ch.naming_id FROM phase_memberships ch
			         JOIN appearances cha ON cha.naming_id = ch.phase_id AND cha.perspective_id = a.perspective_id
			         WHERE ch.naming_id = $1 AND ch.action = 'assign'
			           AND NOT EXISTS (SELECT 1 FROM phase_memberships ch2
			             WHERE ch2.phase_id = ch.phase_id AND ch2.naming_id = ch.naming_id
			               AND ch2.action = 'remove' AND ch2.seq > ch.seq)
			         ORDER BY ch.seq DESC LIMIT 1) as phase_id,
			        (SELECT chn.inscription FROM phase_memberships ch
			         JOIN namings chn ON chn.id = ch.phase_id
			         JOIN appearances cha ON cha.naming_id = ch.phase_id AND cha.perspective_id = a.perspective_id
			         WHERE ch.naming_id = $1 AND ch.action = 'assign'
			           AND NOT EXISTS (SELECT 1 FROM phase_memberships ch2
			             WHERE ch2.phase_id = ch.phase_id AND ch2.naming_id = ch.naming_id
			               AND ch2.action = 'remove' AND ch2.seq > ch.seq)
			         ORDER BY ch.seq DESC LIMIT 1) as phase_label
			 FROM appearances a
			 JOIN namings m ON m.id = a.perspective_id AND m.deleted_at IS NULL
			 JOIN appearances ma ON ma.naming_id = m.id AND ma.perspective_id = m.id
			   AND ma.mode = 'perspective' AND ma.properties ? 'mapType'
			 WHERE a.naming_id = $1 AND a.perspective_id != $1`,
			[namingId]
		),
		// All participations (relations this naming is involved in)
		query<{
			relation_id: string; relation_inscription: string;
			partner_id: string; partner_inscription: string;
			partner_designation: string | null;
			relation_designation: string | null;
			role: 'source' | 'target';
			valence: string | null;
			is_withdrawn: boolean;
			map_appearances: { id: string; label: string; mode: string; withdrawn: boolean }[] | null;
		}>(
			`SELECT p.id as relation_id, pn.inscription as relation_inscription,
			        partner.id as partner_id, partner.inscription as partner_inscription,
			        (SELECT na.designation FROM naming_acts na
			         WHERE na.naming_id = partner.id AND na.designation IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as partner_designation,
			        (SELECT na.designation FROM naming_acts na
			         WHERE na.naming_id = p.id AND na.designation IS NOT NULL
			         ORDER BY na.seq DESC LIMIT 1) as relation_designation,
			        CASE WHEN p.naming_id = $1 THEN 'source' ELSE 'target' END as role,
			        (SELECT a.valence FROM appearances a WHERE a.naming_id = p.id AND a.mode = 'relation' LIMIT 1) as valence,
			        ${WITHDRAWN_SQL('pn')} as is_withdrawn,
			        -- Je Map: wie die Relation dort erscheint (als Relation oder
			        -- umgeschaltet als Entität) und ob sie dort zurückgezogen ist.
			        (SELECT json_agg(json_build_object(
			            'id', mp.id, 'label', mp.inscription, 'mode', ra.mode,
			            'withdrawn', COALESCE((ra.properties->>'withdrawn')::boolean, false)
			                         OR COALESCE((ra.properties->>'aiWithdrawn')::boolean, false))
			          ORDER BY mp.inscription)
			         FROM appearances ra
			         JOIN namings mp ON mp.id = ra.perspective_id AND mp.deleted_at IS NULL
			         JOIN appearances mpa ON mpa.naming_id = mp.id AND mpa.perspective_id = mp.id
			           AND mpa.mode = 'perspective' AND mpa.properties ? 'mapType'
			         WHERE ra.naming_id = p.id AND ra.perspective_id != p.id) as map_appearances
			 FROM participations p
			 JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			 JOIN namings partner ON partner.id = CASE WHEN p.naming_id = $1 THEN p.participant_id ELSE p.naming_id END
			   AND partner.deleted_at IS NULL
			 WHERE (p.naming_id = $1 OR p.participant_id = $1)
			   -- Die Verankerung an einer Passage ist keine Relation zwischen
			   -- Namings: sie steht unter „Material", ihr Memo im Stack. Ohne
			   -- diesen Ausschluss erschien das Passagen-Memo hier als Relation.
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances aa
			      WHERE aa.naming_id IN (p.naming_id, p.participant_id)
			        AND aa.mode = 'relation' AND aa.properties ? 'anchorType')
			 ORDER BY ${WITHDRAWN_SQL('pn')} ASC, pn.created_at DESC`,
			[namingId]
		)
	]);

	if (!naming) return null;

	// Current designation
	const currentDesignation = stack.designations.length > 0
		? stack.designations[stack.designations.length - 1].designation
		: 'cue';

	// Grounding status
	const hasDocumentAnchor = (stack.annotations?.length ?? 0) > 0;
	// Memo: ein Memo einer Forscherin im Stack (Akt mit memo_text) oder ein
	// verweisendes Memo-Naming — wie auf Map und in der Liste. KI-Memos zählen
	// erst, wenn die Forscherin sie hereinholt (Satz IV). Ein Memo ist
	// Reflexion, kein Grounding (S08); es wird nur getrennt ausgewiesen.
	// Memos im Stack eines aufgenommenen Namings (unter dem Merge-Akt) zählen mit.
	const hasNoteAct = (acts: any[]): boolean =>
		acts.some(
			(a) =>
				((a.kind ?? 'act') === 'act' && a.by_researcher && !!a.memo_text?.trim()) ||
				(Array.isArray(a.absorbed) && hasNoteAct(a.absorbed))
		);
	const hasMemoLink =
		(stack.memos ?? []).some((m: any) => !m.isAiAuthored || m.status === 'promoted') || hasNoteAct(stack.acts ?? []);

	// Mode (from any appearance)
	const primaryMode = appearances.rows.find(a => ['entity', 'relation', 'silence'].includes(a.mode))?.mode || 'entity';

	// Relation endpoints (if this naming IS a relation via participations table)
	const relationEndpoints = await queryOne<{
		source_id: string; target_id: string;
		source_inscription: string; target_inscription: string;
		valence: string | null; directed: boolean | null;
	}>(
		`SELECT p.naming_id as source_id, p.participant_id as target_id,
		        src.inscription as source_inscription, tgt.inscription as target_inscription,
		        ra.valence, (ra.directed_from IS NOT NULL AND ra.directed_to IS NOT NULL) AS directed
		 FROM participations p
		 LEFT JOIN LATERAL (SELECT a.valence, a.directed_from, a.directed_to FROM appearances a
		                     WHERE a.naming_id = p.id AND a.mode = 'relation' LIMIT 1) ra ON true
		 JOIN namings src ON src.id = p.naming_id
		 JOIN namings tgt ON tgt.id = p.participant_id
		 WHERE p.id = $1`,
		[namingId]
	);

	return {
		naming,
		currentDesignation,
		primaryMode,
		hasDocumentAnchor,
		hasMemoLink,
		relationEndpoints,
		stack,
		appearances: appearances.rows,
		participations: participations.rows
	};
}

// ---- All project namings (uncollapsed, for Namings workspace) ----

export async function getAllProjectNamings(projectId: string) {
	return (
		await query<{
			naming_id: string;
			inscription: string;
			created_at: string;
			seq: string;
			designation: string | null;
			current_inscription: string | null;
			has_document_anchor: boolean;
			has_memo_link: boolean;
			mode: string | null;
			directed_from: string | null;
			directed_to: string | null;
			source_inscription: string | null;
			target_inscription: string | null;
			valence: string | null;
			properties: Record<string, any> | null;
			is_withdrawn: boolean;
			ai_persona: string | null;
			appears_on_maps: { id: string; label: string }[] | null;
			part_source_id: string | null;
			part_target_id: string | null;
		}>(
			`SELECT n.id as naming_id, n.inscription, n.created_at, n.seq,
			   -- Endpunkte, falls das Naming eine Relation ist (je Richtung eine).
			   (SELECT p.naming_id FROM participations p WHERE p.id = n.id) AS part_source_id,
			   (SELECT p.participant_id FROM participations p WHERE p.id = n.id) AS part_target_id,
			   -- Current designation (latest non-NULL in stack)
			   (SELECT na.designation FROM naming_acts na
			    WHERE na.naming_id = n.id AND na.designation IS NOT NULL ORDER BY na.seq DESC LIMIT 1) as designation,
			   -- Current inscription (latest non-NULL in stack)
			   (SELECT na.inscription FROM naming_acts na
			    WHERE na.naming_id = n.id AND na.inscription IS NOT NULL ORDER BY na.seq DESC LIMIT 1) as current_inscription,
			   -- Grounding: has document anchor. Valenzen wie in getAnnotationsByNaming
			   -- ('codes' UND 'thematizes') — mit 'codes' allein galt jedes nur
			   -- thematisierend verankerte Naming als ungegroundet, und die Liste
			   -- widerspraeche der Karte.
			   EXISTS(SELECT 1 FROM appearances a
			    WHERE a.directed_from = n.id
			      AND a.valence IN ('codes', 'thematizes')) as has_document_anchor,
			   -- Memo: ein Memo zu diesem Naming im Stack (Akt mit memo_text einer
			   -- Forscherin) oder ein Memo-Naming, das auf es verweist.
			   (EXISTS(SELECT 1 FROM naming_acts na
			      JOIN researcher_namings rn ON rn.naming_id = na.by
			      WHERE na.naming_id = n.id AND na.memo_text IS NOT NULL AND btrim(na.memo_text) <> '')
			    OR EXISTS(SELECT 1 FROM participations mp
			    JOIN namings pn ON pn.id = mp.id AND pn.deleted_at IS NULL
			    JOIN memo_content mc ON mc.naming_id = CASE
			      WHEN mp.naming_id = n.id THEN mp.participant_id
			      ELSE mp.naming_id END
			    JOIN namings mn ON mn.id = mc.naming_id AND mn.deleted_at IS NULL AND NOT (mn.created_by = '00000000-0000-0000-0000-000000000000' AND mc.status IS DISTINCT FROM 'promoted')
			    -- KI-Memos verankern nichts, bis die Forscherin sie hereinholt (promote); ack ist ein Verdikt, kein Hereinholen (Satz IV)
			    WHERE mp.naming_id = n.id OR mp.participant_id = n.id)) as has_memo_link,
			   -- Mode from any appearance
			   (SELECT a.mode FROM appearances a
			    WHERE a.naming_id = n.id AND a.mode IN ('entity','relation','silence')
			    LIMIT 1) as mode,
			   -- Relation direction from the relation appearance (NULL when symmetric,
			   -- so the canonical render shows ↔; both set → directed arrow). Direction
			   -- lives in the appearance, NOT the participation: most relations
			   -- (e.g. 'thematizes') have no participation row at all.
			   (SELECT a.directed_from FROM appearances a
			    WHERE a.naming_id = n.id AND a.mode = 'relation' LIMIT 1) as directed_from,
			   (SELECT a.directed_to FROM appearances a
			    WHERE a.naming_id = n.id AND a.mode = 'relation' LIMIT 1) as directed_to,
			   -- Endpoint inscriptions: appearance direction first, participation
			   -- fallback (so symmetric relations — null appearance-direction but a
			   -- participation row — still resolve their two endpoints).
			   (SELECT src.inscription FROM namings src WHERE src.id = COALESCE(
			      (SELECT a.directed_from FROM appearances a WHERE a.naming_id = n.id AND a.mode = 'relation' AND a.directed_from IS NOT NULL LIMIT 1),
			      (SELECT p.naming_id FROM participations p WHERE p.id = n.id)
			   )) as source_inscription,
			   (SELECT tgt.inscription FROM namings tgt WHERE tgt.id = COALESCE(
			      (SELECT a.directed_to FROM appearances a WHERE a.naming_id = n.id AND a.mode = 'relation' AND a.directed_to IS NOT NULL LIMIT 1),
			      (SELECT p.participant_id FROM participations p WHERE p.id = n.id)
			   )) as target_inscription,
			   -- Valence (for relations)
			   (SELECT a.valence FROM appearances a
			    WHERE a.naming_id = n.id AND a.mode = 'relation' LIMIT 1) as valence,
			   -- Properties (withdrawn, aiSuggested etc.)
			   (SELECT a.properties FROM appearances a
			    WHERE a.naming_id = n.id
			    ORDER BY (a.naming_id = a.perspective_id) ASC
			    LIMIT 1) as properties,
			   -- Zurückgezogen = unter jeder Perspektive, in der es erscheint,
			   -- zurückgezogen (ohne Perspektive: an der eigenen Erscheinung).
			   -- Nicht eine beliebige Erscheinung entscheidet, sondern alle.
			   ${WITHDRAWN_SQL('n')} as is_withdrawn,
			   -- AI persona that created this naming (derived from any appearance that carries it)
			   (SELECT a.properties->>'aiPersona' FROM appearances a
			    WHERE a.naming_id = n.id AND a.properties->>'aiPersona' IS NOT NULL
			    LIMIT 1) as ai_persona,
			   -- Which maps does this naming appear on? Nur echte Karten (mapType):
			   -- ohne den Filter bekam jedes in-vivo- und vom Naming-Run angelegte Naming einen
			   -- Chip "Grounding Workspace", der die Infrastruktur-Perspektive als
			   -- Karte öffnete.
			   (SELECT json_agg(json_build_object('id', mp.id, 'label', mp.inscription))
			    FROM (SELECT DISTINCT m.id, m.inscription
			          FROM appearances a2
			          JOIN namings m ON m.id = a2.perspective_id
			          JOIN appearances ms ON ms.naming_id = m.id AND ms.perspective_id = m.id
			            AND ms.mode = 'perspective' AND ms.properties ? 'mapType'
			          WHERE a2.naming_id = n.id AND a2.perspective_id != n.id
			            AND m.deleted_at IS NULL) mp) as appears_on_maps
			 FROM namings n
			 WHERE n.project_id = $1
			   AND n.deleted_at IS NULL
			   AND (
			     -- Was in die Liste gehört (Session 09; „Gegenstands-Namings" war der
			     -- Begriff des Assistenten, BJ entschied: „Es macht keinen pragmatischen
			     -- Sinn, Maps als Namings in der Liste zu repräsentieren … es mahct
			     -- jedoch Sinn den Forschenden als Naming aufzunehmen"; Phasen „eher so
			     -- wie Memos"): Entitäten, Relationen, Silences, Forschende.
			     -- Nicht: Memos und ihre Verweise — sie erscheinen nur auf der
			     -- Memo-System-Perspektive und sind keine Namings, solange man sie
			     -- nicht dezidiert zu einem macht (Session 16; promoteMemoToNaming).
			     EXISTS (SELECT 1 FROM appearances a WHERE a.naming_id = n.id
			             AND a.mode IN ('entity','relation','silence')
			             AND (a.valence IS NULL OR a.valence != 'codes')
			             AND NOT EXISTS (SELECT 1 FROM appearances ms
			                             WHERE ms.naming_id = a.perspective_id
			                               AND ms.perspective_id = a.perspective_id
			                               AND ms.properties->>'role' = 'memo-system'))
			     OR EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = n.id)
			   )
			 ORDER BY n.seq DESC`,
			[projectId]
		)
	).rows;
}

// ---- Merge: two namings that turn out to be the same ----
// The survivor keeps its ID. The merged naming's participations, appearances,
// and directed_from/to references are transferred. The merged naming is soft-deleted.
// This is ground-truth surgery — the merge is recorded as a naming_act on the survivor.
export async function mergeNamings(
	projectId: string,
	userId: string,
	survivorId: string,
	mergedId: string
) {
	return transaction(async (client) => {
		const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

		// Verify both exist
		const [survivor, merged] = await Promise.all([
			client.query(
				`SELECT id, inscription FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
				[survivorId, projectId]
			),
			client.query(
				`SELECT id, inscription FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
				[mergedId, projectId]
			)
		]);
		if (survivor.rows.length === 0 || merged.rows.length === 0) {
			throw new Error('Both namings must exist');
		}

		// Nur Entitäten werden zusammengeführt. Maßgeblich ist, wie ein Naming
		// gerade auf einer Map steht: Wer eine Relation zur Entität zurückstellt,
		// behält ihre Endpunkte (participations.id) — die Sperre griff sonst bei
		// jeder Entität, die einmal Relation war (Testlauf 09.11.).
		const asRelation = await client.query(
			`SELECT n.inscription FROM appearances a
			   JOIN namings n ON n.id = a.naming_id
			   JOIN namings p ON p.id = a.perspective_id AND p.deleted_at IS NULL
			  WHERE a.naming_id = ANY($1::uuid[]) AND a.mode = 'relation'
			  LIMIT 1`,
			[[survivorId, mergedId]]
		);
		if (asRelation.rows.length > 0) {
			throw new Error(`“${asRelation.rows[0].inscription ?? 'This naming'}” stands as a relation on a map — only entities can be merged.`);
		}

		const mergedInscription = merged.rows[0].inscription;
		const survivorInscription = survivor.rows[0].inscription;

		// 1. Transfer participations (as endpoint)
		// Update naming_id where merged is the first endpoint
		// Eine Relation zwischen den beiden würde zur Relation des Überlebenden
		// mit sich selbst; sie wird nicht übertragen, sondern bleibt wie die
		// kollidierenden unten beim aufgenommenen Naming (soft-gelöscht).
		await client.query(
			`UPDATE participations SET naming_id = $1
			 WHERE naming_id = $2 AND participant_id <> $1
			   AND NOT EXISTS (
			     SELECT 1 FROM participations p2
			     WHERE p2.naming_id = $1 AND p2.participant_id = participations.participant_id
			   )`,
			[survivorId, mergedId]
		);
		// Update participant_id where merged is the second endpoint
		await client.query(
			`UPDATE participations SET participant_id = $1
			 WHERE participant_id = $2 AND naming_id <> $1
			   AND NOT EXISTS (
			     SELECT 1 FROM participations p2
			     WHERE p2.naming_id = participations.naming_id AND p2.participant_id = $1
			   )`,
			[survivorId, mergedId]
		);
		// Soft-delete conflicting participation-namings that couldn't be transferred
		await client.query(
			`UPDATE namings SET deleted_at = now()
			 WHERE id IN (
			   SELECT id FROM participations WHERE naming_id = $1 OR participant_id = $1
			 ) AND project_id = $2`,
			[mergedId, projectId]
		);

		// 2. Transfer appearances
		// Move appearances where survivor doesn't already appear on that perspective
		await client.query(
			`UPDATE appearances SET naming_id = $1
			 WHERE naming_id = $2
			   AND NOT EXISTS (
			     SELECT 1 FROM appearances a2
			     WHERE a2.naming_id = $1 AND a2.perspective_id = appearances.perspective_id
			   )`,
			[survivorId, mergedId]
		);
		// Kollidierende Erscheinungen (beide standen auf derselben Map) bleiben am
		// aufgenommenen Naming, das unten soft-gelöscht wird — wie die nicht
		// übertragbaren Participations oben. Nichts wird hart gelöscht („we do
		// only soft-delete, but not hard-delete", S08); Lage, Rolle und
		// Rückzugsstand auf dieser Map bleiben nachvollziehbar.

		// 3. Update directed_from/directed_to references in other appearances
		await client.query(
			`UPDATE appearances SET directed_from = $1 WHERE directed_from = $2`,
			[survivorId, mergedId]
		);
		await client.query(
			`UPDATE appearances SET directed_to = $1 WHERE directed_to = $2`,
			[survivorId, mergedId]
		);

		// 4. Transfer phase memberships
		await client.query(
			`UPDATE phase_memberships SET naming_id = $1 WHERE naming_id = $2`,
			[survivorId, mergedId]
		);

		// 5. Der Merge ist ein Akt im Stack des überlebenden Namings: nur der
		// Verweis auf das aufgenommene Naming (linked_naming_ids), kein
		// Memo-Text — ein Merge ist kein Memo der Forscherin und kein eigenes
		// Memo-Naming. Nur dieser Akt setzt nichts und verweist nur (mergeActSql).
		await client.query(
			`INSERT INTO naming_acts (naming_id, by, linked_naming_ids)
			 VALUES ($1, $2, $3)`,
			[survivorId, researcherNamingId, [mergedId]]
		);

		// 6. Der Stack des aufgenommenen Namings bleibt, wie er ist — mit Zeit,
		// Autorin und Kontext jedes Akts; der Stack des Überlebenden zeigt ihn
		// unter dem Merge-Akt (getNamingStack, absorbed), Verweise auf das
		// aufgenommene Naming zeigen auf den Überlebenden (mergedIntoSql).
		// Kopien in den Überlebenden trugen die Zeit des Merge und verloren
		// ihren Kontext (Testlauf 09.11.). Brachte das aufgenommene Naming ein
		// Memo einer Forscherin mit und steht der Überlebende auf cue, hebt ihn
		// ein eigener Akt mit Verweis auf das aufgenommene auf characterization
		// („MEMOS ADVANCEN EINE ENTITÄT VOM CUE ZUR CHARACTERIZATION", BJ 09.11.).
		const brought = await client.query(
			`SELECT 1 FROM naming_acts na
			  WHERE na.naming_id = $1 AND na.memo_text IS NOT NULL AND btrim(na.memo_text) <> ''
			    AND EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = na.by)
			  LIMIT 1`,
			[mergedId]
		);
		const survivorDesig = await client.query<{ designation: string }>(
			`SELECT designation FROM naming_acts
			  WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
			[survivorId]
		);
		if (brought.rows.length > 0 && (survivorDesig.rows[0]?.designation ?? 'cue') === 'cue') {
			await client.query(
				`INSERT INTO naming_acts (naming_id, by, designation, linked_naming_ids)
				 VALUES ($1, $2, 'characterization', $3)`,
				[survivorId, researcherNamingId, [mergedId]]
			);
		}

		// 7. Soft-delete the merged naming
		await client.query(
			`UPDATE namings SET deleted_at = now() WHERE id = $1`,
			[mergedId]
		);

		return {
			survivorId,
			mergedId,
			mergedInscription,
			survivorInscription
		};
	});
}

// ---- History: namings ARE the event log ----

export async function getHistory(projectId: string, opts?: { afterSeq?: number; limit?: number }) {
	const conditions = ['project_id = $1', 'deleted_at IS NULL'];
	const params: unknown[] = [projectId];
	let idx = 2;

	if (opts?.afterSeq) {
		conditions.push(`seq > $${idx++}`);
		params.push(opts.afterSeq);
	}

	const limit = opts?.limit || 100;
	params.push(limit);

	return (
		await query(
			`SELECT * FROM namings
			 WHERE ${conditions.join(' AND ')}
			 ORDER BY seq ASC
			 LIMIT $${idx}`,
			params
		)
	).rows;
}
