// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coding-Helfer: EIN Strukturmuster am Material prüfen.
//
// Die Hypothese ist die des Forschers. Er hat sie aus der Lektüre der Reihe
// gewonnen, abduktiv, und an einer Stelle festgemacht. Der Helfer bildet keine
// Hypothese und sucht kein Thema. Er trägt die gegebene Hypothese durch das
// Material und bringt zurück, was sie trägt und was ihr widersteht.
//
// Die Frage an jede Stelle ist die Fragehaltung, nicht eine Fragestellung:
//
//     Was geschieht hier?
//     Wie redet jemand über etwas, in welchem Kontext, und was tut er,
//     indem er über etwas auf diese Weise redet?
//
// Der Gegenstand ist darin Relatum, nicht Ziel: „über X so reden, dass X als
// … dasteht" ist ohne das Worüber nicht beschreibbar. Herausgehalten wird nicht
// der Gegenstand, sondern seine Verselbständigung zum Thema. Kein Beispiel aus
// einer bestimmten Untersuchung steht im Prompt — es liefe sonst bei jedem
// Muster mit und würde jedes andere an sich entlanglesen.
//
// Kein thematischer Vorfilter. Ein solcher reicht nur weiter, was vom Gleichen
// handelt, und wirft die Fälle weg, die strukturisomorph, aber inhaltlich
// entfernt sind — also genau die, um die es geht.
//
// KEIN Ja/Nein, sondern die RELATION zum Muster. Im Nein fielen Kontrastfall,
// Grenzfall und Belangloses ununterscheidbar zusammen; die Kontraste sind aber
// das, woran die Grenze des Musters scharf wird. Die Relationen werden vorab
// aus den Bestandteilen des Musters abgeleitet und ausgewiesen, damit der
// Forscher sie korrigieren kann, bevor gelaufen wird.
//
// Nichts hiervon schreibt in den Datenraum. Das Ergebnis ist eine Liste von
// Hinweisen; ob daraus ein Anker wird, entscheidet ein Akt des Forschers.

import { chat } from '../client.js';
import { resolveTier } from '../coding-run/model-tiers.js';
import { gestaltBlock, type Gestalt, type Zug } from './gestalt.js';

// ── Das Kriterium, explizit gemacht ───────────────────────────────

export interface Bestandteil {
	/** Kurzname, wird in der Ausgabe je Stelle mit ja/nein beantwortet. */
	name: string;
	/** Woran er im Text kenntlich ist. */
	kenntlich: string;
}

export interface Relation {
	/** Kurzname der Relation, z. B. `dimensionen-offengelegt`. */
	name: string;
	/** Welche Bestandteile vorliegen müssen und welche nicht. */
	bedingung: string;
	/** Warum diese Relation für die Hypothese aufschlussreich ist. */
	ertrag: string;
}

export interface Kriterium {
	/** Wer den Zug tut und gegenüber wem — Teil des Musters, nicht Beiwerk. */
	akteur: string;
	adressat: string;
	bestandteile: Bestandteil[];
	relationen: Relation[];
}

