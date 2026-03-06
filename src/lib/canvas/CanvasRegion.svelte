<script lang="ts">
	let {
		x = 0,
		y = 0,
		rx = 150,
		ry = 100,
		label = '',
		color = '#3b4568',
		selected = false
	}: {
		x?: number;
		y?: number;
		rx?: number;
		ry?: number;
		label?: string;
		color?: string;
		selected?: boolean;
	} = $props();
</script>

<svg class="canvas-region" style="position:absolute; top:0; left:0; overflow:visible; pointer-events:none;">
	<ellipse
		cx={x}
		cy={y}
		rx={rx}
		ry={ry}
		fill="{color}22"
		stroke={color}
		stroke-width={selected ? 2.5 : 1.5}
		stroke-dasharray="5 3"
		style="pointer-events: fill; cursor: pointer;"
	/>
	<text
		x={x}
		y={y - ry + 18}
		text-anchor="middle"
		fill={color}
		font-size="13"
		font-weight="600"
		style="pointer-events: none;"
	>{label}</text>
</svg>
