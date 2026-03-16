<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	const ms = getMapState();
</script>

{#if ms.memoPanel}
	<div class="memo-panel">
		<div class="memo-panel-header">
			<span class="memo-panel-author">AI</span>
			<span class="memo-panel-title">{ms.memoPanel.title}</span>
			<button class="btn-link" onclick={ms.dismissMemoPanel}>dismiss</button>
		</div>
		<div class="memo-panel-content">{ms.memoPanel.content}</div>
		{#if ms.memoPanel.linkedIds.length > 0}
			<div class="memo-panel-links">
				{#each ms.memoPanel.linkedIds as lid}
					{@const linkedNode = ms.findNode(lid)}
					{#if linkedNode}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="memo-panel-chip" onclick={() => ms.showStack(lid)}>
							{linkedNode.inscription}
						</span>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.memo-panel {
		position: fixed; bottom: 1.5rem; right: 240px; z-index: 110;
		width: 400px; max-height: 340px;
		background: #1a1d2e; border: 1px solid #3a3d5a; border-radius: 10px;
		padding: 0.8rem 1rem;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
		overflow-y: auto;
	}
	.memo-panel-header {
		display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;
	}
	.memo-panel-author {
		font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.15); color: #8b9cf7;
		padding: 0.1rem 0.4rem; border-radius: 3px;
	}
	.memo-panel-title {
		font-size: 0.85rem; font-weight: 600; color: #e1e4e8; flex: 1;
	}
	.memo-panel-content {
		font-size: 0.8rem; color: #c9cdd5; line-height: 1.5;
		white-space: pre-wrap;
	}
	.memo-panel-links {
		display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.5rem;
	}
	.memo-panel-chip {
		font-size: 0.7rem; color: #8b9cf7;
		background: rgba(139, 156, 247, 0.1); border: 1px solid rgba(139, 156, 247, 0.2);
		padding: 0.15rem 0.5rem; border-radius: 4px; cursor: pointer;
	}
	.memo-panel-chip:hover { background: rgba(139, 156, 247, 0.2); }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
