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
// Der Gegenstand ist darin Relatum, nicht Ziel. „Über die Wahl der Erhebungsmethode
// so reden, dass sie als folgenreich und zweiwertig dasteht" ist ohne das
// Worüber nicht beschreibbar. Herausgehalten wird nicht der Gegenstand,
// sondern seine Verselbständigung zum Thema.
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
	return `Eine Forscherin hat beim Lesen einer Protokollreihe ein wiederkehrendes STRUKTURMUSTER bemerkt und es an einer Stelle festgemacht: ein Naming, ein Memo, eine Belegstelle. Das Muster ist ein Zug — was dort jemand tut —, kein Thema.

Deine Aufgabe: Mache das Kriterium explizit, damit sie es korrigieren kann, bevor damit gearbeitet wird. Du bildest keine eigene Hypothese und erweiterst ihre nicht. Du legst offen, was in ihrer schon steht.

BESTANDTEILE — die Züge, aus denen das Muster zusammengesetzt ist. Nimm sie aus Naming und Memo, nicht aus deiner Vorstellung davon, was dazugehören könnte. Je Bestandteil: der Kurzname und woran er im Text kenntlich ist.

AKTEUR und ADRESSAT — wer den Zug tut, gegenüber wem. Das gehört zum Muster: Wer dramatisiert, ist Teil des Zuges.

RELATIONEN — in welchen Verhältnissen eine andere Stelle zum Muster stehen kann. Diese Verhältnisse leitest du aus den Bestandteilen ab, sie sind nicht frei erfunden:
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

export function kriteriumMessage(
	inscription: string,
	memos: string[],
	belegstelleMitAnlauf: string
): string {
	return `NAMING: „${inscription}"

MEMO:
${memos.length > 0 ? memos.join('\n\n') : '(keins)'}

BELEGSTELLE, mit dem Anlauf, der zu ihr führt:
"""
${belegstelleMitAnlauf}
"""

Mache das Kriterium explizit. JSON-Objekt.`;
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

Der Gegenstand gehört in die Antwort — als das, worüber geredet wird, nicht als das, worum es geht. „Redet über die Wahl einer Methode so, dass sie als folgenreich und zweiwertig dasteht" ist eine Antwort. „Hier geht es um die Methodenwahl" ist keine.

WER HANDELT: Im Kopf jeder Stelle steht, welcher Position ihre Rede zugeschrieben ist. Diese Zuschreibung folgt aus den Marken des Textes, nicht aus dem Inhalt: Steht eine Passage in einem Block der einen Position unter einer Marke wie „Frage:", so ist sie zitierte Rede der anderen. Heißt die Zuschreibung „unklar", entscheide aus dem Text — und sag in \`begruendung\`, wenn sie sich nicht entscheiden lässt.

RISSE: Wo unter einer Stelle ein Riss vermerkt ist, fehlt dem Protokoll etwas, worauf sie sich bezieht — eine zitierte Frage ohne Original, ein Verweis auf eine Aufzählung, die nicht dasteht. Das ist keine Panne, an der du vorbeisiehst: Das Fehlende ist oft genau der Zug. Wo eine Antwort auf etwas antwortet, das aus dem Protokoll gefallen ist, kannst du den Zug nur an ihrer Spur in der Antwort erkennen — dann sag das, statt den Zug für abwesend zu erklären.

ERST DANN vergleichst du. Der Vergleich geht auf die STRUKTUR, nicht auf den Gegenstand: dieselben Rollen, derselbe Vollzug, dieselbe Wirkung — bei ganz anderem Inhalt. Zwei Stellen, die von derselben Sache handeln, tragen deswegen nicht dasselbe Muster. Zwei Stellen, die nichts gemeinsam haben als den Vollzug, tragen es.

${kriteriumBlock(k)}

Du entscheidest nicht ja/nein, sondern welche Relation zutrifft. Die Kontrast-Relationen sind kein Ausschuss: Sie zeigen, welcher Bestandteil das Muster trägt. Eine Stelle, an der die Alternativen zwar zweiwertig sind, die Kriterien dafür aber offen daliegen, ist ein Befund und keine Fehlanzeige.

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

function parseJsonObject<T>(text: string): T | null {
	const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(cleaned.slice(start, end + 1)) as T;
	} catch {
		return null;
	}
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

/** Das Kriterium aus Naming, Memo und Belegstelle ableiten — ein Aufruf. */
export async function ableitenKriterium(
	inscription: string,
	memos: string[],
	belegstelleMitAnlauf: string
): Promise<Kriterium | null> {
	const res = await chat({
		system: kriteriumSystem(),
		messages: [{ role: 'user', content: kriteriumMessage(inscription, memos, belegstelleMitAnlauf) }],
		modelOverride: resolveTier('anker.wiedererkennung'),
		responseFormat: 'json'
	});
	return parseJsonObject<Kriterium>(res.text);
}

export interface Stelle {
	zug: Zug;
	befund: Befund;
}

export interface PruefOptions {
	concurrency?: number;
	onProgress?: (done: number, total: number) => void;
	/** So viele Passagen davor gehen als Anlauf mit. */
	anlaufZuege?: number;
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
): Promise<Stelle[]> {
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
			const res = await chat({
				system,
				messages: [{ role: 'user', content: befundMessage(inscription, memos, belegstelleMitAnlauf, z, anlauf) }],
				modelOverride: tier,
				responseFormat: 'json',
				cacheableSystemPrefix: system
			});
			return parseJsonObject<Befund>(res.text);
		} catch {
			return null;
		} finally {
			opts.onProgress?.(++done, zuPruefen.length);
		}
	});

	const out: Stelle[] = [];
	zuPruefen.forEach((z, i) => {
		const b = results[i];
		if (b && b.relation && b.relation !== NICHT_EINSCHLAEGIG) out.push({ zug: z, befund: b });
	});
	return out;
}
