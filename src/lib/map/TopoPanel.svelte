<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	let {
		snapshots,
		onclose,
		onsave,
		onrestore,
	}: {
		snapshots: any[];
		onclose: () => void;
		onsave: () => void;
		onrestore: (seq: number) => void;
	} = $props();

	const ms = getMapState();
</script>

<div class="topo-panel">
	<div class="topo-header">
		<span>Topology Snapshots</span>
		<button class="btn-primary btn-sm-primary" onclick={onsave}>Save</button>
		<button class="btn-link" onclick={onclose}>close</button>
	</div>
	{#if snapshots.length === 0}
		<span class="topo-empty">No snapshots yet</span>
	{:else}
		{#each snapshots as snap}
			<div class="topo-entry">
				<span class="topo-label">{snap.label || `#${snap.seq}`}</span>
				<span class="topo-meta">{snap.node_count} nodes · {new Date(snap.created_at).toLocaleString()}</span>
				<button class="btn-xs" onclick={() => onrestore(snap.seq)}>restore</button>
			</div>
		{/each}
	{/if}
</div>

<style>
	.topo-panel {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.6rem 0.8rem; margin: 0 1rem 0.5rem;
		max-height: 200px; overflow-y: auto;
	}
	.topo-header {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.8rem; color: #c9cdd5; margin-bottom: 0.4rem;
	}
	.topo-header span:first-child { flex: 1; }
	.topo-empty { font-size: 0.75rem; color: #4b5563; }
	.topo-entry {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.25rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.78rem;
	}
	.topo-entry:last-child { border-bottom: none; }
	.topo-label { color: #f59e0b; flex: 1; }
	.topo-meta { color: #4b5563; font-size: 0.7rem; }
	.btn-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px; padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-sm-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
