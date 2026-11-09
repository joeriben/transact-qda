// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure geometry functions for spatial relation derivation on SW/A maps.
// All functions are stateless — they take positions/dimensions and return results.

import { SW_ROLE_STYLES } from '$lib/shared/constants.js';
import type { SwRole } from '$lib/shared/types/index.js';

export interface Point {
	x: number;
	y: number;
}

export interface Formation {
	id: string;
	x: number;
	y: number;
	rx: number;
	ry: number;
	rotation: number; // degrees
	swRole: SwRole;
}

export interface SpatialState {
	elementInFormation: Array<{ elementId: string; formationId: string }>;
	formationInFormation: Array<{ innerId: string; outerId: string }>;
	formationOverlaps: Array<{ formationA: string; formationB: string }>;
}

// Transform a point into a formation's local coordinate system (rotation-aware).
function toLocal(point: Point, formation: Formation): Point {
	const dx = point.x - formation.x;
	const dy = point.y - formation.y;
	const rad = -formation.rotation * Math.PI / 180;
	return {
		x: dx * Math.cos(rad) - dy * Math.sin(rad),
		y: dx * Math.sin(rad) + dy * Math.cos(rad),
	};
}

// Test whether a point lies inside a formation (ellipse or rectangle).
export function pointInFormation(point: Point, formation: Formation): boolean {
	const local = toLocal(point, formation);
	const style = SW_ROLE_STYLES[formation.swRole] || SW_ROLE_STYLES['social-world'];

	if (style.shape === 'rect') {
		return Math.abs(local.x) <= formation.rx && Math.abs(local.y) <= formation.ry;
	}
	// Ellipse
	return (local.x / formation.rx) ** 2 + (local.y / formation.ry) ** 2 <= 1.0;
}

// Sample N points along a formation's boundary.
function sampleBoundary(formation: Formation, n: number = 16): Point[] {
	const style = SW_ROLE_STYLES[formation.swRole] || SW_ROLE_STYLES['social-world'];
	const rotRad = formation.rotation * Math.PI / 180;
	const points: Point[] = [];

	for (let i = 0; i < n; i++) {
		const t = (2 * Math.PI * i) / n;
		let lx: number, ly: number;

		if (style.shape === 'rect') {
			// Sample rectangle perimeter
			const perim = 2 * (formation.rx + formation.ry);
			const d = (perim * i) / n;
			if (d < formation.rx) {
				lx = d; ly = -formation.ry;
			} else if (d < formation.rx + 2 * formation.ry) {
				lx = formation.rx; ly = -formation.ry + (d - formation.rx);
			} else if (d < 2 * formation.rx + 2 * formation.ry) {
				lx = formation.rx - (d - formation.rx - 2 * formation.ry); ly = formation.ry;
			} else {
				lx = -formation.rx; ly = formation.ry - (d - 2 * formation.rx - 2 * formation.ry);
			}
		} else {
			// Ellipse boundary
			lx = formation.rx * Math.cos(t);
			ly = formation.ry * Math.sin(t);
		}

		// Rotate back to world coordinates
		points.push({
			x: formation.x + lx * Math.cos(rotRad) - ly * Math.sin(rotRad),
			y: formation.y + lx * Math.sin(rotRad) + ly * Math.cos(rotRad),
		});
	}

	return points;
}

// Test whether two formations overlap (any boundary intersection or containment).
export function formationsOverlap(f1: Formation, f2: Formation): boolean {
	// Quick check: centers inside each other
	if (pointInFormation({ x: f1.x, y: f1.y }, f2)) return true;
	if (pointInFormation({ x: f2.x, y: f2.y }, f1)) return true;

	// Sample boundaries
	const b1 = sampleBoundary(f1, 16);
	const b2 = sampleBoundary(f2, 16);

	for (const p of b1) {
		if (pointInFormation(p, f2)) return true;
	}
	for (const p of b2) {
		if (pointInFormation(p, f1)) return true;
	}

	return false;
}

// Test whether inner is fully contained within outer.
// All boundary points of inner must lie inside outer.
export function formationContainsFormation(inner: Formation, outer: Formation): boolean {
	const boundary = sampleBoundary(inner, 16);
	return boundary.every(p => pointInFormation(p, outer));
}

// ─── Verbindungslinien (Relationen auf dem Canvas) ───

/** Halbe Ausdehnung eines Knotens um seinen Mittelpunkt. */
export interface NodeExtent {
	hw: number;
	hh: number;
	shape: 'rect' | 'ellipse';
	rotation: number; // degrees
}

/** Kontrollpunkt der leicht gebogenen Linie zwischen zwei Mittelpunkten. */
export function connectionControl(x1: number, y1: number, x2: number, y2: number): Point {
	const midX = (x1 + x2) / 2;
	const midY = (y1 + y2) / 2;
	const off = Math.min(50, Math.hypot(x2 - x1, y2 - y1) * 0.15);
	const angle = Math.atan2(y2 - y1, x2 - x1);
	return { x: midX + Math.sin(angle) * off, y: midY - Math.cos(angle) * off };
}

