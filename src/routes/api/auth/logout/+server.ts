// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { deleteSession } from '$lib/server/auth/index.js';
import { SESSION_COOKIE } from '$lib/shared/constants.js';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		await deleteSession(token);
		cookies.delete(SESSION_COOKIE, { path: '/' });
	}
	return json({ ok: true });
};
