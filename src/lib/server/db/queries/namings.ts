import { query, queryOne, transaction } from '../index.js';
import type { CollapseMode } from '$lib/shared/types/index.js';

// ---- Core naming operations ----

export async function createNaming(
	projectId: string,
	userId: string,
	inscription: string
) {
	const res = await queryOne<{ id: string; inscription: string; created_at: string; seq: string }>(
		`INSERT INTO namings (project_id, inscription, created_by)
		 VALUES ($1, $2, $3) RETURNING *`,
		[projectId, inscription, userId]
	);
	return res!;
}

export async function updateInscription(namingId: string, projectId: string, inscription: string) {
	return queryOne(
		`UPDATE namings SET inscription = $1
		 WHERE id = $2 AND project_id = $3 AND deleted_at IS NULL
		 RETURNING *`,
		[inscription, namingId, projectId]
	);
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
