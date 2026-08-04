<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { untrack, tick } from 'svelte';
	import ImageAnnotationViewer from '$lib/components/ImageAnnotationViewer.svelte';
	import ComparisonPanel from './ComparisonPanel.svelte';
	// AI-Evaluation audit layer (separable): verdict control shown only on
	// AI-produced codes, plus the shared verdict state that greys out a rejected
	// cue. Remove with the ai-eval module to drop the layer — every usage site in
	// this file is marked "ai-eval".
	import AiEvalControl from '$lib/components/ai-eval/AiEvalControl.svelte';
	import { verdicts } from '$lib/components/ai-eval/verdicts.svelte.js';
	import NamingContextMenu from './NamingContextMenu.svelte';
	import PhaseAssignDialog from './PhaseAssignDialog.svelte';
	import CodingRunPanel from './CodingRunPanel.svelte';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();
	const doc = $derived(data.document);
	let candidates = $state<any[]>([]);
	$effect(() => { candidates = data.candidates; });
	const isImage = $derived(doc.mime_type?.startsWith('image/'));

	// Live-Refresh-Throttling: bei jedem committed-Sequence-Event des Coding-Runs
	// wird invalidateAll() aufgerufen, damit candidates / annotations / namingStacks
	// neu vom Server geladen werden und in der Liste sofort sichtbar sind.
	// Wir batchen mit 600ms-Trailing-Debounce, damit drei schnelle Codes in einer
	// Sequenz nur EIN load() auslösen.
	let liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleLiveRefresh() {
		if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
		liveRefreshTimer = setTimeout(() => {
			liveRefreshTimer = null;
			invalidateAll();
		}, 600);
	}

	let annotations = $state<any[]>([]);
	$effect(() => { annotations = data.annotations; });

	// Klassen-Trennung (Session 33): Annotations zerfallen in zwei Klassen,
	// die im UI getrennt gerendert werden. valence='codes' = klassische
	// rekonstruktive Codes (Punkt-Marker im Text, Margin-Label, Passages-Liste).
	// valence='thematizes' = begründete Sequenz-Namings, die das Dokument auf
	// einer Material-Ebene als „Inhaltsverzeichnis" organisieren (linke TOC-
	// Spalte). Die beiden Klassen dürfen nicht vermischt werden (siehe
	// docs/design-mother-map-and-coding-flow.md sowie Migration 030).
	// ai-eval: ausgeblendete Passagen verschwinden aus Liste, Margin und Text —
	// nicht gelöscht, nur unsichtbar; der Panel-Footer holt sie zurück.
	let showHidden = $state(false);
	const hiddenAnnotations = $derived(
		annotations.filter((a: any) => (a.valence ?? 'codes') === 'codes' && a.properties?.hidden)
	);
	const codeAnnotations = $derived(
		annotations.filter(
			(a: any) =>
				(a.valence ?? 'codes') === 'codes' && (showHidden || !a.properties?.hidden)
		)
	);
	const sequenceNamingAnnotations = $derived(
		annotations.filter((a: any) => a.valence === 'thematizes')
	);

	// ai-eval: Urteile des Dokuments einmal laden; ein verworfener Cue wird in
	// Liste und Namings-Spalte ausgegraut.
	$effect(() => {
		verdicts.load(data.projectId, doc.id);
	});
	function isRejectedAnn(ann: any): boolean {
		return (
			!!(ann.properties?.aiPersona || ann.properties?.aiSuggested) &&
			verdicts.isRejected(ann.code_id, ann.properties?.anchor)
		);
	}
	/** Ein Cue gilt als verworfen, wenn keine seiner sichtbaren Passagen mehr steht. */
	function isRejectedNaming(codeId: string): boolean {
		const anns = codeAnnotations.filter((a: any) => a.code_id === codeId);
		return anns.length > 0 && anns.every(isRejectedAnn);
	}

	// TOC-Sortierung: nach sequenceMeta.seq (vom coding-run gesetzt, in
	// write.ts via extraProperties in `properties` gespreadet), Fallback
	// char-position. Nur Sequenz-Namings mit Text-Anker (pos0/pos1).
	const sortedSequenceNamings = $derived.by(() => {
		return sequenceNamingAnnotations
			.filter((a: any) => {
				const anchor = a.properties?.anchor;
				return anchor && anchor.pos0 != null && anchor.pos1 != null;
			})
			.slice()
			.sort((a: any, b: any) => {
				const sa = a.properties?.sequenceMeta?.seq;
				const sb = b.properties?.sequenceMeta?.seq;
				if (typeof sa === 'number' && typeof sb === 'number') return sa - sb;
				return (a.properties?.anchor?.pos0 ?? 0) - (b.properties?.anchor?.pos0 ?? 0);
			});
	});

	// Document elements (parsed structure)
	const elements = $derived(data.elements || []);

	// Text selection state
	let selection = $state<{ pos0: number; pos1: number; text: string } | null>(null);
	// Image region selection state
	let regionSelection = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	let comment = $state('');
	let annotating = $state(false);

	// In-vivo coding state
	let codeFilter = $state('');
	let creatingCode = $state(false);
	let newCodeColor = $state('#8b9cf7');
	const canCreateInVivo = $derived(
		codeFilter.trim().length > 0 &&
		!candidates.some((c: any) => c.label.toLowerCase() === codeFilter.trim().toLowerCase())
	);

	// Group candidates by source map for display
	const candidateGroups = $derived.by(() => {
		const groups = new Map<string, { label: string; items: any[] }>();
		for (const c of scopedCandidates) {
			const key = c.source_map_id || '__orphan__';
			if (!groups.has(key)) {
				groups.set(key, { label: c.source_map_label || 'Project', items: [] });
			}
			groups.get(key)!.items.push(c);
		}
		return groups;
	});

	// Annotation highlight on hover
	let highlightedAnnotationId = $state<string | null>(null);

	// Naming stacks (designation history + memos) keyed by code ID
	const namingStacks = $derived.by(() => {
		const map = new Map<string, Array<{ designation: string | null; inscription: string | null; memo_text: string | null; seq: number; linked_naming_ids: string[] | null }>>();
		for (const act of (data.namingStacks || [])) {
			if (!map.has(act.naming_id)) map.set(act.naming_id, []);
			map.get(act.naming_id)!.push(act);
		}
		return map;
	});

	// Scope: 'this' = current document, 'all' = all documents, or a specific document ID
	let namingsScope = $state<string>('this');
	let passagesScope = $state<string>('this');
	const projectDocuments = $derived(data.documents || []);
	const projectAnnotations = $derived(data.projectAnnotations || []);

	// „Pure" Sequenz-Namings: ein Naming, das im gesamten Projekt nur
	// thematizes-Annotations hat und nirgendwo als klassischer Code (codes-
	// Annotation) wiederverwendet wurde. Diese gehören in die TOC-Spalte,
	// nicht in die Namings-Liste rechts. Wer ein Sequenz-Naming später als
	// Code „promoted" (codes-Annotation hinzu), erscheint automatisch in
	// beiden Spalten — beabsichtigt.
	const pureSequenceNamingIds = $derived.by(() => {
		const codeIds = new Set<string>();
		const themaIds = new Set<string>();
		for (const a of projectAnnotations) {
			const v = a.valence ?? 'codes';
			if (v === 'codes') codeIds.add(a.code_id);
			else if (v === 'thematizes') themaIds.add(a.code_id);
		}
		const pure = new Set<string>();
		for (const id of themaIds) if (!codeIds.has(id)) pure.add(id);
		return pure;
	});

	// Sort-Modus für die Codes-Liste. Persistiert im localStorage.
	type SortMode = 'alpha' | 'occurrence' | 'count';
	let sortMode = $state<SortMode>('alpha');
	// localStorage erst auf dem Client lesen (SSR-Safe: `window`-Check).
	$effect(() => {
		if (typeof window === 'undefined') return;
		const stored = window.localStorage?.getItem('namings-sort') as SortMode | null;
		if (stored === 'alpha' || stored === 'occurrence' || stored === 'count') sortMode = stored;
	});
	$effect(() => {
		if (typeof window === 'undefined') return;
		window.localStorage?.setItem('namings-sort', sortMode);
	});

	// Scoped namings: 'this' filters to codes used in this document.
	// Pure Sequenz-Namings werden vorab herausgefiltert — sie leben in der
	// TOC-Spalte, nicht in der Namings-Liste.
	const scopedCandidates = $derived.by(() => {
		const baseAll = codeFilter.trim()
			? candidates.filter((c: any) => c.label.toLowerCase().includes(codeFilter.trim().toLowerCase()))
			: candidates;
		const base = baseAll.filter((c: any) => !pureSequenceNamingIds.has(c.id));
		// Nur codes-Annotations zählen für Namings-Liste — thematizes gehört
		// in die TOC.
		const docCodeAnns = codeAnnotations;
		const projCodeAnns = projectAnnotations.filter((a: any) => (a.valence ?? 'codes') === 'codes');
		let scoped: any[];
		if (namingsScope === 'this') {
			const docCodeIds = new Set(docCodeAnns.map((a: any) => a.code_id));
			scoped = base.filter((c: any) => docCodeIds.has(c.id));
		} else if (namingsScope === 'all') {
			scoped = base;
		} else {
			const docCodeIds = new Set(projCodeAnns.filter((a: any) => a.document_id === namingsScope).map((a: any) => a.code_id));
			scoped = base.filter((c: any) => docCodeIds.has(c.id));
		}
		// Source-Liste je Sort-Mode (Reihenfolge des Auftretens benötigt
		// Annotations aus dem aktuellen Dokument bzw. Scope; Count-Mode zählt
		// alle Annotations im sichtbaren Scope). Nur codes-Annotations.
		const annsForSort: any[] =
			namingsScope === 'this' ? docCodeAnns : namingsScope === 'all' ? projCodeAnns : projCodeAnns.filter((a: any) => a.document_id === namingsScope);
		if (sortMode === 'occurrence') {
			const firstPos = new Map<string, number>();
			for (const a of annsForSort) {
				const pos = a.properties?.anchor?.pos0 ?? Number.MAX_SAFE_INTEGER;
				const prev = firstPos.get(a.code_id);
				if (prev === undefined || pos < prev) firstPos.set(a.code_id, pos);
			}
			return [...scoped].sort((a: any, b: any) => {
				const pa = firstPos.get(a.id) ?? Number.MAX_SAFE_INTEGER;
				const pb = firstPos.get(b.id) ?? Number.MAX_SAFE_INTEGER;
				return pa - pb;
			});
		}
		if (sortMode === 'count') {
			const cnt = new Map<string, number>();
			for (const a of annsForSort) cnt.set(a.code_id, (cnt.get(a.code_id) ?? 0) + 1);
			return [...scoped].sort((a: any, b: any) => (cnt.get(b.id) ?? 0) - (cnt.get(a.id) ?? 0) || a.label.localeCompare(b.label));
		}
		// alpha (default) — server-side already returns sorted by inscription,
		// aber localeCompare ist gegen Mix der Reihenfolgen robuster.
		return [...scoped].sort((a: any, b: any) => a.label.localeCompare(b.label));
	});

	// Scoped passages — Passages-Liste zeigt nur codes-Annotations. Sequenz-
	// Namings (thematizes) leben in der TOC und brauchen keine eigene
	// Passage-Karte (sie SIND ihr Passage, klick auf TOC scrollt direkt hin).
	const scopedAnnotations = $derived.by(() => {
		if (passagesScope === 'this') return codeAnnotations;
		const projCodeAnns = projectAnnotations.filter((a: any) => (a.valence ?? 'codes') === 'codes');
		if (passagesScope === 'all') return projCodeAnns;
		return projCodeAnns.filter((a: any) => a.document_id === passagesScope);
	});

	// Similar passages from ComparisonPanel (replaces Passages list when active)
	let similarPassages = $state<any[] | null>(null);

	// Right-panel mode: 'code' = passages of the selected naming, 'similar' =
	// embedding-near passages of the current text selection. Explicit, so the
	// active relation stays legible (was an implicit "show similar" toggle).
	let panelMode = $state<'code' | 'similar'>('code');
	// Follow the user's focus: opening a text selection switches to "Ähnliche
	// Stellen"; clearing it returns to "Code-Passagen". Manual segment clicks
	// (which don't change `selection`) are preserved.
	$effect(() => {
		// Only flip to Similar when the selection is long enough for retrieval
		// (matches ComparisonPanel's ≥10-char guard); shorter marks stay on
		// Code-Passagen rather than showing an empty similar view.
		if (selection && selection.text.length >= 10) panelMode = 'similar';
		else panelMode = 'code';
	});

	// Phase data
	const phases = $derived(data.phases ?? []);
	const phaseMemberMap = $derived<Record<string, string[]>>(data.phaseMemberMap ?? {});
	let phaseFilter = $state<string | null>(null);

	// Passages panel text search filter
	let annFilter = $state('');
	// Naming selection state
	let selectedNamingIds = $state<Set<string>>(new Set());
	let lastClickedNamingId = $state<string | null>(null);
	// Context menu state
	let ctxMenuNamingIds = $state<string[] | null>(null);
	let ctxMenuPos = $state({ x: 0, y: 0 });
	let showPhaseDialog = $state(false);
	// Drag-drop state
	let dragOverDoc = $state(false);
	let dragOverCard = $state(false); // drop-target highlight for the selection card (right panel)
	// Rubber-band selection state
	let namingDragSelecting = $state(false);
	let namingDragStartY = $state(0);
	// Namings panel: expanded naming (shows memos)
	let expandedNamingId = $state<string | null>(null);
	// Passage memo: inline memo input on a passage card
	let memoingAnnId = $state<string | null>(null);
	let passageMemoText = $state('');
	let namingTooltipText = $state('');
	let namingTooltipStyle = $state('display:none');
	let expandedAnnId = $state<string | null>(null);
	const filteredAnnotations = $derived.by(() => {
		let result = scopedAnnotations;
		if (phaseFilter) {
			const memberIds = new Set(phaseMemberMap[phaseFilter] || []);
			result = result.filter((a: any) => memberIds.has(a.code_id));
		}
		if (selectedNamingIds.size > 0) {
			result = result.filter((a: any) => selectedNamingIds.has(a.code_id));
		}
		if (annFilter.trim()) {
			const q = annFilter.trim().toLowerCase();
			result = result.filter((a: any) => a.code_label.toLowerCase().includes(q)
				|| (a.properties?.anchor?.text || '').toLowerCase().includes(q));
		}
		return result;
	});

	// Selected naming label — for the panel's anchor hint in Code-Passagen mode.
	const selectedNamingLabel = $derived.by(() => {
		if (selectedNamingIds.size !== 1) return null;
		const id = [...selectedNamingIds][0];
		return scopedCandidates.find((c: any) => c.id === id)?.label ?? null;
	});

	// Auto-expand: when a single naming is selected and resolves to exactly
	// one in-document passage, open its context inline and center the
	// highlighted span vertically. Resets on un-narrow so re-selection
	// re-fires. The card's ann-context is height-capped (CSS) so memo/header
	// stay visible — scrolling happens inside the context.
	let autoExpandedAnnId = $state<string | null>(null);
	$effect(() => {
		const single = selectedNamingIds.size === 1
			&& filteredAnnotations.length === 1
			&& filteredAnnotations[0].document_id === doc.id
			&& filteredAnnotations[0].properties?.anchor?.pos0 != null
			? filteredAnnotations[0]
			: null;
		const prevAutoId = untrack(() => autoExpandedAnnId);
		if (!single) {
			if (prevAutoId !== null) untrack(() => { autoExpandedAnnId = null; });
			return;
		}
		if (prevAutoId === single.id) return;
		const annId = single.id;
		untrack(() => {
			autoExpandedAnnId = annId;
			expandedAnnId = annId;
		});
		tick().then(() => {
			const card = document.querySelector(`.annotation-card[data-ann-id="${annId}"]`);
			const target = card?.querySelector('.ctx-passage') as HTMLElement | null;
			if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	});

	// Image viewer ref
	let imageViewer = $state<{ clearRegion: () => void }>();

	// Unified "has selection" check
	const hasSelection = $derived(!!selection || !!regionSelection);

	// DOM refs (text mode)
	let textEl = $state<HTMLPreElement>();

	function handleMouseUp() {
		if (!textEl) return;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) {
			// Don't clear selection when focus moves elsewhere (e.g. to input field)
			return;
		}
		const range = sel.getRangeAt(0);
		if (!textEl.contains(range.startContainer) || !textEl.contains(range.endContainer)) return;

		const offsets = getOffsetsFromRange(textEl, range);
		if (offsets && offsets.pos1 > offsets.pos0) {
			selection = {
				pos0: offsets.pos0,
				pos1: offsets.pos1,
				text: doc.full_text!.slice(offsets.pos0, offsets.pos1)
			};
		}
	}

	function getOffsetsFromRange(container: HTMLElement, range: Range): { pos0: number; pos1: number } | null {
		// Walk only visible text nodes, skipping tooltip spans (which contain code labels)
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentElement;
				if (parent?.classList.contains('code-tooltip')) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});
		let offset = 0;
		let pos0 = -1;
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const len = node.textContent?.length || 0;
			if (node === range.startContainer) pos0 = offset + range.startOffset;
			if (node === range.endContainer) {
				return pos0 >= 0 ? { pos0, pos1: offset + range.endOffset } : null;
			}
			offset += len;
		}
		return null;
	}

	function hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function codedBackground(codez: { color: string }[]): string {
		if (codez.length === 1) return hexToRgba(codez[0].color, 0.2);
		const stops = codez.map((c, i) => {
			const from = (i * 100 / codez.length);
			const to = ((i + 1) * 100 / codez.length);
			return `${hexToRgba(c.color, 0.25)} ${from}%, ${hexToRgba(c.color, 0.25)} ${to}%`;
		});
		return `linear-gradient(180deg, ${stops.join(', ')})`;
	}

	// Build text segments for color-coded annotation display.
	// Rendert NUR valence='codes'-Annotations als bunte Spans/Margin-Marker.
	// Sequenz-Namings (thematizes) erzeugen keine sichtbaren Markierungen im
	// Text — sie leben in der TOC-Spalte links. Wir behalten aber ihren
	// pos0 als Boundary-Punkt und markieren das Start-Segment mit
	// `seqAnchorIds`, damit der TOC-Klick scrollen kann. WICHTIG: ein
	// Coding-Run erzeugt pro Sequenz mehrere Namings, alle mit demselben
	// anchor (pos0=sequence.charStart). Deshalb mehrere annIds pro Position
	// — als space-separierte Liste im DOM, abfragbar via [data-seq-anchor~="id"].
	type TextSegment = {
		text: string;
		codes: { id: string; annId: string; label: string; color: string }[];
		elementId?: string;
		seqAnchorIds?: string[];
		start: number;
		end: number;
	};
	const textSegments = $derived.by((): TextSegment[] => {
		const text = doc.full_text;
		if (!text) return [];

		const textAnns = codeAnnotations.filter((a: any) => {
			const anchor = a.properties?.anchor;
			return anchor && anchor.pos0 != null && anchor.pos1 != null;
		});

		// pos0 → Liste von annIds (ein TextTiling-Sequenz-Span kann mehrere
		// Sequenz-Namings tragen, weil H1 pro Sequenz mehrere Labels vorschlägt).
		const seqAnchors = new Map<number, string[]>();
		for (const sn of sortedSequenceNamings) {
			const p0 = sn.properties?.anchor?.pos0;
			if (typeof p0 === 'number' && p0 >= 0 && p0 <= text.length) {
				const arr = seqAnchors.get(p0) ?? [];
				arr.push(sn.id);
				seqAnchors.set(p0, arr);
			}
		}

		// Short-circuit ONLY when there is nothing to split on at all. With parsed
		// elements present we segment element-grained; with an active selection we
		// split exactly at its boundaries (below). Otherwise an uncoded document
		// collapses to a single [0, text.length] segment, and the selection-
		// highlight predicate (interval overlap) paints the WHOLE document for any
		// selection.
		if (textAnns.length === 0 && seqAnchors.size === 0 && elements.length === 0 && !selection) {
			return [{ text, codes: [], start: 0, end: text.length }];
		}

		// Build boundary points (annotations + sequence-anchors + element boundaries)
		const points = new Set<number>();
		points.add(0);
		points.add(text.length);
		for (const ann of textAnns) {
			const { pos0, pos1 } = ann.properties.anchor;
			if (pos0 >= 0 && pos0 <= text.length) points.add(pos0);
			if (pos1 >= 0 && pos1 <= text.length) points.add(pos1);
		}
		for (const p0 of seqAnchors.keys()) points.add(p0);
		// Add element boundaries for data-element-id mapping
		for (const el of elements) {
			if (el.char_start >= 0 && el.char_start <= text.length) points.add(el.char_start);
			if (el.char_end >= 0 && el.char_end <= text.length) points.add(el.char_end);
		}
		// Split exactly at the active selection so the highlight covers [pos0, pos1)
		// precisely — not the whole element it happens to fall inside. This makes
		// textSegments depend on `selection` (rebuild per selection); the margin-
		// measure effect keys off annotations.length, so it triggers no extra reflow.
		if (selection) {
			if (selection.pos0 >= 0 && selection.pos0 <= text.length) points.add(selection.pos0);
			if (selection.pos1 >= 0 && selection.pos1 <= text.length) points.add(selection.pos1);
		}
		const sorted = [...points].sort((a, b) => a - b);

		// Build lookup: leaf elements (sentences) sorted by char_start
		const leafElements = elements
			.filter((e: any) => e.content !== null)
			.sort((a: any, b: any) => a.char_start - b.char_start);

		const segments: TextSegment[] = [];
		for (let i = 0; i < sorted.length - 1; i++) {
			const start = sorted[i];
			const end = sorted[i + 1];
			if (start === end) continue;

			const activeCodes: TextSegment['codes'] = [];
			for (const ann of textAnns) {
				const { pos0, pos1 } = ann.properties.anchor;
				if (pos0 <= start && pos1 > start) {
					activeCodes.push({ id: ann.code_id, annId: ann.id, label: ann.code_label, color: ann.code_color || '#8b9cf7' });
				}
			}

			// Find which element this segment belongs to
			const el = leafElements.find((e: any) => e.char_start <= start && e.char_end >= end);

			const seqAnchorIds = seqAnchors.get(start);
			segments.push({ text: text.slice(start, end), codes: activeCodes, elementId: el?.id, seqAnchorIds, start, end });
		}
		return segments;
	});

	// Margin annotations: positioned by actual DOM coordinates
	function shortLabel(label: string): string {
		const words = label.split(/\s+/);
		return words.length <= 2 ? label : words.slice(0, 2).join(' ') + '…';
	}

	// Margin labels with measured Y positions + tooltip data
	let marginLabels = $state<Array<{
		annId: string; label: string; fullLabel: string; color: string; top: number;
		comment: string; snippet: string;
	}>>([]);
	let tooltipStyle = $state('');

	function showTooltip(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		tooltipStyle = `left: ${rect.right + 8}px; top: ${rect.top}px;`;
	}
	function hideTooltip() { tooltipStyle = ''; }
	let marginEl = $state<HTMLDivElement>();

	function measureMarginPositions() {
		if (!textEl || !marginEl) return;
		// Scroll container is .doc-with-margin (direct parent of marginEl)
		const container = marginEl.parentElement;
		if (!container) return;

		const annSpans = textEl.querySelectorAll<HTMLSpanElement>('.coded-text[data-ann-start]');
		// Absolute position = viewport offset + scrollTop — independent of current scroll position
		const containerTop = container.getBoundingClientRect().top;
		const scrollTop = container.scrollTop;
		const labels: typeof marginLabels = [];
		const seen = new Set<string>();
		const labelHeight = 14;

		for (const span of annSpans) {
			const annId = span.dataset.annStart!;
			if (seen.has(annId)) continue;
			seen.add(annId);

			const ann = codeAnnotations.find((a: any) => a.id === annId);
			if (!ann) continue;

			// Absolute offset from scroll content top — labels are position:absolute
			// inside code-margin which shares the same scroll container, so this
			// value is scroll-invariant and places the label next to its span.
			let top = span.getBoundingClientRect().top - containerTop + scrollTop;

			// Avoid overlap: push down if previous label occupies this position
			for (const prev of labels) {
				if (Math.abs(top - prev.top) < labelHeight) {
					top = prev.top + labelHeight;
				}
			}

			labels.push({
				annId,
				label: shortLabel(ann.code_label),
				fullLabel: ann.code_label,
				color: ann.code_color || '#8b9cf7',
				top,
				comment: ann.stack_memo || ann.properties?.comment || '',
				snippet: truncate(getSnippet(ann), 100)
			});
		}

		untrack(() => { marginLabels = labels; });
	}

	// Document memo
	let docMemoText = $state('');
	let docMemoSaving = $state(false);

	// Document stats — zählt nur klassische Codes (codes-Annotations).
	// Sequenz-Namings werden separat im TOC gezählt.
	const uniqueCodeCount = $derived(new Set(codeAnnotations.map((a: any) => a.code_id)).size);

	async function saveDocMemo() {
		if (!docMemoText.trim()) return;
		docMemoSaving = true;
		const firstLine = docMemoText.trim().split('\n')[0];
		const label = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
		try {
			const res = await fetch(`/api/projects/${data.projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label,
					content: `[Document: ${doc.label}]\n\n${docMemoText.trim()}`,
					linkedElementIds: [doc.id]
				})
			});
			if (res.ok) {
				docMemoText = '';
			}
		} finally {
			docMemoSaving = false;
		}
	}

	// Re-measure after DOM updates (annotations change)
	$effect(() => {
		void annotations.length; // minimal dependency — only re-measure when count changes

		const raf = requestAnimationFrame(() => measureMarginPositions());
		return () => cancelAnimationFrame(raf);
	});


	// Get surrounding context for an annotation passage
	function getPassageContext(ann: any): string {
		const anchor = ann.properties?.anchor;
		if (!anchor || anchor.pos0 == null || !doc.full_text) return '';
		const contextBefore = 80;
		const contextAfter = 80;
		const start = Math.max(0, anchor.pos0 - contextBefore);
		const end = Math.min(doc.full_text.length, anchor.pos1 + contextAfter);
		const before = start > 0 ? '…' + doc.full_text.slice(start, anchor.pos0) : doc.full_text.slice(0, anchor.pos0);
		const passage = doc.full_text.slice(anchor.pos0, anchor.pos1);
		const after = end < doc.full_text.length ? doc.full_text.slice(anchor.pos1, end) + '…' : doc.full_text.slice(anchor.pos1, end);
		return before + passage + after;
	}

	function getPassageParts(ann: any): { before: string; passage: string; after: string } {
		const anchor = ann.properties?.anchor;
		if (!anchor || anchor.pos0 == null || !doc.full_text) return { before: '', passage: '', after: '' };

		// Use OO elements for context: find surrounding sentences
		const leaves = elements
			.filter((e: any) => e.content !== null)
			.sort((a: any, b: any) => a.char_start - b.char_start);

		if (leaves.length > 0) {
			// Find elements that overlap with the annotation
			const annStart = anchor.pos0;
			const annEnd = anchor.pos1;
			const idx = leaves.findIndex((e: any) => e.char_end > annStart);
			if (idx >= 0) {
				const ctxBefore = 12;
				const ctxAfter = 12;
				// Find last element that overlaps with annotation end
				let endIdx = idx;
				while (endIdx < leaves.length - 1 && leaves[endIdx].char_start < annEnd) endIdx++;
				const firstIdx = Math.max(0, idx - ctxBefore);
				const lastIdx = Math.min(leaves.length - 1, endIdx + ctxAfter);
				const beforeStart = leaves[firstIdx].char_start;
				const afterEnd = leaves[lastIdx].char_end;
				return {
					before: (firstIdx > 0 ? '…' : '') + doc.full_text.slice(beforeStart, annStart),
					passage: doc.full_text.slice(annStart, annEnd),
					after: doc.full_text.slice(annEnd, afterEnd) + (lastIdx < leaves.length - 1 ? '…' : '')
				};
			}
		}

		// Fallback: character-based context
		const ctx = 120;
		const start = Math.max(0, anchor.pos0 - ctx);
		const end = Math.min(doc.full_text.length, anchor.pos1 + ctx);
		return {
			before: (start > 0 ? '…' : '') + doc.full_text.slice(start, anchor.pos0),
			passage: doc.full_text.slice(anchor.pos0, anchor.pos1),
			after: doc.full_text.slice(anchor.pos1, end) + (end < doc.full_text.length ? '…' : '')
		};
	}

	// Re-measure on resize (debounced — ResizeObserver fires frequently)
	$effect(() => {
		if (!textEl) return;
		let timeout: ReturnType<typeof setTimeout>;
		const observer = new ResizeObserver(() => {
			clearTimeout(timeout);
			timeout = setTimeout(() => measureMarginPositions(), 150);
		});
		observer.observe(textEl);
		return () => { observer.disconnect(); clearTimeout(timeout); };
	});

	// Re-measure on scroll so label positions stay accurate after text reflow
	// (e.g. scrollbar appearing/disappearing changes line wrapping).
	// Must listen to .doc-with-margin, the actual scroll container for the text.
	$effect(() => {
		if (!marginEl) return;
		const container = marginEl.parentElement;
		if (!container) return;
		let raf: number;
		function onScroll() {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => measureMarginPositions());
		}
		container.addEventListener('scroll', onScroll, { passive: true });
		return () => { container.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
	});

	// Resizable code margin
	let marginWidth = $state(100);

	function startMarginResize(e: MouseEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = marginWidth;
		function onMove(ev: MouseEvent) {
			marginWidth = Math.max(60, Math.min(300, startWidth - (ev.clientX - startX)));
		}
		function onUp() {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	// ── Spaltenlayout ─────────────────────────────────────────────────────
	// Hauptaktant der Seite ist das Transkript. Die Nebenspalten dürfen ihm
	// Raum nehmen, aber nur so viel, wie der Forscher ihnen zugesteht: jede
	// Spalte ist ausblendbar und in der Breite ziehbar, beides persistent.
	let showToc = $state(true);
	let showNamings = $state(true);
	let showPassages = $state(true);
	let tocWidth = $state(200);
	let namingsWidth = $state(260);
	let passagesWidth = $state(320);

	// Reihenfolge zählt: dieser Effekt läuft vor dem Speicher-Effekt, sonst
	// überschriebe der Default die gespeicherte Wahl (wie bei namings-sort).
	$effect(() => {
		if (typeof window === 'undefined') return;
		try {
			const raw = window.localStorage?.getItem('doc-layout');
			if (!raw) return;
			const l = JSON.parse(raw);
			if (typeof l.showToc === 'boolean') showToc = l.showToc;
			if (typeof l.showNamings === 'boolean') showNamings = l.showNamings;
			if (typeof l.showPassages === 'boolean') showPassages = l.showPassages;
			if (typeof l.tocWidth === 'number') tocWidth = l.tocWidth;
			if (typeof l.namingsWidth === 'number') namingsWidth = l.namingsWidth;
			if (typeof l.passagesWidth === 'number') passagesWidth = l.passagesWidth;
		} catch {
			// defekter Eintrag → Defaults stehen lassen
		}
	});
	$effect(() => {
		if (typeof window === 'undefined') return;
		window.localStorage?.setItem(
			'doc-layout',
			JSON.stringify({ showToc, showNamings, showPassages, tocWidth, namingsWidth, passagesWidth })
		);
	});

	// Die Sequenz-Spalte liegt links vom Text (Ziehen nach rechts verbreitert),
	// Namings und Verankerungen liegen rechts (Ziehen nach links verbreitert).
	function startColResize(e: MouseEvent, col: 'toc' | 'namings' | 'passages') {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = col === 'toc' ? tocWidth : col === 'namings' ? namingsWidth : passagesWidth;
		const sign = col === 'toc' ? 1 : -1;
		function onMove(ev: MouseEvent) {
			const w = Math.max(140, Math.min(560, startWidth + sign * (ev.clientX - startX)));
			if (col === 'toc') tocWidth = w;
			else if (col === 'namings') namingsWidth = w;
			else passagesWidth = w;
		}
		function onUp() {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	// ── Sequenz-Titel umschreiben ─────────────────────────────────────────
	// Sequenz-Titel stammen aus dem KI-Lauf und sind damit Cues. Der Forscher
	// schreibt sie um wie jedes andere Naming: 'rename' hängt einen Akt an den
	// Stack, der alte Wortlaut bleibt in der Kette stehen (append-only).
	let renamingSeqId = $state<string | null>(null);
	let renameSeqValue = $state('');

	async function saveSeqRename(ann: any) {
		const next = renameSeqValue.trim();
		renamingSeqId = null;
		if (!next || next === ann.code_label) return;
		const res = await fetch(`/api/projects/${data.projectId}/namings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ action: 'rename', namingId: ann.code_id, inscription: next })
		});
		if (res.ok) await invalidateAll();
	}

	function jumpToSimilar(sp: any) {
		// Cross-document hit → open that document in a NEW TAB so the current
		// coding view is never lost; same-document → scroll to the element.
		if (sp.documentId && sp.documentId !== doc.id) {
			window.open(`/projects/${data.projectId}/documents/${sp.documentId}`, '_blank', 'noopener');
			return;
		}
		const el = textEl?.querySelector(`[data-element-id="${sp.elementId}"]`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function scrollToPassage(annId: string) {
		if (!textEl) return;
		const span = textEl.querySelector(`.coded-text[data-ann-start="${annId}"]`);
		if (!span) return;
		span.scrollIntoView({ behavior: 'smooth', block: 'center' });
		highlightedAnnotationId = annId;
		setTimeout(() => { highlightedAnnotationId = null; }, 2000);
	}

	// TOC-Klick: zur Start-Position der Sequenz scrollen. Sequenz-Namings
	// werden NICHT als coded-text-Spans gerendert; das Start-Segment trägt
	// stattdessen data-seq-anchor mit einer space-separierten Liste aller
	// annIds, die an dieser pos0 starten (pro Sequenz committet H1 mehrere
	// Namings mit gleichem Anker — alle landen auf dem gleichen Segment).
	let highlightedSeqId = $state<string | null>(null);
	function scrollToSequence(annId: string) {
		if (!textEl) return;
		const el = textEl.querySelector(`[data-seq-anchor~="${annId}"]`);
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		highlightedSeqId = annId;
		setTimeout(() => { highlightedSeqId = null; }, 2200);
	}

	// Naming click handler: select naming(s) to show their passages
	function handleNamingClick(namingId: string, e: MouseEvent) {
		if (e.shiftKey && lastClickedNamingId) {
			// Range selection
			const ids = scopedCandidates.map((c: any) => c.id);
			const fromIdx = ids.indexOf(lastClickedNamingId);
			const toIdx = ids.indexOf(namingId);
			if (fromIdx >= 0 && toIdx >= 0) {
				const start = Math.min(fromIdx, toIdx);
				const end = Math.max(fromIdx, toIdx);
				const next = new Set(selectedNamingIds);
				for (let i = start; i <= end; i++) next.add(ids[i]);
				selectedNamingIds = next;
			}
		} else if (e.altKey) {
			// Toggle individual
			const next = new Set(selectedNamingIds);
			if (next.has(namingId)) next.delete(namingId);
			else next.add(namingId);
			selectedNamingIds = next;
			lastClickedNamingId = namingId;
		} else {
			// Exclusive select
			selectedNamingIds = new Set([namingId]);
			lastClickedNamingId = namingId;
		}
	}

	// Context menu on naming right-click
	function handleNamingContextMenu(namingId: string, e: MouseEvent) {
		e.preventDefault();
		if (!selectedNamingIds.has(namingId)) {
			selectedNamingIds = new Set([namingId]);
			lastClickedNamingId = namingId;
		}
		ctxMenuNamingIds = [...selectedNamingIds];
		ctxMenuPos = { x: e.clientX, y: e.clientY };
	}

	// Drag-and-drop: naming onto selected text = code
	function handleNamingDragStart(namingId: string, e: DragEvent) {
		if (!hasSelection) {
			e.preventDefault();
			return;
		}
		e.dataTransfer!.setData('application/x-naming-id', namingId);
		e.dataTransfer!.effectAllowed = 'copy';
	}

	function handleDocDragOver(e: DragEvent) {
		if (e.dataTransfer?.types.includes('application/x-naming-id')) {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
			dragOverDoc = true;
		}
	}

	function handleDocDragLeave() {
		dragOverDoc = false;
	}

	function handleDocDrop(e: DragEvent) {
		e.preventDefault();
		dragOverDoc = false;
		const codeId = e.dataTransfer?.getData('application/x-naming-id');
		if (codeId && (selection || regionSelection)) {
			annotate(codeId);
		}
	}

	async function annotate(codeId: string) {
		if (annotating) return;
		if (!selection && !regionSelection) return;
		annotating = true;

		const body = isImage
			? {
				codeId,
				anchorType: 'image_region',
				anchor: { type: 'rect', ...regionSelection },
				comment: comment.trim() || undefined
			}
			: {
				codeId,
				anchorType: 'text',
				anchor: { pos0: selection!.pos0, pos1: selection!.pos1, text: selection!.text },
				comment: comment.trim() || undefined
			};

		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (res.ok) {
			const annRes = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`);
			annotations = await annRes.json();
			comment = '';
			if (isImage) {
				regionSelection = null;
				imageViewer?.clearRegion();
			}
		}
		annotating = false;
	}

	async function createCodeAndAnnotate() {
		if (!canCreateInVivo || creatingCode) return;
		creatingCode = true;
		const label = codeFilter.trim();
		const res = await fetch(`/api/projects/${data.projectId}/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label, color: newCodeColor })
		});
		if (res.ok) {
			const newCode = await res.json();
			// Refresh candidates list
			const candidatesRes = await fetch(`/api/projects/${data.projectId}/codes`);
			if (candidatesRes.ok) {
				candidates = await candidatesRes.json();
			}
			codeFilter = '';
			await annotate(newCode.id);
		}
		creatingCode = false;
	}

	async function savePassageMemo(annId: string, codeId: string) {
		if (!passageMemoText.trim()) { memoingAnnId = null; return; }
		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ annotationId: annId, codeId, memo: passageMemoText.trim() })
		});
		if (res.ok) {
			// Refresh annotations to show new memo
			const annRes = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`);
			annotations = await annRes.json();
			passageMemoText = '';
			memoingAnnId = null;
		}
	}

	// ai-eval: eine Revision wurde als eigenes Naming übernommen oder eine Passage
	// aus-/eingeblendet. Remove with the ai-eval layer (see AiEvalControl.svelte).
	async function refreshAfterAiEval() {
		const [annRes, candidatesRes] = await Promise.all([
			fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations`),
			fetch(`/api/projects/${data.projectId}/codes`)
		]);
		if (annRes.ok) annotations = await annRes.json();
		if (candidatesRes.ok) candidates = await candidatesRes.json();
	}

	async function deleteAnnotation(annId: string, codeId: string, codeLabel: string) {
		// First check: would this also delete the code?
		const checkRes = await fetch(
			`/api/projects/${data.projectId}/documents/${doc.id}/annotations?id=${annId}&check=1&codeId=${codeId}`,
			{ method: 'DELETE' }
		);
		if (!checkRes.ok) return;
		const { wouldDeleteCode } = await checkRes.json();

		const msg = wouldDeleteCode
			? `Remove passage AND delete naming "${codeLabel}"?\n\nThis naming has no other passages — it will be permanently deleted.`
			: `Remove this passage of "${codeLabel}"?\n\nThe naming itself is used elsewhere and will be kept.`;

		if (!confirm(msg)) return;

		const res = await fetch(`/api/projects/${data.projectId}/documents/${doc.id}/annotations?id=${annId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			const result = await res.json();
			annotations = annotations.filter((a: any) => a.id !== annId);
			if (result.codeDeleted) {
				candidates = candidates.filter((c: any) => c.id !== codeId);
			}
		}
	}

	function cancelSelection() {
		if (isImage) {
			regionSelection = null;
			imageViewer?.clearRegion();
		} else {
			selection = null;
			window.getSelection()?.removeAllRanges();
		}
		comment = '';
	}

	function getSnippet(ann: any): string {
		const anchor = ann.properties?.anchor;
		if (!anchor) return '';
		// Image region annotation
		if (anchor.type === 'rect') {
			const w = Math.round(anchor.width * 100);
			const h = Math.round(anchor.height * 100);
			return `Region ${w}% \u00d7 ${h}%`;
		}
		// Text annotation
		if (anchor.text) return anchor.text;
		if (anchor.pos0 != null && anchor.pos1 != null && doc.full_text) {
			return doc.full_text.slice(anchor.pos0, anchor.pos1);
		}
		return '';
	}

	function truncate(text: string, len: number): string {
		return text.length > len ? text.slice(0, len) + '\u2026' : text;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function getSelectionPreview(): string {
		if (regionSelection) {
			const w = Math.round(regionSelection.width * 100);
			const h = Math.round(regionSelection.height * 100);
			return `Region ${w}% \u00d7 ${h}%`;
		}
		if (selection) {
			return `"${truncate(selection.text, 120)}"`;
		}
		return '';
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="doc-viewer" onclick={() => { ctxMenuNamingIds = null; }}>
	<!-- Kopfzeile: Werkzeuge und Spaltenschalter. Alles, was Funktionsbefehl
	     ist — auch der KI-Lauf —, steht hier und nicht in einer Spalte neben
	     dem Material. -->
	<div class="doc-toolbar">
		{#if !isImage && sortedSequenceNamings.length > 0}
			<button
				class="tb-toggle"
				class:tb-on={showToc}
				onclick={() => { showToc = !showToc; }}
				title="Sequenz-Spalte ein- oder ausblenden"
			>{showToc ? '⟨' : '⟩'} Sequenzen <span class="tb-count">{sortedSequenceNamings.length}</span></button>
		{/if}
		<span class="tb-title" title={doc.label}>{doc.label}</span>
		<button
			class="tb-toggle"
			class:tb-on={showNamings}
			onclick={() => { showNamings = !showNamings; }}
			title="Namings-Spalte ein- oder ausblenden"
		>Namings <span class="tb-count">{scopedCandidates.length}</span></button>
		<button
			class="tb-toggle"
			class:tb-on={showPassages}
			onclick={() => { showPassages = !showPassages; }}
			title="Verankerungs-Spalte ein- oder ausblenden"
		>Verankerungen <span class="tb-count">{filteredAnnotations.length}</span></button>
		<!-- AI-Coding-Run trigger + live progress (Coding-Run-Subsystem). -->
		<CodingRunPanel
			compact
			projectId={data.projectId}
			docId={doc.id}
			distinctNamings={uniqueCodeCount}
			oncompleted={() => invalidateAll()}
			onsequencedone={() => scheduleLiveRefresh()}
		/>
	</div>

	<div class="doc-body">
		<!-- TOC-Spalte: Begründete Sequenz-Namings als „Inhaltsverzeichnis" des
		     Dokuments. Material-Ebene (vgl. Migration 030 / coding-flow-Design).
		     Wird nur angezeigt, wenn Sequenz-Namings existieren. -->
		{#if !isImage && showToc && sortedSequenceNamings.length > 0}
			<aside class="toc-column" style="width: {tocWidth}px;" aria-label="Sequenzen">
				<div class="toc-header">
					<h3>Sequenzen <span class="count">({sortedSequenceNamings.length})</span></h3>
					<button class="toc-hide" onclick={() => { showToc = false; }} title="Spalte ausblenden">⟨</button>
				</div>
				<!-- Legende: die beiden Zahlen am Eintrag sind sonst nicht lesbar. -->
				<div class="toc-legend">
					<span class="tl-seq">Nr.</span>
					<span class="tl-label">Titel · Doppelklick zum Umschreiben</span>
					<span class="tl-meta">Sätze</span>
				</div>
				<div class="toc-scroll">
					{#each sortedSequenceNamings as ann (ann.id)}
						{@const seq = ann.properties?.sequenceMeta?.seq}
						{@const sCount = ann.properties?.sequenceMeta?.sentenceCount}
						{#if renamingSeqId === ann.id}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="toc-rename"
								bind:value={renameSeqValue}
								autofocus
								onkeydown={(e) => { if (e.key === 'Enter') saveSeqRename(ann); if (e.key === 'Escape') renamingSeqId = null; }}
								onblur={() => saveSeqRename(ann)}
							/>
						{:else}
							<button
								type="button"
								class="toc-entry"
								class:toc-active={highlightedSeqId === ann.id}
								title={ann.code_label}
								onclick={() => scrollToSequence(ann.id)}
								ondblclick={() => { renamingSeqId = ann.id; renameSeqValue = ann.code_label; }}
							>
								{#if typeof seq === 'number'}<span class="toc-seq" title="Sequenz-Nr. im Dokument">{seq}</span>{/if}
								<span class="toc-label">{ann.code_label}</span>
								{#if typeof sCount === 'number'}<span class="toc-meta" title="{sCount} Sätze in dieser Sequenz">{sCount}</span>{/if}
							</button>
						{/if}
					{/each}
				</div>
			</aside>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="col-divider" onmousedown={(e) => startColResize(e, 'toc')} title="Breite ziehen"></div>
		{/if}

		<div class="doc-with-margin">
			<div class="content-panel" class:image-mode={isImage}>
				{#if isImage}
					<ImageAnnotationViewer
						bind:this={imageViewer}
						imageUrl="/api/projects/{data.projectId}/documents/{doc.id}/image"
						annotations={codeAnnotations}
						bind:highlightedAnnotationId
						onregionselect={(region) => { regionSelection = region; }}
					/>
				{:else if doc.full_text}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<pre class="document-text" class:sel-similar={panelMode === 'similar'} class:drop-target-active={dragOverDoc && hasSelection} bind:this={textEl} onmouseup={handleMouseUp} ondragover={handleDocDragOver} ondragleave={handleDocDragLeave} ondrop={handleDocDrop}>{#each textSegments as seg, i}{#if seg.codes.length > 0}{@const isAnnStart = i === 0 || !textSegments[i - 1].codes.some(c => c.annId === seg.codes[0].annId)}<span
						class="coded-text"
						class:coded-highlighted={seg.codes.some(c => c.annId === highlightedAnnotationId)}
						class:selection-highlight={selection && seg.start < selection.pos1 && seg.end > selection.pos0}
						class:seq-flash={seg.seqAnchorIds && highlightedSeqId && seg.seqAnchorIds.includes(highlightedSeqId)}
						style="background: {codedBackground(seg.codes)}; border-bottom: 2px solid {seg.codes[0].color};"
						data-element-id={seg.elementId || undefined}
						data-ann-start={isAnnStart ? seg.codes[0].annId : undefined}
						data-seq-anchor={seg.seqAnchorIds?.join(' ') || undefined}
						onmouseenter={() => { highlightedAnnotationId = seg.codes[0].annId; }}
						onmouseleave={() => { highlightedAnnotationId = null; }}
					>{seg.text}<span class="code-tooltip">{seg.codes.map(c => c.label).join(', ')}</span></span>{:else}<span data-element-id={seg.elementId || undefined} data-seq-anchor={seg.seqAnchorIds?.join(' ') || undefined} class:selection-highlight={selection && seg.start < selection.pos1 && seg.end > selection.pos0} class:seq-flash={seg.seqAnchorIds && highlightedSeqId && seg.seqAnchorIds.includes(highlightedSeqId)}>{seg.text}</span>{/if}{/each}</pre>
				{:else}
					<p class="placeholder">No text content available</p>
				{/if}
			</div>

			{#if !isImage}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="margin-divider" onmousedown={startMarginResize}></div>
				<div class="code-margin" bind:this={marginEl} style="width: {marginWidth}px;">
					{#each marginLabels as ml (ml.annId)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="margin-label"
							class:margin-highlighted={highlightedAnnotationId === ml.annId}
							style="color: {ml.color}; top: {ml.top}px;"
							onmouseenter={(e) => { highlightedAnnotationId = ml.annId; showTooltip(e); }}
							onmouseleave={() => { highlightedAnnotationId = null; hideTooltip(); }}
						>{ml.label}<span class="margin-tooltip" style={tooltipStyle}><strong>{ml.fullLabel}</strong>{#if ml.comment}<em>{ml.comment}</em>{/if}{#if ml.snippet}<span class="mt-snippet">{ml.snippet}</span>{/if}</span></span>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Namings-Column: rein empirische Spalte — der KI-Lauf-Streifen sitzt
		     als Funktionsbefehl in der Kopfzeile, nicht mehr hier. -->
		{#if showNamings}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="col-divider" onmousedown={(e) => startColResize(e, 'namings')} title="Breite ziehen"></div>
		<div class="namings-column" style="width: {namingsWidth}px;">
			<!-- Namings: permanent code overview -->
			<div class="namings-panel">
			<div class="panel-header">
				<h3>Namings <span class="count">({scopedCandidates.length})</span>
						{#if selectedNamingIds.size > 0}
							<button class="btn-xs" onclick={() => { selectedNamingIds = new Set(); }}>Clear</button>
						{/if}
					</h3>
				<div class="scope-toggle">
					<button class="scope-btn" class:active={namingsScope === 'this'} onclick={() => namingsScope = 'this'}>Document</button>
					<div class="scope-right">
						<button class="scope-btn" class:active={namingsScope !== 'this'} onclick={() => namingsScope = 'all'}>All</button>
						<select class="scope-doc-pick" value="" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) namingsScope = v; (e.target as HTMLSelectElement).value = ''; }}>
							<option value="">▾</option>
							{#each projectDocuments.filter(d => d.id !== doc.id) as d}
								<option value={d.id}>{d.label}</option>
							{/each}
						</select>
					</div>
					<select
						class="namings-sort"
						bind:value={sortMode}
						title="Sortierung der Namings-Liste"
					>
						<option value="alpha">A–Z</option>
						<option value="occurrence">Auftreten</option>
						<option value="count">Häufigkeit</option>
					</select>
				</div>
			</div>

			{#if hasSelection}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="selection-section"
					class:drop-target-active={dragOverCard}
					ondragover={(e) => { if (e.dataTransfer?.types.includes('application/x-naming-id')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dragOverCard = true; } }}
					ondragleave={() => { dragOverCard = false; }}
					ondrop={(e) => { dragOverCard = false; handleDocDrop(e); }}>
					<div class="selection-top">
						<div class="selection-preview">{getSelectionPreview()}</div>
						<button class="btn-cancel" onclick={cancelSelection}>&times;</button>
					</div>
					<form class="invivo-form" onsubmit={e => { e.preventDefault(); if (canCreateInVivo) createCodeAndAnnotate(); }}>
						<input
							type="text"
							class="code-filter-input"
							placeholder="Apply naming..."
							bind:value={codeFilter}
							disabled={annotating || creatingCode}
						/>
						{#if canCreateInVivo}
							<div class="invivo-create-row">
								<input type="color" class="invivo-color" bind:value={newCodeColor} />
								<button type="submit" class="btn-create-code" disabled={creatingCode}>
									+ {codeFilter.trim()}
								</button>
							</div>
						{/if}
					</form>
					<input
						type="text"
						class="comment-input"
						placeholder="Naming-Memo (optional)"
						bind:value={comment}
					/>
				</div>
			{:else}
				<form class="invivo-form" onsubmit={e => { e.preventDefault(); }}>
					<input
						type="text"
						class="code-filter-input"
						placeholder="Filter namings..."
						bind:value={codeFilter}
					/>
				</form>
			{/if}

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="namings-scroll"
				onclick={(e) => { if (!(e.target as HTMLElement).closest('.naming-row')) { selectedNamingIds = new Set(); } ctxMenuNamingIds = null; }}
				onpointerdown={(e) => {
					if ((e.target as HTMLElement).closest('.naming-row')) return;
					namingDragSelecting = true;
					namingDragStartY = e.clientY;
					(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				}}
				onpointermove={(e) => {
					if (!namingDragSelecting) return;
					const container = e.currentTarget as HTMLElement;
					const rows = container.querySelectorAll('.naming-row[data-naming-id]');
					const minY = Math.min(namingDragStartY, e.clientY);
					const maxY = Math.max(namingDragStartY, e.clientY);
					const next = new Set<string>();
					rows.forEach(row => {
						const rect = row.getBoundingClientRect();
						if (rect.bottom >= minY && rect.top <= maxY) {
							const id = (row as HTMLElement).dataset.namingId;
							if (id) next.add(id);
						}
					});
					selectedNamingIds = next;
				}}
				onpointerup={() => { namingDragSelecting = false; }}
			>
				{#if scopedCandidates.length > 0}
					{#each [...candidateGroups] as [key, group] (key)}
						<div class="naming-group">
							<span class="naming-group-label">{group.label}</span>
							{#each group.items as c (c.id)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="naming-row" class:naming-expanded={expandedNamingId === c.id} class:naming-selected={selectedNamingIds.has(c.id)} class:naming-rejected={isRejectedNaming(c.id)} class:apply-mode={hasSelection} data-naming-id={c.id} draggable="true" ondragstart={(e) => handleNamingDragStart(c.id, e)}>
									<div class="naming-main" onclick={(e) => handleNamingClick(c.id, e)} oncontextmenu={(e) => handleNamingContextMenu(c.id, e)}>
										<span class="color-dot" style="background: {c.color || '#8b9cf7'}"></span>
										<span
										class="naming-label"
										onmouseenter={(e) => { namingTooltipText = c.label; const r = (e.target as HTMLElement).getBoundingClientRect(); namingTooltipStyle = `left:${r.right + 6}px;top:${r.top}px;display:block`; }}
										onmouseleave={() => { namingTooltipStyle = 'display:none'; }}
									>{c.label}</span>
										<button
											class="naming-action"
											class:has-memos={scopedAnnotations.some((a) => a.code_id === c.id && (a.stack_memo || a.properties?.comment))}
											title="Show memos"
											onclick={(e) => { e.stopPropagation(); expandedNamingId = expandedNamingId === c.id ? null : c.id; }}
										>{expandedNamingId === c.id ? '▽' : '▼'}</button>
									</div>
									{#if expandedNamingId === c.id}
										{#each [scopedAnnotations.filter((a) => a.code_id === c.id)] as codeAnns}
											{#each [namingStacks.get(c.id) || []] as stack}
												<div class="naming-detail">
													<span class="naming-stat">{codeAnns.length} passage{codeAnns.length !== 1 ? 's' : ''}</span>
													{#if stack.some(a => a.designation || a.inscription)}
														<div class="naming-section-label">Stack</div>
														{#each stack as act}
															{#if act.designation || act.inscription}
																<div class="naming-stack-entry">
																	{#if act.designation}<span class="stack-ccs">{act.designation}</span>{/if}
																	{#if act.inscription}<span class="stack-inscription">{act.inscription}</span>{/if}
																</div>
															{/if}
														{/each}
													{/if}
													{#if stack.some(a => a.memo_text && !(a.linked_naming_ids && a.linked_naming_ids.length > 0)) || codeAnns.some(a => a.stack_memo || a.properties?.comment)}
														<div class="naming-section-label">Memos</div>
														{#each stack as act}
															{#if act.memo_text && !(act.linked_naming_ids && act.linked_naming_ids.length > 0)}
																<div class="naming-memo">{act.memo_text}</div>
															{/if}
														{/each}
														{#each codeAnns as ann}
															{#if ann.stack_memo || ann.properties?.comment}
																<div class="naming-memo">{ann.stack_memo || ann.properties.comment}</div>
															{/if}
														{/each}
													{/if}
												</div>
											{/each}
										{/each}
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				{:else if codeFilter.trim() && !canCreateInVivo}
					<p class="empty">No namings match.</p>
				{/if}
			</div>

			<div class="panel-footer">
				<div class="doc-stats">
					<span class="stat">{codeAnnotations.length} passages</span>
					<span class="stat-sep">&middot;</span>
					<span class="stat">{uniqueCodeCount} namings</span>
				</div>
				<div class="doc-memo-inline">
					<textarea
						class="doc-memo-textarea"
						placeholder="Memo..."
						bind:value={docMemoText}
						rows="2"
					></textarea>
					{#if docMemoText.trim()}
						<button class="btn-doc-memo-save" onclick={saveDocMemo} disabled={docMemoSaving}>
							{docMemoSaving ? 'Saving…' : 'Save Memo'}
						</button>
					{/if}
				</div>
			</div>
		</div>

		</div>
		<!-- /namings-column -->
		{/if}

		<!-- Verankerungen: permanente Übersicht der verankerten Textstellen -->
		{#if showPassages}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="col-divider" onmousedown={(e) => startColResize(e, 'passages')} title="Breite ziehen"></div>
		<div class="passages-panel" class:panel-similar={selection && panelMode === 'similar'} style="width: {passagesWidth}px;">
			<div class="panel-header">
				{#if selection}
					<!-- Zwei Bezüge, zwei Farben: Indigo = ein Naming aus der Namings-
					     Spalte, Türkis = die eigene Markierung im Text. Die Farbe zieht
					     sich durch Reiter, Bezugszeile und Karten. -->
					<div class="mode-toggle" role="tablist" aria-label="Anzeigemodus">
						<button class="mode-btn mode-anchor" class:active={panelMode === 'code'} role="tab" aria-selected={panelMode === 'code'} onclick={() => panelMode = 'code'}>
							Verankerungen <span class="mode-count">{filteredAnnotations.length}</span>
						</button>
						<button class="mode-btn mode-similar" class:active={panelMode === 'similar'} role="tab" aria-selected={panelMode === 'similar'} onclick={() => panelMode = 'similar'}>
							Ähnliche Stellen{#if similarPassages} <span class="mode-count">{similarPassages.length}</span>{/if}
						</button>
					</div>
					<div class="anchor-hint" class:hint-similar={panelMode === 'similar'}>
						{#if panelMode === 'similar'}
							ähnlich zur markierten Stelle „{truncate(selection.text, 34)}“
						{:else if selectedNamingLabel}
							verankert unter Naming „{truncate(selectedNamingLabel, 30)}“
						{:else}
							alle Verankerungen im gewählten Bereich
						{/if}
					</div>
				{:else}
					<h3>Verankerungen <span class="count">({filteredAnnotations.length}/{scopedAnnotations.length})</span></h3>
				{/if}
				{#if panelMode === 'code'}
					<div class="scope-toggle">
						<button class="scope-btn" class:active={passagesScope === 'this'} onclick={() => passagesScope = 'this'}>Document</button>
						<div class="scope-right">
							<button class="scope-btn" class:active={passagesScope !== 'this'} onclick={() => passagesScope = 'all'}>All</button>
							<select class="scope-doc-pick" value="" onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) passagesScope = v; (e.target as HTMLSelectElement).value = ''; }}>
								<option value="">▾</option>
								{#each projectDocuments.filter(d => d.id !== doc.id) as d}
									<option value={d.id}>{d.label}</option>
								{/each}
							</select>
						</div>
					</div>
				{/if}
			</div>
			{#if phases.length > 0}
				<div class="phase-filter-row">
					<select class="phase-filter-select"
						value={phaseFilter || ''}
						onchange={(e) => { const v = (e.target as HTMLSelectElement).value; phaseFilter = v || null; }}>
						<option value="">All phases</option>
						{#each phases as c}
							<option value={c.id}>{c.label} ({c.member_count})</option>
						{/each}
					</select>
					{#if phaseFilter}
						<button class="btn-xs" onclick={() => phaseFilter = null}>×</button>
					{/if}
				</div>
			{/if}
			{#if !isImage && selection}
				<div class="comparison-section">
					<ComparisonPanel
						projectId={data.projectId}
						docId={doc.id}
						{selection}
						mode={panelMode}
						onannotate={(codeId) => annotate(codeId)}
						documentTitle={doc.label}
						onsimilar={(passages) => { similarPassages = passages; }}
					/>
				</div>
			{/if}
			{#if panelMode === 'similar'}
				<!-- Similar mode: shows embedding-similar passages -->
				<div class="passages-scroll">
					{#if !similarPassages}
						<p class="empty">{selection && selection.text.length < 10 ? 'Markierung zu kurz für Ähnlichkeitssuche.' : 'Lädt ähnliche Stellen…'}</p>
					{:else if similarPassages.length === 0}
						<p class="empty">Keine ähnlichen Stellen gefunden.</p>
					{:else}
						{#each similarPassages as sp, i (i)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="annotation-card"
								class:ann-expanded={expandedAnnId === `sim-${i}`}
							>
								<div class="ann-header">
									{#if sp.codes?.length > 0}
										<span class="color-dot" style="background: #8b9cf7"></span>
										<span class="code-name">{sp.codes.map((c: any) => c.label).join(', ')}</span>
									{:else}
										<span class="code-name similar-uncoded">{truncate(sp.content, 50)}</span>
									{/if}
									<button
										class="btn-expand-ann"
										onclick={() => { expandedAnnId = expandedAnnId === `sim-${i}` ? null : `sim-${i}`; }}
										title="Show context"
									>{expandedAnnId === `sim-${i}` ? '▽' : '▼'}</button>
									<button
										class="btn-expand-ann"
										onclick={() => jumpToSimilar(sp)}
										title={sp.documentId === doc.id ? 'Scroll to passage' : 'Open in new tab'}
									>▶</button>
									<span class="similar-score">{(sp.similarity * 100).toFixed(0)}%</span>
								</div>
								<div class="ann-doc-label">{sp.documentTitle}</div>
								{#if expandedAnnId === `sim-${i}`}
									<div class="ann-context">{sp.content}</div>
								{:else}
									<div class="ann-text">{truncate(sp.content, 80)}</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			{:else}
				<!-- Normal mode: filtered passages -->
				<input
					type="text"
					class="ann-search"
					placeholder="Filter..."
					bind:value={annFilter}
				/>
				<div class="passages-scroll">
					{#if filteredAnnotations.length === 0}
						<p class="empty">{annFilter ? 'No matches.' : 'No passages yet.'}</p>
					{:else}
						{#each filteredAnnotations as ann (ann.id)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="annotation-card"
								data-ann-id={ann.id}
								class:ann-highlighted={highlightedAnnotationId === ann.id}
								class:ann-expanded={expandedAnnId === ann.id}
								class:ann-rejected={isRejectedAnn(ann)}
								class:ann-hidden={ann.properties?.hidden}
								onmouseenter={() => { highlightedAnnotationId = ann.id; }}
								onmouseleave={() => { highlightedAnnotationId = null; }}
							>
								<div class="ann-header">
									<span class="color-dot" style="background: {ann.code_color || '#8b9cf7'}"></span>
									<span class="code-name">{ann.code_label}</span>
									<button
										class="btn-expand-ann"
										onclick={() => { expandedAnnId = expandedAnnId === ann.id ? null : ann.id; }}
										title="Show context"
									>{expandedAnnId === ann.id ? '▽' : '▼'}</button>
									<button
										class="btn-expand-ann"
										onclick={() => ann.document_id === doc.id ? scrollToPassage(ann.id) : window.open(`/projects/${data.projectId}/documents/${ann.document_id}`, '_blank', 'noopener')}
										title={ann.document_id === doc.id ? 'Scroll to passage' : 'Open in new tab'}
									>▶</button>
									<button
										class="btn-delete-ann"
										onclick={(e) => { e.stopPropagation(); deleteAnnotation(ann.id, ann.code_id, ann.code_label); }}
										title="Remove"
									>×</button>
								</div>
								{#if passagesScope !== 'this' && ann.document_label}
									<div class="ann-doc-label">{ann.document_label}</div>
								{/if}
								{#if expandedAnnId === ann.id}
									{@const parts = getPassageParts(ann)}
									<div class="ann-context">
										<span class="ctx-before">{parts.before}</span><span class="ctx-passage">{parts.passage}</span><span class="ctx-after">{parts.after}</span>
									</div>
									{#if ann.stack_memo || ann.properties?.comment}
										<div class="ann-comment">{ann.stack_memo || ann.properties.comment}</div>
									{/if}
									{#if memoingAnnId === ann.id}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											class="passage-memo-input"
											placeholder="Memo for this passage..."
											bind:value={passageMemoText}
											autofocus
											onkeydown={(e) => { if (e.key === 'Enter') savePassageMemo(ann.id, ann.code_id); if (e.key === 'Escape') memoingAnnId = null; }}
											onblur={() => { if (passageMemoText.trim()) savePassageMemo(ann.id, ann.code_id); else memoingAnnId = null; }}
										/>
									{:else}
										<button class="btn-add-memo" onclick={() => { memoingAnnId = ann.id; passageMemoText = ''; }}>+ Memo</button>
									{/if}
								{#if (ann.properties?.aiPersona || ann.properties?.aiSuggested) && ann.document_id === doc.id}
											<AiEvalControl
												projectId={data.projectId}
												docId={doc.id}
												annotationId={ann.id}
												subjectNamingId={ann.code_id}
												subjectLabel={ann.code_label}
												anchor={ann.properties?.anchor ?? null}
												hidden={!!ann.properties?.hidden}
												passageCount={codeAnnotations.filter((a: any) => a.code_id === ann.code_id).length}
												onadopt={refreshAfterAiEval}
												onhide={refreshAfterAiEval}
											/>
										{/if}
									{:else if getSnippet(ann)}
									<div class="ann-text">{truncate(getSnippet(ann), 60)}</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
				<!-- ai-eval: ausgeblendete Cues bleiben erreichbar — sonst wäre „ausblenden" ein Verschwinden ohne Rückweg. -->
				{#if hiddenAnnotations.length > 0 || showHidden}
					<div class="hidden-note">
						<span>{hiddenAnnotations.length} ausgeblendet</span>
						<button class="btn-show-hidden" onclick={() => { showHidden = !showHidden; }}>
							{showHidden ? 'wieder ausblenden' : 'einblenden'}
						</button>
					</div>
				{/if}
			{/if}
		</div>
		<!-- /passages-panel -->
		{/if}

	</div>
</div>

<!-- Naming tooltip: fixed position, outside overflow containers -->
<div class="naming-tooltip-fixed" style={namingTooltipStyle}>{namingTooltipText}</div>

{#if ctxMenuNamingIds}
	<NamingContextMenu
		namingIds={ctxMenuNamingIds}
		position={ctxMenuPos}
		namingLabels={ctxMenuNamingIds.map(id => candidates.find((c: any) => c.id === id)?.label || '')}
		onclose={() => ctxMenuNamingIds = null}
		onaddtophase={() => { showPhaseDialog = true; }}
	/>
{/if}

{#if showPhaseDialog && ctxMenuNamingIds}
	<PhaseAssignDialog
		namingIds={ctxMenuNamingIds}
		{phases}
		projectId={data.projectId}
		onclose={() => { showPhaseDialog = false; ctxMenuNamingIds = null; }}
	/>
{/if}

<style>
	/* Layout discipline (Session 32): the doc viewer fits exactly into its
	 * parent .project-content. Nothing scrolls the page or the project
	 * sidebar; scroll happens INSIDE columns. The code-margin sits inside
	 * the same scroll container as the text so its labels stay glued to
	 * the spans they annotate (positions are absolute relative to the
	 * shared scroll container, so when the container scrolls both the text
	 * and the labels move together). */
	.doc-viewer {
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.doc-body {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 0;
		overflow: hidden;
	}

	/* Kopfzeile: Dokumenttitel, Spaltenschalter, KI-Lauf. Umbricht, damit der
	   aufgeklappte KI-Lauf-Streifen eine eigene Zeile bekommt statt die
	   Schalter zu verdrängen. */
	.doc-toolbar {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0 0.5rem;
	}
	.tb-title {
		flex: 1;
		min-width: 3rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #c9cdd5;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0 0.3rem;
	}
	.tb-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 0.2rem 0.5rem;
		color: #6b7280;
		font-family: inherit;
		font-size: 0.7rem;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s, background 0.12s;
	}
	.tb-toggle:hover { color: #c9cdd5; border-color: #3a3f52; }
	.tb-toggle.tb-on {
		color: #c9cdd5;
		background: #1a1d29;
		border-color: #3a3f52;
	}
	.tb-count {
		font-size: 0.62rem;
		font-weight: 600;
		line-height: 1;
		padding: 0.12rem 0.32rem;
		border-radius: 999px;
		background: #252840;
		color: #9ca3af;
	}
	.tb-toggle.tb-on .tb-count { color: #c9cdd5; }

	/* Ziehleiste zwischen den Spalten. Trägt zugleich den Abstand, den vorher
	   der gap der doc-body übernommen hat. */
	.col-divider {
		width: 9px;
		flex-shrink: 0;
		cursor: col-resize;
		background:
			linear-gradient(#2a2d3a, #2a2d3a) center / 1px 100% no-repeat;
		transition: background-image 0.15s;
	}
	.col-divider:hover {
		background-image: linear-gradient(#8b9cf7, #8b9cf7);
	}

	.doc-with-margin {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		overflow-y: auto;
		overflow-x: hidden;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		z-index: 2;
	}

	.content-panel {
		flex: 1;
		min-width: 0;
		padding: 1.25rem;
	}

	.content-panel.image-mode {
		padding: 0;
		overflow: hidden;
	}

	.document-text {
		flex: 1;
		min-width: 0;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: 'Courier New', 'Consolas', monospace;
		font-size: 0.85rem;
		line-height: 1.7;
		color: #d1d5db;
		cursor: text;
	}

	.document-text::selection {
		background: rgba(139, 156, 247, 0.35);
	}

	/* Resize handle between doc text and code margin.
	 * Sticky inside the shared scroll container so the line is visible
	 * across every scroll position; align-self:stretch sizes it to the
	 * visible viewport height of .doc-with-margin. */
	.margin-divider {
		width: 3px;
		flex-shrink: 0;
		cursor: col-resize;
		background: #2a2d3a;
		transition: background 0.15s;
		position: sticky;
		top: 0;
		align-self: stretch;
	}
	.margin-divider:hover { background: #8b9cf7; }

	/* Code margin column — flex-stretches to text height, scrolls together
	 * with the text inside .doc-with-margin (single shared scroll container). */
	.code-margin {
		flex-shrink: 0;
		position: relative;
		padding-left: 0.4rem;
	}
	.margin-label {
		position: absolute;
		left: 0.4rem;
		display: block;
		font-family: system-ui, sans-serif;
		font-size: 0.65rem;
		line-height: normal;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: calc(100% - 0.5rem);
		cursor: default;
		opacity: 0.8;
	}
	.margin-label:hover, .margin-label.margin-highlighted {
		opacity: 1;
		font-weight: 600;
	}
	/* Margin tooltip: shows full code + memo on hover */
	.margin-tooltip {
		display: none;
		position: fixed;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		font-size: 0.75rem;
		font-weight: 400;
		color: #d1d5db;
		white-space: normal;
		width: 240px;
		z-index: 200;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
		pointer-events: none;
		line-height: 1.5;
	}
	.margin-tooltip strong { color: #e1e4e8; display: block; margin-bottom: 0.2rem; }
	.margin-tooltip em { color: #8b9cf7; font-style: italic; }
	.mt-snippet { color: #6b7280; font-size: 0.7rem; }
	.margin-label:hover > .margin-tooltip[style*="left"] { display: block; }

	/* Coded text: background + underline, no layout shift */
	.coded-text {
		position: relative;
		border-radius: 2px;
		transition: filter 0.15s;
		cursor: default;
	}
	.coded-text.coded-highlighted {
		filter: brightness(1.4);
	}
	.code-tooltip {
		display: none;
		position: absolute;
		bottom: 100%; left: 0;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-family: system-ui, sans-serif;
		font-size: 0.7rem;
		color: #e1e4e8;
		white-space: nowrap;
		z-index: 10;
		pointer-events: none;
		box-shadow: 0 2px 8px rgba(0,0,0,0.4);
	}
	.coded-text:hover > .code-tooltip { display: block; }

	/* Namings-Column: vertikaler Stack aus AI-Coding-Run-Streifen (oben) und
	 * Namings-Panel (Hauptfläche, scrollt). Sitzt als ein Flex-Item neben
	 * doc-with-margin und passages-panel — gleicher Höhenstrang wie die
	 * anderen Spalten. */
	/* TOC-Spalte: Sequenz-Naming-Inhaltsverzeichnis links vom Dokument.
	 * Material-Ebene-Organisation (Session 33), getrennt von der rekonstruktiv-
	 * analytischen Namings-Liste rechts. */
	.toc-column {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		overflow: hidden;
		min-height: 0;
	}
	.toc-header {
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #2a2d3a;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.toc-header h3 {
		font-size: 0.8rem;
		color: #8b8fa3;
		margin: 0;
	}
	.toc-header .count {
		color: #6b7280;
		font-weight: 400;
	}
	.toc-hide {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.75rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
	}
	.toc-hide:hover { color: #a5b4fc; }
	/* Legende: benennt die beiden Zahlen, die sonst unerklärt am Eintrag stehen. */
	.toc-legend {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.2rem 0.6rem 0.25rem;
		border-bottom: 1px solid #21242f;
		font-size: 0.58rem;
		color: #5a6070;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}
	.tl-seq { flex-shrink: 0; min-width: 1.4rem; }
	.tl-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0; }
	.tl-meta { flex-shrink: 0; }
	.toc-rename {
		display: block;
		width: calc(100% - 1.2rem);
		margin: 0.2rem 0.6rem;
		background: #0f1117;
		border: 1px solid #8b9cf7;
		border-radius: 4px;
		padding: 0.25rem 0.35rem;
		color: #e1e4e8;
		font-family: inherit;
		font-size: 0.72rem;
	}
	.toc-rename:focus { outline: none; }
	.toc-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0;
	}
	.toc-entry {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		width: 100%;
		padding: 0.35rem 0.6rem;
		background: none;
		border: none;
		border-left: 2px solid transparent;
		color: #c9cdd5;
		font-family: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s, color 0.12s;
	}
	.toc-entry:hover {
		background: rgba(139, 156, 247, 0.08);
		color: #e1e4e8;
		border-left-color: rgba(139, 156, 247, 0.5);
	}
	.toc-entry.toc-active {
		background: rgba(139, 156, 247, 0.18);
		border-left-color: #8b9cf7;
		color: #e1e4e8;
	}
	.toc-seq {
		flex-shrink: 0;
		color: #6b7280;
		font-variant-numeric: tabular-nums;
		font-size: 0.65rem;
		min-width: 1.4rem;
	}
	/* Zwei Zeilen statt Ellipse: ein Sequenz-Titel ist ein Satzfragment und
	   auf 18 Zeichen abgeschnitten nicht lesbar. */
	.toc-label {
		flex: 1;
		min-width: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}
	.toc-meta {
		flex-shrink: 0;
		color: #6b7280;
		font-size: 0.6rem;
		font-variant-numeric: tabular-nums;
		padding-top: 0.1rem;
	}
	/* Kurzer Flash auf dem getroffenen Segment nach Klick. */
	.seq-flash {
		animation: seqFlash 2.2s ease-out;
	}
	@keyframes seqFlash {
		0%   { background-color: rgba(139, 156, 247, 0.35); }
		60%  { background-color: rgba(139, 156, 247, 0.18); }
		100% { background-color: transparent; }
	}

	.namings-column {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}

	/* Namings panel: permanent code overview — Hauptfläche der Namings-Column.
	 * Höhe wird vom Column-Container gesteuert (flex: 1 + min-height: 0). */
	.namings-panel {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		overflow: hidden;
		z-index: 1;
	}
	.namings-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0.25rem 0;
	}
	.panel-header {
		padding: 0.4rem 0.2rem;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.panel-header h3 {
		font-size: 0.8rem;
		color: #8b8fa3;
		margin: 0;
	}
	.scope-toggle {
		display: flex;
		align-items: center;
		gap: 0;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		overflow: hidden;
	}
	.scope-btn {
		flex: 1;
		background: none;
		border: none;
		padding: 0.15rem 0.3rem;
		font-size: 0.65rem;
		color: #6b7280;
		cursor: pointer;
		font-family: inherit;
	}
	.scope-btn:hover { color: #c9cdd5; }
	.scope-btn.active {
		background: rgba(139, 156, 247, 0.15);
		color: #a5b4fc;
	}
	/* Modus-Umschalter (Verankerungen ⇄ Ähnliche Stellen) — zwei gleichrangige
	   Zustände mit VERSCHIEDENEN Bezügen, deshalb verschiedene Farben:
	     Indigo  #8b9cf7 = Bezug ist ein Naming aus der Namings-Spalte
	     Türkis  #2dd4bf = Bezug ist die eigene Markierung im Transkript
	   Die Farbe trägt durch: Reiter → Bezugszeile → Karten → Untermenü. */
	.mode-toggle {
		display: flex;
		gap: 2px;
		background: #14161f;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 2px;
	}
	.mode-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 0.3rem 0.4rem;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.72rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.mode-btn:hover:not(.active) { color: #c9cdd5; }
	.mode-btn.active {
		color: #fff;
		font-weight: 600;
	}
	.mode-btn.mode-anchor.active {
		background: rgba(139, 156, 247, 0.22);
		box-shadow: inset 0 -2px 0 #8b9cf7;
	}
	.mode-btn.mode-similar.active {
		background: rgba(45, 212, 191, 0.2);
		box-shadow: inset 0 -2px 0 #2dd4bf;
	}
	.mode-count {
		font-size: 0.62rem;
		font-weight: 600;
		line-height: 1;
		padding: 0.1rem 0.32rem;
		border-radius: 999px;
		background: #252840;
		color: #c9cdd5;
	}
	.mode-btn.mode-anchor.active .mode-count { background: #8b9cf7; color: #0f1117; }
	.mode-btn.mode-similar.active .mode-count { background: #2dd4bf; color: #0f1117; }
	/* Bezugszeile: trägt die Farbe des aktiven Reiters, damit sichtbar ist,
	   worauf sich die Liste darunter bezieht. */
	.anchor-hint {
		font-size: 0.66rem;
		color: #8b8fa3;
		margin: 0 0.1rem;
		padding: 0.1rem 0 0.1rem 0.4rem;
		border-left: 2px solid #8b9cf7;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.anchor-hint.hint-similar { border-left-color: #2dd4bf; }
	/* Ähnliche-Stellen-Modus färbt die ganze Spalte ein: Untermenü (Scope +
	   Vergleich per LLM) und Trefferkarten gehören sichtbar zu diesem Bezug. */
	.passages-panel.panel-similar .comparison-section {
		border-left: 2px solid #2dd4bf;
		background: rgba(45, 212, 191, 0.04);
	}
	.passages-panel.panel-similar .annotation-card {
		border-left: 2px solid rgba(45, 212, 191, 0.55);
	}
	.passages-panel.panel-similar .similar-score {
		color: #2dd4bf;
	}
	.scope-right {
		display: flex;
		align-items: center;
		border-left: 1px solid #2a2d3a;
	}
	.scope-doc-pick {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.15rem 0.15rem;
		width: 1.4rem;
		appearance: none;
	}
	.scope-doc-pick:hover { color: #a5b4fc; }
	.scope-doc-pick:focus { outline: none; }
	.namings-sort {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.7rem;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		margin-left: auto;
		appearance: none;
		text-align: right;
	}
	.namings-sort:hover { color: #a5b4fc; }
	.namings-sort:focus { outline: none; color: #c9cdd5; }
	.similar-uncoded {
		color: #6b7280;
		font-style: italic;
	}
	.similar-score {
		color: #6b7280;
		font-size: 0.65rem;
		flex-shrink: 0;
		margin-left: auto;
	}
	.ann-doc-label {
		font-size: 0.62rem;
		color: #6b7280;
		padding: 0.1rem 0 0 1.1rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.panel-footer {
		flex-shrink: 0;
		border-top: 1px solid #2a2d3a;
		padding-top: 0.5rem;
	}

	/* Passages panel: permanent passage overview — flex item, height handled by parent */
	.passages-panel {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		overflow: hidden;
	}
	.passages-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0.4rem 0.5rem;
	}
	.phase-filter-row {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.2rem 0.6rem; border-bottom: 1px solid #2a2d3a;
	}
	.phase-filter-select {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.2rem 0.4rem; color: #c9cdd5; font-size: 0.75rem;
	}
	.phase-filter-select:focus { outline: none; border-color: #8b9cf7; }
	.passages-panel .panel-header,
	.annotations-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #2a2d3a;
		flex-shrink: 0;
	}
	.annotations-header h3 { margin: 0; font-size: 0.8rem; }
	.btn-close-ann {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0 0.2rem;
		line-height: 1;
	}
	.btn-close-ann:hover { color: #e1e4e8; }
	.ann-search {
		width: 100%;
		background: #0f1117;
		border: none;
		border-bottom: 1px solid #2a2d3a;
		padding: 0.35rem 0.6rem;
		color: #e1e4e8;
		font-size: 0.75rem;
		box-sizing: border-box;
		flex-shrink: 0;
	}
	.ann-search:focus { outline: none; border-bottom-color: #8b9cf7; }

	.section-icon { width: 16px; height: 16px; opacity: 0.5; }

	/* Selection / annotation section */
	.selection-section {
		background: #161822;
		border: 1px solid #8b9cf7;
		border-radius: 6px;
		padding: 0.4rem;
		flex-shrink: 0;
	}
	.selection-section.drop-target-active {
		outline: 2px dashed #8b9cf7;
		outline-offset: -2px;
		background: rgba(139, 156, 247, 0.08);
	}
	.selection-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.3rem;
	}
	.comparison-section {
		flex-shrink: 0;
		border-bottom: 1px solid #2a2d3a;
		padding: 0.3rem 0.4rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.section-header h3 {
		font-size: 0.85rem;
		color: #e1e4e8;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
	}

	.btn-cancel {
		font-size: 0.75rem;
		color: #6b7280;
		background: none;
		border: none;
		cursor: pointer;
	}
	.btn-cancel:hover { color: #e1e4e8; }

	.doc-stats {
		font-size: 0.75rem;
		color: #6b7280;
		padding: 0.3rem 0;
	}
	.stat-sep { margin: 0 0.3rem; }

	.doc-memo-inline {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.doc-memo-textarea {
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
	.doc-memo-textarea:focus { outline: none; border-color: #4ade80; }
	.btn-doc-memo-save {
		align-self: flex-end;
		padding: 0.3rem 0.6rem;
		background: rgba(76, 175, 80, 0.1);
		border: 1px solid #4ade80;
		border-radius: 4px;
		color: #4ade80;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.btn-doc-memo-save:hover { background: rgba(76, 175, 80, 0.2); }
	.btn-doc-memo-save:disabled { opacity: 0.4; cursor: default; }

	.reading-hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: #4b5563;
		padding-top: 0.25rem;
	}

	/* In-vivo coding */
	.invivo-form {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.5rem;
	}
	.code-filter-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.8rem;
		box-sizing: border-box;
	}
	.code-filter-input:focus { outline: none; border-color: #8b9cf7; }
	.btn-create-code {
		background: rgba(139, 156, 247, 0.1);
		border: 1px dashed #8b9cf7;
		border-radius: 4px;
		padding: 0.3rem 0.5rem;
		color: #8b9cf7;
		font-size: 0.78rem;
		cursor: pointer;
		text-align: left;
	}
	.btn-create-code:hover { background: rgba(139, 156, 247, 0.2); }
	.btn-create-code:disabled { opacity: 0.4; cursor: wait; }
	.invivo-create-row {
		display: flex; align-items: center; gap: 0.35rem;
	}
	.invivo-color {
		width: 26px; height: 26px; padding: 0; border: 1px solid #2a2d3a;
		border-radius: 4px; background: none; cursor: pointer; flex-shrink: 0;
	}
	.invivo-create-row .btn-create-code { flex: 1; }

	.selection-preview {
		font-size: 0.8rem;
		color: #9ca3af;
		font-style: italic;
		margin-bottom: 0.75rem;
		line-height: 1.4;
		max-height: 4.2em;
		overflow: hidden;
	}

	.naming-group { margin-bottom: 0.25rem; }
	.naming-group-label {
		display: block;
		font-size: 0.6rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.3rem 0 0.1rem;
	}
	.naming-row {
		border-bottom: 1px solid rgba(42, 45, 58, 0.5);
		user-select: none;
	}
	/* When a text selection is open, naming rows become drag-to-apply sources. */
	.naming-row.apply-mode,
	.naming-row.apply-mode .naming-main {
		cursor: grab;
	}
	.naming-row.apply-mode:active,
	.naming-row.apply-mode .naming-main:active {
		cursor: grabbing;
	}
	.naming-row.naming-selected {
		background: rgba(139, 156, 247, 0.12);
	}
	/* ai-eval: verworfener Cue in der Namings-Spalte. */
	.naming-row.naming-rejected .naming-label {
		color: #6b7280;
	}
	.naming-row.naming-rejected .color-dot {
		filter: grayscale(1);
		opacity: 0.5;
	}
	.naming-row.naming-selected .naming-label {
		color: #a5b4fc;
	}
	.naming-main {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0;
		cursor: default;
	}
	.naming-main:hover { background: rgba(139, 156, 247, 0.05); }
	.naming-label {
		flex: 1;
		font-size: 0.75rem;
		color: #c9cdd5;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.naming-action {
		background: none;
		border: none;
		color: #4b5563;
		font-size: 0.6rem;
		cursor: pointer;
		padding: 0 0.15rem;
		flex-shrink: 0;
		line-height: 1;
	}
	.naming-action:hover { color: #8b9cf7; }
	.naming-action.has-memos { color: #c77d1a; }
	.naming-detail {
		padding: 0.15rem 0 0.25rem 1.1rem;
		font-size: 0.7rem;
		color: #6b7280;
	}
	.naming-stat {
		display: block;
		font-size: 0.65rem;
		color: #4b5563;
		margin-bottom: 0.1rem;
	}
	/* Fixed tooltip for naming hover (outside overflow containers) */
	.naming-tooltip-fixed {
		position: fixed;
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
		font-size: 0.72rem;
		color: #d1d5db;
		white-space: nowrap;
		z-index: 200;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.naming-section-label {
		font-size: 0.58rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-top: 0.2rem;
	}
	.naming-stack-entry {
		font-size: 0.65rem;
		color: #9ca3af;
		line-height: 1.3;
	}
	.stack-ccs {
		color: #a5b4fc;
		font-size: 0.6rem;
		margin-right: 0.3rem;
	}
	.stack-inscription {
		color: #d1d5db;
	}
	.naming-memo {
		font-size: 0.68rem;
		color: #c77d1a;
		font-style: italic;
		margin-top: 0.1rem;
		line-height: 1.3;
	}

	.color-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.comment-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.4rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.8rem;
		box-sizing: border-box;
	}
	.comment-input:focus { outline: none; border-color: #8b9cf7; }

	/* (hint styles removed — replaced by .reading-mode) */

	.annotations-header h3 {
		font-size: 0.8rem;
		color: #8b8fa3;
		margin: 0;
	}

	.count { color: #6b7280; }
	.empty { font-size: 0.8rem; color: #6b7280; }

	.annotation-card {
		background: #1e2030;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.4rem;
		transition: border-color 0.15s;
		cursor: default;
	}

	.annotation-card.ann-highlighted {
		border-color: #8b9cf7;
	}

	/* ai-eval: verworfener Cue — steht noch da, trägt aber nicht mehr. */
	.annotation-card.ann-rejected .code-name,
	.annotation-card.ann-rejected .ann-text,
	.annotation-card.ann-rejected .ann-doc-label {
		color: #6b7280;
	}
	.annotation-card.ann-rejected .color-dot {
		filter: grayscale(1);
		opacity: 0.5;
	}
	.annotation-card.ann-hidden {
		border-style: dashed;
		opacity: 0.6;
	}
	.hidden-note {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.1rem 0;
		font-size: 0.72rem;
		color: #6b7280;
	}
	.btn-show-hidden {
		background: none;
		border: none;
		padding: 0;
		color: #8b9cf7;
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}

	.ann-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.code-name {
		font-size: 0.82rem;
		font-weight: 500;
		color: #e1e4e8;
		flex: 1;
	}

	.btn-remove {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0 0.2rem;
		line-height: 1;
	}
	.btn-remove:hover { color: #ef4444; }

	.ann-text {
		font-size: 0.78rem;
		color: #9ca3af;
		font-style: italic;
		margin-top: 0.25rem;
		line-height: 1.3;
	}

	.ann-comment {
		font-size: 0.75rem;
		color: #6b7280;
		margin-top: 0.2rem;
	}

	/* Expand button + expanded annotation */
	.btn-expand-ann {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0 0.2rem;
		margin-left: auto;
		flex-shrink: 0;
	}
	.btn-expand-ann:hover { color: #8b9cf7; }
	.btn-delete-ann {
		background: none;
		border: none;
		color: transparent;
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0 0.15rem;
		margin-left: auto;
		flex-shrink: 0;
		line-height: 1;
	}
	.annotation-card:hover .btn-delete-ann { color: #4b5563; }
	.btn-delete-ann:hover { color: #ef4444 !important; }
	.annotation-card { cursor: default; }
	.annotation-card.ann-expanded {
		border-color: #4b5563;
	}
	.ann-context {
		font-size: 0.72rem;
		line-height: 1.5;
		margin-top: 0.3rem;
		padding: 0.3rem;
		background: #0f1117;
		border-radius: 4px;
		color: #9ca3af;
		max-height: 55vh;
		overflow-y: auto;
	}
	.passage-memo-input {
		width: 100%;
		background: #0f1117;
		border: 1px solid #c77d1a;
		border-radius: 4px;
		padding: 0.3rem 0.4rem;
		color: #e1e4e8;
		font-size: 0.72rem;
		font-family: inherit;
		margin-top: 0.25rem;
		box-sizing: border-box;
	}
	.passage-memo-input:focus { outline: none; }
	.btn-add-memo {
		background: none;
		border: none;
		color: #4b5563;
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.15rem 0;
		margin-top: 0.1rem;
	}
	.btn-add-memo:hover { color: #c77d1a; }
	.ctx-before, .ctx-after { color: #9ca3af; }
	.ctx-passage { color: #e1e4e8; background: rgba(139, 156, 247, 0.12); border-radius: 2px; }

	.placeholder {
		text-align: center;
		color: #6b7280;
		padding: 3rem 0;
	}

	/* Drop target feedback */
	.document-text.drop-target-active {
		outline: 2px dashed #8b9cf7;
		outline-offset: -2px;
	}

	/* Selection highlight (persists after DOM re-render). Im Ähnliche-Stellen-
	   Modus türkis — dieselbe Farbe wie Reiter und Trefferkarten, damit die
	   markierte Stelle als deren Bezug erkennbar ist. */
	.selection-highlight {
		background: rgba(139, 156, 247, 0.25) !important;
	}
	.document-text.sel-similar .selection-highlight {
		background: rgba(45, 212, 191, 0.28) !important;
	}

	/* Small utility button */
	.btn-xs {
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.6rem;
		cursor: pointer;
		padding: 0 0.2rem;
		margin-left: 0.3rem;
	}
	.btn-xs:hover { color: #a5b4fc; }
</style>
