<script lang="ts">
	import InfiniteCanvas from '$lib/canvas/InfiniteCanvas.svelte';
	import CanvasElement from '$lib/canvas/CanvasElement.svelte';
	import CanvasConnection from '$lib/canvas/CanvasConnection.svelte';
	import CanvasRegion from '$lib/canvas/CanvasRegion.svelte';
	import { createViewport } from '$lib/canvas/viewport.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';

	let { data } = $props();

	const viewport = createViewport();
	const selection = createSelection();

	const mapType = $derived(data.map.properties?.mapType || 'situational');

	// Reactive map data
	let elements = $state(data.mapElements.map((e: any) => ({
		id: e.id,
		label: e.label,
		kind: e.kind,
		x: e.aspect_properties?.x ?? Math.random() * 600,
		y: e.aspect_properties?.y ?? Math.random() * 400,
		color: e.properties?.color || e.aspect_properties?.color || '#8b9cf7',
		rx: e.aspect_properties?.rx,
		ry: e.aspect_properties?.ry
	})));

	let relations = $state(data.mapRelations.map((r: any) => ({
		id: r.id,
		label: r.label,
		sourceId: r.source_id,
		targetId: r.target_id,
		color: r.properties?.color || '#4b5563',
		isMeta: r.aspect_properties?.isMeta || false
	})));

	// Mode for situational maps
	let mode = $state<'messy' | 'ordered'>('messy');
	let connectingFrom = $state<string | null>(null);
	let newEntityLabel = $state('');
	let showPalette = $state(true);

	function getElementPos(id: string) {
		const el = elements.find(e => e.id === id);
		return el ? { x: el.x + 50, y: el.y + 25 } : { x: 0, y: 0 };
	}

	async function onDragEnd(id: string, x: number, y: number) {
		// Update local state
		const el = elements.find(e => e.id === id);
		if (el) {
			el.x = x;
			el.y = y;
		}

		// Persist aspect (position on this map)
		await fetch(`/api/projects/${data.projectId}/elements/${id}/aspects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contextId: data.map.id, properties: { x, y } })
		});
	}

	function onElementClick(id: string, e: MouseEvent) {
		if (mode === 'ordered' && connectingFrom) {
			if (connectingFrom !== id) {
				createRelation(connectingFrom, id);
			}
			connectingFrom = null;
		} else if (mode === 'ordered' && e.shiftKey) {
			connectingFrom = id;
		} else {
			selection.select(id, e.ctrlKey || e.metaKey);
		}
	}

	async function onCanvasClick(x: number, y: number) {
		selection.clear();
		connectingFrom = null;
	}

	async function addEntity() {
		if (!newEntityLabel.trim()) return;

		// Create entity element
		const res = await fetch(`/api/projects/${data.projectId}/elements`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind: 'entity', label: newEntityLabel.trim() })
		});
		if (!res.ok) return;
		const entity = await res.json();

		// Place it on the map with random position
		const x = 100 + Math.random() * 400;
		const y = 100 + Math.random() * 300;
		await fetch(`/api/projects/${data.projectId}/elements/${entity.id}/aspects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contextId: data.map.id, properties: { x, y } })
		});

		elements = [...elements, { id: entity.id, label: entity.label, kind: 'entity', x, y, color: '#8b9cf7' }];
		newEntityLabel = '';
	}

	async function placeExistingEntity(entityId: string, label: string) {
		const x = 100 + Math.random() * 400;
		const y = 100 + Math.random() * 300;
		await fetch(`/api/projects/${data.projectId}/elements/${entityId}/aspects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contextId: data.map.id, properties: { x, y } })
		});
		elements = [...elements, { id: entityId, label, kind: 'entity', x, y, color: '#8b9cf7' }];
	}

	async function createRelation(sourceId: string, targetId: string) {
		const label = prompt('Relation label:') || 'relates to';
		const res = await fetch(`/api/projects/${data.projectId}/elements`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ kind: 'relation', label, sourceId, targetId })
		});
		if (!res.ok) return;
		const rel = await res.json();

		// Place relation on map
		await fetch(`/api/projects/${data.projectId}/elements/${rel.id}/aspects`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contextId: data.map.id, properties: {} })
		});

		relations = [...relations, { id: rel.id, label, sourceId, targetId, color: '#4b5563', isMeta: false }];
	}
</script>

<div class="map-page">
	<div class="map-toolbar">
		<a href="/projects/{data.projectId}/maps" class="back">&larr; Maps</a>
		<h2>{data.map.label}</h2>
		<span class="map-type-badge">{mapType}</span>

		{#if mapType === 'situational'}
			<div class="mode-switch">
				<button class:active={mode === 'messy'} onclick={() => mode = 'messy'}>Messy</button>
				<button class:active={mode === 'ordered'} onclick={() => mode = 'ordered'}>Ordered</button>
			</div>
		{/if}

		{#if connectingFrom}
			<span class="connecting-hint">Click target element to connect (Esc to cancel)</span>
		{/if}

		<button class="toggle-palette" onclick={() => showPalette = !showPalette}>
			{showPalette ? 'Hide palette' : 'Show palette'}
		</button>
	</div>

	<div class="map-workspace">
		<div class="canvas-area">
			<InfiniteCanvas {viewport} oncanvasclick={onCanvasClick}>
				{#each relations as rel}
					{@const s = getElementPos(rel.sourceId)}
					{@const t = getElementPos(rel.targetId)}
					<CanvasConnection
						x1={s.x} y1={s.y}
						x2={t.x} y2={t.y}
						label={rel.label}
						color={rel.color}
						isMeta={rel.isMeta}
						selected={selection.isSelected(rel.id)}
						onclick={() => selection.select(rel.id)}
					/>
				{/each}

				{#each elements as el}
					<CanvasElement
						id={el.id}
						x={el.x}
						y={el.y}
						label={el.label}
						color={el.color}
						kind={el.kind}
						selected={selection.isSelected(el.id)}
						ondragend={onDragEnd}
						onclick={onElementClick}
					/>
				{/each}
			</InfiniteCanvas>
		</div>

		{#if showPalette}
			<div class="palette">
				<h3>Add element</h3>
				<form onsubmit={e => { e.preventDefault(); addEntity(); }}>
					<input type="text" placeholder="New entity..." bind:value={newEntityLabel} />
					<button type="submit" class="btn-sm">Add</button>
				</form>

				{#if data.allEntities.length > 0}
					<h4>Existing entities</h4>
					<div class="entity-list">
						{#each data.allEntities as entity}
							{@const onMap = elements.some(e => e.id === entity.id)}
							<button
								class="entity-item"
								disabled={onMap}
								onclick={() => placeExistingEntity(entity.id, entity.label)}
							>
								{entity.label}
								{#if onMap}<span class="on-map">on map</span>{/if}
							</button>
						{/each}
					</div>
				{/if}

				{#if mode === 'ordered'}
					<div class="hint">
						Shift+click an element, then click another to create a relation.
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<svelte:window onkeydown={e => { if (e.key === 'Escape') { connectingFrom = null; selection.clear(); } }} />

<style>
	.map-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 6rem);
		margin: -2rem;
	}

	.map-toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #2a2d3a;
		background: #13151e;
	}

	.back { font-size: 0.8rem; color: #6b7280; }
	h2 { font-size: 1rem; font-weight: 600; }

	.map-type-badge {
		font-size: 0.7rem; color: #8b9cf7; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.1); padding: 0.15rem 0.5rem; border-radius: 4px;
	}

	.mode-switch {
		display: flex; border: 1px solid #2a2d3a; border-radius: 5px; overflow: hidden; margin-left: auto;
	}
	.mode-switch button {
		background: transparent; border: none; color: #8b8fa3;
		padding: 0.3rem 0.75rem; font-size: 0.8rem; cursor: pointer;
	}
	.mode-switch button.active { background: #1e2030; color: #e1e4e8; }

	.connecting-hint { font-size: 0.8rem; color: #f59e0b; margin-left: 0.5rem; }

	.toggle-palette {
		margin-left: auto; background: none; border: 1px solid #2a2d3a; color: #8b8fa3;
		padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer;
	}

	.map-workspace { display: flex; flex: 1; min-height: 0; }

	.canvas-area { flex: 1; position: relative; }

	.palette {
		width: 240px;
		background: #13151e;
		border-left: 1px solid #2a2d3a;
		padding: 1rem;
		overflow-y: auto;
	}
	.palette h3 { font-size: 0.85rem; color: #8b8fa3; margin-bottom: 0.5rem; }
	.palette h4 { font-size: 0.75rem; color: #6b7280; margin: 1rem 0 0.5rem; text-transform: uppercase; }

	.palette form { display: flex; gap: 0.4rem; }
	.palette input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.palette input:focus { outline: none; border-color: #8b9cf7; }

	.btn-sm {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px;
		padding: 0.4rem 0.6rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}

	.entity-list { display: flex; flex-direction: column; gap: 0.2rem; }
	.entity-item {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.4rem 0.6rem; color: #c9cdd5; font-size: 0.8rem; text-align: left; cursor: pointer;
	}
	.entity-item:hover:not(:disabled) { border-color: #8b9cf7; }
	.entity-item:disabled { opacity: 0.5; cursor: default; }

	.on-map { font-size: 0.65rem; color: #6b7280; margin-left: 0.25rem; }

	.hint {
		margin-top: 1rem; font-size: 0.75rem; color: #6b7280;
		padding: 0.5rem; background: #1e2030; border-radius: 5px;
	}
</style>
