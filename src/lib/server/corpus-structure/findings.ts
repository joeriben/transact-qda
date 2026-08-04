// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Befunde aus dem Spalt zwischen zwei Projektionen.
//
// Die Anlage hat drei Repräsentationen des *Naming-Raums* (Datenstruktur,
// Liste, Karte). Vom *Materialraum* — wie sich das Korpus selbst gliedert,
// unabhängig davon, was jemand benannt hat — gibt es keine. compute.ts
// liefert sie. Dieses Modul liest beide und zeigt, wo sie nicht
// zusammenfallen.
//
// Alles hier ist *abgeleitet*: aus einer Struktur und dem aktuellen Stand
// der Namings jederzeit neu zu rechnen, und beim nächsten Strukturlauf
// ohnehin hinfällig. Deshalb wird hier nichts persistiert. Gespeichert
// gehört, was teuer und nicht ableitbar ist (die Struktur) und was neu ist
// (was der Mensch mit einem gezeigten Befund tut) — nicht die Ansicht
// dazwischen.
//
// Und nichts hier schreibt in den Naming-Raum. Ein Befund ist Material für
// einen Cue, den ein Mensch durch einen eigenen Akt hereinholt; die
// Positionsregel für Silences gilt hier unverändert.

import { query } from '../db/index.js';
import type { CorpusStructure, StructureItem } from './compute.js';

// ── 1. Wiederkehr ─────────────────────────────────────────────────

export interface Recurrence {
	region: number;
	documentId: string;
	/** Sequenzen derselben Region in Lesereihenfolge. */
	items: StructureItem[];
	/** Zusammenhängende Blöcke, in denen die Region im Text auftritt. */
	runs: { from: number; to: number; size: number }[];
	/** Abstände zwischen aufeinanderfolgenden Blöcken (in Sequenzschritten). */
	gaps: number[];
	maxGap: number;
	/** Blöcke, gemessen an der Gesamtzahl der Sequenzen des Dokuments.
	 *  Ein wiederkehrendes Thema hat wenige Blöcke (2–4 auf 167 Sequenzen
	 *  ≈ 0,02); ein durchlaufender Registerwechsel hat viele (27 auf 167
	 *  ≈ 0,16). Blöcke *je Vorkommen* taugen dafür nicht: ein einzelner
	 *  langer Block zieht das Verhältnis nach unten und lässt eine
	 *  durchgehend eingestreute Region wie Wiederkehr aussehen. */
	dispersion: number;
}

/** Vorkommen einer Region in Lesereihenfolge zu zusammenhängenden Blöcken. */
function toRuns(sorted: StructureItem[]): { from: number; to: number; size: number }[] {
	const runs: { from: number; to: number; size: number }[] = [];
	let start = sorted[0].seq;
	let prev = sorted[0].seq;
	let size = 1;
	for (let i = 1; i < sorted.length; i++) {
		const s = sorted[i].seq;
		if (s === prev + 1) {
			size++;
		} else {
			runs.push({ from: start, to: prev, size });
			start = s;
			size = 1;
		}
		prev = s;
	}
	runs.push({ from: start, to: prev, size });
	return runs;
}

/**
 * Sequenzen, die zusammengehören, aber im Text auseinanderliegen.
 *
 * Das ist der Befund, den die Segmentierung strukturell nicht erzeugen
 * kann: TextTiling schneidet an Themenwechseln zwischen *benachbarten*
 * Blöcken und sieht deshalb nie, dass auf ein Thema zurückgekommen wird.
 * In einem Interview ist genau das interessant.
 *
 * Zwei Fälle müssen dabei auseinandergehalten werden, sonst zählt das Maß
 * das Falsche mit: Eine Region, die in **wenigen geschlossenen Blöcken**
 * mit großem Abstand auftritt, ist Wiederkehr — auf ein Thema wird
 * zurückgekommen. Eine Region, deren Vorkommen **durchgehend eingestreut**
 * sind, ist kein wiederkehrendes Thema, sondern ein durchlaufender
 * Registerwechsel (etwa Prosa gegen Werkzeugausgabe in einem Protokoll).
 * `dispersion` trennt beides; ohne diese Schwelle meldet das Maß bei
 * kleinem k trivialerweise alles als Wiederkehr.
 *
 * @param minGap         Mindestabstand zwischen zwei Blöcken.
 * @param maxDispersion  Obergrenze für Blöcke je Dokumentsequenz; darüber
 *                       gilt die Region als eingestreut, nicht als
 *                       wiederkehrend.
 */
