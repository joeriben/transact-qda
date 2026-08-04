// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import pg from 'pg';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');
const envFile = join(__dirname, '..', '.env');

// Inline .env-Loader — gleiche Semantik wie scripts/lib/load_env.sh (bash
// `set -a; . .env; set +a`), nur dass bereits gesetzte process.env-Variablen
// nicht überschrieben werden (dotenv-Konvention: externe env hat Vorrang).
//
// Damit funktioniert `node scripts/migrate.js` direkt nach `git pull` — ohne
// dass der User über den 4_db_migrate.sh-Wrapper gehen muss. Auf Produktiv-
// Installationen hat die .env die echten DB-Credentials; der Hardcode-Fallback
// unten ist nur noch für Entwickler-Quickstarts.
if (existsSync(envFile)) {
	const content = readFileSync(envFile, 'utf-8');
	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq < 1) continue;
		const key = line.slice(0, eq).trim();
		if (!key || key in process.env) continue;
		let val = line.slice(eq + 1).trim();
		// Optional umschließende Quotes abstreifen (bash-kompatibel). Die
		// Installer schreiben einfach gequotete Werte — Pfade unter
		// ~/Library/Application Support/ enthalten Leerzeichen, ungequotet
		// zerfällt die Zeile beim Sourcen. Ein eingebettetes Apostroph steht
		// darin als '\'' (das Standard-Escape); das hier zurückübersetzen.
		if (val.startsWith("'") && val.endsWith("'") && val.length > 1) {
			val = val.slice(1, -1).replaceAll("'\\''", "'");
		} else if (val.startsWith('"') && val.endsWith('"') && val.length > 1) {
			val = val.slice(1, -1);
		}
		process.env[key] = val;
	}
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';

async function migrate() {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	await client.connect();

	// Create migrations tracking table
	await client.query(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);

	const applied = await client.query('SELECT name FROM _migrations ORDER BY name');
	const appliedSet = new Set(applied.rows.map((r) => r.name));

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith('.sql'))
		.sort();

	for (const file of files) {
		if (appliedSet.has(file)) {
			console.log(`  skip: ${file} (already applied)`);
			continue;
		}

		const sql = readFileSync(join(migrationsDir, file), 'utf-8');
		console.log(`  apply: ${file}`);

		await client.query('BEGIN');
		try {
			await client.query(sql);
			await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
			await client.query('COMMIT');
		} catch (e) {
			await client.query('ROLLBACK');
			console.error(`  FAILED: ${file}`, e.message);
			process.exit(1);
		}
	}

	console.log('Migrations complete.');
	await client.end();
}

migrate().catch((e) => {
	console.error('Migration failed:', e);
	process.exit(1);
});
