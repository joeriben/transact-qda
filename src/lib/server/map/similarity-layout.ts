// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Similarity layout: place map cards so that spatial nearness = semantic
// nearness. This is what makes a situational map a MAP and not a spreadsheet —
// the researcher reads clusters and gaps as analytical structure (Clarke's
// "relational analysis" begins with proximity). It is a derivative projection:
// it writes positions/topology, never a naming_act or a designation. The AI
// shows distances; it does not draw the map. Every card stays the researcher's
// to move by hand.
//
// Pipeline: embed each card label (nomic, L2-normalized) → classical MDS on the
// cosine-distance matrix → scale to pixels → remove card-box overlaps. No
// external dependency; deterministic (fixed power-iteration seed) so re-running
// Layout on unchanged data yields the same map.

import { embedBatch } from '../documents/embeddings.js';
import { getMapStructure } from '../db/queries/maps.js';
import { estimateNodeSize } from '$lib/canvas/nodeSize.js';

type Pt = { x: number; y: number };

function dot(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

// Top-k eigenpairs of a symmetric n×n matrix by power iteration with deflation.
// n is small (map cards, typically tens to low hundreds) and k = 2, so this is
// far cheaper than a full eigensolver and needs no dependency.
function topEigen(M: number[][], k: number): { value: number; vector: number[] }[] {
	const n = M.length;
	const A = M.map((row) => row.slice());
	const out: { value: number; vector: number[] }[] = [];
	for (let c = 0; c < k; c++) {
		// Deterministic seed, varied per component so it isn't accidentally
		// orthogonal to the target eigenvector.
		let v = Array.from({ length: n }, (_, i) => Math.sin(i + 1 + c * 1.7));
		let vn = Math.hypot(...v) || 1;
		v = v.map((x) => x / vn);
		for (let iter = 0; iter < 256; iter++) {
			const w = new Array(n).fill(0);
			for (let i = 0; i < n; i++) {
				const Ai = A[i];
				let s = 0;
				for (let j = 0; j < n; j++) s += Ai[j] * v[j];
				w[i] = s;
			}
			const wn = Math.hypot(...w);
			if (wn < 1e-12) break;
			const nv = w.map((x) => x / wn);
			let diff = 0;
			for (let i = 0; i < n; i++) diff += Math.abs(nv[i] - v[i]);
			v = nv;
			if (diff < 1e-9) break;
		}
		// Signed eigenvalue via Rayleigh quotient (deflation needs the sign).
		const Av = new Array(n).fill(0);
		for (let i = 0; i < n; i++) {
			let s = 0;
			for (let j = 0; j < n; j++) s += A[i][j] * v[j];
			Av[i] = s;
		}
		const value = dot(v, Av);
		out.push({ value, vector: v });
		// Deflate: A := A - value · v vᵀ
		for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i][j] -= value * v[i] * v[j];
	}
	return out;
}

// Classical (Torgerson) MDS: 2D coordinates whose Euclidean distances best
// approximate the cosine distances between the embeddings.
function classicalMDS(vecs: number[][]): Pt[] {
	const n = vecs.length;
	if (n === 0) return [];
	if (n === 1) return [{ x: 0, y: 0 }];

	// L2-normalized vectors ⇒ squared Euclidean distance = 2 − 2·cos.
	const D2: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) {
			const d2 = Math.max(0, 2 - 2 * dot(vecs[i], vecs[j]));
			D2[i][j] = d2;
			D2[j][i] = d2;
		}

	// Double centering: B = −½ J D² J.
	const rowMean = D2.map((r) => r.reduce((a, b) => a + b, 0) / n);
	const grand = rowMean.reduce((a, b) => a + b, 0) / n;
	const B: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
	for (let i = 0; i < n; i++)
		for (let j = 0; j < n; j++) B[i][j] = -0.5 * (D2[i][j] - rowMean[i] - rowMean[j] + grand);

	// The two largest POSITIVE eigenvalues give the principal plane. Take a few
	// by magnitude, then keep the largest positive ones (cosine distances are
	// near-Euclidean, so small negatives can appear and must be discarded).
	const eig = topEigen(B, 4)
		.filter((e) => e.value > 1e-9)
		.sort((a, b) => b.value - a.value);
	const zero = { value: 0, vector: new Array(n).fill(0) };
	const ax = eig[0] ?? zero;
	const ay = eig[1] ?? zero;
	const sx = Math.sqrt(Math.max(0, ax.value));
	const sy = Math.sqrt(Math.max(0, ay.value));
	return Array.from({ length: n }, (_, i) => ({ x: ax.vector[i] * sx, y: ay.vector[i] * sy }));
}

