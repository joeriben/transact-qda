// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';

const STATE_DIR = process.env.TQDA_STATE_DIR?.trim() || process.cwd();
const BRAND_DIR = process.env.TQDA_BRAND_DIR?.trim() || join(process.cwd(), 'static', 'brand');

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
