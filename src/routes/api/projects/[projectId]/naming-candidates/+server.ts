// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAnnotationCandidates, createOrphanNaming } from '$lib/server/db/queries/annotations.js';
import { getOrCreateResearcherNaming } from '$lib/server/db/queries/namings.js';
import { query } from '$lib/server/db/index.js';

export const GET: RequestHandler = async ({ params }) => {
	const candidates = await getAnnotationCandidates(params.projectId);
	return json(candidates);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label, color, description } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	try {
		const naming = await createOrphanNaming(params.projectId, locals.user!.id, label, {
			color,
			description
		});
		// Erster Akt: die Inschrift, als Cue, durch die Forscherin — wie beim
		// Anlegen auf der Map und in der Naming-Liste. Ohne ihn begann der Stack
		// eines am Dokument angelegten Namings mit seinem Memo, nicht mit dem,
		// was benannt wurde. (Die KI-Pfade schreiben ihren Cue-Akt selbst.)
		const by = await getOrCreateResearcherNaming(params.projectId, locals.user!.id);
		await query(
			`INSERT INTO naming_acts (naming_id, inscription, designation, by)
			 VALUES ($1, $2, 'cue', $3)`,
			[naming.id, naming.inscription, by]
		);
		return json(naming, { status: 201 });
	} catch (e: any) {
		if (e.message?.includes('already exists')) {
			return json({ error: e.message }, { status: 409 });
		}
		throw e;
	}
};
