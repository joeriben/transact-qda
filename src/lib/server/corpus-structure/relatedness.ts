// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Verwandte Passagen — mit ausgewiesenem Grund.
//
// Die eine Funktion, die zwei Stellen zugleich bedient: die Suche für den
// Menschen und das Belegmaterial für den Anwalt. Beide brauchen dasselbe —
// „welche Stellen gehören hierher, und *woran*".
//
// Was sie anders macht als das Vorhandene:
//
//   `semantic_search` (Embedding-KNN) gibt eine Zahl zurück. Auf thematisch
//   kohärentem Material trägt die nicht: vier Interviews desselben Projekts
//   liegen im Vektorraum 0,003 auseinander (eval/corpus-structure/RESULT.md).
//   Und eine Ähnlichkeit von 0,87 ist keine Auskunft — für ein Werkzeug,
//   dessen Kern Ausweisbarkeit ist, das entscheidende Defizit.
//
//   `search_documents` (Volltext) braucht eine Frage und antwortet auf
//   Dokumentebene, ohne Rangfolge.
//
// Hier ist das Ergebnis eine Passagenliste mit den **geteilten seltenen
// Termen**. Der Grund steht daneben und ist zitierbar. Für den Anwalt ist
// diese Termliste zugleich der Kandidat für die unterscheidende Dimension,
// die das Kill-Kriterium von seinen Memos verlangt — sie wird übergeben,
// nicht erhofft.
//
// Was hier NICHT passiert: kein Schreiben, kein Naming, keine Designation.
// Das Modul liest und rechnet. Der Abduktor bekommt hiervon nichts —
// Vergleichsmaterial würde Abduktion in Subsumtion verwandeln.

import { query } from '../db/index.js';
import { loadDocumentItems, type LoadedItem } from './compute.js';
import {
	buildLexicalSpace,
	vectorizeWithReport,
	lexicalSimilarity,
	sharedTerms,
	keepSpeakers,
	type LexicalSpace
} from './lexical.js';

export interface RelatedPassage {
	documentId: string;
	documentTitle: string;
	/** 1-basierte Sequenznummer innerhalb ihres Dokuments. */
	seq: number;
	charStart: number;
	charEnd: number;
	text: string;
	/** Kosinus im TF-IDF-Raum über seltene Terme. */
	similarity: number;
	/** Der ausgewiesene Grund: die geteilten seltenen Terme. */
	sharedTerms: string[];
}

export interface RelatednessOptions {
	/** 'project' (Standard) oder auf ein Dokument beschränkt. */
	scope?: 'project' | 'in-document';
	scopeDocumentId?: string;
	limit?: number;
	/**
	 * Mindestzahl geteilter seltener Terme. Für Passage-gegen-Passage ist 3
	 * richtig — mit weniger führen kurze Sequenzen die Liste an, weil bei
	 * einer Ein-Satz-Sequenz ein einziger geteilter Term ihr ganzer Vektor
	 * ist (RESULT-lexical.md). Für eine *Suchanfrage* ist 3 unerfüllbar:
	 * drei Wörter können nur dann drei seltene Terme teilen, wenn alle drei
	 * selten sind und zusammen an einer Stelle stehen. Deshalb setzt
	 * findRelatedToText die Vorgabe auf 1 und fängt die kurzen Sequenzen
	 * über minCandidateTerms ab.
	 */
	minShared?: number;
	/**
	 * Mindestzahl seltener Terme, die eine *Trefferpassage* selbst tragen
	 * muss. Fängt das Bruchstück ab, dessen einziger seltener Term zufällig
	 * der gesuchte ist und das deshalb auf Kosinus 1,0 kommt.
	 */
	minCandidateTerms?: number;
	/** Nur die Rede dieser Sprecher zählen (Transkripte). */
	speakers?: string[];
	/** Passagen aus demselben Dokument ausschließen (Fallvergleich). */
	crossDocumentOnly?: boolean;
	/**
	 * Diese Sequenzen nicht zurückgeben. Für einen Aufrufer, der die Quelle
	 * und ihre Nachbarn bereits vor Augen hat — sie erneut zu liefern wäre
	 * keine Auskunft, sondern Wiederholung.
	 */
	excludeSequences?: { documentId: string; seqs: number[] };
	/** Höchstanteil an Einheiten, in denen ein Term stehen darf. */
	maxDfRatio?: number;
}

interface Corpus {
	items: LoadedItem[];
	titles: Map<string, string>;
	space: LexicalSpace;
}

// ── Korpus laden ──────────────────────────────────────────────────

async function documentIdsOf(projectId: string, only?: string): Promise<string[]> {
	if (only) return [only];
	const res = await query<{ id: string }>(
		`SELECT d.id
		   FROM namings d
		   JOIN document_content dc ON dc.naming_id = d.id AND dc.full_text IS NOT NULL
		  WHERE d.project_id = $1 AND d.deleted_at IS NULL
		  ORDER BY d.seq`,
		[projectId]
	);
	return res.rows.map((r) => r.id);
}

