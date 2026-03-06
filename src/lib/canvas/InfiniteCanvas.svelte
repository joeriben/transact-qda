<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createViewport } from './viewport.svelte.js';

	let {
		viewport = createViewport(),
		oncanvasclick,
		children
	}: {
		viewport?: ReturnType<typeof createViewport>;
		oncanvasclick?: (x: number, y: number) => void;
		children: Snippet;
	} = $props();

	let containerEl: HTMLDivElement;
	let isPanning = $state(false);
	let lastPointer = { x: 0, y: 0 };

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const factor = e.deltaY > 0 ? 0.9 : 1.1;
			const rect = containerEl.getBoundingClientRect();
			viewport.zoomAt(factor, (e.clientX - rect.left) / viewport.zoom, (e.clientY - rect.top) / viewport.zoom);
		} else {
			viewport.pan(-e.deltaX, -e.deltaY);
		}
	}

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="infinite-canvas"
	bind:this={containerEl}
	onwheel={onWheel}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onclick={onClick}
	style="cursor: {isPanning ? 'grabbing' : 'default'}"
>
	<div
		class="canvas-layer"
		style="transform: scale({viewport.zoom}) translate({viewport.x}px, {viewport.y}px); transform-origin: 0 0;"
	>
		{@render children()}
	</div>

	<div class="canvas-hud">
		<span class="zoom-label">{Math.round(viewport.zoom * 100)}%</span>
		<button onclick={() => viewport.reset()}>Reset</button>
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
