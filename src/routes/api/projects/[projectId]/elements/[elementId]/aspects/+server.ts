import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAppearances, setAppearance } from '$lib/server/db/queries/namings.js';

export const GET: RequestHandler = async ({ params }) => {
	const appearances = await getAppearances(params.elementId);
	return json(appearances);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { perspectiveId, mode, directedFrom, directedTo, valence, properties } = await request.json();
	if (!perspectiveId) {
		return json({ error: 'perspectiveId required' }, { status: 400 });
	}

	const appearance = await setAppearance(
		params.elementId,
		perspectiveId,
		mode || 'entity',
		{ directedFrom, directedTo, valence, properties }
	);
	return json(appearance, { status: 201 });
};
