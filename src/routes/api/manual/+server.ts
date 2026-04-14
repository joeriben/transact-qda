// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const GET: RequestHandler = async () => {
	const manualPath = join(process.cwd(), 'docs', 'manual.md');
	const content = await readFile(manualPath, 'utf-8');
	return json({ content });
};
