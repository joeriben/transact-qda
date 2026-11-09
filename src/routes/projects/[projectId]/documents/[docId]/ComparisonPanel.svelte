<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	let {
		projectId,
		docId,
		selection,
		onannotate,
		documentTitle,
		onsimilar,
		mode = 'similar'
	}: {
		projectId: string;
		docId: string;
		selection: { pos0: number; pos1: number; text: string } | null;
		onannotate: (namingId: string) => void;
		documentTitle?: string;
		onsimilar?: (passages: any[] | null) => void;
		mode?: 'anchors' | 'similar';
	} = $props();

	let loading = $state(false);
	let comparing = $state(false);
	let retrieval = $state<any>(null);
	let error = $state<string | null>(null);
	let compareError = $state<string | null>(null);

	// Retrieval scope for the Similar mode
	let scope = $state<'in-document' | 'cross-document'>('in-document');

	// Ein bezahlter Vergleich bleibt stehen, solange die Seite offen ist:
	// je Markierung und Bereich. Umschalten und Zurückkehren holt ihn
	// wieder, statt ihn zu verwerfen.
	let comparisons = $state<Record<string, any>>({});
	const cacheKey = (text: string, s: string) => `${s}\u0000${text}`;
	let comparison = $derived(selection ? comparisons[cacheKey(selection.text, scope)] ?? null : null);
	let comparisonOpen = $state(true);
	// Eigene Namings mit Verankerung im gewählten Bereich — nur gegen sie
	// wird verglichen (naming-companion/retrieval.ts).
	let ownNamingCount = $derived(retrieval?.existingNamings?.length ?? 0);

	// Inline memo state
	let showMemoForm = $state(false);
	let memoText = $state('');
	let memoSaving = $state(false);
	let memoSaved = $state(false);
	let linkedNamingIds = $state<Set<string>>(new Set());

	// Fetch retrieval data when selection or scope changes
	$effect(() => {
		const currentScope = scope; // explicit dependency — triggers refetch on scope change

		showMemoForm = false;
		memoSaved = false;
		compareError = null;

		if (!selection || !selection.text || selection.text.length < 10) {
			retrieval = null;
			return;
		}

		const timeout = setTimeout(() => {
			fetchRetrieval(selection!.text, currentScope);
		}, 400);

		return () => clearTimeout(timeout);
	});

	// Surface the filtered similar passages to the parent whenever retrieval
	// changes, so it can render them in "Ähnliche Stellen" mode (the parent
	// owns the explicit mode switch).
	$effect(() => {
		onsimilar?.(retrieval
			? retrieval.similarPassages.filter((sp: any) => sp.similarity >= 0.75)
			: null);
	});

	async function fetchRetrieval(text: string, currentScope: string) {
		loading = true;
		error = null;
		retrieval = null;

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/naming-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, compare: false, scope: currentScope })
			});

			if (!res.ok) {
				error = `Suche fehlgeschlagen (${res.status})`;
				return;
			}

			const data = await res.json();
			retrieval = data.retrieval;
		} catch (e) {
			error = 'Keine Verbindung zum Server';
		} finally {
			loading = false;
		}
	}

	async function runComparison() {
		if (!selection?.text) return;
		// Schlüssel zum Zeitpunkt der Anfrage: wird währenddessen der Bereich
		// gewechselt, landet das Ergebnis trotzdem bei seinem Bereich.
		const text = selection.text;
		const requestScope = scope;
		comparing = true;
		compareError = null;

		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/naming-companion`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, compare: true, scope: requestScope })
			});
			const data = await res.json().catch(() => null);

			if (!res.ok || !data?.comparison) {
				compareError = data?.error
					? `Vergleich fehlgeschlagen: ${data.error}`
					: `Vergleich fehlgeschlagen (${res.status})`;
				return;
			}

			comparisons = { ...comparisons, [cacheKey(text, requestScope)]: data.comparison };
			comparisonOpen = true;
		} catch (e) {
			compareError = 'Keine Verbindung zum Server';
		} finally {
			comparing = false;
		}
	}

	function openMemoForm() {
		linkedNamingIds = new Set((comparison?.comparisons ?? []).map((c: any) => c.namingId));
		showMemoForm = true;
	}

	function toggleNamingLink(namingId: string) {
		const next = new Set(linkedNamingIds);
		if (next.has(namingId)) next.delete(namingId);
		else next.add(namingId);
		linkedNamingIds = next;
	}

	async function saveMemo() {
		if (!memoText.trim()) return;
		memoSaving = true;

		const passagePreview = selection?.text
			? selection.text.length > 100 ? selection.text.slice(0, 100) + '…' : selection.text
			: '';
		const docLabel = documentTitle || 'Document';

		// Build content with passage reference
		const passageRef = selection
			? `[Passage: "${passagePreview}" (pos ${selection.pos0}–${selection.pos1}, ${docLabel})]\n\n`
			: '';
		const content = passageRef + memoText.trim();

		// Label = first line or first 60 chars
		const firstLine = memoText.trim().split('\n')[0];
		const label = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;

		try {
			const res = await fetch(`/api/projects/${projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label,
					content,
					linkedElementIds: [...linkedNamingIds]
				})
			});

			if (res.ok) {
				memoSaved = true;
				memoText = '';
				showMemoForm = false;
			} else {
				compareError = `Memo nicht gespeichert (${res.status})`;
			}
		} catch (e) {
			compareError = 'Memo nicht gespeichert';
		} finally {
			memoSaving = false;
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

{#if mode === 'similar'}
<div class="comparison-panel">
	{#if loading}
		<div class="loading">Sucht ähnliche Stellen…</div>
	{:else if error}
		<div class="error-msg">{error}</div>
	{:else if retrieval}
		<!-- Scope toggle -->
		<div class="scope-row">
			<button
				class="scope-btn"
				class:active={scope === 'in-document'}
				onclick={() => { scope = 'in-document'; }}
			>Im Dokument</button>
			<button
				class="scope-btn"
				class:active={scope === 'cross-document'}
				onclick={() => { scope = 'cross-document'; }}
			>Alle Dokumente</button>
		</div>

		<!-- LLM-Vergleich: eigener Block mit eigener Zahl. Er vergleicht mit
		     Namings, die Liste darunter zeigt Stellen — zwei Listen, zwei
		     Überschriften. -->
		{#if !comparison}
			<div class="action-row">
				<button
					class="action-btn compare-btn"
					onclick={runComparison}
					disabled={comparing || ownNamingCount === 0}
				>{comparing ? 'Vergleiche…' : 'Vergleich per LLM'}</button>
			</div>
			<div class="compare-hint">
				{#if ownNamingCount === 0}
					Im gewählten Bereich gibt es noch keine eigenen Namings mit Verankerung — nichts, womit verglichen werden könnte.
				{:else}
					Schickt die Markierung und {ownNamingCount} eigene {ownNamingCount === 1 ? 'Naming' : 'Namings'} samt Verankerungen an das eingestellte Sprachmodell.
				{/if}
			</div>
		{:else}
			<button
				class="comparison-head"
				onclick={() => { comparisonOpen = !comparisonOpen; }}
				aria-expanded={comparisonOpen}
			>
				<span class="comparison-caret">{comparisonOpen ? '▾' : '▸'}</span>
				LLM-Vergleich mit deinen Namings
				<span class="comparison-count">{comparison.comparisons.length}</span>
			</button>
			{#if comparisonOpen}
				{#if comparison.comparisons.length === 0}
					<div class="compare-hint">
						Kein Befund: bei keinem der {comparison.comparedWith} verglichenen Namings sah das Modell etwas Tragendes.
					</div>
				{/if}
				{#each comparison.comparisons as comp}
					<div class="comparison-card">
						<div class="comp-header">
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="comp-naming clickable"
								onclick={() => onannotate(comp.namingId)}
								title="Dieses Naming an der markierten Stelle verankern"
							>
								<span class="badge {designationClass(comp.designation)}">{designationBadge(comp.designation)}</span>
								{comp.namingLabel}
							</span>
						</div>
						<div class="comp-analysis">{comp.analysis}</div>
						{#each comp.anchors as a}
							<blockquote class="comp-anchor">„{a.text}“ <span class="comp-anchor-doc">{a.documentTitle}</span></blockquote>
						{/each}
					</div>
				{/each}
				{#if comparison.droppedUnanchored > 0}
					<div class="compare-hint">
						{comparison.droppedUnanchored} {comparison.droppedUnanchored === 1 ? 'Vergleich' : 'Vergleiche'} ohne gültigen Beleg verworfen.
					</div>
				{/if}

				<!-- Inline memo creation -->
				{#if memoSaved}
					<div class="memo-saved">Memo gespeichert</div>
				{:else if showMemoForm}
					<div class="memo-form">
						<div class="section-label">Memo</div>
						<textarea
							class="memo-textarea"
							placeholder="Analytische Notiz…"
							bind:value={memoText}
							rows="3"
						></textarea>
						{#if comparison.comparisons.length > 0}
							<div class="memo-links">
								<span class="memo-links-label">Verknüpfte Namings:</span>
								{#each comparison.comparisons as comp}
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span
										class="memo-naming-chip"
										class:selected={linkedNamingIds.has(comp.namingId)}
										onclick={() => toggleNamingLink(comp.namingId)}
									>
										<span class="badge {designationClass(comp.designation)}">{designationBadge(comp.designation)}</span>
										{comp.namingLabel}
									</span>
								{/each}
							</div>
						{/if}
						<div class="memo-actions">
							<button class="btn-memo-save" onclick={saveMemo} disabled={memoSaving || !memoText.trim()}>
								{memoSaving ? 'Speichert…' : 'Memo speichern'}
							</button>
							<button class="btn-memo-cancel" onclick={() => { showMemoForm = false; memoText = ''; }}>
								Abbrechen
							</button>
						</div>
					</div>
				{:else}
					<button class="btn-create-memo" onclick={openMemoForm}>
						Memo anlegen
					</button>
				{/if}
			{/if}
		{/if}
		{#if compareError}
			<div class="error-msg">{compareError}</div>
		{/if}
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

	.loading, .error-msg, .compare-hint {
		color: #6b7280;
		font-size: 0.75rem;
		padding: 0.25rem 0;
	}
	.error-msg { color: #ef4444; }
	.compare-hint { font-size: 0.7rem; line-height: 1.35; }

	/* Scope toggle */
	.scope-row {
		display: flex;
		gap: 0;
		margin-bottom: 0.4rem;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		overflow: hidden;
	}
	.scope-btn {
		flex: 1;
		padding: 0.25rem 0.4rem;
		background: #0f1117;
		border: none;
		color: #6b7280;
		font-size: 0.68rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.scope-btn:first-child { border-right: 1px solid #2a2d3a; }
	.scope-btn.active {
		background: rgba(139, 156, 247, 0.12);
		color: #8b9cf7;
	}
	.scope-btn:hover:not(.active) { color: #9ca3af; }

	/* Action buttons row */
	.action-row {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.4rem;
	}
	.action-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.35rem 0.4rem;
		background: rgba(139, 156, 247, 0.06);
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b9cf7;
		font-size: 0.72rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.action-btn:hover { background: rgba(139, 156, 247, 0.15); border-color: #8b9cf7; }
	.action-btn:disabled { opacity: 0.5; cursor: default; }

	/* Mode switch (Verankerungen ⇄ Ähnliche Stellen) now lives in the parent
	   panel header; this component renders only the Similar-mode controls. */

	/* Compare (action): stateless — neutral at rest, fill ONLY on hover/press.
	   A persistent fill would read as an "on" state, like the toggle. */
	.compare-btn {
		background: transparent;
		border-color: #3a3f52;
		font-weight: 600;
	}
	.compare-btn:active:not(:disabled) { background: rgba(139, 156, 247, 0.26); }
	.compare-btn:disabled:not(:hover) { opacity: 0.5; }

	.section-label {
		font-size: 0.65rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0.5rem 0 0.25rem;
	}
	.section-label:first-child { margin-top: 0; }

	/* Comparison results */
	.comparison-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		margin: 0.1rem 0 0.35rem;
		padding: 0.2rem 0;
		background: none;
		border: none;
		border-bottom: 1px solid #2a2d3a;
		color: #c9cdd5;
		font-size: 0.72rem;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.comparison-head:hover { color: #e1e4e8; }
	.comparison-caret { color: #6b7280; width: 0.7rem; }
	.comparison-count {
		margin-left: auto;
		color: #6b7280;
		font-weight: 500;
	}
	.comparison-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		margin-bottom: 0.3rem;
	}
	.comp-header { margin-bottom: 0.2rem; }
	.comp-naming {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: #e1e4e8;
	}
	.comp-naming.clickable { cursor: pointer; }
	.comp-naming.clickable:hover { color: #8b9cf7; }
	.comp-analysis {
		color: #9ca3af;
		line-height: 1.4;
	}
	/* Der Beleg: die Verankerung des Namings, auf die sich der Vergleich stützt. */
	.comp-anchor {
		margin: 0.3rem 0 0;
		padding: 0.15rem 0 0.15rem 0.45rem;
		border-left: 2px solid #3a3f52;
		color: #c9cdd5;
		font-style: italic;
		line-height: 1.35;
	}
	.comp-anchor-doc {
		font-style: normal;
		color: #4b5563;
		font-size: 0.66rem;
	}

	/* Designation badges — CCS-Farben aus tokens.css */
	.badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 600;
		padding: 0.05rem 0.25rem;
		border-radius: 3px;
		line-height: 1.2;
		background: #252840;
	}
	.badge-c { color: var(--ccs-cue); }
	.badge-ch { color: var(--ccs-char); }
	.badge-sp { color: var(--ccs-spec); }

	/* Create Memo button */
	.btn-create-memo {
		margin-top: 0.5rem;
		width: 100%;
		padding: 0.4rem;
		background: rgba(76, 175, 80, 0.08);
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #4ade80;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-create-memo:hover { background: rgba(76, 175, 80, 0.15); border-color: #4ade80; }

	/* Memo form */
	.memo-form {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: #1e2030;
		border: 1px solid #4ade80;
		border-radius: 6px;
	}
	.memo-textarea {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem;
		color: #e1e4e8;
		font-size: 0.78rem;
		font-family: system-ui, sans-serif;
		resize: vertical;
		box-sizing: border-box;
	}
	.memo-textarea:focus { outline: none; border-color: #4ade80; }

	.memo-links {
		margin-top: 0.35rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}
	.memo-links-label {
		font-size: 0.65rem;
		color: #6b7280;
		margin-right: 0.15rem;
	}
	.memo-naming-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.68rem;
		color: #9ca3af;
		background: #252840;
		border: 1px solid #2a2d3a;
		border-radius: 3px;
		padding: 0.1rem 0.3rem;
		cursor: pointer;
		transition: all 0.15s;
	}
	.memo-naming-chip.selected {
		border-color: #4ade80;
		color: #e1e4e8;
		background: rgba(76, 175, 80, 0.1);
	}
	.memo-naming-chip:hover { border-color: #4ade80; }

	.memo-actions {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}
	.btn-memo-save {
		flex: 1;
		padding: 0.35rem;
		background: rgba(76, 175, 80, 0.12);
		border: 1px solid #4ade80;
		border-radius: 4px;
		color: #4ade80;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-memo-save:hover { background: rgba(76, 175, 80, 0.2); }
	.btn-memo-save:disabled { opacity: 0.4; cursor: default; }
	.btn-memo-cancel {
		padding: 0.35rem 0.5rem;
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #6b7280;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.btn-memo-cancel:hover { color: #e1e4e8; border-color: #6b7280; }

	.memo-saved {
		margin-top: 0.5rem;
		padding: 0.35rem;
		text-align: center;
		color: #4ade80;
		font-size: 0.75rem;
		background: rgba(76, 175, 80, 0.08);
		border: 1px solid rgba(76, 175, 80, 0.2);
		border-radius: 4px;
	}
</style>
