<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { viewHref } from '$lib/shared/rueckweg.js';
	import { keepInWindow } from '$lib/canvas/dom.js';

	let {
		namingId,
		position,
		onclose,
		oncenter,
		onrename,
		onunsituate,
		labelPinned = false,
		onresetlabel,
	}: {
		namingId: string;
		position: { x: number; y: number };
		onclose: () => void;
		oncenter: (id: string) => void;
		onrename: (id: string) => void;
		onunsituate?: (id: string) => void;
		/** Raute einer Relation von Hand gesetzt: Zurücksetzen anbieten. */
		labelPinned?: boolean;
		onresetlabel?: (id: string) => void;
	} = $props();

	const ms = getMapState();
	const node = $derived(ms.findNode(namingId));
	// Achsen der Positionskarte: benennen, designieren, Memo — keine Relation,
	// kein Zentrieren, kein Zurückziehen.
	const isAxis = $derived(node?.properties?.isAxis === true);
	const current = $derived(node?.designation || 'cue');
	// Zurückgezogen: ansehen und wiederherstellen, sonst nichts — Umbenennen,
	// Designieren oder Verbinden setzte an etwas an, das auf dieser Karte
	// gerade nicht gilt.
	const withdrawn = $derived(ms.isWithdrawn(node?.properties));
	const label = $derived(ms.findInscription(namingId));
	// Mit der Tastatur bedienbar wie ein Menü: Fokus auf den ersten Eintrag,
	// ↑/↓ wandern (umlaufend), Pos1/Ende springen; Escape schließt über die Seite
	// (Testlauf 09.11.: „Das Kontextmenü reagiert nicht auf Pfeiltasten").
	function menuKeys(el: HTMLElement) {
		const items = () => Array.from(el.querySelectorAll<HTMLElement>('button.ctx-item, a.ctx-item'));
		const first = () => { if (!el.contains(document.activeElement)) items()[0]?.focus({ preventScroll: true }); };
		const raf = requestAnimationFrame(first);
		const t = setTimeout(first, 30);
		const onKey = (e: KeyboardEvent) => {
			const list = items();
			if (list.length === 0) return;
			const i = list.indexOf(document.activeElement as HTMLElement);
			let next = -1;
			if (e.key === 'ArrowDown') next = (i + 1) % list.length;
			else if (e.key === 'ArrowUp') next = i <= 0 ? list.length - 1 : i - 1;
			else if (e.key === 'Home') next = 0;
			else if (e.key === 'End') next = list.length - 1;
			if (next < 0) return;
			e.preventDefault();
			e.stopPropagation();
			list[next].focus({ preventScroll: true });
		};
		el.addEventListener('keydown', onKey);
		return { destroy() { cancelAnimationFrame(raf); clearTimeout(t); el.removeEventListener('keydown', onKey); } };
	}
	const designations = [
		{ value: 'cue', label: 'cue', color: 'var(--ccs-cue)' },
		{ value: 'characterization', label: 'characterization', color: 'var(--ccs-char)' },
		{ value: 'specification', label: 'specification', color: 'var(--ccs-spec)' }
	];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- Öffnet am Zeiger, bleibt aber im Fenster (nach oben/links, wenn unten
     bzw. rechts kein Platz ist). -->
