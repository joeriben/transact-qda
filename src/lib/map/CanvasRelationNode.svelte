<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import type { CanvasPositions } from './canvasPositions.svelte.js';
	import { hasOwnInscription } from '$lib/shared/namingLabel.js';
	import { plural } from '$lib/shared/plural.js';

	let {
		rel,
		cp,
	}: {
		rel: any;
		cp: CanvasPositions;
	} = $props();

	const ms = getMapState();

	let nodeEl: HTMLDivElement | undefined = $state();
	const memoCount = $derived<number>(rel.memo_previews?.length ?? 0);
	const own = $derived(hasOwnInscription(rel.inscription));

	// Memo-Vorschau wie bei den Karten: beim Überfahren, verschwindet beim Verlassen.
	function enter() {
		if (nodeEl && memoCount > 0) ms.showMemoTip(rel, nodeEl.getBoundingClientRect());
	}
	function leave() {
		ms.hideMemoTipFor(rel.naming_id);
	}
	// Verschwindet die Raute unter der Maus (Filter, Neuladen), kommt kein
	// mouseleave mehr — dann nimmt sie ihre Vorschau selbst mit.
	const nid = $derived<string>(rel.naming_id);
	$effect(() => {
		const id = nid;
		return () => ms.hideMemoTipFor(id);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relation-diamond" bind:this={nodeEl} onmouseenter={enter} onmouseleave={leave}
	class:relating-source={ms.relatingFrom === rel.naming_id} class:ai-suggested={rel.properties?.aiSuggested} class:ai-withdrawn={ms.isWithdrawn(rel.properties)} class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(rel)} class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(rel)} class:centered-dim={cp.centeredConnections && !cp.centeredConnections.has(rel.naming_id)} class:centered-anchor={cp.centeredId === rel.naming_id} class:flash={ms.flashId === rel.naming_id}
	style="{ms.highlightedPhase && ms.isPhaseHighlighted(rel) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase)};` : ''}">
	<svg class="diamond-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
		<polygon points="12,0 88,0 100,50 88,100 12,100 0,50" fill="#161822" stroke="#2a2d3a" stroke-width="1.5"/>
	</svg>
	<div class="diamond-content">
		{#if own && rel.valence}<span class="rd-valence">{rel.valence}</span>{/if}
		{#if own}
			<span class="rd-text">{rel.inscription}</span>
		{:else}
			<!-- Ohne eigene Inschrift heißt die Relation nach ihren Endpunkten. -->
			<span class="rd-text unnamed">{ms.findInscription(rel.naming_id)}</span>
		{/if}
	</div>
	{#if memoCount > 0}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<span class="memo-badge" title="{plural(memoCount, 'memo')} — open stack"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={(e) => { e.stopPropagation(); ms.showStack(rel.naming_id); }}>{memoCount}</span>
	{/if}
</div>

<style>
	/* max-content: in der größenlosen Canvas-Ebene schrumpft ein Kasten sonst
	   auf seine Mindestbreite, und das Label bricht dreizeilig um. */
	.relation-diamond {
		position: relative; width: max-content; min-width: 90px; max-width: 220px; min-height: 36px;
		display: flex; align-items: center; justify-content: center; text-align: center;
	}
	/* Ausgangspunkt einer Relation, die gerade gezogen wird: eigene Farbe, nicht
	   das Bernstein der Charakterisierung. */
	.relation-diamond.relating-source .diamond-bg polygon { stroke: var(--relate-hl, #38bdf8); stroke-width: 3; }
	.relation-diamond.relating-source { filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.55)); }
	.diamond-bg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
	.diamond-content { position: relative; z-index: 1; padding: 0.3rem 1.2rem; display: flex; flex-direction: column; align-items: center; gap: 0.1rem; }
	.relation-diamond.ai-suggested .diamond-bg polygon { fill: #1a1d2e; }
	.relation-diamond.ai-withdrawn { opacity: 0.3; }
	.relation-diamond.phase-member { filter: drop-shadow(0 0 3px var(--phase-color)); }
	.relation-diamond.phase-dimmed { opacity: 0.25; }
	.relation-diamond.centered-dim { opacity: 0.15; }
	.relation-diamond.centered-anchor .diamond-bg polygon { stroke: #f59e0b; }
	.relation-diamond.flash { animation: rd-flash 0.8s ease-in-out 3; }
	@keyframes rd-flash {
		0%, 100% { filter: none; }
		50% { filter: drop-shadow(0 0 8px #8b9cf7) drop-shadow(0 0 2px #8b9cf7); }
	}
	.rd-valence { font-size: 0.65rem; color: #8b8fa3; font-style: italic; }
	.rd-text { color: #c9cdd5; font-size: 0.75rem; }
	.rd-text.unnamed { color: #8b8fa3; font-size: 0.68rem; font-style: italic; }
	/* Memo-Abzeichen wie an den Karten */
	.memo-badge {
		position: absolute; top: -6px; right: 4px; z-index: 2;
		font-size: 0.6rem; font-weight: 700; color: #f59e0b; background: #1e2030;
		border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 8px;
		padding: 0 4px; min-width: 16px; height: 16px; line-height: 14px;
		text-align: center; cursor: pointer;
	}
	.memo-badge:hover { background: #2a2416; }
</style>