export function recurrences(
	structure: CorpusStructure,
	minGap = 2,
	maxDispersion = 0.05,
	maxCoverage = 0.6
): Recurrence[] {
	const out: Recurrence[] = [];
	const docTotals = new Map<string, number>();
	for (const it of structure.items) {
		docTotals.set(it.documentId, (docTotals.get(it.documentId) ?? 0) + 1);
	}
	for (const region of structure.regions) {
		// Wiederkehr ist eine Aussage *innerhalb* eines Dokuments — über
		// Dokumentgrenzen hinweg ist Nicht-Benachbartsein trivial.
		const byDoc = new Map<string, StructureItem[]>();
		for (const it of structure.items) {
			if (it.region !== region.index) continue;
			const list = byDoc.get(it.documentId) ?? [];
			list.push(it);
			byDoc.set(it.documentId, list);
		}
		for (const [documentId, items] of byDoc) {
			if (items.length < 2) continue;
			const sorted = [...items].sort((a, b) => a.seq - b.seq);
			const runs = toRuns(sorted);
			if (runs.length < 2) continue;
			const gaps: number[] = [];
			for (let i = 1; i < runs.length; i++) gaps.push(runs[i].from - runs[i - 1].to);
			const maxGap = Math.max(...gaps);
			const total = docTotals.get(documentId) ?? sorted.length;
			const dispersion = runs.length / total;
			// Eine Region, die praktisch das ganze Dokument einnimmt, ist kein
			// wiederkehrendes Thema: ihre "Lücken" sind die paar Stellen, die
			// *nicht* dazugehören. Das ist ein Ausreißerbefund, kein
			// Wiederkehrbefund, und outliers() zeigt ihn passender.
			if (sorted.length / total > maxCoverage) continue;
			if (maxGap < minGap || dispersion > maxDispersion) continue;
			out.push({ region: region.index, documentId, items: sorted, runs, gaps, maxGap, dispersion });
		}
	}
	return out.sort((a, b) => b.maxGap - a.maxGap);
}

/**
 * Regionen, die *durchgehend eingestreut* sind statt zurückzukehren.
 *
 * Kein Befund über das Thema, sondern einer über das Material: das
 * Dokument läuft in zwei oder mehr Registern nebeneinander. Getrennt
 * ausgewiesen, damit es nicht als Wiederkehr durchgeht.
 */
export function alternatingRegions(
	structure: CorpusStructure,
	minDispersion = 0.05
): Recurrence[] {
	const out: Recurrence[] = [];
	const docTotals = new Map<string, number>();
	for (const it of structure.items) {
		docTotals.set(it.documentId, (docTotals.get(it.documentId) ?? 0) + 1);
	}
	for (const region of structure.regions) {
		const byDoc = new Map<string, StructureItem[]>();
		for (const it of structure.items) {
			if (it.region !== region.index) continue;
			const list = byDoc.get(it.documentId) ?? [];
			list.push(it);
			byDoc.set(it.documentId, list);
		}
		for (const [documentId, items] of byDoc) {
			if (items.length < 2) continue;
			const sorted = [...items].sort((a, b) => a.seq - b.seq);
			const runs = toRuns(sorted);
			const dispersion = runs.length / (docTotals.get(documentId) ?? sorted.length);
			if (dispersion < minDispersion) continue;
			const gaps: number[] = [];
			for (let i = 1; i < runs.length; i++) gaps.push(runs[i].from - runs[i - 1].to);
			out.push({
				region: region.index,
				documentId,
				items: sorted,
				runs,
				gaps,
				maxGap: gaps.length > 0 ? Math.max(...gaps) : 0,
				dispersion
			});
		}
	}
	return out.sort((a, b) => b.dispersion - a.dispersion);
}

// ── 2. Ausreißer ──────────────────────────────────────────────────

export interface Outlier {
	item: StructureItem;
	/** Wie deutlich die Zugehörigkeit ausfällt: eigene minus fremde Nähe. */
	margin: number;
}

/**
 * Sequenzen, die in keiner Region gut sitzen — die singuläre Stelle.
 *
 * Gemessen gegen die *Projekt-* bzw. Dokumentstruktur, nicht gegen einen
 * Dokumentschwerpunkt: `find_outliers` in embedding-queries.ts misst gegen
 * den Schwerpunkt eines einzelnen Dokuments und kann deshalb nur sagen,
 * dass etwas vom Durchschnitt abweicht — nicht, dass es zu keiner der
 * tatsächlich vorhandenen Gruppen gehört.
 */
export function outliers(structure: CorpusStructure, maxSilhouette = 0.05): Outlier[] {
	return structure.items
		.filter((it) => it.silhouette <= maxSilhouette)
		.map((it) => ({ item: it, margin: it.toOwnRegion - it.toNearestOther }))
		.sort((a, b) => a.item.silhouette - b.item.silhouette);
}

// ── 3. Streuende Namings ──────────────────────────────────────────

export interface AnchoredNaming {
	namingId: string;
	label: string;
	/** 'codes' = CName-Annotation, 'thematizes' = SName-Bogen. */
	valence: string;
	pos0: number;
	pos1: number;
	documentId: string;
}

export interface ScatteredNaming {
	namingId: string;
	label: string;
	valence: string;
	/** Regionen, über die die Instanzen dieses Namings verteilt liegen. */
	regions: number[];
	instanceCount: number;
	/** Anzahl Dokumente, aus denen die Instanzen stammen. */
	documentCount: number;
}

/**
 * Alle an Textstellen verankerten Namings der angegebenen Dokumente.
 *
 * Ankerlogik wie in coding-companion/retrieval.ts: Codes hängen per
 * Zeichen-Offset (pos0/pos1) an der Annotation, nicht per element_id.
 */
