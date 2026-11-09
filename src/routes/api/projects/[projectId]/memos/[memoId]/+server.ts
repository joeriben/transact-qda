// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMemo, updateMemoContent, linkMemoToNaming, unlinkMemo, getLinkableNamings } from '$lib/server/db/queries/memos.js';
import { namingInProject } from '$lib/server/auth/authz.js';

export const GET: RequestHandler = async ({ params }) => {
	const memo = await getMemo(params.memoId, params.projectId);
	if (!memo) return json({ error: 'Not found' }, { status: 404 });
	return json(memo);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { content } = await request.json();
	if (content !== undefined) {
		// Scope the memo UUID to this project (must not edit a foreign memo)
		if (!(await namingInProject(params.memoId, params.projectId))) {
			return json({ error: 'Not found' }, { status: 404 });
		}
		// Ein Memo von Cowork bleibt sein Text: Unter KI-Autorschaft
		// umgeschrieben, wäre der Akt nicht mehr ausweisbar. Die Forscherin
		// urteilt darüber (ack, dismiss, promote) oder schreibt ein eigenes.
		const memo = await getMemo(params.memoId, params.projectId);
		if (memo?.is_ai) {
			return json(
				{ error: "Cowork's memos are not edited in place. Judge it (ack, dismiss, promote) or write a memo of your own." },
				{ status: 403 }
			);
		}
		await updateMemoContent(params.memoId, content);
	}
	return json({ ok: true });
};

// Verweise eines eigenen Memos auf Namings setzen oder lösen (Testlauf 11:
// ein freies Memo ließ sich mit keinem Naming verknüpfen, obwohl das
// Handbuch es beschreibt). Cowork-Memos bleiben, wie sie geschrieben wurden.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as { action?: string; namingId?: string; linkId?: string } | null;
	const memo = await getMemo(params.memoId, params.projectId);
	if (!memo) return json({ error: 'Not found' }, { status: 404 });
	if (memo.is_ai) {
		return json({ error: "Cowork's memos keep their links. Write a memo of your own to refer to a naming." }, { status: 403 });
	}
	if (body?.action === 'link') {
		const namingId = String(body.namingId ?? '');
		// Nur Namings der Naming-Liste (keine Memos, Dokumente, Maps).
		if (!(await getLinkableNamings(params.projectId)).some((n) => n.id === namingId)) {
			return json({ error: 'No such naming in this project' }, { status: 400 });
		}
		const res = await linkMemoToNaming(params.memoId, params.projectId, locals.user!.id, namingId);
		return json({ ok: true, ...res });
	}
	if (body?.action === 'unlink') {
		const ok = await unlinkMemo(params.memoId, params.projectId, String(body.linkId ?? ''));
		return ok ? json({ ok: true }) : json({ error: 'No such link' }, { status: 404 });
	}
	return json({ error: 'Unknown action' }, { status: 400 });
};
