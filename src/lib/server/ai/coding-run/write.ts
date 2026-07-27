// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// SA-agnostic write path for the per-document coding run.
//
// Der Coding-Run kennt zwei Output-Klassen:
//
// 1. SName (Sequence-Naming, valence='thematizes', annotationKind='sequence-naming'):
//    Thematische Spanne über eine Sequenz, dient als Inhaltsverzeichnis
//    (Strauss/Clarke: "thematische Codes" als Lese-Hilfe vor dem feingliedrigen
//    Open Coding). Bekommt KEINE SitMap-Bridge, da TOC-Klasse, keine
//    analytische Karte.
//
// 2. CName (Code-Naming, valence='codes', annotationKind='code-naming'):
//    Klassische in-vivo / Strauss-zeilenweise offene Codes. Land auf dem
//    Grounding-Workspace und — über die system-weite Coding→Mapping-Bridge
//    in createAnnotation — unresolved auf der primären Situational Map,
//    genau wie menschliches In-vivo-Coding.
//
// Beide Pfade gehen über createOrphanNaming + createAnnotation, der
// Unterschied steckt in valence/annotationKind/placeOnPrimaryMap.
//
// Every write is stamped with { aiPersona: 'coding-run', aiRunId } so
// the codes are attributable to the Coding-Run Bearbeiter and can be
// hidden/filtered/rolled back as a unit.

import { query, queryOne, transaction } from '../../db/index.js';
import { createOrphanNaming, createAnnotation } from '../../db/queries/codes.js';
import { provenanceProps, type WriteProvenance } from '../runtime/tool-executor.js';

const AI_SYSTEM_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Find or create the Coding-Run "Bearbeiter" — the actor naming that
 * every coding-run naming_act is attributed to (Forscher-als-Naming).
 *
 * It carries a self-referential perspective appearance tagged
 * role='coding-run-agent'. That role is neither a map (no mapType) nor
 * the grounding workspace, so the Bearbeiter is invisible as a code and
 * invisible as a map — it is purely an actor.
 */
export async function getOrCreateCodingRunNaming(projectId: string): Promise<string> {
	const existing = await queryOne<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id AND a.mode = 'perspective'
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND a.properties->>'role' = 'coding-run-agent'
		 LIMIT 1`,
		[projectId]
	);
	if (existing) return existing.id;

	return transaction(async (client) => {
		const naming = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, 'Coding-Run', $2) RETURNING id`,
			[projectId, AI_SYSTEM_UUID]
		);
		const namingId = naming.rows[0].id;

		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', '{"role": "coding-run-agent"}')`,
			[namingId]
		);

		await client.query(
			`INSERT INTO naming_acts (naming_id, designation, by)
			 VALUES ($1, 'characterization', $1)`,
			[namingId]
		);

		return namingId;
	});
}

export interface CommitResult {
	codeId: string;
	codeLabel: string;
	isNewCode: boolean;
	isNewAnnotation: boolean;
	annotationId: string;
}

type CommitKind = 'sname' | 'cname';

