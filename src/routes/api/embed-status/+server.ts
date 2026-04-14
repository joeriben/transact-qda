// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEmbedStatus } from '$lib/server/documents/embeddings.js';

export const GET: RequestHandler = async () => {
	return json(getEmbedStatus());
};