export function kriteriumSystem(): string {
	return `Eine Forscherin hat beim Lesen einer Protokollreihe ein wiederkehrendes STRUKTURMUSTER bemerkt und in einem Naming und einem Memo festgehalten, worin es besteht. Das Muster ist ein Zug — was jemand tut, indem er redet —, kein Thema.

Deine Aufgabe: Bringe in Form, was in ihrem Naming und ihrem Memo BEREITS STEHT, damit sie es korrigieren kann, bevor damit gearbeitet wird. Du bildest keine eigene Hypothese, erweiterst ihre nicht und ergänzt nichts, was sie nicht geschrieben hat.

Du siehst das Material NICHT, und du brauchst es nicht. Was das Muster ist, sagt sie; wo es vorkommt, ist die spätere Frage. Wenn ihr Memo einen Bestandteil nur andeutet, gib ihn so knapp wieder, wie er dasteht — erfinde ihn nicht aus.

BESTANDTEILE — die Vollzüge, aus denen das Muster zusammengesetzt ist. Ein Bestandteil ist etwas, das jemand TUT: dramatisieren, vorgeben, unterstellen, offenlassen. Ein Gegenstand, über den geredet wird, ist kein Bestandteil. Je Bestandteil: der Kurzname und woran er kenntlich ist — an der Redeweise, nicht am Thema.

AKTEUR und ADRESSAT — wer den Zug tut, gegenüber wem. Das gehört zum Muster: Wer dramatisiert, ist Teil des Zuges.

RELATIONEN — in welchen Verhältnissen eine Stelle zum Muster stehen kann. Sie folgen aus den Bestandteilen und sind nicht frei erfunden:
• der Fall — alle Bestandteile liegen vor, mit dem genannten Akteur.
• je ein Kontrast für JEDEN Bestandteil — alle anderen liegen vor, dieser eine nicht. Diese Kontraste sind der Ertrag: An ihnen zeigt sich, welcher Bestandteil das Muster trägt und ohne welchen derselbe Vorgang unproblematisch wäre.
• Akteur umgekehrt — derselbe Zug, aber die andere Seite tut ihn.
• Gegenzug — der Adressat unterläuft oder bricht den Zug.
Weitere nur, wenn sie sich aus den Bestandteilen ergeben.

Antworte NUR mit einem JSON-Objekt, ohne Vorrede, ohne Markdown-Zaun:
{"akteur": "...", "adressat": "...",
 "bestandteile": [{"name": "...", "kenntlich": "..."}],
 "relationen": [{"name": "...", "bedingung": "...", "ertrag": "..."}]}

Alles in der Sprache des Namings.`;
}

export function kriteriumMessage(inscription: string, memos: string[]): string {
	return `NAMING: „${inscription}"

MEMO:
${memos.length > 0 ? memos.join('\n\n') : '(keins)'}

Bringe das Kriterium in Form. JSON-Objekt.`;
}

// ── Prüfung je Stelle ─────────────────────────────────────────────

export interface Befund {
	/** Was hier geschieht — die drei Glieder der Fragehaltung. */
	wer: string;
	worueber: string;
	wie: string;
	/** Was er tut, indem er so darüber redet. */
	tut: string;
	/** Je Bestandteil des Kriteriums: liegt er vor? */
	bestandteile: Record<string, boolean>;
	/** Name einer Relation aus dem Kriterium, oder `nicht-einschlaegig`. */
	relation: string;
	/** Der Wortlaut, der den Zug trägt — verbatim aus der Stelle oder ihrem Anlauf. */
	zitat: string;
	begruendung: string;
}

export const NICHT_EINSCHLAEGIG = 'nicht-einschlaegig';

function kriteriumBlock(k: Kriterium): string {
	return [
		`AKTEUR des Musters: ${k.akteur}`,
		`ADRESSAT: ${k.adressat}`,
		'',
		'BESTANDTEILE:',
		...k.bestandteile.map((b) => `• ${b.name} — ${b.kenntlich}`),
		'',
		'RELATIONEN:',
		...k.relationen.map((r) => `• ${r.name} — ${r.bedingung}`),
		`• ${NICHT_EINSCHLAEGIG} — hier geschieht nichts, was zu diesem Muster in einem Verhältnis steht.`
	].join('\n');
}

