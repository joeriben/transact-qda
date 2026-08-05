// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Das Kriterium eines Namings — abgelegt, nicht bei jedem Öffnen neu erfunden.
//
// Die Ableitung aus Naming und Memo ist ein Vorschlag. Was zählt, ist das
// Kriterium, das der Forscher stehen lässt oder korrigiert: „Die bloße
// Ja/Nein-Rückfrage ist kein Fall" steht in keinem Memo und folgt aus keiner
// Ableitung — es ist seine Entscheidung, und sie muss den Sitzungsschluss
// überleben.
//
// Zwei Gründe, warum das nicht bloß Bequemlichkeit ist:
//   * Die Ableitung schwankt. Dasselbe Naming bekam an einem Tag einen, am
//     nächsten drei Bestandteile. Zwei Läufe über dasselbe Material sind dann
//     nicht vergleichbar, ohne dass irgendwo stünde, warum.
//   * Eine Korrektur, die beim Schließen des Panels verfällt, ist keine.
//
// Schreibt NICHT in den Datenraum: Ein Kriterium sagt, wonach der Helfer sucht,
// nicht was der Fall ist. Kein `naming_acts`-Eintrag, keine Designation.

import { query } from '../../db/index.js';
import type { Kriterium } from './recognize.js';

export interface AbgelegtesKriterium {
	kriterium: Kriterium;
	/** Aus der Hand des Forschers, nicht aus der Ableitung. */
	vonHand: boolean;
	updatedAt: string;
}

/** Das abgelegte Kriterium dieses Namings — oder nichts, wenn noch keines da ist. */
export async function ladeKriterium(
	projectId: string,
	namingId: string
): Promise<AbgelegtesKriterium | null> {
	const r = await query<{ kriterium: Kriterium; von_hand: boolean; updated_at: string }>(
		`SELECT kriterium, von_hand, updated_at FROM anker_kriterien
		  WHERE naming_id = $1 AND project_id = $2`,
		[namingId, projectId]
	);
	if (r.rows.length === 0) return null;
	return { kriterium: r.rows[0].kriterium, vonHand: r.rows[0].von_hand, updatedAt: r.rows[0].updated_at };
}

/**
 * Das Kriterium dieses Namings festhalten.
 *
 * `vonHand` bleibt einmal gesetzt stehen, auch wenn später wieder über die
 * Ableitung geschrieben wird — wer einmal korrigiert hat, soll nicht durch
 * einen beiläufigen Lauf zurück auf den Vorschlag gesetzt werden. Zurück auf
 * „abgeleitet" kommt nur, wer ausdrücklich neu ableiten lässt (siehe
 * `neuAbleiten`).
 */
export async function speichereKriterium(
	projectId: string,
	namingId: string,
	kriterium: Kriterium,
	opts: { vonHand: boolean; userId?: string | null } = { vonHand: false }
): Promise<void> {
	await query(
		`INSERT INTO anker_kriterien (naming_id, project_id, kriterium, von_hand, updated_by)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (naming_id) DO UPDATE
		    SET kriterium  = EXCLUDED.kriterium,
		        von_hand   = anker_kriterien.von_hand OR EXCLUDED.von_hand,
		        updated_at = now(),
		        updated_by = EXCLUDED.updated_by`,
		[namingId, projectId, JSON.stringify(kriterium), opts.vonHand, opts.userId ?? null]
	);
}

/**
 * Das abgelegte Kriterium verwerfen, damit die Ableitung wieder greift.
 *
 * Ausdrücklich und mit einer eigenen Handlung — eine Korrektur soll nicht
 * nebenbei verlorengehen.
 */
export async function neuAbleiten(projectId: string, namingId: string): Promise<void> {
	await query(`DELETE FROM anker_kriterien WHERE naming_id = $1 AND project_id = $2`, [
		namingId,
		projectId
	]);
}
