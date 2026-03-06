import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { summarizeDocument, logInteraction } from '$lib/server/ai/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { text } = await request.json();
	if (!text) return json({ error: 'text required' }, { status: 400 });

	try {
		const result = await summarizeDocument(text);

		await logInteraction(
			params.projectId,
			'summarize',
			result.model,
			{ textLength: text.length },
			{ summary: result.summary },
			result.tokensUsed
		);

		return json({ summary: result.summary });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
