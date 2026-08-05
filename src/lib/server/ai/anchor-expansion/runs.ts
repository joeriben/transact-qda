// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lauf-Buchführung für den Anker-Zug.
//
// Zwei Fragen beantwortet diese Schicht, und nur diese:
//   Welche Dokumente gibt es, und was ist dort schon gelaufen?
//   Was kam dabei heraus, ohne es neu erzeugen zu müssen?
//
// Sie schreibt NICHT in den Datenraum. Was hier liegt, sind Hinweise; ob daraus
// ein Anker wird, entscheidet ein Akt des Forschers über die Annotations-Route.
// Der Kern verweist nicht hierher — entfernen heißt DROP TABLE.

import { createHash } from 'node:crypto';
import { query } from '../../db/index.js';
import { sichten, zuegeOf } from './gestalt.js';
import type { Kriterium, Stelle, Verbrauch } from './recognize.js';

/**
 * Der Fingerabdruck des Kriteriums. Er entscheidet, ob ein Lauf als „schon
 * gelaufen" gilt: Ein geändertes Kriterium ist ein anderer Durchgang, und das
 * Ergebnis des alten sagt über ihn nichts.
 *
 * Nur die Felder, die den Lauf steuern — der Ertrag einer Relation steht im
 * Prompt nicht und ändert das Ergebnis nicht.
 */
export function kriteriumHash(k: Kriterium): string {
	const kern = {
		akteur: k.akteur.trim(),
		adressat: k.adressat.trim(),
		bestandteile: k.bestandteile.map((b) => [b.name.trim(), b.kenntlich.trim()]),
		relationen: k.relationen.map((r) => [r.name.trim(), r.bedingung.trim()])
	};
	return createHash('sha256').update(JSON.stringify(kern)).digest('hex').slice(0, 16);
}

export interface LaufNotiz {
	id: string;
	createdAt: string;
	model: string;
	kriteriumHash: string;
	zuegeGesamt: number;
	geprueft: number;
	stellen: number;
	unlesbar: number;
	nichtBelegt: number;
	verbrauch: Verbrauch | null;
	sekunden: number | null;
	abgebrochen: boolean;
	fehler: string | null;
}

export interface DokumentStand {
	documentId: string;
	inscription: string;
	zeichen: number;
	/** Was ein Durchgang hier prüfen würde — deterministisch, ohne Modell. */
	zuege: number;
	/** Marken des Forschers zu diesem Naming in diesem Dokument. */
	marken: number;
	/** Der jüngste Lauf zu diesem Naming, gleich mit welchem Kriterium. */
	letzterLauf: LaufNotiz | null;
	/** Ist der jüngste Lauf mit DEM Kriterium gelaufen, das jetzt gilt? */
	aktuell: boolean;
}

/**
 * Alle Dokumente des Projekts mit ihrem Stand zu diesem Naming.
 *
 * Die Zugzahl wird hier gerechnet und nicht geschätzt: Sie ist der Kostentreiber
 * und steht vor jedem Aufruf fest. Ein Dokument ohne Läufe ist damit nicht nur
 * „noch offen", sondern beziffert offen.
 */
