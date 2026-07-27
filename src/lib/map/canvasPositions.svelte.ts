// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeLayout, computeRadialLayout } from '$lib/canvas/layout.js';
import { computeSpatialRelations, type Formation } from '$lib/canvas/geometry.js';
import { estimateNodeSize } from '$lib/canvas/nodeSize.js';
import type { MapState } from './mapState.svelte.js';

// Find a collision-free spot near (cx, cy) by walking a golden-angle spiral
// outward and testing the card's real box against every occupied box.
// Deterministic — replaces the old random scatter that piled new cards on top
// of whatever already sat at the viewport center.
function findFreeSpot(
	cx: number,
	cy: number,
	box: { width: number; height: number },
	occupied: Array<{ x: number; y: number; width: number; height: number }>
): { x: number; y: number } {
	const GAP = 24;
	for (let i = 0; i < 500; i++) {
		const r = 34 * Math.sqrt(i);
		const a = i * 2.39996322973; // golden angle
		const x = cx + r * Math.cos(a);
		const y = cy + r * Math.sin(a);
		const clash = occupied.some(
			(o) =>
				Math.abs(o.x - x) < (o.width + box.width) / 2 + GAP &&
				Math.abs(o.y - y) < (o.height + box.height) / 2 + GAP
		);
		if (!clash) return { x, y };
	}
	return { x: cx, y: cy };
}

// Place every un-positioned non-relation node from `nodes` into `merged`,
// spiraling out from (cx, cy) against the real boxes of everything already
// placed. Used whenever SOME positions exist: running full ELK instead would
// produce coordinates in a fresh frame unrelated to the stored one — merging
// those drops new cards on top of existing ones.
function spiralPlaceUnpositioned(
	merged: Map<string, { x: number; y: number }>,
	nodes: any[],
	allNodes: any[],
	cx: number,
	cy: number
) {
	const nodeById = new Map<string, any>(allNodes.map((n: any) => [n.naming_id, n]));
	const occupied = [...merged.entries()].map(([oid, p]) => {
		const n = nodeById.get(oid);
		return { x: p.x, y: p.y, ...estimateNodeSize(n?.inscription || '', n?.mode !== 'silence') };
	});
	for (const node of nodes) {
		if (merged.has(node.naming_id) || node.mode === 'relation') continue;
		const box = estimateNodeSize(node.inscription || '', node.mode !== 'silence');
		const spot = findFreeSpot(cx, cy, box, occupied);
		merged.set(node.naming_id, spot);
		occupied.push({ ...spot, ...box });
	}
}

export type CanvasPositions = ReturnType<typeof createCanvasPositions>;

/**
 * Canvas position management: layout, radial center-on, spatial sync (SW/A),
 * topology snapshots, and position persistence.
 *
 * Extracted from +page.svelte to isolate the ~250 lines of position/layout
 * logic that have no business in the page orchestrator.
 */
