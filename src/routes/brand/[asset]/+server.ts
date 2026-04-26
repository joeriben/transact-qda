// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getBrandDir } from '$lib/server/paths.js';

const CONTENT_TYPES: Record<string, string> = {
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp'
};

export const GET: RequestHandler = async ({ params }) => {
	const asset = basename(params.asset);
	if (!asset || asset !== params.asset) {
		throw error(400, 'Invalid asset name');
	}

	const filePath = join(getBrandDir(), asset);
	try {
		const data = await readFile(filePath);
		return new Response(data, {
			headers: {
				'content-type': CONTENT_TYPES[extname(asset).toLowerCase()] || 'application/octet-stream',
				'cache-control': 'no-cache'
			}
		});
	} catch {
		throw error(404, 'Brand asset not found');
	}
};
