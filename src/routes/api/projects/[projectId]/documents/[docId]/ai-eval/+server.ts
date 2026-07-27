// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI-Evaluation endpoint — capture a researcher's verdict (+ rationale/memo)
// on an AI-produced naming, and read back the verdicts for a document.
//
// Part of the SEPARABLE AI-Evaluation audit layer (see src/lib/server/ai-eval).
// Removing the AI layer = delete this route folder + the ai-eval module + the
// reader UI control; no change to any core route.
//
//   POST — record one append-only verdict for this document.
//   GET  — list the verdicts recorded for this document (newest last).
//
// Project membership is enforced twice: centrally by hooks.server.ts, and again
// here via ensureDocAccess (defense in depth — the endpoint does not rely on the
// hook alone).

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import {
	recordEvaluation,
	getEvaluationsForDocument,
	isVerdict
} from '$lib/server/ai-eval/index.js';

/** Document exists in project (404) AND user is a member (403). */
async function ensureDocAccess(projectId: string, docId: string, userId: string): Promise<void> {
	const doc = await queryOne<{ id: string }>(
		`SELECT id FROM namings WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[docId, projectId]
	);
	if (!doc) error(404, 'Document not found in this project');
	const member = await queryOne<{ role: string }>(
		`SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
		[projectId, userId]
	);
	if (!member) error(403, 'Not a member of this project');
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId and docId required');
	await ensureDocAccess(projectId, docId, locals.user.id);

	const body = (await request.json().catch(() => null)) as {
		subjectNamingId?: string | null;
		subjectLabel?: string;
		anchor?: { pos0: number; pos1: number; text: string } | null;
		verdict?: string;
		rationale?: string | null;
		betterReading?: string | null;
	} | null;

	if (!body) error(400, 'JSON body required');
	if (!isVerdict(body.verdict)) error(400, "verdict must be 'accept', 'reject' or 'revise'");
	const subjectLabel = (body.subjectLabel ?? '').trim();
	if (!subjectLabel) error(400, 'subjectLabel required');

	const anchor =
		body.anchor &&
		Number.isFinite(body.anchor.pos0) &&
		Number.isFinite(body.anchor.pos1)
			? {
					pos0: Math.trunc(body.anchor.pos0),
					pos1: Math.trunc(body.anchor.pos1),
					text: String(body.anchor.text ?? '')
				}
			: null;

	const { id, createdAt } = await recordEvaluation({
		projectId,
		documentId: docId,
		subjectNamingId: body.subjectNamingId ?? null,
		subjectLabel,
		anchor,
		verdict: body.verdict,
		rationale: body.rationale?.trim() || null,
		betterReading: body.betterReading?.trim() || null,
		evaluatorUserId: locals.user.id
	});

	return json({ ok: true, id, createdAt }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const { projectId, docId } = params;
	if (!projectId || !docId) error(400, 'projectId and docId required');
	await ensureDocAccess(projectId, docId, locals.user.id);

	const evaluations = await getEvaluationsForDocument(projectId, docId);
	return json({ evaluations });
};
