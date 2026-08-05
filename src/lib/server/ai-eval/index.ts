// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI-Evaluation audit layer — SEPARABLE from the empirical core.
//
// This module records and extracts a researcher's verdicts on AI-produced
// namings ("AI codes"). It evaluates the PROVISIONAL AI-Naming subsystem and
// is meant to be removable as a unit:
//
//   Removal contract:  DROP TABLE ai_naming_evaluations
//                    + delete this directory (src/lib/server/ai-eval)
//                    + remove the reader UI control (AiEvalControl.svelte + its
//                      one usage site).
//   No migration on any core table.
//
// Dependency direction is ONE-WAY (audit -> core): this module reads/writes its
// own table and only *references* core rows by id + anchor. Nothing in the
// empirical core (namings / naming_acts / appearances and their query modules)
// imports from here. If that ever reverses, separability is broken.

import { query, queryOne } from '../db/index.js';

export type Verdict = 'accept' | 'reject' | 'revise';

export const VERDICTS: readonly Verdict[] = ['accept', 'reject', 'revise'];

export function isVerdict(v: unknown): v is Verdict {
	return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v);
}

export interface EvaluationInput {
	projectId: string;
	documentId: string | null;
	/** Soft ref to the live AI naming being judged; null if unknown/removed. */
	subjectNamingId: string | null;
	/** Snapshot of the AI code's inscription at judgment time (self-contained). */
	subjectLabel: string;
	/** Passage offsets — the join key for aligning parallel human/AI codings. */
	anchor?: { pos0: number; pos1: number; text: string } | null;
	verdict: Verdict;
	rationale?: string | null;
	betterReading?: string | null;
	/** The USER who judged (audit plane), not a naming. */
	evaluatorUserId: string | null;
}

export interface EvaluationRow {
	id: string;
	documentId: string | null;
	subjectNamingId: string | null;
	subjectLabel: string;
	anchor: { pos0: number; pos1: number; text: string | null } | null;
	verdict: Verdict;
	rationale: string | null;
	betterReading: string | null;
	evaluatorUserId: string | null;
	createdAt: string;
}

interface EvalDbRow {
	id: string;
	document_id: string | null;
	subject_naming_id: string | null;
	subject_label: string;
	anchor_pos0: number | null;
	anchor_pos1: number | null;
	anchor_text: string | null;
	verdict: Verdict;
	rationale: string | null;
	better_reading: string | null;
	evaluator_user_id: string | null;
	created_at: string;
}

function mapRow(r: EvalDbRow): EvaluationRow {
	return {
		id: r.id,
		documentId: r.document_id,
		subjectNamingId: r.subject_naming_id,
		subjectLabel: r.subject_label,
		anchor:
			r.anchor_pos0 !== null && r.anchor_pos1 !== null
				? { pos0: r.anchor_pos0, pos1: r.anchor_pos1, text: r.anchor_text }
				: null,
		verdict: r.verdict,
		rationale: r.rationale,
		betterReading: r.better_reading,
		evaluatorUserId: r.evaluator_user_id,
		createdAt: r.created_at
	};
}

/**
 * Record one verdict. APPEND-ONLY: every call INSERTs a new row. A changed
 * judgment is a new row — prior judgments are never overwritten, because the
 * history of judgments IS the audit record (the observability the AI layer owes).
 */
export async function recordEvaluation(
	input: EvaluationInput
): Promise<{ id: string; createdAt: string }> {
	const row = await queryOne<{ id: string; created_at: string }>(
		`INSERT INTO ai_naming_evaluations
		   (project_id, document_id, subject_naming_id, subject_label,
		    anchor_pos0, anchor_pos1, anchor_text,
		    verdict, rationale, better_reading, evaluator_user_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		 RETURNING id, created_at`,
		[
			input.projectId,
			input.documentId,
			input.subjectNamingId,
			input.subjectLabel,
			input.anchor?.pos0 ?? null,
			input.anchor?.pos1 ?? null,
			input.anchor?.text ?? null,
			input.verdict,
			input.rationale ?? null,
			input.betterReading ?? null,
			input.evaluatorUserId
		]
	);
	return { id: row!.id, createdAt: row!.created_at };
}