<div class="context-menu" use:keepInWindow={position} use:menuKeys role="menu" tabindex="-1" aria-label={label}
	onclick={(e) => e.stopPropagation()}>
	<div class="ctx-header" title={label}>{label}{#if withdrawn}<span class="ctx-state"> · withdrawn</span>{/if}</div>
	{#if withdrawn}
		<button class="ctx-item" onclick={() => { ms.showStack(namingId); onclose(); }}>Stack</button>
		<a class="ctx-item"
			href={viewHref(`/projects/${ms.projectId}/namings`, {
				focus: namingId,
				from: `/projects/${ms.projectId}/maps/${ms.mapId}`
			})}
			onclick={onclose}
			title="Open in the naming list; the way back leads here">
			Open in Namings
		</a>
		<div class="ctx-separator"></div>
		<button class="ctx-item" onclick={() => { ms.toggleWithdraw(namingId, true); onclose(); }}>Restore</button>
	{:else}
	<button class="ctx-item" onclick={() => { onrename(namingId); onclose(); }}>Rename <span class="ctx-key">F2</span></button>
	<div class="ctx-separator"></div>
	{#each designations as d (d.value)}
		{#if d.value === current}
			<div class="ctx-item ctx-current" title="Current designation">
				<span class="designation-dot-sm" style="background: {d.color}"></span> {d.label}
				<span class="ctx-check" aria-label="current">✓</span>
			</div>
		{:else}
			<button class="ctx-item" onclick={() => { ms.startDesignation(namingId, d.value); onclose(); }}>
				<span class="designation-dot-sm" style="background: {d.color}"></span> {d.label}
			</button>
		{/if}
	{/each}
	<div class="ctx-separator"></div>
	{#if !isAxis}
		<button class="ctx-item" onclick={() => {
			if (ms.relatingFrom) { ms.completeRelating(namingId); } else { ms.startRelating(namingId); }
			onclose();
		}}>
			{ms.relatingFrom ? 'Connect here' : 'Relate...'}
		</button>
	{/if}
	{#if isAxis}
		<!-- keine Umdeutung der Achse zur Relation -->
	{:else if node?.mode === 'entity'}
		<!-- Dieselbe Handlung in beide Richtungen: der Modus der Erscheinung auf
		     dieser Map. Ein Akt im Stack, mit Notiz wie Rename und Designation. -->
		<button class="ctx-item" onclick={() => { ms.startMapReify(namingId); onclose(); }}
			title="Show this naming as a relation on this map; pick the two namings it relates next. Other maps stay as they are.">
			Show as relation (this map)
		</button>
	{:else if node?.mode === 'relation'}
		<button class="ctx-item" onclick={() => { ms.switchToEntityOnMap(namingId); onclose(); }}
			title="Show this relation as an entity on this map; what it relates stays, other maps stay as they are.">
			Show as entity (this map)
		</button>
	{/if}
	<button class="ctx-item" onclick={() => { ms.showStack(namingId); onclose(); }}>Stack</button>
	<!-- Voll bearbeiten heißt: in der Naming-Liste, mit Rückweg auf diese Karte. -->
	<a class="ctx-item"
		href={viewHref(`/projects/${ms.projectId}/namings`, {
			focus: namingId,
			from: `/projects/${ms.projectId}/maps/${ms.mapId}`
		})}
		onclick={onclose}
		title="Open in the naming list — everything is editable there; the way back leads here">
		Open in Namings
	</a>
	<button class="ctx-item" onclick={() => { ms.openMemoCreate([namingId]); onclose(); }}>Write memo</button>
	{#if !isAxis}
		<button class="ctx-item" onclick={() => { oncenter(namingId); onclose(); }}>
			Center
		</button>
	{/if}
	{#if labelPinned && onresetlabel}
		<button class="ctx-item" onclick={() => { onresetlabel(namingId); onclose(); }}
			title="The label was moved by hand; let it find its place on the line again">
			Reset label position
		</button>
	{/if}
	{#if ms.isPrimary && onunsituate && node && node.mode !== 'relation' && ms.isPlaced(node)}
		<button class="ctx-item" onclick={() => { onunsituate(namingId); onclose(); }}
			title="Return this naming to the Unplaced panel — revise the placement">
			Return to Unplaced
		</button>
	{/if}
	{#if ms.assigningToPhase && !isAxis}
		<div class="ctx-separator"></div>
		<button class="ctx-item" onclick={() => { ms.assignToPhase(ms.assigningToPhase!, namingId); onclose(); }}>
			+ Phase
		</button>
	{/if}
	{#if !isAxis}
		<div class="ctx-separator"></div>
		<button class="ctx-item" onclick={() => { ms.toggleWithdraw(namingId, false); onclose(); }}>Withdraw</button>
	{/if}
	{/if}
</div>

<style>
	.context-menu {
		position: fixed; z-index: 980; /* über der Cowork-Karte (950) */
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.35rem 0; min-width: 160px; max-width: 280px;
		/* Höher als das Fenster: dann im Menü scrollen statt abschneiden. */
		max-height: calc(100vh - 16px); overflow-y: auto;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.ctx-state { color: #8b8fa3; font-style: italic; }
	.ctx-header {
		padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #6b7280;
		border-bottom: 1px solid #2a2d3a; margin-bottom: 0.2rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	/* Die aktuelle Designation: markiert, kein Knopf (nichts zu tun). */
	.ctx-item.ctx-current { color: #e1e4e8; font-weight: 600; cursor: default; background: rgba(139, 156, 247, 0.08); }
	.ctx-item.ctx-current:hover { background: rgba(139, 156, 247, 0.08); }
	.ctx-check { margin-left: auto; color: #8b9cf7; }
	.ctx-item {
		display: flex; align-items: center; gap: 0.4rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.ctx-item:hover, .ctx-item:focus-visible { background: #2a2d3a; outline: none; }
	.ctx-key { margin-left: auto; font-size: 0.68rem; color: #6b7280; }
	a.ctx-item { text-decoration: none; }
	.ctx-separator { height: 1px; background: #2a2d3a; margin: 0.2rem 0; }
	.designation-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
</style>
