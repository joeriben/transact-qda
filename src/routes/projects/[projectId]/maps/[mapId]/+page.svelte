<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import InfiniteCanvas from '$lib/canvas/InfiniteCanvas.svelte';
	import CanvasElement from '$lib/canvas/CanvasElement.svelte';
	import CanvasConnection from '$lib/canvas/CanvasConnection.svelte';
	import { createViewport } from '$lib/canvas/viewport.svelte.js';
	import { createSelection } from '$lib/canvas/selection.svelte.js';
	import FormationNode from '$lib/canvas/FormationNode.svelte';

	import { createMapState, setMapState, type RevealOptions } from '$lib/map/mapState.svelte.js';
	import { createCanvasPositions, type ViewInsets } from '$lib/map/canvasPositions.svelte.js';
	import MapToolbar from '$lib/map/MapToolbar.svelte';
	import TopoPanel from '$lib/map/TopoPanel.svelte';
	import MemoPanel from '$lib/map/MemoPanel.svelte';
	import NamingActPrompt from '$lib/map/NamingActPrompt.svelte';
	import RelationForm from '$lib/map/RelationForm.svelte';
	import StackPanel from '$lib/map/StackPanel.svelte';
	import ContextMenu from '$lib/map/ContextMenu.svelte';
	import PhasesSidebar from '$lib/map/PhasesSidebar.svelte';
	import UnplacedPanel from '$lib/map/UnplacedPanel.svelte';
	import ListItemCard from '$lib/map/ListItemCard.svelte';
	import OutsidePanel from '$lib/map/OutsidePanel.svelte';
	import MemoCreateForm from '$lib/map/MemoCreateForm.svelte';
	import CanvasMapNode from '$lib/map/CanvasMapNode.svelte';
	import MemoTooltip from '$lib/map/MemoTooltip.svelte';
	import CanvasRelationNode from '$lib/map/CanvasRelationNode.svelte';
	import InlineRename from '$lib/canvas/InlineRename.svelte';
	import { keepInWindow } from '$lib/canvas/dom.js';
	import { page } from '$app/stores';
	import { tick, untrack } from 'svelte';
	import { scrollIntoViewStable } from '$lib/shared/rueckweg.js';
	import { SW_ROLE_STYLES } from '$lib/shared/constants.js';

	let { data } = $props();

	const viewport = createViewport();
	const selection = createSelection();
	const ms = createMapState(data, viewport);
	setMapState(ms);
	const cp = createCanvasPositions(
		ms,
		viewport,
		() => (canvasContainerEl ? { width: canvasContainerEl.clientWidth, height: canvasContainerEl.clientHeight } : null),
		() => overlayInsets()
	);
	// Ein Naming in den Blick holen (z. B. „schon auf dieser Karte"), auf Wunsch
	// mit offenem Stack (bestehende Relation bei 409, Chips der Cowork-Karte).
	ms.revealHandler = (id: string, opts?: RevealOptions) => void revealNode(id, opts);

	// Sync data from server when props change
	$effect(() => { ms.syncData(data); });

	let viewMode = $state<'canvas' | 'list'>('canvas');
	let canvasContainerEl = $state<HTMLDivElement | null>(null);
	/** Hinweise und Formulare oben über der Karte (Relate, Akt-Memo, Snapshots …). */
	let overlaysEl = $state<HTMLDivElement | null>(null);
	let posMapFitted = false;
	let contentFitted = false;
	let fittedFor: string | null = null;

	// Was Panels über der Karte verdecken (Unplaced, Stack, Hinweise oben), in
	// Pixeln vom jeweiligen Rand der Canvas-Fläche. Einpassen und Platzieren
	// rechnen mit der Fläche daneben — sonst lag der Inhalt unter der Halde.
	function overlayInsets(): ViewInsets {
		const el = canvasContainerEl;
		const none: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
		if (!el) return none;
		const c = el.getBoundingClientRect();
		if (c.width <= 0 || c.height <= 0) return none;
		const ov = overlaysEl?.getBoundingClientRect();
		let top0 = ov && ov.height > 0 ? Math.max(0, ov.bottom - c.top) : 0;
		// Das offene Feld „New naming/formation" hängt aus der Werkzeugleiste in
		// die Karte: Neues landete darunter (Testlauf 8, SW/A).
		const pop = document.querySelector<HTMLElement>('.naming-pop')?.getBoundingClientRect();
		if (pop && pop.height > 0 && pop.bottom > c.top && pop.top < c.bottom) top0 = Math.max(top0, pop.bottom - c.top);
		const panels = [...el.querySelectorAll<HTMLElement>('.unplaced-panel:not(.collapsed), .canvas-stack-panel')]
			.map((p) => ({ r: p.getBoundingClientRect(), stack: p.matches('.canvas-stack-panel') }))
			.filter(({ r }) => r.width > 0 && r.right > c.left && r.left < c.right);
		const measure = (list: typeof panels): ViewInsets => {
			const ins: ViewInsets = { left: 0, right: 0, top: top0, bottom: 0 };
			for (const { r } of list) {
				// Ein niedriges Panel oben (Unplaced mit drei Namings) nimmt nicht die
				// ganze Spalte darunter: dann zählt es als Streifen oben, sofern das
				// weniger Fläche kostet als die Spalte (Testlauf 8: 19 % beim Öffnen).
				const sideLoss = Math.min(r.right, c.right) - Math.max(r.left, c.left);
				const topLoss = r.bottom - c.top;
				if (r.top - c.top < 48 && topLoss / c.height < sideLoss / c.width) {
					ins.top = Math.max(ins.top, topLoss);
					continue;
				}
				if ((r.left + r.right) / 2 > c.left + c.width / 2) ins.right = Math.max(ins.right, c.right - r.left);
				else ins.left = Math.max(ins.left, r.right - c.left);
			}
			return ins;
		};
		const tooWide = (i: ViewInsets) => i.left + i.right > c.width * 0.6;
		let ins = measure(panels);
		// Stack und Unplaced zusammen lassen kaum Fläche: dann zählt der Stack —
		// er ist, was die Forscherin gerade ansieht —, die Halde liegt darüber.
		// Vorher fielen beide weg, und das Eingerahmte lag unter dem Stack.
		if (tooWide(ins)) ins = measure(panels.filter((p) => p.stack));
		if (tooWide(ins)) { ins.left = 0; ins.right = 0; }
		// Die Zoom-Leiste unten: Eingerahmtes endet mit Abstand über ihr.
		const hud = el.querySelector<HTMLElement>('.canvas-hud')?.getBoundingClientRect();
		if (hud && hud.height > 0) ins.bottom = Math.max(0, c.bottom - hud.top);
		// Bleibt daneben kaum Fläche, zählt der ganze Ausschnitt.
		if (ins.top > c.height * 0.5) ins.top = 0;
		if (ins.bottom > c.height * 0.3) ins.bottom = 0;
		return ins;
	}

	// Inhalt in die freie Fläche einpassen und dort mittig setzen; nie größer
	// als 100 %.
	function fitContent(b: { minX: number; minY: number; maxX: number; maxY: number }, pad = 40) {
		const el = canvasContainerEl;
		if (!el) return;
		const w = el.clientWidth;
		const h = el.clientHeight;
		if (w <= 0 || h <= 0) return;
		const ins = overlayInsets();
		const availW = Math.max(160, w - ins.left - ins.right - 2 * pad);
		const availH = Math.max(160, h - ins.top - ins.bottom - 2 * pad);
		const bw = Math.max(1, b.maxX - b.minX);
		const bh = Math.max(1, b.maxY - b.minY);
		viewport.zoom = Math.min(1, availW / bw, availH / bh);
		const z = viewport.zoom; // geklemmt
		viewport.x = (ins.left + pad + (availW - bw * z) / 2) / z - b.minX;
		viewport.y = (ins.top + pad + (availH - bh * z) / 2) / z - b.minY;
		framedSeq = viewTouchSeq;
	}

	// Fit positional map: origin at bottom-left, the whole axis extent and every
	// position (also one placed outside the diagram) in view.
	function fitPosMap() {
		const b = { minX: -100, minY: -cp.POS_AXIS_LEN - 40, maxX: cp.POS_AXIS_LEN + 40, maxY: 80 };
		const c = cp.contentBounds();
		if (c) {
			b.minX = Math.min(b.minX, c.minX);
			b.minY = Math.min(b.minY, c.minY);
			b.maxX = Math.max(b.maxX, c.maxX);
			b.maxY = Math.max(b.maxY, c.maxY);
		}
		fitContent(b, 24);
	}

	// ─── Einrahmen beim Öffnen ───
	// Wie Reset, aber erst, wenn die Panels vermessen sind: Beim Öffnen stehen
	// Canvas-Größe und Unplaced-Panel (gespeicherte Lage, auf- oder zugeklappt)
	// oft noch nicht endgültig — gerahmt wurde dann für eine falsche Fläche
	// (24 %, die Karte klein oben links). Deshalb wird in den ersten Sekunden
	// nach dem Öffnen neu gerahmt, wenn sich Canvas oder Unplaced-Panel ändern —
	// bis die Forscherin die Ansicht selbst bewegt.
	let viewTouchSeq = 0;
	function noteViewTouched() { viewTouchSeq++; }
	// Stand der Ansicht beim letzten Einrahmen: Hat die Forscherin seither nicht
	// selbst verschoben oder gezoomt, rahmt eine Größenänderung des Fensters neu.
	let framedSeq = -1;
	let autoFrameUntil = 0;
	let autoFrameSeq = -1;
	let containerW = $state(0);
	let containerH = $state(0);

	function frameMap() {
		if (ms.mapType === 'positional') { fitPosMap(); return; }
		const b = cp.contentBounds();
		if (b) fitContent(b);
	}
	function startAutoFrameWindow() {
		autoFrameUntil = performance.now() + 2500;
		autoFrameSeq = viewTouchSeq;
	}
	// Die Leiste oben (Snapshots, Akt-Dialog, Hinweise) weicht dem offenen
	// Unplaced-Panel oben rechts aus, statt unter oder über ihm zu liegen
	// (Testlauf 09.11.: Snapshot-Panel überlappte Unplaced).
	let overlayRight = $state(0);
	function measureOverlayRight() {
		const el = canvasContainerEl;
		if (!el) return;
		const c = el.getBoundingClientRect();
		const r = el.querySelector<HTMLElement>('.unplaced-panel:not(.collapsed)')?.getBoundingClientRect();
		let right = 0;
		if (r && r.width > 0 && r.top - c.top < 140 && (r.left + r.right) / 2 > c.left + c.width / 2) {
			right = Math.max(0, c.right - r.left + 8);
			if (c.width - right - 32 < 340) right = 0; // zu wenig Platz daneben: dann wie bisher mittig
		}
		if (right !== overlayRight) overlayRight = right;
	}
	function maybeReframe() {
		measureOverlayRight();
		if (viewMode !== 'canvas' || !canvasContainerEl) return;
		if (performance.now() > autoFrameUntil || viewTouchSeq !== autoFrameSeq) return;
		frameMap();
		if (viewBeforeStack) viewBeforeStack = { x: viewport.x, y: viewport.y, zoom: viewport.zoom, seq: viewBeforeStack.seq };
	}

	$effect(() => {
		const el = canvasContainerEl;
		if (!el) return;
		let raf = 0;
		const schedule = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => { raf = 0; maybeReframe(); });
		};
		// Fenster oder Menüspalte ändern die Größe der Fläche (Testlauf 09.11.:
		// nach dem Verkleinern nicht neu gerahmt, die Zoom-Leiste über einem
		// Knoten). Unberührt seit dem letzten Einrahmen → neu einrahmen; sonst
		// bleibt die Mitte des Ausschnitts, wo sie war.
		let lastW = 0;
		let lastH = 0;
		let reframeRaf = 0;
		const ro = new ResizeObserver(() => {
			const w = el.clientWidth;
			const h = el.clientHeight;
			const dw = w - lastW;
			const dh = h - lastH;
			const first = lastW === 0 && lastH === 0;
			lastW = w;
			lastH = h;
			containerW = w;
			containerH = h;
			if (!first && w > 0 && h > 0 && (Math.abs(dw) > 1 || Math.abs(dh) > 1)
				&& viewMode === 'canvas' && performance.now() > autoFrameUntil) {
				if (viewTouchSeq === framedSeq) {
					if (!reframeRaf) reframeRaf = requestAnimationFrame(() => { reframeRaf = 0; if (viewTouchSeq === framedSeq) frameMap(); });
				} else {
					viewport.x += dw / (2 * viewport.zoom);
					viewport.y += dh / (2 * viewport.zoom);
				}
			}
			schedule();
		});
		ro.observe(el);
		const isPanel = (n: Node) => n instanceof Element && n.matches('.unplaced-panel');
		const mo = new MutationObserver((records) => {
			for (const r of records) {
				if (r.type === 'childList' ? [...r.addedNodes, ...r.removedNodes].some(isPanel) : isPanel(r.target)) {
					schedule();
					return;
				}
			}
		});
		mo.observe(el, { childList: true, attributes: true, attributeFilter: ['style', 'class'], subtree: true });
		return () => {
			ro.disconnect();
			mo.disconnect();
			if (raf) cancelAnimationFrame(raf);
			if (reframeRaf) cancelAnimationFrame(reframeRaf);
		};
	});

	// Auto-fit when switching to canvas view on positional maps
	$effect(() => {
		if (ms.mapType !== 'positional' || viewMode !== 'canvas' || !canvasContainerEl || !cp.ready) return;
		if (!posMapFitted) {
			requestAnimationFrame(() => { fitPosMap(); posMapFitted = true; startAutoFrameWindow(); });
		}
	});

	// Auto-fit every other map type once its positions are computed, so opening a
	// map lands on the cards instead of the empty origin corner. Tracks
	// cp.contentBounds() → re-runs when positions populate.
	$effect(() => {
		if (ms.mapType === 'positional' || viewMode !== 'canvas' || !canvasContainerEl) return;
		const bounds = cp.contentBounds();
		if (!bounds || contentFitted) return;
		const el = canvasContainerEl;
		requestAnimationFrame(() => {
			if (el.clientWidth > 0 && el.clientHeight > 0) {
				fitContent(cp.contentBounds() ?? bounds);
				contentFitted = true;
				startAutoFrameWindow();
			}
		});
	});

	// Reset (HUD button) should frame the whole map, not snap back to (0,0) — on a
	// spread-out map the origin is empty space.
	function handleCanvasReset() {
		// Auch nach Layout und Restore: ein Akt der Forscherin, die Ansicht ist ihre.
		noteViewTouched();
		if (!canvasContainerEl) { viewport.reset(); return; }
		if (ms.mapType === 'positional') { fitPosMap(); return; }
		const bounds = cp.contentBounds();
		if (bounds) fitContent(bounds);
		else viewport.reset();
	}

	// Ein Naming in den Blick holen, ohne umzuräumen: Listenansicht → Zeile und
	// Stack; auf dem Canvas → auswählen, kurz hervorheben und nur dann in die
	// freie Fläche schieben, wenn es dort nicht schon ganz zu sehen ist.
	// Ausgeblendetes oder Unplatziertes zeigt seinen Stack. Mit `stack` öffnet
	// sich zuerst der Stack (er verdeckt einen Teil der Fläche).
	async function revealNode(id: string, opts: RevealOptions = {}) {
		const node = ms.findNode(id);
		if (!node) return;
		if (viewMode === 'list') {
			void ms.openStack(id);
			tick().then(() => {
				const el = document.querySelector(`[data-naming-id="${id}"]`);
				if (el) scrollIntoViewStable(el);
			});
			ms.flash(id);
			return;
		}
		if (ms.isHiddenByFilter(node) || !cp.isDrawable(id)) {
			void ms.openStack(id);
			return;
		}
		if (opts.stack) {
			await ms.openStack(id);
			await tick();
		}
		cp.focusOn(id);
		selection.select(id);
	}

	// Der Stack lässt die Karte, wie sie war: Rückt die Ansicht, während er
	// offen ist, ohne dass die Forscherin sie selbst bewegt (Zeigen eines
	// Namings, Einrahmen …), kehrt sie beim Schließen dorthin zurück. Wechselt
	// der Stack nur das Naming, gilt weiter die Ansicht vor dem ersten Öffnen.
	let viewBeforeStack: { x: number; y: number; zoom: number; seq: number } | null = null;
	$effect(() => {
		const id = ms.stackId;
		untrack(() => {
			if (id !== null) {
				if (!viewBeforeStack) viewBeforeStack = { x: viewport.x, y: viewport.y, zoom: viewport.zoom, seq: viewTouchSeq };
				return;
			}
			const back = viewBeforeStack;
			viewBeforeStack = null;
			if (!back || viewMode !== 'canvas' || viewTouchSeq !== back.seq) return;
			viewport.zoom = back.zoom;
			viewport.x = back.x;
			viewport.y = back.y;
		});
	});

	// SW/A: Formationen zuerst und die großen zuunterst — eine kleine Welt in
	// einer großen Arena bleibt greifbar. Danach die übrigen Elemente.
	function formationArea(e: any): number {
		const rx = e.properties?.rx || 150;
		const ry = e.properties?.ry || 100;
		const rect = SW_ROLE_STYLES[e.sw_role as keyof typeof SW_ROLE_STYLES]?.shape === 'rect';
		return rect ? 4 * rx * ry : Math.PI * rx * ry;
	}
	// Die Schleife ist nach naming_id geschlüsselt (Formationen behalten beim
	// Umsortieren ihren Zustand); ein doppelt gelieferter Eintrag darf die Karte
	// nicht abbrechen.
	const elementsInOrder = $derived.by(() => {
		const seen = new Set<string>();
		const els = ms.elements.filter((e: any) => {
			if (seen.has(e.naming_id)) return false;
			seen.add(e.naming_id);
			return true;
		});
		if (ms.mapType !== 'social-worlds') return els;
		const formations = els.filter((e: any) => !!e.sw_role).sort((a: any, b: any) => formationArea(b) - formationArea(a));
		return [...formations, ...els.filter((e: any) => !e.sw_role)];
	});

	// ─── Umbenennen auf dem Canvas ───
	// Ein Feld für alles (Karten, Rauten, Stillen, Formationen, Achsen), außerhalb
	// der skalierten Ebene: es bleibt bei jedem Zoom gleich groß und ganz in der
	// Canvas (am Rand eingerückt — die Y-Achse liegt oft am linken Rand).
	let renameW = $state(0);
	let renameH = $state(0);
	const renameAt = $derived.by(() => {
		const id = ms.editingId;
		if (!id || viewMode !== 'canvas' || !cp.ready) return null;
		let p: { x: number; y: number } | null = null;
		if (ms.mapType === 'positional') {
			const ax = ms.axes.find((a: any) => a.naming_id === id);
			if (ax?.properties?.axisDimension === 'x') p = { x: cp.POS_AXIS_LEN / 2, y: 40 };
			else if (ax?.properties?.axisDimension === 'y') p = { x: -40, y: -cp.POS_AXIS_LEN / 2 };
		}
		if (!p && cp.isDrawable(id)) p = cp.nodeCenter(id);
		if (!p) return null;
		const M = 8;
		const sx = (p.x + viewport.x) * viewport.zoom;
		const sy = (p.y + viewport.y) * viewport.zoom;
		const hw = renameW / 2;
		const hh = renameH / 2;
		const fit = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
		return {
			left: containerW > 0 ? fit(sx, M + hw, containerW - M - hw) : sx,
			top: containerH > 0 ? fit(sy, M + hh, containerH - M - hh) : sy
		};
	});

	let displayMode = $state<'entities' | 'relations' | 'full'>('full');
	let listGroupBy = $state<'mode' | 'designation' | 'phase' | 'provenance' | 'flat'>('mode');

	// Restore preferences from localStorage
	$effect(() => {
		const mapId = data.map.id;
		const savedMode = localStorage.getItem(`map:${mapId}:displayMode`);
		if (savedMode === 'entities' || savedMode === 'relations' || savedMode === 'full') displayMode = savedMode;
		const savedGroup = localStorage.getItem(`map:${mapId}:listGroupBy`);
		if (savedGroup) listGroupBy = savedGroup as typeof listGroupBy;
	});

	// ─── Position init (reset on map navigation) ───

	$effect(() => {
		const mapId = data.map.id;
		cp.initIfNeeded(mapId);
		// Neu einpassen nur beim Wechsel der Karte. Dieser Effekt läuft nach
		// jedem Neuladen der Kartendaten (Restore, Umbenennen …) — setzte er die
		// Marken jedes Mal zurück, spränge die Ansicht dabei auf das Ganze.
		if (fittedFor !== mapId) {
			fittedFor = mapId;
			posMapFitted = false;
			contentFitted = false;
		}
	});

	// Die vorgelegten Cowork-Memos
	$effect(() => {
		void data.map.id;
		untrack(() => {
			void ms.loadPresentedMemos();
		});
	});

	// ─── Rückweg: ?focus=<namingId> schlägt die Karte an einer Stelle auf ───
	//
	// Bewusst NICHT cp.centerOn: das legt die Karte radial um das Naming herum
	// neu und wäre ein Eingriff in die Anordnung, die der Forscher gebaut hat.
	// Hier wird nur der Ausschnitt verschoben und der Stack geöffnet — hinsehen,
	// nicht umräumen. Das Einpassen auf den Gesamtinhalt entfällt dann; sonst
	// stünde man wieder vor der ganzen Karte statt vor der einen Stelle.
	const focusId = $derived($page.url.searchParams.get('focus'));
	let focusedOn: string | null = null;

	$effect(() => {
		const id = focusId;
		if (!id || focusedOn === id) return;
		if (!ms.findNode(id)) return; // Kartendaten noch nicht da

		// tick(), nicht requestAnimationFrame: in einem Hintergrund-Tab (Link mit
		// Mittelklick geöffnet) feuert rAF nicht, und die Karte stünde beim
		// Hinsehen unverschoben da — ohne erneuten Anlass, es nachzuholen.
		if (viewMode === 'list') {
			focusedOn = id;
			ms.showStack(id);
			tick().then(() => {
				const el = document.querySelector(`[data-naming-id="${id}"]`);
				if (el) scrollIntoViewStable(el);
			});
			return;
		}

		if (!cp.ready || !canvasContainerEl) return; // Positionen stehen noch nicht
		focusedOn = id;
		ms.showStack(id);
		contentFitted = true;
		const el = canvasContainerEl;
		tick().then(() => {
			if (!cp.isDrawable(id)) return; // unplatziert — dann bleibt der Ausschnitt
			const c = cp.nodeCenter(id);
			viewport.x = el.clientWidth / (2 * viewport.zoom) - c.x;
			viewport.y = el.clientHeight / (2 * viewport.zoom) - c.y;
			// Mit dem Link kam man hierher: Schließen des Stacks führt nicht zurück.
			if (viewBeforeStack) viewBeforeStack = { x: viewport.x, y: viewport.y, zoom: viewport.zoom, seq: viewBeforeStack.seq };
		});
	});

	// ─── Canvas interactions ───

	function handleNodeClick(id: string, e: MouseEvent) {
		if (ms.reifyTarget && id !== ms.reifyTarget) { ms.mapReifyPick(id); return; }
		if (ms.relatingFrom) { ms.completeRelating(id); return; }
		if (ms.assigningToPhase) { ms.assignToPhase(ms.assigningToPhase, id); return; }
		selection.select(id, e.ctrlKey || e.metaKey);
		ctxMenuId = null;
	}

	// Doppelklick öffnet das Stack-Panel. Ohne ihn war eine Karte auf dem Canvas
	// stumm: der Stack war nur über das Kontextmenü erreichbar, und ein Naming
	// ohne Memo zeigte beim Überfahren gar nichts — genau der Fall bei KI-Cues
	// aus Naming-Runs, die keine Memos tragen.
	function handleNodeDblClick(id: string) {
		if (ms.editingId === id) return;
		ms.showStack(id);
	}

	let ctxMenuId = $state<string | null>(null);
	let ctxMenuPos = $state({ x: 0, y: 0 });

	function handleNodeContextMenu(id: string, e: MouseEvent) {
		selection.select(id);
		ctxMenuId = id;
		ctxMenuPos = { x: e.clientX, y: e.clientY };
	}

	function handleCanvasClick() {
		selection.clear();
		ctxMenuId = null;
		canvasCtxMenu = null;
		ms.highlightedPhase = null;
		if (ms.relatingFrom) ms.relatingFrom = null;
		// Die KI-Memo-Karte schließt ohne Urteil (das Memo bleibt „presented").
		ms.closeMemoPanel();
	}

	// ─── Rauten ziehen ───
	// Während des Ziehens knickt die Linie durch die Raute; losgelassen wird die
	// Lage an der Erscheinung der Relation gespeichert (cp.handleRelationDragEnd).
	let diamondDrag = $state<{ id: string; x: number; y: number } | null>(null);

	function relationVia(id: string): { x: number; y: number } | null {
		if (diamondDrag?.id === id) return diamondDrag;
		return cp.isLabelPinned(id) ? cp.nodeCenter(id) : null;
	}

	// Drop from the Unplaced panel (Halde) onto the canvas = situate the naming at
	// the chosen point. Reuses the human position-write path (handleNodeDragEnd →
	// updatePosition): the node renders at the drop point, the position persists,
	// and it leaves the Halde. A position is a derivative projection, not a
	// designation — no AI, no naming_act.
	function handleCanvasDrop(e: DragEvent, x: number, y: number) {
		const namingId = e.dataTransfer?.getData('application/x-naming-id');
		if (!namingId) return;
		// Eine Relation bringt ihre unplatzierten Endpunkte mit (links/rechts
		// der Ablagestelle); ein Naming landet genau dort.
		const node = ms.findNode(namingId);
		if (node) cp.placeUnplaced(node, { x, y });
	}

	// Canvas-level context menu (right-click on empty space)
	let canvasCtxMenu = $state<{ x: number; y: number } | null>(null);

	function handleCanvasContextMenu(e: MouseEvent) {
		ctxMenuId = null;
		canvasCtxMenu = { x: e.clientX, y: e.clientY };
	}

	// Auf dem Canvas sichtbar: platziert und nicht ausgeblendet; eine Relation
	// nur, solange auch ihre Endpunkte zu sehen sind.
	function shownOnCanvas(id: string, depth = 0): boolean {
		const n = ms.findNode(id);
		if (!n || ms.isHiddenByFilter(n) || !cp.isDrawable(id)) return false;
		if (n.mode !== 'relation' || depth > 4) return true;
		const [s, t] = ms.endpointsOf(n);
		return !!s && !!t && shownOnCanvas(s, depth + 1) && shownOnCanvas(t, depth + 1);
	}

	function ctxRename(id: string) {
		const node = ms.findNode(id);
		ms.editingId = id;
		ms.editingValue = node?.inscription || '';
	}

	// ─── Topology snapshots ───

	let topoSnapshots = $state<any[]>([]);
	let showTopoPanel = $state(false);

	async function refreshSnapshots() {
		topoSnapshots = await cp.loadTopoSnapshots();
	}

	// Eager load so the toolbar can show the snapshot count
	$effect(() => {
		void data.map.id;
		refreshSnapshots();
	});

	async function openTopoPanel() {
		showTopoPanel = !showTopoPanel;
		if (showTopoPanel) await refreshSnapshots();
	}

	async function handleTopoRestore(seq: number) {
		const r = await cp.restoreTopologySnapshot(seq);
		// Die Sicherung „Before restore — …" steht gleich in der Liste.
		await refreshSnapshots();
		// Den wiederhergestellten Stand einrahmen, nicht beim alten Ausschnitt bleiben.
		if (r.ok) requestAnimationFrame(() => handleCanvasReset());
		return r;
	}

	async function handleTopoSave(label: string) {
		const ok = await cp.saveTopologySnapshot(label);
		if (ok) await refreshSnapshots();
		return ok;
	}

	// Auf der SW/A-Map ist die Lage selbst eine Aussage: Enthaltungen und
	// Überschneidungen ergeben Relationen. Das Layout verschiebt sie alle — erst
	// eine Rückfrage, in der Oberfläche (Browser-Dialoge sind nicht überall
	// zugelassen; dann geschah still nichts).
	let layoutAsk = $state(false);

	function requestAutoLayout() {
		if (ms.mapType === 'social-worlds') { layoutAsk = true; return; }
		void runAutoLayoutWithRefresh();
	}

	async function runAutoLayoutWithRefresh() {
		layoutAsk = false;
		const ok = await cp.runAutoLayout();
		await refreshSnapshots();
		// A fresh layout has fresh bounds — re-frame the view onto it instead of
		// leaving the stale zoom/pan from before.
		if (ok) requestAnimationFrame(() => handleCanvasReset());
	}

	function switchView(mode: 'list' | 'canvas') {
		if (viewMode === 'canvas' && mode !== 'canvas') cp.saveTopologyBuffer();
		viewMode = mode;
	}

	// Auto-save topology buffer on page leave
	$effect(() => {
		function onBeforeUnload() {
			if (viewMode === 'canvas' && cp.positions.size > 0) {
				navigator.sendBeacon(
					`/api/projects/${data.projectId}/maps/${data.map.id}`,
					new Blob([JSON.stringify({ action: 'saveTopologyBuffer', positions: cp.positionsToObj() })], { type: 'application/json' })
				);
			}
		}
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	// ─── ai-eval: verworfene Cues ───
	// Die Karte zeigte einen im Reader verworfenen KI-Cue unverändert. Das
	// Ausgrauen ist Folge des Urteils, kein Schreibvorgang im Kern: ohne die
	// Auditschicht liefert der Endpunkt nichts und die Karte sieht aus wie zuvor.
	$effect(() => {
		const pid = data.projectId;
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/projects/${pid}/ai-eval`);
				if (!res.ok || cancelled) return;
				const body = (await res.json()) as {
					latest?: {
						subjectNamingId: string;
						verdict: string;
						createdAt: string | null;
						evaluatorName: string | null;
						evaluatorCount: number;
						mine: boolean;
					}[];
				};
				// Nur 'reject' graut aus — 'accept' und 'revise' ändern die Karte nicht.
				// Der Urteilende kommt mit: das Ausgrauen soll sagen können, wessen
				// Urteil es war, sonst gibt die Karte die Handlung eines Mitglieds
				// als die des Betrachters aus.
				ms.rejectedNamings = new Map(
					(body.latest ?? [])
						.filter((v) => v.verdict === 'reject')
						.map((v) => [
							v.subjectNamingId,
							{
								verdict: v.verdict,
								createdAt: v.createdAt,
								evaluatorName: v.evaluatorName,
								mine: v.mine,
								evaluatorCount: v.evaluatorCount
							}
						])
				);
			} catch {
				// Ohne Urteile graut nichts aus — die Karte bleibt benutzbar.
			}
		})();
		return () => { cancelled = true; };
	});

	// ─── SSE ───

	const COWORK_EVENTS: Record<string, string> = {
		'ai:element': 'Cowork added a cue.',
		'ai:formation': 'Cowork added a formation as a cue.',
		'ai:relation': 'Cowork added a relation as a cue.',
		'ai:silence': 'Cowork marked a silence as a cue.',
		'ai:phase': 'Cowork created a phase.',
		'ai:rewrite': 'Cowork renamed a cue.',
		'ai:withdraw': 'Cowork withdrew a cue from this map.',
		'ai:memo-revised': 'Cowork revised a memo.'
	};

	$effect(() => {
		const evtSource = new EventSource(`/api/projects/${data.projectId}/maps/${data.map.id}/events`);
		evtSource.addEventListener('message', (e) => {
			try {
				const event = JSON.parse(e.data);
				if (event.type === 'ai:memo') {
					const p = event.payload;
					ms.presentMemo({ id: p.memo?.id || '', title: p.title || '', content: p.content || '', linkedIds: p.linkedIds || [], authorId: p.authorId || '' });
					ms.reload();
				} else if (event.type?.startsWith('ai:')) {
					// Die KI heißt überall Cowork.
					ms.showAiNotification(COWORK_EVENTS[event.type] ?? `Cowork: ${event.type.split(':')[1]}`);
					ms.reload().then(() => cp.layoutNewNodes());
				}
			} catch { /* ignore */ }
		});
		return () => evtSource.close();
	});

	// ─── List grouping ───

	const groupedItems = $derived.by(() => {
		// Der Listenfilter „Withdrawn" zeigt Zurückgezogenes auch dann, wenn es sonst ausgeblendet ist.
		const showWithdrawn = ms.listFilter === 'withdrawn';
		const items = ms.allItems.filter((n: any) => showWithdrawn || !ms.isHiddenByFilter(n)).filter((n: any) => ms.filterItem(n));
		switch (listGroupBy) {
			case 'mode':
				return [
					{ label: 'Elements', items: items.filter((n: any) => n.mode === 'entity') },
					{ label: 'Relations', items: items.filter((n: any) => n.mode === 'relation') },
					{ label: 'Silences', items: items.filter((n: any) => n.mode === 'silence') }
				].filter(g => g.items.length > 0);
			case 'designation':
				return ['cue', 'characterization', 'specification'].map(d => ({
					label: d.charAt(0).toUpperCase() + d.slice(1) + 's',
					items: items.filter((n: any) => (n.designation || 'cue') === d)
				})).filter(g => g.items.length > 0);
			case 'phase': {
				const groups: Array<{ label: string; items: any[] }> = [];
				for (const phase of ms.phases) {
					groups.push({ label: phase.label, items: items.filter((n: any) => n.phase_ids?.includes(phase.id)) });
				}
				const assigned = new Set(ms.phases.flatMap((c: any) => items.filter((n: any) => n.phase_ids?.includes(c.id)).map((n: any) => n.naming_id)));
				const unassigned = items.filter((n: any) => !assigned.has(n.naming_id));
				if (unassigned.length > 0) groups.push({ label: 'Unassigned', items: unassigned });
				return groups.filter(g => g.items.length > 0);
			}
			case 'provenance':
				return [
					{ label: 'Empirically grounded', items: items.filter((n: any) => n.has_document_anchor) },
					{ label: 'Memo, no document anchor', items: items.filter((n: any) => !n.has_document_anchor && n.has_memo_link) },
					{ label: 'No document anchor, no memo', items: items.filter((n: any) => !n.has_document_anchor && !n.has_memo_link) }
				].filter(g => g.items.length > 0);
			case 'flat':
			default:
				return [{ label: '', items }];
		}
	});

	// ─── Listenansicht: den geöffneten Stack in den Blick holen ───
	// Einmal beim Öffnen (Ladeanzeige) und einmal, wenn er da ist — nicht bei
	// jedem Nachladen desselben Stacks, sonst zöge die Liste beim Lesen zurück.
	let revealedStackKey: string | null = null;
	$effect(() => {
		const id = ms.stackId;
		const loaded = !!ms.stackData;
		if (viewMode !== 'list' || !id) { revealedStackKey = null; return; }
		const key = `${id}:${loaded}`;
		if (revealedStackKey === key) return;
		revealedStackKey = key;
		tick().then(() => {
			document.querySelector(`[data-stack-for="${id}"]`)?.scrollIntoView({ block: 'nearest' });
		});
	});

	const assigningPhaseLabel = $derived(
		ms.assigningToPhase ? (ms.phases.find((p: any) => p.id === ms.assigningToPhase)?.label ?? 'phase') : null
	);

	// ─── Keyboard ───

	let toolbarRef = $state<MapToolbar | null>(null);

	function handleKeydown(e: KeyboardEvent) {
		// F2 benennt das ausgewählte Naming um, wie in Dateimanagern und Tabellen
		// (Testlauf 09.11.); Doppelklick bleibt der Stack.
		if (e.key === 'F2') {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
			if (selection.count !== 1 || ms.actTarget || ms.editingId) return;
			const id = [...selection.ids][0];
			const node = ms.findNode(id);
			if (!node || ms.isWithdrawn(node.properties)) return;
			e.preventDefault();
			ctxMenuId = null;
			ctxRename(id);
			return;
		}
		if (e.key === 'Escape') {
			if (toolbarRef?.closeDropdowns()) return;
			// Der Stack schließt erst, wenn nichts Flüchtigeres mehr offen ist:
			// Escape bricht zuerst das Formular oder Menü ab, nicht die Ansicht.
			// Eine Auswahl zählt nicht dazu: sie ist unsichtbarer als das Panel,
			// und wer Escape drückt, erwartet, dass das Panel zugeht. Die Auswahl
			// bleibt dabei stehen; das nächste Escape hebt sie auf.
			const transientOpen = !!(ms.reifyTarget || ms.reifySource || ms.relatingFrom || ms.actTarget
				|| ms.memoCreateOpen || ms.memoPanel || ms.editingId || ms.assigningToPhase
				|| ctxMenuId || canvasCtxMenu || layoutAsk || showTopoPanel);
			if (!transientOpen && ms.stackId) { ms.stackId = null; ms.stackData = null; return; }
			// Im Memo-Dialog nach Umbenennen, Designieren oder Moduswechsel heißt
			// Escape „cancel", wie in jedem Dialog — mit einer Meldung, dass nichts
			// geändert wurde (früher verwarf es still; danach übernahm es den Akt,
			// was im neunten Testlauf als falsch auffiel). Nach dem Verbinden steht
			// die Relation schon; dort schließt Escape nur die Notiz.
			if (ms.actTarget) { ms.discardAct(); return; }
			ms.cancelMapReify();
			ms.cancelRelation();
			ms.cancelAct();
			ms.cancelMemoCreate();
			selection.clear();
			ctxMenuId = null;
			canvasCtxMenu = null;
			ms.editingId = null;
			ms.assigningToPhase = null;
			ms.highlightedPhase = null;
			ms.closeMemoPanel();
			layoutAsk = false;
			showTopoPanel = false;
		}
	}

</script>

<div class="map-page">
	<MapToolbar
		bind:this={toolbarRef}
		{viewMode}
		{displayMode}
		centeredId={cp.centeredId}
		snapshotCount={topoSnapshots.length}
		onswitchview={switchView}
		onsetdisplaymode={(mode) => { displayMode = mode; localStorage.setItem(`map:${data.map.id}:displayMode`, mode); }}
		onrunautolayout={requestAutoLayout}
		onuncenter={cp.uncenter}
		onopentopo={openTopoPanel}
		onreveal={revealNode}
	/>

	<MemoCreateForm />

	<div class="map-workspace">
		<div class="map-stage">
		<!-- Hinweise und Formulare liegen ÜBER der Karte: sie schieben sie nicht
		     nach unten (vorher rückte die Karte um 23–160 px). -->
		<div class="map-overlays" bind:this={overlaysEl} style="--ov-right: {overlayRight}px;">
			{#if showTopoPanel && viewMode === 'canvas'}
				<TopoPanel
					snapshots={topoSnapshots}
					onclose={() => showTopoPanel = false}
					onsave={handleTopoSave}
					onrestore={handleTopoRestore}
				/>
			{/if}

			{#if layoutAsk && viewMode === 'canvas'}
				<div class="status-bar layout-ask" role="alertdialog" aria-labelledby="layout-ask-text">
					<span id="layout-ask-text">Layout rearranges all formations. Containments and overlaps — and the relations derived from them — change accordingly. The current arrangement is saved as a snapshot first.</span>
					<span class="layout-ask-actions">
						<button class="btn-sm-primary" onclick={runAutoLayoutWithRefresh}>Rearrange</button>
						<button class="btn-link" onclick={() => layoutAsk = false}>cancel</button>
					</span>
				</div>
			{/if}

			{#if ms.relatingFrom && !ms.relatingTo}
				<div class="status-bar status-relate" role="status">
					Relating from: <strong>{ms.findInscription(ms.relatingFrom)}</strong> — click any node to connect
					<button class="btn-link" onclick={ms.cancelRelation}>cancel</button>
				</div>
			{/if}

			{#if ms.reifyTarget}
				<div class="status-bar" role="status">
					Show <strong>{ms.findInscription(ms.reifyTarget)}</strong> as a relation on this map —
					{#if !ms.reifySource}
						click the naming it relates <strong>from</strong>
					{:else}
						from <strong>{ms.findInscription(ms.reifySource)}</strong> — click the naming it relates <strong>to</strong>
					{/if}
					<button class="btn-link" onclick={ms.cancelMapReify}>cancel</button>
				</div>
			{/if}

			{#if ms.assigningToPhase}
				<div class="status-bar" role="status">
					Adding to phase <strong>{assigningPhaseLabel}</strong> — click namings on the map{viewMode === 'list' ? ' or “+ phase” in the list' : ''} to add them.
					<button class="btn-link" onclick={() => ms.assigningToPhase = null}>done</button>
				</div>
			{/if}

			<NamingActPrompt />
			<RelationForm />

			<!-- Hinweise verschwinden nach einigen Sekunden; Fehler bleiben, bis man
			     sie schließt (eine verschwundene Meldung hatte niemand gelesen). -->
			{#each ms.notices as n (n.id)}
				{#if n.kind === 'error'}
					<div class="map-notice notice-error" role="alert">
						<span class="notice-text">{n.text}</span>
						{#if n.link}<a class="notice-link" href={n.link.href}>{n.link.label}</a>{/if}
						<button class="notice-close" onclick={() => ms.dismissNotice(n.id)}
							aria-label="Close this message" title="Close">×</button>
					</div>
				{:else}
					<div class="map-notice" class:has-link={!!n.link || !!n.action} role="status">
						<span class="notice-text">{n.text}</span>
						{#if n.link}<a class="notice-link" href={n.link.href}>{n.link.label}</a>{/if}
						{#if n.action}
							<!-- Die Handlung vor dem Schließen festhalten (danach ist die Meldung weg). -->
							<button class="notice-link notice-action" onclick={() => { const run = n.action?.run; ms.dismissNotice(n.id); run?.(); }}>{n.action.label}</button>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		<!-- KI-Memo (Cowork): kompakte Karte unten rechts über der Karte -->
		<MemoPanel />

		<!-- Canvas -->
		<div class="canvas-container" bind:this={canvasContainerEl} style="{viewMode !== 'canvas' ? 'display: none;' : ''}">
			<UnplacedPanel {cp} />
			<InfiniteCanvas {viewport} oncanvasclick={handleCanvasClick} oncanvascontextmenu={handleCanvasContextMenu}
				oncanvasdrop={handleCanvasDrop} onreset={handleCanvasReset} oninteract={noteViewTouched}
				onpanstart={() => { ctxMenuId = null; canvasCtxMenu = null; }}>
				<!-- Linien: von Rand zu Rand der Endknoten; ist ein Endpunkt selbst
				     eine Relation, endet die Linie an deren Raute. -->
				{#if displayMode === 'full'}
				{#each ms.relations.filter((r: any) => !r.properties?.spatiallyDerived) as rel (rel.naming_id)}
					{@const srcId = rel.directed_from || rel.part_source_id}
					{@const tgtId = rel.directed_to || rel.part_target_id}
					{@const isDirected = !!(rel.directed_from && rel.directed_to)}
					{#if srcId && tgtId && cp.isDrawable(srcId) && cp.isDrawable(tgtId)}
						{@const srcCenter = cp.nodeCenter(srcId)}
						{@const tgtCenter = cp.nodeCenter(tgtId)}
						{@const lineOpacity = ms.connectionOpacity(rel, ms.findNode(srcId), ms.findNode(tgtId))}
						<CanvasConnection
							x1={srcCenter.x} y1={srcCenter.y}
							x2={tgtCenter.x} y2={tgtCenter.y}
							srcExtent={cp.nodeExtent(srcId)}
							tgtExtent={cp.nodeExtent(tgtId)}
							color={ms.designationColor(rel.designation)}
							directed={isDirected}
							opacity={lineOpacity}
							via={relationVia(rel.naming_id)}
						/>
					{/if}
				{/each}
				{/if}

				<!-- Positional Map: axis overlay (L-shape from origin, Clarke convention) -->
				{#if ms.mapType === 'positional'}
					{@const AL = cp.POS_AXIS_LEN}
					{@const OX = 40}
					{@const OY = AL + 40}
					{@const axisX = ms.axes.find((a: any) => a.properties?.axisDimension === 'x')}
					{@const axisY = ms.axes.find((a: any) => a.properties?.axisDimension === 'y')}
					<!-- Origin at canvas (0,0). X goes right, Y goes up (negative canvas-y). -->
					<svg class="pos-axis-overlay" style="position:absolute; left:-{OX}px; top:-{OY}px; width:{AL + OX * 2}px; height:{AL + OY}px; pointer-events:none; overflow:visible;">
						<!-- X axis: origin → right -->
						<line x1={OX} y1={OY} x2={OX + AL} y2={OY} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX + AL - 8} y1={OY - 5} x2={OX + AL} y2={OY} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX + AL - 8} y1={OY + 5} x2={OX + AL} y2={OY} stroke="#3a3d4a" stroke-width="2" />
						<!-- Y axis: origin → up -->
						<line x1={OX} y1={OY} x2={OX} y2={OY - AL} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX - 5} y1={OY - AL + 8} x2={OX} y2={OY - AL} stroke="#3a3d4a" stroke-width="2" />
						<line x1={OX + 5} y1={OY - AL + 8} x2={OX} y2={OY - AL} stroke="#3a3d4a" stroke-width="2" />
						<!-- X axis gradient: --- near origin, +++ at end -->
						<text x={OX + 6} y={OY + 24} fill="#6b7280" font-size="16" font-family="monospace">- - -</text>
						<text x={OX + AL - 60} y={OY + 24} fill="#6b7280" font-size="16" font-family="monospace">+ + +</text>
						<!-- Y axis gradient: --- near origin, +++ at top -->
						<text x={OX - 10} y={OY - 8} fill="#6b7280" font-size="16" font-family="monospace" text-anchor="end">- - -</text>
						<text x={OX - 10} y={OY - AL + 18} fill="#6b7280" font-size="16" font-family="monospace" text-anchor="end">+ + +</text>
					</svg>
					<!-- Achsenlabels: Doppelklick oder Kontextmenü „Rename" öffnet das Feld
					     zum Umbenennen (unten, außerhalb der skalierten Ebene). -->
					{#if axisX}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="pos-axis-label pos-axis-x" style="position:absolute; left:{AL / 2}px; top:28px; white-space:nowrap; transform:translateX(-50%);"
							title="X axis — double-click or right-click to rename"
							ondblclick={() => ctxRename(axisX.naming_id)}
							oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); handleNodeContextMenu(axisX.naming_id, e); }}>
							{axisX.inscription}
						</div>
					{/if}
					{#if axisY}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="pos-axis-label pos-axis-y"
							style="position:absolute; left:-50px; top:{-AL}px; height:{AL}px; writing-mode:vertical-rl; transform:rotate(180deg); display:flex; align-items:center; justify-content:center;"
							title="Y axis — double-click or right-click to rename"
							ondblclick={() => ctxRename(axisY.naming_id)}
							oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); handleNodeContextMenu(axisY.naming_id, e); }}>
							{axisY.inscription}
						</div>
					{/if}
				{/if}

				<!-- Element nodes (hidden in 'relations' mode) -->
				{#each elementsInOrder as el (el.naming_id)}
					{@const pos = cp.positions.get(el.naming_id)}
					{#if pos && !ms.isHiddenByFilter(el) && displayMode !== 'relations'}
						{@const isFormation = ms.mapType === 'social-worlds' && !!el.sw_role}
						<CanvasElement
							id={el.naming_id}
							x={pos.x} y={pos.y}
							color={ms.designationColor(el.designation)}
							selected={selection.isSelected(el.naming_id)}
							zoom={viewport.zoom}
							passThrough={isFormation}
							ondragend={cp.handleNodeDragEnd}
							onclick={handleNodeClick}
							ondblclick={handleNodeDblClick}
							oncontextmenu={handleNodeContextMenu}
						>
							{#if isFormation}
								<FormationNode
									label={el.inscription}
									swRole={el.sw_role}
									designation={el.designation}
									color={ms.designationColor(el.designation)}
									memoCount={el.memo_previews?.length || 0}
									rx={el.properties?.rx || 150}
									ry={el.properties?.ry || 100}
									rotation={el.properties?.rotation || 0}
									selected={selection.isSelected(el.naming_id)}
									withdrawn={ms.isWithdrawn(el.properties)}
									highlighted={ms.relatingFrom === el.naming_id}
									zoom={viewport.zoom}
									phaseColors={(el.phase_ids ?? []).map((pid: string) => ms.phaseColorMap.get(pid)).filter((c: string | undefined): c is string => !!c)}
									phaseHighlight={ms.highlightedPhase ? (ms.isPhaseHighlighted(el) ? 'member' : 'dimmed') : null}
									phaseColor={ms.highlightedPhase ? (ms.phaseColorMap.get(ms.highlightedPhase) ?? null) : null}
									flash={ms.flashId === el.naming_id}
									onlabelhover={(rect) => {
										if (rect && el.memo_previews?.length) ms.showMemoTip(el, rect);
										else if (!rect) ms.hideMemoTipFor(el.naming_id);
									}}
									onmemoclick={() => ms.showStack(el.naming_id)}
									onresizeend={(newRx, newRy) => cp.handleFormationResize(el.naming_id, newRx, newRy)}
									onrotateend={(newRotation) => cp.handleFormationRotate(el.naming_id, newRotation)}
								/>
							{:else}
								<CanvasMapNode {el} {cp} />
							{/if}
						</CanvasElement>
					{/if}
				{/each}

				<!-- Relation nodes as diamonds (hidden in 'entities' mode) — skip spatially derived.
				     Ohne gespeicherte Lage weicht die Raute entlang ihrer Linie Karten und
				     anderen Rauten aus; gezogen behält sie ihre Lage zur Linie (die Linie
				     knickt dann durch sie). -->
				{#if displayMode !== 'entities'}
				{#each ms.relations.filter((r: any) => !r.properties?.spatiallyDerived) as rel (rel.naming_id)}
					{#if shownOnCanvas(rel.naming_id)}
						{@const mid = cp.nodeCenter(rel.naming_id)}
						<CanvasElement
							id={rel.naming_id}
							x={mid.x} y={mid.y}
							color={ms.designationColor(rel.designation)}
							selected={selection.isSelected(rel.naming_id)}
							zoom={viewport.zoom}
							draggable={!cp.centeredId}
							ondragmove={(id, x, y) => { diamondDrag = { id, x, y }; }}
							ondragend={(id, x, y) => { diamondDrag = null; cp.handleRelationDragEnd(id, x, y); }}
							onclick={handleNodeClick}
							ondblclick={handleNodeDblClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<CanvasRelationNode {rel} {cp} />
						</CanvasElement>
					{/if}
				{/each}
				{/if}

				{#each ms.silences as s}
					{@const pos = cp.positions.get(s.naming_id)}
					{#if pos && !ms.isHiddenByFilter(s)}
						<CanvasElement
							id={s.naming_id}
							x={pos.x} y={pos.y}
							color="#4b5563"
							selected={selection.isSelected(s.naming_id)}
							zoom={viewport.zoom}
							ondragend={cp.handleNodeDragEnd}
							onclick={handleNodeClick}
							ondblclick={handleNodeDblClick}
							oncontextmenu={handleNodeContextMenu}
						>
							<div class="silence-node" class:relating-source={ms.relatingFrom === s.naming_id}
								class:phase-member={ms.highlightedPhase && ms.isPhaseHighlighted(s)}
								class:phase-dimmed={ms.highlightedPhase && !ms.isPhaseHighlighted(s)}
								class:flash={ms.flashId === s.naming_id}
								class:centered-dim={cp.centeredConnections && !cp.centeredConnections.has(s.naming_id)}
								style="{ms.highlightedPhase && ms.isPhaseHighlighted(s) ? `--phase-color: ${ms.phaseColorMap.get(ms.highlightedPhase) ?? '#8b9cf7'};` : ''}">
								<span class="node-label">{s.inscription}</span>
							</div>
						</CanvasElement>
					{/if}
				{/each}
			</InfiniteCanvas>

			{#if renameAt}
				<div class="rename-overlay" style="left: {renameAt.left}px; top: {renameAt.top}px;"
					bind:offsetWidth={renameW} bind:offsetHeight={renameH}>
					<InlineRename bind:value={ms.editingValue} onsubmit={ms.confirmRename} oncancel={() => ms.editingId = null} />
				</div>
			{/if}

			{#if ctxMenuId}
				<ContextMenu
					namingId={ctxMenuId}
					position={ctxMenuPos}
					onclose={() => ctxMenuId = null}
					oncenter={cp.centerOn}
					onrename={ctxRename}
					onunsituate={cp.centeredId ? undefined : cp.unsituate}
					labelPinned={!cp.centeredId && cp.isLabelPinned(ctxMenuId)}
					onresetlabel={cp.resetRelationLabel}
				/>
			{/if}

			{#if canvasCtxMenu}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="canvas-context-menu" use:keepInWindow={{ x: canvasCtxMenu.x, y: canvasCtxMenu.y }}
					onclick={(e) => e.stopPropagation()}>
					<div class="ctx-header">{ms.mapLabel}</div>
					<button class="ctx-item" onclick={() => { ms.openMemoCreate([ms.mapId]); canvasCtxMenu = null; }}>Write memo (this map)</button>
					<button class="ctx-item" onclick={() => { ms.openMemoCreate([]); canvasCtxMenu = null; }}>Write free memo</button>
				</div>
			{/if}

			{#if ms.stackId}
				<StackPanel mode="floating" />
				{#if ms.stackLoading}
					<div class="stack-loading-float" role="status">Loading stack…</div>
				{/if}
			{/if}
			<MemoTooltip bounds={() => canvasContainerEl?.getBoundingClientRect() ?? null} />
			<!-- Bis die Positionen stehen (nach dem Laden der Seite rechnet der
			     Browser sie erst aus), nicht leer, sondern mit Hinweis. -->
			{#if !cp.ready}
				<div class="canvas-loading" role="status">Loading map…</div>
			{/if}
		</div>

		<!-- List view -->
		<div class="main-area" style="{viewMode !== 'list' ? 'display: none;' : ''}">
			<div class="list-grouping-bar">
				<span class="grouping-label">Group by</span>
				<select class="grouping-select" value={listGroupBy} onchange={e => { listGroupBy = (e.target as HTMLSelectElement).value as typeof listGroupBy; localStorage.setItem(`map:${data.map.id}:listGroupBy`, listGroupBy); }}>
					<option value="mode">Mode (entity / relation / silence)</option>
					<option value="designation">Designation (cue / char / spec)</option>
					<option value="phase">Phase</option>
					<option value="provenance">Provenance</option>
					<option value="flat">Flat (all mixed)</option>
				</select>
				{#if ms.isPrimary}
					<select class="grouping-select" value={ms.listFilter} onchange={e => ms.listFilter = (e.target as HTMLSelectElement).value as any}>
						<option value="all">All</option>
						<option value="placed">Placed</option>
						<option value="unresolved">Unplaced</option>
						<option value="withdrawn">Withdrawn</option>
					</select>
				{/if}
			</div>
			{#if ms.allItems.length === 0}
				<p class="empty">Name what is in the situation. Everything is a cue at first.</p>
			{:else}
				{#each groupedItems as group}
					{#if group.label}
						<h3 class="section-header">{group.label}</h3>
					{/if}
					<div class="element-list">
						{#each group.items as item}
							<!-- data-naming-id: Sprungziel für ?focus= (siehe shared/rueckweg.ts) -->
							<div data-naming-id={item.naming_id}>
								<ListItemCard {item} {listGroupBy} pos={cp.positions.get(item.naming_id) ?? null} />
							</div>
							{#if ms.stackId === item.naming_id}
								<div class="inline-stack" data-stack-for={item.naming_id}>
									{#if ms.stackData}
										<StackPanel mode="inline" {item} />
									{:else}
										<div class="stack-loading" role="status">Loading stack…</div>
									{/if}
								</div>
							{/if}
							{#if ms.outsideId === item.naming_id}
								<OutsidePanel />
							{/if}
						{/each}
					</div>
				{/each}
			{/if}
		</div>
		</div>

		<PhasesSidebar />
	</div>
</div>

<svelte:window onkeydown={handleKeydown} />

<style>
	.map-page {
		/* Markierung beim Verbinden (Quelle einer Relation): eigene Farbe, nicht
		   das Bernstein der Charakterisierung. */
		--relate-hl: #38bdf8;
		display: flex; flex-direction: column;
		/* Fill the bounded .project-content (layout discipline; Sitzung 32, Protokoll nicht erhalten)
		 * and overlap its 2rem padding so the map reaches the edges. */
		height: calc(100% + 4rem); margin: -2rem;
		/* clip: nichts von der Karte ragt in den Inhaltsbereich hinaus — der ließ
		   sich sonst per Fokus seitwärts verschieben („← Maps" abgeschnitten). */
		overflow: hidden; overflow: clip;
	}

	/* Workspace */
	.map-workspace { display: flex; flex: 1; min-height: 0; min-width: 0; }
	/* Bühne: Canvas bzw. Liste, darüber die Hinweise und die KI-Memo-Karte. */
	.map-stage { flex: 1; position: relative; display: flex; min-width: 0; min-height: 0; }
	.canvas-container { flex: 1; position: relative; min-width: 0; overflow: hidden; overflow: clip; }

	/* Hinweise oben über der Karte, mittig; fangen nur dort Zeiger, wo sie stehen. */
	/* z 960: über der Cowork-Karte (950) — Meldungen, Akt-Abfrage und
	   Relationsformular bleiben lesbar. */
	.map-overlays {
		/* Mittig in der Fläche links vom offenen Unplaced-Panel (--ov-right). */
		position: absolute; top: 0.6rem; left: 1rem; right: calc(1rem + var(--ov-right, 0px));
		margin-inline: auto; max-width: 560px;
		z-index: 960;
		display: flex; flex-direction: column; gap: 0.4rem;
		pointer-events: none;
	}
	.map-overlays > :global(*) { pointer-events: auto; }

	/* Status (Verbinden, Umdeuten, Phase zuweisen) */
	.status-bar {
		align-self: center; max-width: 100%;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 6px;
		padding: 0.35rem 0.75rem; font-size: 0.85rem; color: #c9cdd5;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
	}
	.status-bar.status-relate { border-color: var(--relate-hl); }
	.status-bar.layout-ask { border-color: #f59e0b; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.75rem; font-size: 0.8rem; }
	.layout-ask-actions { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
	.btn-sm-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px;
		padding: 0.25rem 0.7rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}

	/* Positionen werden noch berechnet */
	.canvas-loading {
		position: absolute; inset: 0; z-index: 40;
		display: flex; align-items: center; justify-content: center;
		background: #0d0f16; color: #6b7280; font-size: 0.85rem;
	}
	/* Unten mittig: oben stehen die Hinweise. */
	.stack-loading-float {
		position: absolute; bottom: 0.75rem; left: 50%; transform: translateX(-50%); z-index: 45;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 6px;
		padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #8b8fa3;
	}

	/* List view */
	.main-area { flex: 1; min-width: 0; padding: 1.25rem; overflow-y: auto; overflow-x: hidden; }
	.inline-stack { scroll-margin: 1rem; }
	.stack-loading {
		padding: 0.5rem 0.75rem; font-size: 0.75rem; color: #8b8fa3;
		border: 1px dashed #2a2d3a; border-radius: 6px;
	}
	.empty { color: #6b7280; font-size: 0.9rem; padding: 2rem 0; text-align: center; }
	.list-grouping-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
	.grouping-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
	.grouping-select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.2rem 0.4rem; cursor: pointer;
	}
	.grouping-select:focus { outline: none; border-color: #8b9cf7; }
	.section-header {
		font-size: 0.75rem; color: #6b7280; text-transform: uppercase;
		letter-spacing: 0.05em; margin: 1.5rem 0 0.5rem;
	}
	.element-list { display: flex; flex-direction: column; gap: 0.35rem; }

	/* Meldungen oben über der Karte. Hinweise sind nur Anzeige (fangen keine
	   Klicks); Fehler tragen einen Schließen-Knopf und ggf. einen Weg. */
	.map-notice {
		align-self: center; max-width: 100%;
		display: flex; align-items: baseline; gap: 0.6rem;
		background: #1e2030; border: 1px solid #8b9cf7; border-radius: 6px;
		padding: 0.45rem 0.9rem; font-size: 0.8rem; color: #c9cdd5;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}
	.map-overlays .map-notice:not(.notice-error):not(.has-link) { pointer-events: none; }
	.map-notice.notice-error { border-color: #f87171; padding-right: 0.35rem; }
	.notice-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.notice-link { color: #8b9cf7; font-size: 0.78rem; white-space: nowrap; }
	.notice-action { background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; font-family: inherit; }
	.notice-close {
		background: none; border: none; color: #8b8fa3; cursor: pointer;
		font-size: 1rem; line-height: 1; padding: 0 0.3rem; border-radius: 4px; flex-shrink: 0;
	}
	.notice-close:hover { color: #e1e4e8; background: #2a2d3a; }

	/* Umbenennen: Feld über dem Knoten, außerhalb der skalierten Ebene */
	.rename-overlay {
		position: absolute; z-index: 65; transform: translate(-50%, -50%);
		background: #161822; border: 1px solid #3a3d4a; border-radius: 6px; padding: 0.3rem;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
	}
	.rename-overlay :global(.inline-rename input) { width: min(16rem, 50vw); }

	/* Positional Map axis labels */
	.pos-axis-label {
		font-size: 14px; color: #8b8fa3; cursor: pointer;
		padding: 0.2rem 0.4rem; border-radius: 4px; font-weight: 500;
	}
	.pos-axis-label:hover { color: #e1e4e8; background: rgba(139, 156, 247, 0.1); }

	/* Canvas context menu (empty space right-click) */
	.canvas-context-menu {
		position: fixed; z-index: 980; /* über der Cowork-Karte (950) */
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.35rem 0; min-width: 180px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.5);
	}
	.canvas-context-menu .ctx-header {
		padding: 0.3rem 0.75rem; font-size: 0.75rem; color: #6b7280;
		border-bottom: 1px solid #2a2d3a; margin-bottom: 0.2rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.canvas-context-menu .ctx-item {
		display: flex; align-items: center; gap: 0.4rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.35rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.canvas-context-menu .ctx-item:hover { background: #2a2d3a; }

	/* Silence nodes (canvas) */
	.silence-node {
		position: relative; background: #0f1117;
		border: 2px dashed #4b5563; border-radius: 8px;
		/* Fixed width — same reason as .map-node: the zero-width canvas layer
		   squeezes min/max-width boxes to min-content. Matches nodeSize.ts. */
		padding: 0.4rem 0.6rem; width: 200px;
		opacity: 0.7;
	}
	/* Phase angewählt: Mitglieder leuchten, die übrigen treten zurück (wie die Karten). */
	.silence-node.phase-member { opacity: 1; box-shadow: 0 0 10px var(--phase-color, #8b9cf7); transition: opacity 0.3s; }
	.silence-node.phase-dimmed { opacity: 0.25; transition: opacity 0.3s; }
	.silence-node.centered-dim { opacity: 0.35; transition: opacity 0.3s; }
	.silence-node.relating-source { opacity: 1; border-color: var(--relate-hl); box-shadow: 0 0 12px rgba(56, 189, 248, 0.5); }
	.silence-node.flash { animation: silence-flash 0.8s ease-in-out 3; }
	@keyframes silence-flash {
		0%, 100% { box-shadow: none; }
		50% { box-shadow: 0 0 0 3px #8b9cf7, 0 0 16px rgba(139, 156, 247, 0.6); }
	}
	.node-label { font-size: 0.85rem; color: #e1e4e8; word-break: break-word; display: block; }

	/* Shared buttons */
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
