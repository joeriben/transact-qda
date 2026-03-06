import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { transaction } from '$lib/server/db/index.js';
import { saveFile } from '$lib/server/files/index.js';
import { extractText, detectMimeType } from '$lib/server/documents/index.js';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const projectId = url.searchParams.get('projectId');
	if (!projectId) {
		return json({ error: 'projectId required' }, { status: 400 });
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const mimeType = detectMimeType(file.name);
	const filePath = await saveFile(buffer, file.name, projectId);
	const fullText = await extractText(buffer, mimeType);

	const doc = await transaction(async (client) => {
		const eventRes = await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'element.create', $2, $3) RETURNING id`,
			[projectId, locals.user!.id, JSON.stringify({ kind: 'document', label: file.name })]
		);

		const elemRes = await client.query(
			`INSERT INTO elements (project_id, kind, label, constituted_by)
			 VALUES ($1, 'document', $2, $3) RETURNING id, label, created_at`,
			[projectId, file.name, eventRes.rows[0].id]
		);
		const elementId = elemRes.rows[0].id;

		await client.query(
			`INSERT INTO document_content (element_id, full_text, file_path, mime_type, file_size)
			 VALUES ($1, $2, $3, $4, $5)`,
			[elementId, fullText, filePath, mimeType, buffer.length]
		);

		return { id: elementId, label: elemRes.rows[0].label, mimeType, size: buffer.length };
	});

	return json(doc, { status: 201 });
};
