<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	const ms = getMapState();
</script>

{#if ms.memoCreateOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="memo-create-backdrop" onclick={() => ms.cancelMemoCreate()}></div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="memo-create-form" onclick={(e) => e.stopPropagation()}>
		<div class="mcf-header">
			<span class="mcf-title">Write Memo</span>
			<button class="btn-link" onclick={() => ms.cancelMemoCreate()}>cancel</button>
		</div>
		{#if ms.memoCreateLinkedIds.length > 0}
			<div class="mcf-linked">
				<span class="mcf-linked-label">Linked to:</span>
				{#each ms.memoCreateLinkedIds as lid}
					<span class="mcf-chip">
						{ms.findInscription(lid)}
						<button class="mcf-chip-remove" onclick={() => { ms.memoCreateLinkedIds = ms.memoCreateLinkedIds.filter(id => id !== lid); }}>×</button>
					</span>
				{/each}
			</div>
		{/if}
		<form onsubmit={(e) => { e.preventDefault(); ms.createMapMemo(); }}>
			<input
				type="text"
				class="mcf-input"
				placeholder="Memo title..."
				bind:value={ms.memoCreateTitle}
			/>
			<textarea
				class="mcf-textarea"
				placeholder="Content (optional)..."
				bind:value={ms.memoCreateContent}
				rows="3"
			></textarea>
			<div class="mcf-actions">
				<button type="submit" class="btn-primary" disabled={!ms.memoCreateTitle.trim()}>Create</button>
				<button type="button" class="btn-sm" onclick={() => ms.cancelMemoCreate()}>Cancel</button>
			</div>
		</form>
	</div>
{/if}

<style>
	.memo-create-backdrop {
		position: fixed; inset: 0; z-index: 90; background: rgba(0, 0, 0, 0.3);
	}
	.memo-create-form {
		position: fixed; bottom: 4rem; left: 50%; transform: translateX(-50%);
		z-index: 100; width: 420px; max-width: calc(100vw - 2rem);
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 10px;
		padding: 1rem; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}
	.mcf-header {
		display: flex; align-items: center; justify-content: space-between;
		margin-bottom: 0.6rem;
	}
	.mcf-title { font-size: 0.9rem; font-weight: 600; color: #e1e4e8; }
	.mcf-linked {
		display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.mcf-linked-label { font-size: 0.7rem; color: #6b7280; }
	.mcf-chip {
		display: inline-flex; align-items: center; gap: 0.2rem;
		font-size: 0.72rem; color: #c9cdd5; background: #161822;
		border: 1px solid #2a2d3a; border-radius: 4px; padding: 0.1rem 0.4rem;
	}
	.mcf-chip-remove {
		background: none; border: none; color: #6b7280; cursor: pointer;
		font-size: 0.8rem; padding: 0; line-height: 1;
	}
	.mcf-chip-remove:hover { color: #e1e4e8; }
	.mcf-input {
		width: 100%; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.45rem 0.6rem; color: #e1e4e8; font-size: 0.85rem;
		margin-bottom: 0.4rem;
	}
	.mcf-input:focus { outline: none; border-color: #8b9cf7; }
	.mcf-textarea {
		width: 100%; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.45rem 0.6rem; color: #e1e4e8; font-size: 0.85rem;
		font-family: inherit; resize: vertical; margin-bottom: 0.4rem;
	}
	.mcf-textarea:focus { outline: none; border-color: #8b9cf7; }
	.mcf-actions { display: flex; gap: 0.4rem; }
	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }
	.btn-sm {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.3rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
