// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lexikalische Unterscheidung: welches Vokabular eine Gruppe von Texten
// von einer anderen abhebt.
//
// Warum das hier steht, nachdem die Embedding-Gruppierung verworfen wurde
// (eval/corpus-structure/RESULT.md): Gemittelte Satz-Embeddings kodieren
// auf Sequenzebene Register und Domäne, nicht Subthema — vier Interviews
// zum gleichen Gegenstand liegen 0,003 voneinander entfernt. Das Verfahren
// hier rechnet an derselben Stelle, wo die Mittelung wegrechnet: an den
// einzelnen Wörtern. Ein Subthema, das eigenes Vokabular mitführt, bleibt
// unterscheidbar, auch wenn Register und Domäne durchgehend gleich sind.
//
// Der entscheidende Unterschied zur Gruppierung: Dieses Verfahren
// **findet keine Gruppen**. Es setzt eine Partition voraus und sagt, was
// deren Teile unterscheidet. Das ist für diese Anlage die passendere
// Operation — die Partitionen liegen vor (Dokumente, Sequenzen, die
// Instanzenmengen eines Namings), und es wird nichts erfunden, das dann
// als Struktur auftreten könnte.
//
// Zwei Maße, beide ausgewiesen:
//
//   1. `diff` — Difference of proportions, wie Nelson (2020, S. 15 f.) es
//      rechnet: Anteil in A minus Anteil in B, in Prozentpunkten. Einfach
//      und lesbar, aber von häufigen Wörtern dominiert; ohne Stoppwort-
//      Liste steht dort nur Funktionswortrauschen.
//   2. `z` — Log-Odds-Ratio mit informativem Dirichlet-Prior nach Monroe,
//      Colaresi & Quinn (2008), also der Quelle, die Nelson für das erste
//      Maß selbst zitiert. Varianzgewichtet: häufige Wörter gewinnen nicht
//      automatisch, seltene nicht zufällig. Das ist das Maß, das man liest.
//
// Alle Vorentscheidungen (Stoppwörter, Mindesthäufigkeit, Prior-Stärke)
// stehen im Ergebnis. Nelsons eigenes Argument: solche Entscheidungen
// gehören sichtbar in das Verfahren geschrieben, nicht wegdefiniert.

// ── Tokenisierung ─────────────────────────────────────────────────

/**
 * Transkriptnotation, die vor dem Zählen verschwindet: Zeitmarken
 * `[00:05:17]`, Sprecherkürzel `S00:`, Pausen `(.)` `(...)`, und die
 * noScribe-Kopfzeile. Das ist Notation über die Rede, nicht Rede.
 */
function stripTranscriptNotation(text: string): string {
	return (
		text
			.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ')
			.replace(/\bS\d{1,3}\s*:/g, ' ')
			.replace(/\(\.{1,}\)/g, ' ')
			// noScribe schreibt lange Pausen aus: "(12 Sekunden Pause)". Ohne
			// diese Zeile trägt "sekunden · pause" als gemeinsames Merkmal in
			// die Befunde ein — beobachtet, nicht vermutet.
			.replace(/\(?\s*\d+\s*Sekunden?\s*Pause\s*\)?/gi, ' ')
			.replace(/\bTranskribiert mit noScribe[^\n]*/gi, ' ')
			.replace(/\bAudiodatei:[^\n]*/gi, ' ')
			.replace(/\baudio\d{6,}\b/gi, ' ')
	);
}

/**
 * Sprecherturns eines Transkripts, anhand der `S00 [00:12:34]:`-Marken.
 *
 * Wozu: In einem Interview ist die Rede der Interviewerin strukturell
 * anderes Material als die der Befragten. Ihre Frageformeln („würdest du
 * sagen …") treten als gemeinsames Merkmal zweier Passagen hervor und
 * sehen dann wie ein Thema aus — beobachtet an genau diesem Dokument.
 * Wessen Rede zählt, entscheidet die Forscherin; das Modul stellt die
 * Trennung bereit und trifft die Entscheidung nicht.
 */
export function speakerTurns(text: string): { speaker: string; text: string }[] {
	const re = /\bS(\d{1,3})\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*:/g;
	const marks: { speaker: string; at: number; end: number }[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		marks.push({ speaker: `S${m[1]}`, at: m.index, end: m.index + m[0].length });
	}
	if (marks.length === 0) return [{ speaker: 'unknown', text }];
	const out: { speaker: string; text: string }[] = [];
	for (let i = 0; i < marks.length; i++) {
		const stop = i + 1 < marks.length ? marks[i + 1].at : text.length;
		out.push({ speaker: marks[i].speaker, text: text.slice(marks[i].end, stop) });
	}
	return out;
}

