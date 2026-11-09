// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Wann geschah im Projekt zuletzt etwas? Ein Zeitpunkt, kein Inhalt: Damit
// merkt ein offener Tab, dass anderswo (zweiter Tab, Kollegin) umbenannt,
// zusammengeführt, zurückgezogen oder angelegt wurde, und lädt nach
// (Testläufe 12 und 14).
//
// Nur lesend. Projekt-Mitgliedschaft prüft hooks.server.ts zentral; gerechnet
// wird ausschließlich innerhalb von params.projectId.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';

export const GET: RequestHandler = async ({ params }) => {
	const row = await queryOne<{ at: string | null }>(
		`SELECT GREATEST(
		   (SELECT max(na.created_at) FROM naming_acts na JOIN namings n ON n.id = na.naming_id
		     WHERE n.project_id = $1),
		   (SELECT max(sa.created_at) FROM situating_acts sa JOIN namings n ON n.id = sa.naming_id
		     WHERE n.project_id = $1),
		   (SELECT max(GREATEST(n.created_at, COALESCE(n.deleted_at, n.created_at))) FROM namings n
		     WHERE n.project_id = $1),
		   (SELECT max(pm.created_at) FROM phase_memberships pm JOIN namings n ON n.id = pm.phase_id
		     WHERE n.project_id = $1)
		 )::text AS at`,
		[params.projectId]
	);
	return json({ at: row?.at ?? null }, { headers: { 'cache-control': 'no-store' } });
};
