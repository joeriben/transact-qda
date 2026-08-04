// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Korpusstruktur: nicht-lineare Gruppierung über thematische Sequenzen.
//
// Warum das neben segmentation.ts steht. Die Segmentierung beantwortet
// die Frage "wo dreht das Thema?" — sie ist TextTiling über *benachbarte*
// Satzblöcke und kann deshalb per Konstruktion nur Grenzen in Leserichtung
// erzeugen. Dass Sequenz 3 und Sequenz 27 von derselben Sache handeln,
// sieht ein lokaler Operator nicht: Wiederkehr ist für ihn unsichtbar.
//
// Dieses Modul beantwortet die andere Frage — "welche Sequenzen gehören
// zusammen, unabhängig davon, wo sie stehen?" — durch globale Gruppierung
// der Sequenzvektoren. Der Befund, den es verfügbar macht, ist damit genau
// der, den die Segmentierung nicht erzeugen kann: ein Thema, auf das
// zurückgekommen wird.
//
// Bewusst rein und providerfrei: kein Modellaufruf, kein Prompt, kein
// Schreibvorgang. Es rechnet eine Struktur und gibt sie zurück. Hier
// designiert nichts. Eine Region ist kein Naming und darf nie eines
// werden — sie ist eine Projektion des Materialraums, nicht des
// Naming-Raums.
//
// Deterministisch: die k-Means-Initialisierung zieht aus einem gesetzten
// PRNG, und Seed, k und Silhouettenwert stehen im Ergebnis. Die
// qualitative Entscheidung (welches k) wird damit sichtbar gemacht, nicht
// wegdefiniert — Nelson (2020, S. 18) hält fest, dass es dafür keine
// objektive Methode gibt.

import { query } from '../db/index.js';
import { segmentDocument, type Sequence } from '../ai/coding-run/segmentation.js';

// ── Tunables ──────────────────────────────────────────────────────
// Methodenparameter, keine Nutzereinstellungen (wie in segmentation.ts).

/** k-Spanne, über die die Silhouette entscheidet. */
const K_MIN = 2;
const K_MAX = 10;
/** Lloyd-Iterationen bis zum Abbruch, falls die Zuordnung nicht steht. */
const MAX_ITER = 100;
/** Feste Vorgabe, damit zwei Läufe auf demselben Material gleich ausgehen. */
const DEFAULT_SEED = 20260729;
/** Unter so vielen Sequenzen lohnt keine Gruppierung. */
const MIN_ITEMS = 6;
/**
 * Kleinste zulässige Regionsgröße bei der k-Wahl.
 *
 * Ohne diese Schranke gewinnt regelmäßig eine entartete Aufteilung: Eine
 * Region mit einem einzigen Element hat Kohäsion 1 per Definition, und weil
 * sie den schlechtest sitzenden Punkt aus der großen Region herausnimmt,
 * *hebt* sie die mittlere Silhouette. Die k-Wahl belohnt damit
 * "ein Blob plus ein Ausreißer" — was keine Struktur ist, sondern ein
 * Ausreißer, den outliers() ohnehin findet.
 */
const MIN_REGION = 3;

// ── Öffentliche Form ──────────────────────────────────────────────

export interface StructureItem {
	/** 1-basierte Position der Sequenz im Dokument. */
	seq: number;
	documentId: string;
	charStart: number;
	charEnd: number;
	text: string;
	/** Index der Region, der die Sequenz zugeordnet ist. */
	region: number;
	/** Kosinus-Ähnlichkeit zum Zentrum der eigenen Region. */
	toOwnRegion: number;
	/** Kosinus-Ähnlichkeit zum nächstgelegenen *fremden* Zentrum. */
	toNearestOther: number;
	/** Silhouettenwert dieses Elements (−1 … 1). */
	silhouette: number;
}

export interface Region {
	index: number;
	size: number;
	/** Das tatsächlich zentralste Element der Region — eine echte Sequenz,
	 *  kein Schwerpunkt. Ein Zentroid ist kein Text und lässt sich weder
	 *  zeigen noch verankern. */
	medoid: StructureItem;
	/** Mittlere Ähnlichkeit innerhalb der Region. */
	cohesion: number;
}

