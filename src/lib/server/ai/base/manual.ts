// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Platform manual loader — loaded once at module init, shared by all personas.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let manual = '';
try {
	manual = readFileSync(join(process.cwd(), 'docs', 'manual.md'), 'utf-8');
} catch {
	console.warn('[AI Base] docs/manual.md not found — running without system manual');
}

export const MANUAL = manual;