/** Nur die Rede der genannten Sprecher behalten. */
export function keepSpeakers(text: string, speakers: string[]): string {
	const set = new Set(speakers);
	return speakerTurns(text)
		.filter((t) => set.has(t.speaker))
		.map((t) => t.text)
		.join(' ');
}

/**
 * Deutsche Funktionswörter — geschlossene Klassen: Artikel, Pronomen samt
 * Flexion, Hilfs- und Modalverben samt Paradigma, Präpositionen, die
 * da-/wo-Komposita, Konjunktionen, ausgeschriebene Zahlwörter.
 *
 * Bewusst *keine* Füllwörter (ähm, mhm, halt, eigentlich) und keine
 * Vollverben (machen, sagen, tun): die sind in qualitativer Forschung
 * mitunter der Befund und werden nicht stillschweigend entfernt. Wer sie
 * los werden will, übergibt eine eigene Liste — dann steht die Entscheidung
 * im Ergebnis.
 */
export const GERMAN_STOPWORDS = new Set(
	`aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes
	 auch auf aus bei beim bin bis bist da damit dann das dass dasselbe dazu dein deine dem den denn
	 denselben der derer des deshalb dessen dich die dies diese dieselbe diesem diesen dieser dieses
	 dir doch dort du durch ein eine einem einen einer eines er es etwas euer euch für gegen gewesen
	 hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer
	 im in indem ins ist ja jede jedem jeden jeder jedes jene jetzt kann kein keine können könnte
	 mal man manche mein meine mich mir mit muss musste nach nicht nichts noch nun nur ob oder ohne
	 sehr sein seine seinem seinen seiner selbst sich sie sind so solche soll sollte sondern sonst
	 über um und uns unser unsere unter viel vom von vor war waren warst was weg weil weiter welche
	 wenn wer werde werden wie wieder will wir wird wirst wo wollen wollte würde würden zu zum zur
	 zwar zwischen

	 seid wäre wären wärst gewesen habt hätte hätten hättest gehabt
	 wurde wurden werdet worden geworden würdest würdet
	 darf darfst dürfen durfte durften dürfte dürften kannst könnt konnte konnten könnten
	 mag magst mögen mochte möchte möchten musst müssen mussten müsste müssten
	 sollst sollen sollten willst wollt wolltest wollten

	 denen deren welchem welchen welcher welches manchem manchen mancher manches
	 jenem jenen jener jenes derselben demselben dieselben
	 eure eurem euren eures unserem unseren unseres meinem meinen meines
	 deinem deinen deines seines solchem solchen solcher solches einige einigen einiges
	 keinem keinen keiner keines niemand niemandem jemand jemandem

	 dabei dadurch dafür dagegen daher dahin daran darauf daraus darin darüber darum
	 davon davor dazwischen demnach dennoch trotzdem außerdem hierbei hierfür
	 wobei wodurch wofür wogegen woher wohin womit woran worauf woraus worin worüber wovon

	 eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf hundert tausend
	 erste erster erstes zweite zweiter zweites dritte dritter drittes`
		.split(/\s+/)
		.filter(Boolean)
);

/**
 * Tokenisierung: Kleinschreibung, Trennung an allem, was kein Buchstabe
 * ist. Kein Stemming — für Deutsch ist algorithmisches Stemmen fehleranfällig
 * (Umlaut-Plurale, Komposita), und Nelson führt Stemming ohnehin als
 * Forscherentscheidung, nicht als Selbstverständlichkeit (S. 18).
 */
export function tokenize(
	text: string,
	stopwords: Set<string> = GERMAN_STOPWORDS,
	minLength = 3
): string[] {
	const cleaned = stripTranscriptNotation(text).toLowerCase();
	const raw = cleaned.split(/[^a-zäöüßáàéèíìóòúù]+/);
	const out: string[] = [];
	for (const t of raw) {
		if (t.length < minLength) continue;
		if (stopwords.has(t)) continue;
		out.push(t);
	}
	return out;
}

// ── Zählen ────────────────────────────────────────────────────────

export interface Counts {
	counts: Map<string, number>;
	total: number;
}