// Scale the whole point cloud so its overall span fits a compact, readable
// footprint that grows with the card count (√n keeps density constant). Keying
// on the *span* — not the median nearest-neighbour gap — is what keeps the map
// readable: a few dissimilar outliers can no longer blow the gap-based scale up
// to a 10 000-px canvas that only fits at 17 %. Relative distances (near =
// similar) are preserved; the overlap pass then just nudges genuine collisions.
function scaleToPixels(pts: Pt[]): Pt[] {
	const n = pts.length;
	if (n < 2) return pts.map(() => ({ x: 0, y: 0 }));
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of pts) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	const span = Math.max(maxX - minX, maxY - minY) || 1;
	// ~280·√n px across: n=28 → ~1480, n=100 → ~2800; clamped so tiny and huge
	// maps stay sane.
	const targetSpan = Math.max(1100, Math.min(6000, 280 * Math.sqrt(n)));
	const s = targetSpan / span;
	return pts.map((p) => ({ x: p.x * s, y: p.y * s }));
}

// AABB overlap removal: push overlapping card boxes apart along their axis of
// least penetration. Keeps semantic neighbours adjacent, only makes them
// readable. Converges quickly for map-sized node counts.
function removeOverlaps(pts: Pt[], boxes: { width: number; height: number }[], passes = 80): Pt[] {
	const GAP = 30;
	const p = pts.map((q) => ({ ...q }));
	for (let it = 0; it < passes; it++) {
		let moved = false;
		for (let i = 0; i < p.length; i++)
			for (let j = i + 1; j < p.length; j++) {
				const dx = p[j].x - p[i].x;
				const dy = p[j].y - p[i].y;
				const minX = (boxes[i].width + boxes[j].width) / 2 + GAP;
				const minY = (boxes[i].height + boxes[j].height) / 2 + GAP;
				const ox = minX - Math.abs(dx);
				const oy = minY - Math.abs(dy);
				if (ox > 0 && oy > 0) {
					moved = true;
					if (ox <= oy) {
						const push = ox / 2;
						const dir = dx < 0 ? -1 : 1;
						p[i].x -= push * dir;
						p[j].x += push * dir;
					} else {
						const push = oy / 2;
						const dir = dy < 0 ? -1 : 1;
						p[i].y -= push * dir;
						p[j].y += push * dir;
					}
				}
			}
		if (!moved) break;
	}
	return p;
}

/**
 * Compute a similarity-driven 2D layout for a map's cards.
 * Returns { namingId: {x, y} } for every element/silence on the map.
 * Relations are not placed here — they render at their endpoints' midpoint.
 * On any failure (e.g. embedding model unavailable) returns {} so the caller
 * falls back to the geometric layout.
 */
export async function computeSimilarityLayout(
	mapId: string,
	projectId: string
): Promise<Record<string, Pt>> {
	try {
		const structure = await getMapStructure(mapId, projectId);
		const nodes = [...structure.elements, ...structure.silences].filter((n: any) => n.naming_id);
		if (nodes.length === 0) return {};
		if (nodes.length === 1) return { [nodes[0].naming_id]: { x: 400, y: 300 } };

		const labelOf = (n: any) => (n.current_inscription || n.inscription || '').trim() || '·';
		const vecs = await embedBatch(nodes.map(labelOf));

		let pts = classicalMDS(vecs);
		pts = scaleToPixels(pts);
		const boxes = nodes.map((n: any) => estimateNodeSize(labelOf(n), n.mode !== 'silence'));
		pts = removeOverlaps(pts, boxes);

		// Shift into a positive frame with a small margin.
		const minX = Math.min(...pts.map((p) => p.x));
		const minY = Math.min(...pts.map((p) => p.y));
		const out: Record<string, Pt> = {};
		nodes.forEach((n: any, i: number) => {
			out[n.naming_id] = { x: Math.round(pts[i].x - minX + 80), y: Math.round(pts[i].y - minY + 80) };
		});
		return out;
	} catch (err) {
		console.warn('[similarity-layout] failed, caller will fall back:', err);
		return {};
	}
}
