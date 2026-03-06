import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getElementsByProject, createElement } from '$lib/server/db/queries/elements.js';
import { elementSchema } from '$lib/shared/validation.js';

export const GET: RequestHandler = async ({ params, url }) => {
	const kind = url.searchParams.get('kind') || undefined;
	const elements = await getElementsByProject(params.projectId, kind as any);
	return json(elements);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const parsed = elementSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
	}

	const { kind, label, sourceId, targetId, properties } = parsed.data;
	const element = await createElement(params.projectId, locals.user!.id, kind, label, {
		sourceId,
		targetId,
		properties
	});

	return json(element, { status: 201 });
};
