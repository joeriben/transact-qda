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
//   vorbereiten— das Kriterium aus Naming und Memo in Form bringen und
//                VORLEGEN. Ein Modellaufruf. Der Forscher korrigiert es, bevor
//                gelaufen wird; es ist sein Muster, nicht das des Helfers.
//   durchgehen — jede Stelle mit dem freigegebenen Kriterium prüfen.
//
// Nichts hiervon schreibt in den Datenraum. Das Ergebnis ist eine Liste von
// Hinweisen, die außerhalb bleibt, bis der Forscher eine davon durch einen
// eigenen Akt hereinholt — als Anker, als Memo, oder gar nicht.

import { query } from '../../db/index.js';
import { resolveTier } from '../coding-run/model-tiers.js';
import { sichten, zuegeOf, zuegeOverlapping, type Gestalt, type Zug } from './gestalt.js';
import {
	ableitenKriterium,
	pruefeStellen,
	type Kriterium,
	type Stelle,
	type UnlesbareStelle,
	type UnbelegteStelle,
	type PruefOptions,
	type Verbrauch
} from './recognize.js';

export { sichten, zuegeOf, zuegeOverlapping, bauformName } from './gestalt.js';
export type { Gestalt, Zug, Bruch, Position, Verteilung } from './gestalt.js';
export { NICHT_EINSCHLAEGIG, LaufAbbruch } from './recognize.js';
export { kriteriumHash, dokumentStand, verbucheLauf, ladeLauf } from './runs.js';
export type { DokumentStand, LaufNotiz, LaufEintrag } from './runs.js';
export type {
	Kriterium,
	Bestandteil,
	Relation,
	Befund,
	Stelle,
	UnlesbareStelle,
	UnbelegteStelle,
	Verbrauch
} from './recognize.js';

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

export interface Marke {
	/** Was der Forscher markiert hat — Zeichen für Zeichen, nichts dazu. */
	wortlaut: string;
	/** Wessen Rede das ist, aus den Marken des Textes. */
	position: string;
	pos0: number;
	pos1: number;
	/** Der Zug, in dem die Marke steht. Umgebung, nicht Beleg. */
	umgebung: string;
	zuege: Zug[];
}

export interface Belegstelle {
	/** Alle Marken des Forschers an diesem Dokument, in Textreihenfolge. */
	marken: Marke[];
	/** Die Marken, wie sie dem Modell vorgelegt werden — das Markierte zuerst. */
	text: string;
	/** Alle Züge, die eine Marke berühren — beim Lauf ausgenommen. */
	zuege: Zug[];
}

/**
 * Die Marken, in der Reihenfolge, in der sie im Text stehen.
 *
 * Sie sind die dichteste Information im ganzen Vorgang: Der Forscher hat
 * wenige Zeichen aus einem langen Protokoll ausgewählt, und in dieser Auswahl
 * steckt, was er meint. Deshalb steht sie vorn und für sich; die Umgebung
 * steht dahinter und ist als Umgebung ausgewiesen.
 *
 * Ein früherer Stand legte statt der Marke zwei Züge Anlauf plus Marke als
 * einen Block vor — unter der Annahme, der markierte Ausschnitt trage den Zug
 * allein nicht. Die Annahme war falsch und hat die Beweislage verkehrt: Aus
 * „Davon hängt das gesamte Projekt ab." (35 Zeichen) wurden 665, und das
 * Modell las den Gegenstand des Anlaufs — die Methodenwahl — als Bestandteil des
 * Musters. Was der Forscher NICHT markiert hat, gehört nicht zum Muster.
 *
 * Mehrere Marken sind ein Vergleich, und der Vergleich ist die Auskunft: Was
 * ihnen gemeinsam ist, ist die Form; worin sie sich unterscheiden, ist der
 * Gegenstand. Deshalb gehen alle mit und nicht die erste.
 */
export function belegstelleOf(
	zuege: Zug[],
	anchors: { documentId: string; pos0: number; pos1: number }[],
	documentId: string,
	fullText: string
): Belegstelle | null {
	const marken: Marke[] = [];
	const beruehrt: Zug[] = [];
	for (const a of anchors) {
		if (a.documentId !== documentId) continue;
		const treffer = zuegeOverlapping(zuege, a.pos0, a.pos1);
		if (treffer.length === 0) continue;
		marken.push({
			wortlaut: fullText.slice(a.pos0, a.pos1).trim(),
			position: treffer[0].position,
			pos0: a.pos0,
			pos1: a.pos1,
			umgebung: treffer.map((z) => z.text).join('\n'),
			zuege: treffer
		});
		for (const z of treffer) if (!beruehrt.includes(z)) beruehrt.push(z);
	}
	if (marken.length === 0) return null;
	return { marken, text: markenBlock(marken), zuege: beruehrt };
}

function markenBlock(marken: Marke[]): string {
	const eins = marken.length === 1;
	const kopf = marken
		.map((m, i) => `${eins ? 'MARKE' : `MARKE ${i + 1}`} — Rede von ${m.position}:\n„${m.wortlaut}"`)
		.join('\n\n');
	const umgebung = marken
		.map((m, i) => `${eins ? 'zur Marke' : `zu MARKE ${i + 1}`}:\n"""\n${m.umgebung}\n"""`)
		.join('\n\n');
	return `${kopf}

────
Die Umgebung, in der ${eins ? 'die Marke steht' : 'die Marken stehen'} — damit du lesen kannst, wovon die Rede ist. Sie ist nicht das Markierte: Was hier steht und in ${eins ? 'der Marke' : 'den Marken'} nicht, gehört nicht zum Muster.

${umgebung}`;
}

