<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { regionColor } from '$lib/canvas/regions.js';
	import { focusSelect } from '$lib/canvas/dom.js';
	import { plural } from '$lib/shared/plural.js';

	// Die Auswahl stand hier als Liste aus Punkt und Namen — ohne Link, ohne
	// Handlung. Der Knoten auf dem Canvas ist bereits sichtbar markiert; die
	// Wiederholung in der Spalte war eine Anzeige, aus der nichts folgt. Zum
	// Naming selbst führt der Doppelklick auf den Knoten (Stack-Panel).
	const ms = getMapState();


	// Einklappbar: bei schmalem Fenster nahm die Spalte der Karte den Platz
	// (bei 800 px rund ein Drittel, und das Unplaced-Panel samt seinen
	// place-Knöpfen lag halb hinter ihr). Unter 1000 px startet sie deshalb
	// immer eingeklappt und klappt auch zu, wenn das Fenster schmaler wird;
	// darüber gilt die gemerkte Wahl.
	const COLLAPSE_KEY = 'tqda:map-sidebar-collapsed';
	const NARROW = '(max-width: 999px)';
	let collapsed = $state(false);
	$effect(() => {
		const narrow = window.matchMedia(NARROW);
		let stored: string | null = null;
		try { stored = localStorage.getItem(COLLAPSE_KEY); } catch { stored = null; }
		collapsed = narrow.matches || stored === '1';
		const onChange = (e: MediaQueryListEvent) => { if (e.matches) collapsed = true; };
		narrow.addEventListener('change', onChange);
		return () => narrow.removeEventListener('change', onChange);
	});
	function toggleCollapsed() {
		collapsed = !collapsed;
		try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ohne Speicher eben ungemerkt */ }
	}

	// Phasen gehören dem Projekt; gezählt wird, was von ihnen auf dieser Karte steht.
	function countTitle(phase: any): string {
		const onMap = ms.phaseCountOnMap(phase.id);
		const total = Number(phase.element_count) || 0;
		return `${onMap} of this phase's ${total} namings are on this map. Phases belong to the project.`;
	}
</script>

