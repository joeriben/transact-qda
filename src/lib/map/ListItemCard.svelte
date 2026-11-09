<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { viewHref } from '$lib/shared/rueckweg.js';
	import InlineRename from '$lib/canvas/InlineRename.svelte';
	import { hasOwnInscription } from '$lib/shared/namingLabel.js';
	import { plural } from '$lib/shared/plural.js';
	import { POS_AXIS_LEN } from './canvasPositions.svelte.js';

	let {
		item,
		listGroupBy,
		pos = null
	}: {
		item: any;
		listGroupBy: string;
		/** Aktuelle Lage auf dem Canvas (nach dem Verschieben sofort, nicht erst nach dem Neuladen). */
		pos?: { x: number; y: number } | null;
	} = $props();

	const ms = getMapState();

	// Zurückgezogen: ansehen und wiederherstellen — Umbenennen, Designieren,
	// Verbinden erst wieder nach dem Wiederherstellen (wie im Kontextmenü).
	const withdrawn = $derived(ms.isWithdrawn(item.properties));
	function startRename() {
		if (withdrawn) return;
		ms.editingId = item.naming_id;
		ms.editingValue = item.inscription || '';
	}
	// Positionskarte: die Lage als Anteil der beiden Achsen (0 % am Ursprung
	// „– – –", 100 % am Achsenende „+ + +"), nicht als Pixel des Diagramms.
	const coord = $derived.by(() => {
		const x = pos?.x ?? item.properties?.x;
		const y = pos?.y ?? item.properties?.y;
		if (typeof x !== 'number' || typeof y !== 'number') return null;
		return { x: Math.round((x / POS_AXIS_LEN) * 100), y: Math.round((-y / POS_AXIS_LEN) * 100) };
	});
	const axisNames = $derived.by(() => {
		const ax = ms.axes.find((a: any) => a.properties?.axisDimension === 'x');
		const ay = ms.axes.find((a: any) => a.properties?.axisDimension === 'y');
		return { x: ax ? ms.findInscription(ax.naming_id) : 'X axis', y: ay ? ms.findInscription(ay.naming_id) : 'Y axis' };
	});
	const coordTitle = $derived(
		coord
			? `Position along the axes (0 % at the origin “– – –”, 100 % at the axis end “+ + +”): ${axisNames.x} ${coord.x} %, ${axisNames.y} ${coord.y} %` +
				(coord.x < 0 || coord.x > 100 || coord.y < 0 || coord.y > 100 ? ' — outside the diagram' : '')
			: ''
	);

	// Rückweg-Adresse dieser Karte — Ziel jedes Sprungs, der von hier ausgeht.
	const mapPath = $derived(`/projects/${ms.projectId}/maps/${ms.mapId}`);

	// Zustand in Worten am title, nicht als weiteres Abzeichen in einer Zeile,
	// die schon Punkt, Symbol, Memo-Zahl und Badges trägt. ai-eval: 'rejected'
	// ist ein Urteil eines Forschers, 'withdrawn' die Absage an die Karte — zwei
	// verschiedene Akte, deshalb zwei verschiedene Wörter. Wessen Urteil es war,
	// steht dabei: im geteilten Projekt kann es das eines Mitglieds sein.
	const cardTitle = $derived(
		[
			item.properties?.aiReasoning || null,
			ms.rejectionLabel(item),
			ms.isHidden(item) ? 'All its passages are hidden in the material' : null
		]
			.filter(Boolean)
			.join(' — ')
	);
</script>

