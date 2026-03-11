<script lang="ts">
	let { data } = $props();

	let filterStatus = $state<'all' | 'grounded' | 'ungrounded'>('all');

	type Candidate = {
		id: string;
		label: string;
		color: string | null;
		source_map_id: string | null;
		source_map_label: string | null;
		is_orphan: boolean;
		has_document_anchor: boolean;
	};

	const filtered = $derived(
		filterStatus === 'all'
			? data.candidates
			: data.candidates.filter((c: Candidate) =>
				filterStatus === 'grounded' ? c.has_document_anchor : !c.has_document_anchor
			)
	);

	// Group by source map
	const grouped = $derived.by(() => {
		const groups = new Map<string, { label: string; items: Candidate[] }>();
		for (const c of filtered as Candidate[]) {
			const key = c.source_map_id || '__orphan__';
			if (!groups.has(key)) {
				groups.set(key, {
					label: c.source_map_label || 'Unplaced',
					items: []
				});
			}
			groups.get(key)!.items.push(c);
		}
		return groups;
	});

	// Summary counts
	const groundedCount = $derived((data.candidates as Candidate[]).filter(c => c.has_document_anchor).length);
	const totalCount = $derived((data.candidates as Candidate[]).length);
</script>

<div class="grounding-page">
	<div class="header">
		<h1>Grounding</h1>
		<span class="summary">{groundedCount} / {totalCount} grounded</span>
	</div>

	<div class="filter-bar">
		<button class="filter-btn" class:active={filterStatus === 'all'} onclick={() => filterStatus = 'all'}>All</button>
		<button class="filter-btn" class:active={filterStatus === 'grounded'} onclick={() => filterStatus = 'grounded'}>
			<img src="/icons/text_snippet.svg" alt="" class="filter-icon" /> Grounded
		</button>
		<button class="filter-btn" class:active={filterStatus === 'ungrounded'} onclick={() => filterStatus = 'ungrounded'}>
			<img src="/icons/question_mark.svg" alt="" class="filter-icon" /> Ungrounded
		</button>
	</div>

	{#if filtered.length === 0}
		<p class="empty">
			{#if filterStatus === 'all'}
				No namings yet. Create elements on situational maps to see them here.
			{:else}
				No {filterStatus} namings.
			{/if}
		</p>
	{:else}
		{#each [...grouped] as [key, group] (key)}
			<div class="group">
				<h3 class="group-label">{group.label}</h3>
				<div class="group-items">
					{#each group.items as c (c.id)}
						{@const hasMemo = (data.memoCounts[c.id] || 0) > 0}
						<div class="naming-row">
							<span class="color-dot" style="background: {c.color || '#8b9cf7'}"></span>
							<span class="naming-label">{c.label}</span>
							{#if hasMemo}
								<img src="/icons/stylus_note.svg" alt="Has memo" title="Has memo" class="memo-icon" />
							{/if}
							<span class="naming-count">{data.annotationCounts[c.id] || 0}</span>
							<img
								src={c.has_document_anchor ? '/icons/text_snippet.svg' : '/icons/question_mark.svg'}
								alt={c.has_document_anchor ? 'Grounded' : 'Ungrounded'}
								title={c.has_document_anchor ? 'Grounded' : 'Ungrounded'}
								class="status-icon"
								class:status-grounded={c.has_document_anchor}
								class:status-ungrounded={!c.has_document_anchor}
							/>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	.grounding-page { max-width: 700px; }

	.header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	h1 { font-size: 1.3rem; }
	.summary { font-size: 0.8rem; color: #6b7280; }

	.filter-bar {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 1.25rem;
	}
	.filter-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.65rem;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		color: #9ca3af;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.filter-btn:hover { border-color: #4b5060; color: #e1e4e8; }
	.filter-btn.active { border-color: #8b9cf7; color: #e1e4e8; background: rgba(139, 156, 247, 0.08); }
	.filter-icon { width: 14px; height: 14px; opacity: 0.5; }

	.empty { color: #6b7280; font-size: 0.9rem; }

	.group { margin-bottom: 1.25rem; }
	.group-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.4rem;
		padding-left: 0.5rem;
	}
	.group-items {
		background: #161822;
		border: 1px solid #2a2d3a;
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
	.naming-row:hover { background: #1e2030; }

	.color-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.naming-label {
		flex: 1;
		font-size: 0.9rem;
	}

	.memo-icon {
		width: 14px;
		height: 14px;
		opacity: 0.4;
		flex-shrink: 0;
	}

	.naming-count {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.status-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	.status-grounded { opacity: 0.7; filter: brightness(0) saturate(100%) invert(72%) sepia(33%) saturate(589%) hue-rotate(78deg) brightness(96%) contrast(92%); }
	.status-ungrounded { opacity: 0.3; }
</style>
