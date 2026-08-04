// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json, error } from '@sveltejs/kit';
import { query } from '$lib/server/db/index.js';

/**
 * Das Etikett eines Dokuments ändern.
 *
 * Dateien zu benennen ist kein Naming. Weder der Scanner-Name
 * („895503ngfi_qx3.docx") noch ein sorgfältig gesetzter („Interview Frau K.,
 * 3.4.") zeichnet etwas am Material aus — beide adressieren einen Behälter,
 * damit man ihn wiederfindet. Der Designations-Gradient handelt davon, was im
 * Material als etwas angesprochen wird; ein Behälteretikett steht außerhalb.
 * Deshalb entsteht hier KEIN naming_act, in keinem Fall.
 *
 * Dass Dokumente als Zeile in `namings` liegen, ist eine Eigenschaft der
 * Speicherung — `namings` ist die universelle Knotentabelle dieser Anlage.
 * Ein Dokument bekommt keine `entity`-Appearance und taucht folgerichtig in
 * keiner Namings-Liste und auf keiner Map auf.
 *
 * Was hier trotzdem zu schützen war: bis Migration 035 stand der Importname
 * einzig in dieser Inskription — die Datei auf der Platte heißt
 * `files/<uuid>.<ext>` und trägt ihn nicht. Umbenennen löschte ihn ersatzlos.
 * Er liegt jetzt in `document_content.original_filename` bei den übrigen
 * technischen Angaben zur Datei; das Etikett kann sich darüber frei ändern.
 */
export async function PATCH({ params, request, locals }) {
	const { projectId, docId } = params;
	const { label } = await request.json();
	if (!label?.trim()) throw error(400, 'Label required');

	// Auf Dokumente des Projekts gescopt — der Join auf document_content
	// verhindert, dass hier ein beliebiges Naming umgeschrieben wird.
	const result = await query(
		`UPDATE namings n SET inscription = $1
		 FROM document_content dc
		 WHERE dc.naming_id = n.id
		   AND n.id = $2 AND n.project_id = $3 AND n.deleted_at IS NULL
		 RETURNING n.id`,
		[label.trim(), docId, projectId]
	);
	if (result.rows.length === 0) throw error(404, 'Document not found');

	return json({ ok: true, label: label.trim() });
}

export async function DELETE({ params }) {
	const { projectId, docId } = params;

	// Verify document exists and belongs to project
	const doc = await query(
		`SELECT n.id FROM namings n
		 JOIN document_content dc ON dc.naming_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[docId, projectId]
	);
	if (doc.rows.length === 0) {
		throw error(404, 'Document not found');
	}

	// Soft-delete the document naming
	await query(
		`UPDATE namings SET deleted_at = now() WHERE id = $1`,
		[docId]
	);

	// Clean up document elements (embeddings, parsed structure)
	await query(
		`DELETE FROM document_elements WHERE document_id = $1`,
		[docId]
	);

	return json({ ok: true });
}
