import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNaming, updateInscription, softDelete, getAppearances } from '$lib/server/db/queries/namings.js';

export const GET: RequestHandler = async ({ params }) => {
	const naming = await getNaming(params.elementId, params.projectId);
	if (!naming) return json({ error: 'Not found' }, { status: 404 });

	const appearances = await getAppearances(params.elementId);
	return json({ ...naming, appearances });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { inscription } = await request.json();
	if (inscription !== undefined) {
		const naming = await updateInscription(params.elementId, params.projectId, inscription);
		if (!naming) return json({ error: 'Not found' }, { status: 404 });
		return json(naming);
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await softDelete(params.elementId, params.projectId);
	return json({ ok: true });
};
