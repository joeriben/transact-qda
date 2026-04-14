// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNamingsByProject, createNaming, createNamedAppearance, setAppearance } from '$lib/server/db/queries/namings.js';
import { namingSchema, appearanceSchema } from '$lib/shared/validation.js';

export const GET: RequestHandler = async ({ params }) => {
	const namings = await getNamingsByProject(params.projectId);
	return json(namings);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const parsed = namingSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
	}

	const { inscription } = parsed.data;

	// If an appearance is provided, create naming + appearance together
	if (body.appearance) {
		const appParsed = appearanceSchema.safeParse(body.appearance);
		if (!appParsed.success) {
			return json({ error: 'Invalid appearance', details: appParsed.error.flatten() }, { status: 400 });
		}
		const { perspectiveId, mode, directedFrom, directedTo, valence, properties } = appParsed.data;
		const naming = await createNamedAppearance(
			params.projectId, locals.user!.id, inscription,
			perspectiveId, mode,
			{ directedFrom, directedTo, valence, properties }
		);
		return json(naming, { status: 201 });
	}

	const naming = await createNaming(params.projectId, locals.user!.id, inscription);
	return json(naming, { status: 201 });
};
