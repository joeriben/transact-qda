// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getAllProjectNamings } from '$lib/server/db/queries/namings.js';
import { getProjectPhases } from '$lib/server/db/queries/maps.js';

export const load: PageServerLoad = async ({ params }) => {
	const [namings, phases] = await Promise.all([
		getAllProjectNamings(params.projectId),
		getProjectPhases(params.projectId)
	]);
	return { namings, phases, projectId: params.projectId };
};
