// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import {
	retrieveComparisonMaterial,
	retrieveComparisonMaterialForText,
	comparePassage
} from '$lib/server/ai/coding-companion/index.js';
import { loadSettings } from '$lib/server/ai/client.js';

/**
 * POST /api/projects/[projectId]/documents/[docId]/coding-companion
 *
 * Retrieves comparison material for a marked passage.
 * With compare=true, also performs the LLM comparison against the
 * researcher's own namings.
 */
export async function POST({ params, request }: { params: { projectId: string; docId: string }; request: Request }) {
	const { projectId, docId } = params;
	const body = await request.json();

	const { elementId, text, compare, maxSimilar, maxCodes, maxGroundingsPerCode, scope } = body as {
		elementId?: string;
		text?: string;
		compare?: boolean;
		maxSimilar?: number;
		maxCodes?: number;
		maxGroundingsPerCode?: number;
		scope?: 'in-document' | 'cross-document';
	};

	if (!elementId && !text) {
		throw error(400, 'Either elementId or text is required');
	}

	const options = { maxSimilar, maxCodes, maxGroundingsPerCode, scope };

	const retrieval = elementId
		? await retrieveComparisonMaterial(projectId, elementId, options)
		: await retrieveComparisonMaterialForText(projectId, text!, docId, options);

	if (!compare) {
		return json({ retrieval });
	}

	const settings = loadSettings();
	try {
		const comparison = await comparePassage(retrieval, projectId, {
			language: settings.language
		});
		return json({ retrieval, comparison });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return json({ retrieval, error: message }, { status: 502 });
	}
}
