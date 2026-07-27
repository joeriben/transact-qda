// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thematic segmentation for the per-document coding run.
//
// The coding run must walk the document in units. A transcript has no
// reliable paragraph structure — blank lines are an artifact of how the
// transcript happened to be typed, not of where its themes turn. Walking
// `paragraph` elements therefore couples the coding unit to a
// transcription accident.
//
// This module computes the walk units algorithmically: thematic
// sequences ("Sequenzen"), spans where the text stays on one topic, with
// boundaries at the points where the topic turns. NOT speaker turns —
// topic turns. The method is TextTiling (Hearst 1997), adapted from a
// lexical signal to sentence embeddings:
//
//   1. Each sentence already carries an embedding (computed at upload,
//      stored in document_elements.embedding). Adjacent sentences on the
//      same theme have similar embeddings.
//   2. At each gap between two sentences, measure block cohesion: the
//      cosine similarity between the mean embedding of the K sentences
//      before the gap and the K sentences after it.
//   3. A topic turn is a local *minimum* in cohesion — the text is least
//      similar across that gap. Score each minimum by its valley depth
//      (how far cohesion rises again on each side) and cut at the deep
//      ones.
//   4. A size guard merges sequences that came out too short and splits
//      ones that came out too long, so every walk unit is a workable
//      coding unit.
//
// Ephemeral by design (Variante A): segmentation is recomputed at the
// start of each coding run and never persisted. No schema change, no new
// element_type. When the method improves, the next run just picks it up.
//
// Fallback: if some sentences have no embedding (embedding failed, or the
// model could not be loaded), cohesion cannot be measured — the module
// falls back to fixed-size character windows. Honest degradation: every
// Sequence carries `method` so the caller can see which path ran.

import { query } from '../../db/index.js';
import { embedDocumentElements } from '../../documents/embed-elements.js';

// ── Tunables ──────────────────────────────────────────────────────
// Plain consts, not settings — segmentation is ephemeral and these are
// method parameters, not user preferences. Adjust here if runs show the
// sequences come out consistently too coarse or too fine.

/** Block size for cohesion: K sentences on each side of a gap. */
const BLOCK_K = 2;
/** Depth cutoff: a cohesion minimum becomes a boundary when its valley
 *  depth exceeds mean + DEPTH_C·std of all minima depths. Higher → fewer
 *  cuts (only the deepest valleys count as a topic turn). */
const DEPTH_C = 0.5;
/** A sequence shorter than this (chars) is merged into a neighbour. */
const MIN_CHARS = 250;
/** A sequence longer than this (chars) is split at its weakest gap. */
const MAX_CHARS = 1500;
/** Target sequence length (chars) for the char-window fallback. */
const WINDOW_TARGET = 700;

// ── Public shape ──────────────────────────────────────────────────

export interface Sequence {
	/** 1-based position of this sequence in the document. */
	seq: number;
	/** Char offset into full_text where the sequence starts. */
	charStart: number;
	/** Char offset into full_text where the sequence ends. */
	charEnd: number;
	/** The sequence text, sliced verbatim from full_text. */
	text: string;
	/** How many sentence elements the sequence spans. */
	sentenceCount: number;
	/** Which method produced the boundaries — 'cohesion' (sentence
	 *  embeddings) or 'char-window' (fallback: no usable embeddings, or
	 *  too few sentences for block cohesion). Document-wide. */
	method: 'cohesion' | 'char-window';
}

// ── Internal shapes ───────────────────────────────────────────────

interface LoadedSentence {
	content: string;
	charStart: number;
	charEnd: number;
	embedding: number[] | null;
}

/** Inclusive sentence-index span [start..end]. */
interface Range {
	start: number;
	end: number;
}

// ── Vector helpers ────────────────────────────────────────────────

function meanVec(vecs: number[][]): number[] {
	const dims = vecs[0].length;
	const out = new Array<number>(dims).fill(0);
	for (const v of vecs) {
		for (let i = 0; i < dims; i++) out[i] += v[i];
	}
	for (let i = 0; i < dims; i++) out[i] /= vecs.length;
	return out;
}

/** Cosine similarity with explicit norms — block means are not unit
 *  vectors even when the sentence embeddings are. */
function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	if (na === 0 || nb === 0) return 0;
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function meanStd(xs: number[]): { mean: number; std: number } {
	if (xs.length === 0) return { mean: 0, std: 0 };
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
	return { mean, std: Math.sqrt(variance) };
}

// ── Load ──────────────────────────────────────────────────────────

/**
 * Load a document's sentence elements in reading order, with their
 * embeddings. pgvector's `::text` form ('[0.1,0.2,...]') is valid JSON;
 * a sentence whose embedding is absent or unparseable gets `null`, which
 * routes segmentDocument to the char-window fallback.
 */
