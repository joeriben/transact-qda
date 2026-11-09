<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { focusSelect } from '$lib/canvas/dom.js';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TechnicalErrorButton from '$lib/components/TechnicalErrorButton.svelte';
	import FilterBar, { type FilterGroup } from '$lib/components/FilterBar.svelte';
	import { memoText } from '$lib/shared/memoText.js';
	import { formatWhen } from '$lib/shared/dates.js';
	import { plural } from '$lib/shared/plural.js';
	import { quoted } from '$lib/shared/namingLabel.js';

	let { data } = $props();

	type Persona = 'researcher' | 'cowork' | 'autonoma';

	// Zwei Memo-Arten: analytische Memos (eigene Einträge mit Status) und
	// Memos ZU einem Naming (Akte in dessen Stack, siehe +page.server.ts).
	let filterKind = $state<'all' | 'analytic' | 'naming'>('all');
	const namingMemos = $derived(data.namingMemos ?? []);
	let expandedNote = $state<string | null>(null);

	let filterStatus = $state<string>('all');
	let filterAuthor = $state<'all' | Persona>('all');
	let showCreate = $state(false);
	let newLabel = $state('');
	let newContent = $state('');
	let creating = $state(false);
	let createError = $state('');
	// Bestätigung nach „technical error" (aus der Liste oder, über ?hidden=,
	// von der Detailseite): ausgeblendet ist nicht gelöscht.
	let hiddenNotice = $state<string | null>(null);
	/** Nach „promote“: welches Memo jetzt ein Naming ist (Hinweis mit Link). */
	let promotedNotice = $state<string | null>(null);
	$effect(() => {
		const what = new URL(window.location.href).searchParams.get('hidden');
		if (what) hiddenNotice = what;
	});
	// Abbrechen verwirft den Entwurf — wie beim Projekt- und Map-Formular.
	// Schließen (Escape, Knopf) verwirft nichts: Titel und Text bleiben als
	// Entwurf stehen, bis man wieder „New memo" öffnet (Testlauf 11: Escape
	// verwarf einen getippten Titel ohne Rückfrage). Nach dem Anlegen führt die
	// Seite ohnehin zum neuen Memo.
	function closeCreate() {
		showCreate = false;
		createError = '';
	}
	const hasDraft = $derived(!showCreate && !!(newLabel.trim() || newContent.trim()));
	let expandedId = $state<string | null>(null);

	// Discussion
	let discussTarget = $state<string | null>(null);
	let discussInput = $state('');
	let discussLoading = $state(false);

	function memoPersona(m: any): Persona {
		if (!m.isAiAuthored) return 'researcher';
		const label: string = m.label || '';
		if (/^Autonoma[:\s]/i.test(label) || /^Document:/i.test(label) || /^Formation:/i.test(label) || /^Near-duplicates:/i.test(label)) return 'autonoma';
		return 'cowork';
	}

	// Memos zu einem Naming schreibt die Forscherin; den Lebenszyklus der
	// KI-Hinweise (presented, acknowledged, dismissed …) haben sie nicht.
	const NAMING_MEMO_STATUS = 'active';

	const authorOk = (p: Persona) => filterAuthor === 'all' || filterAuthor === p;
	const statusOk = (s: string) => filterStatus === 'all' || filterStatus === s;
	const kindOk = (k: 'analytic' | 'naming') => filterKind === 'all' || filterKind === k;

	const filteredMemos = $derived(
		kindOk('analytic') ? data.memos.filter((m: any) => authorOk(memoPersona(m)) && statusOk(m.status)) : []
	);
	const filteredNamingMemos = $derived(
		kindOk('naming') && authorOk('researcher') && statusOk(NAMING_MEMO_STATUS) ? namingMemos : []
	);

	// Jede Zahl zählt die Memos, die man sieht, wenn man diese Option wählt —
	// die übrigen Filter gelten weiter.
	const kindCounts = $derived.by(() => {
		const analytic = data.memos.filter((m: any) => authorOk(memoPersona(m)) && statusOk(m.status)).length;
		const naming = authorOk('researcher') && statusOk(NAMING_MEMO_STATUS) ? namingMemos.length : 0;
		return { all: analytic + naming, analytic, naming };
	});

	const statusCounts = $derived.by(() => {
		const counts: Record<string, number> = { all: 0 };
		const add = (s: string, n = 1) => { counts.all += n; counts[s] = (counts[s] || 0) + n; };
		if (kindOk('analytic')) {
			for (const m of data.memos) if (authorOk(memoPersona(m))) add(m.status);
		}
		if (kindOk('naming') && authorOk('researcher') && namingMemos.length > 0) {
			add(NAMING_MEMO_STATUS, namingMemos.length);
		}
		return counts;
	});

	// Der Status-Filter erscheint nur, wenn es etwas zu unterscheiden gibt
	// (sonst stünde da „All 13 / active 13") — oder wenn er gerade greift.
	const showStatusFilter = $derived(
		filterStatus !== 'all' || Object.keys(statusCounts).some((s) => s !== 'all' && s !== 'active')
	);
	const hasAutonomaMemos = $derived(data.memos.some((m: any) => memoPersona(m) === 'autonoma'));

	async function createMemo() {
		if (!newLabel.trim()) return;
		creating = true;
		const res = await fetch(`/api/projects/${data.projectId}/memos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: newLabel.trim(), content: newContent.trim() })
		});
		if (res.ok) {
			const memo = await res.json();
			window.location.href = `/projects/${data.projectId}/memos/${memo.id}`;
			return;
		}
		const body = await res.json().catch(() => ({}));
		createError = body.error || `Memo not created (${res.status})`;
		creating = false;
	}

	async function refreshMemos() {
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	async function setStatus(memoId: string, status: string) {
		const res = await fetch(`/api/projects/${data.projectId}/memos/${memoId}/status`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		// „promote" macht das Memo zu einem Naming (wie auf der Map); scheitert
		// es, soll man es sehen.
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			alert(body.error || `Status not saved (${res.status})`);
		} else if (status === 'promoted') {
			// Der Name, den das neue Naming trägt (ohne „Cowork:"), nicht der
			// Memo-Titel (Testlauf 11).
			const body = await res.json().catch(() => ({}));
			const m = (data.memos as { id: string; label: string }[]).find((x) => x.id === memoId);
			promotedNotice = body.inscription || m?.label || 'The memo';
		}
		await refreshMemos();
	}

	async function submitDiscussion(memoId: string) {
		if (!discussInput.trim() || discussLoading) return;
		discussLoading = true;
		// Use the map action endpoint — discussMemo works without a specific map context
		// We need to find a map to route through. Use the first available map.
		const mapsRes = await fetch(`/api/projects/${data.projectId}/maps`);
		if (!mapsRes.ok) { discussLoading = false; return; }
		const maps = await mapsRes.json();
		if (maps.length === 0) { discussLoading = false; return; }
		const mapId = maps[0].id;

		await fetch(`/api/projects/${data.projectId}/maps/${mapId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'discussMemo', memoId, message: discussInput.trim() })
		});
		discussInput = '';
		discussTarget = null;
		discussLoading = false;
		await refreshMemos();
	}

	function statusColor(status: string): string {
		if (status === 'presented') return '#8b9cf7';
		if (status === 'discussed') return '#f59e0b';
		if (status === 'acknowledged') return '#10b981';
		if (status === 'promoted') return '#10b981';
		if (status === 'dismissed') return '#6b7280';
		return '#9ca3af';
	}

	const filterGroups = $derived.by<FilterGroup[]>(() => {
		const statusOptions = [
			{ value: 'all', label: `All ${statusCounts.all}` },
			...['presented', 'active', 'discussed', 'acknowledged', 'promoted', 'dismissed']
				.filter(s => statusCounts[s] || filterStatus === s)
				.map(s => ({ value: s, label: `${s} ${statusCounts[s] || 0}` }))
		];
		const authorOptions = [
			{ value: 'all', label: 'All' },
			{ value: 'researcher', label: 'Researcher' },
			{ value: 'cowork', label: 'Cowork' },
			// Autonoma ist seit 04.08.2026 deprecated; der Filter bleibt nur für
			// Memos aus älteren Läufen.
			...(hasAutonomaMemos || filterAuthor === 'autonoma'
				? [{ value: 'autonoma', label: 'Autonoma', title: 'Memos from earlier Autonoma runs (Autonoma is deprecated since August 2026)' }]
				: [])
		];
		return [
			{
				key: 'kind',
				label: 'Memos',
				value: filterKind,
				options: [
					{ value: 'all', label: `All ${kindCounts.all}` },
					{ value: 'analytic', label: `Analytic ${kindCounts.analytic}`, title: 'Analytic and organizational memos' },
					{ value: 'naming', label: `On namings ${kindCounts.naming}`, title: 'Memos on a single naming, written in its stack' }
				],
				onchange: (v: string) => filterKind = v as typeof filterKind
			},
			...(showStatusFilter ? [{
				key: 'status',
				label: 'Status',
				title: 'Lifecycle of AI hints (presented, acknowledged, dismissed …). Your own memos stay active.',
				value: filterStatus,
				options: statusOptions,
				onchange: (v: string) => filterStatus = v
			}] : []),
			// Bei „On namings" gibt es nur Memos der Forschenden; der Filter
			// bleibt sichtbar, solange er greift.
			...(filterKind !== 'naming' || filterAuthor !== 'all' ? [{
				key: 'author',
				label: 'Author',
				value: filterAuthor,
				options: authorOptions,
				onchange: (v: string) => filterAuthor = v as typeof filterAuthor
			}] : [])
		];
	});
