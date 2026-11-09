// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getAggregatedNaming, getAllProjectNamings } from '$lib/server/db/queries/namings.js';
import { namingLabel } from '$lib/shared/namingLabel.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const [result, all] = await Promise.all([
		getAggregatedNaming(params.namingId, params.projectId),
		getAllProjectNamings(params.projectId)
	]);
	if (!result) {
		error(404, 'Naming not found');
	}
	// Worauf ein Memo zu diesem Naming verweisen kann: dieselben Namings wie
	// in der Naming-Liste, benannt wie dort.
	const memoCandidates = all
		.filter((n) => n.naming_id !== params.namingId)
		.map((n) => ({
			id: n.naming_id,
			label: namingLabel(
				n.current_inscription || n.inscription,
				n.mode === 'relation'
					? {
							source: n.source_inscription,
							target: n.target_inscription,
							valence: n.valence,
							directed: !!(n.directed_from && n.directed_to)
						}
					: null
			)
		}));
	return { ...result, memoCandidates, projectId: params.projectId };
};