export function countTokens(texts: string[], stopwords?: Set<string>, minLength?: number): Counts {
	const counts = new Map<string, number>();
	let total = 0;
	for (const text of texts) {
		for (const t of tokenize(text, stopwords, minLength)) {
			counts.set(t, (counts.get(t) ?? 0) + 1);
			total++;
		}
	}
	return { counts, total };
}

// ── Vergleich ─────────────────────────────────────────────────────

export interface TermScore {
	term: string;
	/** Absolute Häufigkeit in A bzw. B. */
	countA: number;
	countB: number;
	/** Anteil an allen Tokens der Gruppe, in Prozent. */
	propA: number;
	propB: number;
	/** Nelsons Maß: propA − propB, in Prozentpunkten. */
	diff: number;
	/** Monroe et al. (2008): z-Wert des Log-Odds-Ratio mit informativem
	 *  Dirichlet-Prior. Positiv = für A kennzeichnend. */
	z: number;
}

export interface ComparisonOptions {
	/** Mindestens so oft im *gemeinsamen* Bestand, sonst nicht bewertet.
	 *  Verhindert, dass Einzelvorkommen die Liste füllen. */
	minTotalCount?: number;
	/** Stärke des Dirichlet-Priors (Monroe et al.). Höher = stärkere
	 *  Rückholung seltener Wörter zum Korpusmittel. */
	priorStrength?: number;
	stopwords?: Set<string>;
	minLength?: number;
}

export interface Comparison {
	/** Alle bewerteten Terme, absteigend nach z. */
	terms: TermScore[];
	totalA: number;
	totalB: number;
	vocabulary: number;
	/** Was an Vorentscheidungen eingegangen ist — gehört ins Ergebnis. */
	params: { minTotalCount: number; priorStrength: number; minLength: number; stopwords: number };
}

/**
 * Difference of proportions und Log-Odds-z zwischen zwei Textgruppen.
 *
 * Der Prior kommt aus dem *gemeinsamen* Bestand beider Gruppen: α₀ʷ =
 * priorStrength · (Gesamthäufigkeit von w / Gesamttokens). Damit wird ein
 * seltenes Wort, das zufällig nur in A vorkommt, zum Korpusmittel
 * zurückgeholt, statt die Liste anzuführen.
 */
export function compareGroups(
	textsA: string[],
	textsB: string[],
	opts: ComparisonOptions = {}
): Comparison {
	const minTotalCount = opts.minTotalCount ?? 5;
	const priorStrength = opts.priorStrength ?? 500;
	const minLength = opts.minLength ?? 3;
	const stopwords = opts.stopwords ?? GERMAN_STOPWORDS;

	const a = countTokens(textsA, stopwords, minLength);
	const b = countTokens(textsB, stopwords, minLength);

	const vocab = new Set([...a.counts.keys(), ...b.counts.keys()]);
	const grandTotal = a.total + b.total;

	// α₀ = Summe der Prior-Pseudocounts über das gesamte Vokabular.
	const alpha0 = priorStrength;

	const terms: TermScore[] = [];
	for (const term of vocab) {
		const ca = a.counts.get(term) ?? 0;
		const cb = b.counts.get(term) ?? 0;
		if (ca + cb < minTotalCount) continue;

		const propA = a.total > 0 ? (ca / a.total) * 100 : 0;
		const propB = b.total > 0 ? (cb / b.total) * 100 : 0;

		// Monroe et al. (2008), Gl. 16/20: Log-Odds-Ratio mit informativem
		// Dirichlet-Prior, varianzgewichtet.
		const alphaW = priorStrength * ((ca + cb) / grandTotal);
		const numA = ca + alphaW;
		const denA = a.total + alpha0 - ca - alphaW;
		const numB = cb + alphaW;
		const denB = b.total + alpha0 - cb - alphaW;
		let z = 0;
		if (numA > 0 && denA > 0 && numB > 0 && denB > 0) {
			const delta = Math.log(numA / denA) - Math.log(numB / denB);
			const variance = 1 / numA + 1 / numB;
			z = delta / Math.sqrt(variance);
		}

		terms.push({ term, countA: ca, countB: cb, propA, propB, diff: propA - propB, z });
	}

	terms.sort((x, y) => y.z - x.z);
	return {
		terms,
		totalA: a.total,
		totalB: b.total,
		vocabulary: vocab.size,
		params: { minTotalCount, priorStrength, minLength, stopwords: stopwords.size }
	};
}

// ── Streuung: Stil oder Thema ─────────────────────────────────────

