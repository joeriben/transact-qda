// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Project Sync — PostgreSQL ↔ Project Directory
 *
 * PostgreSQL is the runtime query engine.
 * The project directory is the canonical storage (COPY text format + files).
 * Periodic sync (~60s) writes DB state to directory.
 */

import { pool } from '$lib/server/db';
import archiver from 'archiver';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { mkdir, rename, readdir, stat, copyFile, open as openFile, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import { Writable } from 'stream';
import type pg from 'pg';
import { getProjectsDir, getUploadsDir } from '$lib/server/paths.js';

const PROJECTS_DIR = getProjectsDir();
const UPLOAD_DIR = getUploadsDir();

/** Fixed id of the internal AI actor (seeded on every install). */
const AI_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Tables in FK-safe load order.
 * Each entry: [filename, COPY TO query, COPY FROM target table, sequence columns to reset]
 */
const PROJECT_TABLES: {
	file: string;
	copyToQuery: (projectId: string) => string;
	copyFromTable: string;
	sequences?: { table: string; column: string }[];
}[] = [
	// 1. Users subset (referenced by namings.created_by, project_members.user_id, etc.)
	{
		file: 'users.copy',
		copyToQuery: (pid) => `COPY (
			SELECT DISTINCT u.* FROM users u WHERE u.id IN (
				SELECT created_by FROM namings WHERE project_id = '${pid}'
				UNION SELECT user_id FROM project_members WHERE project_id = '${pid}'
				UNION SELECT user_id FROM researcher_namings WHERE project_id = '${pid}'
			)
		) TO STDOUT`,
		copyFromTable: 'users'
	},
	// 2. Project (single row)
	{
		file: 'projects.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM projects WHERE id = '${pid}') TO STDOUT`,
		copyFromTable: 'projects'
	},
	// 3. Project members
	{
		file: 'project_members.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM project_members WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'project_members'
	},
	// 4. Namings (everything else depends on this)
	{
		file: 'namings.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM namings WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'namings',
		sequences: [{ table: 'namings', column: 'seq' }]
	},
	// 5. Naming acts
	{
		file: 'naming_acts.copy',
		copyToQuery: (pid) => `COPY (
			SELECT na.* FROM naming_acts na
			JOIN namings n ON n.id = na.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'naming_acts',
		sequences: [{ table: 'naming_acts', column: 'seq' }]
	},
	// 6. Appearances
	{
		file: 'appearances.copy',
		copyToQuery: (pid) => `COPY (
			SELECT a.* FROM appearances a
			JOIN namings n ON n.id = a.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'appearances'
	},
	// 7. Participations
	{
		file: 'participations.copy',
		copyToQuery: (pid) => `COPY (
			SELECT p.* FROM participations p
			JOIN namings n ON n.id = p.id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'participations'
	},
	// 8. Document content
	{
		file: 'document_content.copy',
		copyToQuery: (pid) => `COPY (
			SELECT dc.* FROM document_content dc
			JOIN namings n ON n.id = dc.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'document_content'
	},
	// 9. Memo content
	{
		file: 'memo_content.copy',
		copyToQuery: (pid) => `COPY (
			SELECT mc.* FROM memo_content mc
			JOIN namings n ON n.id = mc.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'memo_content'
	},
	// 10. Phase memberships
	{
		file: 'phase_memberships.copy',
		copyToQuery: (pid) => `COPY (
			SELECT cm.* FROM phase_memberships cm
			JOIN namings n ON n.id = cm.naming_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'phase_memberships',
		sequences: [{ table: 'phase_memberships', column: 'seq' }]
	},
	// 11. Topology snapshots
	{
		file: 'topology_snapshots.copy',
		copyToQuery: (pid) => `COPY (
			SELECT ts.* FROM topology_snapshots ts
			JOIN namings n ON n.id = ts.map_id
			WHERE n.project_id = '${pid}'
		) TO STDOUT`,
		copyFromTable: 'topology_snapshots'
	},
	// 12. Researcher namings
	{
		file: 'researcher_namings.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM researcher_namings WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'researcher_namings'
	},
	// 13. AI namings
	{
		file: 'ai_namings.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM ai_namings WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'ai_namings'
	},
	// 14. AI interactions (can be large, but included for completeness)
	{
		file: 'ai_interactions.copy',
		copyToQuery: (pid) => `COPY (SELECT * FROM ai_interactions WHERE project_id = '${pid}') TO STDOUT`,
		copyFromTable: 'ai_interactions'
	}
];

/**
 * Export a project from PostgreSQL to its project directory.
 * Writes each table as a PostgreSQL COPY text file.
 * Uses atomic writes (tmp → rename) to prevent corruption.
 */
export async function exportProjectToDir(projectId: string, projectSlug: string): Promise<string> {
	const dir = join(PROJECTS_DIR, projectSlug);
	await mkdir(dir, { recursive: true });
	await mkdir(join(dir, 'files'), { recursive: true });

	const client = await pool.connect();
	try {
		for (const table of PROJECT_TABLES) {
			const tmpPath = join(dir, table.file + '.tmp');
			const finalPath = join(dir, table.file);
			const outStream = createWriteStream(tmpPath);
			const pgStream = client.query(copyTo(table.copyToQuery(projectId)));
			await pipeline(pgStream, outStream);
			await rename(tmpPath, finalPath);
		}

		// Sync files from legacy uploads/ to project dir if needed
		const legacyDir = join(UPLOAD_DIR, projectId);
		const legacyExists = await stat(legacyDir).catch(() => null);
		if (legacyExists?.isDirectory()) {
			const files = await readdir(legacyDir);
			for (const file of files) {
				const dest = join(dir, 'files', file);
				const destExists = await stat(dest).catch(() => null);
				if (!destExists) {
					await copyFile(join(legacyDir, file), dest);
				}
			}
		}
	} finally {
		client.release();
	}

	return dir;
}

export async function exportProjectArchive(projectId: string, projectSlug: string): Promise<Buffer> {
	const dir = await exportProjectToDir(projectId, projectSlug);

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const writable = new Writable({
			write(chunk, _encoding, callback) {
				chunks.push(chunk);
				callback();
			}
		});

		const archive = archiver('zip', { zlib: { level: 9 } });
		archive.on('error', reject);
		writable.on('finish', () => resolve(Buffer.concat(chunks)));

		archive.pipe(writable);
		archive.directory(dir, projectSlug);
		archive.finalize();
	});
}

/**
 * Read the column count of the first data row in a COPY text file.
 * Returns null on empty file or single end-of-data marker. Used to make
 * imports forward-compatible: when newer migrations have appended columns
 * at the end of a table, an older .copy file can still be loaded by
 * naming only the columns it actually contains; the rest take DEFAULTs.
 */
async function countColumnsInFile(filePath: string): Promise<number | null> {
	const fh = await openFile(filePath, 'r');
	try {
		const buf = Buffer.alloc(8192);
		const { bytesRead } = await fh.read(buf, 0, 8192, 0);
		if (bytesRead === 0) return null;
		const text = buf.subarray(0, bytesRead).toString('utf8');
		const nl = text.indexOf('\n');
		const firstLine = nl === -1 ? text : text.slice(0, nl);
		if (!firstLine || firstLine === '\\.') return null;
		// COPY text format: tab-separated; tabs in data are escaped as \t,
		// so a literal \t separator is always a single tab character.
		return firstLine.split('\t').length;
	} finally {
		await fh.close();
	}
}

async function getTableColumns(client: pg.PoolClient, tableName: string): Promise<string[]> {
	const r = await client.query<{ column_name: string }>(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1
		 ORDER BY ordinal_position`,
		[tableName]
	);
	return r.rows.map((x) => x.column_name);
}

/**
 * Build the COPY FROM target clause. If the file has fewer columns than the
 * current table (older export, newer schema), explicitly name the leading
 * columns; the trailing ones get their DEFAULT. Postgres always appends new
 * columns at the end, so taking the first N is correct.
 */
async function buildCopyTarget(
	client: pg.PoolClient,
	tableName: string,
	filePath: string
): Promise<string> {
	const fileCols = await countColumnsInFile(filePath);
	const tableCols = await getTableColumns(client, tableName);
	if (fileCols === null || fileCols >= tableCols.length) {
		return `COPY ${tableName} FROM STDIN`;
	}
	const useCols = tableCols.slice(0, fileCols).map((c) => `"${c}"`).join(', ');
	return `COPY ${tableName} (${useCols}) FROM STDIN`;
}

/**
 * Read the project UUID from the first column of projects.copy without
 * starting a transaction. Returns null if the file is missing/malformed.
 */
async function readProjectIdFromCopy(copyPath: string): Promise<string | null> {
	let fh;
	try {
		fh = await openFile(copyPath, 'r');
	} catch {
		return null;
	}
	try {
		const buf = Buffer.alloc(256);
		const { bytesRead } = await fh.read(buf, 0, 256, 0);
		if (bytesRead === 0) return null;
		const firstLine = buf.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
		const firstField = firstLine.split('\t')[0];
		return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firstField)
			? firstField
			: null;
	} finally {
		await fh.close();
	}
}

/**
 * Import a project from its directory into PostgreSQL.
 * Reads COPY text files in FK order, uses COPY FROM STDIN.
 * Users are imported with ON CONFLICT DO NOTHING (UPSERT).
 *
 * If the snapshot's project UUID is already loaded in the DB, this is a
 * no-op: we return the existing id rather than trying to re-COPY (which
 * would crash with a projects_pkey duplicate-key error). Callers that
 * want to overwrite an existing project must `unloadProject` first.
 */
export async function importProjectFromDir(dir: string): Promise<string> {
	const snapshotProjectId = await readProjectIdFromCopy(join(dir, 'projects.copy'));
	if (snapshotProjectId) {
		const exists = await pool.query('SELECT 1 FROM projects WHERE id = $1', [snapshotProjectId]);
		if (exists.rows.length > 0) {
			console.log(`[project-sync] Project ${snapshotProjectId} already loaded, skipping COPY import`);
			return snapshotProjectId;
		}
	}

	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		for (const table of PROJECT_TABLES) {
			const filePath = join(dir, table.file);
			try {
				await stat(filePath);
			} catch {
				continue; // File doesn't exist, skip (e.g. no ai_interactions)
			}

			if (table.file === 'users.copy') {
				// Users: load into temp table, then UPSERT by id.
				await client.query(`
					CREATE TEMP TABLE _tmp_users (LIKE users INCLUDING ALL) ON COMMIT DROP
				`);
				const copyTarget = await buildCopyTarget(client, '_tmp_users', filePath);
				const inStream = createReadStream(filePath);
				const pgStream = client.query(copyFrom(copyTarget));
				await pipeline(inStream, pgStream);
				// Defuse cross-install unique collisions: an archived user can carry a
				// username/email already held locally under a *different* id (e.g. the DB
				// was reset since export). Rename only those rows so the insert can't trip
				// users_username_key / users_email_key. The id is preserved, so dependent
				// FKs still resolve; native-import reassigns and prunes these rows after.
				// Same-instance loads (matching id) are left untouched.
				await client.query(`
					UPDATE _tmp_users t
					SET username = t.username || ' [' || left(t.id::text, 8) || ']'
					WHERE EXISTS (SELECT 1 FROM users u WHERE u.username = t.username AND u.id <> t.id)
				`);
				await client.query(`
					UPDATE _tmp_users t
					SET email = left(t.id::text, 8) || '+' || t.email
					WHERE t.email IS NOT NULL
					  AND EXISTS (SELECT 1 FROM users u WHERE u.email = t.email AND u.id <> t.id)
				`);
				await client.query(`
					INSERT INTO users SELECT * FROM _tmp_users
					ON CONFLICT (id) DO NOTHING
				`);
			} else {
				const copyTarget = await buildCopyTarget(client, table.copyFromTable, filePath);
				const inStream = createReadStream(filePath);
				const pgStream = client.query(copyFrom(copyTarget));
				await pipeline(inStream, pgStream);
			}

			// Reset sequences if needed
			if (table.sequences) {
				for (const seq of table.sequences) {
					await client.query(`
						SELECT setval(
							pg_get_serial_sequence('${seq.table}', '${seq.column}'),
							COALESCE((SELECT MAX(${seq.column}) FROM ${seq.table}), 0) + 1,
							false
						)
					`);
				}
			}
		}

		// Read back the project ID we just loaded
		// The projects.copy contains exactly one row — find it by reading the file
		const projectResult = await client.query(`SELECT id FROM projects ORDER BY created_at DESC LIMIT 1`);
		const projectId = projectResult.rows[0]?.id;
		if (!projectId) throw new Error('No project found after import');

		await client.query('COMMIT');
		return projectId;
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
}

/**
 * Reassign every human authorship reference in a freshly-imported project to a
 * single owner, then prune the now-unreferenced archived user rows.
 *
 * Used by native-import: a logged-in user who uploads a `.tqda.zip` becomes the
 * sole owner and author of its contents, so authorship can't be ambiguous across
 * installs (the archive may carry users whose ids/usernames no longer mean the
 * same person locally). The internal AI actor is preserved — collapsing AI-made
 * namings into the human would itself misattribute authorship.
 *
 * @param ghostUserIds Archived user ids that did NOT exist locally before the
 *   import (so they were created by it). Only these are eligible for deletion,
 *   and only once nothing references them — never a pre-existing real account.
 */
export async function reassignProjectOwnership(
	projectId: string,
	newOwnerId: string,
	ghostUserIds: string[]
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		// Authorship → new owner (AI-authored rows stay with the system actor).
		await client.query(
			`UPDATE namings SET created_by = $1 WHERE project_id = $2 AND created_by <> $3`,
			[newOwnerId, projectId, AI_SYSTEM_USER_ID]
		);
		await client.query(`UPDATE projects SET created_by = $1 WHERE id = $2`, [newOwnerId, projectId]);

		// Membership collapses to the new owner alone.
		await client.query(`DELETE FROM project_members WHERE project_id = $1`, [projectId]);
		await client.query(
			`INSERT INTO project_members (project_id, user_id, role)
			 VALUES ($1, $2, 'owner')
			 ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'`,
			[projectId, newOwnerId]
		);

		// Researcher-as-naming: collapse all human researcher identities into the
		// owner. PK is (user_id, project_id), so keep one human mapping and drop the
		// surplus (the underlying naming nodes are preserved), then point it at the
		// owner. ai-system's researcher naming is left as-is.
		await client.query(
			`DELETE FROM researcher_namings r
			 USING (
			   SELECT ctid, row_number() OVER (ORDER BY created_at, naming_id) AS rn
			   FROM researcher_namings
			   WHERE project_id = $1 AND user_id <> $2
			 ) d
			 WHERE r.ctid = d.ctid AND d.rn > 1`,
			[projectId, AI_SYSTEM_USER_ID]
		);
		await client.query(
			`UPDATE researcher_namings SET user_id = $1 WHERE project_id = $2 AND user_id <> $3`,
			[newOwnerId, projectId, AI_SYSTEM_USER_ID]
		);

		// Prune ghost users created by this import that nothing references anymore.
		if (ghostUserIds.length > 0) {
			await client.query(
				`DELETE FROM users u
				 WHERE u.id = ANY($1::uuid[])
				   AND u.id <> $2 AND u.id <> $3
				   AND NOT EXISTS (SELECT 1 FROM namings WHERE created_by = u.id)
				   AND NOT EXISTS (SELECT 1 FROM projects WHERE created_by = u.id)
				   AND NOT EXISTS (SELECT 1 FROM project_members WHERE user_id = u.id)
				   AND NOT EXISTS (SELECT 1 FROM researcher_namings WHERE user_id = u.id)
				   AND NOT EXISTS (SELECT 1 FROM coach_references WHERE uploaded_by = u.id)
				   AND NOT EXISTS (SELECT 1 FROM coding_runs WHERE started_by_user_id = u.id)
				   AND NOT EXISTS (SELECT 1 FROM sessions WHERE user_id = u.id)`,
				[ghostUserIds, newOwnerId, AI_SYSTEM_USER_ID]
			);
		}

		await client.query('COMMIT');
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
}

/** Read the archived human user ids from a project dir's users.copy (ai-system excluded). */
async function readArchivedHumanUserIds(dir: string): Promise<string[]> {
	let content: string;
	try {
		content = await readFile(join(dir, 'users.copy'), 'utf8');
	} catch {
		return [];
	}
	const ids = new Set<string>();
	for (const line of content.split('\n')) {
		if (!line || line === '\\.') continue;
		const id = line.split('\t')[0];
		if (
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
			id !== AI_SYSTEM_USER_ID
		) {
			ids.add(id);
		}
	}
	return [...ids];
}

/**
 * Read the user ids listed in a project dir's archived project_members.copy
 * (COPY columns: project_id, user_id, role). This is how we decide whether the
 * current user may see or load an on-disk archive: only its archived members
 * may — a researcher never gets handed a colleague's project just because the
 * archive happens to sit in the shared projekte/ folder. Returns [] if the
 * archive carries no membership file (then it is treated as not-yours).
 */
export async function readArchivedMemberIds(dir: string): Promise<string[]> {
	let content: string;
	try {
		content = await readFile(join(dir, 'project_members.copy'), 'utf8');
	} catch {
		return [];
	}
	const ids = new Set<string>();
	for (const line of content.split('\n')) {
		if (!line || line === '\\.') continue;
		const userId = line.split('\t')[1];
		if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
			ids.add(userId);
		}
	}
	return [...ids];
}

/**
 * Load a project directory into the DB and claim it for `ownerId`: authorship
 * and membership collapse to that user (see reassignProjectOwnership). Used ONLY
 * by the native-import upload, where the archive comes from elsewhere and its
 * user ids no longer mean the same people locally, so claiming is correct. The
 * on-disk "load from archive" action does NOT use this — there the ids ARE the
 * local colleagues, so it restores the archived membership as-is instead (see
 * the `load` route), never reassigning ownership or authorship.
 */
export async function importAndClaimProject(dir: string, ownerId: string): Promise<string> {
	const archivedHumanIds = await readArchivedHumanUserIds(dir);
	// Only users this import newly creates are eligible for pruning — never a
	// pre-existing local account that merely happens to appear in the archive.
	const preExisting = archivedHumanIds.length
		? (
				await pool.query<{ id: string }>(`SELECT id FROM users WHERE id = ANY($1::uuid[])`, [
					archivedHumanIds
				])
			).rows.map((r) => r.id)
		: [];
	const ghostIds = archivedHumanIds.filter((id) => !preExisting.includes(id));

	const projectId = await importProjectFromDir(dir);
	await reassignProjectOwnership(projectId, ownerId, ghostIds);
	return projectId;
}

/**
 * Unload a project from PostgreSQL (data remains in project directory).
 * Runs a final sync before deleting from DB.
 */
export async function unloadProject(projectId: string, projectSlug: string): Promise<void> {
	// Final sync to directory
	await exportProjectToDir(projectId, projectSlug);
	// Delete from DB (CASCADE handles all dependent tables)
	await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
}

/**
 * List available projects from the project directories.
 * Reads projects.copy from each subdirectory.
 */
export async function listProjectDirs(): Promise<{ slug: string; name: string; id: string }[]> {
	try {
		await mkdir(PROJECTS_DIR, { recursive: true });
		const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
		const projects: { slug: string; name: string; id: string }[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			// We could parse projects.copy, but for listing we need a manifest
			// For now, the directory name is the slug
			projects.push({ slug: entry.name, name: entry.name, id: '' });
		}
		return projects;
	} catch {
		return [];
	}
}

/**
 * Check if a project is currently loaded in PostgreSQL.
 */
export async function isProjectLoaded(projectId: string): Promise<boolean> {
	const result = await pool.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
	return result.rows.length > 0;
}

/**
 * Get the project directory path for a given slug.
 */
export function getProjectDir(slug: string): string {
	return join(PROJECTS_DIR, slug);
}

/**
 * Get the base projects directory.
 */
export function getProjectsBaseDir(): string {
	return PROJECTS_DIR;
}

// --- Periodic Sync ---

let syncInterval: ReturnType<typeof setInterval> | null = null;
let activeProjectId: string | null = null;
let activeProjectSlug: string | null = null;

export function startPeriodicSync(projectId: string, projectSlug: string, intervalMs = 60_000): void {
	// Skip if already syncing this project
	if (activeProjectId === projectId && syncInterval) return;
	stopPeriodicSync();
	activeProjectId = projectId;
	activeProjectSlug = projectSlug;

	// Initial sync
	exportProjectToDir(projectId, projectSlug).catch(err =>
		console.error('[project-sync] Initial sync failed:', err)
	);

	syncInterval = setInterval(() => {
		if (activeProjectId && activeProjectSlug) {
			exportProjectToDir(activeProjectId, activeProjectSlug).catch(err =>
				console.error('[project-sync] Periodic sync failed:', err)
			);
		}
	}, intervalMs);
}

export function stopPeriodicSync(): void {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
	activeProjectId = null;
	activeProjectSlug = null;
}

export function getActiveProject(): { id: string; slug: string } | null {
	if (activeProjectId && activeProjectSlug) {
		return { id: activeProjectId, slug: activeProjectSlug };
	}
	return null;
}
