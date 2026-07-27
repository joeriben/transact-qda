// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const parentData = await parent();

	const result = await query(
		`SELECT u.id, u.username, u.display_name, u.email, pm.role
		 FROM project_members pm
		 JOIN users u ON u.id = pm.user_id
		 WHERE pm.project_id = $1
		 ORDER BY
		   CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
		   u.username`,
		[params.projectId]
	);

	return {
		projectId: params.projectId,
		members: result.rows,
		myRole: parentData.project.role,
		myUserId: locals.user!.id
	};
};
