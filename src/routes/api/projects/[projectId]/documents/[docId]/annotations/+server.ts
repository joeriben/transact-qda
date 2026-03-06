import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAnnotationsByDocument, createAnnotation, deleteAnnotation } from '$lib/server/db/queries/codes.js';

export const GET: RequestHandler = async ({ params }) => {
	const annotations = await getAnnotationsByDocument(params.projectId, params.docId);
	return json(annotations);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { codeId, anchorType, anchor, comment } = await request.json();
	if (!codeId || !anchorType || !anchor) {
		return json({ error: 'codeId, anchorType, and anchor required' }, { status: 400 });
	}

	const annotation = await createAnnotation(
		params.projectId,
		locals.user!.id,
		codeId,
		params.docId,
		anchorType,
		anchor,
		comment
	);
	return json(annotation, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	const annotationId = url.searchParams.get('id');
	if (!annotationId) return json({ error: 'id required' }, { status: 400 });
	await deleteAnnotation(annotationId, params.projectId);
	return json({ ok: true });
};
