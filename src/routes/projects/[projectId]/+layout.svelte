<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import CoachPanel from '$lib/coach/CoachPanel.svelte';
	import Rueckweg from '$lib/components/Rueckweg.svelte';
	import { createCoachState, setCoachState } from '$lib/coach/coachState.svelte.js';
	import { runAiStream, stepLabel } from '$lib/coach/aiStream.js';
	import { docOutline, type OutlineEntry } from '$lib/stores/docOutline.svelte.js';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const base = $derived(`/projects/${p.id}`);
	const mapsByType = $derived(data.mapsByType as Record<string, { id: string; label: string; isPrimary?: boolean }[]>);
	const documents = $derived(data.documents as { id: string; label: string }[]);
	const pathname = $derived($page.url.pathname);

	// Sidebar: einklappbar und in der Breite ziehbar, beides persistent. Sie ist
	// Navigation, nicht Material — auf einem schmalen Bildschirm muss sie dem
	// Dokument weichen können.
	let sidebarOpen = $state(true);
	let sidebarWidth = $state(200);

	$effect(() => {
		if (typeof window === 'undefined') return;
		try {
			const raw = window.localStorage?.getItem('project-sidebar');
			if (!raw) return;
			const s = JSON.parse(raw);
			if (typeof s.open === 'boolean') sidebarOpen = s.open;
			if (typeof s.width === 'number') sidebarWidth = s.width;
		} catch {
			// defekter Eintrag → Defaults stehen lassen
		}
	});
	$effect(() => {
		if (typeof window === 'undefined') return;
		window.localStorage?.setItem(
			'project-sidebar',
			JSON.stringify({ open: sidebarOpen, width: sidebarWidth })
		);
	});

	function startSidebarResize(e: MouseEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sidebarWidth;
		function onMove(ev: MouseEvent) {
			sidebarWidth = Math.max(150, Math.min(480, startWidth + (ev.clientX - startX)));
		}
		function onUp() {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	// Inline doc rename
	let renamingDocId = $state<string | null>(null);
	let renameValue = $state('');

	// Sequenz benennen oder umschreiben — dieselbe Geste wie beim Dokumentnamen,
	// aber der Schreibweg gehört der Dokumentseite (siehe docOutline).
	let renamingSeqKey = $state<string | null>(null);
	let renameSeqValue = $state('');

	async function saveSeqRename(entry: OutlineEntry) {
		const next = renameSeqValue.trim();
		renamingSeqKey = null;
		if (!next || next === entry.label) return;
		await docOutline.onname?.(entry, next);
	}

	async function saveDocRename(docId: string) {
		if (!renameValue.trim()) { renamingDocId = null; return; }
		const res = await fetch(`/api/projects/${p.id}/documents/${docId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: renameValue.trim() })
		});
		if (res.ok) {
			const d = documents.find(d => d.id === docId);
			if (d) d.label = renameValue.trim();
		}
		renamingDocId = null;
	}

	// Coach: didactic AI persona
	const coach = createCoachState(p.id);
	setCoachState(coach);

	// Cowork: on-demand co-researcher on the current map.
	// Visible only when a map is open. The map's reactive-mode toggle
	// (auto-respond to researcher acts) is configured per-project in Settings;
	// the Cowork button is on-demand and runs regardless of that setting.
	const currentMapId = $derived.by(() => {
		const m = pathname.match(new RegExp(`^${base}/maps/([^/]+)$`));
		return m ? m[1] : null;
	});
	// Wie der Lauf ausging, steht unter dem Knopf, bis die Forscherin es
	// wegklickt oder Cowork erneut fragt: geschriebene Memos und Cues,
	// „nothing to add" mit Grund, oder der Fehler mit Grund.
	type CoworkAct = { kind: 'memo' | 'cue' | 'phase'; what: string; id: string | null; label: string };
	type CoworkResult = {
		mapId: string;
		status: 'acted' | 'silent' | 'skipped' | 'failed' | 'stopped';
		acts: CoworkAct[];
		note: string;
		error?: string;
	};
	let coworkRunning = $state(false);
	let coworkStep = $state<string | null>(null);
	let coworkStartedAt = $state(0);
	let coworkNow = $state(0);
	// Das Ergebnis des letzten Laufs überlebt ein Neuladen (pro Projekt, nur
	// in diesem Tab): Sonst ist die Liste dessen, was Cowork schrieb, weg.
	let coworkResult = $state<CoworkResult | null>(null);
	let coworkResultKey: string | null = null;
	$effect(() => {
		const key = `cowork-result-${p.id}`;
		if (key === coworkResultKey) return;
		coworkResultKey = key;
		try {
			const raw = sessionStorage.getItem(key);
			coworkResult = raw ? (JSON.parse(raw) as CoworkResult) : null;
		} catch {
			coworkResult = null;
		}
	});
	function setCoworkResult(r: CoworkResult | null) {
		coworkResult = r;
		if (!coworkResultKey) return;
		try {
			if (r) sessionStorage.setItem(coworkResultKey, JSON.stringify(r));
			else sessionStorage.removeItem(coworkResultKey);
		} catch {
			/* Speicher nicht verfügbar — dann eben ohne */
		}
	}
	let coworkAbort: AbortController | null = null;

	$effect(() => {
		if (!coworkRunning) return;
		coworkNow = Date.now();
		const tick = setInterval(() => { coworkNow = Date.now(); }, 1000);
		return () => clearInterval(tick);
	});
	const coworkSeconds = $derived(Math.max(0, Math.round((coworkNow - coworkStartedAt) / 1000)));

	async function askCowork() {
		if (!currentMapId || coworkRunning) return;
		const mapId = currentMapId;
		coworkRunning = true;
		coworkStep = null;
		setCoworkResult(null);
		coworkStartedAt = Date.now();
		coworkAbort = new AbortController();
		try {
			const last = await runAiStream(`/api/projects/${p.id}/cowork`, { mapId }, (event) => {
				if (event.kind === 'step' && typeof event.tool === 'string') coworkStep = event.tool;
			}, coworkAbort.signal);
			const outcome = last.kind === 'done' ? (last.outcome as Omit<CoworkResult, 'mapId'> | undefined) : undefined;
			setCoworkResult(last.kind === 'cancelled'
				? {
					mapId,
					status: 'stopped',
					acts: [],
					note: 'Whatever Cowork had already written before you stopped it stays on the map and in Memos.'
				}
				: outcome
				? { mapId, ...outcome }
				: {
					mapId,
					status: 'failed',
					acts: [],
					note: '',
					error: typeof last.message === 'string' ? last.message : 'no result arrived'
				});
		} finally {
			coworkRunning = false;
			coworkStep = null;
			coworkAbort = null;
		}
	}

	function stopCowork() {
		coworkAbort?.abort();
	}

	function countLabel(n: number, one: string, many: string): string {
		return `${n} ${n === 1 ? one : many}`;
	}

	function actsSummary(acts: CoworkAct[]): string {
		const memos = acts.filter((a) => a.kind === 'memo').length;
		const cues = acts.filter((a) => a.kind === 'cue').length;
		const phases = acts.filter((a) => a.kind === 'phase').length;
		const parts: string[] = [];
		if (memos) parts.push(countLabel(memos, 'memo', 'memos'));
		if (cues) parts.push(countLabel(cues, 'cue', 'cues'));
		if (phases) parts.push(countLabel(phases, 'phase', 'phases'));
		return parts.join(', ');
	}

	const coworkHeadline = $derived.by(() => {
		const r = coworkResult;
		if (!r) return '';
		switch (r.status) {
			case 'acted': return `Cowork wrote ${actsSummary(r.acts)}`;
			case 'silent': return 'Cowork: nothing to add';
			case 'skipped': return 'Cowork did not run';
			case 'stopped': return 'Cowork stopped';
			default: return r.acts.length ? `Cowork failed after writing ${actsSummary(r.acts)}` : 'Cowork failed';
		}
	});

	function mapLabelOf(mapId: string): string {
		for (const maps of Object.values(mapsByType)) {
			const m = maps.find((x) => x.id === mapId);
			if (m) return m.label;
		}
		return 'another map';
	}

	function actHref(act: CoworkAct): string | null {
		if (!act.id) return null;
		return act.kind === 'memo' ? `${base}/memos/${act.id}` : `${base}/namings/${act.id}`;
	}

	// Autonoma (früher Raichel) ist DEPRECATED — hier steht bewusst kein
	// Client-Code mehr. Der autonome Massenlauf erzeugte hunderte textnaher,
	// aber unsystematischer Namings ohne Komparation und ohne Relevanzsinn;
	// die Sichtungslast landete vollständig beim Menschen. Begründung und
	// Gegenentwurf: docs/design-begleiten.md.
	// Der Start-Code lag nach dem UI-Ausbau im April als toter Code hier und
	// wurde seither mehrfach versehentlich wieder angeschlossen — deshalb
	// entfernt statt auskommentiert. Nicht wieder einbauen.

	const mapTypeLabels: Record<string, string> = {
		situational: 'Sit Map',
		'social-worlds': 'SW/A Map',
		positional: 'Pos Map'
	};
	const mapTypeOrder = ['situational', 'social-worlds', 'positional'];
</script>

<!-- --content-left: linke Kante des Inhaltsbereichs. Der Rückweg (unten links,
     fest) muss die Menüspalte kennen, deren Breite ziehbar und einklappbar ist. -->
<div class="project-layout" style="--content-left: {sidebarOpen ? sidebarWidth + 5 : 18}px;">
	{#if !sidebarOpen}
		<button class="sidebar-rail" onclick={() => { sidebarOpen = true; }} title="Show menu">⟩</button>
	{/if}
	<div class="project-sidebar" class:sidebar-hidden={!sidebarOpen} style="width: {sidebarWidth}px;">
		<!-- Der Rückweg zu den Projekten steht oben; unten war er inkonsistent (BJ, 03.08.2026). -->
		<a href="/projects" class="back-link">← Projects</a>
		<h2>
			<a href={base} class:active={pathname === base} class="project-name-link">{p.name}</a>
			<button class="sidebar-hide" onclick={() => { sidebarOpen = false; }} title="Hide menu">⟨</button>
		</h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
			<!-- Ordnung nach BJ, Sitzung 08 (11.03.2026): „flaches Menü unterhalb der
			     "project"-Ebene … Sit Map, SW Map, Pos Map, Namings, Memos, Documents." -->
			<a href="{base}/maps" class:active={pathname === `${base}/maps`}>Maps</a>

			{#each mapTypeOrder as type}
				{#if mapsByType[type]?.length}
					<span class="map-group-label">{mapTypeLabels[type]}</span>
					{#each mapsByType[type] as map}
						<a
							href="{base}/maps/{map.id}"
							class="map-link"
							class:active={pathname === `${base}/maps/${map.id}`}
						>{map.label}</a>
					{/each}
				{/if}
			{/each}

			<a href="{base}/namings" class:active={pathname.startsWith(`${base}/namings`)}>Namings</a>
			<a href="{base}/memos" class:active={pathname.startsWith(`${base}/memos`)}>Memos</a>
			<a href="{base}/documents" class:active={pathname === `${base}/documents`}>Documents</a>
			{#each documents as d}
				{#if renamingDocId === d.id}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="doc-rename-input"
						bind:value={renameValue}
						autofocus
						onkeydown={(e) => { if (e.key === 'Enter') saveDocRename(d.id); if (e.key === 'Escape') renamingDocId = null; }}
						onblur={() => saveDocRename(d.id)}
					/>
				{:else}
					<a
						href="{base}/documents/{d.id}"
						class="doc-link"
						class:active={pathname === `${base}/documents/${d.id}`}
						title="{d.label} — double-click to change the display name (the file stays unchanged)"
						ondblclick={(e) => { e.preventDefault(); renamingDocId = d.id; renameValue = d.label; }}
					>{d.label}</a>
				{/if}
				<!-- Sequenz-Gliederung des offenen Dokuments: sein Inhaltsverzeichnis
				     gehört unter das Dokument, nicht in eine eigene Spalte neben das
				     Transkript. Doppelklick schreibt einen Sequenz-Titel um. -->
				{#if docOutline.docId === d.id && docOutline.entries.length > 0}
					<div class="seq-list">
						{#each docOutline.entries as entry (entry.key)}
							{#if renamingSeqKey === entry.key}
								<!-- svelte-ignore a11y_autofocus -->
								<input
									class="seq-rename-input"
									placeholder="Title for this sequence…"
									bind:value={renameSeqValue}
									autofocus
									onkeydown={(e) => { if (e.key === 'Enter') saveSeqRename(entry); if (e.key === 'Escape') renamingSeqKey = null; }}
									onblur={() => saveSeqRename(entry)}
								/>
							{:else}
								<button
									type="button"
									class="seq-link"
									class:active={docOutline.activeKey === entry.key}
									class:seq-unnamed={!entry.label}
									title={entry.label ?? 'This sequence has no title — double-click to name it'}
									onclick={() => docOutline.select(entry)}
									ondblclick={() => { renamingSeqKey = entry.key; renameSeqValue = entry.label ?? ''; }}
								>
									{#if entry.seq != null}<span class="seq-num">{entry.seq}</span>{/if}
									<span class="seq-text">{entry.label ?? 'untitled'}</span>
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}

			<a href="{base}/compare" class:active={pathname.startsWith(`${base}/compare`)}>Compare</a>
			<a href="{base}/concepts" class:active={pathname.startsWith(`${base}/concepts`)}>Concepts</a>
			<a href="{base}/members" class:active={pathname.startsWith(`${base}/members`)}>Members</a>

			<button
				class="coach-toggle"
				class:coach-active={coach.isOpen}
				onclick={() => coach.isOpen = !coach.isOpen}
			>Coach</button>

			{#if currentMapId}
				<button
					class="cowork-toggle"
					onclick={askCowork}
					disabled={coworkRunning}
					title="Ask Cowork to look at the current map (on demand)"
				>{coworkRunning ? `Cowork… ${coworkSeconds} s` : 'Cowork'}</button>
			{/if}
			{#if coworkRunning}
				<span class="cowork-step" role="status" aria-live="polite">{stepLabel(coworkStep)}…</span>
				<button class="cowork-stop" onclick={stopCowork} title="Stop this Cowork run">Stop</button>
			{:else if coworkResult}
				<div
					class="cowork-result"
					class:cowork-result-failed={coworkResult.status === 'failed'}
					role="status"
					aria-live="polite"
				>
					<div class="cowork-result-head">
						<span>{coworkHeadline}</span>
						<button class="cowork-dismiss" onclick={() => setCoworkResult(null)} title="Dismiss" aria-label="Dismiss">×</button>
					</div>
					{#if coworkResult.mapId !== currentMapId}
						<div class="cowork-where">on {mapLabelOf(coworkResult.mapId)}</div>
					{/if}
					{#if coworkResult.acts.length > 0}
						<ul class="cowork-acts">
							{#each coworkResult.acts as act}
								{@const href = actHref(act)}
								<li>
									<span class="cowork-act-what">{act.what}</span>
									{#if href}<a {href}>{act.label || '(untitled)'}</a>{:else}<span>{act.label || '(untitled)'}</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if (coworkResult.status === 'silent' || coworkResult.status === 'skipped' || coworkResult.status === 'stopped') && coworkResult.note}
						<p class="cowork-note">{coworkResult.note}</p>
					{/if}
					{#if coworkResult.status === 'failed'}
						<p class="cowork-note">{coworkResult.error || 'Unknown error'}</p>
					{/if}
				</div>
			{/if}

			<!-- Kein Autonoma-Trigger: deprecated, siehe Kommentar oben im Script. -->

		</nav>
	</div>
	{#if sidebarOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="sidebar-divider" onmousedown={startSidebarResize} title="Drag to resize"></div>
	{/if}

	<div class="project-content">
		{@render children()}
	</div>

	<CoachPanel />

	<!-- Der Rückweg gilt für jede Ansicht des Projekts, nicht für eine Seite —
	     deshalb hier, einmal, und nicht in drei Kopfzeilen. -->
	<Rueckweg />

	<!-- Kein Autonoma-Panel: deprecated, siehe Kommentar oben im Script. -->
</div>

<style>
	.project-layout {
		display: flex;
		gap: 0;
		height: 100%;
		min-height: 0;
	}

	.project-sidebar {
		flex-shrink: 0;
		padding: 1.25rem;
		background: #13151e;
		overflow-y: auto;
	}
	.project-sidebar.sidebar-hidden { display: none; }

	/* Ziehleiste an der Sidebar-Kante — trägt zugleich deren Trennlinie. */
	.sidebar-divider {
		width: 5px;
		flex-shrink: 0;
		cursor: col-resize;
		background: linear-gradient(#2a2d3a, #2a2d3a) center / 1px 100% no-repeat;
		transition: background-image 0.15s;
	}
	.sidebar-divider:hover { background-image: linear-gradient(#8b9cf7, #8b9cf7); }

	/* Schiene bei eingeklappter Sidebar: der einzige Weg zurück. */
	.sidebar-rail {
		width: 18px;
		flex-shrink: 0;
		background: #13151e;
		border: none;
		border-right: 1px solid #2a2d3a;
		color: #6b7280;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0;
	}
	.sidebar-rail:hover { color: #a5b4fc; background: #171a25; }

	.project-sidebar h2 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}
	.sidebar-hide {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.75rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		flex-shrink: 0;
	}
	.sidebar-hide:hover { color: #a5b4fc; }

	/* Sequenz-Gliederung unter dem Dokument: eingerückt, kleiner, mit Faden
	   zum Dokument — sie ist dessen Inhaltsverzeichnis, kein Geschwisterpunkt. */
	.seq-list {
		display: flex;
		flex-direction: column;
		margin: 0.1rem 0 0.4rem 1.45rem;
		padding-left: 0.5rem;
		border-left: 1px solid #2a2d3a;
	}
	.seq-link {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-left: 2px solid transparent;
		margin-left: -0.5rem;
		padding: 0.22rem 0.3rem 0.22rem 0.5rem;
		color: #8b8fa3;
		font-family: inherit;
		font-size: 0.7rem;
		line-height: 1.35;
		cursor: pointer;
		overflow-wrap: anywhere;
		transition: color 0.12s, background 0.12s, border-color 0.12s;
	}
	.seq-link:hover {
		color: #c9cdd5;
		background: rgba(139, 156, 247, 0.07);
		border-left-color: rgba(139, 156, 247, 0.5);
	}
	.seq-link.active {
		color: #e1e4e8;
		background: rgba(139, 156, 247, 0.14);
		border-left-color: #8b9cf7;
	}
	.seq-num {
		flex-shrink: 0;
		color: #4b5563;
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		min-width: 1.1rem;
		text-align: right;
	}
	.seq-text { flex: 1; min-width: 0; }
	/* Unbenannte Sequenz: sichtbar als Lücke, nicht als Eintrag — sie soll
	   auffallen, ohne sich vor die benannten zu drängen. */
	.seq-link.seq-unnamed .seq-text {
		color: #5a6070;
		font-style: italic;
	}
	.seq-link.seq-unnamed:hover .seq-text { color: #9ca3af; }
	.seq-rename-input {
		width: 100%;
		margin: 0.15rem 0;
		background: #0f1117;
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.2rem 0.3rem;
		color: #e1e4e8;
		font-family: inherit;
		font-size: 0.7rem;
	}
	.seq-rename-input:focus { outline: none; }
	.project-name-link {
		color: inherit;
		text-decoration: none;
		display: inline-block;
		padding: 0.1rem 0.3rem;
		margin: -0.1rem -0.3rem;
		border-radius: 4px;
	}
	.project-name-link:hover {
		color: #a5b4fc;
		background: #1e2030;
	}
	.project-name-link.active {
		color: #fff;
		background: #1e2030;
	}

	.desc {
		font-size: 0.8rem;
		color: #6b7280;
		margin-bottom: 1rem;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 1rem;
	}

	nav a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #c9cdd5;
	}
	nav a:hover {
		background: #1e2030;
		color: #fff;
	}

	.map-group-label {
		font-size: 0.75rem;
		color: #6b7280 !important;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.5rem 0.65rem 0.15rem;
		margin-top: 0.15rem;
		text-decoration: none;
	}
	.map-group-label:hover {
		color: #a5b4fc !important;
	}

	.map-group-label:first-child {
		margin-top: 0;
	}

	.map-link, .doc-link {
		padding-left: 1.2rem !important;
		font-size: 0.78rem !important;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-rename-input {
		margin-left: 1.2rem;
		width: calc(100% - 1.4rem);
		background: #0f1117;
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.25rem 0.4rem;
		color: #e1e4e8;
		font-size: 0.78rem;
		font-family: inherit;
	}
	.doc-rename-input:focus { outline: none; }

	.active {
		background: #1e2030;
		color: #fff;
	}

	.coach-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #a5b4fc;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.5rem;
		font-family: inherit;
		font-weight: 500;
	}
	.coach-toggle:hover {
		background: #1e2030;
		border-color: #a5b4fc;
	}
	.coach-active {
		background: rgba(165, 180, 252, 0.1);
		border-color: #a5b4fc;
	}

	.cowork-toggle {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #8b9cf7;
		background: none;
		border: 1px solid #2a2d3a;
		cursor: pointer;
		margin-top: 0.15rem;
		font-family: inherit;
		font-weight: 500;
	}
	.cowork-toggle:hover {
		background: #1e2030;
		border-color: #8b9cf7;
	}
	.cowork-toggle:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.cowork-step {
		display: block;
		font-size: 0.7rem;
		color: #8b9cf7;
		padding: 0.15rem 0.5rem 0;
		font-style: italic;
	}
	.cowork-result {
		margin-top: 0.3rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid #2a2d3a;
		border-left: 2px solid #8b9cf7;
		border-radius: 5px;
		background: #171a25;
		font-size: 0.72rem;
		color: #c9cdd5;
		overflow-wrap: anywhere;
	}
	.cowork-result-failed { border-left-color: #ef4444; }
	.cowork-result-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.3rem;
		font-weight: 600;
		color: #e1e4e8;
	}
	.cowork-dismiss {
		background: none;
		border: none;
		color: #6b7280;
		cursor: pointer;
		font-size: 0.85rem;
		line-height: 1;
		padding: 0 0.1rem;
		flex-shrink: 0;
	}
	.cowork-dismiss:hover { color: #e1e4e8; }
	.cowork-where {
		color: #6b7280;
		font-style: italic;
		margin-top: 0.1rem;
	}
	.cowork-acts {
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		/* Lange Ergebnislisten ragen sonst unter den Bildschirmrand. */
		max-height: 40vh;
		overflow-y: auto;
	}
	.cowork-stop {
		align-self: flex-start;
		margin: 0.25rem 0 0 0.5rem;
		background: none;
		border: 1px solid #ef4444;
		border-radius: 4px;
		color: #fca5a5;
		font: inherit;
		font-size: 0.72rem;
		padding: 0.1rem 0.5rem;
		cursor: pointer;
	}
	.cowork-stop:hover { background: rgba(239, 68, 68, 0.12); }
	.cowork-acts a {
		display: inline;
		padding: 0;
		font-size: inherit;
		color: #a5b4fc;
	}
	.cowork-acts a:hover { background: none; text-decoration: underline; }
	.cowork-act-what {
		color: #6b7280;
		margin-right: 0.3rem;
	}
	.cowork-note {
		margin: 0.3rem 0 0;
		max-height: 9rem;
		overflow-y: auto;
		color: #9ca3af;
		line-height: 1.4;
		white-space: pre-wrap;
	}

	.back-link {
		display: block;
		font-size: 0.78rem;
		color: #6b7280 !important;
		margin-bottom: 0.6rem;
		text-decoration: none;
	}
	.back-link:hover {
		color: #a5b4fc !important;
	}

	.project-content {
		flex: 1;
		min-width: 0;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
