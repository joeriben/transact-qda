import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { assistMemo, logInteraction } from '$lib/server/ai/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { content, linkedElements } = await request.json();

	try {
		const result = await assistMemo(content || '', linkedElements || []);

		await logInteraction(
			params.projectId,
			'memo-assist',
			result.model,
			{ contentLength: content?.length || 0, linkedCount: linkedElements?.length || 0 },
			{ assistance: result.assistance },
			result.tokensUsed
		);

		return json({ assistance: result.assistance });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