{#if item.mode === 'relation'}
	{@const srcId = item.directed_from || item.part_source_id}
	{@const tgtId = item.directed_to || item.part_target_id}
	<div class="element-card relation-card" class:relating-source={ms.relatingFrom === item.naming_id} class:ai-suggested={item.properties?.aiSuggested === true} class:ai-withdrawn={ms.isWithdrawn(item.properties)} class:ai-rejected={ms.isRejected(item)} class:ai-hidden={ms.isHidden(item)} title={cardTitle}>
		<div class="el-main">
			{#if item.is_collapsed}<img class="collapsed-indicator" src="/icons/keep.svg" alt="pinned" title="Pinned to specific layer" />{/if}
			<span class="designation-dot" style="background: {ms.designationColor(item.designation)}"></span>
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title={plural(item.memo_previews.length, 'memo')}>{item.memo_previews.length}</span>
			{/if}
			{#if listGroupBy !== 'mode'}<span class="mode-indicator" title="relation">↔</span>{/if}
			{#if item.outside_participation_count > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="outside-badge" title="{plural(item.outside_participation_count, 'relation')} outside this map" onclick={() => ms.showOutsideParticipations(item.naming_id)}>
					+{item.outside_participation_count}
				</span>
			{/if}
			<span class="rel-source">{ms.findInscription(srcId)}</span>
			<span class="rel-arrow">
				{#if item.directed_from && item.directed_to}
					{#if item.valence}—{item.valence}→{:else}→{/if}
				{:else}
					{#if item.valence}—{item.valence}—{:else}↔{/if}
				{/if}
			</span>
			<span class="rel-target">{ms.findInscription(tgtId)}</span>
			{#if ms.editingId === item.naming_id}
				<InlineRename bind:value={ms.editingValue} onsubmit={ms.confirmRename} oncancel={() => ms.editingId = null} />
			{:else if hasOwnInscription(item.inscription)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="rel-inscription editable" onclick={() => ms.showStack(item.naming_id)} ondblclick={startRename}>
					{item.inscription}
				</span>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="rel-inscription editable unnamed" onclick={() => ms.showStack(item.naming_id)} ondblclick={startRename}>
					(name...)
				</span>
			{/if}
			{#if item.is_collapsed && item.current_inscription && item.current_inscription !== item.inscription}
				<span class="collapsed-current">currently: {item.current_inscription}</span>
			{/if}
		</div>
		<div class="el-actions">
			{#if !withdrawn}
			<select value={item.designation || 'cue'} aria-label="Designation" onchange={e => ms.startDesignation(item.naming_id, (e.target as HTMLSelectElement).value)}>
				<option value="cue">cue</option>
				<option value="characterization">characterization</option>
				<option value="specification">specification</option>
			</select>
			{/if}
			<button class="btn-xs" title="naming stack" onclick={() => ms.showStack(item.naming_id)}>stack</button>
			<a class="btn-xs btn-list"
				href={viewHref(`/projects/${ms.projectId}/namings`, { focus: item.naming_id, from: mapPath })}
				title="Open in the naming list — everything is editable there; the way back leads here">list</a>
			<button class="btn-xs btn-withdraw" onclick={() => ms.toggleWithdraw(item.naming_id, withdrawn)}>
				{withdrawn ? 'restore' : 'withdraw'}
			</button>
			{#if withdrawn}
				<!-- nichts weiter, bis es wiederhergestellt ist -->
			{:else if ms.relatingFrom && !ms.relatingTo && ms.relatingFrom !== item.naming_id}
				<button class="btn-sm btn-relate" onclick={() => { ms.completeRelating(item.naming_id); }}>connect</button>
			{:else if !ms.relatingFrom}
				<button class="btn-sm" onclick={() => { ms.relatingFrom = item.naming_id; ms.relatingTo = null; }}>relate</button>
			{/if}
			{#if ms.assigningToPhase && !withdrawn}
				<button class="btn-sm btn-phase" onclick={() => ms.assignToPhase(ms.assigningToPhase!, item.naming_id)}>+ phase</button>
			{/if}
		</div>
	</div>
{:else if item.mode === 'silence'}
	<div class="element-card silence-card" class:relating-source={ms.relatingFrom === item.naming_id} class:ai-suggested={item.properties?.aiSuggested === true} class:ai-withdrawn={ms.isWithdrawn(item.properties)} class:ai-rejected={ms.isRejected(item)} class:ai-hidden={ms.isHidden(item)} title={cardTitle}>
		<div class="el-main">
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title={plural(item.memo_previews.length, 'memo')}>{item.memo_previews.length}</span>
			{/if}
			{#if listGroupBy !== 'mode'}<span class="mode-indicator" title="silence">∅</span>{/if}
			{#if item.outside_participation_count > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="outside-badge" title="{plural(item.outside_participation_count, 'relation')} outside this map" onclick={() => ms.showOutsideParticipations(item.naming_id)}>
					+{item.outside_participation_count}
				</span>
			{/if}
			{#if ms.editingId === item.naming_id}
				<InlineRename bind:value={ms.editingValue} onsubmit={ms.confirmRename} oncancel={() => ms.editingId = null} />
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="el-inscription editable" onclick={() => ms.showStack(item.naming_id)} ondblclick={startRename}>
					{item.inscription}
				</span>
			{/if}
		</div>
		<div class="el-actions">
			<button class="btn-xs" title="naming stack" onclick={() => ms.showStack(item.naming_id)}>stack</button>
			<a class="btn-xs btn-list"
				href={viewHref(`/projects/${ms.projectId}/namings`, { focus: item.naming_id, from: mapPath })}
				title="Open in the naming list — everything is editable there; the way back leads here">list</a>
			<button class="btn-xs btn-withdraw" onclick={() => ms.toggleWithdraw(item.naming_id, withdrawn)}>
				{withdrawn ? 'restore' : 'withdraw'}
			</button>
			{#if withdrawn}
				<!-- nichts weiter, bis es wiederhergestellt ist -->
			{:else if ms.relatingFrom && !ms.relatingTo && ms.relatingFrom !== item.naming_id}
				<button class="btn-sm btn-relate" onclick={() => { ms.completeRelating(item.naming_id); }}>connect</button>
			{:else if !ms.relatingFrom}
				<button class="btn-sm" onclick={() => { ms.relatingFrom = item.naming_id; ms.relatingTo = null; }}>relate</button>
			{/if}
		</div>
	</div>
{:else}
	<!-- Entity (element) -->
	<div class="element-card" class:relating-source={ms.relatingFrom === item.naming_id} class:ai-suggested={item.properties?.aiSuggested === true} class:ai-withdrawn={ms.isWithdrawn(item.properties)} class:ai-rejected={ms.isRejected(item)} class:ai-hidden={ms.isHidden(item)} class:pos-absent={ms.mapType === 'positional' && item.properties?.absent} class:unresolved={ms.isUnresolved(item)} title={cardTitle}>
		<div class="el-main">
			{#if item.is_collapsed}<img class="collapsed-indicator" src="/icons/keep.svg" alt="pinned" title="Pinned to specific layer" />{/if}
			{#if ms.isPrimary}
				<span class="placement-dot" title={ms.isPlaced(item) ? 'Placed on canvas' : ms.isWithdrawn(item.properties) ? 'Withdrawn' : 'Unplaced — not yet on the canvas'}>{ms.isPlaced(item) ? '●' : ms.isWithdrawn(item.properties) ? '—' : '○'}</span>
			{/if}
			<span class="designation-dot" style="background: {ms.designationColor(item.designation)}" title={ms.designationLabel(item.designation)}></span>
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title={plural(item.memo_previews.length, 'memo')}>{item.memo_previews.length}</span>
			{/if}
			{#if ms.mapType === 'positional' && item.properties?.isAxis}
				<span class="pos-axis-badge">{item.properties.axisDimension === 'x' ? 'X' : 'Y'}-axis</span>
			{/if}
			{#if ms.mapType === 'positional' && item.properties?.absent}
				<span class="pos-absent-badge">absent</span>
			{/if}
			{#if item.outside_participation_count > 0}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="outside-badge" title="{plural(item.outside_participation_count, 'relation')} outside this map" onclick={() => ms.showOutsideParticipations(item.naming_id)}>
					+{item.outside_participation_count}
				</span>
			{/if}
			{#if ms.editingId === item.naming_id}
				<InlineRename bind:value={ms.editingValue} onsubmit={ms.confirmRename} oncancel={() => ms.editingId = null} />
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="el-inscription editable" onclick={() => ms.showStack(item.naming_id)} ondblclick={startRename}>
					{item.inscription}
				</span>
				{#if ms.mapType === 'positional' && !item.properties?.isAxis}
					{#if coord}
						<span class="pos-coord" title={coordTitle}>x {coord.x} % · y {coord.y} %</span>
					{:else}
						<span class="pos-coord" title="Not yet placed in the diagram">(not placed)</span>
					{/if}
				{/if}
				{#if item.is_collapsed && item.current_inscription && item.current_inscription !== item.inscription}
					<span class="collapsed-current">currently: {item.current_inscription}</span>
				{/if}
			{/if}
		</div>
		<div class="el-actions">
			{#if !withdrawn}
			<select value={item.designation || 'cue'} aria-label="Designation" onchange={e => ms.startDesignation(item.naming_id, (e.target as HTMLSelectElement).value)}>
				<option value="cue">cue</option>
				<option value="characterization">characterization</option>
				<option value="specification">specification</option>
			</select>
			{/if}
			<button class="btn-xs" title="naming stack" onclick={() => ms.showStack(item.naming_id)}>stack</button>
			<a class="btn-xs btn-list"
				href={viewHref(`/projects/${ms.projectId}/namings`, { focus: item.naming_id, from: mapPath })}
				title="Open in the naming list — everything is editable there; the way back leads here">list</a>
			<button class="btn-xs btn-withdraw" onclick={() => ms.toggleWithdraw(item.naming_id, withdrawn)}>
				{withdrawn ? 'restore' : 'withdraw'}
			</button>
			{#if withdrawn}
				<!-- nichts weiter, bis es wiederhergestellt ist -->
			{:else if ms.relatingFrom && !ms.relatingTo && ms.relatingFrom !== item.naming_id}
				<button class="btn-sm btn-relate" onclick={() => { ms.completeRelating(item.naming_id); }}>connect</button>
			{:else if !ms.relatingFrom}
				<button class="btn-sm" onclick={() => { ms.relatingFrom = item.naming_id; ms.relatingTo = null; }}>relate</button>
			{/if}
			{#if ms.assigningToPhase && !withdrawn}
				<button class="btn-sm btn-phase" onclick={() => ms.assignToPhase(ms.assigningToPhase!, item.naming_id)}>+ phase</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Zeile darf umbrechen: Quelle, Valenz, Ziel und Name blieben sonst unter
	   dem Designations-Menü verdeckt (die Aktionen lagen über dem Text). */
	.element-card {
		display: flex; align-items: center; justify-content: space-between;
		flex-wrap: wrap; gap: 0.35rem 0.75rem;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}
	/* Ausgangspunkt einer Relation: eigene Farbe, nicht das Bernstein der Charakterisierung. */
	.element-card.relating-source { border-color: var(--relate-hl, #38bdf8); box-shadow: 0 0 0 1px var(--relate-hl, #38bdf8); }
	.element-card:hover { border-color: #3a3d4a; }
	.element-card.ai-withdrawn { opacity: 0.4; }
	.element-card.ai-withdrawn :global(.el-inscription) { text-decoration: line-through; }
	/* ai-eval: Ausgrauen als Folge des Urteils; der Wortlaut steht im title. */
	.element-card.ai-rejected { opacity: 0.5; }
	.element-card.ai-rejected .el-inscription,
	.element-card.ai-rejected .rel-inscription { text-decoration: line-through; }
	.element-card.ai-hidden { opacity: 0.45; border-style: dashed; }
	.element-card.unresolved { border-style: dashed; border-color: rgba(245, 158, 11, 0.3); }
	.placement-dot { font-size: 0.65rem; color: #6b7280; flex-shrink: 0; width: 10px; text-align: center; }
	.relation-card { background: #141620; }
	.silence-card { border-style: dashed; opacity: 0.7; }
	.el-main { display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem 0.5rem; min-width: 0; flex: 1 1 16rem; }
	.el-inscription { font-size: 0.9rem; color: #e1e4e8; overflow-wrap: anywhere; }
	.el-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; margin-left: auto; }
	.el-actions select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.2rem 0.3rem; cursor: pointer;
	}
	.designation-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
	.provenance-indicator { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.5; cursor: default; }
	.memo-count {
		font-size: 0.6rem; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px;
		padding: 0 3px; min-width: 14px; height: 14px; line-height: 14px;
		text-align: center; flex-shrink: 0;
	}
	.collapsed-indicator { width: 12px; height: 12px; flex-shrink: 0; margin-right: 0.2rem; opacity: 0.7; }
	.collapsed-current { font-size: 0.7rem; color: #6b7280; font-style: italic; margin-left: 0.5rem; }
	.mode-indicator { font-size: 0.7rem; color: #6b7280; flex-shrink: 0; width: 16px; text-align: center; }
	.outside-badge {
		font-size: 0.65rem; font-weight: 600; color: #e8a54b; background: rgba(232, 165, 75, 0.15);
		border: 1px solid rgba(232, 165, 75, 0.3); border-radius: 3px;
		padding: 0 3px; cursor: pointer; flex-shrink: 0;
	}
	.outside-badge:hover { background: rgba(232, 165, 75, 0.25); }
	.rel-source, .rel-target { font-size: 0.85rem; color: #c9cdd5; overflow-wrap: anywhere; }
	.rel-arrow { font-size: 0.8rem; color: #6b7280; margin: 0 0.25rem; overflow-wrap: anywhere; }
	.rel-inscription { font-size: 0.75rem; color: #8b8fa3; margin-left: 0.5rem; font-style: italic; overflow-wrap: anywhere; }
	.editable { cursor: pointer; }
	.editable:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
	.unnamed { color: #4b5563; font-style: italic; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-list { text-decoration: none; line-height: 1.35; }
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-withdraw { border-color: #6b7280; color: #6b7280; font-size: 0.65rem; }
	.btn-withdraw:hover { background: rgba(107, 114, 128, 0.1); }
	.btn-relate { border-color: var(--relate-hl, #38bdf8); color: var(--relate-hl, #38bdf8); }
	.btn-phase { border-color: #10b981; color: #10b981; }
	.pos-coord { font-size: 0.65rem; color: #6b7280; margin-left: 0.4rem; font-family: monospace; }
	.pos-axis-badge {
		font-size: 0.6rem; font-weight: 600; color: #8b9cf7; background: rgba(139, 156, 247, 0.12);
		border: 1px solid rgba(139, 156, 247, 0.3); border-radius: 3px;
		padding: 0 3px; flex-shrink: 0;
	}
	.pos-absent-badge {
		font-size: 0.6rem; font-weight: 600; color: #9ca3af; background: rgba(156, 163, 175, 0.1);
		border: 1px dashed rgba(156, 163, 175, 0.4); border-radius: 3px;
		padding: 0 3px; font-style: italic; flex-shrink: 0;
	}
	.pos-absent { border-style: dashed; opacity: 0.7; }
	.pos-absent :global(.el-inscription) { font-style: italic; color: #9ca3af; }
</style>