export interface CorpusStructure {
	scope: 'document' | 'project';
	projectId: string | null;
	documentId: string | null;
	k: number;
	seed: number;
	/** Mittlere Silhouette über alle Elemente — Grundlage der k-Wahl. */
	silhouette: number;
	/** Silhouette je geprüftem k, damit die Wahl nachvollziehbar bleibt.
	 *  `degenerate` markiert Aufteilungen, die an MIN_REGION scheitern und
	 *  deshalb nicht gewählt werden dürfen. */
	kScores: { k: number; silhouette: number; degenerate?: boolean; minRegion?: number }[];
	items: StructureItem[];
	regions: Region[];
}

// ── Vektorhilfen ──────────────────────────────────────────────────
// Alle Vektoren sind L2-normalisiert; auf Einheitsvektoren ist das
// Skalarprodukt die Kosinus-Ähnlichkeit und 1 − Skalarprodukt die
// Kosinus-Distanz. Deshalb reicht `dot` überall.

function normalize(v: number[]): number[] {
	let n = 0;
	for (const x of v) n += x * x;
	n = Math.sqrt(n);
	if (n === 0) return v.slice();
	const out = new Array<number>(v.length);
	for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
	return out;
}

function dot(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function meanNormalized(vecs: number[][]): number[] {
	const dims = vecs[0].length;
	const out = new Array<number>(dims).fill(0);
	for (const v of vecs) {
		for (let i = 0; i < dims; i++) out[i] += v[i];
	}
	return normalize(out);
}

/** Deterministischer PRNG (mulberry32) — Reproduzierbarkeit ist hier der
 *  Zweck, nicht statistische Güte. */
function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ── Laden ─────────────────────────────────────────────────────────

export interface LoadedItem {
	seq: number;
	documentId: string;
	charStart: number;
	charEnd: number;
	text: string;
	vector: number[];
}

/** Kosinus-Ähnlichkeit zweier Sequenzvektoren. Öffentlich, damit ein
 *  Harness eine *lineare* Vergleichsbasis über dieselben Vektoren rechnen
 *  kann, ohne die Vektormathematik zu duplizieren. */
export function similarity(a: number[], b: number[]): number {
	return dot(a, b);
}

interface SentenceVec {
	charStart: number;
	charEnd: number;
	embedding: number[] | null;
}

async function loadSentenceVectors(documentId: string): Promise<SentenceVec[]> {
	const res = await query<{ char_start: number; char_end: number; embedding: string | null }>(
		`SELECT char_start, char_end, embedding::text AS embedding
		   FROM document_elements
		  WHERE document_id = $1 AND element_type = 'sentence' AND content IS NOT NULL
		  ORDER BY char_start, seq`,
		[documentId]
	);
	return res.rows.map((r) => {
		let embedding: number[] | null = null;
		if (r.embedding) {
			try {
				const parsed = JSON.parse(r.embedding);
				if (Array.isArray(parsed) && parsed.length > 0) embedding = parsed as number[];
			} catch {
				embedding = null;
			}
		}
		return { charStart: r.char_start, charEnd: r.char_end, embedding };
	});
}

async function loadFullText(documentId: string): Promise<string> {
	const res = await query<{ full_text: string | null }>(
		`SELECT full_text FROM document_content WHERE naming_id = $1`,
		[documentId]
	);
	const t = res.rows[0]?.full_text;
	if (!t) throw new Error(`Document ${documentId} has no full_text`);
	return t;
}

/**
 * Sequenzvektoren eines Dokuments: die Sequenzen kommen aus derselben
 * Segmentierung, die auch der Coding-Run läuft (ephemer, deterministisch
 * neu gerechnet), der Vektor je Sequenz ist das normalisierte Mittel der
 * Satzvektoren, die in ihren Bereich fallen.
 *
 * Sequenzen ohne eingebetteten Satz fallen heraus — sie ohne Vektor
 * mitzuführen hieße, sie irgendeiner Region zuzuschlagen.
 */
export async function loadDocumentItems(documentId: string): Promise<LoadedItem[]> {
	const fullText = await loadFullText(documentId);
	const sequences: Sequence[] = await segmentDocument(documentId, fullText);
	const sentences = await loadSentenceVectors(documentId);

	const items: LoadedItem[] = [];
	for (const s of sequences) {
		const vecs = sentences
			.filter((x) => x.embedding && x.charStart >= s.charStart && x.charEnd <= s.charEnd)
			.map((x) => normalize(x.embedding as number[]));
		if (vecs.length === 0) continue;
		items.push({
			seq: s.seq,
			documentId,
			charStart: s.charStart,
			charEnd: s.charEnd,
			text: s.text,
			vector: meanNormalized(vecs)
		});
	}
	return items;
}

/** Dieselbe Operation über mehrere Dokumente — die Sequenznummern bleiben
 *  dokumentintern, `documentId` unterscheidet sie. */
export async function loadProjectItems(documentIds: string[]): Promise<LoadedItem[]> {
	const all: LoadedItem[] = [];
	for (const id of documentIds) {
		all.push(...(await loadDocumentItems(id)));
	}
	return all;
}

// ── k-Means (sphärisch: Einheitsvektoren, Kosinus) ────────────────

function kmeansPlusPlusInit(vecs: number[][], k: number, rnd: () => number): number[][] {
	const centers: number[][] = [];
	centers.push(vecs[Math.floor(rnd() * vecs.length)].slice());

	while (centers.length < k) {
		// D(x)² über die Kosinus-Distanz zum nächsten bereits gewählten Zentrum.
		const d2 = vecs.map((v) => {
			let best = -1;
			for (const c of centers) {
				const s = dot(v, c);
				if (s > best) best = s;
			}
			const dist = 1 - best;
			return dist * dist;
		});
		const total = d2.reduce((a, b) => a + b, 0);
		if (total <= 0) {
			// Alle Punkte fallen mit den Zentren zusammen — auffüllen und raus.
			centers.push(vecs[Math.floor(rnd() * vecs.length)].slice());
			continue;
		}
		let r = rnd() * total;
		let idx = 0;
		for (let i = 0; i < d2.length; i++) {
			r -= d2[i];
			if (r <= 0) {
				idx = i;
				break;
			}
			idx = i;
		}
		centers.push(vecs[idx].slice());
	}
	return centers;
}

function assign(vecs: number[][], centers: number[][]): number[] {
	return vecs.map((v) => {
		let best = 0;
		let bestSim = -Infinity;
		for (let c = 0; c < centers.length; c++) {
			const s = dot(v, centers[c]);
			if (s > bestSim) {
				bestSim = s;
				best = c;
			}
		}
		return best;
	});
}

function kmeans(vecs: number[][], k: number, seed: number): number[] {
	const rnd = seededRandom(seed);
	let centers = kmeansPlusPlusInit(vecs, k, rnd);
	let labels = assign(vecs, centers);

	for (let iter = 0; iter < MAX_ITER; iter++) {
		// Zentren neu setzen.
		const next: number[][] = [];
		for (let c = 0; c < k; c++) {
			const members = vecs.filter((_, i) => labels[i] === c);
			if (members.length === 0) {
				// Leere Region: den Punkt nehmen, der am schlechtesten sitzt.
				let worst = 0;
				let worstSim = Infinity;
				for (let i = 0; i < vecs.length; i++) {
					const s = dot(vecs[i], centers[labels[i]]);
					if (s < worstSim) {
						worstSim = s;
						worst = i;
					}
				}
				next.push(vecs[worst].slice());
			} else {
				next.push(meanNormalized(members));
			}
		}
		centers = next;
		const nextLabels = assign(vecs, centers);
		let stable = true;
		for (let i = 0; i < labels.length; i++) {
			if (labels[i] !== nextLabels[i]) {
				stable = false;
				break;
			}
		}
		labels = nextLabels;
		if (stable) break;
	}
	return labels;
}

// ── Silhouette (Kosinus-Distanz) ──────────────────────────────────

function silhouetteScores(vecs: number[][], labels: number[], k: number): number[] {
	const n = vecs.length;
	const out = new Array<number>(n).fill(0);
	const sizes = new Array<number>(k).fill(0);
	for (const l of labels) sizes[l]++;

	for (let i = 0; i < n; i++) {
		const sums = new Array<number>(k).fill(0);
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			sums[labels[j]] += 1 - dot(vecs[i], vecs[j]);
		}
		const own = labels[i];
		// a(i): mittlere Distanz zu den *anderen* Mitgliedern der eigenen Region.
		const ownCount = sizes[own] - 1;
		if (ownCount <= 0) {
			out[i] = 0; // Einzelgänger: per Definition 0, nicht 1.
			continue;
		}
		const a = sums[own] / ownCount;
		let b = Infinity;
		for (let c = 0; c < k; c++) {
			if (c === own || sizes[c] === 0) continue;
			const mean = sums[c] / sizes[c];
			if (mean < b) b = mean;
		}
		if (!isFinite(b)) {
			out[i] = 0;
			continue;
		}
		const denom = Math.max(a, b);
		out[i] = denom === 0 ? 0 : (b - a) / denom;
	}
	return out;
}

