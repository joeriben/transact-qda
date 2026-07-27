// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDocNetDocuments,
	addDocumentToDocNet,
	removeDocumentFromDocNet
} from '$lib/server/db/queries/docnets.js';
import { namingInProject } from '$lib/server/auth/authz.js';

export const GET: RequestHandler = async ({ params }) => {
	// Scope the docnet UUID to this project (must not list a foreign docnet's docs)
	if (!(await namingInProject(params.docnetId, params.projectId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	const documents = await getDocNetDocuments(params.docnetId);
	return json(documents);
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { documentId } = await request.json();
	if (!documentId) return json({ error: 'documentId required' }, { status: 400 });

	// Scope both the docnet (URL) and the document (body) to this project.
	if (
		!(await namingInProject(params.docnetId, params.projectId)) ||
		!(await namingInProject(documentId, params.projectId))
	) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const result = await addDocumentToDocNet(
		params.projectId, locals.user!.id, params.docnetId, documentId
	);
	return json(result, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	const { documentId } = await request.json();
	if (!documentId) return json({ error: 'documentId required' }, { status: 400 });

	await removeDocumentFromDocNet(params.projectId, params.docnetId, documentId);
	return json({ ok: true });
};
