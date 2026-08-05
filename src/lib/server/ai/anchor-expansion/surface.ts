// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Oberfläche: die Zeichen, an denen im rohen Text steht, wer spricht.
//
// Diese Schicht liest nicht und deutet nicht. Sie findet die Marken — die
// Blockköpfe eines Protokolls, die Sprecherkennungen eines Transkripts, die
// Marken innerhalb eines Blocks, unter denen fremde Rede steht — und schneidet
// Sätze. Was sich daraus über die Gestalt des Textes ergibt, steht in
// `gestalt.ts`; was an einer Stelle geschieht, entscheidet erst die Lesart.
//
// Getrennt gehalten, weil die Marken das einzige sind, was hier ohne jede
// Annahme dasteht. Alles Weitere ist Schluss aus ihnen und muss als Schluss
// kenntlich bleiben.

/** Blockkopf im Sitzungsprotokoll: `[16:20] ❯ BENJAMIN (…)`, `[16:16] CLAUDE`. */
const SESSION_TURN = /^\[(\d{1,2}:\d{2})\]\s*(❯\s*)?([A-ZÄÖÜ][A-Za-zÄÖÜäöüß _-]{1,40}?)\s*(\([^)]*\))?\s*$/gm;
/** Sprecherkennung im Transkript: `S00 [00:12:34]:`. */
const TRANSCRIPT_TURN = /\bS(\d{1,3})\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*:/g;

// Rohmitschnitt eines Terminals. Hier steht kein Name; markiert sind eine
// Eingabe (`❯`) und ein Agent (`●`). Wie die beiden heißen, steht nicht da —
// es wird deshalb auch nicht behauptet. Der Rest des Mitschnitts ist
// Werkzeugausgabe (`⎿` samt eingerücktem Anhang) und Rahmenwerk der Oberfläche;
// beides ist keine Rede und darf in keiner Lesart als solche zählen.
const TERMINAL_PROMPT = /^[ \t]*❯[ \t]+(?=\S)/;
const TERMINAL_AGENT = /^●[ \t]+(?=\S)/;
/** `● Write(…)`, `● Bash(…)` — ein Werkzeugaufruf, keine Äußerung. */
const TOOL_CALL = /^●[ \t]+[A-Z][A-Za-z]*\(/;
const TOOL_OUT = /^[ \t]*⎿/;
const FRAME = /^[ \t]*[│╭╮╰╯├┤└┘┌┐┬┴┼─═║▌▛▜▝▘▐█▙▟]/;
const FOLD = /^[ \t]*…[ \t]*\+\d+[ \t]+lines/;

export const PROMPT_POSITION = 'EINGABE';
export const AGENT_POSITION = 'AGENT';

/** Marken INNERHALB eines Blocks, unter denen Rede steht, die nicht die des Blocks ist. */
export const EMBEDDED_MARK = /^\s*(Frage|Antwort|Q|A|Zitat|Prompt|Ausgabe)\s*:/i;
/** Welche dieser Marken die eigene Rede des Blocksprechers auszeichnen. */
export const OWN_SPEECH_MARKS = new Set(['antwort', 'a']);

/** Satzgrenze — konservativ, damit „z.B." und „Abb. 3" nicht trennen. */
const SENTENCE_END = /([.?!…])(["»'\)\]]*)\s+(?=[A-ZÄÖÜ„»"(\[])/g;

export interface Turn {
	index: number;
	/** Sprechermarke, wie sie dasteht. NICHT notwendig der Akteur jedes Satzes darin. */
	speakerMark: string;
	/** Zusatz in Klammern, z. B. „(Antworten auf die Rückfragen)". */
	speakerNote: string | null;
	/** Trägt der Kopf ein Eingabezeichen (`❯`)? Im CLI-Protokoll kennzeichnet es den Menschen. */
	prompted: boolean;
	/** Rede oder Werkzeugbetrieb. Werkzeugblöcke sind keine Äußerungen. */
	role: 'rede' | 'werkzeug';
	charStart: number;
	charEnd: number;
	text: string;
}

function sessionTurns(text: string): Turn[] {
	const marks: { mark: string; note: string | null; prompted: boolean; at: number; end: number }[] = [];
	SESSION_TURN.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SESSION_TURN.exec(text)) !== null) {
		marks.push({
			mark: m[3].trim(),
			note: m[4] ? m[4].slice(1, -1).trim() : null,
			prompted: Boolean(m[2]),
			at: m.index,
			end: m.index + m[0].length
		});
	}
	return marks.map((mk, i) => {
		const stop = i + 1 < marks.length ? marks[i + 1].at : text.length;
		return {
			index: i,
			speakerMark: mk.mark,
			speakerNote: mk.note,
			prompted: mk.prompted,
			role: 'rede' as const,
			charStart: mk.end,
			charEnd: stop,
			text: text.slice(mk.end, stop)
		};
	});
}

function transcriptTurns(text: string): Turn[] {
	const marks: { mark: string; at: number; end: number }[] = [];
	TRANSCRIPT_TURN.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TRANSCRIPT_TURN.exec(text)) !== null) {
		marks.push({ mark: `S${m[1]}`, at: m.index, end: m.index + m[0].length });
	}
	return marks.map((mk, i) => {
		const stop = i + 1 < marks.length ? marks[i + 1].at : text.length;
		return {
			index: i,
			speakerMark: mk.mark,
			speakerNote: null,
			prompted: false,
			role: 'rede' as const,
			charStart: mk.end,
			charEnd: stop,
			text: text.slice(mk.end, stop)
		};
	});
}

