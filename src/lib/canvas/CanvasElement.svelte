<script lang="ts">
	let {
		id,
		x = 0,
		y = 0,
		label = '',
		color = '#8b9cf7',
		selected = false,
		kind = 'entity',
		ondragend,
		onclick
	}: {
		id: string;
		x?: number;
		y?: number;
		label?: string;
		color?: string;
		selected?: boolean;
		kind?: string;
		ondragend?: (id: string, x: number, y: number) => void;
		onclick?: (id: string, e: MouseEvent) => void;
	} = $props();

	let isDragging = $state(false);
	let dragOffset = { x: 0, y: 0 };
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
		e.stopPropagation();
		isDragging = true;
		dragOffset = { x: e.clientX - currentX, y: e.clientY - currentY };
		(e.target as HTMLElement).closest('.canvas-element')?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isDragging) return;
		currentX = e.clientX - dragOffset.x;
		currentY = e.clientY - dragOffset.y;
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		ondragend?.(id, currentX, currentY);
	}

	function handleClick(e: MouseEvent) {
		if (!isDragging) onclick?.(id, e);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="canvas-element"
	class:selected
	class:dragging={isDragging}
	style="left: {currentX}px; top: {currentY}px; --el-color: {color};"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onclick={handleClick}
>
	<div class="element-body">
		<span class="element-kind">{kind}</span>
		<span class="element-label">{label}</span>
	</div>
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
