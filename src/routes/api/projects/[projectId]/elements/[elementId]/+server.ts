import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getElementById, updateElement, softDeleteElement } from '$lib/server/db/queries/elements.js';

export const GET: RequestHandler = async ({ params }) => {
	const element = await getElementById(params.elementId, params.projectId);
	if (!element) return json({ error: 'Not found' }, { status: 404 });
	return json(element);
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const element = await updateElement(
		params.elementId,
		params.projectId,
		locals.user!.id,
		body
	);
	if (!element) return json({ error: 'Not found' }, { status: 404 });
	return json(element);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await softDeleteElement(params.elementId, params.projectId, locals.user!.id);
	return json({ ok: true });
};
