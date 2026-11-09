// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeLayout, computeRadialLayout } from '$lib/canvas/layout.js';
import {
	computeSpatialRelations,
	connectionMidpoint,
	connectionPoint,
	labelAtToPoint,
	pointToLabelAt,
	type Formation,
	type LabelAt,
	type NodeExtent
} from '$lib/canvas/geometry.js';
import { estimateNodeSize } from '$lib/canvas/nodeSize.js';
import { SW_ROLE_STYLES } from '$lib/shared/constants.js';
import { formatWhen } from '$lib/shared/dates.js';
import { hasOwnInscription } from '$lib/shared/namingLabel.js';
import { untrack } from 'svelte';
import type { MapState } from './mapState.svelte.js';

type Pt = { x: number; y: number };
type Box = { width: number; height: number };
type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** Vom Rand der Canvas-Fläche verdeckt (Panels über der Karte), in Bildschirmpixeln. */
export type ViewInsets = { left: number; right: number; top: number; bottom: number };

const GAP = 24;

/** Länge der Achsen der Positionskarte (Ursprung unten links, y nach oben negativ). */
export const POS_AXIS_LEN = 800;

function clamp(v: number, lo: number, hi: number): number {
	return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}

// Find a collision-free spot near (cx, cy) by walking a golden-angle spiral
// outward and testing the node's real box against every occupied box.
// Deterministic — replaces the old random scatter that piled new cards on top
// of whatever already sat at the viewport center. `within`: the whole box must
// lie inside it (positional map: the diagram). null = no free spot found.
// `aspect`: die Spirale wird so breit gezogen (Breite : Höhe). Mit dem
// Seitenverhältnis des Ausschnitts kommt ein Neuer neben die vorhandenen statt
// darunter — kreisrund lag unter einer Formation früher Platz frei als neben
// ihr, und neue Formationen stapelten sich senkrecht aus dem Bild.
function findFreeSpot(
	cx: number,
	cy: number,
	box: Box,
	occupied: Array<Pt & Box>,
	within?: Rect,
	aspect = 1
): Pt | null {
	// Die Schrittweite wächst mit dem Kasten: eine Formation braucht weite
	// Schritte, sonst endet die Spirale, bevor sie neben einer Arena ankommt.
	const step = Math.max(34, Math.min(box.width, box.height) * 0.3);
	const sx = Math.sqrt(aspect);
	for (let i = 0; i < 1500; i++) {
		const r = step * Math.sqrt(i);
		const a = i * 2.39996322973; // golden angle
		const x = cx + r * Math.cos(a) * sx;
		const y = cy + (r * Math.sin(a)) / sx;
		if (
			within &&
			(x - box.width / 2 < within.minX || x + box.width / 2 > within.maxX ||
				y - box.height / 2 < within.minY || y + box.height / 2 > within.maxY)
		) continue;
		const clash = occupied.some(
			(o) =>
				Math.abs(o.x - x) < (o.width + box.width) / 2 + GAP &&
				Math.abs(o.y - y) < (o.height + box.height) / 2 + GAP
		);
		if (!clash) return { x, y };
	}
	return null;
}

/** Überdeckungsfläche zweier Kästen (mit Abstand `pad`), 0 = frei. */
function overlapArea(a: Pt & Box, b: Pt & Box, pad: number): number {
	const ox = (a.width + b.width) / 2 + pad - Math.abs(a.x - b.x);
	const oy = (a.height + b.height) / 2 + pad - Math.abs(a.y - b.y);
	return ox > 0 && oy > 0 ? ox * oy : 0;
}

// Wo eine Raute ohne gespeicherte Lage auf ihrer Linie sitzen darf: zuerst die
// Mitte, dann abwechselnd zu beiden Seiten.
const LABEL_CANDIDATES = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8];

function labelAtOf(rel: any): LabelAt | null {
	const la = rel?.properties?.labelAt;
	if (!la || typeof la !== 'object') return null;
	const t = Number(la.t);
	const d = Number(la.d);
	return Number.isFinite(t) && Number.isFinite(d) ? { t, d } : null;
}

export type CanvasPositions = ReturnType<typeof createCanvasPositions>;

/**
 * Canvas position management: layout, radial center-on, spatial sync (SW/A),
 * topology snapshots, and position persistence.
 *
 * Extracted from +page.svelte to isolate the ~250 lines of position/layout
 * logic that have no business in the page orchestrator.
 */