/**
 * Konzentration eines Terms über die Einheiten, in denen er vorkommt.
 *
 * Das ist die Trennung, die eine Stoppwortliste nicht leisten kann. Der
 * Log-Odds-z sagt nur, dass ein Wort für eine Gruppe kennzeichnend ist —
 * und die kennzeichnendsten Wörter eines Interviews sind zunächst der
 * Idiolekt der sprechenden Person (*finde, halt, eben, total, natürlich*).
 * Solche Marker sind über die ganze Rede **gleichmäßig verteilt**. Ein Wort,
 * das ein Thema trägt, ist **geballt**: es steht in wenigen Passagen und
 * fehlt sonst.
 *
 * Gemessen gegen den Zufall: bei gleichmäßiger Streuung eines Terms mit
 * Gesamthäufigkeit C über N Einheiten erwartet man ihn in
 * N·(1 − e^(−C/N)) Einheiten (Poisson). Steht er in deutlich weniger, ist
 * er geballt.
 *
 * Rückgabe in [0, 1): 0 = so gestreut wie der Zufall (Stil),
 * gegen 1 = maximal geballt (Themenkandidat). Gegen die Häufigkeit
 * normalisiert, damit häufige Wörter nicht automatisch als gestreut gelten.
 */
export function burstiness(perUnitCounts: number[]): number {
	const N = perUnitCounts.length;
	if (N === 0) return 0;
	const C = perUnitCounts.reduce((a, b) => a + b, 0);
	if (C === 0) return 0;
	const observed = perUnitCounts.filter((c) => c > 0).length;
	const expected = N * (1 - Math.exp(-C / N));
	if (expected <= 0) return 0;
	const ratio = observed / expected;
	return Math.max(0, Math.min(1, 1 - ratio));
}

/**
 * Streuungswerte für alle Terme über eine Menge von Einheiten (typischerweise
 * die Sequenzen eines Dokuments).
 */
export function burstinessByTerm(
	unitTexts: string[],
	stopwords?: Set<string>,
	minLength?: number
): Map<string, number> {
	const perUnit: Map<string, number>[] = unitTexts.map((t) => {
		const m = new Map<string, number>();
		for (const tok of tokenize(t, stopwords, minLength)) m.set(tok, (m.get(tok) ?? 0) + 1);
		return m;
	});
	const vocab = new Set<string>();
	for (const m of perUnit) for (const k of m.keys()) vocab.add(k);

	const out = new Map<string, number>();
	for (const term of vocab) {
		out.set(
			term,
			burstiness(perUnit.map((m) => m.get(term) ?? 0))
		);
	}
	return out;
}

/** Die n kennzeichnendsten Terme je Richtung. */
export function distinctiveTerms(
	comparison: Comparison,
	n = 15
): { forA: TermScore[]; forB: TermScore[] } {
	return {
		forA: comparison.terms.slice(0, n),
		forB: comparison.terms.slice(-n).reverse()
	};
}

// ── Sequenzprofile ────────────────────────────────────────────────

export interface SequenceProfile {
	seq: number;
	documentId: string;
	charStart: number;
	charEnd: number;
	text: string;
	/** Die kennzeichnenden Terme dieser Sequenz gegenüber dem übrigen
	 *  Dokument, absteigend nach z, gefiltert auf geballte Terme. */
	terms: { term: string; z: number; burstiness: number }[];
}

export interface ProfileInput {
	seq: number;
	documentId: string;
	charStart: number;
	charEnd: number;
	text: string;
}

/**
 * Für jede Sequenz: was sie vom *übrigen* Dokument abhebt.
 *
 * Das ist die Größe, an der sich entscheidet, ob dieser Weg trägt. Aus ihr
 * folgt eine Ähnlichkeit zwischen Sequenzen, die **nicht** die Embedding-
 * Ähnlichkeit ist: zwei Sequenzen gehören zusammen, wenn sie *dieselben
 * seltenen Wörter* gegenüber dem Rest hervortreten lassen — genau das, was
 * die Mittelung im Embedding wegrechnet.
 *
 * @param topTerms  wie viele kennzeichnende Terme je Sequenz behalten werden.
 */
