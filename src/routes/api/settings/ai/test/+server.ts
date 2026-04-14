// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { testConnection } from '$lib/server/ai/client.js';

export const POST: RequestHandler = async () => {
	const result = await testConnection();
	return json(result);
};