async function findOrCreateNaming(
	projectId: string,
	bearbeiterNamingId: string,
	label: string,
	reasoning: string,
	prov: WriteProvenance,
	placeOnPrimaryMap: boolean
): Promise<{ id: string; isNew: boolean }> {
	// Reuse an existing naming (case-insensitive, any entity appearance).
	const existing = await query<{ id: string }>(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.mode = 'entity'
		 WHERE n.project_id = $1 AND n.deleted_at IS NULL
		   AND LOWER(n.inscription) = LOWER($2)
		 LIMIT 1`,
		[projectId, label]
	);
	if (existing.rows.length > 0) return { id: existing.rows[0].id, isNew: false };

	const code = await createOrphanNaming(projectId, AI_SYSTEM_UUID, label, {
		description: reasoning,
		provenance: provenanceProps(prov),
		placeOnPrimaryMap
	});
	// Initial designation: a fresh naming enters the gradient as a cue.
	await query(
		`INSERT INTO naming_acts (naming_id, designation, by) VALUES ($1, 'cue', $2)`,
		[code.id, bearbeiterNamingId]
	);
	return { id: code.id, isNew: true };
}

/**
 * Commit one coded passage: create-or-reuse the code naming, ground it
 * with an annotation relation to the document, and attach the Code-Memo
 * as a naming_act on the code (attributed to the Coding-Run Bearbeiter,
 * linked to the annotation — the established passage-memo pattern).
 *
 * Idempotenz (für Resume-Sicherheit nach Pause/Stuck/Restart):
 * `createAnnotation` ist server-seitig idempotent (skip-on-existing über
 * (codeId, documentId, anchor.pos0, anchor.pos1, valence)). Wir prüfen hier
 * zusätzlich VOR dem Annotation-Insert, ob die identische Annotation
 * schon existiert — und wenn ja, schreiben wir auch das Code-Memo NICHT
 * erneut (sonst entstünden Duplikat-naming_acts bei jedem Resume).
 * `isNewAnnotation: false` signalisiert dem Loop, dass die Sequenz
 * effektiv schon committet war.
 */
export async function commitCodedPassage(opts: {
	projectId: string;
	bearbeiterNamingId: string;
	documentId: string;
	codeLabel: string;
	anchor: { pos0: number; pos1: number; text: string; elementId?: string };
	reasoning: string;
	codeMemo: string;
	prov: WriteProvenance;
}): Promise<CommitResult> {
	return commitNamingPassage({ ...opts, kind: 'cname' });
}

/**
 * SName-Commit-Pfad: thematischer Bogen über eine ganze Sequenz.
 * Unterscheidet sich von commitCodedPassage in genau drei Punkten:
 *   - valence='thematizes' (statt 'codes')
 *   - annotationKind='sequence-naming' (statt 'code-naming')
 *   - placeOnPrimaryMap=false beim Naming-Erzeugen (kein SitMap-Auftauchen)
 *
 * Außerdem trägt die Annotation-Property `sequenceMeta` (z.B. Sequenz-
 * Index), damit Reader (insb. der TOC im Document-Page-Layout) die SNames
 * in Sequenzreihenfolge sortieren können, unabhängig vom Anker-Offset.
 */
export async function commitSequenceNaming(opts: {
	projectId: string;
	bearbeiterNamingId: string;
	documentId: string;
	codeLabel: string;
	anchor: { pos0: number; pos1: number; text: string; elementId?: string };
	reasoning: string;
	codeMemo: string;
	prov: WriteProvenance;
	sequenceMeta?: Record<string, unknown>;
}): Promise<CommitResult> {
	return commitNamingPassage({ ...opts, kind: 'sname' });
}

async function commitNamingPassage(opts: {
	projectId: string;
	bearbeiterNamingId: string;
	documentId: string;
	codeLabel: string;
	anchor: { pos0: number; pos1: number; text: string; elementId?: string };
	reasoning: string;
	codeMemo: string;
	prov: WriteProvenance;
	kind: CommitKind;
	sequenceMeta?: Record<string, unknown>;
}): Promise<CommitResult> {
	const {
		projectId,
		bearbeiterNamingId,
		documentId,
		codeLabel,
		anchor,
		reasoning,
		codeMemo,
		prov,
		kind,
		sequenceMeta
	} = opts;

	const valence: 'codes' | 'thematizes' = kind === 'sname' ? 'thematizes' : 'codes';
	const annotationKind: 'code-naming' | 'sequence-naming' =
		kind === 'sname' ? 'sequence-naming' : 'code-naming';
	const placeOnPrimaryMap = kind !== 'sname';

	const { id: codeId, isNew: isNewCode } = await findOrCreateNaming(
		projectId,
		bearbeiterNamingId,
		codeLabel,
		reasoning,
		prov,
		placeOnPrimaryMap
	);

	// Pre-Check: gibt es schon eine Annotation für (codeId, documentId,
	// anchor.pos0, anchor.pos1, valence)? Wenn ja, ist das ein Re-Commit
	// nach Resume und das Code-Memo wurde schon geschrieben — wir
	// überspringen den Memo-Insert, um Duplikat-naming_acts zu vermeiden.
	const annExisting = await query<{ id: string }>(
		`SELECT a.naming_id as id FROM appearances a
		 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
		 WHERE a.directed_from = $1 AND a.directed_to = $2 AND a.valence = $6
		   AND n.project_id = $3
		   AND a.properties->>'anchorType' = 'text'
		   AND a.properties->'anchor'->>'pos0' = $4
		   AND a.properties->'anchor'->>'pos1' = $5
		 LIMIT 1`,
		[codeId, documentId, projectId, String(anchor.pos0), String(anchor.pos1), valence]
	);

	let annotationId: string;
	let isNewAnnotation = false;

	if (annExisting.rows.length > 0) {
		annotationId = annExisting.rows[0].id;
	} else {
		const extraProperties: Record<string, unknown> = {};
		if (sequenceMeta) extraProperties.sequenceMeta = sequenceMeta;

		const ann = (await createAnnotation(
			projectId,
			AI_SYSTEM_UUID,
			codeId,
			documentId,
			'text',
			anchor,
			undefined,
			provenanceProps(prov),
			{ valence, annotationKind, extraProperties }
		)) as { id: string };
		annotationId = ann.id;
		isNewAnnotation = true;

		if (codeMemo && codeMemo.trim()) {
			await query(
				`INSERT INTO naming_acts (naming_id, by, memo_text, linked_naming_ids)
				 VALUES ($1, $2, $3, $4)`,
				[codeId, bearbeiterNamingId, codeMemo.trim(), [annotationId]]
			);
		}
	}

	return { codeId, codeLabel, isNewCode, isNewAnnotation, annotationId };
}
