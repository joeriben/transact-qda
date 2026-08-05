// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sichtung: die Gestalt des Textes, bevor irgendetwas gelesen wird.
//
// Wer ein Protokoll aufschlägt, sieht in drei Sekunden, was für ein Text das
// ist: kein Monolog, keine Bedienungsanleitung, keine Gruppendiskussion —
// zwei markierte, alternierende, aufeinander bezogene, sich wiederholende
// Sprecherpositionen. Menschen sprechen das nicht aus, weil es so offensichtlich
// ist. Der Maschine steht es nirgends, und sie liest deshalb Satz für Satz in
// einen Text hinein, dessen Bauform sie nicht kennt.
//
// Diese Sichtung ontologisiert nichts vorab. Sie zählt, was an Marken dasteht,
// und zieht daraus die Schlüsse, die sich zwingend ziehen lassen — wie viele
// Positionen, wie sie sich verteilen, ob sie sich abwechseln, ob eine die
// andere zitiert. Erst auf dieser Grundlage wird sichtbar, WO die Zuschreibung
// reisst: ein Zitat ohne Original im Text, ein Verweis auf eine Aufzählung, die
// nirgends steht, zwei Blöcke derselben Position hintereinander. Genau das
// passiert in den CLI-Protokollen, deren Frageboxen nach der Antwort
// verschwinden — die Frage existiert dann nur noch als Zitat in der Antwort.
//
// Ein solcher Riss ist ein Befund, keine Panne: eine Beteiligung ohne
// Erscheinung. Er wird ausgewiesen und mitgegeben, nicht überspielt.
//
// Aus der Gestalt folgt zweitens der Schnitt. Ein Zug geschieht nicht über
// einen thematischen Bogen und nicht in einem einzelnen Satz, sondern in einer
// Passage, über die hinweg die Zuschreibung stabil bleibt: bis zur nächsten
// Marke. Wer feiner schneidet, legt denselben Zug mehrfach vor und bekommt ihn
// mehrfach, verschieden beurteilt, zurück.

import {
	turnsOf,
	linesOf,
	sharesNgram,
	EMBEDDED_MARK,
	OWN_SPEECH_MARKS,
	type Turn,
	type TurnForm
} from './surface.js';

// ── Die Gestalt ───────────────────────────────────────────────────

export interface Position {
	mark: string;
	turns: number;
	chars: number;
	/** Anteil am Textvolumen. */
	share: number;
	/** Trägt mindestens ein Blockkopf dieser Position ein Eingabezeichen? */
	prompted: boolean;
	/** Die Klammerzusätze der Blockköpfe, ohne Wiederholung. */
	notes: string[];
}

export type BruchArt =
	/** Fremde Rede wird zitiert, aber im Text steht sie nirgends im Original. */
	| 'zitat-ohne-original'
	/** Verwiesen wird auf eine Aufzählung, die im Text davor nicht vorkommt. */
	| 'verweis-ins-leere'
	/** Zwei Blöcke derselben Position hintereinander — dazwischen fehlt womöglich einer. */
	| 'folge-ohne-wechsel';

export interface Bruch {
	art: BruchArt;
	charStart: number;
	charEnd: number;
	/** Die Position, deren Rede fehlt oder deren Bezug ins Leere geht. */
	position: string;
	/** In wessen Block der Riss auffällt — bei zitierter Rede die andere Position. */
	imBlockVon: string;
	/** Der Wortlaut, an dem er auffällt. */
	wortlaut: string;
	/** Was fehlt, in einem Satz. */
	was: string;
}

export interface Verteilung {
	name: string;
	/** Je Position: absolute Treffer und Rate je 1000 Wörter. */
	je: Record<string, { treffer: number; je1000: number }>;
	/** Je Position bis zu zwei Belegstellen, wörtlich. */
	beispiele: Record<string, string[]>;
	/** Verhältnis der höchsten zur niedrigsten Rate; Infinity, wenn eine Position bei null steht. */
	schiefe: number;
}

