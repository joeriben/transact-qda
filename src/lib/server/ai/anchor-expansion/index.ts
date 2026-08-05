// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Anker-Zug: ein Strukturmuster des Forschers am Material prüfen.
//
// Zwei Schritte, in dieser Reihenfolge und getrennt gehalten:
//
//   sichten    — deterministisch, ohne Modell: wie der Text gebaut ist, wo die
//                Zuschreibung reißt, und wie er zu schneiden ist. Kostet nichts
//                und läuft in Millisekunden.
//   vorbereiten— das Kriterium aus Naming, Memo und Belegstelle ableiten und
//                VORLEGEN. Ein Modellaufruf. Der Forscher korrigiert es, bevor
//                gelaufen wird; es ist sein Muster, nicht das des Helfers.
//   durchgehen — jede Stelle mit dem freigegebenen Kriterium prüfen.
//
// Nichts hiervon schreibt in den Datenraum. Das Ergebnis ist eine Liste von
// Hinweisen, die außerhalb bleibt, bis der Forscher eine davon durch einen
// eigenen Akt hereinholt — als Anker, als Memo, oder gar nicht.

import { query } from '../../db/index.js';
import { sichten, zuegeOf, zuegeOverlapping, type Gestalt, type Zug } from './gestalt.js';
import {
	ableitenKriterium,
	pruefeStellen,
	type Kriterium,
	type Stelle,
	type UnlesbareStelle
} from './recognize.js';

export { sichten, zuegeOf, zuegeOverlapping } from './gestalt.js';
export type { Gestalt, Zug, Bruch, Position, Verteilung } from './gestalt.js';
export { NICHT_EINSCHLAEGIG } from './recognize.js';
export type { Kriterium, Bestandteil, Relation, Befund, Stelle, UnlesbareStelle } from './recognize.js';

// ── Laden ─────────────────────────────────────────────────────────

export interface MusterQuelle {
	inscription: string;
	memos: string[];
	anchors: { documentId: string; pos0: number; pos1: number }[];
}

/**
 * Das Muster, wie der Forscher es hinterlassen hat: die Inschrift, seine Memos,
 * seine Belegstellen. Nur seine — KI-gesetzte Anker (`aiPersona`) tragen kein
 * Muster, das zu prüfen wäre; sie wären ein Selbstgespräch.
 */
export async function ladeMuster(projectId: string, namingId: string): Promise<MusterQuelle> {
	const head = await query<{ inscription: string }>(
		`SELECT inscription FROM namings WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL`,
		[namingId, projectId]
	);
	if (head.rows.length === 0) throw new Error('Naming nicht in diesem Projekt.');

	const memos = await query<{ memo_text: string }>(
		`SELECT memo_text FROM naming_acts
		  WHERE naming_id=$1 AND memo_text IS NOT NULL AND btrim(memo_text) <> '' ORDER BY seq`,
		[namingId]
	);
	const anchors = await query<{ documentId: string; pos0: number; pos1: number }>(
		`SELECT a.directed_to AS "documentId",
		        (a.properties->'anchor'->>'pos0')::int AS pos0,
		        (a.properties->'anchor'->>'pos1')::int AS pos1
		   FROM appearances a
		   JOIN namings d ON d.id=a.directed_to AND d.deleted_at IS NULL
		  WHERE a.mode='relation' AND a.directed_from=$1
		    AND a.properties->>'anchorType'='text'
		    AND a.properties->>'aiPersona' IS NULL
		    AND a.properties->'anchor'->>'pos0' IS NOT NULL
		  ORDER BY (a.properties->'anchor'->>'pos0')::int`,
		[namingId]
	);
	return {
		inscription: head.rows[0].inscription,
		memos: memos.rows.map((r) => r.memo_text.trim()),
		anchors: anchors.rows
	};
}

export async function ladeVolltext(projectId: string, documentId: string): Promise<string> {
	const r = await query<{ full_text: string }>(
		`SELECT dc.full_text FROM document_content dc
		   JOIN namings d ON d.id=dc.naming_id
		  WHERE dc.naming_id=$1 AND d.project_id=$2 AND d.deleted_at IS NULL AND dc.full_text IS NOT NULL`,
		[documentId, projectId]
	);
	if (r.rows.length === 0) throw new Error('Dokument ohne Volltext in diesem Projekt.');
	return r.rows[0].full_text;
}

// ── Belegstelle ───────────────────────────────────────────────────

export interface Belegstelle {
	/** Der Wortlaut mit Anlauf, so wie er dem Modell vorgelegt wird. */
	text: string;
	/** Die Züge, die die markierte Spanne überlappen — beim Lauf ausgenommen. */
	zuege: Zug[];
}

/**
 * Die Belegstelle mit Anlauf.
 *
 * Der markierte Ausschnitt allein trägt den Zug oft nicht: Was ihn trägt, steht
 * regelmäßig in den Sätzen davor, und was man markiert, ist die Stelle, an der
 * man ihn bemerkt hat. Deshalb gehen zwei Züge Anlauf mit — mit ihrer
 * Zuschreibung, damit nicht wieder die falsche Position als Akteur erscheint.
 */