async function loadSentences(documentId: string): Promise<LoadedSentence[]> {
	const res = await query<{
		content: string;
		char_start: number;
		char_end: number;
		embedding: string | null;
	}>(
		`SELECT content, char_start, char_end, embedding::text AS embedding
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
		return {
			content: r.content,
			charStart: r.char_start,
			charEnd: r.char_end,
			embedding
		};
	});
}

// ── Cohesion path ─────────────────────────────────────────────────

/**
 * Block cohesion at each gap g (0..n-2): the cosine similarity between
 * the mean embedding of the BLOCK_K sentences ending at g and the
 * BLOCK_K sentences starting at g+1. Blocks are clamped at the document
 * edges. Only called when every sentence is embedded — the empty-block
 * guard is defensive.
 */
function gapCohesion(sentences: LoadedSentence[]): number[] {
	const n = sentences.length;
	const cohesion: number[] = [];
	for (let g = 0; g < n - 1; g++) {
		const left: number[][] = [];
		for (let i = Math.max(0, g - BLOCK_K + 1); i <= g; i++) {
			if (sentences[i].embedding) left.push(sentences[i].embedding!);
		}
		const right: number[][] = [];
		for (let i = g + 1; i <= Math.min(n - 1, g + BLOCK_K); i++) {
			if (sentences[i].embedding) right.push(sentences[i].embedding!);
		}
		// A missing block cannot be a topic turn — score it as max cohesion.
		cohesion.push(
			left.length > 0 && right.length > 0 ? cosine(meanVec(left), meanVec(right)) : 1
		);
	}
	return cohesion;
}

/**
 * Valley depth at gap g: how far cohesion rises to a local peak on each
 * side. Walk outward while cohesion keeps rising away from g; the two
 * peak heights minus cohesion[g] sum to the depth. A deep valley is a
 * clear topic turn; a shallow one is just noise.
 */
function valleyDepth(cohesion: number[], g: number): number {
	let l = g;
	while (l > 0 && cohesion[l - 1] >= cohesion[l]) l--;
	let r = g;
	while (r < cohesion.length - 1 && cohesion[r + 1] >= cohesion[r]) r++;
	return cohesion[l] - cohesion[g] + (cohesion[r] - cohesion[g]);
}

/**
 * Gap indices that are thematic boundaries: local minima in cohesion
 * whose valley depth exceeds mean + DEPTH_C·std over all minima depths.
 */
function boundariesFromCohesion(cohesion: number[]): number[] {
	const m = cohesion.length;
	if (m === 0) return [];
	// Local minima in cohesion — candidate boundaries. Infinity at the
	// edges lets the first and last gaps qualify.
	const minima: number[] = [];
	for (let g = 0; g < m; g++) {
		const left = g > 0 ? cohesion[g - 1] : Infinity;
		const right = g < m - 1 ? cohesion[g + 1] : Infinity;
		if (cohesion[g] <= left && cohesion[g] <= right) minima.push(g);
	}
	if (minima.length === 0) return [];
	const depths = minima.map((g) => valleyDepth(cohesion, g));
	const { mean, std } = meanStd(depths);
	const cutoff = mean + DEPTH_C * std;
	return minima.filter((_, i) => depths[i] >= cutoff);
}

// ── Ranges & size guard ───────────────────────────────────────────

/** Boundary gap indices → inclusive sentence ranges. A boundary at gap
 *  b cuts between sentence b and b+1. */
function rangesFromBoundaries(boundaries: number[], n: number): Range[] {
	const ranges: Range[] = [];
	let start = 0;
	for (const b of boundaries) {
		ranges.push({ start, end: b });
		start = b + 1;
	}
	ranges.push({ start, end: n - 1 });
	return ranges;
}

function rangeChars(sentences: LoadedSentence[], r: Range): number {
	return sentences[r.end].charEnd - sentences[r.start].charStart;
}

/**
 * Merge sub-MIN sequences, split super-MAX ones — so every walk unit is
 * a workable coding unit. Operates on the boundary list and returns the
 * adjusted one. Both passes carry a loop guard: each merge removes a
 * boundary and each split adds one, so neither can run past n.
 *
 * Merge before split: splitting a long range at its weakest gap yields
 * roughly even halves (MAX/MIN = 6×), so a split rarely creates a fresh
 * sub-MIN piece — and a marginally short tail is an acceptable coding
 * unit, a super-MAX one is not.
 */
function sizeGuard(
	boundaries: number[],
	sentences: LoadedSentence[],
	cohesion: number[]
): number[] {
	const n = sentences.length;
	const bs = [...boundaries];

	// ── Merge: a sequence below MIN_CHARS is merged across its weaker
	//    (higher-cohesion) adjacent boundary — the lesser topic turn. ──
	for (let guard = 0; guard < n + 8; guard++) {
		const ranges = rangesFromBoundaries(bs, n);
		if (ranges.length === 1) break;
		const idx = ranges.findIndex((r) => rangeChars(sentences, r) < MIN_CHARS);
		if (idx === -1) break;
		let removeAt: number;
		if (idx === 0) {
			removeAt = 0; // first sequence — only a right neighbour
		} else if (idx === ranges.length - 1) {
			removeAt = bs.length - 1; // last sequence — only a left neighbour
		} else {
			// Drop the weaker boundary: higher cohesion = less of a turn.
			const leftCoh = cohesion[bs[idx - 1]];
			const rightCoh = cohesion[bs[idx]];
			removeAt = rightCoh >= leftCoh ? idx : idx - 1;
		}
		bs.splice(removeAt, 1);
	}

	// ── Split: a sequence above MAX_CHARS is split at its weakest
	//    internal gap, preferring a gap that leaves both sides >= MIN. ──
	for (let guard = 0; guard < n + 8; guard++) {
		const ranges = rangesFromBoundaries(bs, n);
		const idx = ranges.findIndex(
			(r) => r.end > r.start && rangeChars(sentences, r) > MAX_CHARS
		);
		if (idx === -1) break;
		const r = ranges[idx];
		let balancedGap = -1;
		let balancedCoh = Infinity;
		let anyGap = -1;
		let anyCoh = Infinity;
		for (let g = r.start; g < r.end; g++) {
			if (cohesion[g] < anyCoh) {
				anyCoh = cohesion[g];
				anyGap = g;
			}
			const leftChars = sentences[g].charEnd - sentences[r.start].charStart;
			const rightChars = sentences[r.end].charEnd - sentences[g + 1].charStart;
			if (leftChars >= MIN_CHARS && rightChars >= MIN_CHARS && cohesion[g] < balancedCoh) {
				balancedCoh = cohesion[g];
				balancedGap = g;
			}
		}
		const cut = balancedGap !== -1 ? balancedGap : anyGap;
		if (cut === -1) break; // single-sentence range — unsplittable
		bs.push(cut);
		bs.sort((a, b) => a - b);
	}

	return bs;
}

/** Thematic boundaries from sentence embeddings, size-guarded. */
function cohesionRanges(sentences: LoadedSentence[]): Range[] {
	const cohesion = gapCohesion(sentences);
	const boundaries = sizeGuard(boundariesFromCohesion(cohesion), sentences, cohesion);
	return rangesFromBoundaries(boundaries, sentences.length);
}

// ── Char-window fallback ──────────────────────────────────────────

/**
 * Fixed-size character windows — the fallback when embeddings are
 * missing, or when there are too few sentences for block cohesion.
 * Accumulates whole sentences until WINDOW_TARGET chars, then cuts; a
 * trailing sub-MIN sliver is folded into the last full window.
 */
function charWindowRanges(sentences: LoadedSentence[]): Range[] {
	const n = sentences.length;
	const ranges: Range[] = [];
	let start = 0;
	for (let i = 0; i < n; i++) {
		const chars = sentences[i].charEnd - sentences[start].charStart;
		if (chars >= WINDOW_TARGET && i < n - 1) {
			ranges.push({ start, end: i });
			start = i + 1;
		}
	}
	ranges.push({ start, end: n - 1 });
	// Fold a trailing sliver into its predecessor.
	if (ranges.length > 1) {
		const last = ranges[ranges.length - 1];
		if (rangeChars(sentences, last) < MIN_CHARS) {
			ranges[ranges.length - 2].end = last.end;
			ranges.pop();
		}
	}
	return ranges;
}

// ── Entry point ───────────────────────────────────────────────────

/**
 * Compute the thematic sequences of a document — the coding run's walk
 * units. Ephemeral: recomputed on every call, never persisted.
 *
 * @param documentId  the document's naming id.
 * @param fullText    document_content.full_text — sequences are sliced
 *                    from it so they carry the original span verbatim.
 */
export async function segmentDocument(
	documentId: string,
	fullText: string
): Promise<Sequence[]> {
	// Safety net: embed any sentence still lacking an embedding. The call
	// is idempotent and cheap when the document was already embedded at
	// upload; the case that matters is a document parsed before embeddings
	// existed. Non-fatal — if embedding fails, the fallback still segments.
	try {
		await embedDocumentElements(documentId);
	} catch {
		// Ignore — loadSentences will surface which sentences lack vectors
		// and segmentDocument falls back to character windows.
	}

	const sentences = await loadSentences(documentId);
	if (sentences.length === 0) {
		throw new Error(
			'Document has no sentence elements — parse the document before running a coding run'
		);
	}

	// Cohesion needs every sentence embedded and enough sentences to form
	// blocks on both sides of a gap. Otherwise: character windows.
	const allEmbedded = sentences.every((s) => s.embedding !== null);
	const method: Sequence['method'] =
		allEmbedded && sentences.length >= 4 ? 'cohesion' : 'char-window';
	const ranges =
		method === 'cohesion' ? cohesionRanges(sentences) : charWindowRanges(sentences);

	return ranges.map((r, i) => {
		const charStart = sentences[r.start].charStart;
		const charEnd = sentences[r.end].charEnd;
		// Slice from full_text so the sequence keeps the original span
		// verbatim (inter-sentence whitespace and all); fall back to
		// joining sentence content if full_text is unavailable.
		const sliced = fullText ? fullText.slice(charStart, charEnd).trim() : '';
		const text =
			sliced ||
			sentences
				.slice(r.start, r.end + 1)
				.map((s) => s.content.trim())
				.join(' ');
		return {
			seq: i + 1,
			charStart,
			charEnd,
			text,
			sentenceCount: r.end - r.start + 1,
			method
		};
	});
}
