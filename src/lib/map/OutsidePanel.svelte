<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	const ms = getMapState();
</script>

{#if ms.outsideId}
	<div class="outside-panel">
		<div class="outside-header">
			<span class="outside-title">Outside this perspective</span>
			<button class="btn-link" onclick={() => { ms.outsideId = null; ms.outsideData = null; }}>close</button>
		</div>
		{#if ms.outsideLoading}
			<span class="outside-loading">loading...</span>
		{:else if ms.outsideData && ms.outsideData.length > 0}
			{#each ms.outsideData as op}
				<div class="outside-entry">
					<span class="designation-dot-sm" style="background: {ms.designationColor(op.outside_designation)}"></span>
					<span class="outside-inscription">{op.outside_inscription}</span>
					{#if op.relation_inscription}
						<span class="outside-via">via "{op.relation_inscription}"</span>
					{/if}
					{#if op.outside_appearance_count > 0}
						<span class="outside-maps" title="Appears on {op.outside_appearance_count} map(s)">{op.outside_appearance_count} map(s)</span>
					{/if}
					<button class="btn-xs btn-pull" onclick={() => ms.pullOntoMap(op.outside_naming_id)} title="Place on this map">pull</button>
				</div>
			{/each}
		{:else}
			<span class="outside-empty">No outside participations</span>
		{/if}
	</div>
{/if}

<style>
	.outside-panel {
		background: #12141e; border: 1px solid #3a3520; border-radius: 6px;
		padding: 0.5rem 0.75rem; margin-top: -0.1rem; margin-bottom: 0.2rem;
	}
	.outside-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; }
	.outside-title { font-size: 0.7rem; color: #e8a54b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
	.outside-loading { font-size: 0.75rem; color: #888; }
	.outside-empty { font-size: 0.75rem; color: #666; }
	.outside-entry {
		display: flex; align-items: center; gap: 6px;
		padding: 0.2rem 0; font-size: 0.8rem; border-top: 1px solid #1e2030;
	}
	.outside-entry:first-of-type { border-top: none; }
	.outside-inscription { color: #e0e0e0; }
	.outside-via { color: #888; font-size: 0.7rem; font-style: italic; }
	.outside-maps { color: #666; font-size: 0.65rem; }
	.btn-pull {
		margin-left: auto; color: #e8a54b; background: rgba(232, 165, 75, 0.1);
		border: 1px solid rgba(232, 165, 75, 0.2); padding: 1px 6px;
	}
	.btn-pull:hover { background: rgba(232, 165, 75, 0.2); }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
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
