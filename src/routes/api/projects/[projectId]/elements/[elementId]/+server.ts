// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNaming, renameNaming, softDelete, getAppearances } from '$lib/server/db/queries/namings.js';

export const GET: RequestHandler = async ({ params }) => {
	const naming = await getNaming(params.elementId, params.projectId);
	if (!naming) return json({ error: 'Not found' }, { status: 404 });

	const appearances = await getAppearances(params.elementId);
	return json({ ...naming, appearances });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { inscription } = await request.json();
	if (inscription !== undefined) {
		const naming = await renameNaming(params.elementId, params.projectId, locals.user!.id, inscription);
		if (!naming) return json({ error: 'Not found' }, { status: 404 });
		return json(naming);
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await softDelete(params.elementId, params.projectId);
	return json({ ok: true });
};