export function sequenceProfiles(
	items: ProfileInput[],
	topTerms = 20,
	opts: ComparisonOptions & { minBurstiness?: number } = {}
): SequenceProfile[] {
	// Eine Sequenz ist kurz; gegen das ganze Dokument gerechnet ist die
	// Mindesthäufigkeit von 5 zu streng, sonst bleibt nichts übrig.
	const localOpts: ComparisonOptions = { minTotalCount: 2, ...opts };
	// Gleichmäßig gestreute Wörter sind Stil, nicht Thema — einmal für das
	// ganze Dokument gerechnet und dann als Filter auf jedes Profil gelegt.
	const minBurstiness = opts.minBurstiness ?? 0.15;
	const burst = burstinessByTerm(
		items.map((i) => i.text),
		opts.stopwords,
		opts.minLength
	);

	const out: SequenceProfile[] = [];
	for (const it of items) {
		const rest = items.filter((o) => !(o.documentId === it.documentId && o.seq === it.seq));
		const cmp = compareGroups([it.text], rest.map((o) => o.text), localOpts);
		out.push({
			seq: it.seq,
			documentId: it.documentId,
			charStart: it.charStart,
			charEnd: it.charEnd,
			text: it.text,
			terms: cmp.terms
				.filter((t) => t.countA > 0 && (burst.get(t.term) ?? 0) >= minBurstiness)
				.slice(0, topTerms)
				.map((t) => ({ term: t.term, z: t.z, burstiness: burst.get(t.term) ?? 0 }))
		});
	}
	return out;
}

// ── Lexikalische Ähnlichkeit über seltene Terme ───────────────────

export interface LexicalSpace {
	/** Termgewichte je Einheit, L2-normalisiert (TF-IDF). */
	vectors: Map<string, number>[];
	/** Wie viele Einheiten den Term enthalten. */
	documentFrequency: Map<string, number>;
	/** Terme, die nach dem df-Schnitt übrig bleiben. */
	vocabulary: string[];
	params: {
		minDf: number;
		maxDfRatio: number;
		units: number;
		/** Mitgeführt, damit eine später hinzukommende Anfrage exakt gleich
		 *  tokenisiert wird wie das Korpus — sonst wäre ihre Ähnlichkeit
		 *  gegen dieses Korpus nicht vergleichbar. */
		stopwords: Set<string>;
		minLength: number;
	};
}

/**
 * TF-IDF-Raum über die Einheiten, beschränkt auf **seltene** Terme.
 *
 * Warum so und nicht über die Sequenzprofile: Zwei Passagen sind lexikalisch
 * verbunden, wenn sie *seltene inhaltliche* Wörter teilen. Ein handgebautes
 * Überlappungsmaß über kurze Profile leistet das nicht — bei zwei oder drei
 * Termen je Profil schlägt ein einziger geteilter Term voll durch, und der
 * ist dann „kommt". Beobachtet, nicht vermutet (RESULT-lexical.md).
 *
 * Der df-Schnitt ersetzt zugleich die Idiolekt-Filterung, die eine
 * Stoppwortliste nicht leisten kann: Diskursmarker einer sprechenden Person
 * (*glaube, halt, eher, irgendwie*) stehen in einem großen Teil aller
 * Sequenzen und fallen an der Obergrenze heraus. Themenwörter stehen in
 * wenigen und bleiben.
 *
 * @param minDf        mindestens so viele Einheiten, sonst nicht teilbar.
 * @param maxDfRatio   höchstens dieser Anteil aller Einheiten.
 */
export function buildLexicalSpace(
	unitTexts: string[],
	opts: { minDf?: number; maxDfRatio?: number; stopwords?: Set<string>; minLength?: number } = {}
): LexicalSpace {
	const minDf = opts.minDf ?? 2;
	const maxDfRatio = opts.maxDfRatio ?? 0.1;
	const stopwords = opts.stopwords ?? GERMAN_STOPWORDS;
	const minLength = opts.minLength ?? 3;
	const N = unitTexts.length;

	const tf: Map<string, number>[] = unitTexts.map((t) => {
		const m = new Map<string, number>();
		for (const tok of tokenize(t, opts.stopwords, opts.minLength)) {
			m.set(tok, (m.get(tok) ?? 0) + 1);
		}
		return m;
	});

	const df = new Map<string, number>();
	for (const m of tf) for (const term of m.keys()) df.set(term, (df.get(term) ?? 0) + 1);

	const maxDf = Math.max(minDf, Math.floor(N * maxDfRatio));
	const vocabulary = [...df.keys()].filter((t) => {
		const d = df.get(t)!;
		return d >= minDf && d <= maxDf;
	});
	const keep = new Set(vocabulary);

	const vectors = tf.map((m) => {
		const v = new Map<string, number>();
		let norm = 0;
		for (const [term, count] of m) {
			if (!keep.has(term)) continue;
			const w = (1 + Math.log(count)) * Math.log(N / df.get(term)!);
			v.set(term, w);
			norm += w * w;
		}
		norm = Math.sqrt(norm);
		if (norm > 0) for (const [term, w] of v) v.set(term, w / norm);
		return v;
	});

	return {
		vectors,
		documentFrequency: df,
		vocabulary,
		params: { minDf, maxDfRatio, units: N, stopwords, minLength }
	};
}