export interface Gestalt {
	form: TurnForm;
	chars: number;
	turns: number;
	positionen: Position[];
	/** Wie viele Blockgrenzen die Position wechseln, von wie vielen. */
	wechsel: { gewechselt: number; gesamt: number };
	/** Wer zitiert wen, unter welchen Marken, wie oft. */
	zitate: { von: string; marken: Record<string, number>; bloecke: number }[];
	/** Was im Dokument steht, aber keine Äußerung ist: Werkzeugausgabe, Rahmenwerk. */
	nichtRede: { werkzeugZeichen: number; rahmenZeichen: number; anteil: number };
	/** Oberflächenmarken, auf die Positionen verteilt. */
	verteilungen: Verteilung[];
	brueche: Bruch[];
	/** Wie der Text gebaut ist, in Sätzen. Geht dem Durchgang mit, der liest. */
	bau: string[];
	/** Wie sich die Oberflächenmarken verteilen, in Sätzen. Geht an den Menschen. */
	verteilungBefund: string[];
}

// ── Verweise auf eine Aufzählung ──────────────────────────────────
// Nur das Prüfbare: eine Bezugnahme auf durchnummerierte oder als zwei
// gezählte Alternativen. Steht im Text davor keine solche Aufzählung, geht der
// Verweis ins Leere.

const REFERENCE_PATTERNS: { re: RegExp; name: string }[] = [
	{ re: /\b(\d)\s*(?:vs\.?|versus|gegen|oder)\s*(\d)\b/gi, name: 'nummerierte Alternativen' },
	{ re: /\b(?:Option|Variante|Möglichkeit|Vorschlag)\s+(\d)\b/gi, name: 'nummerierte Option' },
	{ re: /\bdie\s+beiden\s+(?:Optionen|Varianten|Vorschläge|Möglichkeiten|Alternativen)\b/gi, name: 'die beiden' },
	{ re: /\b(?:erstere[nsmr]?|letztere[nsmr]?)\b/gi, name: 'erstere/letztere' }
];

const ENUMERATION = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:Option|Variante|Möglichkeit|Vorschlag)\s*\d|(?:^|\n)\s*\d[.)]\s+\S/i;

/** Die Redeblöcke vor `turn`, die einer ANDEREN Position gehören — bis zu `back` Stück. */
function priorOther(turns: Turn[], turn: Turn, back = 3): Turn[] {
	const out: Turn[] = [];
	for (let i = turn.index - 1; i >= 0 && out.length < back; i--) {
		if (turns[i].role !== 'rede') continue;
		if (turns[i].speakerMark !== turn.speakerMark) out.push(turns[i]);
	}
	return out;
}

