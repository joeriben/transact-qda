// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Liest die .env im Projektwurzelverzeichnis in process.env — dieselbe Semantik
 * wie `set -a; . .env; set +a` in scripts/lib/load_env.sh, nur dass bereits
 * gesetzte Variablen nicht überschrieben werden (dotenv-Konvention: die von
 * außen gesetzte Umgebung hat Vorrang).
 *
 * Jedes Node-Skript, das gegen die Datenbank läuft, muss das aufrufen. Der
 * Fallback auf localhost:5432 im DATABASE_URL-Default trifft sonst still eine
 * andere Datenbank als die installierte — bei bootstrap.js hat genau das die
 * Installation abbrechen lassen.
 */
export function loadEnv() {
	const envFile = join(ROOT, '.env');
	if (!existsSync(envFile)) return;

	for (const rawLine of readFileSync(envFile, 'utf-8').split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq < 1) continue;
		const key = line.slice(0, eq).trim();
		if (!key || key in process.env) continue;

		// Umschließende Quotes abstreifen. Die Installer schreiben einfach
		// gequotet, weil Pfade unter ~/Library/Application Support/ Leerzeichen
		// enthalten und die Zeile ungequotet beim Sourcen zerfällt. Ein
		// eingebettetes Apostroph steht darin als '\'' — hier zurückübersetzen.
		let val = line.slice(eq + 1).trim();
		if (val.startsWith("'") && val.endsWith("'") && val.length > 1) {
			val = val.slice(1, -1).replaceAll("'\\''", "'");
		} else if (val.startsWith('"') && val.endsWith('"') && val.length > 1) {
			val = val.slice(1, -1);
		}
		process.env[key] = val;
	}
}
