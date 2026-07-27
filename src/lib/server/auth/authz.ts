// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query } from '$lib/server/db/index.js';

/**
 * Project-level authorization.
 *
 * A logged-in user may only touch a project's resources if they are a member
 * of that project (project_members). This is the baseline guard enforced
 * centrally in hooks.server.ts for every `/api/projects/<uuid>/*` route; page
 * routes already enforce it via `[projectId]/+layout.server.ts`. Individual
 * routes may layer finer role checks (e.g. owner-only) on top.
 */
export async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
	const r = await query(
		`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
		[projectId, userId]
	);
	return r.rows.length > 0;
}

/**
 * Body/query-UUID scoping.
 *
 * The membership guard only proves the caller belongs to the projectId in the
 * URL; it does NOT prove that a UUID taken from the request body/query belongs
 * to that same project. Everything in the data model is a naming carrying a
 * `project_id` (entities, relations, memos, maps, documents, docnets), so a
 * single check suffices: the referenced naming must live in this project (and
 * not be soft-deleted). Routes call this before acting on a foreign UUID and
 * return 404 when it fails, so cross-project existence is never revealed.
 */
export async function namingInProject(namingId: string, projectId: string): Promise<boolean> {
	const r = await query(
		`SELECT 1 FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL LIMIT 1`,
		[namingId, projectId]
	);
	return r.rows.length > 0;
}