function findBrueche(turns: Turn[], positionen: Position[], form: TurnForm): Bruch[] {
	const brueche: Bruch[] = [];
	const zwei = positionen.length === 2;
	const gegenueber = (mark: string) => positionen.find((p) => p.mark !== mark)?.mark ?? 'unklar';

	for (const turn of turns) {
		if (turn.role !== 'rede') continue;
		const others = priorOther(turns, turn);
		const otherText = others.map((t) => t.text).join('\n');

		// Zitierte fremde Rede ohne Original.
		for (const line of linesOf(turn.text, turn.charStart)) {
			if (line.kind !== 'rede' || !line.mark) continue;
			if (OWN_SPEECH_MARKS.has(line.mark.toLowerCase())) continue;
			const quoted = line.text.replace(/^\s*\w+\s*:\s*/, '').trim();
			if (quoted.length < 25) continue;
			if (otherText.length > 0 && sharesNgram(quoted, otherText)) continue;
			const wem = zwei ? gegenueber(turn.speakerMark) : 'unklar';
			brueche.push({
				art: 'zitat-ohne-original',
				charStart: line.start,
				charEnd: line.end,
				position: wem,
				imBlockVon: turn.speakerMark,
				wortlaut: quoted,
				was: zwei
					? `Rede von ${wem}, im Block von ${turn.speakerMark} unter „${line.mark}:" zitiert. Im Protokoll selbst steht sie nirgends — sie existiert nur noch als dieses Zitat.`
					: `Unter der Marke „${line.mark}:" steht zitierte Rede ohne Original im Text davor.`
			});
		}
		// Verweis auf eine Aufzählung, die es nicht gibt. Auch der eigene Block
		// zählt: „Ich stelle die beiden Varianten nebeneinander:" kündigt die
		// Aufzählung an, die zwei Zeilen später dasteht — das ist kein Riss.
		if (others.length > 0 && !ENUMERATION.test(otherText) && !ENUMERATION.test(turn.text)) {
			for (const { re, name } of REFERENCE_PATTERNS) {
				re.lastIndex = 0;
				let m: RegExpExecArray | null;
				while ((m = re.exec(turn.text)) !== null) {
					brueche.push({
						art: 'verweis-ins-leere',
						charStart: turn.charStart + m.index,
						charEnd: turn.charStart + m.index + m[0].length,
						position: turn.speakerMark,
						imBlockVon: turn.speakerMark,
						wortlaut: turn.text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ').trim(),
						was: `Bezugnahme auf ${name} („${m[0]}"), ohne dass die Aufzählung irgendwo im Protokoll steht — das Verwiesene ist herausgefallen.`
					});
				}
			}
		}
	}

	// Zwei Blöcke derselben Position hintereinander. Werkzeugblöcke zählen
	// dazwischen nicht — sie sind keine Rede und unterbrechen keinen Wechsel.
	//
	// Im Rohmitschnitt eines Terminals ist das für den Agenten der Normalfall:
	// Er arbeitet zwischen zwei Eingaben in vielen Schritten. Ein Riss ist es
	// dort nur, wenn die EINGABE auf sich selbst folgt — dann ist eine Antwort
	// dazwischen verlorengegangen. Im Protokoll, das Wechsel setzt, ist jede
	// Wiederholung einer.
	const rede = turns.filter((t) => t.role === 'rede');
	for (let i = 1; i < rede.length; i++) {
		const jetzt = rede[i];
		if (jetzt.speakerMark !== rede[i - 1].speakerMark) continue;
		if (form === 'terminal' && !jetzt.prompted) continue;
		brueche.push({
			art: 'folge-ohne-wechsel',
			charStart: jetzt.charStart,
			charEnd: jetzt.charStart,
			position: zwei ? gegenueber(jetzt.speakerMark) : 'unklar',
			imBlockVon: jetzt.speakerMark,
			wortlaut: jetzt.text.replace(/\s+/g, ' ').trim().slice(0, 120),
			was: `Zwei Blöcke von ${jetzt.speakerMark} hintereinander — dazwischen kann ein Block der anderen Position fehlen.`
		});
	}

	return brueche.sort((a, b) => a.charStart - b.charStart);
}

// ── Oberflächenmarken, nach Position verteilt ─────────────────────
//
// Wer ein Protokoll überfliegt, sieht nicht nur, dass zwei Positionen darin
// sprechen, sondern sofort auch, dass sie ANDERS sprechen: hier Ausrufe und
// Gewichtungen, dort Aufforderungen und Rückfragen. Diese Ungleichverteilung
// ist heuristisch das Wertvollste an der Oberfläche — sie zeigt, ob ein
// vermuteter Zug überhaupt eine Positionssignatur hat oder beiden gehört.
//
// Was hier gezählt wird, sind MARKEN, keine Züge. „entscheidend" ist keine
// Dramatisierung, sondern ein Wort, das oft in einer steht. Die Zählung
// orientiert, sie befindet nicht. Deshalb steht neben jeder Zahl ein Beleg,
// und deshalb wird je 1000 Wörter gerechnet: Die Position mit dem längeren
// Text hat sonst in jeder Kategorie die Nase vorn.