/**
 * Rohmitschnitt eines Terminals: `❯` beginnt eine Eingabe, `●` eine Äußerung
 * oder einen Werkzeugaufruf des Agenten. Ein Name steht nirgends — die
 * Positionen heißen deshalb nach ihrer Marke, nicht nach einer Vermutung.
 */
function terminalTurns(text: string): Turn[] {
	const heads: { mark: string; prompted: boolean; role: 'rede' | 'werkzeug'; at: number; end: number }[] = [];
	let cursor = 0;
	for (const raw of text.split('\n')) {
		const prompt = TERMINAL_PROMPT.exec(raw);
		const agent = prompt ? null : TERMINAL_AGENT.exec(raw);
		if (prompt) {
			heads.push({ mark: PROMPT_POSITION, prompted: true, role: 'rede', at: cursor, end: cursor + prompt[0].length });
		} else if (agent) {
			heads.push({
				mark: AGENT_POSITION,
				prompted: false,
				role: TOOL_CALL.test(raw) ? 'werkzeug' : 'rede',
				at: cursor,
				end: cursor + agent[0].length
			});
		}
		cursor += raw.length + 1;
	}
	return heads.map((h, i) => {
		const stop = i + 1 < heads.length ? heads[i + 1].at : text.length;
		return {
			index: i,
			speakerMark: h.mark,
			speakerNote: null,
			prompted: h.prompted,
			role: h.role,
			charStart: h.end,
			charEnd: stop,
			text: text.slice(h.end, stop)
		};
	});
}

export type TurnForm = 'session' | 'transcript' | 'terminal' | 'none';

/**
 * Die Blöcke des Dokuments. Findet sich keine Marke, ist das ganze Dokument ein
 * Block mit unbekanntem Sprecher — dann trägt die Oberfläche nichts bei, und
 * das steht so im Ergebnis, statt dass eine Zuschreibung erfunden wird.
 */
export function turnsOf(text: string): { turns: Turn[]; form: TurnForm } {
	const s = sessionTurns(text);
	if (s.length >= 2) return { turns: s, form: 'session' };
	const t = transcriptTurns(text);
	if (t.length >= 2) return { turns: t, form: 'transcript' };
	const c = terminalTurns(text);
	if (c.length >= 2) return { turns: c, form: 'terminal' };
	return {
		turns: [
			{
				index: 0,
				speakerMark: 'unbekannt',
				speakerNote: null,
				prompted: false,
				role: 'rede',
				charStart: 0,
				charEnd: text.length,
				text
			}
		],
		form: 'none'
	};
}

