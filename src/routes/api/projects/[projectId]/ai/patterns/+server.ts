import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { findPatterns, logInteraction } from '$lib/server/ai/index.js';
import { getElementsByProject } from '$lib/server/db/queries/elements.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { elementIds } = await request.json();

	try {
		let items: any[];
		if (elementIds?.length) {
			const allElements = await getElementsByProject(params.projectId);
			items = allElements.filter((e: any) => elementIds.includes(e.id));
		} else {
			items = await getElementsByProject(params.projectId);
		}

		const result = await findPatterns(
			items.map((i: any) => ({ label: i.label, kind: i.kind, properties: i.properties }))
		);

		await logInteraction(
			params.projectId,
			'patterns',
			result.model,
			{ elementCount: items.length },
			{ analysis: result.analysis },
			result.tokensUsed
		);

		return json({ analysis: result.analysis });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