const MARK_KINDS: { name: string; re: RegExp }[] = [
	{ name: 'Frage', re: /\?/g },
	{
		// Nicht jede Frage ist eine Zweiteilung, und ein Fragezeichen zählt hier
		// deshalb nicht mit. Gezählt wird nur, wo zwei Größen gegeneinander
		// gestellt sind. Dass eine Bezugnahme auf eine fremde Zweiteilung
		// („Begründe 1 vs. 2") derselben Marke zufällt wie die Zweiteilung
		// selbst, ist die Grenze einer Wortzählung — sie orientiert, sie befindet
		// nicht.
		name: 'Zweiteilung',
		re: /\b(?:entweder\s+\S+\s+oder|\d\s*vs\.?\s*\d|Option\s+[12AB]\b|entweder\/oder|beide[nr]?\s+(?:Optionen|Varianten|Möglichkeiten|Alternativen))\b|\b\w+\s+oder\s+\w+\s*\?/gim
	},
	{
		name: 'Gewichtung',
		re: /\b(?:entscheidend|kritisch|zentral|wesentlich|folgenreich|grundlegend|weitreichend|essenzi[ae]ll|unverzichtbar|maßgeblich|Weichenstellung|schreit nach|alles Weitere|Voraussetzung dafür|Priorität)\b/gi
	},
	{
		name: 'Affektkundgebung',
		re: /!|\b(?:spannend|großartig|hervorragend|exzellent|wunderbar|freue mich|leider|bedauerlich|faire? Kritik|sehr gut|absolut|perfekt|ehrlich gesagt|zugegeben)\b/gi
	},
	{
		name: 'Aufforderung',
		re: /(?:^|[.!?]\s+)(?:Erläutere|Erkläre|Zeig|Mach|Nimm|Prüfe|Schreib|Beantworte|Begründe|Vergleiche|Lass|Streich|Ändere|Bau|Setz|Formuliere)\w*\b/gm
	}
];

/** Zeilen mit der Position, der sie zuzuschreiben sind — Marken gelten bis zur nächsten. */
function attributedLines(
	turns: Turn[],
	positionen: Position[]
): { position: string; text: string; mark: string | null }[] {
	const zwei = positionen.length === 2;
	const gegenueber = (mark: string) => positionen.find((p) => p.mark !== mark)?.mark ?? 'unklar';
	const out: { position: string; text: string; mark: string | null }[] = [];
	for (const turn of turns) {
		if (turn.role !== 'rede') continue;
		let currentMark: string | null = null;
		for (const line of linesOf(turn.text, turn.charStart)) {
			if (line.kind !== 'rede') continue;
			if (line.mark) currentMark = line.mark;
			const eigen = !currentMark || OWN_SPEECH_MARKS.has(currentMark.toLowerCase());
			out.push({
				position: eigen ? turn.speakerMark : zwei ? gegenueber(turn.speakerMark) : 'unklar',
				// Ohne die Marke: „Antwort: Begründe den Unterschied" ist eine
				// Aufforderung, die am Satzanfang steht — die Marke davor ist
				// Auszeichnung, nicht Rede, und verdeckt sie sonst.
				text: line.mark ? line.text.replace(EMBEDDED_MARK, '').trim() : line.text,
				mark: currentMark
			});
		}
	}
	return out;
}

function verteilungen(turns: Turn[], positionen: Position[]): Verteilung[] {
	const lines = attributedLines(turns, positionen);
	const wortzahl = new Map<string, number>();
	for (const l of lines) {
		wortzahl.set(l.position, (wortzahl.get(l.position) ?? 0) + (l.text.match(/[\wÄÖÜäöüß]+/g)?.length ?? 0));
	}
	const marks = [...wortzahl.keys()];

	return MARK_KINDS.map(({ name, re }) => {
		const je: Record<string, { treffer: number; je1000: number }> = {};
		const beispiele: Record<string, string[]> = {};
		for (const p of marks) {
			je[p] = { treffer: 0, je1000: 0 };
			beispiele[p] = [];
		}
		for (const l of lines) {
			re.lastIndex = 0;
			const hits = l.text.match(re);
			if (!hits) continue;
			je[l.position].treffer += hits.length;
			if (beispiele[l.position].length < 2) {
				beispiele[l.position].push(l.text.replace(/\s+/g, ' ').trim().slice(0, 130));
			}
		}
		for (const p of marks) {
			const w = wortzahl.get(p) ?? 0;
			je[p].je1000 = w > 0 ? Math.round((je[p].treffer / w) * 1000 * 10) / 10 : 0;
		}
		const raten = marks.map((p) => je[p].je1000);
		const hoch = Math.max(...raten, 0);
		const tief = Math.min(...raten, Infinity);
		const schiefe = tief > 0 ? hoch / tief : hoch > 0 ? Infinity : 1;
		return { name, je, beispiele, schiefe };
	});
}

