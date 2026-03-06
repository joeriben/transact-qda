import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { findPatterns, logInteraction } from '$lib/server/ai/index.js';
import { getNamingsByProject } from '$lib/server/db/queries/namings.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { namingIds } = await request.json();

	try {
		let items: any[];
		const allNamings = await getNamingsByProject(params.projectId);
		if (namingIds?.length) {
			items = allNamings.filter((n: any) => namingIds.includes(n.id));
		} else {
			items = allNamings;
		}

		const result = await findPatterns(
			items.map((i: any) => ({ label: i.inscription, kind: 'naming', properties: {} }))
		);

		await logInteraction(
			params.projectId,
			'patterns',
			result.model,
			{ namingCount: items.length },
			{ analysis: result.analysis },
			result.tokensUsed
		);

		return json({ analysis: result.analysis });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
