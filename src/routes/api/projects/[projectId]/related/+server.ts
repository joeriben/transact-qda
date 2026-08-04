// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Verwandte Passagen — lexikalisch, mit ausgewiesenem Grund.
//
// Bedient zwei Fragen über denselben Weg:
//   { text }                          → Suche über das Material
//   { documentId, pos0, pos1 }        → „was gehört noch hierher"
//   { documentId, seq }               → dasselbe für eine Sequenznummer
//
// Ausschließlich POST, auch für die Suche: Suchbegriffe über Forschungs-
// material gehören nicht in eine URL (Verlauf, Logs, Referer).
//
// Nur lesend. Projekt-Mitgliedschaft prüft hooks.server.ts zentral; hier
// wird ausschließlich innerhalb von params.projectId gerechnet, sodass
// keine projektfremde Kennung durchschlagen kann.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	findRelatedToText,
	findRelatedToSequence,
	findRelatedToRange
} from '$lib/server/corpus-structure/relatedness.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'JSON body required' }, { status: 400 });

	const {
		text,
		documentId,
		seq,
		pos0,
		pos1,
		scope,
		limit,
		speakers,
		crossDocumentOnly,
		minShared
	} = body as Record<string, unknown>;

	const opts = {
		scope: scope === 'in-document' ? ('in-document' as const) : ('project' as const),
		scopeDocumentId: typeof documentId === 'string' ? documentId : undefined,
		limit: typeof limit === 'number' ? Math.min(Math.max(1, limit), 50) : 10,
		speakers: Array.isArray(speakers) ? (speakers as string[]) : undefined,
		crossDocumentOnly: crossDocumentOnly === true,
		minShared: typeof minShared === 'number' ? minShared : undefined
	};

	try {
		if (typeof documentId === 'string' && typeof seq === 'number') {
			const { passages, source, corpusUnits } = await findRelatedToSequence(
				params.projectId,
				documentId,
				seq,
				opts
			);
			return json({
				mode: 'sequence',
				passages,
				corpusUnits,
				sourceText: source?.text ?? null,
				sourceRange: source ? { charStart: source.charStart, charEnd: source.charEnd } : null
			});
		}
		if (typeof documentId === 'string' && typeof pos0 === 'number' && typeof pos1 === 'number') {
			const r = await findRelatedToRange(params.projectId, documentId, pos0, pos1, opts);
			return json({ mode: 'range', ...r });
		}
		if (typeof text === 'string' && text.trim().length > 0) {
			const r = await findRelatedToText(params.projectId, text, opts);
			return json({ mode: 'text', ...r });
		}
		return json(
			{ error: 'Provide { text } or { documentId, seq } or { documentId, pos0, pos1 }' },
			{ status: 400 }
		);
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'Relatedness query failed' },
			{ status: 500 }
		);
	}
};