async function titlesOf(documentIds: string[]): Promise<Map<string, string>> {
	if (documentIds.length === 0) return new Map();
	const res = await query<{ id: string; inscription: string }>(
		`SELECT id, inscription FROM namings WHERE id = ANY($1::uuid[])`,
		[documentIds]
	);
	return new Map(res.rows.map((r) => [r.id, r.inscription]));
}

// Kurzlebiger Cache. Ein Korpus zu laden und den TF-IDF-Raum zu bauen
// kostet bei 500 Sequenzen rund eine halbe Sekunde; ein Aktant, der in
// einem Zug dreimal fragt, zahlt das sonst dreimal. Die Lebensdauer ist
// bewusst kurz: das Material ändert sich, während gearbeitet wird, und ein
// veralteter Korpus wäre ein stiller Fehler — lieber neu rechnen.
const CORPUS_TTL_MS = 120_000;
const CORPUS_CACHE_MAX = 8;
const corpusCache = new Map<string, { at: number; corpus: Corpus }>();

function cacheKey(projectId: string, opts: RelatednessOptions): string {
	return [
		projectId,
		opts.scope ?? 'project',
		opts.scopeDocumentId ?? '',
		(opts.speakers ?? []).join(','),
		opts.maxDfRatio ?? ''
	].join('|');
}

/**
 * Sequenzen des Geltungsbereichs samt TF-IDF-Raum.
 *
 * Die Segmentierung ist ephemer (segmentation.ts) und wird hier wie im
 * Coding-Run neu gerechnet — damit die Einheiten dieselben sind, an denen
 * die Aktanten arbeiten. Nichts wird persistiert.
 */