export function befundSystem(k: Kriterium, gestalt: Gestalt): string {
	return `Du prüfst ein Protokoll auf EIN Strukturmuster, das eine Forscherin bemerkt hat. Du suchst kein Thema und bildest keine eigene Hypothese.

${gestaltBlock(gestalt)}

Das steht nicht als Beiwerk da. Ein Zug geschieht zwischen diesen Positionen, und dieselben Worte bedeuten anderes, je nachdem, wer sie sagt und an wen.

An jeder Stelle stellst du zuerst diese Frage, und nur diese:

    WAS GESCHIEHT HIER?
    Wie redet jemand über etwas, in welchem Kontext, und was tut er, indem er über etwas auf diese Weise redet?

Der Gegenstand gehört in die Antwort — als das, worüber geredet wird, nicht als das, worum es geht. Die Form einer Antwort ist: „redet über X so, dass X als … dasteht" — ein Verb des Tuns und ein Wie. „Hier geht es um X" ist keine Antwort, sondern eine Themenangabe.

WER HANDELT: Im Kopf jeder Stelle steht, welcher Position ihre Rede zugeschrieben ist. Diese Zuschreibung folgt aus den Marken des Textes, nicht aus dem Inhalt: Steht eine Passage in einem Block der einen Position unter einer Marke wie „Frage:", so ist sie zitierte Rede der anderen. Heißt die Zuschreibung „unklar", entscheide aus dem Text — und sag in \`begruendung\`, wenn sie sich nicht entscheiden lässt.

RISSE: Wo unter einer Stelle ein Riss vermerkt ist, fehlt dem Protokoll etwas, worauf sie sich bezieht — eine zitierte Frage ohne Original, ein Verweis auf eine Aufzählung, die nicht dasteht. Das ist keine Panne, an der du vorbeisiehst: Das Fehlende ist oft genau der Zug. Wo eine Antwort auf etwas antwortet, das aus dem Protokoll gefallen ist, kannst du den Zug nur an ihrer Spur in der Antwort erkennen — dann sag das, statt den Zug für abwesend zu erklären.

ERST DANN vergleichst du. Der Vergleich geht auf die STRUKTUR, nicht auf den Gegenstand: dieselben Rollen, derselbe Vollzug, dieselbe Wirkung — bei ganz anderem Inhalt. Zwei Stellen, die von derselben Sache handeln, tragen deswegen nicht dasselbe Muster. Zwei Stellen, die nichts gemeinsam haben als den Vollzug, tragen es.

${kriteriumBlock(k)}

Du entscheidest nicht ja/nein, sondern welche Relation zutrifft. Die Kontrast-Relationen sind kein Ausschuss: Sie zeigen, welcher Bestandteil das Muster trägt. Eine Stelle, an der alle Bestandteile bis auf einen vorliegen, ist ein Befund und keine Fehlanzeige.

\`${NICHT_EINSCHLAEGIG}\` ist die Vorgabe und wird die häufigste Antwort sein. Sie gilt, wenn hier kein Vorgang stattfindet, der zu diesem Muster in einem der genannten Verhältnisse steht. Zwinge nichts in eine Relation.

\`zitat\` ist der Wortlaut, der den Zug trägt — Zeichen für Zeichen aus der Stelle oder ihrem Anlauf kopiert. Er darf über die markierte Stelle hinausgehen: Ein Zug braucht oft seinen Anlauf, und die Spanne, die ihn trägt, ist selten die, an der man ihn zuerst bemerkt. Bei \`${NICHT_EINSCHLAEGIG}\` bleibt \`zitat\` leer.

\`begruendung\` ist EIN Satz und benennt den Vollzug, nicht den Gegenstand.

Antworte NUR mit einem JSON-Objekt, ohne Vorrede, ohne Markdown-Zaun:
{"wer": "...", "worueber": "...", "wie": "...", "tut": "...",
 "bestandteile": {${k.bestandteile.map((b) => `"${b.name}": true|false`).join(', ')}},
 "relation": "...", "zitat": "...", "begruendung": "..."}

Alles in der Sprache des Protokolls.`;
}

export function befundMessage(
	inscription: string,
	memos: string[],
	belegstelleMitAnlauf: string,
	zug: Zug,
	anlauf: string[]
): string {
	const prev = zug.previousTurn
		? `VORANGEHENDER BLOCK (${zug.previousTurn.speakerMark}):\n"""\n${zug.previousTurn.text}\n"""\n\n`
		: '';
	const head = zug.turnSpeakerNote ? `${zug.turnSpeakerMark} (${zug.turnSpeakerNote})` : zug.turnSpeakerMark;
	const zuschreibung =
		zug.zuschreibung === 'zitiert'
			? `Diese Passage steht unter der Marke „${zug.embeddedMark}:" in einem Block von ${zug.turnSpeakerMark} — sie ist zitierte Rede von ${zug.position}.`
			: zug.zuschreibung === 'unklar'
				? 'Wem diese Passage zuzuschreiben ist, geht aus den Marken nicht hervor.'
				: `Diese Passage ist eigene Rede von ${zug.position}.`;
	const risse =
		zug.brueche.length > 0
			? `RISSE AN DIESER STELLE:\n${zug.brueche.map((b) => `• ${b.was} Wortlaut: „${b.wortlaut.slice(0, 180)}"`).join('\n')}\n\n`
			: '';
	return `DAS MUSTER DER FORSCHERIN: „${inscription}"
${memos.length > 0 ? `\nIhr Memo:\n${memos.join('\n\n')}\n` : ''}
Ihre Belegstelle, mit dem Anlauf, der zu ihr führt:
"""
${belegstelleMitAnlauf}
"""

────────────────────────────────────────

${prev}BLOCK, IN DEM DIE ZU PRÜFENDE STELLE STEHT — Blockkopf: ${head}
"""
${zug.turnText.slice(0, 2000)}
"""

${anlauf.length > 0 ? `ANLAUF (unmittelbar davor):\n"""\n${anlauf.join('\n')}\n"""\n\n` : ''}${risse}ZU PRÜFENDE STELLE — ${zuschreibung}
"""
${zug.text}
"""

Was geschieht hier, und in welchem Verhältnis steht es zum Muster? JSON-Objekt.`;
}

