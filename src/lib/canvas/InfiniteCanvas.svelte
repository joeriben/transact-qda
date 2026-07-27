<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createViewport } from './viewport.svelte.js';

	let {
		viewport = createViewport(),
		oncanvasclick,
		oncanvascontextmenu,
		oncanvasdrop,
		onreset,
		children
	}: {
		viewport?: ReturnType<typeof createViewport>;
		oncanvasclick?: (x: number, y: number) => void;
		oncanvascontextmenu?: (e: MouseEvent) => void;
		/** Fired when something is dropped on the canvas. Domain-agnostic: the
		 *  raw DragEvent (caller reads whatever MIME it wants) plus the drop point
		 *  already converted to canvas coordinates. */
		oncanvasdrop?: (e: DragEvent, x: number, y: number) => void;
		onreset?: () => void;
		children: Snippet;
	} = $props();

	let containerEl: HTMLDivElement;
	let isPanning = $state(false);
	let isDropTarget = $state(false);
	let lastPointer = { x: 0, y: 0 };

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey || e.altKey) {
			// Trackpad pinch and ctrl+wheel fire MANY wheel events per gesture; a
			// fixed step per event compounds to runaway zoom (0.9^n). Scale the step
			// by the actual delta, clamped, so total zoom tracks the real gesture.
			const dy = Math.max(-60, Math.min(60, e.deltaY));
			const factor = Math.exp(-dy * 0.0025);
			const rect = containerEl.getBoundingClientRect();
			viewport.zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
		} else {
			viewport.pan(-e.deltaX, -e.deltaY);
		}
	}

	// Must register as non-passive to allow preventDefault() on wheel events
	$effect(() => {
		if (!containerEl) return;
		containerEl.addEventListener('wheel', onWheel, { passive: false });
		return () => containerEl.removeEventListener('wheel', onWheel);
	});

	function onPointerDown(e: PointerEvent) {
		if (e.button === 1 || (e.button === 0 && e.altKey)) {
			isPanning = true;
			lastPointer = { x: e.clientX, y: e.clientY };
			containerEl.setPointerCapture(e.pointerId);
			e.preventDefault();
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!isPanning) return;
		const dx = e.clientX - lastPointer.x;
		const dy = e.clientY - lastPointer.y;
		lastPointer = { x: e.clientX, y: e.clientY };
		viewport.pan(dx, dy);
	}

	function onPointerUp(e: PointerEvent) {
		if (isPanning) {
			isPanning = false;
			containerEl.releasePointerCapture(e.pointerId);
		}
	}

	function onClick(e: MouseEvent) {
		if (e.target === containerEl || (e.target as HTMLElement).classList.contains('canvas-layer')) {
			const rect = containerEl.getBoundingClientRect();
			const pos = viewport.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
			oncanvasclick?.(pos.x, pos.y);
		}
	}

	function onContextMenu(e: MouseEvent) {
		if (e.target === containerEl || (e.target as HTMLElement).classList.contains('canvas-layer')) {
			e.preventDefault();
			oncanvascontextmenu?.(e);
		}
	}

	// ─── Drag-and-drop onto the canvas (situate an unplaced naming) ───
	// dragover must preventDefault or the drop never fires.
	function onDragOver(e: DragEvent) {
		if (!oncanvasdrop) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		isDropTarget = true;
	}

	function onDragLeave(e: DragEvent) {
		// dragleave also fires when the pointer moves onto a DESCENDANT (a card, the
		// zoom HUD). Only clear when it genuinely left the container — relatedTarget
		// is null when the drag leaves the window entirely.
		if (!containerEl.contains(e.relatedTarget as Node | null)) isDropTarget = false;
	}

	// A cancelled drag (Escape, or releasing outside a drop target) never reaches
	// onDrop, so the highlight would stay on indefinitely. dragend fires on the drag
	// SOURCE and bubbles to the window, so clear from there as well.
	$effect(() => {
		function clearHighlight() { isDropTarget = false; }
		window.addEventListener('dragend', clearHighlight);
		window.addEventListener('drop', clearHighlight);
		return () => {
			window.removeEventListener('dragend', clearHighlight);
			window.removeEventListener('drop', clearHighlight);
		};
	});

	function onDrop(e: DragEvent) {
		isDropTarget = false;
		if (!oncanvasdrop) return;
		e.preventDefault();
		const rect = containerEl.getBoundingClientRect();
		const pos = viewport.screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
		oncanvasdrop(e, pos.x, pos.y);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="infinite-canvas"
	class:drop-target={isDropTarget}
	bind:this={containerEl}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onclick={onClick}
	oncontextmenu={onContextMenu}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	style="cursor: {isPanning ? 'grabbing' : 'default'}"
>
	<div
		class="canvas-layer"
		style="transform: scale({viewport.zoom}) translate({viewport.x}px, {viewport.y}px); transform-origin: 0 0;"
	>
		{@render children()}
	</div>

	<div class="canvas-hud">
		<button onclick={() => viewport.zoomAt(0.8, containerEl.clientWidth / 2, containerEl.clientHeight / 2)}>−</button>
		<span class="zoom-label">{Math.round(viewport.zoom * 100)}%</span>
		<button onclick={() => viewport.zoomAt(1.25, containerEl.clientWidth / 2, containerEl.clientHeight / 2)}>+</button>
		<button onclick={() => { if (onreset) onreset(); else viewport.reset(); }}>Reset</button>
	</div>
</div>

<style>
	.infinite-canvas {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0d0f16;
		background-image:
			radial-gradient(circle, #1a1d2e 1px, transparent 1px);
		background-size: 20px 20px;
	}

	/* Dragging an unplaced naming over the canvas: signal it is droppable. */
	.infinite-canvas.drop-target {
		outline: 2px dashed #8b9cf7;
		outline-offset: -2px;
		background-color: #121528;
	}

	.canvas-layer {
		position: absolute;
		top: 0;
		left: 0;
		/* No will-change/compositing hint here: it pins the layer to a bitmap
		   rasterised at 1× and GPU-upscales it on zoom-in, which shreds the text.
		   Without it the browser re-rasterises the DOM crisply at every zoom. */
		transform-origin: 0 0;
	}

	.canvas-hud {
		position: absolute;
		bottom: 0.75rem;
		right: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(22, 24, 34, 0.9);
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.3rem 0.6rem;
	}

	.zoom-label {
		font-size: 0.75rem;
		color: #6b7280;
		min-width: 3rem;
		text-align: center;
	}

	.canvas-hud button {
		background: none;
		border: 1px solid #2a2d3a;
		color: #8b8fa3;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		cursor: pointer;
	}
	.canvas-hud button:hover {
		background: #1e2030;
		color: #e1e4e8;
	}
</style>
