<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { createFloatingPanel } from './floatingPanel.svelte.js';
	import type { CanvasPositions } from './canvasPositions.svelte.js';
	import { quoted } from '$lib/shared/namingLabel.js';

	let { cp }: { cp: CanvasPositions } = $props();

	const ms = getMapState();

	// Beweglich und in der Größe ziehbar; Lage pro Karte gemerkt.
	const panel = createFloatingPanel({
		key: `${ms.mapId}:unplaced`,
		width: 280,
		// Nach Inhalt hoch (max-height greift): drei unplatzierte Namings
		// brauchen keine 360 px leere Fläche über der Karte (Testlauf 8).
		height: null,
		anchor: 'top-right',
		minWidth: 200,
		minHeight: 140,
		maxWidth: 620,
		// Ganz in der Canvas: halb hinausgeschoben (schmales Fenster, Phasen-
		// Panel offen) waren die place-Knöpfe am rechten Rand abgeschnitten.
		keepInside: true
	});

	type GroupKey = 'phase' | 'document';
	let groupBy = $state<GroupKey>('document');

	// Zugeklappt bleibt zugeklappt, auch nach dem Neuladen.
	const COLLAPSE_KEY = 'tqda:unplaced-collapsed';
	let collapsed = $state(readCollapsed());
	function readCollapsed(): boolean {
		try { return typeof window !== 'undefined' && window.localStorage?.getItem(COLLAPSE_KEY) === '1'; }
		catch { return false; }
	}
	function toggleCollapsed() {
		collapsed = !collapsed;
		try { window.localStorage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ohne Speicher eben ungemerkt */ }
	}

	// If the map has no phases, fall back to document grouping so the
	// selector doesn't offer a useless option.
	$effect(() => {
		if (ms.phases.length === 0 && groupBy === 'phase') groupBy = 'document';
	});

	const unplaced = $derived(
		ms.isPrimary
			? ms.allItems.filter((n: any) => ms.isUnresolved(n))
			: []
	);

	type Group = { key: string; label: string; items: any[] };

	const grouped = $derived.by<Group[]>(() => {
		if (unplaced.length === 0) return [];
		const out = new Map<string, Group>();
		const push = (key: string, label: string, item: any) => {
			if (!out.has(key)) out.set(key, { key, label, items: [] });
			out.get(key)!.items.push(item);
		};
		if (groupBy === 'phase') {
			const phaseLabel = (id: string) =>
				ms.phases.find((p: any) => p.id === id)?.label ?? 'Unnamed phase';
			for (const it of unplaced) {
				const ids: string[] = it.phase_ids ?? [];
				if (ids.length === 0) push('__none__', '— no phase —', it);
				else for (const id of ids) push(id, phaseLabel(id), it);
			}
		} else {
			for (const it of unplaced) {
				const docs: { id: string; label: string }[] = it.document_anchors ?? [];
				if (docs.length === 0) push('__none__', '— no document anchor —', it);
				else for (const d of docs) push(d.id, d.label || 'Untitled document', it);
			}
		}
		return [...out.values()].sort((a, b) => {
			if (a.key === '__none__') return 1;
			if (b.key === '__none__') return -1;
			return a.label.localeCompare(b.label);
		});
	});

	// Auf einen freien Platz in der Mitte des Ausschnitts; eine Relation setzt
	// ihre noch unplatzierten Endpunkte (sie steht, sobald die stehen).
	function place(it: any) {
		cp.placeUnplaced(it);
	}

	function placeTitle(it: any): string {
		if (it.mode !== 'relation') return 'Place at a free spot in the middle of the view';
		if (cp.missingEndpoints(it)) return 'An endpoint of this relation is not on this map — add it to the map first';
		return 'Place its unplaced endpoints in the middle of the view; the relation appears between them';
	}

	// Drag a naming out of the Halde onto a chosen point on the canvas. The
	// canvas reads this MIME on drop and writes the position at the drop point —
	// the deliberate analytical act of situating (the researcher chooses where).
	function onDragStart(e: DragEvent, namingId: string) {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData('application/x-naming-id', namingId);
		e.dataTransfer.effectAllowed = 'move';
	}
</script>

