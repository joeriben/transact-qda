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
 *
 * Zurückziehen und Wiederherstellen einer Erscheinung stehen im selben
 * Protokoll (migrations/038): Das Flag an der Erscheinung ist der Zustand,
 * diese Akte sind seine Geschichte.
 */

export type SituatingAct = 'situate' | 'unsituate' | 'withdraw' | 'restore';

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
 * Withdraw oder Restore einer Erscheinung protokollieren — nur, wenn sich der
 * Zustand wirklich ändert (ein zweiter Klick ist kein zweiter Akt). Die
 * Zustände VOR dem Setzen des Flags übergeben (perspectiveId → war zurückgezogen).
 * Ein fehlgeschlagenes Protokoll (z. B. Migration 038 noch nicht eingespielt)
 * bricht den Akt selbst nicht ab, wird aber laut gemeldet.
 */
export async function logWithdrawal(params: {
	namingId: string;
	by: string;
	withdrawn: boolean;
	before: { perspectiveId: string; wasWithdrawn: boolean }[];
}) {
	const { namingId, by, withdrawn, before } = params;
	for (const b of before) {
		if (b.wasWithdrawn === withdrawn) continue;
		try {
			await logSituatingAct({
				mapId: b.perspectiveId,
				namingId,
				by,
				act: withdrawn ? 'withdraw' : 'restore',
				x: null,
				y: null
			});
		} catch (e) {
			console.error('[situating] withdraw/restore act not logged (migration 038 applied?)', e);
		}
	}
}

/**
 * Das Withdraw-Flag setzen und den Zustand davor zurückgeben (eine Anweisung:
 * die CTE sieht die Zeilen vor dem UPDATE).
 * - mit perspectiveId: nur die Erscheinung unter dieser Perspektive (Map);
 * - ohne: alle Erscheinungen des Namings außer seiner Selbst-Erscheinung —
 *   es sei denn, es hat keine andere (das Forscher-Naming trägt das Flag dann
 *   an der Selbst-Erscheinung).
 */
export async function setWithdrawnFlag(
	namingId: string,
	withdrawn: boolean,
	perspectiveId: string | null
): Promise<{ perspectiveId: string; wasWithdrawn: boolean }[]> {
	const res = await query<{ perspective_id: string; was_withdrawn: boolean }>(
		`WITH target AS (
		   SELECT a.naming_id, a.perspective_id,
		          COALESCE((a.properties->>'withdrawn')::boolean, false) AS was_withdrawn
		   FROM appearances a
		   WHERE a.naming_id = $2
		     AND CASE WHEN $3::uuid IS NOT NULL THEN a.perspective_id = $3::uuid
		              ELSE (a.naming_id != a.perspective_id
		                    OR NOT EXISTS (SELECT 1 FROM appearances o
		                                   WHERE o.naming_id = $2 AND o.naming_id != o.perspective_id))
		         END
		 ), upd AS (
		   UPDATE appearances a
		      SET properties = COALESCE(a.properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
		     FROM target t
		    WHERE a.naming_id = t.naming_id AND a.perspective_id = t.perspective_id
		   RETURNING a.perspective_id
		 )
		 SELECT t.perspective_id, t.was_withdrawn FROM target t`,
		[JSON.stringify({ withdrawn }), namingId, perspectiveId]
	);
	return res.rows.map((r) => ({ perspectiveId: r.perspective_id, wasWithdrawn: r.was_withdrawn }));
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
			        m.inscription     AS map_inscription,
			        -- Auf der SW/A-Map erscheint das Naming in einer Rolle
			        -- (Arena, Soziale Welt, Organisation, Diskurs): an der Erscheinung.
			        ap.properties->>'swRole' AS sw_role
			 FROM situating_acts sa
			 JOIN namings actor ON actor.id = sa.by
			 JOIN namings m     ON m.id = sa.map_id
			 LEFT JOIN appearances ap ON ap.naming_id = sa.naming_id AND ap.perspective_id = sa.map_id
			 WHERE sa.naming_id = $1
			 ORDER BY sa.created_at DESC`,
			[namingId]
		)
	).rows;
}
