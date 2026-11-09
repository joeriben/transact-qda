<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { SwRole } from '$lib/shared/types/index.js';
	import { SW_ROLE_STYLES } from '$lib/shared/constants.js';
	import { plural } from '$lib/shared/plural.js';

	let {
		label = '',
		swRole = 'social-world' as SwRole,
		designation = 'cue',
		color = '#8b9cf7',
		rx: rxProp = 150,
		ry: ryProp = 100,
		rotation: rotationProp = 0,
		selected = false,
		withdrawn = false,
		highlighted = false,
		zoom = 1,
		memoCount = 0,
		phaseColors = [],
		phaseHighlight = null,
		phaseColor = null,
		flash = false,
		onresizeend,
		onrotateend,
		onlabelhover,
		onmemoclick,
	}: {
		label?: string;
		swRole?: SwRole;
		designation?: string;
		color?: string;
		rx?: number;
		ry?: number;
		rotation?: number;
		selected?: boolean;
		withdrawn?: boolean;
		/** Ausgangspunkt einer Relation, die gerade gezogen wird. */
		highlighted?: boolean;
		zoom?: number;
		memoCount?: number;
		/** Farben der Phasen, zu denen die Formation gehört (Punkte am Label). */
		phaseColors?: string[];
		/** Eine Phase ist angewählt: gehört die Formation dazu oder tritt sie zurück? */
		phaseHighlight?: 'member' | 'dimmed' | null;
		phaseColor?: string | null;
		/** Kurz hervorheben (eben platziert oder gesucht). */
		flash?: boolean;
		onresizeend?: (rx: number, ry: number) => void;
		onrotateend?: (rotation: number) => void;
		/** Zeiger über dem Label (Rechteck auf dem Bildschirm) bzw. weg davon (null). */
		onlabelhover?: (rect: DOMRect | null) => void;
		onmemoclick?: () => void;
	} = $props();

	const style = $derived(SW_ROLE_STYLES[swRole] || SW_ROLE_STYLES['social-world']);
	const isRect = $derived(style.shape === 'rect');

	// Local mutable state for interactive dragging
	let localRx = $state(rxProp);
	let localRy = $state(ryProp);
	let localRotation = $state(rotationProp);
	let isResizing = $state(false);
	let isRotating = $state(false);

	// Sync props → local state when not interacting
	$effect(() => { if (!isResizing) localRx = rxProp; });
	$effect(() => { if (!isResizing) localRy = ryProp; });
	$effect(() => { if (!isRotating) localRotation = rotationProp; });

	// SVG viewBox with padding for stroke + handles
	const pad = 10;
	const rotStemLen = 30;
	const topExtra = $derived(selected ? rotStemLen + 14 : 0);
	const svgW = $derived(localRx * 2 + pad * 2);
	const svgH = $derived(localRy * 2 + pad * 2 + topExtra);
	const cx = $derived(localRx + pad);
	const cy = $derived(localRy + pad + topExtra);

	// Designation label abbreviation
	const desigLabel = $derived(
		designation === 'cue' ? 'C' :
		designation === 'characterization' ? 'Ch' :
		designation === 'specification' ? 'Sp' : '?'
	);

	const fillColor = $derived(style.fillOpacity > 0 ? color : 'transparent');
	const fillOp = $derived(style.fillOpacity);
	// Ausgangspunkt einer Relation: eigene Farbe, nicht das Bernstein der Charakterisierung.
	const strokeColor = $derived(highlighted ? '#38bdf8' : color);

	// Das Label einer großen Arena steht oben, nicht in der Mitte: dort liegt
	// meist, was die Arena enthält, und beide Labels lägen übereinander.
	const labelY = $derived(swRole === 'arena' && localRy >= 70 ? cy - localRy + 44 : cy + 5);
	// Greiffläche um das Label (Textbreite geschätzt).
	const labelHitW = $derived(Math.max(60, label.length * 8.6 + 24));

	// Greifen: Soziale Welt, Organisation und Diskurs über die ganze Fläche.
	// Die Arena nicht — sie umfasst meist die ganze Karte, und auf ihrer Fläche
	// verschiebt man die Ansicht; sie greift man an ihrem Rand (ein Band, das
	// beim Überfahren sichtbar wird, auf dem Bildschirm etwa 20 px breit) oder
	// am Label.
	const wholeArea = $derived(swRole !== 'arena');
	const edgeWidth = $derived(Math.min(80, Math.max(14, 20 / Math.max(zoom, 0.05))));

	// Custom rotation cursor (SVG data URI)
	const rotateCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E") 12 12, crosshair`;

	// --- Svelte action: attach native pointerdown to SVG elements (bypasses Svelte 5 delegation) ---
	function resizeHandle(node: SVGElement, dir: 'e' | 'w' | 's' | 'n') {
		function handler(e: PointerEvent) {
			e.stopPropagation();
			e.stopImmediatePropagation();
			e.preventDefault();
			isResizing = true;
			resizeDirection = dir;
			resizeStart = { clientX: e.clientX, clientY: e.clientY, rx: localRx, ry: localRy };
			window.addEventListener('pointermove', onResizeMove);
			window.addEventListener('pointerup', onResizeUp);
		}
		node.addEventListener('pointerdown', handler, { capture: true });
		return { destroy() { node.removeEventListener('pointerdown', handler, { capture: true }); } };
	}

	function rotateHandle(node: SVGElement) {
		function handler(e: PointerEvent) {
			e.stopPropagation();
			e.stopImmediatePropagation();
			e.preventDefault();
			isRotating = true;
			rotStartRotation = localRotation;
			const rect = svgEl.getBoundingClientRect();
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + topExtra * zoom / 2 + (rect.height - topExtra * zoom) / 2;
			rotStartAngle = Math.atan2(e.clientX - centerX, -(e.clientY - centerY)) * 180 / Math.PI;
			document.body.style.cursor = rotateCursor;
			window.addEventListener('pointermove', onRotateMove);
			window.addEventListener('pointerup', onRotateUp);
		}
		node.addEventListener('pointerdown', handler, { capture: true });
		return { destroy() { node.removeEventListener('pointerdown', handler, { capture: true }); } };
	}

	// --- Resize logic ---
	let resizeStart = { clientX: 0, clientY: 0, rx: 0, ry: 0 };
	let resizeDirection: 'e' | 'w' | 's' | 'n' = 'e';

	function onResizeMove(e: PointerEvent) {
		const dxScreen = (e.clientX - resizeStart.clientX) / zoom;
		const dyScreen = (e.clientY - resizeStart.clientY) / zoom;

		const rad = -localRotation * Math.PI / 180;
		const dxLocal = dxScreen * Math.cos(rad) - dyScreen * Math.sin(rad);
		const dyLocal = dxScreen * Math.sin(rad) + dyScreen * Math.cos(rad);

		const aspect = resizeStart.rx / resizeStart.ry;

		if (resizeDirection === 'e') {
			localRx = Math.max(40, resizeStart.rx + dxLocal);
			if (e.shiftKey) localRy = Math.max(30, localRx / aspect);
		} else if (resizeDirection === 'w') {
			localRx = Math.max(40, resizeStart.rx - dxLocal);
			if (e.shiftKey) localRy = Math.max(30, localRx / aspect);
		} else if (resizeDirection === 's') {
			localRy = Math.max(30, resizeStart.ry + dyLocal);
			if (e.shiftKey) localRx = Math.max(40, localRy * aspect);
		} else {
			localRy = Math.max(30, resizeStart.ry - dyLocal);
			if (e.shiftKey) localRx = Math.max(40, localRy * aspect);
		}
	}

	function onResizeUp() {
		isResizing = false;
		window.removeEventListener('pointermove', onResizeMove);
		window.removeEventListener('pointerup', onResizeUp);
		onresizeend?.(Math.round(localRx), Math.round(localRy));
	}

	// --- Rotation logic ---
	let svgEl: SVGSVGElement;
	let rotStartAngle = 0;
	let rotStartRotation = 0;

	function onRotateMove(e: PointerEvent) {
		const rect = svgEl.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + topExtra * zoom / 2 + (rect.height - topExtra * zoom) / 2;
		const currentAngle = Math.atan2(e.clientX - centerX, -(e.clientY - centerY)) * 180 / Math.PI;
		let newRotation = rotStartRotation + (currentAngle - rotStartAngle);
		if (e.shiftKey) {
			newRotation = Math.round(newRotation / 15) * 15;
		}
		localRotation = newRotation;
	}

	function onRotateUp() {
		isRotating = false;
		document.body.style.cursor = '';
		window.removeEventListener('pointermove', onRotateMove);
		window.removeEventListener('pointerup', onRotateUp);
		onrotateend?.(Math.round(localRotation * 10) / 10);
	}
