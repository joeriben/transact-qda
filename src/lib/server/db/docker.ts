// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 500;

export type DbStatus = 'healthy' | 'starting' | 'error';

let status: DbStatus = 'healthy';
let startingPromise: Promise<boolean> | null = null;
let lastError: string | null = null;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';

export function getDbStatus(): { status: DbStatus; error: string | null } {
	return { status, error: lastError };
}

export async function ensureDbRunning(): Promise<boolean> {
	if (startingPromise) return startingPromise;

	startingPromise = doStart();
	try {
		return await startingPromise;
	} finally {
		startingPromise = null;
	}
}

async function doStart(): Promise<boolean> {
	status = 'starting';
	lastError = null;
	console.log('[db] Database connection failed, waiting for native PostgreSQL...');

	try {
		const pg = await import('pg');
		const deadline = Date.now() + READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
			try {
				await client.connect();
				await client.end();
				status = 'healthy';
				console.log('[db] Database is ready');
				return true;
			} catch {
				try {
					await client.end();
				} catch {
					// ignore cleanup failures while polling
				}
				await new Promise(r => setTimeout(r, READY_POLL_MS));
			}
		}

		status = 'error';
		lastError = 'Database did not become ready within 30s';
		console.error('[db]', lastError);
		return false;
	} catch (e: any) {
		status = 'error';
		lastError = `Database readiness check failed: ${e.message}`;
		console.error('[db]', lastError);
		return false;
	}
}
