<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		id,
		x = 0,
		y = 0,
		label = '',
		color = '#8b9cf7',
		selected = false,
		kind = 'entity',
		zoom = 1,
		draggable = true,
		passThrough = false,
		ondragmove,
		ondragend,
		onclick,
		ondblclick,
		oncontextmenu,
		children
	}: {
		id: string;
		x?: number;
		y?: number;
		label?: string;
		color?: string;
		selected?: boolean;
		kind?: string;
		zoom?: number;
		draggable?: boolean;
		/** Nur die Teile des Inhalts, die selbst Zeigerereignisse annehmen, sind
		 *  greifbar (Formationen: Label und Umriss). Der umgebende Kasten fängt
		 *  nichts ab — sonst griffe man bei überlappenden Formationen die obere,
		 *  obwohl das Label der unteren unter dem Zeiger liegt. */
		passThrough?: boolean;
		/** Während des Ziehens, mit der aktuellen Lage (z. B. damit eine Linie mitgeht). */
		ondragmove?: (id: string, x: number, y: number) => void;
		ondragend?: (id: string, x: number, y: number) => void;
		onclick?: (id: string, e: MouseEvent) => void;
		ondblclick?: (id: string, e: MouseEvent) => void;
		oncontextmenu?: (id: string, e: MouseEvent) => void;
		children?: Snippet;
	} = $props();

	let isDragging = $state(false);
	let didDrag = $state(false);
	let dragStart = { x: 0, y: 0 };
	let downAt = { x: 0, y: 0 };
	/** Erst ab so viel Bewegung (Bildschirmpixel) ist es ein Ziehen: ein
	 *  Doppelklick mit leichtem Zittern verschob sonst den Knoten (bei einer
	 *  Raute: setzte ihre Lage fest) und öffnete den Stack nicht. */
	const DRAG_SLOP = 3;
	let currentX = $state(x);
	let currentY = $state(y);

	$effect(() => {
		if (!isDragging) {
			currentX = x;
			currentY = y;
		}
	});

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 || e.altKey) return;
		if (!draggable) return;
		if ((e.target as Element).closest('.handle, .inline-rename')) return;
		e.stopPropagation();
		isDragging = true;
		didDrag = false;
		dragStart = { x: e.clientX, y: e.clientY };
		downAt = { x: e.clientX, y: e.clientY };
		// Bei passThrough nimmt der Kasten selbst keine Zeigerereignisse an; dann
		// hält das gegriffene Teil den Zeiger, die Ereignisse steigen zu uns auf.
		const captureEl = passThrough
			? (e.target as Element)
			: (e.target as HTMLElement).closest('.canvas-element');
		captureEl?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		if (!didDrag && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < DRAG_SLOP) return;
		// Divide screen-space delta by zoom to get canvas-space delta
		const dx = (e.clientX - dragStart.x) / zoom;
		const dy = (e.clientY - dragStart.y) / zoom;
		dragStart = { x: e.clientX, y: e.clientY };
		currentX += dx;
		currentY += dy;
		didDrag = true;
		ondragmove?.(id, currentX, currentY);
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		if (didDrag) {
			ondragend?.(id, currentX, currentY);
		}
	}

	function handleClick(e: MouseEvent) {
		if (!didDrag) onclick?.(id, e);
	}

	function handleDblClick(e: MouseEvent) {
		// Ein Doppelklick auf eine Karte in Bearbeitung (Umbenennen) gehört dem
		// Textfeld, nicht dem Panel.
		if ((e.target as Element).closest('.inline-rename')) return;
		if (didDrag) return;
		e.stopPropagation();
		ondblclick?.(id, e);
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		oncontextmenu?.(id, e);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="canvas-element"
	class:selected
	class:pass-through={passThrough}
	class:dragging={isDragging}
	style="left: {currentX}px; top: {currentY}px; transform: translate(-50%, -50%); --el-color: {color};"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onclick={handleClick}
	ondblclick={handleDblClick}
	oncontextmenu={handleContextMenu}
>
	{#if children}
		{@render children()}
	{:else}
		<div class="element-body">
			<span class="element-kind">{kind}</span>
			<span class="element-label">{label}</span>
		</div>
	{/if}
</div>

<style>
	.canvas-element {
		position: absolute;
		user-select: none;
		cursor: grab;
		touch-action: none;
	}

	.canvas-element.dragging {
		cursor: grabbing;
		z-index: 100;
	}

	.canvas-element.pass-through {
		pointer-events: none;
	}

	/* Die überfahrene Karte nach vorn, sonst verdecken spätere Nachbarn ihren
	   Hover-Kasten. */
	.canvas-element:hover {
		z-index: 60;
	}
	/* Formationen nicht: eine überfahrene große Formation käme sonst über die
	   kleineren in ihr, und die ließen sich nicht mehr greifen. Sie bleiben in
	   ihrer Zeichenreihenfolge (große unten, kleine oben). */
	.canvas-element.pass-through:hover {
		z-index: auto;
	}

	.element-body {
		background: #161822;
		border: 2px solid var(--el-color, #8b9cf7);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		min-width: 80px;
		max-width: 200px;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.selected .element-body {
		box-shadow: 0 0 0 2px var(--el-color, #8b9cf7);
	}

	.element-kind {
		font-size: 0.6rem;
		color: var(--el-color, #8b9cf7);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.element-label {
		font-size: 0.85rem;
		color: #e1e4e8;
		word-break: break-word;
	}
</style>