/**
 * Die Belegstelle für einen Lauf über DIESES Dokument.
 *
 * Ein Naming reicht. Hat der Forscher in diesem Dokument nichts markiert,
 * heißt das nicht, dass er kein Muster hat — es heißt, dass er hier noch nicht
 * gesucht hat, und genau dafür ist der Durchgang da. Gibt es Marken in einem
 * anderen Dokument, gehen sie als Beispiel mit, ausgewiesen als von dort. Gibt
 * es gar keine, läuft es ohne: Was gesucht wird, steht im Kriterium, und das
 * kommt aus Naming und Memo.
 */
async function belegstelleFuerLauf(
	projectId: string,
	muster: MusterQuelle,
	documentId: string,
	zuege: Zug[],
	fullText: string
): Promise<{ beleg: Belegstelle | null; ausAnderemDokument: boolean }> {
	const hier = belegstelleOf(zuege, muster.anchors, documentId, fullText);
	if (hier) return { beleg: hier, ausAnderemDokument: false };

	const andere = [...new Set(muster.anchors.map((a) => a.documentId))].filter((d) => d !== documentId);
	for (const d of andere) {
		try {
			const text = await ladeVolltext(projectId, d);
			const z = zuegeOf(text, sichten(text));
			const beleg = belegstelleOf(z, muster.anchors, d, text);
			if (beleg) return { beleg, ausAnderemDokument: true };
		} catch {
			/* Dokument ohne Volltext oder nicht mehr im Projekt — nächstes. */
		}
	}
	return { beleg: null, ausAnderemDokument: false };
}

// ── Vorbereitung ──────────────────────────────────────────────────

export interface Vorbereitung {
	gestalt: Gestalt;
	zuegeGesamt: number;
	belegstelle: string | null;
	/** Die Marken stehen in einem anderen Dokument — dort ist nichts hervorzuheben. */
	belegAusAnderemDokument: boolean;
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
	opts: { kriterium?: Kriterium | null; signal?: AbortSignal; modell?: PruefOptions['modell'] } = {}
): Promise<Vorbereitung> {
	const [muster, fullText] = await Promise.all([
		ladeMuster(projectId, namingId),
		ladeVolltext(projectId, documentId)
	]);
	const gestalt = sichten(fullText);
	const zuege = zuegeOf(fullText, gestalt);
	const { beleg, ausAnderemDokument } = await belegstelleFuerLauf(
		projectId,
		muster,
		documentId,
		zuege,
		fullText
	);

	// Das Kriterium hängt nicht an einer Marke: Es kommt aus Naming und Memo.
	const kriterium =
		opts.kriterium ?? (await ableitenKriterium(muster.inscription, muster.memos, opts.signal, opts.modell));

	return {
		gestalt,
		zuegeGesamt: zuege.length,
		belegstelle: beleg?.text ?? null,
		belegAusAnderemDokument: ausAnderemDokument,
		belegZuege: ausAnderemDokument
			? []
			: (beleg?.zuege ?? []).map((z) => ({ charStart: z.charStart, charEnd: z.charEnd })),
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
	/** Anderes Modell als der Tier vorgibt — für Vergleichsläufe. */
	modell?: PruefOptions['modell'];
	onProgress?: (done: number, total: number) => void;
	onStelle?: (stelle: Stelle) => void;
}

export interface Durchgang {
	stellen: Stelle[];
	/** Stellen, deren Antwort nicht auswertbar war — ungeprüft, nicht „ohne Bezug". */
	unlesbar: UnlesbareStelle[];
	/** Befunde, deren Zitat nicht in der geprüften Stelle steht — sie hängen woanders. */
	nichtBelegt: UnbelegteStelle[];
	/** Was der Durchgang gekostet hat, vom Anbieter gemeldet. */
	verbrauch: Verbrauch;
	/** Womit er gelaufen ist — gehört in die Buchführung, sonst ist sie nicht zuzuordnen. */
	modell: { provider: string; model: string };
	/** Alle Züge des Dokuments. `geprueft` ist kleiner, wo Marken ausgenommen sind. */
	zuegeGesamt: number;
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
	const { beleg, ausAnderemDokument } = await belegstelleFuerLauf(
		projectId,
		muster,
		documentId,
		zuege,
		fullText
	);

	// Die Belegstelle bleibt draußen, wo sie in DIESEM Dokument steht: Sie ist die
	// Vorgabe, nicht der Fund. Stammt sie von woanders, ist hier nichts
	// auszunehmen, und ohne Marken ist alles zu prüfen.
	const drin = !beleg || ausAnderemDokument || opts.belegstelleMitpruefen ? [] : beleg.zuege;
	const scope = drin.length > 0 ? zuege.filter((z) => !drin.includes(z)) : zuege;

	const geprueftJePosition: Record<string, number> = {};
	for (const z of scope) geprueftJePosition[z.position] = (geprueftJePosition[z.position] ?? 0) + 1;

	const { stellen, unlesbar, nichtBelegt, verbrauch } = await pruefeStellen(
		muster.inscription,
		muster.memos,
		beleg ? { text: beleg.text, ausAnderemDokument } : null,
		kriterium,
		gestalt,
		zuege,
		scope,
		{
			concurrency: opts.concurrency ?? 6,
			signal: opts.signal,
			modell: opts.modell,
			onProgress: opts.onProgress,
			onStelle: opts.onStelle
		}
	);

	return {
		stellen,
		unlesbar,
		nichtBelegt,
		verbrauch,
		modell: opts.modell ?? resolveTier('anker.wiedererkennung'),
		zuegeGesamt: zuege.length,
		geprueft: scope.length, geprueftJePosition, gestalt, kriterium };
}
