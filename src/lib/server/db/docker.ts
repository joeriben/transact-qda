import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'transact-qda-db';
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 500;

export type DbStatus = 'healthy' | 'starting' | 'error';

let status: DbStatus = 'healthy';
let startingPromise: Promise<boolean> | null = null;
let lastError: string | null = null;

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
	console.log('[db/docker] Database connection failed, attempting auto-start...');

	try {
		await execAsync(`docker compose up -d`, {
			cwd: process.cwd(),
			timeout: 10_000
		});
	} catch (e: any) {
		status = 'error';
		lastError = `Failed to start container: ${e.message}`;
		console.error('[db/docker]', lastError);
		return false;
	}

	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			await execAsync(
				`docker exec ${CONTAINER_NAME} pg_isready -U tqda -d transact_qda`,
				{ timeout: 3000 }
			);
			status = 'healthy';
			console.log('[db/docker] Database is ready');
			return true;
		} catch {
			await new Promise(r => setTimeout(r, READY_POLL_MS));
		}
	}

	status = 'error';
	lastError = 'Database did not become ready within 30s';
	console.error('[db/docker]', lastError);
	return false;
}
