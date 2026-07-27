// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query, queryOne } from '../index.js';

/**
 * The append-only record of namings entering and leaving a map's situation.
 *
 * A position is a derivative projection, not a designation — so these acts
 * deliberately do NOT live in naming_acts (see migrations/034). Only the
 * threshold is an act: unplaced -> placed and back. Repositioning and every
 * machine layout pass are not logged.
 */

export type SituatingAct = 'situate' | 'unsituate';

/** Current stored position of a naming on a map, or null if it is unplaced. */
export async function getStoredPosition(
	namingId: string,
	mapId: string
): Promise<{ x: number; y: number } | null> {
	const row = await queryOne<{ x: string | null; y: string | null }>(
		`SELECT properties->>'x' AS x, properties->>'y' AS y
		 FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
		[namingId, mapId]
	);
	if (!row?.x || !row?.y) return null;
	const x = parseFloat(row.x);
	const y = parseFloat(row.y);
	return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export async function logSituatingAct(params: {
	mapId: string;
	namingId: string;
	by: string;
	act: SituatingAct;
	x: number | null;
	y: number | null;
}) {
	const { mapId, namingId, by, act, x, y } = params;
	await query(
		`INSERT INTO situating_acts (map_id, naming_id, by, act, x, y)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[mapId, namingId, by, act, x, y]
	);
}

/**
 * Situating history of one naming, newest first, across every map it appears
 * on — the answer to "when did this cue enter the situation, and did I take it
 * back?". Project-scoped: a member of one project must not read the history of
 * a naming in another.
 */
export async function getSituatingActs(namingId: string, projectId: string) {
	const owns = await queryOne(
		`SELECT 1 FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[namingId, projectId]
	);
	if (!owns) return [];

	return (
		await query(
			`SELECT sa.act, sa.x, sa.y, sa.created_at,
			        actor.inscription AS by_inscription,
			        m.inscription     AS map_inscription
			 FROM situating_acts sa
			 JOIN namings actor ON actor.id = sa.by
			 JOIN namings m     ON m.id = sa.map_id
			 WHERE sa.naming_id = $1
			 ORDER BY sa.created_at DESC`,
			[namingId]
		)
	).rows;
}
