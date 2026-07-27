// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getMapsByProject } from '$lib/server/db/queries/maps.js';

export const load: PageServerLoad = async ({ params }) => {
	const maps = await getMapsByProject(params.projectId);
	return { maps, projectId: params.projectId };
};
