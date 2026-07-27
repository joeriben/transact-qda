// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import yauzl from 'yauzl';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import {
	importAndClaimProject,
	startPeriodicSync,
	getProjectsBaseDir,
	getProjectDir
} from '$lib/server/project-sync/index.js';

interface ZipEntry {
	name: string;
	getData: () => Promise<Buffer>;
}

function readZip(buffer: Buffer): Promise<ZipEntry[]> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
			if (err || !zipfile) return reject(err || new Error('Failed to open ZIP'));
			const entries: ZipEntry[] = [];
			zipfile.readEntry();
			zipfile.on('entry', (entry) => {
				if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
				entries.push({
					name: entry.fileName,
					getData: () => new Promise((res, rej) => {
						zipfile.openReadStream(entry, (err2, stream) => {
							if (err2 || !stream) return rej(err2);
							const chunks: Buffer[] = [];
							stream.on('data', (c: Buffer) => chunks.push(c));
							stream.on('end', () => res(Buffer.concat(chunks)));
							stream.on('error', rej);
						});
					})
				});
				zipfile.readEntry();
			});
			zipfile.on('end', () => resolve(entries));
			zipfile.on('error', reject);
		});
	});
}

/**
 * POST /api/projects/native-import
 *
 * Counterpart to GET /api/projects/[id]/native-export. Accepts an uploaded
 * `<slug>.tqda.zip` archive (a zipped project directory), extracts it into the
 * server-side projects directory, then loads + claims it for the uploading user
 * via importAndClaimProject() — the same path the on-disk "load from archive"
 * cards use, so the project belongs to whoever brought it into their workspace.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) return json({ error: 'No file uploaded' }, { status: 400 });

	const buffer = Buffer.from(await file.arrayBuffer());

	let entries: ZipEntry[];
	try {
		entries = await readZip(buffer);
	} catch {
		return json({ error: 'Not a valid ZIP archive' }, { status: 400 });
	}
	if (entries.length === 0) return json({ error: 'Archive is empty' }, { status: 400 });

	// Our export wraps everything in a single <slug>/ directory. Require that
	// shape — it's the only thing we promise to round-trip.
	const tops = new Set(entries.map((e) => e.name.split('/')[0]));
	if (tops.size !== 1) {
		return json({ error: 'Not a transact-qda native archive (expected a single project folder)' }, { status: 400 });
	}
	const slug = [...tops][0];
	if (!/^[a-z0-9-]+$/.test(slug)) {
		return json({ error: 'Invalid project folder name in archive' }, { status: 400 });
	}
	if (!entries.some((e) => e.name === `${slug}/projects.copy`)) {
		return json({ error: 'Not a transact-qda native archive (missing projects.copy)' }, { status: 400 });
	}

	// Refuse to clobber an existing on-disk snapshot.
	const targetDir = getProjectDir(slug);
	if (await stat(targetDir).catch(() => null)) {
		return json({
			error: `A project "${slug}" already exists on disk. Load it from the on-disk list, or unload/delete it before re-importing.`
		}, { status: 409 });
	}

	// Extract into the projects directory, guarding against zip-slip.
	const baseDir = getProjectsBaseDir();
	const root = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
	for (const entry of entries) {
		const dest = join(baseDir, entry.name);
		if (!dest.startsWith(root)) {
			return json({ error: 'Archive contains unsafe paths' }, { status: 400 });
		}
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, await entry.getData());
	}

	try {
		const projectId = await importAndClaimProject(targetDir, locals.user.id);
		startPeriodicSync(projectId, slug);
		return json({ projectId, slug }, { status: 201 });
	} catch (e: any) {
		return json({ error: e?.message || 'Native import failed' }, { status: 500 });
	}
};