/**
 * Die Gestalt in Sätzen, in zwei Bündeln.
 *
 * `bau` ist, wie der Text gebaut ist — das geht dem Durchgang mit, der liest,
 * denn ohne es schreibt er Rede der falschen Position zu.
 *
 * `verteilung` ist, wie sich Oberflächenmarken auf die Positionen verteilen.
 * Das geht dem Durchgang NICHT mit: Es wäre ein lexikalischer Vorgriff auf das,
 * was er finden soll, und er fände dann zuverlässig die Position, die ihm
 * genannt wurde. Es geht an den Menschen — und an die Auswertung, wo dieselbe
 * Frage am gelesenen Muster beantwortet wird statt an Wortlisten.
 */
function befundSaetze(g: Omit<Gestalt, 'bau' | 'verteilungBefund'>): { bau: string[]; verteilung: string[] } {
	const s: string[] = [];
	const v: string[] = [];
	const n = g.positionen.length;

	if (g.form === 'none') {
		s.push('Der Text trägt keine Sprechermarken. Wer spricht, steht nirgends — jede Zuschreibung wäre erfunden.');
		return { bau: s, verteilung: v };
	}

	const liste = g.positionen
		.map((p) => `${p.mark} (${p.turns} Blöcke, ${Math.round(p.share * 100)} % der Rede${p.prompted ? ', mit Eingabezeichen' : ''})`)
		.join(', ');
	s.push(`${n === 1 ? 'Eine Sprecherposition' : `${n} Sprecherpositionen`}: ${liste}.`);
	if (g.form === 'terminal') {
		s.push(
			'Das Dokument ist ein Rohmitschnitt eines Terminals. Die Positionen tragen keine Namen — markiert sind eine Eingabe (❯) und ein Agent (●); wer sie sind, steht nicht im Text.'
		);
	}
	if (g.nichtRede.anteil >= 0.15) {
		s.push(
			`${Math.round(g.nichtRede.anteil * 100)} % des Dokuments sind überhaupt keine Äußerung, sondern Werkzeugausgabe und Rahmenwerk der Oberfläche — Quelltext, Dateilisten, Kastenlinien. Sie sind hier ausgenommen.`
		);
	}

	const { gewechselt, gesamt } = g.wechsel;
	if (gesamt > 0) {
		const q = gewechselt / gesamt;
		s.push(
			q >= 0.95
				? `Die Positionen wechseln sich durchgehend ab (${gewechselt} von ${gesamt} Blockgrenzen).`
				: q >= 0.6
					? `Die Positionen wechseln sich weitgehend ab (${gewechselt} von ${gesamt} Blockgrenzen); an ${gesamt - gewechselt} Grenzen folgt dieselbe Position auf sich selbst.`
					: g.form === 'terminal'
						? `Nur ${gewechselt} von ${gesamt} Blockgrenzen wechseln die Position: Auf jede Eingabe folgen viele Schritte des Agenten. Der Text ist in langen Strecken gebaut, nicht in Wechseln — ein Zug der Eingabe steht ${Math.round(gesamt / Math.max(1, gewechselt))} Agentenblöcke von seiner Erwiderung entfernt.`
						: `Die Positionen wechseln sich kaum ab (nur ${gewechselt} von ${gesamt} Blockgrenzen); der Text ist eher in Strecken als in Wechseln gebaut.`
		);
	}

	for (const z of g.zitate) {
		const marken = Object.entries(z.marken)
			.map(([m, c]) => `„${m}:" ${c}×`)
			.join(', ');
		s.push(`${z.von} zitiert in ${z.bloecke} Blöcken fremde Rede — ${marken}. Die Rede darunter gehört nicht ${z.von}.`);
	}

	// Verglichen wird die Dichte, nicht die absolute Zahl: Die Position mit dem
	// längeren Text führt sonst in jeder Kategorie. Und unter einer Handvoll
	// Treffer wird gar nichts behauptet — eine Schieflage von 1 zu 3 ist keine.
	for (const vt of g.verteilungen) {
		const eintraege = Object.entries(vt.je)
			.filter(([, x]) => x.treffer > 0)
			.sort((a, b) => b[1].je1000 - a[1].je1000);
		if (eintraege.length === 0) continue;
		const zahlen = eintraege.map(([p, x]) => `${p} ${x.treffer}× — ${x.je1000} je 1000 Wörter`).join('; ');
		const gesamt = eintraege.reduce((a, [, x]) => a + x.treffer, 0);
		const [top] = eintraege;
		if (gesamt < 6 || top[1].treffer < 3) {
			v.push(`„${vt.name}": zu wenige Treffer für eine Aussage über die Verteilung (${zahlen}).`);
		} else if (vt.schiefe >= 2.5) {
			const wie = Number.isFinite(vt.schiefe)
				? `liegt bei ${top[0]} ${Math.round(vt.schiefe * 10) / 10}× so dicht wie bei der anderen Position`
				: `steht ausschließlich bei ${top[0]}`;
			v.push(
				`„${vt.name}" ${wie} (${zahlen}). Dem Anschein nach eine Signatur dieser Position — ob sie es ist, entscheidet die Lesart.`
			);
		} else {
			v.push(`„${vt.name}" verteilt sich ähnlich dicht auf beide Positionen (${zahlen}).`);
		}
	}

	const nach = new Map<BruchArt, number>();
	for (const b of g.brueche) nach.set(b.art, (nach.get(b.art) ?? 0) + 1);
	const zo = nach.get('zitat-ohne-original') ?? 0;
	const vl = nach.get('verweis-ins-leere') ?? 0;
	const fo = nach.get('folge-ohne-wechsel') ?? 0;
	if (zo > 0)
		s.push(
			`${zo} zitierte Äußerungen haben im Text kein Original: Die andere Position stellt sie nirgends. Ihr Wortlaut existiert nur noch als Zitat in der Antwort darauf.`
		);
	if (vl > 0)
		s.push(
			`${vl} Stellen verweisen auf eine Aufzählung, die im Text davor nicht steht — das Verwiesene ist aus dem Protokoll gefallen.`
		);
	if (fo > 0) s.push(`${fo}× folgt eine Position auf sich selbst; dort kann ein Block fehlen.`);

	return { bau: s, verteilung: v };
}

