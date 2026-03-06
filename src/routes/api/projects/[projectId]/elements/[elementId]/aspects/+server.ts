import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAspects, setAspect } from '$lib/server/db/queries/elements.js';

export const GET: RequestHandler = async ({ params }) => {
	const aspects = await getAspects(params.elementId);
	return json(aspects);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { contextId, properties } = await request.json();
	if (!contextId || !properties) {
		return json({ error: 'contextId and properties required' }, { status: 400 });
	}

	const aspect = await setAspect(
		params.elementId,
		contextId,
		params.projectId,
		locals.user!.id,
		properties
	);
	return json(aspect, { status: 201 });
};