/** Full append-only history of verdicts for one document (newest last). */
export async function getEvaluationsForDocument(
	projectId: string,
	documentId: string
): Promise<EvaluationRow[]> {
	const res = await query<EvalDbRow>(
		`SELECT id, document_id, subject_naming_id, subject_label,
		        anchor_pos0, anchor_pos1, anchor_text,
		        verdict, rationale, better_reading, evaluator_user_id, created_at
		 FROM ai_naming_evaluations
		 WHERE project_id = $1 AND document_id = $2
		 ORDER BY created_at`,
		[projectId, documentId]
	);
	return res.rows.map(mapRow);
}

export interface LatestVerdict {
	subjectNamingId: string;
	verdict: Verdict;
	createdAt: string;
	evaluatorUserId: string | null;
	/** Anzeigename des Urteilenden; null, wenn das Konto nicht mehr existiert. */
	evaluatorName: string | null;
	/** Wie viele Mitglieder ueberhaupt ein Urteil zu diesem Naming abgegeben haben. */
	evaluatorCount: number;
}

/**
 * Letztes Urteil je beurteiltem Naming im ganzen Projekt — MIT dem Urteilenden.
 *
 * Für Ansichten, die ein Naming zeigen, ohne an einem Dokument zu stehen — die
 * Karte etwa. Dort ist die Einheit das Naming, nicht die Passage: maßgeblich ist
 * das zuletzt gegebene Urteil über dieses Naming, gleich an welcher Passage.
 * Die Historie bleibt vollständig in der Tabelle; hier steht nur ihr Rand.
 *
 * Der Urteilende gehört zwingend dazu. Ein Projekt kann mehrere Mitglieder
 * haben, und ein Verdikt ist der Ort, an dem ein Mensch Verantwortung ausübt
 * (docs/design-begleiten.md, Satz IV) — eine Ansicht, die ausgraut, ohne zu
 * sagen wessen Urteil das war, schreibt die Handlung des einen dem anderen zu.
 * `evaluatorCount` zeigt an, wo mehrere geurteilt haben und „das letzte gewinnt"
 * eine Meinungsverschiedenheit verdeckt.
 *
 * Der Join auf `users` bricht den Trennungsvertrag nicht: users ist die
 * Auth-Tabelle, keine Kerntabelle der Ontologie (namings/naming_acts/
 * appearances), und die Richtung bleibt audit -> aussen.
 */
export async function getLatestVerdictsForProject(
	projectId: string
): Promise<LatestVerdict[]> {
	const res = await query<{
		subject_naming_id: string;
		verdict: Verdict;
		created_at: string;
		evaluator_user_id: string | null;
		evaluator_name: string | null;
		evaluator_count: string;
	}>(
		`SELECT DISTINCT ON (e.subject_naming_id)
		        e.subject_naming_id, e.verdict, e.created_at, e.evaluator_user_id,
		        COALESCE(NULLIF(u.display_name, ''), u.email) AS evaluator_name,
		        (SELECT count(DISTINCT e2.evaluator_user_id)
		           FROM ai_naming_evaluations e2
		          WHERE e2.project_id = e.project_id
		            AND e2.subject_naming_id = e.subject_naming_id) AS evaluator_count
		 FROM ai_naming_evaluations e
		 LEFT JOIN users u ON u.id = e.evaluator_user_id
		 WHERE e.project_id = $1 AND e.subject_naming_id IS NOT NULL
		 ORDER BY e.subject_naming_id, e.created_at DESC`,
		[projectId]
	);
	return res.rows.map((r) => ({
		subjectNamingId: r.subject_naming_id,
		verdict: r.verdict,
		createdAt: r.created_at,
		evaluatorUserId: r.evaluator_user_id,
		evaluatorName: r.evaluator_name,
		evaluatorCount: Number(r.evaluator_count) || 0
	}));
}

/**
 * Corpus size, split by verdict. The training question ("enough data yet?") is
 * this one query away — no archaeology through logs or on-disk traces.
 * Pass a projectId to scope, or omit for the whole installation.
 */
export async function countEvaluations(
	projectId?: string
): Promise<{ verdict: string; n: number }[]> {
	const res = projectId
		? await query<{ verdict: string; n: string }>(
				`SELECT verdict, count(*)::text AS n FROM ai_naming_evaluations
				 WHERE project_id = $1 GROUP BY verdict ORDER BY verdict`,
				[projectId]
			)
		: await query<{ verdict: string; n: string }>(
				`SELECT verdict, count(*)::text AS n FROM ai_naming_evaluations
				 GROUP BY verdict ORDER BY verdict`
			);
	return res.rows.map((r) => ({ verdict: r.verdict, n: Number(r.n) }));
}
