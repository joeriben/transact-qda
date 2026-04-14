// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMemo, updateMemoContent } from '$lib/server/db/queries/memos.js';

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