{#if collapsed}
	<aside class="sidebar sidebar-collapsed">
		<button class="sb-expand" onclick={toggleCollapsed} title="Show phases" aria-label="Show phases">
			<span class="sb-expand-icon">‹</span>
			<span class="sb-expand-label">Phases</span>
		</button>
	</aside>
{:else}
<aside class="sidebar">
	<div class="sidebar-header">
		<h3 title="Phase (Dewey/Bentley, Knowing and the Known, 1949): a developmental grouping of namings within the situation. Forming a phase IS characterizing — the designation gradient (cue → characterization → specification) collapsed into analytical wholes. Not a computed cluster. Phases belong to the project; the counts show their namings on this map.">Phases</h3>
		<div class="sidebar-header-actions">
			<button class="btn-sm" onclick={() => ms.showPhaseForm = !ms.showPhaseForm}
				title={ms.showPhaseForm ? 'Close' : 'New phase'} aria-label={ms.showPhaseForm ? 'Close new phase form' : 'New phase'}>
				{ms.showPhaseForm ? 'x' : '+'}
			</button>
			<button class="btn-sm" onclick={toggleCollapsed} title="Hide this panel" aria-label="Hide this panel">›</button>
		</div>
	</div>

	{#if ms.showPhaseForm}
		<form class="phase-form" onsubmit={e => { e.preventDefault(); ms.addPhase(); }}>
			<input type="text" placeholder="Phase label..." aria-label="Phase label" bind:value={ms.newPhaseLabel} use:focusSelect />
			<button type="submit" class="btn-sm">Create</button>
		</form>
	{/if}

	{#if ms.phases.length === 0}
		<p class="empty-small">No phases yet.</p>
	{:else}
		{#each ms.phases as phase, i}
			{@const onMap = ms.phaseCountOnMap(phase.id)}
			{@const total = Number(phase.element_count) || 0}
			<div class="phase-card" class:assigning={ms.assigningToPhase === phase.id} class:phase-active={ms.highlightedPhase === phase.id}
				style="border-left: 3px solid {regionColor(i)}">
				<div class="phase-header">
					<button class="phase-label clickable" aria-pressed={ms.highlightedPhase === phase.id}
						title="Highlight its namings on the map and list them"
						onclick={() => { ms.highlightedPhase = ms.highlightedPhase === phase.id ? null : phase.id; ms.togglePhase(phase.id); }}>{phase.label}</button>
					<span class="phase-count" title={countTitle(phase)}>{onMap}{#if total !== onMap}<span class="phase-total">/{total}</span>{/if}</span>
				</div>
				<button class="btn-xs"
					onclick={() => ms.assigningToPhase = ms.assigningToPhase === phase.id ? null : phase.id}>
					{ms.assigningToPhase === phase.id ? 'done' : 'assign'}
				</button>
				{#if ms.assigningToPhase === phase.id}
					<p class="assign-hint">Click namings on the map (or “+ phase” in the list) to add them.</p>
				{/if}
				{#if ms.expandedPhase === phase.id}
					<div class="phase-contents">
						{#if ms.phaseContents.length === 0}
							<span class="empty-small">None of its namings is on this map.</span>
						{/if}
						{#each ms.phaseContents as pc}
							<div class="phase-element">
								<span class="designation-dot-sm" style="background: {ms.designationColor(pc.designation)}"></span>
								<span class="phase-el-label">{ms.findInscription(pc.naming_id)}</span>
								<button class="btn-xs btn-remove" title="Remove from phase" aria-label="Remove from phase"
									onclick={() => ms.removeFromPhase(phase.id, pc.naming_id)}>×</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}

	{#if ms.docPhases.length > 0}
		<div class="section-divider">Documents</div>
		{#each ms.docPhases as dc}
			<div class="phase-card doc-phase" class:phase-active={ms.highlightedPhase === dc.doc_id}
				style="border-left: 3px solid #6b7280">
				<div class="phase-header">
					<button class="phase-label clickable" aria-pressed={ms.highlightedPhase === dc.doc_id}
						title="Highlight the namings from this document"
						onclick={() => { ms.highlightedPhase = ms.highlightedPhase === dc.doc_id ? null : dc.doc_id; }}>
						<span class="doc-icon" aria-hidden="true">&#128196;</span> {dc.doc_label}
					</button>
					<span class="phase-count">{dc.naming_ids?.length || 0}</span>
				</div>
			</div>
		{/each}
	{/if}

	<!-- Zurückgezogenes ein- und ausblenden: ein eigener Schalter. Gezählt
	     wird, was die Karte zeigen kann; aus der Lage abgeleitete Relationen
	     (enthält, überschneidet) zeichnet sie nicht und nennt sie eigens. -->
	{#if ms.withdrawnCount > 0 || ms.hideWithdrawn}
		<button class="phase-card withdrawn-card" class:phase-active={ms.hideWithdrawn}
			style="border-left: 3px solid #6b7280"
			onclick={() => ms.hideWithdrawn = !ms.hideWithdrawn}
			aria-pressed={ms.hideWithdrawn}>
			<span class="phase-header">
				<span class="phase-label">Withdrawn</span>
				<span class="phase-count">{ms.withdrawnCount}</span>
			</span>
			<span class="withdrawn-hint">{ms.hideWithdrawn ? 'hidden — click to show' : 'click to hide'}</span>
			{#if ms.withdrawnDerivedCount > 0}
				<span class="withdrawn-hint" title="Relations that follow from the placement on this map (contains, overlaps) are not drawn as diamonds; the list view shows them under Withdrawn.">
					+{plural(ms.withdrawnDerivedCount, 'placement-derived relation')}, not drawn
				</span>
			{/if}
		</button>
	{/if}

</aside>
{/if}

<style>
	.sidebar {
		width: 220px; background: #13151e; border-left: 1px solid #2a2d3a;
		padding: 1rem; overflow-y: auto; flex-shrink: 0;
	}
	.sidebar-collapsed { width: auto; padding: 0.5rem 0.25rem; overflow: hidden; }
	.sb-expand {
		display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; cursor: pointer; padding: 0.4rem 0.2rem;
	}
	.sb-expand:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.sb-expand-icon { font-size: 0.9rem; line-height: 1; }
	.sb-expand-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 0.7rem; letter-spacing: 0.04em; }
	.sidebar-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
	.sidebar-header h3 { font-size: 0.85rem; color: #8b8fa3; margin: 0; }
	.sidebar-header-actions { display: flex; gap: 0.3rem; }
	.phase-form { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
	.phase-form input {
		flex: 1; min-width: 0; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.3rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.phase-form input:focus { outline: none; border-color: #8b9cf7; }
	.empty-small { color: #6b7280; font-size: 0.8rem; }
	.phase-card {
		display: block; width: 100%; text-align: left; font-family: inherit;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.5rem; margin-bottom: 0.3rem;
	}
	.phase-card.assigning { border-color: #10b981; }
	.phase-card.phase-active { background: #1e2030; }
	.section-divider {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em;
		margin: 0.75rem 0 0.3rem; padding-top: 0.5rem; border-top: 1px solid #2a2d3a;
	}
	.doc-phase { border-style: dotted; }
	.doc-icon { font-size: 0.7rem; }
	.withdrawn-card { margin-top: 0.5rem; border-style: dashed; cursor: pointer; color: inherit; }
	.withdrawn-card:hover { border-color: #6b7280; }
	.withdrawn-hint { display: block; font-size: 0.65rem; color: #6b7280; }
	.phase-header { display: flex; justify-content: space-between; align-items: center; }
	.phase-label { font-size: 0.85rem; color: #e1e4e8; font-weight: 500; }
	button.phase-label {
		background: none; border: none; padding: 0; margin: 0; font-family: inherit;
		text-align: left; min-width: 0; overflow-wrap: anywhere;
	}
	.phase-label.clickable { cursor: pointer; }
	.phase-label.clickable:hover, .phase-label.clickable:focus-visible { color: #8b9cf7; }
	.phase-label.clickable:focus-visible { outline: 1px solid #8b9cf7; outline-offset: 2px; border-radius: 2px; }
	.phase-count { font-size: 0.7rem; color: #6b7280; }
	.phase-total { color: #4b5563; }
	.assign-hint { font-size: 0.7rem; color: #10b981; margin: 0.3rem 0 0; line-height: 1.35; }
	.phase-contents { border-top: 1px solid #2a2d3a; padding-top: 0.3rem; margin-top: 0.25rem; }
	.phase-element {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.15rem 0; font-size: 0.75rem; color: #c9cdd5;
	}
	.phase-el-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-remove { color: #ef4444; border-color: #ef4444; font-size: 0.7rem; padding: 0 0.3rem; margin-left: auto; }
	.btn-remove:hover { background: rgba(239, 68, 68, 0.1); }
</style>