export async function dokumentStand(
	projectId: string,
	namingId: string,
	kriterium: Kriterium | null
): Promise<DokumentStand[]> {
	const hash = kriterium ? kriteriumHash(kriterium) : null;

	const docs = await query<{ id: string; inscription: string; full_text: string }>(
		`SELECT d.id, d.inscription, dc.full_text
		   FROM namings d
		   JOIN document_content dc ON dc.naming_id = d.id AND dc.full_text IS NOT NULL
		  WHERE d.project_id = $1 AND d.deleted_at IS NULL
		  ORDER BY d.inscription`,
		[projectId]
	);

	const marken = await query<{ documentId: string; n: string }>(
		`SELECT a.directed_to AS "documentId", COUNT(*)::text AS n
		   FROM appearances a
		  WHERE a.mode = 'relation' AND a.directed_from = $1
		    AND a.properties->>'anchorType' = 'text'
		    AND a.properties->>'aiPersona' IS NULL
		    AND a.properties->'anchor'->>'pos0' IS NOT NULL
		  GROUP BY a.directed_to`,
		[namingId]
	);
	const markenJeDoc = new Map(marken.rows.map((r) => [r.documentId, Number(r.n)]));

	// Je Dokument der jüngste Lauf. DISTINCT ON ist hier das Richtige: Die
	// Geschichte bleibt stehen, angezeigt wird der letzte Stand.
	const laeufe = await query<{
		document_id: string;
		id: string;
		created_at: string;
		model: string;
		kriterium_hash: string;
		zuege_gesamt: number;
		geprueft: number;
		stellen: unknown;
		unlesbar: number;
		nicht_belegt: number;
		verbrauch: Verbrauch | null;
		sekunden: number | null;
		abgebrochen: boolean;
		fehler: string | null;
	}>(
		`SELECT DISTINCT ON (document_id)
		        document_id, id, created_at, model, kriterium_hash, zuege_gesamt, geprueft,
		        jsonb_array_length(stellen) AS stellen, unlesbar, nicht_belegt,
		        verbrauch, sekunden, abgebrochen, fehler
		   FROM anker_zug_runs
		  WHERE project_id = $1 AND naming_id = $2
		  ORDER BY document_id, created_at DESC`,
		[projectId, namingId]
	);
	const laufJeDoc = new Map(laeufe.rows.map((r) => [r.document_id, r]));

	return docs.rows.map((d) => {
		const g = sichten(d.full_text);
		const l = laufJeDoc.get(d.id);
		return {
			documentId: d.id,
			inscription: d.inscription,
			zeichen: d.full_text.length,
			zuege: zuegeOf(d.full_text, g).length,
			marken: markenJeDoc.get(d.id) ?? 0,
			letzterLauf: l
				? {
						id: l.id,
						createdAt: l.created_at,
						model: l.model,
						kriteriumHash: l.kriterium_hash,
						zuegeGesamt: l.zuege_gesamt,
						geprueft: l.geprueft,
						stellen: Number(l.stellen),
						unlesbar: l.unlesbar,
						nichtBelegt: l.nicht_belegt,
						verbrauch: l.verbrauch,
						sekunden: l.sekunden,
						abgebrochen: l.abgebrochen,
						fehler: l.fehler
					}
				: null,
			// Ohne Kriterium ist die Frage nicht entscheidbar, und dann ist die
			// ehrliche Antwort „nicht aktuell" statt einer Vermutung.
			aktuell: !!l && !l.abgebrochen && !!hash && l.kriterium_hash === hash
		};
	});
}

export interface LaufEintrag {
	projectId: string;
	namingId: string;
	documentId: string;
	kriterium: Kriterium;
	provider: string;
	model: string;
	zuegeGesamt: number;
	geprueft: number;
	stellen: Stelle[];
	unlesbar: number;
	nichtBelegt: number;
	verbrauch: Verbrauch;
	sekunden: number;
	abgebrochen?: boolean;
	fehler?: string;
	userId?: string | null;
}

/** Einen Durchgang verbuchen. Auch den abgebrochenen — ein Abbruch ist kein Ergebnis. */
export async function verbucheLauf(e: LaufEintrag): Promise<string> {
	const r = await query<{ id: string }>(
		`INSERT INTO anker_zug_runs
		   (project_id, naming_id, document_id, kriterium, kriterium_hash, provider, model,
		    zuege_gesamt, geprueft, stellen, unlesbar, nicht_belegt, verbrauch, sekunden,
		    abgebrochen, fehler, gestartet_von)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		 RETURNING id`,
		[
			e.projectId,
			e.namingId,
			e.documentId,
			JSON.stringify(e.kriterium),
			kriteriumHash(e.kriterium),
			e.provider,
			e.model,
			e.zuegeGesamt,
			e.geprueft,
			JSON.stringify(e.stellen),
			e.unlesbar,
			e.nichtBelegt,
			JSON.stringify(e.verbrauch),
			e.sekunden,
			e.abgebrochen ?? false,
			e.fehler ?? null,
			e.userId ?? null
		]
	);
	return r.rows[0].id;
}

/** Das Ergebnis eines verbuchten Laufs, ohne neuen Aufruf. */
export async function ladeLauf(
	projectId: string,
	runId: string
): Promise<{ kriterium: Kriterium; stellen: Stelle[]; model: string; createdAt: string } | null> {
	const r = await query<{ kriterium: Kriterium; stellen: Stelle[]; model: string; created_at: string }>(
		`SELECT kriterium, stellen, model, created_at FROM anker_zug_runs
		  WHERE id = $1 AND project_id = $2`,
		[runId, projectId]
	);
	if (r.rows.length === 0) return null;
	const row = r.rows[0];
	return { kriterium: row.kriterium, stellen: row.stellen, model: row.model, createdAt: row.created_at };
}
