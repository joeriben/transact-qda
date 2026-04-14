// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMemosByProject, createMemo } from '$lib/server/db/queries/memos.js';

export const GET: RequestHandler = async ({ params }) => {
	const memos = await getMemosByProject(params.projectId);
	return json(memos);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label, content, linkedElementIds } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	const memo = await createMemo(
		params.projectId,
		locals.user!.id,
		label,
		content || '',
		linkedElementIds || []
	);
	return json(memo, { status: 201 });
};