/** Die Gestalt des Dokuments — deterministisch, ohne Modell. */
export function sichten(fullText: string): Gestalt {
	const { turns, form } = turnsOf(fullText);

	// Nur Rede zählt für die Positionen. Werkzeugausgabe und Rahmenwerk stehen
	// im Dokument, sind aber niemandes Äußerung; sie würden jede Verteilung
	// verfälschen und in jeder Lesart als Rede erscheinen.
	let werkzeugZeichen = 0;
	let rahmenZeichen = 0;
	const byMark = new Map<string, { turns: number; chars: number; prompted: boolean; notes: Set<string> }>();
	for (const t of turns) {
		let redeZeichen = 0;
		for (const line of linesOf(t.text, t.charStart)) {
			if (line.kind === 'rahmen') rahmenZeichen += line.text.length;
			else if (line.kind === 'werkzeug' || t.role !== 'rede') werkzeugZeichen += line.text.length;
			else redeZeichen += line.text.length;
		}
		if (t.role !== 'rede') continue;
		const e = byMark.get(t.speakerMark) ?? { turns: 0, chars: 0, prompted: false, notes: new Set<string>() };
		e.turns += 1;
		e.chars += redeZeichen;
		e.prompted ||= t.prompted;
		if (t.speakerNote) e.notes.add(t.speakerNote);
		byMark.set(t.speakerMark, e);
	}
	const total = [...byMark.values()].reduce((a, b) => a + b.chars, 0) || 1;
	const positionen: Position[] = [...byMark.entries()]
		.map(([mark, e]) => ({
			mark,
			turns: e.turns,
			chars: e.chars,
			share: e.chars / total,
			prompted: e.prompted,
			notes: [...e.notes]
		}))
		.sort((a, b) => b.chars - a.chars);

	const redeTurns = turns.filter((t) => t.role === 'rede');
	let gewechselt = 0;
	for (let i = 1; i < redeTurns.length; i++)
		if (redeTurns[i].speakerMark !== redeTurns[i - 1].speakerMark) gewechselt++;

	const zitatMap = new Map<string, { marken: Record<string, number>; bloecke: Set<number> }>();
	for (const t of redeTurns) {
		for (const line of linesOf(t.text, t.charStart)) {
			if (line.kind !== 'rede' || !line.mark || OWN_SPEECH_MARKS.has(line.mark.toLowerCase())) continue;
			const e = zitatMap.get(t.speakerMark) ?? { marken: {}, bloecke: new Set<number>() };
			e.marken[line.mark] = (e.marken[line.mark] ?? 0) + 1;
			e.bloecke.add(t.index);
			zitatMap.set(t.speakerMark, e);
		}
	}
	const zitate = [...zitatMap.entries()].map(([von, e]) => ({ von, marken: e.marken, bloecke: e.bloecke.size }));

	const brueche = form === 'none' ? [] : findBrueche(turns, positionen, form);

	const base: Omit<Gestalt, 'bau' | 'verteilungBefund'> = {
		form,
		chars: fullText.length,
		turns: redeTurns.length,
		positionen,
		wechsel: { gewechselt, gesamt: Math.max(0, redeTurns.length - 1) },
		zitate,
		nichtRede: {
			werkzeugZeichen,
			rahmenZeichen,
			anteil: fullText.length > 0 ? (werkzeugZeichen + rahmenZeichen) / fullText.length : 0
		},
		verteilungen: form === 'none' ? [] : verteilungen(turns, positionen),
		brueche
	};
	const { bau, verteilung } = befundSaetze(base);
	return { ...base, bau, verteilungBefund: verteilung };
}

