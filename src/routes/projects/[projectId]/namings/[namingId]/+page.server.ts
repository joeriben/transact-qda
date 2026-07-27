// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getAggregatedNaming } from '$lib/server/db/queries/namings.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const result = await getAggregatedNaming(params.namingId, params.projectId);
	if (!result) {
		error(404, 'Naming not found');
	}
	return { ...result, projectId: params.projectId };
};