async function loadCorpus(projectId: string, opts: RelatednessOptions): Promise<Corpus> {
	const key = cacheKey(projectId, opts);
	const now = Date.now();
	const hit = corpusCache.get(key);
	if (hit && now - hit.at < CORPUS_TTL_MS) return hit.corpus;

	const docIds = await documentIdsOf(
		projectId,
		opts.scope === 'in-document' ? opts.scopeDocumentId : undefined
	);
	const raw: LoadedItem[] = [];
	for (const id of docIds) raw.push(...(await loadDocumentItems(id)));

	const items = opts.speakers
		? raw
				.map((it) => ({ ...it, text: keepSpeakers(it.text, opts.speakers!) }))
				.filter((it) => it.text.trim().length > 0)
		: raw;

	const space = buildLexicalSpace(
		items.map((i) => i.text),
		{ maxDfRatio: opts.maxDfRatio }
	);
	const corpus: Corpus = { items, titles: await titlesOf(docIds), space };

	for (const [k, v] of corpusCache) if (now - v.at >= CORPUS_TTL_MS) corpusCache.delete(k);
	if (corpusCache.size >= CORPUS_CACHE_MAX) {
		const oldest = [...corpusCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
		if (oldest) corpusCache.delete(oldest[0]);
	}
	corpusCache.set(key, { at: now, corpus });
	return corpus;
}

// ── Abfragen ──────────────────────────────────────────────────────

function rank(
	corpus: Corpus,
	queryVec: Map<string, number>,
	opts: RelatednessOptions,
	exclude: (it: LoadedItem, index: number) => boolean
): RelatedPassage[] {
	const minShared = opts.minShared ?? 3;
	const minCandidateTerms = opts.minCandidateTerms ?? 3;
	const limit = opts.limit ?? 10;

	const banned = opts.excludeSequences
		? new Set(opts.excludeSequences.seqs.map((s) => `${opts.excludeSequences!.documentId}#${s}`))
		: null;

	const out: RelatedPassage[] = [];
	for (let i = 0; i < corpus.items.length; i++) {
		const it = corpus.items[i];
		if (banned?.has(`${it.documentId}#${it.seq}`)) continue;
		if (exclude(it, i)) continue;
		const vec = corpus.space.vectors[i];
		if (vec.size < minCandidateTerms) continue;
		const shared = sharedTerms(queryVec, vec, 12);
		if (shared.length < minShared) continue;
		// Deckungsgrad: welcher Anteil der Anfrageterme überhaupt vorkommt.
		// Ohne ihn rangiert eine Passage, die *ein* Wort der Anfrage stark
		// trägt, über einer, die *beide* trägt — der Kosinus allein belohnt
		// Konzentration, nicht Abdeckung. Bei Passage-gegen-Passage ist der
		// Faktor nahezu wirkungslos (beide Seiten sind lang); er greift dort,
		// wo er gebraucht wird, nämlich bei kurzen Anfragen.
		const coverage = queryVec.size > 0 ? shared.length / Math.min(queryVec.size, 12) : 1;
		out.push({
			documentId: it.documentId,
			documentTitle: corpus.titles.get(it.documentId) ?? it.documentId,
			seq: it.seq,
			charStart: it.charStart,
			charEnd: it.charEnd,
			text: it.text,
			similarity: lexicalSimilarity(queryVec, vec) * coverage,
			sharedTerms: shared.map((s) => s.term)
		});
	}
	return out.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/**
 * Verwandte Passagen zu einem freien Text (Suchanfrage oder Passagentext).
 *
 * Die Anfrage wird in den *bestehenden* TF-IDF-Raum des Korpus projiziert,
 * damit dieselben idf-Gewichte gelten — sonst wäre die Ähnlichkeit
 * gegenüber dem Korpus nicht vergleichbar.
 */
export async function findRelatedToText(
	projectId: string,
	text: string,
	opts: RelatednessOptions = {}
): Promise<{
	passages: RelatedPassage[];
	corpusUnits: number;
	vocabulary: number;
	/** Welche Wörter der Anfrage gezählt haben — und welche nicht, mit Grund. */
	queryTerms: { used: string[]; tooCommon: string[]; tooRare: string[] };
}> {
	const corpus = await loadCorpus(projectId, opts);
	const report = vectorizeWithReport(corpus.space, text);
	// Eine Anfrage ist kurz; drei geteilte Terme kann sie nicht liefern.
	const passages = rank(corpus, report.vector, { minShared: 1, ...opts }, () => false);
	return {
		passages,
		corpusUnits: corpus.items.length,
		vocabulary: corpus.space.vocabulary.length,
		queryTerms: { used: report.used, tooCommon: report.tooCommon, tooRare: report.tooRare }
	};
}

/**
 * Verwandte Passagen zu einer Sequenz des Korpus.
 *
 * Die Sequenz selbst und ihre unmittelbaren Nachbarn fallen heraus:
 * Nachbarschaft im Text ist kein Befund, sie ist die Voreinstellung. Was
 * gesucht wird, ist die Stelle, die *weit weg* steht und dennoch dieselben
 * seltenen Wörter hervortreten lässt.
 */
export async function findRelatedToSequence(
	projectId: string,
	documentId: string,
	seq: number,
	opts: RelatednessOptions & { minGap?: number } = {}
): Promise<{ passages: RelatedPassage[]; source?: LoadedItem; corpusUnits: number }> {
	const corpus = await loadCorpus(projectId, opts);
	const sourceIndex = corpus.items.findIndex(
		(it) => it.documentId === documentId && it.seq === seq
	);
	if (sourceIndex < 0) return { passages: [], corpusUnits: corpus.items.length };

	const minGap = opts.minGap ?? 3;
	const source = corpus.items[sourceIndex];
	const queryVec = corpus.space.vectors[sourceIndex];

	const passages = rank(corpus, queryVec, opts, (it) => {
		if (opts.crossDocumentOnly && it.documentId === documentId) return true;
		if (it.documentId !== documentId) return false;
		return Math.abs(it.seq - seq) < minGap;
	});
	return { passages, source, corpusUnits: corpus.items.length };
}

/**
 * Verwandte Passagen zu einer Zeichenspanne — der Einstieg für einen
 * Aktanten, der eine Sequenz in der Hand hat, aber keine Sequenznummer.
 */
export async function findRelatedToRange(
	projectId: string,
	documentId: string,
	pos0: number,
	pos1: number,
	opts: RelatednessOptions & { minGap?: number } = {}
): Promise<{ passages: RelatedPassage[]; corpusUnits: number }> {
	const corpus = await loadCorpus(projectId, opts);
	const overlapping = corpus.items
		.map((it, i) => ({ it, i }))
		.filter((x) => x.it.documentId === documentId && pos0 < x.it.charEnd && pos1 > x.it.charStart);
	if (overlapping.length === 0) return { passages: [], corpusUnits: corpus.items.length };

	// Mehrere überlappende Sequenzen: die Vektoren addieren und neu
	// normalisieren — die Anfrage ist die Spanne, nicht eine ihrer Einheiten.
	const merged = new Map<string, number>();
	for (const { i } of overlapping) {
		for (const [term, w] of corpus.space.vectors[i]) {
			merged.set(term, (merged.get(term) ?? 0) + w);
		}
	}
	let norm = 0;
	for (const w of merged.values()) norm += w * w;
	norm = Math.sqrt(norm);
	if (norm > 0) for (const [t, w] of merged) merged.set(t, w / norm);

	const minGap = opts.minGap ?? 3;
	const sourceSeqs = new Set(overlapping.map((x) => x.it.seq));
	const passages = rank(corpus, merged, opts, (it) => {
		if (opts.crossDocumentOnly && it.documentId === documentId) return true;
		if (it.documentId !== documentId) return false;
		for (const s of sourceSeqs) if (Math.abs(it.seq - s) < minGap) return true;
		return false;
	});
	return { passages, corpusUnits: corpus.items.length };
}