// ── Ausführung ────────────────────────────────────────────────────

function parseJsonObject<T>(text: string): { ok: true; value: T } | { ok: false; fehler: string } {
	const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start < 0 || end <= start) return { ok: false, fehler: 'Keine JSON-Klammern in der Antwort.' };
	try {
		return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) as T };
	} catch (e) {
		return { ok: false, fehler: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Ein Modellaufruf, der ein JSON-Objekt zurückgeben soll — mit Nachfassen.
 *
 * Freies JSON aus einem Sprachmodell ist gelegentlich kaputt: ein unmaskiertes
 * Anführungszeichen mitten in einer Begründung reicht. Ohne Nachfassen fiel
 * daran der ganze Durchgang aus („Das Kriterium kam nicht auswertbar zurück"),
 * und im Durchgang über die Stellen verschwand eine Stelle stillschweigend aus
 * dem Ergebnis — was schlimmer ist, weil es wie ein Befund aussieht.
 *
 * Beim zweiten Versuch bekommt das Modell die Fehlermeldung des Parsers zu
 * sehen. Es korrigiert dann in aller Regel genau die Stelle.
 */
async function chatJson<T>(
	system: string,
	message: string,
	opts: { tier: ReturnType<typeof resolveTier>; signal?: AbortSignal; cacheable?: string; versuche?: number }
): Promise<{ ok: true; value: T } | { ok: false; fehler: string }> {
	const versuche = opts.versuche ?? 3;
	let letzter = 'kein Versuch';
	let nachfassen = '';
	for (let i = 0; i < versuche; i++) {
		const res = await chat({
			system,
			messages: [{ role: 'user', content: message + nachfassen }],
			modelOverride: opts.tier,
			responseFormat: 'json',
			cacheableSystemPrefix: opts.cacheable,
			signal: opts.signal
		});
		const parsed = parseJsonObject<T>(res.text);
		if (parsed.ok) return parsed;
		letzter = parsed.fehler;
		nachfassen =
			`\n\nDeine vorige Antwort war kein gültiges JSON: ${parsed.fehler}\n` +
			'Gib dasselbe noch einmal aus, diesmal als striktes JSON. Anführungszeichen INNERHALB eines Werts müssen mit \\" maskiert sein; verwende dort besser „…" oder \'…\'. Kein Vorspann, kein Markdown-Zaun.';
	}
	return { ok: false, fehler: letzter };
}

async function pool<I, O>(items: I[], width: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
	const out = new Array<O>(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(width, items.length) }, async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				out[i] = await fn(items[i], i);
			}
		})
	);
	return out;
}

/**
 * Das Kriterium aus Naming und Memo in Form bringen — ein Aufruf.
 *
 * OHNE das Material, und das ist der Punkt. Solange die Marken mit vorlagen,
 * schrieb das Modell den Gegenstand der markierten Stelle als Bestandteil des
 * Musters aus: Zu „Zuspitzung zur Alternative" kam „Methodenwahl als
 * primärer Planungsparameter" heraus — ein Thema an der Stelle, an der ein
 * Vollzug stehen muss. Kein Satz im Prompt hat das verhindert, weil die
 * Unterscheidung performativ/thematisch nirgends im System dargestellt ist:
 * Beides sind Zeichenketten in demselben Feld.
 *
 * Was das Muster IST, sagt der Forscher in seinem Memo — dort steht es bereits
 * in Verben und ohne Gegenstand. Wo es vorkommt, ist die spätere Frage und
 * Sache des Durchgangs. Ohne Material im Eingang ist die Kontamination nicht
 * unerwünscht, sondern unmöglich.
 */
