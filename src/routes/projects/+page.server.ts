// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query } from '$lib/server/db/index.js';
import { getProjectsBaseDir, readArchivedMemberIds } from '$lib/server/project-sync/index.js';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

export const load: PageServerLoad = async ({ locals }) => {
	const result = await query<{
		id: string;
		name: string;
		description: string | null;
		created_by: string;
		created_at: string;
		role: string;
	}>(
		`SELECT p.id, p.name, p.description, p.created_by, p.created_at, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE pm.user_id = $1
		 ORDER BY p.created_at DESC`,
		[locals.user!.id]
	);

	// List on-disk archives the current user may load. Only loadable archives
	// (have namings.copy) the user is an archived member of surface here — a
	// colleague's project sitting in the shared projekte/ folder must never be
	// offered to someone who isn't a member of it. Membership is read straight
	// from each archive's project_members.copy.
	const baseDir = getProjectsBaseDir();
	const me = locals.user!.id;
	let directories: { slug: string; hasData: boolean }[] = [];
	try {
		const entries = await readdir(baseDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dirPath = join(baseDir, entry.name);
			try {
				await stat(join(dirPath, 'namings.copy'));
			} catch {
				continue; // no data → nothing to load
			}
			const members = await readArchivedMemberIds(dirPath);
			if (!members.includes(me)) continue; // not yours → hide
			directories.push({ slug: entry.name, hasData: true });
		}
	} catch {
		// projekte/ doesn't exist yet
	}

	return {
		projects: result.rows.map((r: typeof result.rows[number]) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			createdAt: r.created_at,
			role: r.role
		})),
		directories,
		projectsDir: getProjectsBaseDir()
	};
};
