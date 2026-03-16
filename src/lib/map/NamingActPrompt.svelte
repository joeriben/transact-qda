<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	const ms = getMapState();
</script>

{#if ms.actTarget}
	{@const actNode = ms.findNode(ms.actTarget)}
	{@const allMapNamings = [...ms.elements, ...ms.relations].filter((e: any) => e.naming_id !== ms.actTarget)}
	<div class="act-prompt-bar">
		<div class="act-header">
			{#if ms.actType === 'rename'}
				Rename: <strong>{actNode?.inscription}</strong> → <strong>{ms.actNewValue}</strong>
			{:else if ms.actType === 'designate'}
				Designation: <strong>{actNode?.inscription}</strong> →
				<span style="color: {ms.designationColor(ms.actNewValue)}">{ms.actNewValue}</span>
			{:else if ms.actType === 'relate'}
				Relation: <strong>{actNode?.inscription || ms.actNewValue || '(unnamed)'}</strong>
			{/if}
		</div>
		{#if ms.actExistingMemos.length > 0}
			<div class="act-existing-memos">
				<span class="act-existing-label">Previous memos ({ms.actExistingMemos.length}):</span>
				{#each ms.actExistingMemos as memo}
					<div class="act-existing-memo">
						<span class="act-memo-label">{memo.label}</span>
						{#if memo.content}<span class="act-memo-content">{memo.content}</span>{/if}
					</div>
				{/each}
			</div>
		{/if}
		<textarea placeholder="What influenced this act? What changed in your understanding?" bind:value={ms.actMemo} rows="2"></textarea>
		<div class="act-links-toggle">
			<button class="btn-xs" onclick={() => ms.showActLinks = !ms.showActLinks}>
				{ms.showActLinks ? 'hide' : `namings I have in mind (${ms.actLinkedIds.length})`}
			</button>
		</div>
		{#if ms.showActLinks}
			<div class="act-links-list">
				{#each allMapNamings as n}
					<label class="act-link-item">
						<input type="checkbox" checked={ms.actLinkedIds.includes(n.naming_id)} onchange={() => ms.toggleActLink(n.naming_id)} />
						<span class="designation-dot-sm" style="background: {ms.designationColor(n.designation)}"></span>
						<span>{n.inscription || '(unnamed relation)'}</span>
					</label>
				{/each}
			</div>
		{/if}
		<div class="act-actions">
			<button class="btn-primary btn-sm-primary" onclick={ms.submitAct}>{ms.actType === 'relate' ? 'Save memo' : 'Apply + memo'}</button>
			<button class="btn-link" onclick={ms.skipAct}>skip memo</button>
			{#if ms.actType !== 'relate'}<button class="btn-link" onclick={ms.cancelAct}>cancel</button>{/if}
		</div>
	</div>
{/if}

<style>
	.act-prompt-bar {
		background: #161822; border: 1px solid #f59e0b; border-radius: 8px;
		padding: 0.75rem 1rem; margin: 0 1rem 0.5rem;
	}
	.act-header { font-size: 0.85rem; color: #c9cdd5; margin-bottom: 0.4rem; }
	.act-existing-memos {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; margin-bottom: 0.4rem;
		max-height: 120px; overflow-y: auto;
	}
	.act-existing-label { font-size: 0.75rem; color: #8b9cf7; }
	.act-existing-memo {
		padding: 0.2rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.8rem; color: #c9cdd5;
	}
	.act-existing-memo:last-child { border-bottom: none; }
	.act-memo-label { color: #f59e0b; font-size: 0.75rem; }
	.act-memo-content { display: block; color: #a0a4b0; font-size: 0.78rem; margin-top: 0.1rem; }
	.act-prompt-bar textarea {
		width: 100%; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; color: #e1e4e8; font-size: 0.85rem; resize: vertical;
		font-family: inherit;
	}
	.act-prompt-bar textarea:focus { outline: none; border-color: #8b9cf7; }
	.act-links-toggle { margin-top: 0.35rem; }
	.act-links-list {
		display: flex; flex-direction: column; gap: 0.15rem;
		max-height: 150px; overflow-y: auto;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem; margin-top: 0.25rem;
	}
	.act-link-item {
		display: flex; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #c9cdd5; cursor: pointer;
		padding: 0.15rem 0.2rem; border-radius: 3px;
	}
	.act-link-item:hover { background: #1e2030; }
	.act-link-item input[type="checkbox"] { accent-color: #8b9cf7; }
	.act-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px; padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-sm-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-link { background: none; border: none; color: #8b9cf7; cursor: pointer; font-size: 0.8rem; text-decoration: underline; }
</style>