</script>

<!-- Escape schließt das Formular, wo immer der Fokus gerade steht. -->
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && showCreate) closeCreate(); }} />

<div class="memos-page">
	<PageHeader title="Memos">
		{#snippet actions()}
			<button class="btn-primary" onclick={() => (showCreate ? closeCreate() : (showCreate = true))}>
				{showCreate ? 'Close' : hasDraft ? 'New memo (draft)' : 'New memo'}
			</button>
		{/snippet}
		{#snippet filterBar()}
			<FilterBar groups={filterGroups} />
		{/snippet}
		{#snippet afterHeader()}
			{#if promotedNotice}
				<div class="hidden-notice" role="status">
					<span>{quoted(promotedNotice)} is now a naming of its own, unplaced on the situational map. The memo stays here. <a href="/projects/{data.projectId}/namings">Open the naming list</a></span>
					<button class="btn-xs" onclick={() => (promotedNotice = null)} aria-label="Dismiss message">×</button>
				</div>
			{/if}
			{#if hiddenNotice}
				<div class="hidden-notice" role="status">
					<span>The {hiddenNotice} is hidden as a technical error. Nothing was deleted: it stays in the database, with this act on record.</span>
					<button class="btn-xs" onclick={() => (hiddenNotice = null)} aria-label="Dismiss message">×</button>
				</div>
			{/if}
			{#if showCreate}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<form class="create-form" onsubmit={e => { e.preventDefault(); createMemo(); }}
					onkeydown={(e) => {
						if (e.key === 'Escape') { e.stopPropagation(); closeCreate(); }
						// ⌘↵ legt an, aus Titel und Text (Testlauf 10).
						else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!creating) createMemo(); }
					}}>
					<div class="create-fields">
						<input type="text" placeholder="Memo title" aria-label="Memo title" bind:value={newLabel} required use:focusSelect />
						<textarea placeholder="Text (optional, you can also write it on the next page)" aria-label="Memo text"
							rows="4" bind:value={newContent}></textarea>
						{#if createError}<span class="create-error" role="alert">{createError}</span>{/if}
					</div>
					<div class="create-actions">
						<button type="submit" class="btn-primary" disabled={creating || !newLabel.trim()} title="Create (⌘↵)">Create</button>
						{#if newLabel.trim() || newContent.trim()}
							<button type="button" class="btn-link-sm" onclick={() => { newLabel = ''; newContent = ''; closeCreate(); }}>discard draft</button>
						{/if}
						<span class="create-hint">⌘↵ saves · Esc keeps the draft</span>
					</div>
				</form>
			{/if}
		{/snippet}
	</PageHeader>

	{#if filterKind !== 'naming'}
	{#if filterKind === 'all'}<h2 class="memo-section">Analytic memos</h2>{/if}
	{#if filteredMemos.length === 0}
		<p class="empty">{data.memos.length === 0 ? 'No analytic memos yet.' : 'No memos match these filters.'}</p>
	{:else}
		<div class="memo-list">
			{#each filteredMemos as memo}
				<div class="memo-card" class:memo-ai={memo.isAiAuthored} class:memo-dismissed={memo.status === 'dismissed'} class:expanded={expandedId === memo.id}>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="memo-card-header" onclick={() => expandedId = expandedId === memo.id ? null : memo.id}>
						<span class="author-badge" class:badge-ai={memo.isAiAuthored}>
							{memo.isAiAuthored ? 'AI' : 'R'}
						</span>
						{#if memo.status !== 'active'}
							<span class="status-badge" style="color: {statusColor(memo.status)}; border-color: {statusColor(memo.status)}">
								{memo.status}
							</span>
						{/if}
						<span class="memo-title">{memo.label}</span>
						{#if memo.discussion?.length > 0}
							<span class="discussion-count" title={plural(memo.discussion.length, 'discussion turn')}>{memo.discussion.length}</span>
						{/if}
						{#if memo.links?.length > 0}
							<!-- Wenige Bezüge beim Namen (ein Map-Memo nennt seine Map; vorher
							     nur „1 link", Testlauf 09.11.), viele als Zahl. -->
							<span class="link-count" title={memo.links.map((l: any) => l.label).join(', ')}>
								{memo.links.length <= 2 ? `on ${memo.links.map((l: any) => `“${l.label}”`).join(', ')}` : `${memo.links.length} links`}
							</span>
						{/if}
						<span class="memo-date">{formatWhen(memo.created_at)}</span>
						<span class="expand-indicator">{expandedId === memo.id ? '▾' : '▸'}</span>
					</div>

					{#if expandedId !== memo.id && memo.content}
						{@const preview = memoText(memo.content)}
						<p class="memo-preview">{preview.slice(0, 200)}{preview.length > 200 ? '...' : ''}</p>
					{/if}

					{#if expandedId === memo.id}
						<!-- Full content -->
						{#if memo.content}
							<div class="memo-content">{memoText(memo.content)}</div>
						{/if}

						<!-- Linked elements -->
						{#if memo.links?.length > 0}
							<div class="memo-links">
								<span class="section-label">Linked elements</span>
								<div class="link-chips">
									{#each memo.links as link}
										<span class="link-chip" title={link.mode}>
											<span class="link-chip-mode">{link.mode === 'relation' ? '↔' : link.mode === 'silence' ? '∅' : link.mode === 'perspective' ? 'map' : '●'}</span>
											{link.label}
										</span>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Discussion thread -->
						{#if memo.discussion?.length > 0}
							<div class="memo-discussion">
								<span class="section-label">Discussion</span>
								{#each memo.discussion as turn}
									<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
										<span class="turn-role">{turn.role === 'researcher' ? 'You' : 'AI'}{turn.type === 'revise' ? ' (revised)' : ''}</span>
										<span class="turn-content">{turn.content}</span>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Actions. ack/dismiss/promote/discuss gehören zum Lebenszyklus
						     eines KI-Hinweises; an eigenen Memos bleibt „edit". -->
						<div class="memo-actions">
							<a href="/projects/{data.projectId}/memos/{memo.id}" class="btn-xs btn-edit"
								title={memo.isAiAuthored ? 'Cowork’s memos are not edited — judge it, or write a memo of your own' : undefined}>{memo.isAiAuthored ? 'open' : 'edit'}</a>
							{#if memo.isAiAuthored}
								{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'acknowledged')}>ack</button>
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
									<button class="btn-xs btn-promote" onclick={() => setStatus(memo.id, 'promoted')}>promote</button>
								{/if}
								{#if memo.status === 'acknowledged'}
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
									<button class="btn-xs btn-promote" onclick={() => setStatus(memo.id, 'promoted')} title="Acknowledged is not taken in — promote takes it in">promote</button>
								{/if}
								{#if memo.status === 'dismissed'}
									<button class="btn-xs" onclick={() => setStatus(memo.id, 'presented')}>restore</button>
								{/if}
								{#if discussTarget === memo.id}
									<form class="discuss-form" onsubmit={e => { e.preventDefault(); submitDiscussion(memo.id); }}>
										<input type="text" placeholder="Discuss this memo..." bind:value={discussInput} disabled={discussLoading} />
										<button type="submit" class="btn-xs" disabled={discussLoading || !discussInput.trim()}>
											{discussLoading ? '...' : 'send'}
										</button>
										<button type="button" class="btn-xs" onclick={() => { discussTarget = null; discussInput = ''; }}>×</button>
									</form>
								{:else if memo.status !== 'dismissed'}
									<button class="btn-xs btn-discuss" onclick={() => { discussTarget = memo.id; discussInput = ''; }}>discuss</button>
								{/if}
							{:else if memo.status === 'dismissed'}
								<!-- Altbestand: eigene Memos, die früher verworfen wurden -->
								<button class="btn-xs" onclick={() => setStatus(memo.id, 'active')}>restore</button>
							{:else if memo.status !== 'promoted'}
								<!-- Ein analytisches oder Organisationsmemo ist „kein Naming, solange
								     man sie nicht dezidiert zu einem Naming macht" (S16) — hier macht man es. -->
								<button class="btn-xs btn-promote" onclick={() => setStatus(memo.id, 'promoted')}
									title="Make this memo a naming of its own. The memo stays; the new naming stands unplaced on the situational map.">make naming</button>
							{/if}
							<TechnicalErrorButton projectId={data.projectId} namingId={memo.id} what="memo"
								ondone={async () => { hiddenNotice = 'memo'; await refreshMemos(); }} />
						</div>
					{:else}
						<!-- Collapsed actions -->
						<div class="memo-card-meta">
							<div class="quick-actions">
								{#if memo.isAiAuthored}
									<!-- Dieselben Urteile wie aufgeklappt (Testlauf 10: „promote" fehlte
									     hier, obwohl der Hinweistext es für die Memo-Seite verspricht). -->
									{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
										<button class="btn-xs" onclick={() => setStatus(memo.id, 'acknowledged')}>ack</button>
										<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
										<button class="btn-xs btn-promote" onclick={() => setStatus(memo.id, 'promoted')}>promote</button>
									{/if}
									{#if memo.status === 'acknowledged'}
										<button class="btn-xs" onclick={() => setStatus(memo.id, 'dismissed')}>dismiss</button>
										<button class="btn-xs btn-promote" onclick={() => setStatus(memo.id, 'promoted')} title="Acknowledged is not taken in — promote takes it in">promote</button>
									{/if}
									{#if memo.status === 'dismissed'}
										<button class="btn-xs" onclick={() => setStatus(memo.id, 'presented')}>restore</button>
									{/if}
								{:else}
									<a href="/projects/{data.projectId}/memos/{memo.id}" class="btn-xs btn-edit">{memo.isAiAuthored ? 'open' : 'edit'}</a>
									{#if memo.status === 'dismissed'}
										<button class="btn-xs" onclick={() => setStatus(memo.id, 'active')}>restore</button>
									{/if}
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{/if}

	{#if filterKind !== 'analytic'}
		{#if filterKind === 'all'}<h2 class="memo-section">Memos on namings</h2>{/if}
		{#if namingMemos.length === 0}
			<p class="empty">No memos on namings yet. Write one from the naming itself (+ Memo): in the namings list, on the naming's page, or in its stack on a map.</p>
		{:else if filteredNamingMemos.length === 0}
			<p class="empty">No memos match these filters.</p>
		{:else}
			<div class="memo-list">
				{#each filteredNamingMemos as nm (nm.naming_id + ':' + nm.seq)}
					{@const key = nm.naming_id + ':' + nm.seq}
					<div class="memo-card note-card" class:expanded={expandedNote === key}>
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="memo-card-header" onclick={() => expandedNote = expandedNote === key ? null : key}>
							<span class="author-badge" title={nm.by_label}>R</span>
							<a class="memo-title note-naming" href="/projects/{data.projectId}/namings/{nm.naming_id}"
								title="Open this naming" onclick={(e) => e.stopPropagation()}>{nm.naming_label}</a>
							{#if nm.passage_document}<span class="note-passage" title="Memo on a passage of this naming">passage · {nm.passage_document}</span>{/if}
							{#if nm.merged_from}<span class="note-passage" title="Written on a naming that was later merged into this one">from merged {quoted(nm.merged_from)}</span>{/if}
							{#if nm.act}<span class="note-passage" title="The act this memo belongs to">{nm.act}</span>{/if}
							<span class="memo-date">{formatWhen(nm.created_at)}</span>
							<span class="expand-indicator">{expandedNote === key ? '▾' : '▸'}</span>
						</div>
						{#if expandedNote === key}
							<div class="memo-content">{nm.memo_text}</div>
						{:else}
							<p class="memo-preview">{nm.memo_text.slice(0, 200)}{nm.memo_text.length > 200 ? '...' : ''}</p>
						{/if}
						{#if nm.linked?.length > 0}
							<div class="link-chips note-links">
								{#each nm.linked as l (l.id)}
									<a class="link-chip" href="/projects/{data.projectId}/namings/{l.id}">{l.label}</a>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.memo-section {
		font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
		color: #6b7280; margin: 1.25rem 0 0.5rem;
	}
	.note-card { border-left: 3px solid rgba(245, 158, 11, 0.35); }
	a.note-naming { text-decoration: none; }
	a.note-naming:hover { color: #8b9cf7; text-decoration: underline; }
	.note-passage { font-size: 0.68rem; color: #8b8fa3; flex-shrink: 0; }
	.note-links { margin-top: 0.35rem; }
	a.link-chip { text-decoration: none; }
	a.link-chip:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.memos-page { max-width: 750px; }

	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }

	.create-form {
		display: flex; gap: 0.75rem; background: #161822; border: 1px solid #2a2d3a;
		border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;
	}
	.create-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
	}
	.create-form input:focus, .create-form textarea:focus { outline: none; border-color: #8b9cf7; }
	.create-form { align-items: flex-start; }
	.create-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem; }
	.create-hint { font-size: 0.72rem; color: #6b7280; white-space: nowrap; }
	.btn-link-sm { background: none; border: none; color: #9ca3af; font-size: 0.75rem; cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 2px; }
	.btn-link-sm:hover { color: #e1e4e8; }
	.create-fields { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
	.create-form textarea {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem; font-family: inherit; resize: vertical;
	}
	.create-error { color: #ef4444; font-size: 0.8rem; }
	.hidden-notice {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		background: #1c1a12; border: 1px solid #b45309; border-radius: 6px;
		padding: 0.5rem 0.75rem; margin-bottom: 1rem; color: #f5d08a; font-size: 0.85rem;
	}

	.empty { color: #6b7280; font-size: 0.9rem; padding: 2rem 0; text-align: center; }

	/* Memo cards */
	.memo-list { display: flex; flex-direction: column; gap: 0.4rem; }
	.memo-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.75rem 1rem; transition: border-color 0.15s;
	}
	.memo-card:hover { border-color: #3a3d5a; }
	.memo-card.expanded { border-color: #3a3d5a; }
	.memo-card.memo-dismissed { opacity: 0.5; }
	.memo-card.memo-ai { border-left: 3px solid rgba(139, 156, 247, 0.3); }

	.memo-card-header {
		display: flex; align-items: center; gap: 0.5rem; cursor: pointer;
	}
	.memo-card-header:hover .memo-title { color: #8b9cf7; }
	.author-badge {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0.05rem 0.3rem; border-radius: 3px; flex-shrink: 0;
	}
	.author-badge.badge-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.status-badge {
		font-size: 0.58rem; font-weight: 600; text-transform: uppercase;
		border: 1px solid; padding: 0.05rem 0.35rem; border-radius: 3px; flex-shrink: 0;
	}
	.memo-title {
		flex: 1; font-size: 0.9rem; font-weight: 600; color: #e1e4e8;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.discussion-count {
		font-size: 0.6rem; font-weight: 700; color: #8b9cf7;
		background: rgba(139, 156, 247, 0.12); border-radius: 8px;
		padding: 0 4px; min-width: 14px; height: 14px; line-height: 14px;
		text-align: center; flex-shrink: 0;
	}
	.link-count { font-size: 0.7rem; color: #6b7280; flex-shrink: 0; }
	.memo-date { font-size: 0.7rem; color: #4b5563; flex-shrink: 0; }
	.expand-indicator { font-size: 0.7rem; color: #4b5563; flex-shrink: 0; }

	.memo-preview {
		font-size: 0.8rem; color: #8b8fa3; margin: 0.3rem 0 0;
		line-height: 1.4; max-height: 2.8em; overflow: hidden;
	}

	/* Expanded content */
	.memo-content {
		font-size: 0.85rem; color: #c9cdd5; margin: 0.5rem 0;
		line-height: 1.6; white-space: pre-wrap;
		max-height: 12em; overflow-y: auto;
		padding: 0.5rem; background: #0f1117; border-radius: 4px;
	}

	/* Linked elements */
	.memo-links { margin: 0.5rem 0; }
	.section-label {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; display: block; margin-bottom: 0.3rem;
	}
	.link-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.link-chip {
		display: inline-flex; align-items: center; gap: 0.25rem;
		font-size: 0.75rem; color: #c9cdd5; background: #1e2030;
		border: 1px solid #2a2d3a; border-radius: 4px; padding: 0.15rem 0.5rem;
	}
	.link-chip-mode { font-size: 0.65rem; color: #6b7280; }

	/* Discussion thread */
	.memo-discussion { margin: 0.5rem 0; }
	.discussion-turn {
		padding: 0.3rem 0.5rem; margin: 0.2rem 0;
		border-radius: 4px; font-size: 0.78rem;
	}
	.turn-researcher { background: rgba(245, 158, 11, 0.08); border-left: 2px solid rgba(245, 158, 11, 0.4); }
	.turn-ai { background: rgba(139, 156, 247, 0.06); border-left: 2px solid rgba(139, 156, 247, 0.3); }
	.turn-role { font-size: 0.68rem; font-weight: 600; display: block; margin-bottom: 0.1rem; }
	.turn-researcher .turn-role { color: #f59e0b; }
	.turn-ai .turn-role { color: #8b9cf7; }
	.turn-content { color: #c9cdd5; display: block; white-space: pre-wrap; }

	/* Actions */
	.memo-actions {
		display: flex; gap: 0.3rem; margin-top: 0.5rem;
		flex-wrap: wrap; align-items: center;
		padding-top: 0.4rem; border-top: 1px solid #1e2030;
	}
	.memo-card-meta {
		display: flex; align-items: center; justify-content: flex-end;
		margin-top: 0.3rem;
	}
	.quick-actions { display: flex; gap: 0.3rem; }

	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
		text-decoration: none;
	}
	.btn-xs:hover { border-color: #8b9cf7; }
	.btn-edit { color: #8b9cf7; border-color: rgba(139, 156, 247, 0.3); }
	.btn-edit:hover { background: rgba(139, 156, 247, 0.1); }
	.btn-promote { border-color: #10b981; color: #10b981; }
	.btn-promote:hover { background: rgba(16, 185, 129, 0.1); }
	.btn-discuss { color: #8b9cf7; }

	/* Discuss form */
	.discuss-form { display: flex; gap: 0.3rem; flex: 1; min-width: 200px; }
	.discuss-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a;
		border-radius: 4px; padding: 0.25rem 0.5rem;
		color: #c9cdd5; font-size: 0.75rem;
	}
	.discuss-form input:focus { border-color: #8b9cf7; outline: none; }
	.discuss-form button { border-color: #8b9cf7; color: #8b9cf7; }
	.discuss-form button:disabled { opacity: 0.4; }
</style>
