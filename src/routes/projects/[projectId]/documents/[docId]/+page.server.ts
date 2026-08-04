// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { getAnnotationsByDocument, getAnnotationsByProject, getAnnotationCandidates } from '$lib/server/db/queries/codes.js';
import { getProjectPhases, getPhaseMembers } from '$lib/server/db/queries/maps.js';
import { error } from '@sveltejs/kit';

/** Eine Sequenz aus `coding_runs.segmentation_snapshot` (siehe segmentation.ts). */
export interface SegmentSnapshot {
	seq: number;
	charStart: number;
	charEnd: number;
	sentenceCount: number;
}

export interface DocumentElement {
	id: string;
	element_type: string;
	content: string | null;
	parent_id: string | null;
	seq: number;
	char_start: number;
	char_end: number;
}

export const load: PageServerLoad = async ({ params }) => {
	const doc = await queryOne<{
		id: string;
		label: string;
		full_text: string | null;
		mime_type: string;
		file_size: number;
	}>(
		`SELECT n.id, n.inscription as label, dc.full_text, dc.mime_type, dc.file_size
		 FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[params.docId, params.projectId]
	);

	if (!doc) error(404, 'Document not found');

	const [annotations, candidates, elementsResult, projectAnnotations, documentsResult, stackResult, phases, runRow] = await Promise.all([
		getAnnotationsByDocument(params.projectId, params.docId),
		getAnnotationCandidates(params.projectId),
		query<DocumentElement>(
			`SELECT id, element_type, content, parent_id, seq, char_start, char_end
			 FROM document_elements WHERE document_id = $1
			 ORDER BY char_start, seq`,
			[params.docId]
		),
		getAnnotationsByProject(params.projectId),
		query<{ id: string; label: string }>(
			`SELECT n.id, n.inscription as label
			 FROM namings n
			 JOIN document_content dc ON dc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY n.inscription`,
			[params.projectId]
		),
		query<{ naming_id: string; designation: string | null; inscription: string | null; memo_text: string | null; seq: number; linked_naming_ids: string[] | null }>(
			`SELECT na.naming_id, na.designation, na.inscription, na.memo_text, na.seq, na.linked_naming_ids
			 FROM naming_acts na
			 JOIN namings n ON n.id = na.naming_id AND n.deleted_at IS NULL
			 WHERE n.project_id = $1
			 ORDER BY na.naming_id, na.seq`,
			[params.projectId]
		),
		getProjectPhases(params.projectId),
		// Segmentierung des jüngsten KI-Laufs. Sie ist die vollständige Einteilung
		// des Dokuments; Sequenz-Namings entstehen nur dort, wo im Lauf ein Titel
		// überlebt hat. Ohne diese Liste wären die übrigen Sequenzen unsichtbar —
		// der Leser sähe eine lückenhafte Gliederung und wüsste nicht, dass sie
		// lückenhaft ist. Deshalb kommt sie mit und trägt die Nummerierung.
		queryOne<{ segmentation_snapshot: SegmentSnapshot[] }>(
			`SELECT segmentation_snapshot
			 FROM coding_runs
			 WHERE document_id = $1 AND project_id = $2
			   AND jsonb_array_length(segmentation_snapshot) > 0
			 ORDER BY started_at DESC LIMIT 1`,
			[params.docId, params.projectId]
		)
	]);

	// Resolve phase members for filter support
	const phaseMemberMap: Record<string, string[]> = {};
	for (const c of phases) {
		const members = await getPhaseMembers(c.id);
		phaseMemberMap[c.id] = members.map((m: any) => m.naming_id);
	}

	return {
		document: doc,
		annotations,
		candidates,
		elements: elementsResult.rows,
		projectId: params.projectId,
		projectAnnotations,
		documents: documentsResult.rows,
		namingStacks: stackResult.rows,
		phases,
		phaseMemberMap,
		segments: (runRow?.segmentation_snapshot ?? []).map((s) => ({
			seq: s.seq,
			charStart: s.charStart,
			charEnd: s.charEnd,
			sentenceCount: s.sentenceCount
		}))
	};
};
