// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMemosByProject, createMemo } from '$lib/server/db/queries/memos.js';
import { namingInProject } from '$lib/server/auth/authz.js';

export const GET: RequestHandler = async ({ params }) => {
	const memos = await getMemosByProject(params.projectId);
	return json(memos);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { label, content, linkedElementIds } = await request.json();
	if (!label) return json({ error: 'label required' }, { status: 400 });

	// Verknüpft wird nur mit Namings dieses Projekts.
	const links: string[] = [];
	for (const id of Array.isArray(linkedElementIds) ? linkedElementIds : []) {
		if (typeof id === 'string' && (await namingInProject(id, params.projectId))) links.push(id);
	}

	const memo = await createMemo(
		params.projectId,
		locals.user!.id,
		label,
		content || '',
		links
	);
	return json(memo, { status: 201 });
};