</script>

<!-- Greifbar sind nur Label und Umriss (siehe CanvasElement passThrough): das
     Innere einer Formation ist leere Fläche, auf der man die Ansicht verschiebt
     und in der andere Formationen liegen dürfen. -->
<div class="formation-node" class:selected class:withdrawn class:highlighted
	class:phase-member={phaseHighlight === 'member'} class:phase-dimmed={phaseHighlight === 'dimmed'} class:flash
	style="margin-top: -{topExtra}px; --phase-color: {phaseColor ?? '#8b9cf7'};">
	<svg bind:this={svgEl} width={svgW} height={svgH} viewBox="0 0 {svgW} {svgH}" style="overflow: visible;">
		<g transform="rotate({localRotation}, {cx}, {cy})">
			{#if isRect}
				<rect
					x={pad} y={pad + topExtra}
					width={localRx * 2} height={localRy * 2}
					rx="6" ry="6"
					fill={fillColor}
					fill-opacity={fillOp}
					stroke={strokeColor}
					stroke-opacity={highlighted ? 1 : style.strokeOpacity}
					stroke-width={selected || highlighted ? 2.5 : 1.5}
					stroke-dasharray={style.dashArray}
					style="pointer-events: none;"
				/>
				<rect
					class="grip"
					class:grip-fill={wholeArea}
					class:grip-edge={!wholeArea}
					x={pad} y={pad + topExtra}
					width={localRx * 2} height={localRy * 2}
					rx="6" ry="6"
					fill="transparent" stroke="transparent" stroke-width={wholeArea ? 14 : edgeWidth}
				/>
			{:else}
				<ellipse
					cx={cx} cy={cy}
					rx={localRx} ry={localRy}
					fill={fillColor}
					fill-opacity={fillOp}
					stroke={strokeColor}
					stroke-opacity={highlighted ? 1 : style.strokeOpacity}
					stroke-width={selected || highlighted ? 2.5 : 1.5}
					stroke-dasharray={style.dashArray}
					style="pointer-events: none;"
				/>
				<ellipse
					class="grip"
					class:grip-fill={wholeArea}
					class:grip-edge={!wholeArea}
					cx={cx} cy={cy}
					rx={localRx} ry={localRy}
					fill="transparent" stroke="transparent" stroke-width={wholeArea ? 14 : edgeWidth}
				/>
			{/if}

			<!-- Role label (top) -->
			<text
				class="grip-label"
				x={cx} y={cy - localRy + 22}
				text-anchor="middle"
				fill={color}
				font-size="11"
				font-weight="500"
				opacity="0.7"
				style="text-transform: uppercase; letter-spacing: 0.05em;"
			>{swRole}</text>

			<!-- Main label: Greiffläche + Text -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<rect
				class="grip-area"
				x={cx - labelHitW / 2} y={labelY - 17}
				width={labelHitW} height="24"
				fill="transparent"
				onmouseenter={(e) => onlabelhover?.((e.currentTarget as SVGRectElement).getBoundingClientRect())}
				onmouseleave={() => onlabelhover?.(null)}
			/>
			<!-- Phasen wie an den Karten: ein Punkt je Phase, rechts vom Label -->
			{#each phaseColors as pc, i}
				<circle
					cx={cx + labelHitW / 2 + 4 + i * 9} cy={labelY - 5}
					r="3.5" fill={pc}
					style="pointer-events: none;"
				/>
			{/each}
			<text
				class="grip-label"
				x={cx} y={labelY}
				text-anchor="middle"
				fill="#e1e4e8"
				font-size="14"
				font-weight="600"
			>{label}</text>

			<!-- Designation badge (bottom) -->
			<text
				x={cx} y={cy + localRy - 10}
				text-anchor="middle"
				fill={color}
				font-size="10"
				font-weight="500"
				opacity="0.6"
				style="pointer-events: none;"
			>{desigLabel}</text>

			<!-- Memo count badge (top-right); Klick öffnet den Stack -->
			{#if memoCount > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<circle
					class="memo-badge"
					cx={cx + localRx - 8} cy={cy - localRy + 8}
					r="10"
					fill="rgba(245, 158, 11, 0.2)"
					stroke="#f59e0b"
					stroke-width="1"
					style="pointer-events: {onmemoclick ? 'all' : 'none'}; cursor: pointer;"
					onpointerdown={(e) => { if (onmemoclick) e.stopPropagation(); }}
					onclick={(e) => { if (!onmemoclick) return; e.stopPropagation(); onmemoclick(); }}
				><title>{plural(memoCount, 'memo')} — open stack</title></circle>
				<text
					x={cx + localRx - 8} y={cy - localRy + 12}
					text-anchor="middle"
					fill="#f59e0b"
					font-size="10"
					font-weight="700"
					style="pointer-events: none;"
				>{memoCount}</text>
			{/if}

			<!-- Handles (only when selected) -->
			{#if selected}
				<!-- Resize: East -->
				<circle
					cx={cx + localRx} cy={cy} r="6"
					class="handle resize-handle"
					style="cursor: ew-resize;"
					use:resizeHandle={'e'}
				/>
				<!-- Resize: West -->
				<circle
					cx={cx - localRx} cy={cy} r="6"
					class="handle resize-handle"
					style="cursor: ew-resize;"
					use:resizeHandle={'w'}
				/>
				<!-- Resize: South -->
				<circle
					cx={cx} cy={cy + localRy} r="6"
					class="handle resize-handle"
					style="cursor: ns-resize;"
					use:resizeHandle={'s'}
				/>
				<!-- Resize: North -->
				<circle
					cx={cx} cy={cy - localRy} r="6"
					class="handle resize-handle"
					style="cursor: ns-resize;"
					use:resizeHandle={'n'}
				/>

				<!-- Rotation: stem + handle -->
				<line
					x1={cx} y1={cy - localRy}
					x2={cx} y2={cy - localRy - rotStemLen}
					stroke={color}
					stroke-width="1.5"
					opacity="0.5"
					style="pointer-events: none;"
				/>
				<!-- Invisible larger hit area -->
				<circle
					cx={cx} cy={cy - localRy - rotStemLen}
					r="14"
					fill="transparent"
					stroke="none"
					class="handle"
					style="cursor: {rotateCursor};"
					use:rotateHandle
				/>
				<!-- Visible rotation handle -->
				<circle
					cx={cx} cy={cy - localRy - rotStemLen}
					r="7"
					class="rotate-handle"
					style="pointer-events: none;"
				/>
			{/if}
		</g>
	</svg>
</div>

<style>
	.formation-node {
		cursor: grab;
		pointer-events: none;
	}
	.formation-node svg {
		pointer-events: none;
	}
	.formation-node .grip {
		pointer-events: stroke;
	}
	/* Ganze Fläche greifbar (Welt, Organisation, Diskurs). */
	.formation-node .grip.grip-fill {
		pointer-events: visible;
	}
	/* Arena: der Rand als sichtbares Griffband beim Überfahren. */
	.formation-node .grip.grip-edge:hover {
		stroke: rgba(139, 156, 247, 0.16);
	}
	.formation-node .grip-area,
	.formation-node .grip-label,
	.formation-node .handle {
		pointer-events: all;
	}

	.formation-node.withdrawn {
		opacity: 0.3;
	}

	/* Phase angewählt: Mitglieder leuchten in ihrer Farbe, die übrigen treten
	   zurück — wie die Karten auf der Situationskarte. */
	.formation-node.phase-dimmed {
		opacity: 0.3;
		transition: opacity 0.3s;
	}
	.formation-node.phase-member :global(ellipse:not(.grip)),
	.formation-node.phase-member :global(rect:not(.grip):not(.grip-area)) {
		filter: drop-shadow(0 0 5px var(--phase-color)) drop-shadow(0 0 2px var(--phase-color));
	}
	.formation-node.flash :global(ellipse:not(.grip)),
	.formation-node.flash :global(rect:not(.grip):not(.grip-area)) {
		animation: formation-flash 0.8s ease-in-out 3;
	}
	@keyframes formation-flash {
		0%, 100% { filter: none; }
		50% { filter: drop-shadow(0 0 8px #8b9cf7) drop-shadow(0 0 3px #8b9cf7); }
	}

	.formation-node.selected :global(ellipse),
	.formation-node.selected :global(rect),
	.formation-node.highlighted :global(ellipse),
	.formation-node.highlighted :global(rect) {
		filter: drop-shadow(0 0 6px currentColor);
	}

	.handle {
		fill: #1a1c2e;
		stroke-width: 2;
		touch-action: none;
	}

	.resize-handle {
		stroke: #8b9cf7;
	}

	.resize-handle:hover {
		fill: #2a2c4e;
	}

	.rotate-handle {
		stroke: #f7a08b;
		fill: #1a1c2e;
	}

	.rotate-handle:hover {
		fill: #2a2c4e;
	}
</style>
