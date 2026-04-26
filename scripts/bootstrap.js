// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import pg from 'pg';
import { seed } from './seed.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';
const BOOTSTRAP_MODE = process.env.TQDA_BOOTSTRAP || 'auto';

async function bootstrap() {
	if (BOOTSTRAP_MODE === 'none') {
		console.log('[bootstrap] TQDA_BOOTSTRAP=none, skipping seed.');
		return;
	}

	if (BOOTSTRAP_MODE === 'seed') {
		console.log('[bootstrap] TQDA_BOOTSTRAP=seed, running seed.');
		await seed();
		return;
	}

	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();
	try {
		const result = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
		const userCount = Number(result.rows[0]?.count || '0');
		if (userCount > 0) {
			console.log(`[bootstrap] ${userCount} user(s) present, seed not needed.`);
			return;
		}
		console.log('[bootstrap] Empty database detected, running seed.');
	} finally {
		await client.end();
	}

	await seed();
}

bootstrap().catch((e) => {
	console.error('[bootstrap] failed:', e);
	process.exit(1);
});
