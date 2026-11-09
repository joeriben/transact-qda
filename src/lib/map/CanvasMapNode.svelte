<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import type { CanvasPositions } from './canvasPositions.svelte.js';
	import { plural } from '$lib/shared/plural.js';

	let {
		el,
		cp,
	}: {
		el: any;
		cp: CanvasPositions;
	} = $props();

	const ms = getMapState();

	let nodeEl: HTMLDivElement | undefined = $state();

	// Die Memo-Vorschau rendert MemoTooltip.svelte außerhalb der skalierten Ebene;
	// der Knoten meldet nur, wo er gerade auf dem Bildschirm steht.
	function enter() {
		if (nodeEl && el.memo_previews?.length) ms.showMemoTip(el, nodeEl.getBoundingClientRect());
	}
	// Die Vorschau verschwindet sofort beim Verlassen — sie fängt keine Klicks
	// ab und verdeckt keine Nachbarn länger als nötig.
	function leave() {
		ms.hideMemoTipFor(el.naming_id);
	}

	// Verschwindet der Knoten unter der Maus (Filter, Neuladen), kommt kein
	// mouseleave mehr — dann nimmt er seine Vorschau selbst mit. Verglichen
	// wird die ID: nach einem Neuladen ist der Knoten ein neues Objekt.
	const nid = $derived<string>(el.naming_id);
	$effect(() => {
		const id = nid;
		return () => ms.hideMemoTipFor(id);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="map-node" bind:this={nodeEl} onmouseenter={enter} onmouseleave={leave} class:relating-source={ms.relatingFrom === el.naming_id} class:absent={el.properties?.absent} class:ai-suggested={el.properties?.aiSuggested} class:ai-withdrawn={ms.isWithdrawn(el.properties)} class:ai-rejected={ms.isRejected(el)} class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(el)} class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(el)} class:centered-dim={cp.centeredConnections && !cp.centeredConnections.has(el.naming_id)} class:centered-anchor={cp.centeredId === el.naming_id} class:flash={ms.flashId === el.naming_id}
	style="{ms.highlightedPhase && ms.isPhaseHighlighted(el) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase)};` : ''}"
	title={ms.rejectionLabel(el) ?? undefined}>
	<div class="node-header">
		<span class="designation-dot" style="background: {ms.designationColor(el.designation)}"></span>
		{#if el.has_document_anchor}
			<img class="prov-icon" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
		{:else if el.has_memo_link}
			<img class="prov-icon" src="/icons/stylus_note.svg" alt="memo" title="Memo — reflected, not grounded in a document" />
		{:else}
			<img class="prov-icon" src="/icons/question_mark.svg" alt="ungrounded" title="No document anchor, no memo yet" />
		{/if}
		<span class="node-designation">{ms.designationLabel(el.designation)}</span>
		{#if el.memo_previews?.length > 0}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span class="memo-badge" title="{plural(el.memo_previews.length, 'memo')} — open stack" onclick={(e) => { e.stopPropagation(); ms.showStack(el.naming_id); }}>
				{el.memo_previews.length}
			</span>
		{/if}
		{#if el.phase_ids?.length}
			<span class="phase-dots">
				{#each el.phase_ids as cid}
					{@const c = ms.phaseColorMap.get(cid)}
					{#if c}<span class="phase-dot" style="background: {c}" title={ms.phases.find((p: any) => p.id === cid)?.label}></span>{/if}
				{/each}
			</span>
		{/if}
	</div>
	<!-- Umbenennen: das Feld legt die Karten-Seite über den Knoten, außerhalb
	     der skalierten Ebene (bleibt bei jedem Zoom lesbar). -->
	<span class="node-label" class:renaming={ms.editingId === el.naming_id}>{el.inscription}</span>
	{#if el.is_collapsed && el.current_inscription && el.current_inscription !== el.inscription}
		<span class="collapsed-hint">now: {el.current_inscription}</span>
	{/if}
</div>

<style>
	.map-node {
		position: relative; background: #161822;
		border: 2px solid var(--el-color, #8b9cf7); border-radius: 8px;
		/* Fixed width: the canvas layer has zero width (position:absolute), so
		   min/max-width let shrink-to-fit squeeze cards to min-content and
		   shatter labels mid-word. Must match NODE_WIDTH in canvas/nodeSize.ts,
		   which the ELK layout uses to pack non-overlapping boxes. */
		padding: 0.4rem 0.6rem; width: 200px;
	}
	/* Abwesend, aber lesbar (Testlauf 09.11.: zu kontrastarm). */
	.map-node.absent {
		border-style: dashed; border-color: #6b7280;
		background: rgba(22, 24, 34, 0.6);
	}
	.map-node.absent .node-label { color: #a0a4b0; font-style: italic; }
	/* Getönt, aber deckend: Linien dahinter schienen durch die Karte und sahen
	   aus, als liefen sie durch sie hindurch. */
	.map-node.ai-suggested { border-style: dashed; border-color: rgba(139, 156, 247, 0.5); background: linear-gradient(rgba(139, 156, 247, 0.06), rgba(139, 156, 247, 0.06)), #161822; }
	.map-node.ai-withdrawn { opacity: 0.3; border-color: rgba(139, 156, 247, 0.2); }
	/* ai-eval: dein Urteil über den Cue. Durchstrich statt bloßer Blässe, damit es
	   nicht mit 'withdrawn' (Absage an diese Karte) verwechselt wird. */
	.map-node.ai-rejected { opacity: 0.5; }
	.map-node.ai-rejected .node-label { text-decoration: line-through; }
	.map-node.phase-dimmed { opacity: 0.3; transition: opacity 0.3s; }
	.map-node.centered-dim { opacity: 0.35; transition: opacity 0.3s; }
	.map-node.centered-anchor { box-shadow: 0 0 12px rgba(245, 158, 11, 0.6), 0 0 4px rgba(245, 158, 11, 0.3); }
	.map-node.phase-member { animation: phase-pulse 2s ease-in-out infinite; --pulse-color: var(--phase-color, #8b9cf7); }
	@keyframes phase-pulse {
		0%, 100% { box-shadow: 0 0 6px var(--pulse-color); }
		50% { box-shadow: 0 0 20px var(--pulse-color), inset 0 0 0 2px var(--pulse-color); }
	}
	.node-header { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.15rem; }
	.designation-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
	.prov-icon { width: 12px; height: 12px; opacity: 0.5; }
	.node-designation { font-size: 0.6rem; color: var(--el-color); text-transform: uppercase; letter-spacing: 0.04em; }
	.phase-dots { display: inline-flex; gap: 2px; margin-left: auto; }
	.phase-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
	.node-label { font-size: 0.85rem; color: #e1e4e8; word-break: break-word; display: block; }
	.node-label.renaming { opacity: 0.35; }
	.collapsed-hint { font-size: 0.65rem; color: #4b5563; font-style: italic; }
	.memo-badge {
		font-size: 0.6rem; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px;
		padding: 0 4px; min-width: 16px; height: 16px; line-height: 16px;
		text-align: center; cursor: pointer; flex-shrink: 0; margin-left: auto;
	}
	.memo-badge:hover { background: rgba(245, 158, 11, 0.25); }
	/* Ausgangspunkt einer Relation, die gerade gezogen wird — eigene Farbe, nicht
	   das Bernstein der Charakterisierung. */
	.map-node.relating-source { box-shadow: 0 0 0 3px var(--relate-hl, #38bdf8), 0 0 14px rgba(56, 189, 248, 0.5); }
	/* Eben platziert oder gesucht: kurz hervorheben. */
	.map-node.flash { animation: node-flash 0.8s ease-in-out 3; }
	@keyframes node-flash {
		0%, 100% { box-shadow: none; }
		/* Auch bei kleinem Zoom sichtbar: Ring und Schein wachsen mit 1/Zoom. */
		50% { box-shadow: 0 0 0 calc(3px * var(--inv-zoom, 1)) #8b9cf7, 0 0 calc(18px * var(--inv-zoom, 1)) rgba(139, 156, 247, 0.6); }
	}
</style>
