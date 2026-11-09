// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { updateMemoStatus, promoteMemoToNaming } from '$lib/server/db/queries/memos.js';
import { namingInProject } from '$lib/server/auth/authz.js';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { status } = await request.json();
	if (!status) return json({ error: 'status required' }, { status: 400 });
	const validStatuses = ['active', 'presented', 'discussed', 'acknowledged', 'promoted', 'dismissed'];
	if (!validStatuses.includes(status)) return json({ error: 'Invalid status' }, { status: 400 });

	// Scope the memo UUID to this project (must not touch a foreign memo)
	if (!(await namingInProject(params.memoId, params.projectId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	// „promoted" heißt: das Memo wird zu einem Naming gemacht — hier wie auf
	// der Map (dort mit Platzierung, hier ohne).
	if (status === 'promoted') {
		try {
			const naming = await promoteMemoToNaming(params.projectId, locals.user!.id, params.memoId, null);
			return json({ ok: true, status, namingId: naming.id });
		} catch (error) {
			return json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
		}
	}
	await updateMemoStatus(params.memoId, status);
	return json({ ok: true, status });
};
