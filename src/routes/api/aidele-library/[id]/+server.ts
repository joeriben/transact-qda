import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getReference, getReferenceChunks, deleteReference } from '$lib/server/ai/aidele-library.js';

// Get single reference with its chunks
export const GET: RequestHandler = async ({ params }) => {
	try {
		const ref = await getReference(params.id);
		if (!ref) return json({ error: 'Not found' }, { status: 404 });
		const chunks = await getReferenceChunks(params.id);
		return json({ reference: ref, chunks });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};

// Delete reference
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await deleteReference(params.id);
		return json({ ok: true });
	} catch (e: any) {
		return json({ error: e.message }, { status: 500 });
	}
};