{#if ms.isPrimary && unplaced.length > 0}
	<aside class="unplaced-panel" class:collapsed use:panel.attach style={panel.style}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<header class="up-head" onpointerdown={panel.drag}
			ondblclick={(e) => { if (!(e.target as Element).closest('button, select, a, input')) panel.reset(); }}
			title="Drag to move · double-click resets">
			<button class="up-toggle" onclick={toggleCollapsed} title={collapsed ? 'Expand' : 'Collapse'}
				aria-expanded={!collapsed} aria-label={collapsed ? 'Expand Unplaced' : 'Collapse Unplaced'}>
				{collapsed ? '▸' : '▾'}
			</button>
			<!-- Der Titel klappt ebenfalls auf und zu. -->
			<button class="up-title" onclick={toggleCollapsed} aria-expanded={!collapsed}>
				Unplaced <span class="up-count">{unplaced.length}</span>
			</button>
			{#if !collapsed}
				<select class="up-group-select" bind:value={groupBy} aria-label="Group unplaced by">
					<option value="document">by Document</option>
					{#if ms.phases.length > 0}
						<option value="phase">by Phase</option>
					{/if}
				</select>
			{/if}
		</header>

		{#if !collapsed}
			<p class="up-hint">
				These namings exist in the situation but have not yet been placed on the
				canvas. <strong>Drag one onto the canvas</strong> to situate it where it
				belongs — placement is a deliberate analytical act.
			</p>
			<div class="up-body">
				{#each grouped as g (g.key)}
					<div class="up-group">
						<div class="up-group-label" title={g.label}>{g.label}</div>
						{#each g.items as it (it.naming_id + ':' + g.key)}
							{@const stuck = it.mode === 'relation' && cp.missingEndpoints(it)}
							{@const itLabel = ms.findInscription(it.naming_id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="up-item"
								class:up-rejected={ms.isRejected(it)}
								class:up-hidden={ms.isHidden(it)}
								draggable={stuck ? 'false' : 'true'}
								ondragstart={(e) => onDragStart(e, it.naming_id)}
								title={ms.isRejected(it)
									? `${ms.rejectionLabel(it)} — shown because the hidden/rejected filter is off`
									: ms.isHidden(it)
										? 'All its passages are hidden in the material — shown because the hidden/rejected filter is off'
										: it.mode === 'relation'
											? 'A relation stands between its endpoints: drag it onto the canvas or use the button to place them'
											: 'Drag onto the canvas to place, or use the button for the middle of the view'}
							>
								<span class="up-mode" data-mode={it.mode} title={it.mode}></span>
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<span class="up-label" title={itLabel} onclick={() => ms.showStack(it.naming_id)}>
									{itLabel}
								</span>
								<button class="up-place" onclick={() => place(it)} disabled={stuck} title={placeTitle(it)}
									aria-label={`Place ${quoted(itLabel)}`}>place</button>
							</div>
						{/each}
					</div>
				{/each}
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="up-grip up-grip-w" onpointerdown={(e) => panel.resize(e, 'w')}></div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="up-grip up-grip-e" onpointerdown={(e) => panel.resize(e, 'e')}></div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="up-grip up-grip-s" onpointerdown={(e) => panel.resize(e, 's')}></div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="up-grip up-grip-sw" onpointerdown={(e) => panel.resize(e, 'sw')} title="Drag to resize"></div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="up-grip up-grip-se" onpointerdown={(e) => panel.resize(e, 'se')} title="Drag to resize"></div>
		{/if}
	</aside>
{/if}

<style>
	.unplaced-panel {
		/* Position und Größe kommen aus floatingPanel (Inline-Style). */
		position: absolute;
		display: flex;
		flex-direction: column;
		background: rgba(22, 24, 34, 0.97);
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		color: #e1e4e8;
		font-size: 0.8rem;
		/* Unter dem Stack-Panel: die Halde ist Vorrat, das Stack-Panel ist das,
		   was der Forscher gerade ansieht. */
		z-index: 30;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}
	.unplaced-panel.collapsed { width: auto !important; height: auto !important; }

	.up-head {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid #2a2d3a;
		cursor: move;
		touch-action: none;
		flex-shrink: 0;
	}
	.up-toggle {
		background: none; border: none; color: #8b9cf7;
		font-size: 0.75rem; cursor: pointer; padding: 0; line-height: 1;
	}
	/* Nur so breit wie der Text: der Rest der Kopfzeile bleibt Griff zum Verschieben. */
	.up-title {
		font-weight: 600; color: #fbbf24; flex: 0 1 auto; margin-right: auto; text-align: left;
		background: none; border: none; padding: 0; font-size: inherit; font-family: inherit; cursor: pointer;
	}
	.up-count {
		background: rgba(251, 191, 36, 0.18);
		color: #fbbf24;
		border-radius: 9px; padding: 0 0.45rem;
		font-size: 0.7rem; margin-left: 0.25rem;
	}
	.up-group-select {
		background: #0f1117; color: #c9cdd5;
		border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.15rem 0.35rem; font-size: 0.72rem;
	}

	.up-hint {
		padding: 0.5rem 0.7rem 0; margin: 0;
		font-size: 0.7rem; color: #8b8fa3; line-height: 1.4;
		flex-shrink: 0;
	}

	.up-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.4rem 0.4rem 0.6rem; }

	/* Ziehleisten — gleiche Geste wie die Reader-Spalten, nur an vier Kanten. */
	.up-grip { position: absolute; touch-action: none; }
	.up-grip-w { left: -3px; top: 0; bottom: 8px; width: 7px; cursor: ew-resize; }
	.up-grip-e { right: -3px; top: 0; bottom: 8px; width: 7px; cursor: ew-resize; }
	.up-grip-s { left: 8px; right: 8px; bottom: -3px; height: 7px; cursor: ns-resize; }
	.up-grip-sw { left: -3px; bottom: -3px; width: 14px; height: 14px; cursor: nesw-resize; }
	.up-grip-se { right: -3px; bottom: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
	.up-grip-se::after, .up-grip-sw::after {
		content: ''; position: absolute; bottom: 3px; width: 6px; height: 6px;
		border-bottom: 2px solid #3a3d4a;
	}
	.up-grip-se::after { right: 3px; border-right: 2px solid #3a3d4a; }
	.up-grip-sw::after { left: 3px; border-left: 2px solid #3a3d4a; }
	.up-grip:hover::after { border-color: #8b9cf7; }
	.up-group + .up-group { margin-top: 0.5rem; }
	.up-group-label {
		font-size: 0.65rem; text-transform: uppercase;
		letter-spacing: 0.05em; color: #6b7280;
		padding: 0.3rem 0.25rem 0.2rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}

	.up-item {
		display: flex; align-items: center; gap: 0.35rem;
		padding: 0.3rem 0.4rem;
		border-radius: 4px;
		cursor: grab;
	}
	.up-item:hover { background: rgba(139, 156, 247, 0.08); }
	.up-item:active { cursor: grabbing; }
	/* Nur sichtbar, solange der Schalter sie hereinholt — sonst stehen sie gar
	   nicht in der Liste. Durchstrich = dein Urteil über den Cue; blass =
	   Passagen im Material ausgeblendet. */
	.up-item.up-rejected .up-label { text-decoration: line-through; }
	.up-item.up-rejected, .up-item.up-hidden { opacity: 0.55; }
	.up-mode {
		width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
		background: #6b7280;
	}
	/* Der Modus als Form, nicht als Farbe: Orange ist die Farbe der
	   Characterization (Testlauf 11). Entität Punkt, Relation Strich, Stille
	   leerer Kreis. */
	.up-mode[data-mode="entity"] { background: #8b9cf7; }
	.up-mode[data-mode="relation"] { width: 10px; height: 2px; border-radius: 1px; background: #8b9cf7; }
	.up-mode[data-mode="silence"] { background: transparent; border: 1px dashed #8b9cf7; box-sizing: border-box; }
	.up-label {
		flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		cursor: pointer; color: #e1e4e8;
	}
	.up-label:hover { color: #a5b4fc; }
	.up-place {
		background: rgba(139, 156, 247, 0.15);
		color: #a5b4fc;
		border: 1px solid rgba(139, 156, 247, 0.3);
		border-radius: 4px;
		padding: 0.12rem 0.45rem;
		font-size: 0.7rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.up-place:hover:not(:disabled) { background: rgba(139, 156, 247, 0.3); }
	.up-place:disabled { opacity: 0.4; cursor: default; }
</style>
