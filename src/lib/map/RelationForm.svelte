<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	const ms = getMapState();

	let relInscription = $state('');
	let relValence = $state('');
	let relDirected = $state(true);
</script>

{#if ms.relatingFrom && ms.relatingTo}
	<div class="act-prompt-bar">
		<div class="rel-form-header">
			{ms.findInscription(ms.relatingFrom)}
			{#if relDirected}<span class="arrow">→</span>{:else}<span class="arrow">↔</span>{/if}
			{ms.findInscription(ms.relatingTo)}
			<button class="btn-link" onclick={ms.cancelRelation}>cancel</button>
		</div>
		<label>
			<span class="field-label">Valence</span>
			<input type="text" placeholder="e.g. enables, constrains..." bind:value={relValence} />
		</label>
		<label>
			<span class="field-label">Name</span>
			<input type="text" placeholder="Name for this relation (optional)" bind:value={relInscription} />
		</label>
		<label class="toggle-label">
			<input type="checkbox" bind:checked={relDirected} />
			<span>directed</span>
		</label>
		<button class="btn-primary btn-sm-primary" onclick={() => ms.submitRelation(relInscription, relValence, relDirected)}>Create relation</button>
	</div>
{/if}

<style>
	.act-prompt-bar {
		background: #161822; border: 1px solid #f59e0b; border-radius: 8px;
		padding: 0.75rem 1rem; margin: 0 1rem 0.5rem;
	}
	.rel-form-header {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.9rem; color: #e1e4e8; margin-bottom: 0.5rem;
	}
	.arrow { color: #8b9cf7; }
	.field-label { font-size: 0.65rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
	label { display: flex; flex-direction: column; gap: 0.1rem; margin-bottom: 0.4rem; }
	label input[type="text"] {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.35rem 0.5rem; color: #e1e4e8; font-size: 0.85rem; font-family: inherit;
		width: 100%; box-sizing: border-box;
	}
	label input[type="text"]:focus { outline: none; border-color: #8b9cf7; }
	.toggle-label {
		flex-direction: row !important; align-items: center; gap: 0.35rem;
		font-size: 0.8rem; color: #8b8fa3; cursor: pointer;
	}
	.toggle-label input[type="checkbox"] { accent-color: #8b9cf7; }
	.btn-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px; padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-sm-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-link { background: none; border: none; color: #8b9cf7; cursor: pointer; font-size: 0.8rem; text-decoration: underline; }
</style>