// ── Der Schnitt ───────────────────────────────────────────────────

export type Zuschreibung = 'eigen' | 'zitiert' | 'unklar';

export interface Zug {
	index: number;
	charStart: number;
	charEnd: number;
	text: string;
	/** Sprechermarke des Blocks. */
	turnSpeakerMark: string;
	turnSpeakerNote: string | null;
	turnText: string;
	/** Marke, unter der diese Passage steht („Frage", „Antwort"), falls es eine gibt. */
	embeddedMark: string | null;
	/** Wer hier spricht — aus der Gestalt geschlossen, nicht aus der Blockmarke abgelesen. */
	position: string;
	zuschreibung: Zuschreibung;
	previousTurn: { speakerMark: string; text: string } | null;
	/** Die Risse, die diese Passage betreffen. */
	brueche: Bruch[];
}

export interface ZugOptions {
	/** Unterhalb dieser Länge wird weiter zusammengelegt. */
	minChars?: number;
	/** Ab dieser Länge wird an der nächsten Strukturgrenze getrennt. */
	maxChars?: number;
	/** So viele Zeichen des vorangehenden Blocks gehen mit. */
	previousChars?: number;
}

/**
 * Passagen, über die hinweg die Zuschreibung stabil ist.
 *
 * Grenzen sind der Blockkopf und jede Marke darin. Bleibt eine Passage danach
 * zu lang — die langen Blöcke einer Position sind gegliedert, nicht
 * einstimmig —, wird zusätzlich an Struktur getrennt: Überschrift, Absatz,
 * Listen- und Tabellenbeginn. Innerhalb eines Absatzes wird nicht getrennt,
 * denn dort ist der Zug zu Hause.
 */
