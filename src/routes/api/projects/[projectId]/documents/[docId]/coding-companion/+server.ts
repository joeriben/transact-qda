// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import {
	retrieveComparisonMaterial,
	retrieveComparisonMaterialForText,
	comparePassage,
	discussComparison
} from '$lib/server/ai/coding-companion/index.js';
import { loadSettings } from '$lib/server/ai/client.js';

/**
 * POST /api/projects/[projectId]/documents/[docId]/coding-companion
 *
 * Retrieves comparison material for a passage being coded.
 * With compare=true, also performs LLM-based multi-level comparison.
 * With discuss=true, continues a conversation about the comparison.
 */
export async function POST({ params, request }: { params: { projectId: string; docId: string }; request: Request }) {
	const { projectId, docId } = params;
	const body = await request.json();

	const {
		elementId, text, compare, discuss,
		maxSimilar, maxCodes, maxGroundingsPerCode, scope,
		retrieval: clientRetrieval, comparisonResult, discussionHistory, userMessage
	} = body as {
		elementId?: string;
		text?: string;
		compare?: boolean;
		discuss?: boolean;
		maxSimilar?: number;
		maxCodes?: number;
		maxGroundingsPerCode?: number;
		scope?: 'in-document' | 'cross-document';
		// Discussion mode fields
		retrieval?: any;
		comparisonResult?: any;
		discussionHistory?: { role: 'user' | 'assistant'; content: string }[];
		userMessage?: string;
	};

	// Discussion mode: continue conversation about a comparison
	if (discuss) {
		if (!clientRetrieval || !comparisonResult || !userMessage) {
			throw error(400, 'Discussion requires retrieval, comparisonResult, and userMessage');
		}
		const settings = loadSettings();
		const result = await discussComparison(
			clientRetrieval,
			comparisonResult,
			discussionHistory || [],
			userMessage,
			projectId,
			{ language: settings.language }
		);
		return json({ discussion: result });
	}

	// Retrieval / comparison mode
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

	// LLM comparison
	const settings = loadSettings();
	const comparison = await comparePassage(retrieval, projectId, {
		language: settings.language
	});

	return json({ retrieval, comparison });
}