// ── Hauptrechnung ─────────────────────────────────────────────────

export interface ComputeOptions {
	seed?: number;
	kMin?: number;
	kMax?: number;
	/** k festsetzen statt über die Silhouette wählen. */
	k?: number;
}

function buildStructure(
	items: LoadedItem[],
	labels: number[],
	k: number,
	seed: number,
	sil: number[],
	kScores: { k: number; silhouette: number }[],
	scope: 'document' | 'project',
	projectId: string | null,
	documentId: string | null
): CorpusStructure {
	const vecs = items.map((it) => it.vector);
	const centers: number[][] = [];
	for (let c = 0; c < k; c++) {
		const members = vecs.filter((_, i) => labels[i] === c);
		centers.push(members.length > 0 ? meanNormalized(members) : vecs[0].slice());
	}

	const structItems: StructureItem[] = items.map((it, i) => {
		const own = labels[i];
		let nearestOther = -Infinity;
		for (let c = 0; c < k; c++) {
			if (c === own) continue;
			const s = dot(it.vector, centers[c]);
			if (s > nearestOther) nearestOther = s;
		}
		return {
			seq: it.seq,
			documentId: it.documentId,
			charStart: it.charStart,
			charEnd: it.charEnd,
			text: it.text,
			region: own,
			toOwnRegion: dot(it.vector, centers[own]),
			toNearestOther: isFinite(nearestOther) ? nearestOther : 0,
			silhouette: sil[i]
		};
	});

	const regions: Region[] = [];
	for (let c = 0; c < k; c++) {
		const memberIdx = structItems.map((_, i) => i).filter((i) => labels[i] === c);
		if (memberIdx.length === 0) continue;
		// Medoid = Mitglied mit der höchsten mittleren Ähnlichkeit zu den
		// übrigen Mitgliedern. Nicht "nächstes am Zentroid" — das Zentrum
		// ist ein Konstrukt, das Medoid soll ein tatsächlich typischer Fall
		// sein.
		let bestIdx = memberIdx[0];
		let bestMean = -Infinity;
		let cohesionSum = 0;
		let pairs = 0;
		for (const i of memberIdx) {
			let s = 0;
			for (const j of memberIdx) {
				if (i === j) continue;
				const sim = dot(vecs[i], vecs[j]);
				s += sim;
				cohesionSum += sim;
				pairs++;
			}
			const mean = memberIdx.length > 1 ? s / (memberIdx.length - 1) : 1;
			if (mean > bestMean) {
				bestMean = mean;
				bestIdx = i;
			}
		}
		regions.push({
			index: c,
			size: memberIdx.length,
			medoid: structItems[bestIdx],
			cohesion: pairs > 0 ? cohesionSum / pairs : 1
		});
	}

	const meanSil = sil.length > 0 ? sil.reduce((a, b) => a + b, 0) / sil.length : 0;

	return {
		scope,
		projectId,
		documentId,
		k,
		seed,
		silhouette: meanSil,
		kScores,
		items: structItems,
		regions
	};
}