export function createCanvasPositions(
	ms: MapState,
	viewport: { x: number; y: number; zoom: number },
) {
	const POS_AXIS_LEN = 800;

	// ─── Positions ───

	let positions = $state<Map<string, { x: number; y: number }>>(new Map());
	let layoutInitialized = false;
	let initDone = $state(false);
	let currentMapId: string | null = null;

	// Keep mapState.positionsRef in sync for unresolved tracking
	$effect(() => { ms.positionsRef = positions; });

	// Auto-place nodes that arrive after init (toolbar add, pull-onto-map,
	// import, AI writes): a node without a position is not rendered at all, so
	// without this a freshly added object stays invisible until the next full
	// page load. layoutNewNodes() itself keeps the primary-map exemption.
	let placing = false;
	$effect(() => {
		void ms.elements.length; void ms.silences.length; void ms.relations.length;
		if (!initDone || placing) return;
		const missing = [...ms.elements, ...ms.silences].some((n: any) => !positions.has(n.naming_id));
		if (!missing) return;
		placing = true;
		layoutNewNodes().finally(() => { placing = false; });
	});

	// ─── Center-on (radial layout) ───

	let centeredId = $state<string | null>(null);
	let preRadialPositions: Map<string, { x: number; y: number }> | null = null;

	const centeredConnections = $derived.by(() => {
		if (!centeredId) return null;
		const connected = new Set<string>([centeredId]);
		for (const rel of ms.relations) {
			const src = rel.directed_from || rel.part_source_id;
			const tgt = rel.directed_to || rel.part_target_id;
			if (src === centeredId || tgt === centeredId) {
				if (src) connected.add(src);
				if (tgt) connected.add(tgt);
				connected.add(rel.naming_id);
			}
		}
		return connected;
	});

	// ─── Spatial relation sync (SW/A maps) ───

	let spatialSyncPending = false;
	let spatialSyncQueued = false;

	// ─── Init & layout ───

	function initIfNeeded(mapId?: string) {
		// Reset on map change (SvelteKit may reuse component across navigations)
		if (mapId && mapId !== currentMapId) {
			currentMapId = mapId;
			layoutInitialized = false;
			initDone = false;
			positions = new Map();
			centeredId = null;
			preRadialPositions = null;
		}
		if (layoutInitialized) return;
		const allNodes = [...ms.elements, ...ms.relations, ...ms.silences];
		if (allNodes.length === 0) return;
		layoutInitialized = true;
		initPositions(allNodes);
	}

	async function initPositions(allNodes: any[]) {
		const stored = new Map<string, { x: number; y: number }>();
		let needsLayout = false;
		for (const node of allNodes) {
			const x = node.properties?.x;
			const y = node.properties?.y;
			if (typeof x === 'number' && typeof y === 'number') {
				stored.set(node.naming_id, { x, y });
			} else if (ms.isPrimary && node.mode !== 'relation') {
				// Primary map: an element without stored coordinates is
				// "unresolved" — it lives in the Halde until the researcher
				// situates it by hand. Auto-layouting (and persisting) it here
				// would make placement a machine act and silently undo every
				// "Return to Unplaced" on the next page load. layoutNewNodes
				// keeps the same exemption for nodes arriving after init.
			} else { needsLayout = true; }
		}
		if (needsLayout) {
			if (ms.mapType === 'positional') {
				const merged = new Map(stored);
				let offset = 0;
				for (const node of allNodes) {
					if (!merged.has(node.naming_id)) {
						merged.set(node.naming_id, { x: 50 + (offset % 4) * 120, y: -50 - Math.floor(offset / 4) * 100 });
						offset++;
					}
				}
				positions = merged;
				await saveAllPositions(merged);
			} else if (stored.size > 0) {
				// Mixed map: most nodes are placed, a few are new. Spiral-place
				// the new ones next to the existing layout (centroid anchor).
				// Do NOT run full ELK here: its coordinates live in a fresh
				// frame unrelated to the stored one — overlaying them drops new
				// cards on top of existing ones.
				// On the primary map only relations reach this branch (elements
				// without coordinates are unresolved, see above), so the spiral
				// gets nothing to place and midpoints do the work.
				const merged = new Map(stored);
				let cx = 0, cy = 0;
				for (const p of stored.values()) { cx += p.x; cy += p.y; }
				cx /= stored.size; cy /= stored.size;
				const layoutable = ms.isPrimary
					? allNodes.filter((n: any) => n.mode === 'relation')
					: allNodes;
				spiralPlaceUnpositioned(merged, layoutable, allNodes, cx, cy);
				placeRelationMidpoints(merged);
				positions = merged;
				if (merged.size > stored.size) await saveAllPositions(merged);
			} else if (ms.isPrimary) {
				// Primary map with nothing stored: every element is unresolved
				// and waits in the Halde. needsLayout can only be true here via
				// position-less relations, whose midpoints need placed endpoints
				// — nothing to compute yet.
				positions = stored;
			} else {
				try {
					// Fresh map: prefer the similarity layout so it opens as a
					// map, not a grid. Fall back to the geometric layout.
					const merged = new Map(stored);
					const sim = await computeSimilarityPositions();
					if (sim) {
						for (const [id, p] of sim) if (!merged.has(id)) merged.set(id, p);
					} else {
						const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
						for (const [id, p] of result.positions) if (!merged.has(id)) merged.set(id, { x: p.x, y: p.y });
					}
					placeRelationMidpoints(merged);
					positions = merged;
					await saveAllPositions(merged);
				} catch (err) {
					console.warn('layout failed, using stored positions:', err);
					placeRelationMidpoints(stored);
					positions = stored;
				}
			}
		} else { positions = stored; }
		initDone = true;
	}

	function placeRelationMidpoints(pos: Map<string, { x: number; y: number }>) {
		for (const rel of ms.relations) {
			if (pos.has(rel.naming_id)) continue;
			const srcId = rel.directed_from || rel.part_source_id;
			const tgtId = rel.directed_to || rel.part_target_id;
			const srcPos = srcId ? pos.get(srcId) : undefined;
			const tgtPos = tgtId ? pos.get(tgtId) : undefined;
			if (srcPos && tgtPos) {
				pos.set(rel.naming_id, { x: (srcPos.x + tgtPos.x) / 2, y: (srcPos.y + tgtPos.y) / 2 });
			}
		}
	}

	async function layoutNewNodes() {
		// On primary SitMap, don't auto-position elements from coding bridge.
		// They are "unresolved" — placement is a conscious analytical act.
		// Only auto-position elements that have stored x/y in properties (= previously placed).
		const unpositioned = [...ms.elements, ...ms.relations, ...ms.silences]
			.filter((n: any) => !positions.has(n.naming_id))
			.filter((n: any) => {
				if (!ms.isPrimary) return true;
				// On primary map: only layout nodes that have stored positions or are relations
				const px = n.properties?.x;
				const py = n.properties?.y;
				return (typeof px === 'number' && typeof py === 'number') || n.mode === 'relation';
			});
		if (unpositioned.length === 0) return;
		const merged = new Map(positions);
		// Previously placed nodes carry their position in properties.
		for (const node of unpositioned) {
			const px = node.properties?.x;
			const py = node.properties?.y;
			if (typeof px === 'number' && typeof py === 'number') {
				merged.set(node.naming_id, { x: px, y: py });
			}
		}
		const still = unpositioned.filter(
			(n: any) => !merged.has(n.naming_id) && n.mode !== 'relation'
		);
		if (still.length > 0) {
			if (merged.size > 0) {
				// Something is already placed: spiral new cards collision-free
				// around the viewport center. Full ELK would compute an
				// unrelated coordinate frame — overlaying it piles cards up.
				const cx = viewport.x ? -viewport.x / viewport.zoom + 400 : 400;
				const cy = viewport.y ? -viewport.y / viewport.zoom + 300 : 300;
				spiralPlaceUnpositioned(
					merged, still,
					[...ms.elements, ...ms.relations, ...ms.silences],
					cx, cy
				);
			} else {
				const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
				for (const [id, p] of result.positions) {
					if (!merged.has(id)) merged.set(id, { x: p.x, y: p.y });
				}
			}
		}
		placeRelationMidpoints(merged);
		positions = merged;
		await saveAllPositions(merged);
	}

	async function saveAllPositions(pos: Map<string, { x: number; y: number }>) {
		// While a radial center-on is active, `positions` holds a THROWAWAY layout
		// covering every node. Persisting it would silently overwrite the
		// researcher's real, hand-built coordinates for the whole map.
		// handleNodeDragEnd guards the same way (`if (!centeredId)`); the auto-place
		// path reaches here too, so it needs the same protection.
		if (centeredId) return;
		const arr = [...pos.entries()].map(([namingId, p]) => ({ namingId, x: p.x, y: p.y }));
		if (arr.length > 0) await ms.mapAction('updatePositions', { positions: arr });
	}

	function nodeCenter(namingId: string): { x: number; y: number } {
		const pos = positions.get(namingId);
		return pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
	}

	// Bounding box of everything currently placed, in canvas coordinates,
	// including each card's rendered size. Used to frame the map on open (and on
	// Reset) so the researcher lands on the content, never on empty space.
	function contentBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
		if (positions.size === 0) return null;
		const nodeById = new Map<string, any>();
		for (const n of [...ms.elements, ...ms.silences]) nodeById.set(n.naming_id, n);
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const [id, p] of positions) {
			const n = nodeById.get(id);
			const size = n
				? estimateNodeSize(n.current_inscription || n.inscription || '', n.mode !== 'silence')
				: { width: 60, height: 40 };
			// CanvasElement renders each card CENTERED on (x,y) via
			// translate(-50%,-50%), so a stored position is the card's CENTRE, not
			// its top-left. Treating it as top-left shifts the whole box by half a
			// card, which pushes the leftmost card off-screen once a fit is applied.
			const halfW = size.width / 2;
			const halfH = size.height / 2;
			if (p.x - halfW < minX) minX = p.x - halfW;
			if (p.y - halfH < minY) minY = p.y - halfH;
			if (p.x + halfW > maxX) maxX = p.x + halfW;
			if (p.y + halfH > maxY) maxY = p.y + halfH;
		}
		return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
	}

	// ─── Radial center-on ───

	function centerOn(id: string) {
		// Re-centering while already centered must keep the ORIGINAL layout as the
		// restore point. Overwriting it here would make uncenter() install the
		// previous radial throwaway as the real positions — which the next save
		// then persists over the researcher's hand-built map.
		if (!centeredId) preRadialPositions = new Map(positions);
		const newPositions = computeRadialLayout(id, ms.elements as any, ms.relations as any, ms.silences as any);
		const cx = viewport.x ? -viewport.x / viewport.zoom + 400 : 400;
		const cy = viewport.y ? -viewport.y / viewport.zoom + 300 : 300;
		const adjusted = new Map<string, { x: number; y: number }>();
		for (const [nid, pos] of newPositions) {
			adjusted.set(nid, { x: pos.x + cx, y: pos.y + cy });
		}
		positions = adjusted;
		centeredId = id;
	}

	function uncenter() {
		if (preRadialPositions) { positions = preRadialPositions; preRadialPositions = null; }
		centeredId = null;
	}

	// ─── Spatial relation sync (SW/A maps) ───

	async function syncSpatialRelations() {
		if (ms.mapType !== 'social-worlds' || centeredId) return;
		if (spatialSyncPending) { spatialSyncQueued = true; return; }
		spatialSyncPending = true;
		try {
			const formations: Formation[] = [];
			const plainElements: Array<{ id: string; x: number; y: number }> = [];
			for (const el of ms.elements) {
				const pos = positions.get(el.naming_id);
				if (!pos) continue;
				if (el.sw_role) {
					formations.push({ id: el.naming_id, x: pos.x, y: pos.y, rx: el.properties?.rx || 150, ry: el.properties?.ry || 100, rotation: el.properties?.rotation || 0, swRole: el.sw_role });
				} else { plainElements.push({ id: el.naming_id, x: pos.x, y: pos.y }); }
			}
			if (formations.length === 0) return;
			const computed = computeSpatialRelations(plainElements, formations);
			const existingContains = new Map<string, string>();
			const existingOverlaps = new Map<string, string>();
			for (const rel of ms.relations) {
				if (!rel.properties?.spatiallyDerived || ms.isWithdrawn(rel.properties)) continue;
				if (rel.valence === 'contains' && rel.directed_from && rel.directed_to) {
					existingContains.set(`${rel.directed_from}:${rel.directed_to}`, rel.naming_id);
				} else if (rel.valence === 'overlaps') {
					const src = rel.part_source_id; const tgt = rel.part_target_id;
					if (src && tgt) existingOverlaps.set([src, tgt].sort().join(':'), rel.naming_id);
				}
			}
			const toAdd: Array<{ sourceId: string; targetId: string; valence: string; symmetric: boolean }> = [];
			const toRemove: string[] = [];
			const computedContains = new Set<string>();
			const computedOverlaps = new Set<string>();
			for (const { elementId, formationId } of computed.elementInFormation) {
				const key = `${formationId}:${elementId}`; computedContains.add(key);
				if (!existingContains.has(key)) toAdd.push({ sourceId: formationId, targetId: elementId, valence: 'contains', symmetric: false });
			}
			for (const { innerId, outerId } of computed.formationInFormation) {
				const key = `${outerId}:${innerId}`; computedContains.add(key);
				if (!existingContains.has(key)) toAdd.push({ sourceId: outerId, targetId: innerId, valence: 'contains', symmetric: false });
			}
			for (const { formationA, formationB } of computed.formationOverlaps) {
				const key = [formationA, formationB].sort().join(':'); computedOverlaps.add(key);
				if (!existingOverlaps.has(key)) toAdd.push({ sourceId: formationA, targetId: formationB, valence: 'overlaps', symmetric: true });
			}
			for (const [key, relId] of existingContains) { if (!computedContains.has(key)) toRemove.push(relId); }
			for (const [key, relId] of existingOverlaps) { if (!computedOverlaps.has(key)) toRemove.push(relId); }
			if (toAdd.length > 0 || toRemove.length > 0) {
				await ms.mapAction('syncSpatialRelations', { add: toAdd, remove: toRemove });
				await ms.reload();
			}
		} finally {
			spatialSyncPending = false;
			if (spatialSyncQueued) { spatialSyncQueued = false; syncSpatialRelations(); }
		}
	}

	// ─── Drag handler (clamps for positional maps) ───

	function handleNodeDragEnd(id: string, x: number, y: number) {
		if (ms.mapType === 'positional') {
			x = Math.max(10, Math.min(POS_AXIS_LEN - 10, x));
			y = Math.max(-POS_AXIS_LEN + 10, Math.min(-10, y));
		}
		positions = new Map(positions).set(id, { x, y });
		if (!centeredId) ms.mapAction('updatePosition', { namingId: id, x, y }).then(() => syncSpatialRelations());
	}

	// Un-situate: drop a placed naming back to the Halde. Revising a placement is a
	// human act on a derivative projection — no naming_act.
	//
	// The ORDER here is load-bearing. The auto-place $effect above reads
	// `positions`, so the instant we drop the entry Svelte flushes that effect on
	// the next microtask — long before any await below resolves. If the node still
	// carried its stale in-memory properties.x/y at that moment, layoutNewNodes'
	// primary-map exemption would re-admit it, put it straight back, and
	// saveAllPositions would POST the very coordinates we just deleted back into the
	// database — making this a silent no-op. So: clear the server first, strip the
	// in-memory coordinates, and only then drop the local position, holding
	// `placing` across the whole operation as a second line of defence.
	async function unsituate(id: string) {
		if (!positions.has(id)) return;
		// Radial center-on replaces `positions` with a throwaway layout; un-situating
		// out of it would persist that layout over the real one. Refuse, exactly as
		// handleNodeDragEnd refuses to write while centered.
		if (centeredId) return;
		placing = true;
		try {
			// mapAction returns null on a non-OK response (e.g. a read-only map).
			// Bail before touching local state so the UI never claims a clear that
			// the database refused.
			const res = await ms.mapAction('clearPosition', { namingId: id });
			if (!res) return;
			const node = ms.findNode(id);
			if (node?.properties) {
				delete node.properties.x;
				delete node.properties.y;
			}
			const next = new Map(positions);
			next.delete(id);
			positions = next;
			preRadialPositions?.delete(id);
			await ms.reload();
		} finally {
			placing = false;
		}
	}

	// ─── Topology ───

	function positionsToObj(): Record<string, { x: number; y: number }> {
		// While a radial center-on is active, `positions` holds the throwaway
		// projection. Every consumer (topology buffer, snapshots, the
		// beforeunload beacon) means the researcher's real layout — capturing the
		// radial one would let it come back as truth via a later restore.
		const src = centeredId && preRadialPositions ? preRadialPositions : positions;
		const obj: Record<string, { x: number; y: number }> = {};
		for (const [id, pos] of src) obj[id] = { x: pos.x, y: pos.y };
		return obj;
	}

	async function saveTopologyBuffer() {
		if (positions.size === 0) return;
		await ms.mapAction('saveTopologyBuffer', { positions: positionsToObj() });
	}

	async function saveTopologySnapshot(autoLabel?: string) {
		// Two call sites: TopoPanel "Save" (no arg → prompt the user) and
		// runAutoLayout (auto-label, no prompt). Returning a boolean lets
		// callers distinguish cancel-by-user from snapshot-was-taken.
		let label: string | null;
		if (autoLabel !== undefined) {
			label = autoLabel;
		} else {
			label = prompt('Snapshot label:');
			if (label === null) return false;
		}
		await ms.mapAction('saveTopologySnapshot', { label: label || undefined, positions: positionsToObj() });
		return true;
	}

	async function restoreTopologySnapshot(seq: number) {
		const result = await ms.mapAction('restoreTopologySnapshot', { seq });
		if (!result?.positions) { ms.showAiNotification('Restore failed'); return; }
		const newPos = new Map<string, { x: number; y: number }>();
		for (const [id, pos] of Object.entries(result.positions as Record<string, { x: number; y: number }>)) {
			newPos.set(id, { x: pos.x, y: pos.y });
		}
		for (const [id, pos] of positions) { if (!newPos.has(id)) newPos.set(id, pos); }
		positions = newPos;
	}

	async function loadTopoSnapshots(): Promise<any[]> {
		const res = await ms.mapAction('listTopologySnapshots');
		return res?.snapshots || [];
	}

	// ─── Auto-layout ───

	// Similarity layout (server-side, embedding → MDS): nearness = semantic
	// nearness, so the map reads as a map, not a grid. Returns null on any
	// failure so callers fall back to the geometric layout.
	async function computeSimilarityPositions(): Promise<Map<string, { x: number; y: number }> | null> {
		const res = await ms.mapAction('similarityLayout');
		if (!res?.positions) return null;
		const m = new Map<string, { x: number; y: number }>();
		for (const [id, p] of Object.entries(res.positions as Record<string, { x: number; y: number }>)) {
			m.set(id, { x: p.x, y: p.y });
		}
		return m.size ? m : null;
	}

	async function runAutoLayout() {
		// Layout overwrites every position. Snapshot the current state first
		// with an auto-label so the user can revert from the Snapshots panel.
		if (positions.size > 0) {
			const ts = new Date().toLocaleString();
			await saveTopologySnapshot(`Before Layout — ${ts}`);
		}
		centeredId = null; preRadialPositions = null;
		let newPos = await computeSimilarityPositions();
		if (!newPos) {
			const result = await computeLayout(ms.elements as any, ms.relations as any, ms.silences as any);
			newPos = new Map<string, { x: number; y: number }>();
			for (const [id, p] of result.positions) newPos.set(id, { x: p.x, y: p.y });
		}
		placeRelationMidpoints(newPos);
		positions = newPos;
		await saveAllPositions(newPos);
	}

	// ─── Formation resize/rotate (SW/A maps, needs spatial sync) ───

	async function handleFormationResize(namingId: string, newRx: number, newRy: number) {
		await ms.mapAction('updateProperties', { namingId, properties: { rx: newRx, ry: newRy } });
		await ms.reload(); syncSpatialRelations();
	}

	async function handleFormationRotate(namingId: string, newRotation: number) {
		await ms.mapAction('updateProperties', { namingId, properties: { rotation: newRotation } });
		await ms.reload(); syncSpatialRelations();
	}

	return {
		POS_AXIS_LEN,

		// Position data
		get positions() { return positions; },
		nodeCenter,
		contentBounds,

		// Center-on
		get centeredId() { return centeredId; },
		get centeredConnections() { return centeredConnections; },
		centerOn,
		uncenter,

		// Layout
		initIfNeeded,
		layoutNewNodes,
		runAutoLayout,
		handleNodeDragEnd,
		unsituate,

		// Formation operations (SW/A)
		handleFormationResize,
		handleFormationRotate,

		// Topology
		saveTopologyBuffer,
		saveTopologySnapshot,
		restoreTopologySnapshot,
		loadTopoSnapshots,
		positionsToObj,
	};
}
