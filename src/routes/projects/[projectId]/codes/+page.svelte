<script lang="ts">
	let { data } = $props();

	let filterStatus = $state<'all' | 'grounded' | 'ungrounded'>('all');

	type Candidate = {
		id: string;
		label: string;
		color: string | null;
		has_document_anchor: boolean;
	};

	const filtered = $derived(
		filterStatus === 'all'
			? data.candidates
			: data.candidates.filter((c: Candidate) =>
				filterStatus === 'grounded' ? c.has_document_anchor : !c.has_document_anchor
			)
	);

	const groundedCount = $derived((data.candidates as Candidate[]).filter(c => c.has_document_anchor).length);
	const totalCount = $derived((data.candidates as Candidate[]).length);
</script>

<div class="namings-page">
	<div class="header">
		<h1>Namings</h1>
		<span class="summary">{groundedCount} / {totalCount} grounded</span>
	</div>

	<div class="filter-bar">
		<button class="filter-btn" class:active={filterStatus === 'all'} onclick={() => filterStatus = 'all'}>All</button>
		<button class="filter-btn" class:active={filterStatus === 'grounded'} onclick={() => filterStatus = 'grounded'}>Grounded</button>
		<button class="filter-btn" class:active={filterStatus === 'ungrounded'} onclick={() => filterStatus = 'ungrounded'}>Ungrounded</button>
	</div>

	{#if filtered.length === 0}
		<p class="empty">No namings yet.</p>
	{:else}
		<div class="naming-list">
			{#each filtered as c (c.id)}
				<div class="naming-row">
					<span class="color-dot" style="background: {c.color || '#8b9cf7'}"></span>
					<span class="naming-label">{c.label}</span>
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
	{/if}
</div>

<style>
	.namings-page { max-width: 700px; }

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

	.empty { color: #6b7280; font-size: 0.9rem; }

	.naming-list {
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

	.status-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
	.status-grounded { opacity: 0.7; filter: brightness(0) saturate(100%) invert(72%) sepia(33%) saturate(589%) hue-rotate(78deg) brightness(96%) contrast(92%); }
	.status-ungrounded { opacity: 0.3; }
</style>