export function belegstelleOf(
	zuege: Zug[],
	anchors: { documentId: string; pos0: number; pos1: number }[],
	documentId: string,
	anlauf = 2
): Belegstelle | null {
	for (const a of anchors) {
		if (a.documentId !== documentId) continue;
		const treffer = zuegeOverlapping(zuege, a.pos0, a.pos1);
		if (treffer.length === 0) continue;
		const idx = zuege.indexOf(treffer[0]);
		const text = [...zuege.slice(Math.max(0, idx - anlauf), idx), ...treffer]
			.map((z) => `[${z.position}] ${z.text}`)
			.join('\n');
		return { text, zuege: treffer };
	}
	return null;
}

// ── Vorbereitung ──────────────────────────────────────────────────

export interface Vorbereitung {
	gestalt: Gestalt;
	zuegeGesamt: number;
	belegstelle: string | null;
	/** Zeichenspannen der Belegstellen-Züge — die UI hebt sie hervor. */
	belegZuege: { charStart: number; charEnd: number }[];
	inscription: string;
	memos: string[];
	kriterium: Kriterium | null;
}

/**
 * Alles, was vor einem Lauf auf dem Tisch liegen muss. Das Kriterium wird nur
 * abgeleitet, wenn keines mitgegeben ist — der Forscher kann es korrigieren und
 * zurückgeben, ohne dass es erneut erfunden wird.
 */
export async function vorbereiten(
	projectId: string,
	namingId: string,
	documentId: string,
	opts: { kriterium?: Kriterium | null; signal?: AbortSignal } = {}
): Promise<Vorbereitung> {
	const [muster, fullText] = await Promise.all([
		ladeMuster(projectId, namingId),
		ladeVolltext(projectId, documentId)
	]);
	const gestalt = sichten(fullText);
	const zuege = zuegeOf(fullText, gestalt);
	const beleg = belegstelleOf(zuege, muster.anchors, documentId);

	let kriterium = opts.kriterium ?? null;
	if (!kriterium && beleg) {
		kriterium = await ableitenKriterium(muster.inscription, muster.memos, beleg.text, opts.signal);
	}

	return {
		gestalt,
		zuegeGesamt: zuege.length,
		belegstelle: beleg?.text ?? null,
		belegZuege: (beleg?.zuege ?? []).map((z) => ({ charStart: z.charStart, charEnd: z.charEnd })),
		inscription: muster.inscription,
		memos: muster.memos,
		kriterium
	};
}

// ── Durchgang ─────────────────────────────────────────────────────

export interface DurchgangOptions {
	concurrency?: number;
	signal?: AbortSignal;
	/** Die Belegstelle mitprüfen — eine Probe, ob das Kriterium sie wiederfindet. */
	belegstelleMitpruefen?: boolean;
	onProgress?: (done: number, total: number) => void;
	onStelle?: (stelle: Stelle) => void;
}

export interface Durchgang {
	stellen: Stelle[];
	/** Stellen, deren Antwort nicht auswertbar war — ungeprüft, nicht „ohne Bezug". */
	unlesbar: UnlesbareStelle[];
	geprueft: number;
	/** Je Position: wie viele Stellen geprüft wurden. Nenner der Verteilung. */
	geprueftJePosition: Record<string, number>;
	gestalt: Gestalt;
	kriterium: Kriterium;
}

export async function durchgehen(
	projectId: string,
	namingId: string,
	documentId: string,
	kriterium: Kriterium,
	opts: DurchgangOptions = {}
): Promise<Durchgang> {
	const [muster, fullText] = await Promise.all([
		ladeMuster(projectId, namingId),
		ladeVolltext(projectId, documentId)
	]);
	const gestalt = sichten(fullText);
	const zuege = zuegeOf(fullText, gestalt);
	const beleg = belegstelleOf(zuege, muster.anchors, documentId);
	if (!beleg) throw new Error('Dieses Naming hat in diesem Dokument keine Belegstelle.');

	// Die Belegstelle bleibt draußen: Sie ist die Vorgabe, nicht der Fund.
	const scope = opts.belegstelleMitpruefen ? zuege : zuege.filter((z) => !beleg.zuege.includes(z));

	const geprueftJePosition: Record<string, number> = {};
	for (const z of scope) geprueftJePosition[z.position] = (geprueftJePosition[z.position] ?? 0) + 1;

	const { stellen, unlesbar } = await pruefeStellen(
		muster.inscription,
		muster.memos,
		beleg.text,
		kriterium,
		gestalt,
		zuege,
		scope,
		{
			concurrency: opts.concurrency ?? 6,
			signal: opts.signal,
			onProgress: opts.onProgress,
			onStelle: opts.onStelle
		}
	);

	return { stellen, unlesbar, geprueft: scope.length, geprueftJePosition, gestalt, kriterium };
}
