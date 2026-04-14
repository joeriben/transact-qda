// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getMemo } from '$lib/server/db/queries/memos.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const memo = await getMemo(params.memoId, params.projectId);
	if (!memo) error(404, 'Memo not found');
	return { memo, projectId: params.projectId };
};