/**
 * Struktur über eine bereits geladene Elementmenge rechnen.
 *
 * k wird über die mittlere Silhouette aus der Spanne gewählt, sofern nicht
 * fest vorgegeben. Die Werte aller geprüften k bleiben im Ergebnis stehen:
 * die Wahl ist eine qualitative Entscheidung und soll als solche sichtbar
 * sein, nicht als Ergebnis auftreten.
 */
export function computeStructureFromItems(
	items: LoadedItem[],
	scope: 'document' | 'project',
	projectId: string | null,
	documentId: string | null,
	opts: ComputeOptions = {}
): CorpusStructure {
	if (items.length < MIN_ITEMS) {
		throw new Error(
			`Zu wenige Sequenzen mit Vektor (${items.length}) — unter ${MIN_ITEMS} sagt eine Gruppierung nichts.`
		);
	}
	const seed = opts.seed ?? DEFAULT_SEED;
	const vecs = items.map((it) => it.vector);

	if (opts.k) {
		const labels = kmeans(vecs, opts.k, seed);
		const sil = silhouetteScores(vecs, labels, opts.k);
		const mean = sil.reduce((a, b) => a + b, 0) / sil.length;
		return buildStructure(
			items,
			labels,
			opts.k,
			seed,
			sil,
			[{ k: opts.k, silhouette: mean }],
			scope,
			projectId,
			documentId
		);
	}

	const kMin = Math.max(2, opts.kMin ?? K_MIN);
	const kMax = Math.min(opts.kMax ?? K_MAX, items.length - 1);
	const kScores: { k: number; silhouette: number; degenerate: boolean; minRegion: number }[] = [];
	let best: { k: number; labels: number[]; sil: number[]; mean: number } | null = null;

	for (let k = kMin; k <= kMax; k++) {
		const labels = kmeans(vecs, k, seed);
		const sil = silhouetteScores(vecs, labels, k);
		const mean = sil.reduce((a, b) => a + b, 0) / sil.length;
		const sizes = new Array<number>(k).fill(0);
		for (const l of labels) sizes[l]++;
		const minRegion = Math.min(...sizes);
		const degenerate = minRegion < MIN_REGION;
		kScores.push({ k, silhouette: mean, degenerate, minRegion });
		// Entartete Aufteilungen kommen für die k-Wahl nicht in Frage, bleiben
		// aber in kScores sichtbar — die Wahl soll nachvollziehbar sein.
		if (degenerate) continue;
		if (!best || mean > best.mean) best = { k, labels, sil, mean };
	}
	if (!best) {
		const seen = kScores.map((s) => `${s.k}(min=${s.minRegion})`).join(' ');
		throw new Error(
			`Keine nicht-entartete Aufteilung in k=${kMin}…${kMax} — jede lässt eine Region unter ${MIN_REGION} Elementen: ${seen}. Das Material trägt auf Sequenzebene keine Gruppenstruktur.`
		);
	}

	return buildStructure(
		items,
		best.labels,
		best.k,
		seed,
		best.sil,
		kScores,
		scope,
		projectId,
		documentId
	);
}

/** Struktur über die Sequenzen *eines* Dokuments. */
export async function computeDocumentStructure(
	documentId: string,
	opts: ComputeOptions = {}
): Promise<CorpusStructure> {
	const items = await loadDocumentItems(documentId);
	return computeStructureFromItems(items, 'document', null, documentId, opts);
}

/** Struktur über die Sequenzen mehrerer Dokumente eines Projekts. */
export async function computeProjectStructure(
	projectId: string,
	documentIds: string[],
	opts: ComputeOptions = {}
): Promise<CorpusStructure> {
	const items = await loadProjectItems(documentIds);
	return computeStructureFromItems(items, 'project', projectId, null, opts);
}
