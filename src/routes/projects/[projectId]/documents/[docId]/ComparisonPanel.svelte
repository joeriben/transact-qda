<script lang="ts">
	let {
		projectId,
		docId,
		selection,
		onannotate
	}: {
		projectId: string;
		docId: string;
		selection: { pos0: number; pos1: number; text: string } | null;
		onannotate: (codeId: string) => void;
	} = $props();

	// Determine elementId from selection position (if within a parsed element)
	let elements: any[] = $state([]);

	let loading = $state(false);
	let comparing = $state(false);
	let retrieval = $state<any>(null);
	let comparison = $state<any>(null);
	let error = $state<string | null>(null);
	let compareEnabled = $state(false);

	// Fetch retrieval data when selection changes
	$effect(() => {
		if (!selection || !selection.text || selection.text.length < 10) {
			retrieval = null;
			comparison = null;
			return;
		}

		// Debounce: wait 400ms after selection stabilizes
		const timeout = setTimeout(() => {
			fetchRetrieval(selection!.text);
		}, 400);

		return () => clearTimeout(timeout);
	});

	async function fetchRetrieval(text: string) {
		loading = true;
		error = null;
		retrieval = null;
		comparison = null;

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, compare: false })
			});

			if (!res.ok) {
				error = `Retrieval failed (${res.status})`;
				return;
			}

			const data = await res.json();
			retrieval = data.retrieval;
		} catch (e) {
			error = 'Connection error';
		} finally {
			loading = false;
		}
	}

	async function runComparison() {
		if (!selection?.text) return;
		comparing = true;
		error = null;

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: selection.text, compare: true })
			});

			if (!res.ok) {
				error = `Comparison failed (${res.status})`;
				return;
			}

			const data = await res.json();
			retrieval = data.retrieval;
			comparison = data.comparison;
		} catch (e) {
			error = 'Connection error';
		} finally {
			comparing = false;
		}
	}

	function designationBadge(d: string): string {
		switch (d) {
			case 'cue': return 'C';
			case 'characterization': return 'Ch';
			case 'specification': return 'Sp';
			default: return 'C';
		}
	}

	function designationClass(d: string): string {
		switch (d) {
			case 'characterization': return 'badge-ch';
			case 'specification': return 'badge-sp';
			default: return 'badge-c';
		}
	}
</script>

{#if loading}
	<div class="comparison-panel">
		<div class="loading">Retrieving comparison material...</div>
	</div>
{:else if error}
	<div class="comparison-panel">
		<div class="error-msg">{error}</div>
	</div>
{:else if retrieval}
	<div class="comparison-panel">
		{#if comparison}
			<!-- LLM comparison results -->
			{#if comparison.comparisons.length > 0}
				<div class="section-label">Comparison</div>
				{#each comparison.comparisons as comp}
					<div class="comparison-card">
						<div class="comp-header">
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="comp-code clickable"
								onclick={() => onannotate(comp.codeId)}
								title="Click to annotate with this code"
							>
								<span class="badge {designationClass(comp.designation)}">{designationBadge(comp.designation)}</span>
								{comp.codeLabel}
							</span>
						</div>
						<div class="comp-analysis">{comp.analysis}</div>
					</div>
				{/each}
			{/if}

			{#if comparison.questions.length > 0}
				<div class="section-label">Questions</div>
				<ul class="questions-list">
					{#each comparison.questions as q}
						<li>{q}</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<!-- Retrieval-only: show similar coded passages -->
			{@const codedPassages = retrieval.similarPassages.filter((sp: any) => sp.codes.length > 0)}
			{#if codedPassages.length > 0}
				<div class="section-label">Similar coded passages</div>
				{#each codedPassages.slice(0, 5) as sp}
					<div class="similar-card">
						<div class="similar-codes">
							{#each sp.codes as code}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span
									class="code-tag clickable"
									onclick={() => onannotate(code.id)}
									title="Click to annotate with this code"
								>
									<span class="badge {designationClass(code.designation)}">{designationBadge(code.designation)}</span>
									{code.label}
								</span>
							{/each}
						</div>
						<div class="similar-text">"{sp.content.length > 120 ? sp.content.slice(0, 120) + '\u2026' : sp.content}"</div>
						<div class="similar-doc">{sp.documentTitle}</div>
					</div>
				{/each}
			{:else if retrieval.existingCodes.length === 0}
				<div class="empty-hint">No codes yet. Create the first one above.</div>
			{:else}
				<div class="empty-hint">No similar coded passages found.</div>
			{/if}

			<!-- Compare button -->
			<button class="btn-compare" onclick={runComparison} disabled={comparing}>
				{comparing ? 'Comparing...' : 'Compare (LLM)'}
			</button>
		{/if}
	</div>
{/if}

<style>
	.comparison-panel {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.6rem;
		font-size: 0.78rem;
	}

	.loading, .error-msg, .empty-hint {
		color: #6b7280;
		font-size: 0.75rem;
		padding: 0.25rem 0;
	}

	.error-msg { color: #ef4444; }

	.section-label {
		font-size: 0.65rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0.4rem 0 0.25rem;
	}
	.section-label:first-child { margin-top: 0; }

	/* Similar passages (retrieval only) */
	.similar-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		margin-bottom: 0.3rem;
	}

	.similar-codes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.2rem;
	}

	.code-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: #c9cdd5;
		background: #252840;
		border: 1px solid #2a2d3a;
		border-radius: 3px;
		padding: 0.1rem 0.35rem;
	}

	.code-tag.clickable { cursor: pointer; }
	.code-tag.clickable:hover { border-color: #8b9cf7; color: #fff; }

	.similar-text {
		color: #9ca3af;
		font-style: italic;
		line-height: 1.3;
		margin-bottom: 0.15rem;
	}

	.similar-doc {
		color: #4b5563;
		font-size: 0.68rem;
	}

	/* Comparison results (LLM) */
	.comparison-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		margin-bottom: 0.3rem;
	}

	.comp-header {
		margin-bottom: 0.2rem;
	}

	.comp-code {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: #e1e4e8;
	}
	.comp-code.clickable { cursor: pointer; }
	.comp-code.clickable:hover { color: #8b9cf7; }

	.comp-analysis {
		color: #9ca3af;
		line-height: 1.4;
	}

	/* Designation badges */
	.badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 600;
		padding: 0.05rem 0.25rem;
		border-radius: 3px;
		line-height: 1.2;
	}
	.badge-c { background: #374151; color: #9ca3af; }
	.badge-ch { background: #1e3a5f; color: #60a5fa; }
	.badge-sp { background: #1a3b2a; color: #4ade80; }

	/* Questions */
	.questions-list {
		margin: 0;
		padding-left: 1.2rem;
		color: #d1d5db;
		line-height: 1.5;
	}
	.questions-list li { margin-bottom: 0.2rem; }

	/* Compare button */
	.btn-compare {
		margin-top: 0.4rem;
		width: 100%;
		padding: 0.35rem;
		background: rgba(139, 156, 247, 0.08);
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b9cf7;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-compare:hover { background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; }
	.btn-compare:disabled { opacity: 0.5; cursor: wait; }
</style>
