import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getEventsByProject } from '$lib/server/db/queries/events.js';

export const GET: RequestHandler = async ({ params, url }) => {
	const afterSeq = url.searchParams.get('after_seq');
	const type = url.searchParams.get('type') || undefined;
	const limit = parseInt(url.searchParams.get('limit') || '100');

	const events = await getEventsByProject(params.projectId, {
		afterSeq: afterSeq ? parseInt(afterSeq) : undefined,
		type,
		limit
	});

	return json(events);
};
