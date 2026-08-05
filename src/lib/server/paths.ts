// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const STATE_DIR = process.env.TQDA_STATE_DIR?.trim() || process.cwd();
const BRAND_DIR = process.env.TQDA_BRAND_DIR?.trim() || join(process.cwd(), 'static', 'brand');

// Der Zustandsordner trägt Uploads, Projektarchive, die Coach-Bibliothek und
// die API-Schlüsseldateien — also Forschungsmaterial und Zugangsdaten. Die
// .gitignore sperrt diese Ordner im Wurzelverzeichnis, weil sie dort liegen,
// solange TQDA_STATE_DIR nicht gesetzt ist. Zeigt die Variable auf einen
// UNTERordner des Arbeitsbaums, greift keine dieser Regeln mehr, und das
// Material wird committebar, ohne dass jemand etwas davon merkt.
//
// Deshalb hier die Sperre statt weiterer Pfadmuster: ein Muster müsste raten,
// diese Prüfung weiß es. Sie greift nur in einem Checkout — ohne .git (Prod,
// Tarball) gibt es kein Repository, in das etwas rutschen könnte.
function findRepoRoot(from: string): string | null {
	let dir = resolve(from);
	for (;;) {
		if (existsSync(join(dir, '.git'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function assertStateDirOutsideWorkingTree(stateDir: string): void {
	const repoRoot = findRepoRoot(process.cwd());
	if (!repoRoot) return;
	const abs = resolve(stateDir);
	if (abs === repoRoot) return; // Dev-Default: von der .gitignore abgedeckt.
	const rel = relative(repoRoot, abs);
	if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return;
	throw new Error(
		`TQDA_STATE_DIR zeigt in den Arbeitsbaum (${abs}). Dort liegen Uploads, ` +
			`Projektarchive und Schlüsseldateien im Repository und wären committebar. ` +
			`Setze die Variable auf einen Ordner außerhalb von ${repoRoot} — oder lass ` +
			`sie leer, dann bleibt es beim Wurzelverzeichnis, das die .gitignore sperrt.`
	);
}

assertStateDirOutsideWorkingTree(STATE_DIR);

export function getStateDir(): string {
	return STATE_DIR;
}

export function getUploadsDir(): string {
	return join(STATE_DIR, 'uploads');
}

export function getProjectsDir(): string {
	return join(STATE_DIR, 'projekte');
}

export function getCoachLibraryDir(): string {
	return join(STATE_DIR, 'coach-library');
}

export function getAiSettingsFile(): string {
	return join(STATE_DIR, 'ai-settings.json');
}

export function getApiKeyFile(name: string): string {
	return join(STATE_DIR, name);
}

export function getModelCacheDir(): string {
	return join(STATE_DIR, '.model-cache');
}

export function getBrandDir(): string {
	return BRAND_DIR;
}