export function zuegeOf(fullText: string, gestalt: Gestalt, opts: ZugOptions = {}): Zug[] {
	const minChars = opts.minChars ?? 120;
	const maxChars = opts.maxChars ?? 1400;
	const previousChars = opts.previousChars ?? 700;
	const { turns } = turnsOf(fullText);

	// Bei genau zwei Positionen ist zitierte Rede eindeutig der anderen
	// zuzuschreiben. Bei mehr als zwei ist sie es nicht, und dann heißt sie
	// unklar — das ist ein Ergebnis, keine Lücke.
	const zwei = gestalt.positionen.length === 2;
	const gegenueber = (mark: string) => gestalt.positionen.find((p) => p.mark !== mark)?.mark ?? 'unklar';

	const zuege: Zug[] = [];
	for (const turn of turns) {
		// Werkzeugblöcke sind keine Äußerung. Wer sie mitschneidet, legt einem
		// Durchgang Quelltext und Dateilisten als Rede vor.
		if (turn.role !== 'rede') continue;
		const prev = turn.index > 0 ? turns[turn.index - 1] : null;
		const previousTurn = prev ? { speakerMark: prev.speakerMark, text: prev.text.trim().slice(-previousChars) } : null;

		let pending: { text: string; start: number; end: number; mark: string | null } | null = null;
		const flush = () => {
			if (!pending) return;
			const mark = pending.mark;
			const eigen = !mark || OWN_SPEECH_MARKS.has(mark.toLowerCase());
			const zuschreibung: Zuschreibung = eigen ? 'eigen' : zwei ? 'zitiert' : 'unklar';
			zuege.push({
				index: zuege.length + 1,
				charStart: pending.start,
				charEnd: pending.end,
				text: pending.text,
				turnSpeakerMark: turn.speakerMark,
				turnSpeakerNote: turn.speakerNote,
				turnText: turn.text.trim(),
				embeddedMark: mark,
				position: eigen ? turn.speakerMark : zwei ? gegenueber(turn.speakerMark) : 'unklar',
				zuschreibung,
				previousTurn,
				brueche: gestalt.brueche.filter((b) => b.charStart < pending!.end && b.charEnd >= pending!.start)
			});
			pending = null;
		};

		let currentMark: string | null = null;
		for (const line of linesOf(turn.text, turn.charStart)) {
			// Werkzeugausgabe innerhalb eines Redeblocks trennt die Rede davor von
			// der danach, gehört aber selbst nicht dazu.
			if (line.kind !== 'rede') {
				flush();
				continue;
			}
			// Eine Marke beginnt immer eine neue Passage — sie zeigt an, dass ab
			// hier jemand anderes spricht. Und sie gilt bis zur nächsten: „Frage:
			// Welche Erhebungsmethode ziehen Sie vor?" und der Folgesatz „Davon hängt
			// das gesamte Projekt ab." sind beide zitierte Rede, obwohl nur die
			// erste Zeile die Marke trägt.
			if (line.mark) {
				flush();
				currentMark = line.mark;
			}

			const grenze = pending !== null && pending.end - pending.start >= maxChars && (line.afterBlank || line.structural);
			if (grenze) flush();

			if (pending) {
				pending.text = `${pending.text}\n${line.text}`;
				pending.end = line.end;
			} else {
				pending = { text: line.text, start: line.start, end: line.end, mark: currentMark };
			}

			// Eine sehr lange Zeile (Tabellenzeile, Absatz ohne Umbruch) trennt für
			// sich, sobald sie das Maß überschreitet.
			if (pending.end - pending.start >= maxChars * 2) flush();
		}
		flush();
	}

	// Zu kurze Passagen an die vorige anhängen, solange die Zuschreibung
	// dieselbe bleibt. „Ja, gleich zu Beginn" ist keine Passage, an der sich etwas
	// entscheiden ließe — aber sie gehört zur Antwort, unter der sie steht.
	const zusammen: Zug[] = [];
	for (const z of zuege) {
		const last = zusammen[zusammen.length - 1];
		const passt =
			last &&
			last.charEnd - last.charStart < minChars &&
			last.turnSpeakerMark === z.turnSpeakerMark &&
			last.embeddedMark === z.embeddedMark;
		if (passt) {
			last.text = `${last.text}\n${z.text}`;
			last.charEnd = z.charEnd;
			last.brueche = [...last.brueche, ...z.brueche.filter((b) => !last.brueche.includes(b))];
		} else {
			zusammen.push({ ...z, index: zusammen.length + 1 });
		}
	}
	return zusammen.map((z, i) => ({ ...z, index: i + 1 }));
}

/** Die Passage(n), die eine Zeichenspanne überlappen. */
export function zuegeOverlapping(zuege: Zug[], pos0: number, pos1: number): Zug[] {
	return zuege.filter((z) => pos0 < z.charEnd && pos1 > z.charStart);
}

/** Die Bauform in der Fassung, in der sie einem Durchgang mitgegeben wird. */
export function gestaltBlock(g: Gestalt): string {
	return ['SO IST DIESER TEXT GEBAUT:', ...g.bau.map((s) => `• ${s}`)].join('\n');
}