export async function loadAnchoredNamings(documentIds: string[]): Promise<AnchoredNaming[]> {
	if (documentIds.length === 0) return [];
	const res = await query<{
		naming_id: string;
		label: string;
		valence: string;
		pos0: string;
		pos1: string;
		document_id: string;
	}>(
		`SELECT code.id            AS naming_id,
		        code.inscription   AS label,
		        ann.valence        AS valence,
		        ann.properties->'anchor'->>'pos0' AS pos0,
		        ann.properties->'anchor'->>'pos1' AS pos1,
		        ann.directed_to    AS document_id
		   FROM appearances ann
		   JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
		   JOIN namings an   ON an.id   = ann.naming_id     AND an.deleted_at IS NULL
		  WHERE ann.directed_to = ANY($1::uuid[])
		    AND ann.valence IN ('codes', 'thematizes')
		    AND (ann.properties->'anchor'->>'pos0') ~ '^[0-9]+$'
		    AND (ann.properties->'anchor'->>'pos1') ~ '^[0-9]+$'`,
		[documentIds]
	);
	return res.rows.map((r) => ({
		namingId: r.naming_id,
		label: r.label,
		valence: r.valence,
		pos0: parseInt(r.pos0, 10),
		pos1: parseInt(r.pos1, 10),
		documentId: r.document_id
	}));
}

/** Welche Sequenzen ein Anker überlappt. */
function overlappingItems(structure: CorpusStructure, a: AnchoredNaming): StructureItem[] {
	return structure.items.filter(
		(it) => it.documentId === a.documentId && a.pos0 < it.charEnd && a.pos1 > it.charStart
	);
}

/**
 * Namings, deren Instanzen über mehrere Regionen streuen — die Kategorie
 * leistet zwei Dinge zugleich.
 *
 * Das ist Kriterienverfeinerung in ihrer schärfsten Form: Nicht, dass ein
 * Name falsch wäre, sondern dass er im Material an Stellen hängt, die
 * miteinander wenig zu tun haben. Über mehrere Dokumente gerechnet zeigt
 * `documentCount` zusätzlich, ob der Name an *einem* Fall gebildet und nie
 * gegen die anderen gehalten wurde.
 */
export async function scatteredNamings(
	structure: CorpusStructure,
	documentIds: string[],
	minRegions = 2
): Promise<ScatteredNaming[]> {
	const anchored = await loadAnchoredNamings(documentIds);
	const byNaming = new Map<
		string,
		{ label: string; valence: string; regions: Set<number>; docs: Set<string>; count: number }
	>();

	for (const a of anchored) {
		const items = overlappingItems(structure, a);
		if (items.length === 0) continue;
		const entry = byNaming.get(a.namingId) ?? {
			label: a.label,
			valence: a.valence,
			regions: new Set<number>(),
			docs: new Set<string>(),
			count: 0
		};
		for (const it of items) entry.regions.add(it.region);
		entry.docs.add(a.documentId);
		entry.count++;
		byNaming.set(a.namingId, entry);
	}

	const out: ScatteredNaming[] = [];
	for (const [namingId, e] of byNaming) {
		if (e.regions.size < minRegions) continue;
		out.push({
			namingId,
			label: e.label,
			valence: e.valence,
			regions: [...e.regions].sort((a, b) => a - b),
			instanceCount: e.count,
			documentCount: e.docs.size
		});
	}
	return out.sort((a, b) => b.regions.length - a.regions.length);
}

// ── 4. Regionen ohne Naming ───────────────────────────────────────

export interface UnnamedRegion {
	region: number;
	size: number;
	medoidText: string;
	/** Wie viele der Sequenzen dieser Region gar keinen Anker tragen. */
	unanchoredCount: number;
}

/**
 * Regionen, in denen nichts benannt ist — ein *berechnetes* Muster der
 * Nicht-Präsenz.
 *
 * Für den Umgang damit gilt die Positionsregel unverändert: Eine Silence
 * darf **Cue** sein und nie den Gradienten hochsteigen; grounden darf sie
 * ein Mensch, die KI nicht. Dieses Modul zeigt sie an und
 * schreibt nichts.
 */
export async function unnamedRegions(
	structure: CorpusStructure,
	documentIds: string[]
): Promise<UnnamedRegion[]> {
	const anchored = await loadAnchoredNamings(documentIds);
	const anchoredItems = new Set<string>();
	for (const a of anchored) {
		for (const it of overlappingItems(structure, a)) {
			anchoredItems.add(`${it.documentId}:${it.seq}`);
		}
	}

	const out: UnnamedRegion[] = [];
	for (const region of structure.regions) {
		const members = structure.items.filter((it) => it.region === region.index);
		const unanchored = members.filter((it) => !anchoredItems.has(`${it.documentId}:${it.seq}`));
		if (unanchored.length === members.length) {
			out.push({
				region: region.index,
				size: members.length,
				medoidText: region.medoid.text,
				unanchoredCount: unanchored.length
			});
		}
	}
	return out.sort((a, b) => b.size - a.size);
}
