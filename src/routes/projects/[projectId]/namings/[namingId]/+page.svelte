<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';
	import { invalidateAll } from '$app/navigation';
	import { memoText } from '$lib/shared/memoText.js';
	import NamingMemoForm from '$lib/components/NamingMemoForm.svelte';
	import StackActs from '$lib/components/StackActs.svelte';
	import ReferringNotes from '$lib/components/ReferringNotes.svelte';
	import { formatWhen } from '$lib/shared/dates.js';
	import { quoted, namingLabel } from '$lib/shared/namingLabel.js';
	import { goto } from '$app/navigation';
	import TechnicalErrorButton from '$lib/components/TechnicalErrorButton.svelte';

	let { data } = $props();

	const n = $derived(data.naming);
	const stack = $derived(data.stack);
	const desig = $derived(data.currentDesignation);
	const mode = $derived(data.primaryMode);
	const endpoints = $derived(data.relationEndpoints);
	// Eine Relation ohne eigene Inschrift heißt nach ihren Endpunkten.
	const title = $derived(
		namingLabel(
			n?.inscription,
			endpoints
				? {
						source: endpoints.source_inscription,
						target: endpoints.target_inscription,
						valence: endpoints.valence,
						directed: !!endpoints.directed
					}
				: null
		)
	);
	const appearances = $derived(data.appearances);
	const participations = $derived(data.participations);
	const activeRelations = $derived(participations.filter((p: any) => !p.is_withdrawn).length);
	const withdrawnRelations = $derived(participations.length - activeRelations);
	// Eine Stille hat keine eigenen Relationen: ihre Participations SIND das
	// Muster, aus dem sie folgt (Testlauf 10: sie standen als „relation" da).
	const isSilencePattern = $derived((data.stack?.silencePattern ?? []).length > 0);

	function isWithdrawnAppearance(props: Record<string, any> | null | undefined) {
		return !!(props?.withdrawn || props?.aiWithdrawn);
	}
	/** Wie das Naming auf einer Map erscheint: auf SW/A mit seiner Formationsrolle. */
	function appearanceAs(app: { mode: string; properties: Record<string, any> | null }) {
		const role = app.properties?.swRole;
		return typeof role === 'string' && role ? role.replace(/-/g, ' ') : app.mode;
	}

	// Group annotations by document
	const annotationsByDoc = $derived.by(() => {
		const anns = stack?.annotations;
		if (!anns?.length) return [];
		const grouped = new Map<string, { docId: string; docLabel: string; passages: any[] }>();
		for (const a of anns) {
			const key = a.document_id;
			if (!grouped.has(key)) {
				grouped.set(key, { docId: key, docLabel: a.document_label, passages: [] });
			}
			grouped.get(key)!.passages.push(a);
		}
		return [...grouped.values()];
	});

	function designationColor(d: string) {
		if (d === 'specification') return CCS_SPEC;
		if (d === 'characterization') return CCS_CHAR;
		return CCS_CUE;
	}

	function modeIcon(m: string) {
		if (m === 'relation') return '↔';
		if (m === 'silence') return '∅';
		return '◆';
	}

	async function setMemoStatus(memoId: string, status: string) {
		await fetch(`/api/projects/${data.projectId}/memos/${memoId}/status`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		const module = await import('$app/navigation');
		module.invalidateAll();
	}
</script>

<div class="naming-detail">
	<!-- Header -->
	<div class="naming-header">
		<a class="back-link" href="/projects/{data.projectId}/namings">&larr; Namings</a>
		<div class="header-main">
			<span class="mode-icon" title={mode}>{modeIcon(mode)}</span>
			<h1>{title}</h1>
			<span class="designation-badge" style="background: {designationColor(desig)}">{desig}</span>
			{#if data.hasDocumentAnchor}
				<span class="grounding-badge grounded" title="Document-grounded">&#128196;</span>
			{:else if data.hasMemoLink}
				<span class="grounding-badge memo" title="Memo — reflected, not grounded in a document">&#128221;</span>
			{:else}
				<span class="grounding-badge ungrounded" title="No document anchor, no memo yet">&#8709;</span>
			{/if}
			{#if stack.aiSuggested}
				<span class="ai-badge" class:withdrawn={stack.aiWithdrawn}>AI{stack.aiWithdrawn ? ' (withdrawn)' : ''}</span>
			{/if}
		</div>
		{#if endpoints}
			<div class="relation-endpoints">
				<a href="/projects/{data.projectId}/namings/{endpoints.source_id}">{endpoints.source_inscription}</a>
				<span class="endpoint-arrow">&rarr;</span>
				<a href="/projects/{data.projectId}/namings/{endpoints.target_id}">{endpoints.target_inscription}</a>
			</div>
		{/if}
	</div>

	<div class="detail-grid">
		<!-- Left column: history + memos -->
		<div class="detail-column">
			<!-- Der Stack: jeder Akt mit seinem Memo -->
			<section class="detail-section">
				<h2>Stack ({stack.acts?.length ?? 0})</h2>
				{#if (stack.derivedFrom?.length ?? 0) > 0}
					<div class="derived-note">Derived from the placement on {stack.derivedFrom.join(', ')} — moving the formations there updates it.</div>
				{/if}
				{#if (stack.silencePattern ?? []).length > 0}
					<!-- Stille = Participations ohne Appearances: aus welchem Muster sie folgt. -->
					<div class="silence-pattern">
						Absent from the pattern of:
						{#each stack.silencePattern as p (p.id)}
							<a class="sp-chip" href="/projects/{data.projectId}/namings/{p.id}">{p.label}</a>
						{/each}
					</div>
				{/if}
				{#if stack.relationEnds?.current}
					<div class="rel-ends">Relation: {stack.relationEnds.source} {stack.relationEnds.directed ? '→' : '↔'} {stack.relationEnds.target}</div>
				{/if}
				<StackActs acts={stack.acts ?? []} ends={stack.relationEnds ?? null}
					onlinked={(id) => goto(`/projects/${data.projectId}/namings/${id}`)} />
				<NamingMemoForm projectId={data.projectId} namingId={n.id}
					candidates={data.memoCandidates ?? []}
					oncreated={() => invalidateAll()} />
			</section>

			<!-- Memos in anderen Stacks und Memo-Namings, die auf dieses Naming verweisen -->
			{#if (stack.memos?.length ?? 0) + (stack.referringNotes?.length ?? 0) > 0}
			<section class="detail-section">
				<h2>Memos referring to this ({(stack.memos?.length ?? 0) + (stack.referringNotes?.length ?? 0)})</h2>
				<ReferringNotes notes={stack.referringNotes ?? []}
					onopen={(id) => goto(`/projects/${data.projectId}/namings/${id}`)} />
				{#each stack.memos ?? [] as memo}
						<div class="memo-card" class:memo-ai={memo.isAiAuthored} class:memo-dismissed={memo.status === 'dismissed'}>
							<div class="memo-card-header">
								<span class="memo-author" class:badge-ai={memo.isAiAuthored}>
									{memo.isAiAuthored ? 'AI' : 'R'}
								</span>
								{#if memo.status && memo.status !== 'active'}
									<span class="memo-status status-{memo.status}">{memo.status}</span>
								{/if}
								<span class="memo-label">{memo.label}</span>
								<span class="he-date">{formatWhen(memo.created_at)}</span>
							</div>
							<div class="memo-content">{memoText(memo.content)}</div>
							{#if memo.discussion?.length > 0}
								<div class="discussion-thread">
									{#each memo.discussion as turn}
										<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
											<span class="turn-role">{turn.role === 'researcher' ? 'Researcher' : 'AI'}{turn.type === 'revise' ? ' (revised)' : ''}</span>
											<span class="turn-content">{turn.content}</span>
										</div>
									{/each}
								</div>
							{/if}
							<div class="memo-actions">
								<a href="/projects/{data.projectId}/memos/{memo.id}" class="btn-xs btn-edit">{memo.isAiAuthored ? 'open' : 'edit'}</a>
								{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
									<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'acknowledged')}>ack</button>
									<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'dismissed')}>dismiss</button>
									<button class="btn-xs btn-promote" onclick={() => setMemoStatus(memo.id, 'promoted')}>promote</button>
								{/if}
								{#if memo.status === 'acknowledged'}
									<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'dismissed')}>dismiss</button>
								{/if}
								{#if memo.status === 'dismissed'}
									<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'presented')}>restore</button>
								{/if}
							</div>
						</div>
					{/each}
				</section>
			{/if}

			<!-- AI Cue -->
			{#if stack.aiSuggested && stack.aiReasoning}
				<section class="detail-section ai-section">
					<h2>AI Reasoning</h2>
					<div class="ai-reasoning">{stack.aiReasoning}</div>
					{#if stack.discussion?.length > 0}
						<div class="discussion-thread">
							{#each stack.discussion as turn}
								<div class="discussion-turn" class:turn-researcher={turn.role === 'researcher'} class:turn-ai={turn.role === 'ai'}>
									<span class="turn-role">{turn.role === 'researcher' ? 'Researcher' : 'AI'}</span>
									<span class="turn-content">{turn.content}</span>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}
		</div>

		<!-- Right column: appearances + participations + material -->
		<div class="detail-column">
			<!-- Appears on Maps -->
			{#if appearances.length > 0}
				<section class="detail-section">
					<h2>Appears on Maps ({appearances.length})</h2>
					{#each appearances as app}
						<div class="appearance-entry">
							<a href="/projects/{data.projectId}/maps/{app.perspective_id}" class="appearance-map">
								{app.perspective_label}
							</a>
							<span class="appearance-type">{app.map_type}</span>
							<span class="appearance-mode">as {appearanceAs(app)}</span>
							{#if isWithdrawnAppearance(app.properties)}
								<span class="withdrawn-tag" title="Withdrawn on this map; restore it there">withdrawn</span>
							{/if}
							{#if app.phase_label}
								<span class="appearance-phase">{app.phase_label}</span>
							{/if}
						</div>
					{/each}
				</section>
			{/if}

			<!-- Participations (Relations) -->
			{#if participations.length > 0}
				<section class="detail-section">
					<h2 title={isSilencePattern ? 'The silence participates in these namings without appearing: the pattern it follows from' : undefined}>{isSilencePattern ? 'Absent from the pattern of' : 'Relations'} ({activeRelations}{withdrawnRelations > 0 ? ` + ${withdrawnRelations} withdrawn` : ''})</h2>
					{#each participations as part}
						<div class="participation-entry" class:withdrawn={part.is_withdrawn}>
							{#if part.partner_designation}
								<span class="part-partner-dot" style="background: {designationColor(part.partner_designation)}"
									title="{part.partner_inscription}: {part.partner_designation}"></span>
							{/if}
							<a href="/projects/{data.projectId}/namings/{part.partner_id}" class="partner-link">
								{part.partner_inscription}
							</a>
							{#if part.valence}
								<span class="part-valence">{part.valence}</span>
							{/if}
							<a class="part-label" href="/projects/{data.projectId}/namings/{part.relation_id}" title={isSilencePattern ? 'Open this participation' : 'Open this relation'}>
								{part.relation_inscription && !part.relation_inscription.includes('↔') ? `via ${quoted(part.relation_inscription)}` : isSilencePattern ? 'participation' : part.partner_is_silence ? 'silence: absent from this pattern' : 'relation'}
							</a>
							{#if part.relation_designation}
								<span class="part-designation" title="Designation of the relation" style="color: {designationColor(part.relation_designation)}">{part.relation_designation}</span>
							{/if}
							{#if part.is_withdrawn}
								<span class="withdrawn-tag" title="Withdrawn on every map it appears on">withdrawn</span>
							{/if}
							{#if part.map_appearances?.length}
								<span class="part-maps">
									{#each part.map_appearances as ma, i}{i > 0 ? ' · ' : ''}<a
											href="/projects/{data.projectId}/maps/{ma.id}"
											class:ma-off={ma.withdrawn || ma.mode !== 'relation'}
											>{ma.withdrawn ? 'withdrawn on' : ma.mode === 'relation' ? 'on' : `as ${ma.mode} on`} {ma.label}</a
										>{/each}
								</span>
							{/if}
						</div>
					{/each}
				</section>
			{/if}

			<!-- Material (Document Passages) -->
			{#if annotationsByDoc.length > 0}
				<section class="detail-section material-section">
					<h2>Material ({stack.annotations?.length} passage{(stack.annotations?.length ?? 0) !== 1 ? 's' : ''})</h2>
					{#each annotationsByDoc as group}
						<div class="material-group">
							<a class="material-doc" href="/projects/{data.projectId}/documents/{group.docId}">
								{group.docLabel}
							</a>
							{#each group.passages as p}
								<div class="material-passage">
									{#if p.properties?.anchorType === 'image_region'}
										<span class="passage-type">image region</span>
									{/if}
									<span class="passage-text">{p.properties?.anchor?.text || p.properties?.comment || '(no text)'}</span>
								</div>
							{/each}
						</div>
					{/each}
				</section>
			{/if}
		</div>
	</div>
	<!-- Für Einträge, die ein Fehler der Software erzeugt hat. -->
	<div class="te-footer">
		<TechnicalErrorButton projectId={data.projectId} namingId={n.id} what="naming"
			ondone={() => goto(`/projects/${data.projectId}/namings?hidden=naming`)} />
	</div>
</div>

<style>
	.te-footer { margin-top: 2rem; padding-top: 0.75rem; border-top: 1px solid #2a2d3a; }
	.naming-detail {
		max-width: 960px;
	}

	/* Header */
	.back-link {
		font-size: 0.8rem; color: #6b7280; text-decoration: none;
		display: inline-block; margin-bottom: 0.5rem;
	}
	.back-link:hover { color: #c9cdd5; }

	.header-main {
		display: flex; align-items: center; gap: 0.6rem;
		margin-bottom: 0.3rem;
	}
	.header-main h1 {
		font-size: 1.3rem; font-weight: 600; color: #e1e4e8; margin: 0;
	}
	.mode-icon {
		font-size: 1rem; color: #6b7280; flex-shrink: 0;
	}
	.designation-badge {
		font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
		padding: 0.1rem 0.45rem; border-radius: 4px; color: #fff;
		flex-shrink: 0;
	}
	.grounding-badge { font-size: 0.85rem; flex-shrink: 0; }
	.ai-badge {
		font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.15); color: #8b9cf7;
		padding: 0.1rem 0.35rem; border-radius: 3px;
	}
	.ai-badge.withdrawn { opacity: 0.5; text-decoration: line-through; }

	.derived-note {
		font-size: 0.75rem; color: #a0a4b0; background: rgba(139, 156, 247, 0.07);
		border: 1px dashed rgba(139, 156, 247, 0.35); border-radius: 4px;
		padding: 0.3rem 0.5rem; margin-bottom: 0.5rem;
	}
	.part-partner-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
	.relation-endpoints {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.85rem; color: #8b8fa3; margin-top: 0.3rem;
	}
	.relation-endpoints a { color: #8b9cf7; text-decoration: none; }
	.relation-endpoints a:hover { text-decoration: underline; }
	.endpoint-arrow { color: #6b7280; }

	/* Grid */
	.detail-grid {
		display: grid; grid-template-columns: 1fr 1fr;
		gap: 1.5rem; margin-top: 1.5rem;
	}
	@media (max-width: 768px) {
		.detail-grid { grid-template-columns: 1fr; }
	}

	/* Sections */
	.detail-section {
		background: #13151e; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.75rem 1rem; margin-bottom: 1rem;
	}
	.detail-section h2 {
		font-size: 0.7rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.04em; margin: 0 0 0.5rem 0;
	}

	/* History entries */
	.history-entry {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.8rem; color: #8b8fa3; padding: 0.2rem 0;
	}
	.history-entry.current { color: #e1e4e8; }
	.he-value { color: #c9cdd5; }
	.he-by { color: #6b7280; }
	.he-by::before { content: '— '; }
	.he-date { color: #4b5563; margin-left: auto; font-size: 0.72rem; white-space: nowrap; }
	.designation-dot {
		width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
	}

	/* Memos */
	.memo-card {
		padding: 0.5rem 0.6rem; margin-bottom: 0.5rem;
		border: 1px solid #1e2030; border-radius: 6px;
	}
	.memo-card:last-child { margin-bottom: 0; }
	.memo-card.memo-ai { border-left: 2px solid rgba(139, 156, 247, 0.3); }
	.memo-card.memo-dismissed { opacity: 0.5; }
	.memo-card-header {
		display: flex; align-items: center; gap: 0.4rem;
		margin-bottom: 0.25rem;
	}
	.memo-author {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0.05rem 0.3rem; border-radius: 3px;
	}
	.memo-author.badge-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-status {
		font-size: 0.58rem; font-weight: 600; text-transform: uppercase;
		padding: 0.05rem 0.3rem; border-radius: 3px;
	}
	.status-presented { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.status-discussed { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	.status-acknowledged { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.status-promoted { background: rgba(16, 185, 129, 0.25); color: #10b981; }
	.status-dismissed { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-label { font-size: 0.78rem; color: #f59e0b; }
	.memo-content {
		font-size: 0.8rem; color: #a0a4b0; white-space: pre-wrap;
		max-height: 8em; overflow-y: auto;
	}

	/* Memo actions */
	.memo-actions {
		display: flex; gap: 0.3rem; margin-top: 0.4rem;
		padding-top: 0.3rem; border-top: 1px solid #1e2030;
	}
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

	/* Discussion */
	.discussion-thread { margin-top: 0.4rem; }
	.discussion-turn {
		padding: 0.3rem 0.5rem; margin: 0.2rem 0; border-radius: 4px;
		font-size: 0.78rem;
	}
	.turn-researcher { background: rgba(245, 158, 11, 0.08); border-left: 2px solid rgba(245, 158, 11, 0.4); }
	.turn-ai { background: rgba(139, 156, 247, 0.06); border-left: 2px solid rgba(139, 156, 247, 0.3); }
	.turn-role { font-size: 0.7rem; font-weight: 600; display: block; margin-bottom: 0.1rem; }
	.turn-researcher .turn-role { color: #f59e0b; }
	.turn-ai .turn-role { color: #8b9cf7; }
	.turn-content { color: #c9cdd5; display: block; white-space: pre-wrap; }

	/* AI */
	.ai-section { border-color: rgba(139, 156, 247, 0.2); }
	.ai-reasoning {
		font-size: 0.8rem; color: #8b9cf7; font-style: italic;
		padding: 0.4rem 0.6rem; margin-bottom: 0.3rem;
		background: rgba(139, 156, 247, 0.06); border-radius: 4px;
		border-left: 2px solid rgba(139, 156, 247, 0.3);
	}

	/* Appearances */
	.appearance-entry {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.3rem 0; font-size: 0.8rem;
		border-bottom: 1px solid #1e2030;
	}
	.appearance-entry:last-child { border-bottom: none; }
	.appearance-map { color: #8b9cf7; text-decoration: none; }
	.appearance-map:hover { text-decoration: underline; }
	.appearance-type {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.15); padding: 0.05rem 0.3rem; border-radius: 3px;
	}
	.appearance-mode { font-size: 0.72rem; color: #8b8fa3; }
	.appearance-phase {
		font-size: 0.65rem; color: #f59e0b;
		background: rgba(245, 158, 11, 0.1); padding: 0.05rem 0.3rem; border-radius: 3px;
		margin-left: auto;
	}

	/* Participations */
	.participation-entry {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.35rem 0; font-size: 0.8rem;
		border-bottom: 1px solid #1e2030; flex-wrap: wrap;
	}
	.participation-entry:last-child { border-bottom: none; }
	.partner-link { color: #8b9cf7; text-decoration: none; }
	.partner-link:hover { text-decoration: underline; }
	.part-valence {
		font-size: 0.68rem; color: #e1b54a;
		background: rgba(225, 181, 74, 0.1); padding: 0.05rem 0.3rem; border-radius: 3px;
	}
	.part-label { font-size: 0.72rem; color: #8b8fa3; font-style: italic; text-decoration: none; }
	.part-label:hover { color: #c9cdd5; text-decoration: underline; }
	.part-designation { font-size: 0.68rem; margin-left: auto; }
	.part-maps { font-size: 0.65rem; color: #6b7280; }
	.part-maps a { color: inherit; text-decoration: none; }
	.part-maps a:hover { text-decoration: underline; }
	.part-maps a.ma-off { font-style: italic; }
	.participation-entry.withdrawn { opacity: 0.55; }
	.withdrawn-tag {
		font-size: 0.62rem; color: #fca5a5; text-transform: uppercase; letter-spacing: 0.03em;
		border: 1px solid rgba(248, 113, 113, 0.4); padding: 0 0.3rem; border-radius: 3px;
	}

	/* Material */
	.material-section { border-color: rgba(16, 185, 129, 0.2); }
	.material-group { margin-bottom: 0.5rem; }
	.material-group:last-child { margin-bottom: 0; }
	.material-doc {
		font-size: 0.78rem; color: #10b981; display: block;
		margin-bottom: 0.2rem; text-decoration: none;
	}
	.material-doc:hover { text-decoration: underline; }
	.material-passage {
		padding: 0.25rem 0.5rem; margin: 0.15rem 0;
		background: rgba(16, 185, 129, 0.04);
		border-left: 2px solid rgba(16, 185, 129, 0.2);
		border-radius: 3px;
	}
	.passage-text {
		font-size: 0.78rem; color: #c9cdd5; display: block;
		white-space: pre-wrap; max-height: 4em; overflow-y: auto;
	}
	.passage-type {
		font-size: 0.65rem; color: #6b7280; text-transform: uppercase;
		display: block; margin-bottom: 0.1rem;
	}
	.silence-pattern { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; font-size: 0.74rem; color: #8b8fa3; margin-bottom: 0.4rem; }
	.sp-chip {
		font-size: 0.7rem; color: #a0a4b0; background: #1e2030; border: 1px solid #2a2d3a;
		border-radius: 10px; padding: 0 0.45rem; cursor: pointer; text-decoration: none;
	}
	.sp-chip:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.rel-ends { font-size: 0.78rem; color: #8b8fa3; margin-bottom: 0.4rem; }
</style>
