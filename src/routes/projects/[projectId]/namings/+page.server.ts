// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getAllProjectNamings } from '$lib/server/db/queries/namings.js';
import { getProjectClusters } from '$lib/server/db/queries/maps.js';

export const load: PageServerLoad = async ({ params }) => {
	const [namings, clusters] = await Promise.all([
		getAllProjectNamings(params.projectId),
		getProjectClusters(params.projectId)
	]);
	return { namings, clusters, projectId: params.projectId };
};