export interface Line {
	text: string;
	start: number;
	end: number;
	/** Marke am Zeilenanfang („Frage", „Antwort"), falls vorhanden. */
	mark: string | null;
	/** Strukturzeichen am Zeilenanfang: Überschrift, Listenpunkt, Tabellenzeile. */
	structural: boolean;
	/** Leerzeile davor — im Protokoll eine Absatzgrenze. */
	afterBlank: boolean;
	/** Rede, Werkzeugausgabe oder Rahmenwerk der Oberfläche. */
	kind: 'rede' | 'werkzeug' | 'rahmen';
}

const STRUCTURAL = /^(#{1,6}\s|[-*•]\s|\d+[.)]\s|\||>\s|```)/;

/**
 * Zeilen eines Blocks, mit Zeichenversatz relativ zum Dokument.
 *
 * Werkzeugausgabe und Rahmenwerk bleiben stehen — mit ihren richtigen Versätzen,
 * damit Anker weiter treffen —, sind aber als solche ausgewiesen. Wer sie als
 * Rede liest, liest Quelltext und Kastenlinien für Äußerungen.
 */
export function linesOf(turnText: string, base: number): Line[] {
	const out: Line[] = [];
	let cursor = 0;
	let blank = false;
	// Werkzeugausgabe reicht über ihre erste Zeile hinaus: Was danach eingerückt
	// folgt, gehört noch dazu, bis wieder etwas am linken Rand beginnt.
	let inTool = false;
	for (const raw of turnText.split('\n')) {
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			blank = true;
		} else {
			const lead = raw.indexOf(trimmed);
			const markMatch = trimmed.match(EMBEDDED_MARK);
			if (TOOL_OUT.test(raw)) inTool = true;
			else if (lead === 0) inTool = false;
			const kind: Line['kind'] = FRAME.test(raw)
				? 'rahmen'
				: inTool || FOLD.test(raw)
					? 'werkzeug'
					: 'rede';
			out.push({
				text: trimmed,
				start: base + cursor + lead,
				end: base + cursor + lead + trimmed.length,
				mark: markMatch ? markMatch[1] : null,
				structural: STRUCTURAL.test(trimmed),
				afterBlank: blank,
				kind
			});
			blank = false;
		}
		cursor += raw.length + 1;
	}
	return out;
}

/** Sätze einer Zeile, mit Zeichenversatz relativ zum Dokument. */
export function sentencesOf(line: Line): { text: string; start: number; end: number }[] {
	const out: { text: string; start: number; end: number }[] = [];
	let cursor = 0;
	SENTENCE_END.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SENTENCE_END.exec(line.text)) !== null) {
		const end = m.index + m[1].length + m[2].length;
		const piece = line.text.slice(cursor, end).trim();
		if (piece.length > 0) out.push({ text: piece, start: line.start + cursor, end: line.start + end });
		cursor = SENTENCE_END.lastIndex;
	}
	const rest = line.text.slice(cursor).trim();
	if (rest.length > 0) out.push({ text: rest, start: line.start + cursor, end: line.end });
	return out;
}

// ── Wortvergleich ─────────────────────────────────────────────────
// Für die Frage, ob ein Zitat im Text ein Original hat. Kein Stemming — die
// Protokolle sind deutsch, und ein Zitat, das wörtlich zitiert, trifft auch
// ungestemmt. Wo es nicht wörtlich zitiert, ist die Antwort ohnehin unsicher
// und soll unsicher heißen.

export function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-zäöüß0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 0);
}

/** Kommt eine zusammenhängende Wortfolge der Länge `n` aus `needle` in `haystack` vor? */
export function sharesNgram(needle: string, haystack: string, n = 4): boolean {
	const a = words(needle);
	const b = words(haystack);
	if (a.length === 0 || b.length === 0) return false;
	if (a.length < n) return b.join(' ').includes(a.join(' '));
	const hay = ` ${b.join(' ')} `;
	for (let i = 0; i + n <= a.length; i++) {
		if (hay.includes(` ${a.slice(i, i + n).join(' ')} `)) return true;
	}
	return false;
}
