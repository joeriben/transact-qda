// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
// Admin-only full-database dump via `pg_dump`, gzipped and streamed to the browser.

import type { RequestHandler } from './$types.js';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.user?.role !== 'admin') {
		return new Response(JSON.stringify({ error: 'Forbidden' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const dumper = spawn('pg_dump', [
		`--dbname=${DATABASE_URL}`,
		'--clean',
		'--if-exists',
	]);

	dumper.stderr.on('data', (chunk) => {
		console.warn('[admin/db-dump] pg_dump stderr:', chunk.toString());
	});

	dumper.on('error', (err) => {
		console.error('[admin/db-dump] failed to spawn pg_dump:', err);
	});

	const gzip = createGzip({ level: 6 });
	dumper.stdout.pipe(gzip);

	dumper.on('exit', (code) => {
		if (code !== 0) {
			console.error(`[admin/db-dump] pg_dump exited with code ${code}`);
			gzip.destroy(new Error(`pg_dump exited ${code}`));
		}
	});

	const webStream = Readable.toWeb(gzip) as ReadableStream<Uint8Array>;

	const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').replace(/Z$/, '');
	const filename = `transact_qda_${ts}.sql.gz`;

	return new Response(webStream, {
		headers: {
			'Content-Type': 'application/gzip',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
};
