<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	let { data } = $props();

	type Candidate = {
		id: string;
		label: string;
		color: string | null;
		has_document_anchor: boolean;
		has_memo_link: boolean;
		designation: 'cue' | 'characterization' | 'specification' | null;
	};

	let filterGrounding = $state<'all' | 'doc' | 'memo' | 'none'>('all');
	let filterCCS = $state<'all' | 'cue' | 'characterization' | 'specification'>('all');

	function ccsKey(d: Candidate['designation']): 'cue' | 'char' | 'spec' {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	function ccsVar(d: Candidate['designation']): string {
		if (d === 'specification') return 'var(--ccs-spec)';
		if (d === 'characterization') return 'var(--ccs-char)';
		return 'var(--ccs-cue)';
	}

	const candidates = $derived(data.candidates as Candidate[]);

	const filtered = $derived(
		candidates.filter((c) => {
			if (filterGrounding === 'doc' && !c.has_document_anchor) return false;
			if (filterGrounding === 'memo' && !(c.has_memo_link && !c.has_document_anchor)) return false;
			if (filterGrounding === 'none' && (c.has_document_anchor || c.has_memo_link)) return false;
			if (filterCCS !== 'all') {
				const desig = c.designation ?? 'cue';
				if (desig !== filterCCS) return false;
			}
			return true;
		})
	);

	const counts = $derived.by(() => {
		const c = { total: candidates.length, cue: 0, char: 0, spec: 0, doc: 0, memo: 0, none: 0 };
		for (const row of candidates) {
			c[ccsKey(row.designation)]++;
			if (row.has_document_anchor) c.doc++;
			else if (row.has_memo_link) c.memo++;
			else c.none++;
		}
		return c;
	});
</script>

<div class="codes-page">
	<div class="header">
		<h1>Codes</h1>
		<span class="summary">
			{counts.total} total
			<span class="sep">·</span>
			<span style="color: var(--ccs-cue)">{counts.cue}</span>/<span
				style="color: var(--ccs-char)">{counts.char}</span>/<span
				style="color: var(--ccs-spec)">{counts.spec}</span> CCS
			<span class="sep">·</span>
			{counts.doc}/{counts.memo}/{counts.none} grounding
		</span>
	</div>

	<div class="filter-bar">
		<div class="filter-group">
			<span class="filter-label">Grounding</span>
			<button class="filter-btn" class:active={filterGrounding === 'all'} onclick={() => filterGrounding = 'all'}>All</button>
			<button class="filter-btn" class:active={filterGrounding === 'doc'} onclick={() => filterGrounding = 'doc'}>
				<img src="/icons/text_snippet.svg" alt="" class="filter-icon" /> Doc
			</button>
			<button class="filter-btn" class:active={filterGrounding === 'memo'} onclick={() => filterGrounding = 'memo'}>
				<img src="/icons/stylus_note.svg" alt="" class="filter-icon" /> Memo
			</button>
			<button class="filter-btn" class:active={filterGrounding === 'none'} onclick={() => filterGrounding = 'none'}>
				<img src="/icons/question_mark.svg" alt="" class="filter-icon" /> None
			</button>
		</div>

		<div class="filter-group">
			<span class="filter-label">CCS</span>
			<button class="filter-btn" class:active={filterCCS === 'all'} onclick={() => filterCCS = 'all'}>All</button>
			<button class="filter-btn" class:active={filterCCS === 'cue'} onclick={() => filterCCS = 'cue'}>
				<span class="dot" style="background: var(--ccs-cue)"></span> Cue
			</button>
			<button class="filter-btn" class:active={filterCCS === 'characterization'} onclick={() => filterCCS = 'characterization'}>
				<span class="dot" style="background: var(--ccs-char)"></span> Char
			</button>
			<button class="filter-btn" class:active={filterCCS === 'specification'} onclick={() => filterCCS = 'specification'}>
				<span class="dot" style="background: var(--ccs-spec)"></span> Spec
			</button>
		</div>
	</div>

	{#if filtered.length === 0}
		<p class="empty">No namings match.</p>
	{:else}
		<div class="naming-list">
			{#each filtered as c (c.id)}
				<div class="naming-row">
					<span class="designation-dot" style="background: {ccsVar(c.designation)}" title={c.designation ?? 'cue'}></span>
					<span class="naming-label">{c.label}</span>
					{#if c.has_document_anchor}
						<img src="/icons/text_snippet.svg" alt="empirical" title="Empirically grounded" class="provenance-icon prov-doc" />
					{:else if c.has_memo_link}
						<img src="/icons/stylus_note.svg" alt="analytical" title="Analytically grounded (memo only)" class="provenance-icon prov-memo" />
					{:else}
						<img src="/icons/question_mark.svg" alt="ungrounded" title="No grounding yet" class="provenance-icon prov-none" />
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.codes-page { max-width: 700px; }

	.header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	h1 { font-size: 1.3rem; }
	.summary { font-size: 0.8rem; color: var(--text-4); }
	.sep { opacity: 0.5; margin: 0 0.2rem; }

	.filter-bar {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}
	.filter-group {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	.filter-label {
		font-size: 0.7rem;
		color: var(--text-4);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-right: 0.25rem;
	}
	.filter-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.65rem;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: #9ca3af;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.filter-btn:hover { border-color: var(--border-hi); color: var(--text-1); }
	.filter-btn.active { border-color: var(--accent); color: var(--text-1); background: rgba(139, 156, 247, 0.08); }
	.filter-icon { width: 12px; height: 12px; opacity: 0.7; }
	.filter-btn .dot {
		display: inline-block;
		width: 7px; height: 7px;
		border-radius: 50%;
	}

	.empty { color: var(--text-4); font-size: 0.9rem; }

	.naming-list {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.25rem;
	}

	.naming-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 5px;
		cursor: default;
	}
	.naming-row:hover { background: var(--surface-2); }

	.designation-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.naming-label {
		flex: 1;
		font-size: 0.9rem;
	}

	.provenance-icon {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		opacity: 0.5;
	}
</style>
