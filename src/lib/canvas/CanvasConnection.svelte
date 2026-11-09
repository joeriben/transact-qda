<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { connectionControl, insideExtent, type NodeExtent } from './geometry.js';

	let {
		x1 = 0,
		y1 = 0,
		x2 = 0,
		y2 = 0,
		srcExtent = null,
		tgtExtent = null,
		label = '',
		color = '#4b5563',
		selected = false,
		directed = false,
		isMeta = false,
		opacity = 1,
		via = null,
		onclick
	}: {
		x1?: number;
		y1?: number;
		x2?: number;
		y2?: number;
		/** Ausdehnung der Endknoten: die Linie endet an ihrem Rand, nicht unter
		 *  der Karte — sonst läge die Pfeilspitze verdeckt in der Zielkarte. */
		srcExtent?: NodeExtent | null;
		tgtExtent?: NodeExtent | null;
		label?: string;
		color?: string;
		selected?: boolean;
		directed?: boolean;
		isMeta?: boolean;
		opacity?: number;
		/** Eine von Hand gesetzte Beschriftung: die Linie knickt durch diesen
		 *  Punkt, statt als Kurve an ihr vorbeizulaufen. */
		via?: { x: number; y: number } | null;
		onclick?: () => void;
	} = $props();

	// Leicht gebogene Kurve zwischen den Mittelpunkten. Gezeichnet wird nur das
	// Stück zwischen den Knotenrändern — ein Teilstück derselben Kurve, damit
	// ihre Mitte (dort sitzt das Relations-Label) auf der Linie bleibt.
	const ctrl = $derived(connectionControl(x1, y1, x2, y2));

	function at(t: number) {
		if (via) {
			// Zwei Strecken: Quelle → Knickpunkt (t ≤ 0,5), Knickpunkt → Ziel.
			if (t <= 0.5) {
				const k = t * 2;
				return { x: x1 + (via.x - x1) * k, y: y1 + (via.y - y1) * k };
			}
			const k = (t - 0.5) * 2;
			return { x: via.x + (x2 - via.x) * k, y: via.y + (y2 - via.y) * k };
		}
		const u = 1 - t;
		return {
			x: u * u * x1 + 2 * u * t * ctrl.x + t * t * x2,
			y: u * u * y1 + 2 * u * t * ctrl.y + t * t * y2
		};
	}

	// Parameter, an dem die Kurve den Knoten verlässt (Bisektion von `from`,
	// im Knoten, nach `to`). Überlappen sich die Knoten, wird nicht gekürzt.
	function exitParam(ext: NodeExtent | null, nx: number, ny: number, from: number, to: number): number {
		if (!ext) return from;
		const inside = (t: number) => {
			const p = at(t);
			return insideExtent(ext, p.x - nx, p.y - ny, 3);
		};
		if (!inside(from) || inside(to)) return from;
		let a = from;
		let b = to;
		for (let i = 0; i < 18; i++) {
			const m = (a + b) / 2;
			if (inside(m)) a = m;
			else b = m;
		}
		return b;
	}

	const t0 = $derived(exitParam(srcExtent, x1, y1, 0, 0.5));
	const t1 = $derived(exitParam(tgtExtent, x2, y2, 1, 0.5));
	const start = $derived(at(t0));
	const end = $derived(at(t1));
	// Kontrollpunkt des Teilstücks [t0, t1] (Polarform der quadratischen Kurve).
	const sub = $derived.by(() => {
		const a = 1 - t0;
		const b = 1 - t1;
		const k = a * t1 + t0 * b;
		return {
			x: a * b * x1 + k * ctrl.x + t0 * t1 * x2,
			y: a * b * y1 + k * ctrl.y + t0 * t1 * y2
		};
	});

	const pathD = $derived(
		via
			? `M ${start.x} ${start.y} L ${via.x} ${via.y} L ${end.x} ${end.y}`
			: `M ${start.x} ${start.y} Q ${sub.x} ${sub.y} ${end.x} ${end.y}`
	);
	const mid = $derived(via ?? at(0.5));

	// Arrowhead: point at the end of the curve, oriented along the last segment
	const arrowAngle = $derived(
		via ? Math.atan2(end.y - via.y, end.x - via.x) : Math.atan2(end.y - sub.y, end.x - sub.x)
	);
	const arrowSize = 9;
	const a1x = $derived(end.x - arrowSize * Math.cos(arrowAngle - 0.4));
	const a1y = $derived(end.y - arrowSize * Math.sin(arrowAngle - 0.4));
	const a2x = $derived(end.x - arrowSize * Math.cos(arrowAngle + 0.4));
	const a2y = $derived(end.y - arrowSize * Math.sin(arrowAngle + 0.4));
</script>

<!-- Die Canvas-Ebene ist absolut positioniert und hat selbst keine Größe; ein
     SVG mit width/height 100 % wäre darin 0×0 groß und würde gar nicht
     gezeichnet. 1×1 mit overflow:visible zeichnet die Linie überall. -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<svg class="canvas-connection" width="1" height="1" style="position:absolute; top:0; left:0; width:1px; height:1px; pointer-events:none; overflow:visible; opacity: {opacity};">
	<!-- Ohne Klick-Handler fängt die Linie keine Zeiger ab: Ziehen über ihr
	     verschiebt die Ansicht wie auf leerer Fläche. -->
	<path
		d={pathD}
		fill="none"
		stroke={color}
		stroke-width={selected ? 3 : 1.5}
		stroke-dasharray={isMeta ? '6 3' : 'none'}
		style="pointer-events: {onclick ? 'stroke' : 'none'}; cursor: {onclick ? 'pointer' : 'default'};"
		onclick={onclick}
	/>

	{#if directed}
		<polygon
			points="{end.x},{end.y} {a1x},{a1y} {a2x},{a2y}"
			fill={color}
		/>
	{/if}

	{#if label}
		<text
			x={mid.x}
			y={mid.y - 8}
			text-anchor="middle"
			fill="#8b8fa3"
			font-size="11"
			style="pointer-events: none;"
		>{label}</text>
	{/if}

	{#if isMeta}
		<polygon
			points="{mid.x},{mid.y - 6} {mid.x + 6},{mid.y} {mid.x},{mid.y + 6} {mid.x - 6},{mid.y}"
			fill={color}
			stroke="#0f1117"
			stroke-width="1"
		/>
	{/if}
</svg>
