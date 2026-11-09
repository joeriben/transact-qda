<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { focusSelect } from '$lib/canvas/dom.js';

	const ms = getMapState();

	let relInscription = $state('');
	let relValence = $state('');
	let relDirected = $state(true);
	let submitting = $state(false);

	// Jede neue Relation beginnt leer. Die Felder lebten über das Formular
	// hinaus, und die Werte der vorigen Relation standen schon darin.
	const pair = $derived(ms.relatingFrom && ms.relatingTo ? `${ms.relatingFrom}>${ms.relatingTo}` : null);
	$effect(() => {
		if (!pair) return;
		relInscription = '';
		relValence = '';
		relDirected = true;
	});

	// Was das Anlegen designiert, steht vor dem Speichern da (Testlauf 09.11.:
	// „die Zähler springen, ohne dass ich designiert habe"). Regel wie im
	// Server (relateElements): Valenz allein ist strukturell und bleibt Cue,
	// eine eigene Inschrift charakterisiert, Inschrift und Valenz spezifizieren;
	// verbundene Cues steigen auf characterization.
	const relDesignation = $derived(
		relInscription.trim() && relValence.trim() ? 'specification' : relInscription.trim() ? 'characterization' : 'cue'
	);
	const liftedEnds = $derived(
		[ms.relatingFrom, ms.relatingTo]
			.filter((id): id is string => !!id && (ms.findNode(id)?.designation ?? 'cue') === 'cue')
			.map((id) => `“${ms.findInscription(id)}”`)
	);

	async function submit() {
		if (submitting) return;
		submitting = true;
		try {
			await ms.submitRelation(relInscription, relValence, relDirected);
		} finally {
			submitting = false;
		}
	}
</script>

{#if ms.relatingFrom && ms.relatingTo}
	<form class="act-prompt-bar" onsubmit={(e) => { e.preventDefault(); submit(); }}>
		<div class="rel-form-header">
			{ms.findInscription(ms.relatingFrom)}
			{#if relDirected}<span class="arrow">→</span>{:else}<span class="arrow">↔</span>{/if}
			{ms.findInscription(ms.relatingTo)}
			<button type="button" class="btn-link" onclick={ms.cancelRelation}>cancel</button>
		</div>
		<label>
			<span class="field-label">Valence</span>
			<input type="text" placeholder="e.g. enables, constrains..." bind:value={relValence} use:focusSelect aria-label="Valence" />
		</label>
		<label>
			<span class="field-label">Name</span>
			<input type="text" placeholder="Name for this relation (optional)" bind:value={relInscription} aria-label="Name (optional)" />
		</label>
		<label class="toggle-label">
			<input type="checkbox" bind:checked={relDirected}
				aria-label="directed — from {ms.findInscription(ms.relatingFrom)} to {ms.findInscription(ms.relatingTo)}" />
			<span>directed</span>
		</label>
		<p class="rel-effect">
			Saved as <strong>{relDesignation}</strong>{relDesignation === 'cue' ? ' — a name makes it a characterization, name and valence a specification' : ''}.
			{#if liftedEnds.length > 0}
				Relating lifts {liftedEnds.join(' and ')} from cue to characterization.
			{/if}
		</p>
		<button type="submit" class="btn-sm-primary" disabled={submitting}>
			{submitting ? 'Creating…' : 'Create relation'}
		</button>
	</form>
{/if}

<style>
	/* Über der Karte, nicht im Fluss: die Karte rückt nicht nach unten. Rahmen
	   in der Farbe des Verbindens (wie die Markierung der Quelle). */
	.act-prompt-bar {
		display: block;
		background: #161822; border: 1px solid var(--relate-hl, #38bdf8); border-radius: 8px;
		padding: 0.75rem 1rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.rel-form-header {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
		font-size: 0.9rem; color: #e1e4e8; margin-bottom: 0.5rem;
	}
	.arrow { color: #8b9cf7; }
	.rel-effect { font-size: 0.75rem; color: #8b8fa3; margin: 0.1rem 0 0.5rem; line-height: 1.4; max-width: 34rem; }
	.rel-effect strong { color: #c9cdd5; font-weight: 600; }
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
	.btn-sm-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px; padding: 0.35rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-sm-primary:disabled { opacity: 0.6; cursor: default; }
	.btn-link { background: none; border: none; color: #8b9cf7; cursor: pointer; font-size: 0.8rem; text-decoration: underline; }
</style>