export async function ableitenKriterium(
	inscription: string,
	memos: string[],
	signal?: AbortSignal
): Promise<Kriterium> {
	const res = await chatJson<Kriterium>(
		kriteriumSystem(),
		kriteriumMessage(inscription, memos),
		{ tier: resolveTier('anker.wiedererkennung'), signal }
	);
	if (!res.ok) throw new Error(`Das Kriterium kam auch nach drei Versuchen nicht auswertbar zurück: ${res.fehler}`);
	return res.value;
}

export interface Stelle {
	zug: Zug;
	befund: Befund;
}

/** Eine Stelle, die nicht auswertbar zurückkam. Zählt als ungeprüft, nicht als „ohne Bezug". */
export interface UnlesbareStelle {
	zug: Zug;
	fehler: string;
}

export interface PruefOptions {
	concurrency?: number;
	onProgress?: (done: number, total: number) => void;
	/** So viele Passagen davor gehen als Anlauf mit. */
	anlaufZuege?: number;
	/** Bricht alle laufenden Aufrufe ab — im Web der Client-Disconnect. */
	signal?: AbortSignal;
	/** Wird bei jeder Stelle mit Bezug sofort gerufen, nicht erst am Ende. */
	onStelle?: (stelle: Stelle) => void;
}

/**
 * Jede übergebene Passage prüfen. Ohne Vorauswahl — wer hier nach Themen
 * vorsortiert, entfernt die strukturisomorphen Fälle.
 */
export async function pruefeStellen(
	inscription: string,
	memos: string[],
	belegstelleMitAnlauf: string,
	kriterium: Kriterium,
	gestalt: Gestalt,
	alleZuege: Zug[],
	zuPruefen: Zug[],
	opts: PruefOptions = {}
): Promise<{ stellen: Stelle[]; unlesbar: UnlesbareStelle[] }> {
	const tier = resolveTier('anker.wiedererkennung');
	const system = befundSystem(kriterium, gestalt);
	const anlaufN = opts.anlaufZuege ?? 2;
	let done = 0;

	const results = await pool(zuPruefen, opts.concurrency ?? 6, async (z) => {
		const idx = alleZuege.indexOf(z);
		const anlauf =
			idx > 0
				? alleZuege
						.slice(Math.max(0, idx - anlaufN), idx)
						.map((x) => `[${x.position}] ${x.text}`)
				: [];
		try {
			const res = await chatJson<Befund>(
				system,
				befundMessage(inscription, memos, belegstelleMitAnlauf, z, anlauf),
				{ tier, signal: opts.signal, cacheable: system, versuche: 2 }
			);
			if (!res.ok) return res;
			// Sofort melden statt am Ende: Ein Durchgang über ein großes Dokument
			// läuft Minuten, und der erste Fund ist schon etwas wert.
			const befund = res.value;
			if (befund.relation && befund.relation !== NICHT_EINSCHLAEGIG) {
				opts.onStelle?.({ zug: z, befund });
			}
			return res;
		} catch (err) {
			if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;
			return { ok: false as const, fehler: err instanceof Error ? err.message : String(err) };
		} finally {
			opts.onProgress?.(++done, zuPruefen.length);
		}
	});

	// Was nicht auswertbar zurückkam, wird BENANNT und nicht verschwiegen: Eine
	// stillschweigend fallengelassene Stelle sieht im Ergebnis genauso aus wie
	// eine geprüfte ohne Bezug, und das ist ein Unterschied ums Ganze.
	const stellen: Stelle[] = [];
	const unlesbar: UnlesbareStelle[] = [];
	zuPruefen.forEach((z, i) => {
		const r = results[i];
		if (!r.ok) unlesbar.push({ zug: z, fehler: r.fehler });
		else if (r.value.relation && r.value.relation !== NICHT_EINSCHLAEGIG) stellen.push({ zug: z, befund: r.value });
	});
	return { stellen, unlesbar };
}
