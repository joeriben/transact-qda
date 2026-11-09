// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { countProjectMemos } from '$lib/server/db/queries/memos.js';
import { WITHDRAWN_SQL } from '$lib/server/db/queries/namings.js';

// Die Zähler der Projektübersicht. Sie entstehen hier und nicht im Layout,
// damit sie bei jedem Aufruf der Übersicht frisch sind — Karten und Dokumente
// laden die Layout-Daten nach ihren Akten nicht neu.
export const load: PageServerLoad = async ({ params }) => {
	const [counts, memos] = await Promise.all([
		queryOne<{ documents: string; namings: string; withdrawn: string; maps: string }>(
			`WITH listed AS (
				-- Namings = was die Naming-Liste zeigt: Entitäten, Relationen und Silences
				-- außerhalb des Memo-Systems (ohne Anker-Relationen zu Passagen) und die
				-- Forschenden, dieselbe Bedingung wie getAllProjectNamings (queries/namings.ts).
				SELECT n.id, ${WITHDRAWN_SQL('n')} AS is_withdrawn FROM namings n
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				   AND (
				     EXISTS (SELECT 1 FROM appearances a WHERE a.naming_id = n.id
				             AND a.mode IN ('entity','relation','silence')
				             AND (a.valence IS NULL OR a.valence != 'codes')
				             AND NOT EXISTS (SELECT 1 FROM appearances ms
				                             WHERE ms.naming_id = a.perspective_id
				                               AND ms.perspective_id = a.perspective_id
				                               AND ms.properties->>'role' = 'memo-system'))
				     OR EXISTS (SELECT 1 FROM researcher_namings rn WHERE rn.naming_id = n.id)
				   ))
			SELECT
				(SELECT COUNT(*) FROM document_content dc
				 JOIN namings n ON n.id = dc.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as documents,
				-- Zurückgezogenes zählt gesondert, wie im Kopf der Map und der Liste.
				(SELECT COUNT(*) FROM listed WHERE NOT is_withdrawn) as namings,
				(SELECT COUNT(*) FROM listed WHERE is_withdrawn) as withdrawn,
				(SELECT COUNT(*) FROM appearances a
				 JOIN namings n ON n.id = a.naming_id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				   AND a.naming_id = a.perspective_id
				   AND a.mode = 'perspective' AND a.properties ? 'mapType') as maps`,
			[params.projectId]
		),
		// Memos = was die Memo-Seite zeigt: analytische und Organisationsmemos
		// plus Memos zu einem Naming (Definition in queries/memos.ts).
		countProjectMemos(params.projectId)
	]);

	return {
		counts: {
			documents: parseInt(counts?.documents || '0'),
			namings: parseInt(counts?.namings || '0'),
			withdrawnNamings: parseInt(counts?.withdrawn || '0'),
			maps: parseInt(counts?.maps || '0'),
			memos
		}
	};
};
