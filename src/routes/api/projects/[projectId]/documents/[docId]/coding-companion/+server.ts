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
 * Retrieves comparison material for a passage being coded.
 * With compare=true, also performs LLM-based multi-level comparison.
 */
export async function POST({ params, request }: { params: { projectId: string; docId: string }; request: Request }) {
	const { projectId, docId } = params;
	const body = await request.json();

	const { elementId, text, compare, maxSimilar, maxCodes, maxGroundingsPerCode } = body as {
		elementId?: string;
		text?: string;
		compare?: boolean;
		maxSimilar?: number;
		maxCodes?: number;
		maxGroundingsPerCode?: number;
	};

	if (!elementId && !text) {
		throw error(400, 'Either elementId or text is required');
	}

	const options = { maxSimilar, maxCodes, maxGroundingsPerCode };

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
