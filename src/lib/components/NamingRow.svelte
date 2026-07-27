<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" module>
	export type Density = 'compact' | 'comfortable' | 'rich';

	export type NamingActions = {
		// Pure data lookups (caller provides because they vary per consumer)
		findInscription?: (id: string | null) => string;
		isWithdrawn?: (id: string, props: any) => boolean;
		isUnresolved?: (item: any) => boolean;
		isPlaced?: (item: any) => boolean;

		// Interaction callbacks (10/12 budget)
		onShowStack?: (id: string) => void;
		onChangeDesignation?: (id: string, d: string) => void;
		onStartRename?: (id: string, currentInscription: string) => void;
		onStartValenceEdit?: (id: string, currentValence: string) => void;
		onSubmitInlineEdit?: (id: string, kind: 'rename' | 'valence', value: string) => void;
		onCancelInlineEdit?: () => void;
		onWithdraw?: (id: string, currentlyWithdrawn: boolean) => void;
		onStartRelate?: (id: string) => void;
		onMerge?: (id: string) => void;
		onCardClick?: (id: string, e: MouseEvent) => void;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';

	let {
		item,
		density = 'comfortable',
		isEditing = false,
		editingValue = $bindable(''),
		isEditingValence = false,
		editingValenceValue = $bindable(''),
		relatingFrom = null,
		relatingTo = null,
		assigningToPhase = null,
		mergeSurvivorId = null,
		recentlyTouched = false,
		detailHref = null,
		actions = {},
		after
	}: {
		item: any;
		density?: Density;
		isEditing?: boolean;
		editingValue?: string;
		isEditingValence?: boolean;
		editingValenceValue?: string;
		relatingFrom?: string | null;
		relatingTo?: string | null;
		assigningToPhase?: string | null;
		mergeSurvivorId?: string | null;
		recentlyTouched?: boolean;
		detailHref?: string | null;
		actions?: NamingActions;
		after?: Snippet;
	} = $props();

	const namingId = $derived(item.naming_id);
	const mode = $derived(item.mode);
	const isRich = $derived(density === 'rich');
	const isCompact = $derived(density === 'compact');

	function designationColor(d: string | null | undefined) {
		if (d === 'specification') return CCS_SPEC;
		if (d === 'characterization') return CCS_CHAR;
		return CCS_CUE;
	}
	function designationLabel(d: string | null | undefined) {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	// Inscriptions containing UUIDs are technical noise (e.g. raw participation IDs),
	// not a name a researcher would have written. Omit them entirely from the
	// relation's secondary name label so the row reads as "source —valence→ target".
	const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
	function hasMeaningfulInscription(text: string | null | undefined): boolean {
		if (!text?.trim()) return false;
		return !UUID_RE.test(text);
	}

	const withdrawn = $derived(!!actions.isWithdrawn?.(namingId, item.properties));
	const isRelateTarget = $derived(!!relatingFrom && relatingFrom !== namingId && !relatingTo);
	const isMergeTarget = $derived(!!mergeSurvivorId && mergeSurvivorId !== namingId);
	const isMergeSurvivor = $derived(mergeSurvivorId === namingId);

	const srcId = $derived(item.directed_from || item.part_source_id);
	const tgtId = $derived(item.directed_to || item.part_target_id);

	// Canonical directionality (mirrors ListItemCard): a relation is directed iff
	// BOTH endpoints are set on the relation appearance. Symmetric relations have
	// directed_from/to NULL — they render with ↔ / a neutral dash, while their
	// endpoints still resolve via the participation fallback baked into
	// source_inscription/target_inscription by the loader.
	const directed = $derived(!!(item.directed_from && item.directed_to));

	function resolveInscription(id: string | null): string {
		if (!id) return '?';
		return actions.findInscription?.(id) || '?';
	}

	function handleCardClick(e: MouseEvent) {
		actions.onCardClick?.(namingId, e);
	}

	function handleInscriptionClick() {
		if (relatingFrom) return;
		actions.onShowStack?.(namingId);
	}
</script>

{#if mode === 'relation'}
	{@const titleText = item.current_inscription || item.inscription}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="naming-card relation-card"
		class:withdrawn
		class:relate-target={isRelateTarget}
		class:merge-target={isMergeTarget}
		class:merge-survivor={isMergeSurvivor}
		class:recently-touched={recentlyTouched}
		onclick={handleCardClick}
	>
		<div class="naming-main">
			<span
				class="designation-dot"
				style="background: {designationColor(item.designation)}"
				title={designationLabel(item.designation)}
			></span>
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Memo linked" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title="{item.memo_previews.length} memo(s)">{item.memo_previews.length}</span>
			{/if}
			{#if isRich}
				<span class="mode-hint mode-relation" title="Appears as a relation on at least one map">◇</span>
			{/if}
			<div class="relation-proposition">
				<span class="rel-source">{item.source_inscription || resolveInscription(srcId)}</span>
				{#if isEditingValence}
					<span class="rel-arrow">—</span>
					<form
						class="inline-rename"
						onsubmit={(e) => { e.preventDefault(); actions.onSubmitInlineEdit?.(namingId, 'valence', editingValenceValue); }}
					>
						<input type="text" bind:value={editingValenceValue} placeholder="valence" />
						<button type="submit" class="btn-xs">ok</button>
						<button type="button" class="btn-xs" onclick={() => actions.onCancelInlineEdit?.()}>x</button>
					</form>
					<span class="rel-arrow">{#if directed}→{:else}—{/if}</span>
				{:else if item.valence}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span class="rel-arrow">—<span
							class="rel-predicate"
							ondblclick={() => actions.onStartValenceEdit?.(namingId, item.valence)}
							onclick={() => actions.onShowStack?.(namingId)}
						>{item.valence}</span>{#if directed}→{:else}—{/if}</span>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span class="rel-arrow">{#if directed}→{:else}↔{/if} <span
							class="rel-predicate-empty"
							ondblclick={() => actions.onStartValenceEdit?.(namingId, '')}
						>+ valence</span></span>
				{/if}
				<span class="rel-target">{item.target_inscription || resolveInscription(tgtId)}</span>
				{#if isEditing}
					<form
						class="inline-rename"
						onsubmit={(e) => { e.preventDefault(); actions.onSubmitInlineEdit?.(namingId, 'rename', editingValue); }}
					>
						<input type="text" bind:value={editingValue} />
						<button type="submit" class="btn-xs">ok</button>
						<button type="button" class="btn-xs" onclick={() => actions.onCancelInlineEdit?.()}>x</button>
					</form>
				{:else if hasMeaningfulInscription(titleText)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<span
						class="rel-inscription editable"
						ondblclick={() => actions.onStartRename?.(namingId, titleText || '')}
						onclick={() => actions.onShowStack?.(namingId)}
					>{titleText}</span>
				{/if}
			</div>
		</div>
		{#if !isCompact}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="naming-actions" onclick={(e) => { if (relatingFrom) e.stopPropagation(); }}>
				<select
					value={item.designation || 'cue'}
					onchange={(e) => actions.onChangeDesignation?.(namingId, (e.target as HTMLSelectElement).value)}
				>
					<option value="cue">cue</option>
					<option value="characterization">characterization</option>
					<option value="specification">specification</option>
				</select>
				<button class="btn-xs" onclick={() => actions.onShowStack?.(namingId)}>stack</button>
				{#if detailHref}
					<a class="btn-xs btn-detail" href={detailHref}>detail</a>
				{/if}
				<button class="btn-xs btn-withdraw" onclick={() => actions.onWithdraw?.(namingId, withdrawn)}>
					{withdrawn ? 'restore' : 'withdraw'}
				</button>
			</div>
		{/if}
		{#if after}{@render after()}{/if}
	</div>
{:else if mode === 'silence'}
	<div class="naming-card silence-card" class:withdrawn class:recently-touched={recentlyTouched}>
		<div class="naming-main">
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Memo linked" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title="{item.memo_previews.length} memo(s)">{item.memo_previews.length}</span>
			{/if}
			{#if isRich}
				<span class="mode-hint" title="Appears as a silence">∅</span>
			{/if}
			{#if isEditing}
				<form
					class="inline-rename"
					onsubmit={(e) => { e.preventDefault(); actions.onSubmitInlineEdit?.(namingId, 'rename', editingValue); }}
				>
					<input type="text" bind:value={editingValue} />
					<button type="submit" class="btn-xs">ok</button>
					<button type="button" class="btn-xs" onclick={() => actions.onCancelInlineEdit?.()}>x</button>
				</form>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="naming-inscription editable"
					ondblclick={() => actions.onStartRename?.(namingId, item.current_inscription || item.inscription || '')}
					onclick={() => actions.onShowStack?.(namingId)}
				>
					{item.current_inscription || item.inscription || ''}
				</span>
			{/if}
		</div>
		{#if !isCompact}
			<div class="naming-actions">
				<button class="btn-xs" onclick={() => actions.onShowStack?.(namingId)}>stack</button>
				{#if detailHref}
					<a class="btn-xs btn-detail" href={detailHref}>detail</a>
				{/if}
			</div>
		{/if}
		{#if after}{@render after()}{/if}
	</div>
{:else}
	<!-- Entity -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="naming-card"
		class:withdrawn
		class:relate-target={isRelateTarget}
		class:merge-target={isMergeTarget}
		class:merge-survivor={isMergeSurvivor}
		class:recently-touched={recentlyTouched}
		onclick={handleCardClick}
	>
		<div class="naming-main">
			<span
				class="designation-dot"
				style="background: {designationColor(item.designation)}"
				title={designationLabel(item.designation)}
			></span>
			{#if item.has_document_anchor}
				<img class="provenance-indicator" src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" />
			{:else if item.has_memo_link}
				<img class="provenance-indicator" src="/icons/stylus_note.svg" alt="analytical" title="Memo linked" />
			{:else}
				<img class="provenance-indicator" src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" />
			{/if}
			{#if item.memo_previews?.length > 0}
				<span class="memo-count" title="{item.memo_previews.length} memo(s)">{item.memo_previews.length}</span>
			{/if}
			{#if isRich}
				<span class="mode-hint" title="Appears as an entity">●</span>
			{/if}
			{#if isEditing}
				<form
					class="inline-rename"
					onsubmit={(e) => { e.preventDefault(); actions.onSubmitInlineEdit?.(namingId, 'rename', editingValue); }}
				>
					<input type="text" bind:value={editingValue} />
					<button type="submit" class="btn-xs">ok</button>
					<button type="button" class="btn-xs" onclick={() => actions.onCancelInlineEdit?.()}>x</button>
				</form>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<span
					class="naming-inscription"
					class:editable={!relatingFrom}
					ondblclick={() => actions.onStartRename?.(namingId, item.current_inscription || item.inscription || '')}
					onclick={handleInscriptionClick}
				>
					{item.current_inscription || item.inscription || ''}
				</span>
			{/if}
		</div>
		{#if !isCompact}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="naming-actions" onclick={(e) => { if (relatingFrom) e.stopPropagation(); }}>
				<select
					value={item.designation || 'cue'}
					onchange={(e) => actions.onChangeDesignation?.(namingId, (e.target as HTMLSelectElement).value)}
				>
					<option value="cue">cue</option>
					<option value="characterization">characterization</option>
					<option value="specification">specification</option>
				</select>
				<button class="btn-xs" onclick={() => actions.onShowStack?.(namingId)}>stack</button>
				{#if detailHref}
					<a class="btn-xs btn-detail" href={detailHref}>detail</a>
				{/if}
				{#if actions.onStartRelate}
					<button class="btn-xs" onclick={() => actions.onStartRelate?.(namingId)}>relate</button>
				{/if}
				{#if actions.onMerge}
					<button class="btn-xs btn-merge" onclick={(e) => { e.stopPropagation(); actions.onMerge?.(namingId); }}>merge</button>
				{/if}
				<button class="btn-xs btn-withdraw" onclick={() => actions.onWithdraw?.(namingId, withdrawn)}>
					{withdrawn ? 'restore' : 'withdraw'}
				</button>
			</div>
		{/if}
		{#if after}{@render after()}{/if}
	</div>
{/if}

<style>
	.naming-card {
		padding: 0.5rem 0.65rem;
		border-radius: 5px;
	}
	.naming-card:hover { background: #1e2030; }
	.naming-card.withdrawn { opacity: 0.4; }
	.naming-card.withdrawn :global(.naming-inscription) { text-decoration: line-through; }
	.naming-card.withdrawn :global(.rel-inscription) { text-decoration: line-through; }
	.naming-card.relate-target { cursor: crosshair; }
	.naming-card.relate-target:hover { background: rgba(139, 156, 247, 0.12); }
	.naming-card.merge-target { cursor: pointer; }
	.naming-card.merge-target:hover { background: rgba(232, 165, 75, 0.12); }
	.naming-card.merge-survivor { border-left: 3px solid #e8a54b; }
	/* recently-touched: inset shadow keeps the row stationary and stacks
	   cleanly with merge-survivor / silence-card left-borders. */
	.naming-card.recently-touched { box-shadow: inset 3px 0 0 var(--warning); }
	.silence-card { border-left: 2px solid #4b5563; }

	.naming-main {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.designation-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.provenance-indicator {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		opacity: 0.5;
	}

	.memo-count {
		font-size: 0.6rem; font-weight: 700; color: #f59e0b;
		background: rgba(245, 158, 11, 0.15);
		border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px;
		padding: 0 3px; min-width: 14px; height: 14px; line-height: 14px;
		text-align: center; flex-shrink: 0;
	}

	.mode-hint {
		color: #6b7280;
		font-size: 0.85rem;
		line-height: 1;
		flex-shrink: 0;
		margin-right: 0.1rem;
	}
	.mode-hint.mode-relation { color: #8b9cf7; }

	.naming-inscription {
		flex: 1;
		font-size: 0.88rem;
		color: #e1e4e8;
		cursor: default;
	}
	.naming-inscription.editable { cursor: pointer; }
	.naming-inscription.editable:hover { color: #8b9cf7; }

	.naming-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.2rem;
		padding-left: 1.6rem;
	}
	.naming-actions select {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.7rem;
		padding: 0.2rem 0.3rem;
		cursor: pointer;
	}

	.btn-xs {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.7rem;
		padding: 0.15rem 0.35rem;
		cursor: pointer;
	}
	.btn-xs:hover { border-color: #4b5060; color: #e1e4e8; }
	.btn-withdraw { border-color: #6b7280; color: #6b7280; font-size: 0.65rem; }
	.btn-withdraw:hover { background: rgba(107, 114, 128, 0.1); }
	.btn-detail { text-decoration: none; border-color: #10b981; color: #10b981; font-size: 0.65rem; }
	.btn-detail:hover { background: rgba(16, 185, 129, 0.1); }
	.btn-merge { color: #e8a54b; }

	.inline-rename {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		flex: 1;
	}
	.inline-rename input {
		background: #0f1117;
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.15rem 0.35rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		flex: 1;
	}

	/* Relation directed-triple format — used at density=rich. Mirrors
	   ListItemCard's "source —valence→ target" with the relation's own name
	   demoted to a secondary italic label. */
	.relation-proposition {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}
	/* .rel-source/.rel-arrow/.rel-target/.rel-inscription lifted from ListItemCard
	   so /namings and the map list-view render relations identically. */
	.rel-source, .rel-target { font-size: 0.85rem; color: #c9cdd5; }
	.rel-arrow { font-size: 0.8rem; color: #6b7280; margin: 0 0.25rem; }
	.rel-inscription {
		font-size: 0.75rem;
		color: #8b8fa3;
		margin-left: 0.5rem;
		font-style: italic;
	}
	.rel-inscription.editable { cursor: pointer; }
	.rel-inscription.editable:hover { text-decoration: underline dotted; text-underline-offset: 3px; }
	/* Valence stays amber + clickable — the /namings inline-edit affordance that
	   ListItemCard lacks; the connector dashes/arrows around it are grey. */
	.rel-predicate {
		color: #f59e0b;
		cursor: pointer;
	}
	.rel-predicate:hover { color: #fbbf24; }
	.rel-predicate-empty {
		color: #3a3d4a;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.rel-predicate-empty:hover { color: #6b7280; }
</style>
