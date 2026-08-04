<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import CoachPanel from '$lib/coach/CoachPanel.svelte';
	import { createCoachState, setCoachState } from '$lib/coach/coachState.svelte.js';
	import { docOutline, type OutlineEntry } from '$lib/stores/docOutline.svelte.js';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
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
	let coworkRequesting = $state(false);
	let coworkFlash = $state<string | null>(null);
	async function askCowork() {
		if (!currentMapId || coworkRequesting) return;
		coworkRequesting = true;
		coworkFlash = null;
		try {
			const res = await fetch(`/api/projects/${p.id}/maps/${currentMapId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'requestAnalysis' })
			});
			coworkFlash = res.ok ? 'Cowork analysis requested' : 'Request failed';
		} catch {
			coworkFlash = 'Request failed';
		} finally {
			coworkRequesting = false;
			setTimeout(() => { coworkFlash = null; }, 4000);
		}
	}

	// Autonoma (früher Raichel) ist DEPRECATED — hier steht bewusst kein
	// Client-Code mehr. Der autonome Massenlauf erzeugte hunderte textnaher,
	// aber unsystematischer Namings ohne Komparation und ohne Relevanzsinn;
	// die Sichtungslast landete vollständig beim Menschen. Begründung und
	// Gegenentwurf (begleiten statt codieren): docs/design-begleiten.md.
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

<div class="project-layout">
	{#if !sidebarOpen}
		<button class="sidebar-rail" onclick={() => { sidebarOpen = true; }} title="Menüspalte einblenden">⟩</button>
	{/if}
	<div class="project-sidebar" class:sidebar-hidden={!sidebarOpen} style="width: {sidebarWidth}px;">
		<h2>
			<a href={base} class:active={pathname === base} class="project-name-link">{p.name}</a>
			<button class="sidebar-hide" onclick={() => { sidebarOpen = false; }} title="Menüspalte ausblenden">⟨</button>
		</h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
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
						title="{d.label} — Doppelklick: Anzeigenamen ändern (die Datei bleibt unberührt)"
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
									placeholder="Titel für diese Sequenz…"
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
									title={entry.label ?? 'Diese Sequenz hat keinen Titel — Doppelklick, um sie zu benennen'}
									onclick={() => docOutline.select(entry)}
									ondblclick={() => { renamingSeqKey = entry.key; renameSeqValue = entry.label ?? ''; }}
								>
									{#if entry.seq != null}<span class="seq-num">{entry.seq}</span>{/if}
									<span class="seq-text">{entry.label ?? 'unbenannt'}</span>
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}
			<a href="{base}/namings" class:active={pathname.startsWith(`${base}/namings`)}>Namings</a>
			<a href="{base}/memos" class:active={pathname.startsWith(`${base}/memos`)}>Memos</a>
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
					disabled={coworkRequesting}
					title="Ask Cowork to analyse the current map (on-demand)"
				>{coworkRequesting ? 'Cowork…' : 'Cowork'}</button>
				{#if coworkFlash}
					<span class="cowork-flash">{coworkFlash}</span>
				{/if}
			{/if}

			<!-- Kein Autonoma-Trigger: deprecated, siehe Kommentar oben im Script. -->

			<a href="/projects" class="back-link">← Projects</a>
		</nav>
	</div>
	{#if sidebarOpen}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="sidebar-divider" onmousedown={startSidebarResize} title="Breite ziehen"></div>
	{/if}

	<div class="project-content">
		{@render children()}
	</div>

	<CoachPanel />

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
	.cowork-flash {
		display: block;
		font-size: 0.7rem;
		color: #8b9cf7;
		padding: 0.1rem 0.5rem 0;
		font-style: italic;
	}

	.back-link {
		font-size: 0.78rem;
		color: #6b7280 !important;
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid #2a2d3a;
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
