// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getHistory } from '$lib/server/db/queries/namings.js';

// In the transactional ontology, namings ARE the event log.
export const GET: RequestHandler = async ({ params, url }) => {
	const afterSeq = url.searchParams.get('after_seq');
	const limit = parseInt(url.searchParams.get('limit') || '100');

	const namings = await getHistory(params.projectId, {
		afterSeq: afterSeq ? parseInt(afterSeq) : undefined,
		limit
	});

	return json(namings);
};
