import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMemo, updateMemoContent, addMemoLink, removeMemoLink } from '$lib/server/db/queries/memos.js';

export const GET: RequestHandler = async ({ params }) => {
	const memo = await getMemo(params.memoId, params.projectId);
	if (!memo) return json({ error: 'Not found' }, { status: 404 });
	return json(memo);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { content } = await request.json();
	if (content !== undefined) {
		await updateMemoContent(params.memoId, content);
	}
	return json({ ok: true });
};