/** Punkt auf der Kurvenmitte (t = 0.5). */
export function connectionMidpoint(x1: number, y1: number, x2: number, y2: number): Point {
	const c = connectionControl(x1, y1, x2, y2);
	return { x: 0.25 * x1 + 0.5 * c.x + 0.25 * x2, y: 0.25 * y1 + 0.5 * c.y + 0.25 * y2 };
}

/** Punkt auf der gebogenen Linie beim Parameter t (0 = Quelle, 1 = Ziel). */
export function connectionPoint(x1: number, y1: number, x2: number, y2: number, t: number): Point {
	const c = connectionControl(x1, y1, x2, y2);
	const u = 1 - t;
	return { x: u * u * x1 + 2 * u * t * c.x + t * t * x2, y: u * u * y1 + 2 * u * t * c.y + t * t * y2 };
}

/**
 * Lage einer gezogenen Relationsraute, bezogen auf ihre Linie: `t` ist der
 * Anteil entlang der Sehne von der Quelle zum Ziel, `d` der Abstand quer dazu
 * in Canvas-Pixeln (positiv zur Seite, zu der sich die Linie biegt). So folgt
 * die Raute ihren Endpunkten, wenn diese wandern.
 */
export interface LabelAt {
	t: number;
	d: number;
}

function chordFrame(a: Point, b: Point): { dx: number; dy: number; ux: number; uy: number; len: number } {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (len < 0.5) return { dx: 1, dy: 0, ux: 1, uy: 0, len: 1 };
	return { dx, dy, ux: dx / len, uy: dy / len, len };
}

/** Mittelpunkt der Raute für eine gespeicherte Lage. */
export function labelAtToPoint(a: Point, b: Point, at: LabelAt): Point {
	const f = chordFrame(a, b);
	// Normale wie die Biegung in connectionControl: (uy, -ux).
	return { x: a.x + at.t * f.dx + at.d * f.uy, y: a.y + at.t * f.dy - at.d * f.ux };
}

/** Gespeicherte Lage für einen Rautenmittelpunkt — genau dort, wo sie abgelegt
 *  wurde. Früher wurde t auf die Strecke zwischen den Endpunkten begrenzt; eine
 *  neben der Linie abgelegte Raute sprang dann an deren Anfang oder Ende
 *  (Testlauf 09.11.: „Gezogene Rauten landen nicht am Ablageort"). */
export function pointToLabelAt(a: Point, b: Point, p: Point): LabelAt {
	const f = chordFrame(a, b);
	const px = p.x - a.x;
	const py = p.y - a.y;
	const t = (px * f.ux + py * f.uy) / f.len;
	const d = px * f.uy - py * f.ux;
	return {
		t: Math.round((Number.isFinite(t) ? t : 0.5) * 1000) / 1000,
		d: Math.round(Number.isFinite(d) ? d : 0)
	};
}

/** Liegt der Punkt (dx, dy), relativ zum Knotenmittelpunkt, im Knoten? */
export function insideExtent(ext: NodeExtent, dx: number, dy: number, margin = 0): boolean {
	const rad = -ext.rotation * Math.PI / 180;
	const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
	const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
	const hw = ext.hw + margin;
	const hh = ext.hh + margin;
	if (ext.shape === 'ellipse') return (lx / hw) ** 2 + (ly / hh) ** 2 <= 1;
	return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

// Compute the full spatial relation state for a SW/A map.
export function computeSpatialRelations(
	elements: Array<{ id: string; x: number; y: number }>,
	formations: Formation[]
): SpatialState {
	const elementInFormation: SpatialState['elementInFormation'] = [];
	const formationInFormation: SpatialState['formationInFormation'] = [];
	const formationOverlaps: SpatialState['formationOverlaps'] = [];

	// Elements in formations
	for (const el of elements) {
		for (const f of formations) {
			if (pointInFormation(el, f)) {
				elementInFormation.push({ elementId: el.id, formationId: f.id });
			}
		}
	}

	// Formation-formation relationships
	for (let i = 0; i < formations.length; i++) {
		for (let j = i + 1; j < formations.length; j++) {
			const a = formations[i];
			const b = formations[j];

			if (!formationsOverlap(a, b)) continue;

			// Check full containment (either direction)
			const aInB = formationContainsFormation(a, b);
			const bInA = formationContainsFormation(b, a);

			if (aInB) {
				formationInFormation.push({ innerId: a.id, outerId: b.id });
			} else if (bInA) {
				formationInFormation.push({ innerId: b.id, outerId: a.id });
			} else {
				// Partial overlap (neither fully contains the other)
				formationOverlaps.push({ formationA: a.id, formationB: b.id });
			}
		}
	}

	return { elementInFormation, formationInFormation, formationOverlaps };
}