/**
 * Einen freien Text in einen *bestehenden* Raum projizieren.
 *
 * Nötig, weil eine Suchanfrage nicht Teil des Korpus ist, aber mit
 * denselben idf-Gewichten gemessen werden muss — sonst ist ihre Ähnlichkeit
 * gegen die Korpuseinheiten nicht vergleichbar. Terme außerhalb des
 * df-Schnitts fallen heraus: ein Wort, das in der Hälfte aller Passagen
 * steht, unterscheidet nichts, auch wenn danach gesucht wird.
 */
export function vectorizeInSpace(space: LexicalSpace, text: string): Map<string, number> {
	return vectorizeWithReport(space, text).vector;
}

export interface VectorizeReport {
	vector: Map<string, number>;
	/** Terme der Anfrage, die im Raum liegen und also zählen. */
	used: string[];
	/** Zu häufig: steht in mehr Einheiten als der df-Schnitt zulässt —
	 *  unterscheidet nichts, auch wenn danach gesucht wird. */
	tooCommon: string[];
	/** Kommt im Korpus gar nicht oder nur einmal vor. */
	tooRare: string[];
}

/**
 * Wie `vectorizeInSpace`, aber mit Auskunft darüber, welche Wörter der
 * Anfrage gezählt haben und welche nicht.
 *
 * Das ist kein Beiwerk: Eine Suche, die stillschweigend die Hälfte der
 * eingegebenen Wörter verwirft, belügt die Suchende über ihr eigenes
 * Ergebnis. Wer „Wartezeit Kurs nervig" eingibt und nur Treffer zu
 * *wartezeit* bekommt, muss das sehen.
 */
export function vectorizeWithReport(space: LexicalSpace, text: string): VectorizeReport {
	const { units: N, stopwords, minLength, minDf, maxDfRatio } = space.params;
	const maxDf = Math.max(minDf, Math.floor(N * maxDfRatio));
	const keep = new Set(space.vocabulary);
	const tf = new Map<string, number>();
	const tooCommon: string[] = [];
	const tooRare: string[] = [];

	for (const tok of tokenize(text, stopwords, minLength)) {
		if (keep.has(tok)) {
			tf.set(tok, (tf.get(tok) ?? 0) + 1);
			continue;
		}
		const df = space.documentFrequency.get(tok) ?? 0;
		if (df > maxDf) {
			if (!tooCommon.includes(tok)) tooCommon.push(tok);
		} else if (!tooRare.includes(tok)) {
			tooRare.push(tok);
		}
	}
	const v = new Map<string, number>();
	let norm = 0;
	for (const [term, count] of tf) {
		const w = (1 + Math.log(count)) * Math.log(N / space.documentFrequency.get(term)!);
		v.set(term, w);
		norm += w * w;
	}
	norm = Math.sqrt(norm);
	if (norm > 0) for (const [t, w] of v) v.set(t, w / norm);
	return { vector: v, used: [...tf.keys()], tooCommon, tooRare };
}

/** Kosinus zweier TF-IDF-Vektoren (beide bereits L2-normalisiert). */
export function lexicalSimilarity(a: Map<string, number>, b: Map<string, number>): number {
	// Über den kleineren iterieren.
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	let s = 0;
	for (const [term, w] of small) {
		const o = large.get(term);
		if (o !== undefined) s += w * o;
	}
	return s;
}

/** Die geteilten Terme zweier Einheiten, nach gemeinsamem Gewicht sortiert. */
export function sharedTerms(
	a: Map<string, number>,
	b: Map<string, number>,
	n = 8
): { term: string; weight: number }[] {
	const out: { term: string; weight: number }[] = [];
	for (const [term, w] of a) {
		const o = b.get(term);
		if (o !== undefined) out.push({ term, weight: w * o });
	}
	return out.sort((x, y) => y.weight - x.weight).slice(0, n);
}