export function createCanvasPositions(
	ms: MapState,
	viewport: { x: number; y: number; zoom: number },
	/** Größe der Canvas-Fläche in Pixeln; null, solange sie nicht messbar ist. */
	viewSize: () => { width: number; height: number } | null = () => null,
	/** Was Panels über der Karte (Unplaced, Stack) vom Rand verdecken. */
	viewInsets: () => ViewInsets | null = () => null,
) {
	// Innenfläche des Positionsdiagramms (Ursprung unten links, y nach oben negativ).
	const POS_INNER: Rect = { minX: 12, minY: -POS_AXIS_LEN + 12, maxX: POS_AXIS_LEN - 12, maxY: -12 };

	// ─── Positions ───
	// Nur Elemente und Stillen stehen hier. Eine Relation steht zwischen ihren
	// Endpunkten; wo ihre Raute sitzt, berechnet `diamondCenters`.

	let positions = $state<Map<string, { x: number; y: number }>>(new Map());
	let layoutInitialized = false;
	let initDone = $state(false);
	let currentMapId: string | null = null;

	// Keep mapState.positionsRef in sync for unresolved tracking
	$effect(() => { ms.positionsRef = positions; });

	// Auto-place nodes that arrive after init (toolbar add, pull-onto-map,
	// import, AI writes): a node without a position is not rendered at all, so
	// without this a freshly added object stays invisible until the next full
	// page load. layoutNewNodes() itself keeps the primary-map exemption.
	let placing = false;
	$effect(() => {
		void ms.elements.length; void ms.silences.length; void ms.relations.length;
		if (!initDone || placing) return;
		const missing = [...ms.elements, ...ms.silences].some((n: any) => !positions.has(n.naming_id));
		if (!missing) return;
		placing = true;
		// Ungetrackt: was das Platzieren liest (Ausschnitt, Panels), soll diesen
		// Effekt nicht bei jedem Verschieben der Ansicht erneut anstoßen.
		untrack(() => layoutNewNodes()).finally(() => { placing = false; });
	});

	// ─── Center-on (radial layout) ───

	let centeredId = $state<string | null>(null);
	let preRadialPositions: Map<string, { x: number; y: number }> | null = null;

	const centeredConnections = $derived.by(() => {
		if (!centeredId) return null;
		const connected = new Set<string>([centeredId]);
		for (const rel of ms.relations) {
			const src = rel.directed_from || rel.part_source_id;
			const tgt = rel.directed_to || rel.part_target_id;
			if (src === centeredId || tgt === centeredId) {
				if (src) connected.add(src);
				if (tgt) connected.add(tgt);
				connected.add(rel.naming_id);
			}
		}
		return connected;
	});

	// ─── Spatial relation sync (SW/A maps) ───

	let spatialSyncPending = false;
	let spatialSyncQueued = false;

	// ─── Ausschnitt und Knotengeometrie ───

	function viewPx(): { width: number; height: number } {
		const s = viewSize();
		return s && s.width > 0 && s.height > 0 ? s : { width: 800, height: 600 };
	}

	/** Mitte des sichtbaren Ausschnitts in Canvas-Koordinaten. */
	function viewportCenter(): Pt {
		const s = viewPx();
		return {
			x: s.width / (2 * viewport.zoom) - viewport.x,
			y: s.height / (2 * viewport.zoom) - viewport.y
		};
	}

	/** Sichtbarer Ausschnitt ohne die Panels über der Karte, in Canvas-Koordinaten. */
	function freeRect(margin = 16): Rect {
		const s = viewPx();
		const ins = viewInsets() ?? { left: 0, right: 0, top: 0, bottom: 0 };
		const z = viewport.zoom;
		let left = ins.left + margin;
		let right = s.width - ins.right - margin;
		let top = ins.top + margin;
		let bottom = s.height - ins.bottom - margin;
		// Bleibt neben den Panels kaum Platz, zählt der ganze Ausschnitt.
		if (right - left < 160) { left = margin; right = s.width - margin; }
		if (bottom - top < 120) { top = margin; bottom = s.height - margin; }
		return { minX: left / z - viewport.x, maxX: right / z - viewport.x, minY: top / z - viewport.y, maxY: bottom / z - viewport.y };
	}

	function freeCenter(): Pt {
		const r = freeRect();
		return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
	}

	function formationOf(n: any): { rx: number; ry: number; rotation: number; shape: 'rect' | 'ellipse' } | null {
		if (ms.mapType !== 'social-worlds' || !n?.sw_role) return null;
		const style = SW_ROLE_STYLES[n.sw_role as keyof typeof SW_ROLE_STYLES];
		return {
			rx: n.properties?.rx || 150,
			ry: n.properties?.ry || 100,
			rotation: n.properties?.rotation || 0,
			shape: style?.shape === 'rect' ? 'rect' : 'ellipse'
		};
	}

	// Raute einer Relation (CanvasRelationNode: so breit wie ihr Text, höchstens 220 px).
	// Ohne eigene Inschrift steht dort „Quelle —valenz→ Ziel" (eine Zeile weniger).
	function relationBox(rel: any): Box {
		const own = hasOwnInscription(rel.inscription);
		const text: string = own ? rel.inscription : ms.findInscription(rel.naming_id);
		const textW = text.length * 6.6;
		const lines = Math.max(1, Math.ceil(textW / 180));
		return {
			width: Math.min(220, Math.max(90, textW + 40)),
			height: Math.max(36, 10 + lines * 16 + (own && rel.valence ? 13 : 0))
		};
	}

	/** Ausdehnung eines Knotens um seinen Mittelpunkt — dort enden die Linien. */
	function nodeExtent(id: string): NodeExtent | null {
		const n = ms.findNode(id);
		if (!n) return null;
		const f = formationOf(n);
		if (f) return { hw: f.rx, hh: f.ry, shape: f.shape, rotation: f.rotation };
		const b = n.mode === 'relation' ? relationBox(n) : estimateNodeSize(n.inscription || '', n.mode !== 'silence');
		return { hw: b.width / 2, hh: b.height / 2, shape: 'rect', rotation: 0 };
	}

	/** Achsenparalleler Kasten um einen Knoten, für Platzierung und Einpassen.
	 *  Eine Formation zählt mit ihrer (gedrehten) Ellipse bzw. ihrem Rechteck. */
	function boxOf(n: any): Box {
		const f = formationOf(n);
		if (f) {
			const t = (f.rotation * Math.PI) / 180;
			const c = Math.abs(Math.cos(t));
			const s = Math.abs(Math.sin(t));
			const hw = f.shape === 'rect' ? f.rx * c + f.ry * s : Math.hypot(f.rx * c, f.ry * s);
			const hh = f.shape === 'rect' ? f.rx * s + f.ry * c : Math.hypot(f.rx * s, f.ry * c);
			// + Strich und Abzeichen am Rand
			return { width: 2 * hw + 20, height: 2 * hh + 20 };
		}
		if (n?.mode === 'relation') return relationBox(n);
		return estimateNodeSize(n?.inscription || '', n?.mode !== 'silence');
	}

	// Das Innere einer Formation ist freie Fläche; im Weg steht nur ihr Label
	// (FormationNode: mittig, bei großen Arenen oben).
	function formationLabelBox(n: any, p: Pt, f: { ry: number; rotation: number }): Pt & Box {
		const oy = n.sw_role === 'arena' && f.ry >= 70 ? -f.ry + 38 : 0;
		const r = (f.rotation * Math.PI) / 180;
		const label = String(n.inscription ?? '');
		return {
			x: p.x - oy * Math.sin(r),
			y: p.y + oy * Math.cos(r),
			width: Math.max(60, label.length * 8.6 + 24),
			height: 26
		};
	}

	/** Steht der Knoten auf dem Canvas? Eine Relation, sobald ihre Endpunkte stehen. */
	function isDrawable(id: string, depth = 0): boolean {
		const n = ms.findNode(id);
		if (!n) return false;
		if (n.mode === 'relation') {
			if (depth > 4) return false;
			const [s, t] = ms.endpointsOf(n);
			return !!s && !!t && isDrawable(s, depth + 1) && isDrawable(t, depth + 1);
		}
		return positions.has(id);
	}

	// ─── Rauten der Relationen ───
	// Eine gezogene Raute behält ihre Lage zur Linie (properties.labelAt der
	// Erscheinung auf dieser Karte). Ohne gespeicherte Lage rückt sie entlang
	// ihrer Linie, bis sie weder Knoten noch andere Rauten überdeckt — sonst
	// lagen die Beschriftungen auf der Linienmitte übereinander.

	function computeDiamonds(pos: Map<string, Pt>): Map<string, Pt> {
		const out = new Map<string, Pt>();
		const obstacles: Array<Pt & Box> = [];
		for (const [id, p] of pos) {
			const n = ms.findNode(id);
			if (!n || n.mode === 'relation' || ms.isHiddenByFilter(n)) continue;
			const f = formationOf(n);
			obstacles.push(f ? formationLabelBox(n, p, f) : { x: p.x, y: p.y, ...boxOf(n) });
		}
		const visiting = new Set<string>();

		function place(rel: any, a: Pt, b: Pt): Pt {
			const box = relationBox(rel);
			const at = labelAtOf(rel);
			let best: Pt | null = at ? labelAtToPoint(a, b, at) : null;
			if (!best) {
				let bestCost = Infinity;
				for (const t of LABEL_CANDIDATES) {
					const c = connectionPoint(a.x, a.y, b.x, b.y, t);
					let cost = 0;
					for (const o of obstacles) cost += overlapArea({ ...c, ...box }, o, 6);
					if (cost === 0) { best = c; break; }
					cost += Math.abs(t - 0.5) * 40; // bei Gleichstand näher an der Mitte
					if (cost < bestCost) { bestCost = cost; best = c; }
				}
			}
			const p = best ?? connectionMidpoint(a.x, a.y, b.x, b.y);
			obstacles.push({ ...p, ...box });
			return p;
		}

		function center(id: string, depth: number): Pt | null {
			const n = ms.findNode(id);
			if (!n) return null;
			if (n.mode !== 'relation') return pos.get(id) ?? null;
			const known = out.get(id);
			if (known) return known;
			if (depth > 4 || visiting.has(id)) return null;
			visiting.add(id);
			const [s, t] = ms.endpointsOf(n);
			const a = s ? center(s, depth + 1) : null;
			const b = t ? center(t, depth + 1) : null;
			visiting.delete(id);
			if (!a || !b) return null;
			const p = place(n, a, b);
			out.set(id, p);
			return p;
		}

		const drawn = ms.relations.filter((r: any) => !r.properties?.spatiallyDerived && !ms.isHiddenByFilter(r));
		// Gezogene zuerst: die übrigen weichen ihnen aus.
		for (const r of drawn) if (labelAtOf(r)) center(r.naming_id, 0);
		for (const r of drawn) center(r.naming_id, 0);
		return out;
	}

	const diamondCenters = $derived(computeDiamonds(positions));

	/** Hat die Forscherin die Raute selbst gesetzt? Dann führt die Linie geknickt durch sie. */
	function isLabelPinned(relId: string): boolean {
		return !!labelAtOf(ms.findNode(relId));
	}

	// Was schon steht, als Kästen; Relationen an ihrer Raute.
	function occupiedBoxes(pos: Map<string, Pt>): Array<Pt & Box> {
		const out: Array<Pt & Box> = [];
		for (const [id, p] of pos) {
			const n = ms.findNode(id);
			if (!n || n.mode === 'relation') continue;
			out.push({ x: p.x, y: p.y, ...boxOf(n) });
		}
		const live = pos === positions;
		for (const rel of ms.relations) {
			if (rel.properties?.spatiallyDerived) continue;
			let c: Pt | undefined;
			if (live) c = diamondCenters.get(rel.naming_id);
			else {
				const [s, t] = ms.endpointsOf(rel);
				const a = s ? pos.get(s) : undefined;
				const b = t ? pos.get(t) : undefined;
				const at = labelAtOf(rel);
				if (a && b) c = at ? labelAtToPoint(a, b, at) : connectionMidpoint(a.x, a.y, b.x, b.y);
			}
			if (c) out.push({ ...c, ...relationBox(rel) });
		}
		return out;
	}

	function fallbackSpot(cx: number, cy: number, box: Box, occupied: Array<Pt & Box>, within?: Rect): Pt {
		// Volles Diagramm: lieber überlappend im Diagramm als außerhalb.
		if (within) return { x: cx, y: cy };
		let maxX = -Infinity;
		for (const o of occupied) maxX = Math.max(maxX, o.x + o.width / 2);
		return { x: Number.isFinite(maxX) ? maxX + GAP + box.width / 2 : cx, y: cy };
	}

	/** Freier Platz für einen Knoten nahe (cx, cy); auf der Positionskarte im Diagramm. */
	function spotFor(node: any, cx: number, cy: number, occupied: Array<Pt & Box>): Pt {
		const box = boxOf(node);
		const within = ms.mapType === 'positional' ? POS_INNER : undefined;
		if (within) {
			cx = clamp(cx, within.minX + box.width / 2, within.maxX - box.width / 2);
			cy = clamp(cy, within.minY + box.height / 2, within.maxY - box.height / 2);
		}
		return findFreeSpot(cx, cy, box, occupied, within) ?? fallbackSpot(cx, cy, box, occupied, within);
	}

	/** Freier Platz im sichtbaren Ausschnitt, nicht unter einem Panel; sonst wie spotFor. */
	function visibleSpotFor(node: any, occupied: Array<Pt & Box>, near?: Pt): Pt {
		const area = freeRect();
		let within: Rect | null = area;
		if (ms.mapType === 'positional') {
			within = {
				minX: Math.max(area.minX, POS_INNER.minX), maxX: Math.min(area.maxX, POS_INNER.maxX),
				minY: Math.max(area.minY, POS_INNER.minY), maxY: Math.min(area.maxY, POS_INNER.maxY)
			};
			if (within.minX >= within.maxX || within.minY >= within.maxY) within = null;
		}
		const c = near ?? { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 };
		const box = boxOf(node);
		const span = within ?? area;
		const aspect = clamp((span.maxX - span.minX) / Math.max(1, span.maxY - span.minY), 0.5, 3);
		const inView = within
			? findFreeSpot(clamp(c.x, within.minX, within.maxX), clamp(c.y, within.minY, within.maxY), box, occupied, within, aspect)
			: null;
		return inView ?? spotFor(node, c.x, c.y, occupied);
	}

	// Place every un-positioned non-relation node from `nodes` into `merged`,
	// around (cx, cy) against the real boxes of everything already placed.
	// Used whenever SOME positions exist: running full ELK instead would produce
	// coordinates in a fresh frame unrelated to the stored one — merging those
	// drops new cards on top of existing ones. Returns the placed ids.
	function placeFree(merged: Map<string, Pt>, nodes: any[], cx: number, cy: number): string[] {
		const occupied = occupiedBoxes(merged);
		const placed: string[] = [];
		for (const node of nodes) {
			if (merged.has(node.naming_id) || node.mode === 'relation') continue;
			const spot = spotFor(node, cx, cy, occupied);
			merged.set(node.naming_id, spot);
			occupied.push({ ...spot, ...boxOf(node) });
			placed.push(node.naming_id);
		}
		return placed;
	}

	/** Liegt der eben angelegte Knoten außerhalb des freien Ausschnitts, dorthin schieben. */
	function reveal(ids: string[]) {
		const s = viewSize();
		if (!s || s.width <= 0 || s.height <= 0) return; // Listenansicht: nichts zu sehen
		const id = ids[0];
		const p = id ? positions.get(id) : undefined;
		const n = id ? ms.findNode(id) : undefined;
		if (!p || !n) return;
		const b = boxOf(n);
		const r = freeRect(0);
		const visible =
			p.x - b.width / 2 >= r.minX && p.x + b.width / 2 <= r.maxX &&
			p.y - b.height / 2 >= r.minY && p.y + b.height / 2 <= r.maxY;
		if (visible) return;
		const c = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
		viewport.x += c.x - p.x;
		viewport.y += c.y - p.y;
	}

	/** Ein Naming in den Blick holen (ohne umzuräumen) und kurz hervorheben.
	 *  Verschoben wird nur, wenn es nicht schon ganz in der freien Fläche steht —
	 *  sonst sprang die Karte bei jedem Zeigen, auch wenn alles zu sehen war.
	 *  'moved' = der Ausschnitt wurde verschoben, 'visible' = er blieb. */
	function focusOn(id: string): 'moved' | 'visible' | false {
		if (!isDrawable(id)) return false;
		const n = ms.findNode(id);
		const p = nodeCenter(id);
		const b = n?.mode === 'relation' ? relationBox(n) : boxOf(n);
		const r = freeRect(0);
		const visible =
			p.x - b.width / 2 >= r.minX && p.x + b.width / 2 <= r.maxX &&
			p.y - b.height / 2 >= r.minY && p.y + b.height / 2 <= r.maxY;
		ms.flash(id);
		if (visible) return 'visible';
		const c = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
		viewport.x += c.x - p.x;
		viewport.y += c.y - p.y;
		return 'moved';
	}

	// ─── Layout aufräumen ───
	// Das Ähnlichkeitslayout (Server) streut weit — bei wenigen Karten öffnete
	// die Karte danach bei rund einem Drittel — und kennt nur die Größe einer
	// Karte, nicht die einer Formation. Hier wird es dichter gesetzt, dem
	// Seitenverhältnis der Fläche angenähert und von Überlagerungen befreit.
	// Nachbarschaften bleiben Nachbarschaften: alles wird von der Mitte aus
	// gleichmäßig gestaucht, dann nur auseinandergeschoben, was sich überdeckt.

	function separate(items: Array<{ p: Pt; box: Box; formation: boolean }>, passes = 240) {
		for (let it = 0; it < passes; it++) {
			let moved = false;
			for (let i = 0; i < items.length; i++) {
				for (let j = i + 1; j < items.length; j++) {
					const A = items[i];
					const B = items[j];
					// Ein Element in einer Formation ist kein Überdecken, sondern Lage.
					if (A.formation !== B.formation) continue;
					const dx = B.p.x - A.p.x;
					const dy = B.p.y - A.p.y;
					const ox = (A.box.width + B.box.width) / 2 + GAP - Math.abs(dx);
					const oy = (A.box.height + B.box.height) / 2 + GAP - Math.abs(dy);
					if (ox <= 0 || oy <= 0) continue;
					moved = true;
					if (ox <= oy) {
						const dir = dx !== 0 ? Math.sign(dx) : (j % 2 ? 1 : -1);
						A.p.x -= (ox / 2) * dir;
						B.p.x += (ox / 2) * dir;
					} else {
						const dir = dy !== 0 ? Math.sign(dy) : (j % 2 ? 1 : -1);
						A.p.y -= (oy / 2) * dir;
						B.p.y += (oy / 2) * dir;
					}
				}
			}
			if (!moved) break;
		}
	}

	function tidyLayout(pos: Map<string, Pt>) {
		// Formationen dürfen sich überlagern und enthalten (das ist auf der
		// SW/A-Karte Aussage, nicht Unordnung); auseinandergeschoben wird bei
		// ihnen nur, was die Labels übereinanderlegen würde.
		const items: Array<{ id: string; p: Pt; box: Box; area: number; formation: boolean }> = [];
		for (const [id, p] of pos) {
			const n = ms.findNode(id);
			if (!n || n.mode === 'relation') continue;
			const full = boxOf(n);
			const f = formationOf(n);
			const box = f ? { width: Math.max(60, String(n.inscription ?? '').length * 8.6 + 24), height: 48 } : full;
			items.push({ id, p: { x: p.x, y: p.y }, box, area: (full.width + GAP) * (full.height + GAP), formation: !!f });
		}
		if (items.length < 2) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cx = 0, cy = 0;
		let cardArea = 0;
		for (const it of items) {
			minX = Math.min(minX, it.p.x); maxX = Math.max(maxX, it.p.x);
			minY = Math.min(minY, it.p.y); maxY = Math.max(maxY, it.p.y);
			cx += it.p.x; cy += it.p.y;
			cardArea += it.area;
		}
		cx /= items.length; cy /= items.length;
		const bw = Math.max(1, maxX - minX);
		const bh = Math.max(1, maxY - minY);
		// Etwa doppelt so viel Fläche wie Karten — nie weiter auseinander als zuvor.
		const s = clamp(Math.sqrt((2 * cardArea) / (bw * bh)), 0.3, 1);
		const view = viewPx();
		const fx = clamp(Math.sqrt((view.width / view.height) / (bw / bh)), 0.8, 1.25);
		for (const it of items) {
			it.p.x = cx + (it.p.x - cx) * s * fx;
			it.p.y = cy + (it.p.y - cy) * s / fx;
		}
		separate(items);
		for (const it of items) pos.set(it.id, { x: Math.round(it.p.x), y: Math.round(it.p.y) });
	}

	// ─── Init & layout ───

	function initIfNeeded(mapId?: string) {
		// Reset on map change (SvelteKit may reuse component across navigations)
		if (mapId && mapId !== currentMapId) {
			currentMapId = mapId;
			layoutInitialized = false;
			initDone = false;
			positions = new Map();
			centeredId = null;
			preRadialPositions = null;
		}
		if (layoutInitialized) return;
		const allNodes = [...ms.elements, ...ms.relations, ...ms.silences];
		if (allNodes.length === 0) return;
		layoutInitialized = true;
		initPositions(allNodes);
	}

	async function initPositions(allNodes: any[]) {
		const stored = new Map<string, { x: number; y: number }>();
		let needsLayout = false;
		let placed: string[] = [];
		for (const node of allNodes) {
			// Relationen brauchen keine eigene Position: ihre Raute steht an der Linie.
			if (node.mode === 'relation') continue;
			const x = node.properties?.x;
			const y = node.properties?.y;
			if (typeof x === 'number' && typeof y === 'number') {
				stored.set(node.naming_id, { x, y });
			} else if (ms.isPrimary) {
				// Primary map: an element without stored coordinates is
				// "unresolved" — it lives in the Halde until the researcher
				// situates it by hand. Auto-layouting (and persisting) it here
				// would make placement a machine act and silently undo every
				// "Return to Unplaced" on the next page load. layoutNewNodes
				// keeps the same exemption for nodes arriving after init.
			} else { needsLayout = true; }
		}
		// initDone auch, wenn das Speichern scheitert — sonst bliebe die Ladeanzeige stehen.
		try {
			if (needsLayout) {
				if (ms.mapType === 'positional') {
					// Positionen ohne Koordinaten kommen ins Diagramm, frei verteilt
					// um seine Mitte — nicht in den Ursprung über die Achsen.
					const merged = new Map(stored);
					placed = placeFree(merged, allNodes, POS_AXIS_LEN / 2, -POS_AXIS_LEN / 2);
					positions = merged;
					await saveAllPositions(merged);
				} else if (stored.size > 0) {
					// Mixed map: most nodes are placed, a few are new. Spiral-place
					// the new ones next to the existing layout (centroid anchor).
					// Do NOT run full ELK here: its coordinates live in a fresh
					// frame unrelated to the stored one — overlaying them drops new
					// cards on top of existing ones.
					const merged = new Map(stored);
					let cx = 0, cy = 0;
					for (const p of stored.values()) { cx += p.x; cy += p.y; }
					cx /= stored.size; cy /= stored.size;
					placed = placeFree(merged, allNodes, cx, cy);
					positions = merged;
					if (merged.size > stored.size) await saveAllPositions(merged);
				} else {
					try {
						// Fresh map: prefer the similarity layout so it opens as a
						// map, not a grid. Fall back to the geometric layout.
						const merged = new Map(stored);
						const sim = await computeSimilarityPositions();
						if (sim) {
							for (const [id, p] of sim) if (!merged.has(id)) merged.set(id, p);
						} else {
							const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
							for (const [id, p] of result.positions) {
								if (!merged.has(id) && ms.findNode(id)?.mode !== 'relation') merged.set(id, { x: p.x, y: p.y });
							}
						}
						tidyLayout(merged);
						positions = merged;
						placed = allNodes.filter((n: any) => n.mode !== 'relation' && merged.has(n.naming_id)).map((n: any) => n.naming_id);
						await saveAllPositions(merged);
					} catch (err) {
						console.warn('layout failed, using stored positions:', err);
						positions = stored;
					}
				}
			} else { positions = stored; }
		} finally {
			initDone = true;
		}
		// Der erste Knoten einer leeren Karte kommt hier an, nicht in layoutNewNodes.
		if (placed.length > 0 && ms.takeReveal()) reveal(placed);
	}

	async function layoutNewNodes() {
		// On primary SitMap, don't auto-position elements from the naming→map bridge.
		// They are "unresolved" — placement is a conscious analytical act.
		// Only auto-position elements that have stored x/y in properties (= previously placed).
		const unpositioned = [...ms.elements, ...ms.silences]
			.filter((n: any) => !positions.has(n.naming_id))
			.filter((n: any) => {
				if (!ms.isPrimary) return true;
				const px = n.properties?.x;
				const py = n.properties?.y;
				return typeof px === 'number' && typeof py === 'number';
			});
		if (unpositioned.length === 0) return;
		const merged = new Map(positions);
		// Previously placed nodes carry their position in properties.
		for (const node of unpositioned) {
			const px = node.properties?.x;
			const py = node.properties?.y;
			if (typeof px === 'number' && typeof py === 'number') {
				merged.set(node.naming_id, { x: px, y: py });
			}
		}
		const still = unpositioned.filter((n: any) => !merged.has(n.naming_id));
		let placed: string[] = [];
		if (still.length > 0) {
			if (merged.size > 0 || ms.mapType === 'positional') {
				// Something is already placed: place new nodes collision-free in
				// the visible part of the map, not under a panel (the positional
				// map: inside its diagram). Full ELK would compute an unrelated
				// coordinate frame — overlaying it piles cards up.
				const occupied = occupiedBoxes(merged);
				for (const node of still) {
					const spot = visibleSpotFor(node, occupied);
					merged.set(node.naming_id, spot);
					occupied.push({ ...spot, ...boxOf(node) });
					placed.push(node.naming_id);
				}
			} else {
				const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
				for (const [id, p] of result.positions) {
					if (!merged.has(id) && ms.findNode(id)?.mode !== 'relation') merged.set(id, { x: p.x, y: p.y });
				}
				placed = still.map((n: any) => n.naming_id).filter((id: string) => merged.has(id));
			}
		}
		positions = merged;
		if (placed.length > 0 && ms.takeReveal()) {
			reveal(placed);
			ms.flash(placed[0]);
		}
		await saveAllPositions(merged);
	}

	async function saveAllPositions(pos: Map<string, { x: number; y: number }>) {
		// While a radial center-on is active, `positions` holds a THROWAWAY layout
		// covering every node. Persisting it would silently overwrite the
		// researcher's real, hand-built coordinates for the whole map.
		// handleNodeDragEnd guards the same way (`if (!centeredId)`); the auto-place
		// path reaches here too, so it needs the same protection.
		if (centeredId) return;
		// Relationen nicht: ihre Lage ist die Raute an der Linie (labelAt).
		const arr = [...pos.entries()]
			.filter(([id]) => ms.findNode(id)?.mode !== 'relation')
			.map(([namingId, p]) => ({ namingId, x: p.x, y: p.y }));
		if (arr.length > 0) await ms.mapAction('updatePositions', { positions: arr });
	}

	function nodeCenter(namingId: string): Pt {
		// Eine Relation sitzt an ihrer Raute — auch als Endpunkt einer weiteren Relation.
		const n = ms.findNode(namingId);
		if (n?.mode === 'relation') {
			const d = diamondCenters.get(namingId);
			if (d) return d;
		}
		const pos = positions.get(namingId);
		return pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
	}

	// Bounding box of everything currently drawn, in canvas coordinates,
	// including each node's rendered extent (formations: their ellipse or
	// rectangle; relations: their diamond). Used to frame the map on open (and on
	// Reset) so the researcher lands on the content, never on empty space.
	function contentBounds(): Rect | null {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		const extend = (p: Pt, b: Box) => {
			// CanvasElement renders each node CENTERED on (x,y) via
			// translate(-50%,-50%), so a stored position is the node's CENTRE, not
			// its top-left. Treating it as top-left shifts the whole box by half a
			// card, which pushes the leftmost card off-screen once a fit is applied.
			minX = Math.min(minX, p.x - b.width / 2);
			minY = Math.min(minY, p.y - b.height / 2);
			maxX = Math.max(maxX, p.x + b.width / 2);
			maxY = Math.max(maxY, p.y + b.height / 2);
		};
		for (const [id, p] of positions) {
			const n = ms.findNode(id);
			// Entferntes und Ausgeblendetes zählt nicht.
			if (!n || n.mode === 'relation' || ms.isHiddenByFilter(n)) continue;
			extend(p, boxOf(n));
		}
		for (const [id, p] of diamondCenters) {
			const n = ms.findNode(id);
			if (!n || n.properties?.spatiallyDerived || ms.isHiddenByFilter(n)) continue;
			extend(p, relationBox(n));
		}
		return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
	}

	// ─── Radial center-on ───

	function onlyNodes(m: Map<string, Pt>): Map<string, Pt> {
		const out = new Map<string, Pt>();
		for (const [id, p] of m) if (ms.findNode(id)?.mode !== 'relation') out.set(id, p);
		return out;
	}

	function centerOn(id: string) {
		// Re-centering while already centered must keep the ORIGINAL layout as the
		// restore point. Overwriting it here would make uncenter() install the
		// previous radial throwaway as the real positions — which the next save
		// then persists over the researcher's hand-built map.
		if (!centeredId) preRadialPositions = new Map(positions);
		const newPositions = onlyNodes(computeRadialLayout(id, ms.elements as any, ms.relations as any, ms.silences as any));
		const c = viewportCenter();
		const adjusted = new Map<string, { x: number; y: number }>();
		for (const [nid, pos] of newPositions) {
			adjusted.set(nid, { x: pos.x + c.x, y: pos.y + c.y });
		}
		positions = adjusted;
		centeredId = id;
	}

	function uncenter() {
		if (preRadialPositions) { positions = preRadialPositions; preRadialPositions = null; }
		centeredId = null;
	}

	// ─── Spatial relation sync (SW/A maps) ───

	async function syncSpatialRelations() {
		if (ms.mapType !== 'social-worlds' || centeredId) return;
		if (spatialSyncPending) { spatialSyncQueued = true; return; }
		spatialSyncPending = true;
		try {
			const formations: Formation[] = [];
			const plainElements: Array<{ id: string; x: number; y: number }> = [];
			for (const el of ms.elements) {
				const pos = positions.get(el.naming_id);
				if (!pos) continue;
				if (el.sw_role) {
					formations.push({ id: el.naming_id, x: pos.x, y: pos.y, rx: el.properties?.rx || 150, ry: el.properties?.ry || 100, rotation: el.properties?.rotation || 0, swRole: el.sw_role });
				} else { plainElements.push({ id: el.naming_id, x: pos.x, y: pos.y }); }
			}
			if (formations.length === 0) return;
			const computed = computeSpatialRelations(plainElements, formations);
			const existingContains = new Map<string, string>();
			const existingOverlaps = new Map<string, string>();
			for (const rel of ms.relations) {
				if (!rel.properties?.spatiallyDerived || ms.isWithdrawn(rel.properties)) continue;
				if (rel.valence === 'contains' && rel.directed_from && rel.directed_to) {
					existingContains.set(`${rel.directed_from}:${rel.directed_to}`, rel.naming_id);
				} else if (rel.valence === 'overlaps') {
					const src = rel.part_source_id; const tgt = rel.part_target_id;
					if (src && tgt) existingOverlaps.set([src, tgt].sort().join(':'), rel.naming_id);
				}
			}
			const toAdd: Array<{ sourceId: string; targetId: string; valence: string; symmetric: boolean }> = [];
			const toRemove: string[] = [];
			const computedContains = new Set<string>();
			const computedOverlaps = new Set<string>();
			for (const { elementId, formationId } of computed.elementInFormation) {
				const key = `${formationId}:${elementId}`; computedContains.add(key);
				if (!existingContains.has(key)) toAdd.push({ sourceId: formationId, targetId: elementId, valence: 'contains', symmetric: false });
			}
			for (const { innerId, outerId } of computed.formationInFormation) {
				const key = `${outerId}:${innerId}`; computedContains.add(key);
				if (!existingContains.has(key)) toAdd.push({ sourceId: outerId, targetId: innerId, valence: 'contains', symmetric: false });
			}
			for (const { formationA, formationB } of computed.formationOverlaps) {
				const key = [formationA, formationB].sort().join(':'); computedOverlaps.add(key);
				if (!existingOverlaps.has(key)) toAdd.push({ sourceId: formationA, targetId: formationB, valence: 'overlaps', symmetric: true });
			}
			for (const [key, relId] of existingContains) { if (!computedContains.has(key)) toRemove.push(relId); }
			for (const [key, relId] of existingOverlaps) { if (!computedOverlaps.has(key)) toRemove.push(relId); }
			if (toAdd.length > 0 || toRemove.length > 0) {
				await ms.mapAction('syncSpatialRelations', { add: toAdd, remove: toRemove });
				await ms.reload();
			}
		} finally {
			spatialSyncPending = false;
			if (spatialSyncQueued) { spatialSyncQueued = false; syncSpatialRelations(); }
		}
	}

	// ─── Drag handler (clamps for positional maps) ───

	function handleNodeDragEnd(id: string, x: number, y: number) {
		if (ms.mapType === 'positional') {
			x = Math.max(10, Math.min(POS_AXIS_LEN - 10, x));
			y = Math.max(-POS_AXIS_LEN + 10, Math.min(-10, y));
		}
		positions = new Map(positions).set(id, { x, y });
		if (!centeredId) ms.mapAction('updatePosition', { namingId: id, x, y }).then(() => syncSpatialRelations());
	}

	/**
	 * Eine Raute wurde gezogen: ihre Lage zur Linie an der Erscheinung der
	 * Relation auf dieser Karte speichern (Map-Aktion updateProperties,
	 * properties.labelAt). Gespeichert wird relativ zur Linie, damit die Raute
	 * mitwandert, wenn ihre Endpunkte bewegt werden. Ein Positionswechsel der
	 * Beschriftung ist kein Akt — wie das Verschieben einer Karte.
	 */
	function handleRelationDragEnd(id: string, x: number, y: number) {
		if (centeredId) return; // die Radialansicht ist eine Wegwerf-Anordnung
		const rel = ms.findNode(id);
		if (!rel || rel.mode !== 'relation') return;
		const [s, t] = ms.endpointsOf(rel);
		if (!s || !t || !isDrawable(s) || !isDrawable(t)) return;
		const labelAt = pointToLabelAt(nodeCenter(s), nodeCenter(t), { x, y });
		rel.properties = { ...(rel.properties ?? {}), labelAt };
		void ms.mapAction('updateProperties', { namingId: id, properties: { labelAt } }).then((res) => {
			if (!res) ms.showError('Label position not saved');
		});
	}

	/** Die Raute wieder selbst ausweichen lassen (gespeicherte Lage verwerfen). */
	function resetRelationLabel(id: string) {
		const rel = ms.findNode(id);
		if (!rel || !labelAtOf(rel)) return;
		rel.properties = { ...(rel.properties ?? {}), labelAt: null };
		void ms.mapAction('updateProperties', { namingId: id, properties: { labelAt: null } });
	}

	/** Endpunkte einer Relation, die (noch) nicht auf dieser Karte stehen können. */
	function missingEndpoints(rel: any, depth = 0): boolean {
		if (depth > 4) return true;
		const [s, t] = ms.endpointsOf(rel);
		return [s, t].some((id) => {
			const n = id ? ms.findNode(id) : null;
			if (!n) return true;
			return n.mode === 'relation' ? missingEndpoints(n, depth + 1) : false;
		});
	}

	/**
	 * Aus dem Unplaced-Panel auf den Canvas holen (Knopf oder Ablegen). Ein
	 * Naming kommt an die Ablagestelle bzw. auf einen freien Platz im sichtbaren
	 * Teil der Karte — nicht unter ein Panel. Eine Relation steht, sobald ihre
	 * Endpunkte stehen — also werden deren unplatzierte Endpunkte gesetzt, die
	 * Quelle links, das Ziel rechts. Geschrieben wird wie beim Ziehen über
	 * updatePosition. Gibt die gesetzten Namings zurück.
	 */
	function placeUnplaced(node: any, at?: Pt, depth = 0): string[] {
		if (!node || depth > 4) return [];
		const placed: string[] = [];
		if (node.mode !== 'relation') {
			if (positions.has(node.naming_id)) return [];
			const p = at ?? visibleSpotFor(node, occupiedBoxes(positions));
			handleNodeDragEnd(node.naming_id, p.x, p.y);
			placed.push(node.naming_id);
		} else {
			const base = at ?? freeCenter();
			const [s, t] = ms.endpointsOf(node);
			for (const [id, side] of [[s, -1], [t, 1]] as const) {
				const end = id ? ms.findNode(id) : null;
				if (!end || isDrawable(end.naming_id)) continue;
				const anchor = { x: base.x + side * 170, y: base.y };
				if (end.mode === 'relation') { placed.push(...placeUnplaced(end, anchor, depth + 1)); continue; }
				const p = at ? spotFor(end, anchor.x, anchor.y, occupiedBoxes(positions)) : visibleSpotFor(end, occupiedBoxes(positions), anchor);
				handleNodeDragEnd(end.naming_id, p.x, p.y);
				placed.push(end.naming_id);
			}
		}
		if (depth === 0 && placed.length > 0) {
			// Abgelegt: es liegt, wo es losgelassen wurde, und die Ansicht bleibt.
			// Nur der Knopf „place" holt den Platz in den Blick.
			if (!at) reveal(placed);
			ms.flash(node.mode === 'relation' ? node.naming_id : placed[0]);
		}
		return placed;
	}

	// Un-situate: drop a placed naming back to the Halde. Revising a placement is a
	// human act on a derivative projection — no naming_act.
	//
	// The ORDER here is load-bearing. The auto-place $effect above reads
	// `positions`, so the instant we drop the entry Svelte flushes that effect on
	// the next microtask — long before any await below resolves. If the node still
	// carried its stale in-memory properties.x/y at that moment, layoutNewNodes'
	// primary-map exemption would re-admit it, put it straight back, and
	// saveAllPositions would POST the very coordinates we just deleted back into the
	// database — making this a silent no-op. So: clear the server first, strip the
	// in-memory coordinates, and only then drop the local position, holding
	// `placing` across the whole operation as a second line of defence.
	async function unsituate(id: string) {
		if (!positions.has(id)) return;
		// Radial center-on replaces `positions` with a throwaway layout; un-situating
		// out of it would persist that layout over the real one. Refuse, exactly as
		// handleNodeDragEnd refuses to write while centered.
		if (centeredId) return;
		placing = true;
		try {
			// mapAction returns null on a non-OK response (e.g. a read-only map).
			// Bail before touching local state so the UI never claims a clear that
			// the database refused.
			const res = await ms.mapAction('clearPosition', { namingId: id });
			if (!res) return;
			const node = ms.findNode(id);
			if (node?.properties) {
				delete node.properties.x;
				delete node.properties.y;
			}
			const next = new Map(positions);
			next.delete(id);
			positions = next;
			preRadialPositions?.delete(id);
			await ms.reload();
		} finally {
			placing = false;
		}
	}

	// ─── Topology ───

	function positionsToObj(): Record<string, { x: number; y: number }> {
		// While a radial center-on is active, `positions` holds the throwaway
		// projection. Every consumer (topology buffer, snapshots, the
		// beforeunload beacon) means the researcher's real layout — capturing the
		// radial one would let it come back as truth via a later restore.
		const src = centeredId && preRadialPositions ? preRadialPositions : positions;
		const obj: Record<string, { x: number; y: number }> = {};
		for (const [id, pos] of src) {
			if (ms.findNode(id)?.mode === 'relation') continue;
			obj[id] = { x: pos.x, y: pos.y };
		}
		return obj;
	}

	async function saveTopologyBuffer() {
		if (positions.size === 0) return;
		await ms.mapAction('saveTopologyBuffer', { positions: positionsToObj() });
	}

	/** Die jetzige Lage als Snapshot sichern; true, wenn er gespeichert ist.
	 *  Den Namen gibt das Feld im Snapshot-Panel bzw. der Aufrufer (Layout,
	 *  Restore) — kein Browser-Dialog. */
	async function saveTopologySnapshot(label: string): Promise<boolean> {
		const res = await ms.mapRequest('saveTopologySnapshot', { label: label.trim() || undefined, positions: positionsToObj() });
		return res.ok;
	}

	/** Snapshot zurückholen. Vorher wird die jetzige Lage gesichert („Before
	 *  restore — …"), wie vor dem Layout; `backup` nennt diese Sicherung. */
	async function restoreTopologySnapshot(seq: number): Promise<{ ok: boolean; backup: string | null }> {
		let backup: string | null = null;
		if (positions.size > 0) {
			backup = `Before restore — ${formatWhen(new Date())}`;
			if (!(await saveTopologySnapshot(backup))) {
				ms.showError('Not restored — the current layout could not be saved as a snapshot first.');
				return { ok: false, backup: null };
			}
		}
		const result = await ms.mapAction('restoreTopologySnapshot', { seq });
		if (!result?.positions) { ms.showError('Restore failed'); return { ok: false, backup }; }
		centeredId = null;
		preRadialPositions = null;
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, pos] of Object.entries(result.positions as Record<string, { x: number; y: number }>)) {
			const n = ms.findNode(id);
			if (!n || n.mode === 'relation') continue;
			newPos.set(id, { x: pos.x, y: pos.y });
		}
		for (const [id, pos] of positions) { if (!newPos.has(id)) newPos.set(id, pos); }
		positions = newPos;
		// SW/A: was aus der Lage folgt (enthält, überschneidet), folgt der
		// wiederhergestellten Lage — wie nach jedem Verschieben.
		await syncSpatialRelations();
		return { ok: true, backup };
	}

	async function loadTopoSnapshots(): Promise<any[]> {
		const res = await ms.mapAction('listTopologySnapshots');
		return res?.snapshots || [];
	}

	// ─── Auto-layout ───

	// Similarity layout (server-side, embedding → MDS): nearness = semantic
	// nearness, so the map reads as a map, not a grid. Returns null on any
	// failure so callers fall back to the geometric layout.
	async function computeSimilarityPositions(): Promise<Map<string, { x: number; y: number }> | null> {
		// mapRequest: scheitert es, übernimmt still das geometrische Layout —
		// keine Fehlermeldung, die stehen bliebe.
		const res = await ms.mapRequest('similarityLayout');
		if (!res.ok || !res.data?.positions) return null;
		const m = new Map<string, { x: number; y: number }>();
		for (const [id, p] of Object.entries(res.data.positions as Record<string, { x: number; y: number }>)) {
			m.set(id, { x: p.x, y: p.y });
		}
		return m.size ? m : null;
	}

	async function runAutoLayout() {
		// Layout overwrites every position. Snapshot the current state first
		// with an auto-label so the user can revert from the Snapshots panel.
		if (positions.size > 0 && !(await saveTopologySnapshot(`Before Layout — ${formatWhen(new Date())}`))) {
			ms.showError('Layout not run — the current layout could not be saved as a snapshot first.');
			return false;
		}
		if (preRadialPositions) positions = preRadialPositions;
		centeredId = null; preRadialPositions = null;
		let computed = await computeSimilarityPositions();
		if (!computed) {
			const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
			computed = new Map<string, { x: number; y: number }>();
			for (const [id, p] of result.positions) computed.set(id, { x: p.x, y: p.y });
		}
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, p] of computed) {
			const n = ms.findNode(id);
			if (!n || n.mode === 'relation') continue;
			// Primary map: nur, was schon steht. Das Unplatzierte wartet in der
			// Halde, bis die Forscherin es selbst setzt — das Layout setzt es nicht.
			if (ms.isPrimary && !positions.has(id)) continue;
			newPos.set(id, p);
		}
		// Was das Layout nicht kennt, bleibt, wo es war.
		for (const [id, p] of positions) if (!newPos.has(id)) newPos.set(id, p);
		tidyLayout(newPos);
		positions = newPos;
		await saveAllPositions(newPos);
		await syncSpatialRelations();
		return true;
	}

	// ─── Formation resize/rotate (SW/A maps, needs spatial sync) ───

	async function handleFormationResize(namingId: string, newRx: number, newRy: number) {
		await ms.mapAction('updateProperties', { namingId, properties: { rx: newRx, ry: newRy } });
		await ms.reload(); syncSpatialRelations();
	}

	async function handleFormationRotate(namingId: string, newRotation: number) {
		await ms.mapAction('updateProperties', { namingId, properties: { rotation: newRotation } });
		await ms.reload(); syncSpatialRelations();
	}

	return {
		POS_AXIS_LEN,

		// Position data
		get positions() { return positions; },
		/** Positionen stehen (oder die Karte ist leer). */
		get ready() { return initDone || ms.elements.length + ms.relations.length + ms.silences.length === 0; },
		nodeCenter,
		nodeExtent,
		isDrawable,
		isLabelPinned,
		contentBounds,
		viewportCenter,
		missingEndpoints,
		placeUnplaced,
		focusOn,

		// Center-on
		get centeredId() { return centeredId; },
		get centeredConnections() { return centeredConnections; },
		centerOn,
		uncenter,

		// Layout
		initIfNeeded,
		layoutNewNodes,
		runAutoLayout,
		handleNodeDragEnd,
		handleRelationDragEnd,
		resetRelationLabel,
		unsituate,

		// Formation operations (SW/A)
		handleFormationResize,
		handleFormationRotate,

		// Topology
		saveTopologyBuffer,
		saveTopologySnapshot,
		restoreTopologySnapshot,
		loadTopoSnapshots,
		positionsToObj,
	};
}
