<script lang="ts">
	import type { SwRole } from '$lib/shared/types/index.js';
	import { SW_ROLE_STYLES } from '$lib/shared/constants.js';

	let {
		label = '',
		swRole = 'social-world' as SwRole,
		designation = 'cue',
		color = '#8b9cf7',
		rx = 150,
		ry = 100,
		selected = false,
	}: {
		label?: string;
		swRole?: SwRole;
		designation?: string;
		color?: string;
		rx?: number;
		ry?: number;
		selected?: boolean;
	} = $props();

	const style = $derived(SW_ROLE_STYLES[swRole] || SW_ROLE_STYLES['social-world']);
	const isRect = $derived(style.shape === 'rect');

	// SVG viewBox with padding for stroke
	const pad = 4;
	const svgW = $derived(rx * 2 + pad * 2);
	const svgH = $derived(ry * 2 + pad * 2);
	const cx = $derived(rx + pad);
	const cy = $derived(ry + pad);

	// Designation label abbreviation
	const desigLabel = $derived(
		designation === 'cue' ? 'C' :
		designation === 'characterization' ? 'Ch' :
		designation === 'specification' ? 'Sp' : '?'
	);

	// Discourse fill: use the color with reduced opacity
	const fillColor = $derived(style.fillOpacity > 0 ? color : 'transparent');
	const fillOp = $derived(style.fillOpacity);
</script>

<div class="formation-node" class:selected>
	<svg width={svgW} height={svgH} viewBox="0 0 {svgW} {svgH}" style="overflow: visible;">
		{#if isRect}
			<rect
				x={pad} y={pad}
				width={rx * 2} height={ry * 2}
				rx="6" ry="6"
				fill={fillColor}
				fill-opacity={fillOp}
				stroke={color}
				stroke-width={selected ? 2.5 : 1.5}
				stroke-dasharray={style.dashArray}
			/>
		{:else}
			<ellipse
				cx={cx} cy={cy}
				rx={rx} ry={ry}
				fill={fillColor}
				fill-opacity={fillOp}
				stroke={color}
				stroke-width={selected ? 2.5 : 1.5}
				stroke-dasharray={style.dashArray}
			/>
		{/if}

		<!-- Role label (top) -->
		<text
			x={cx} y={pad + 18}
			text-anchor="middle"
			fill={color}
			font-size="11"
			font-weight="500"
			opacity="0.7"
			style="pointer-events: none; text-transform: uppercase; letter-spacing: 0.05em;"
		>{swRole}</text>

		<!-- Main label (center) -->
		<text
			x={cx} y={cy + 5}
			text-anchor="middle"
			fill="#e1e4e8"
			font-size="14"
			font-weight="600"
			style="pointer-events: none;"
		>{label}</text>

		<!-- Designation badge (bottom) -->
		<text
			x={cx} y={ry * 2 + pad - 8}
			text-anchor="middle"
			fill={color}
			font-size="10"
			font-weight="500"
			opacity="0.6"
			style="pointer-events: none;"
		>{desigLabel}</text>
	</svg>
</div>

<style>
	.formation-node {
		cursor: grab;
	}

	.formation-node.selected :global(ellipse),
	.formation-node.selected :global(rect) {
		filter: drop-shadow(0 0 6px currentColor);
	}
</style>
