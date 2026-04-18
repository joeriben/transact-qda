<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createViewport } from './viewport.svelte.js';

	let {
		viewport = createViewport(),
		contentBounds = null,
		oncanvasclick,
		oncanvascontextmenu,
		onreset,
		children
	}: {
		viewport?: ReturnType<typeof createViewport>;
		contentBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
		oncanvasclick?: (x: number, y: number) => void;
		oncanvascontextmenu?: (e: MouseEvent) => void;
		onreset?: () => void;
		children: Snippet;
	} = $props();

	let containerEl: HTMLDivElement;
	let isPanning = $state(false);
	let lastPointer = { x: 0, y: 0 };

	function constrainViewport() {
		if (!containerEl || !contentBounds) return;

		const viewW = containerEl.clientWidth / viewport.zoom;
		const viewH = containerEl.clientHeight / viewport.zoom;
		if (viewW <= 0 || viewH <= 0) return;

		// Keep some screen-space breathing room around content, but never let the
		// viewport drift completely into empty space.
		const paddingX = 80 / viewport.zoom;
		const paddingY = 80 / viewport.zoom;
		const minX = contentBounds.minX - paddingX;
		const maxX = contentBounds.maxX + paddingX;
		const minY = contentBounds.minY - paddingY;
		const maxY = contentBounds.maxY + paddingY;
		const contentW = maxX - minX;
		const contentH = maxY - minY;
		const contentCx = (minX + maxX) / 2;
		const contentCy = (minY + maxY) / 2;

		if (contentW <= viewW) {
			viewport.x = (viewW / 2) - contentCx;
		} else {
			const minVisibleX = Math.min(contentW, Math.max(viewW * 0.2, 180 / viewport.zoom));
			const minAllowedX = -(maxX - minVisibleX);
			const maxAllowedX = viewW - (minX + minVisibleX);
			viewport.x = Math.min(maxAllowedX, Math.max(minAllowedX, viewport.x));
		}

		if (contentH <= viewH) {
			viewport.y = (viewH / 2) - contentCy;
		} else {
			const minVisibleY = Math.min(contentH, Math.max(viewH * 0.2, 180 / viewport.zoom));
			const minAllowedY = -(maxY - minVisibleY);
			const maxAllowedY = viewH - (minY + minVisibleY);
			viewport.y = Math.min(maxAllowedY, Math.max(minAllowedY, viewport.y));
		}
	}

	function onWheel(e: WheelEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey) {
			e.preventDefault();
			const factor = e.deltaY > 0 ? 0.9 : 1.1;
			const rect = containerEl.getBoundingClientRect();
			viewport.zoomAt(factor, (e.clientX - rect.left) / viewport.zoom, (e.clientY - rect.top) / viewport.zoom);
			constrainViewport();
		} else {
			e.preventDefault();
			viewport.pan(-e.deltaX, -e.deltaY);
			constrainViewport();
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
		constrainViewport();
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

	$effect(() => {
		if (!containerEl || !contentBounds) return;
		contentBounds.minX;
		contentBounds.minY;
		contentBounds.maxX;
		contentBounds.maxY;
		viewport.zoom;
		requestAnimationFrame(constrainViewport);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="infinite-canvas"
	bind:this={containerEl}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onclick={onClick}
	oncontextmenu={onContextMenu}
	style="cursor: {isPanning ? 'grabbing' : 'default'}"
>
	<div
		class="canvas-layer"
		style="transform: scale({viewport.zoom}) translate({viewport.x}px, {viewport.y}px); transform-origin: 0 0;"
	>
		{@render children()}
	</div>

	<div class="canvas-hud">
		<button onclick={() => { viewport.zoomAt(0.8, containerEl.clientWidth / 2 / viewport.zoom, containerEl.clientHeight / 2 / viewport.zoom); constrainViewport(); }}>−</button>
		<span class="zoom-label">{Math.round(viewport.zoom * 100)}%</span>
		<button onclick={() => { viewport.zoomAt(1.25, containerEl.clientWidth / 2 / viewport.zoom, containerEl.clientHeight / 2 / viewport.zoom); constrainViewport(); }}>+</button>
		<button onclick={() => { if (onreset) onreset(); else viewport.reset(); constrainViewport(); }}>Reset</button>
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

	.canvas-layer {
		position: absolute;
		top: 0;
		left: 0;
		will-change: transform;
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
