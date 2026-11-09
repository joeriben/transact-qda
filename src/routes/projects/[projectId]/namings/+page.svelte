<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';
	import NamingRow, { type NamingActions } from '$lib/components/NamingRow.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import FilterBar, { type FilterGroup, type Toggle } from '$lib/components/FilterBar.svelte';
	import { page } from '$app/stores';
	import { tick, onMount } from 'svelte';
	import { viewHref, scrollIntoViewStable } from '$lib/shared/rueckweg.js';
	import { memoText } from '$lib/shared/memoText.js';
	import { namingLabel, quoted } from '$lib/shared/namingLabel.js';
	import NamingMemoForm from '$lib/components/NamingMemoForm.svelte';
	import StackActs from '$lib/components/StackActs.svelte';
	import { focusSelect } from '$lib/canvas/dom.js';
	import ReferringNotes from '$lib/components/ReferringNotes.svelte';

	let { data } = $props();

	// ---- Types ----
	type NamingRow = {
		naming_id: string;
		inscription: string;
		current_inscription: string | null;
		designation: string | null;
		mode: string | null;
		directed_from: string | null;
		directed_to: string | null;
		source_inscription: string | null;
		target_inscription: string | null;
		valence: string | null;
		has_document_anchor: boolean;
		has_memo_link: boolean;
		properties: Record<string, any> | null;
		ai_persona?: string | null;
		appears_on_maps: { id: string; label: string }[] | null;
		created_at: string;
		seq: string;
		part_source_id?: string | null;
		part_target_id?: string | null;
	};

	type StackData = {
		inscriptions: any[];
		designations: any[];
		acts?: any[];
		memos: any[];
		/** Memos in anderen Stacks, die auf dieses Naming verweisen. */
		referringNotes?: any[];
		annotations?: any[];
		discussion?: any[];
		aiReasoning?: string | null;
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		/** Stille: die Namings, aus deren Muster sie folgt. */
		silencePattern?: { id: string; label: string }[];
		relationEnds?: { source: string; target: string; directed: boolean; current?: boolean } | null;
	};

	// ---- State ----
	let namings = $derived<NamingRow[]>(data.namings);
	let phases = $derived<any[]>(data.phases ?? []);
	// Schmales Fenster: Phasen-Leiste eingeklappt, die Liste behält ihre Breite.
	// null = nach Fensterbreite (CSS entscheidet, schon beim ersten Zeichnen:
	// vorher klappte das Panel nach dem Laden zu und die Zeilen sprangen unter
	// dem Mauszeiger weg, Testlauf 11); true/false = von Hand umgeschaltet.
	// Ändert sich die Fensterbreite, gilt wieder die Breite (Testlauf 09.11.:
	// nach dem Verkleinern verdeckte sie „merge" und „withdraw").
	let phasesCollapsed = $state<boolean | null>(null);
	onMount(() => {
		const narrow = window.matchMedia('(max-width: 1099px)');
		const onChange = () => (phasesCollapsed = null);
		narrow.addEventListener('change', onChange);
		return () => narrow.removeEventListener('change', onChange);
	});

	// Forscher-Namings: Die Forscherin ist selbst ein Naming dieses Projekts.
	const researcherIds = $derived(new Set<string>(data.researcherNamingIds ?? []));

	// Achsen der Positional Maps → Badge „X-axis"/„Y-axis" mit Kartenname.
	const axisByNaming = $derived.by(() => {
		const byId = new Map<string, { dims: Set<string>; maps: string[] }>();
		for (const a of data.axes ?? []) {
			const entry = byId.get(a.naming_id) ?? { dims: new Set<string>(), maps: [] };
			if (a.dimension) entry.dims.add(a.dimension);
			if (!entry.maps.includes(a.map_label)) entry.maps.push(a.map_label);
			byId.set(a.naming_id, entry);
		}
		const out = new Map<string, { text: string; title: string }>();
		for (const [id, e] of byId) {
			const dim = e.dims.size === 1 ? [...e.dims][0].toUpperCase() + '-' : '';
			out.set(id, {
				text: `${dim}axis`,
				title: `Axis of the positional map${e.maps.length > 1 ? 's' : ''} ${e.maps.map((m) => quoted(m)).join(', ')}`
			});
		}
		// Abwesende Positionen: dieselbe Kennzeichnung wie auf der Karte.
		const absentMaps = new Map<string, string[]>();
		for (const a of data.absentPositions ?? []) {
			const maps = absentMaps.get(a.naming_id) ?? [];
			if (!maps.includes(a.map_label)) maps.push(a.map_label);
			absentMaps.set(a.naming_id, maps);
		}
		for (const [id, maps] of absentMaps) {
			if (out.has(id)) continue;
			out.set(id, {
				text: 'absent position',
				title: `Absent position on the positional map${maps.length > 1 ? 's' : ''} ${maps.map((m) => quoted(m)).join(', ')}`
			});
		}
		return out;
	});
	let filterCCS = $state<'all' | 'cue' | 'characterization' | 'specification'>('all');
	let filterGrounding = $state<'all' | 'grounded' | 'memo' | 'ungrounded'>('all');
	let filterMode = $state<'all' | 'entity' | 'relation' | 'silence'>('all');
	let searchQuery = $state('');
	let hideCowork = $state(false);
	let hideAutonoma = $state(false);
	let hideWithdrawn = $state(true);

	// Phase state
	let selectedPhaseId = $state<string | null>(null);
	let phaseMembers = $state<any[]>([]);
	let phasePassages = $state<any[]>([]);
	let newPhaseName = $state('');
	let showPhaseForm = $state(false);
	let assigningToPhase = $state<string | null>(null);
	let loadingPhase = $state(false);

	let newNamingValue = $state('');
	let creatingNaming = $state(false);

	let editingId = $state<string | null>(null);
	let editingValue = $state('');

	// Valence editing (separate from inscription rename)
	let editingValenceId = $state<string | null>(null);
	let editingValenceValue = $state('');

	let stackId = $state<string | null>(null);
	let stackData = $state<StackData | null>(null);

	// Act-prompt state
	let actTarget = $state<string | null>(null);
	let actType = $state<'rename' | 'designate' | 'relate'>('rename');
	let actNewValue = $state('');
	let actMemo = $state('');
	let actLinkedIds = $state<string[]>([]);
	let showActLinks = $state(false);

	// Relate mode
	let relateSource = $state<string | null>(null);
	let relateTarget = $state<string | null>(null);

	// Merge mode: select survivor, then merged
	let mergeSurvivorId = $state<string | null>(null);

	// Zurückziehen/Wiederherstellen lokal sofort sichtbar; der Server hält das
	// Flag (properties.withdrawn) an allen Erscheinungen des Namings.
	let localWithdrawn = $state<Map<string, boolean>>(new Map());

	// 8-second persistence after any filter-mutating action so the user can
	// see the result of their click before the item leaves the filtered view.
	const RECENTLY_TOUCHED_MS = 8000;
	let recentlyTouched = $state<Set<string>>(new Set());

	// Solange der Zeiger über der Liste steht, verschwindet keine Zeile: sonst
	// rückte die nächste Zeile samt ihrem „withdraw" unter den Zeiger
	// (Testlauf 09.11.: Gefahr eines Fehlklicks). Sie geht, sobald er die Liste verlässt.
	let pointerInList = false;
	function markTouched(namingId: string) {
		const next = new Set(recentlyTouched);
		next.add(namingId);
		recentlyTouched = next;
		const release = () => {
			if (pointerInList) { setTimeout(release, 500); return; }
			const after = new Set(recentlyTouched);
			after.delete(namingId);
			recentlyTouched = after;
		};
		setTimeout(release, RECENTLY_TOUCHED_MS);
	}

	// Wer selbst einen anderen Filter wählt, will sehen, was er durchlässt: Die
	// eben bearbeiteten Zeilen halten dann nicht mehr fest (Testlauf 12: ein eben
	// wiederhergestelltes Naming stand unter „Doc anchor", ohne Dokument).
	let filterKey = '';
	$effect(() => {
		const key = [filterCCS, filterGrounding, filterMode, searchQuery, hideWithdrawn].join('|');
		if (filterKey && key !== filterKey && recentlyTouched.size > 0) recentlyTouched = new Set();
		filterKey = key;
	});

	// ---- Rückweg: ?focus=<namingId> schlägt die Liste bei einem Naming auf ----
	//
	// Der Fokus überlebt die Filter (siehe keepTouched unten) und läuft nicht ab.
	// Wer von einer Karte kommt, um ein Naming zu bearbeiten, darf es hier nicht
	// suchen müssen — und schon gar nicht feststellen, dass die zuletzt gesetzten
	// Filter es gar nicht durchlassen.
	const focusId = $derived($page.url.searchParams.get('focus'));
	let focusedOn: string | null = null;

	$effect(() => {
		const id = focusId;
		if (!id || focusedOn === id) return;
		if (!namings.some(n => n.naming_id === id)) return;
		focusedOn = id;
		// tick(), nicht requestAnimationFrame: in einem Hintergrund-Tab (Link mit
		// Mittelklick geöffnet) feuert rAF nicht, und der Sprung bliebe aus, bis
		// man hinsieht — dann aber ohne erneuten Anlass.
		tick().then(() => {
			const el = document.querySelector(`[data-naming-id="${id}"]`);
			if (el) scrollIntoViewStable(el);
		});
	});

	// Worauf ein Memo verweisen kann: die Namings dieses Projekts.
	const memoCandidates = $derived(
		(namings as NamingRow[]).map((n) => ({ id: n.naming_id, label: labelOf(n) }))
	);

	// ---- Helpers ----
	// Lesbarer Name; eine Relation ohne Inschrift heißt nach ihren Endpunkten.
	function labelOf(n: NamingRow | undefined): string {
		if (!n) return '?';
		return namingLabel(
			n.current_inscription || n.inscription,
			n.mode === 'relation'
				? {
					source: n.source_inscription,
					target: n.target_inscription,
					valence: n.valence,
					directed: !!(n.directed_from && n.directed_to)
				}
				: null
		);
	}

	function designationColor(d: string | null | undefined) {
		if (d === 'specification') return CCS_SPEC;
		if (d === 'characterization') return CCS_CHAR;
		return CCS_CUE;
	}

	function isWithdrawn(namingId: string, props: any): boolean {
		if (localWithdrawn.has(namingId)) return localWithdrawn.get(namingId)!;
		// Der Server entscheidet über alle Erscheinungen (is_withdrawn), nicht
		// über eine beliebige.
		const row = (namings as NamingRow[]).find((n) => n.naming_id === namingId) as { is_withdrawn?: boolean } | undefined;
		if (typeof row?.is_withdrawn === 'boolean') return row.is_withdrawn;
		return props?.withdrawn === true || props?.aiWithdrawn === true;
	}

	// ---- Escape key handler ----
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (assigningToPhase) { assigningToPhase = null; e.preventDefault(); return; }
			if (mergeSurvivorId) { cancelMerge(); e.preventDefault(); return; }
			if (actTarget) { cancelAct(); e.preventDefault(); return; }
			if (relateSource || relateTarget) { cancelRelate(); e.preventDefault(); return; }
			if (editingValenceId) { editingValenceId = null; e.preventDefault(); return; }
			if (editingId) { editingId = null; e.preventDefault(); return; }
			if (stackId) { stackId = null; stackData = null; e.preventDefault(); return; }
		}
	}

	// ---- Filtering ----
	const filtered = $derived.by(() => {
		let result = namings as NamingRow[];

		// Recently-touched items bypass all filters so the result of an action
		// stays visible for RECENTLY_TOUCHED_MS even if it no longer matches.
		// Das per ?focus= aufgeschlagene Naming ebenso — dauerhaft, nicht auf Zeit.
		const keepTouched = (n: NamingRow) =>
			recentlyTouched.has(n.naming_id) || n.naming_id === focusId;

		if (filterCCS !== 'all') {
			result = result.filter(n => keepTouched(n) || (n.designation || 'cue') === filterCCS);
		}
		if (filterGrounding === 'grounded') {
			result = result.filter(n => keepTouched(n) || n.has_document_anchor);
		} else if (filterGrounding === 'memo') {
			result = result.filter(n => keepTouched(n) || (n.has_memo_link && !n.has_document_anchor));
		} else if (filterGrounding === 'ungrounded') {
			result = result.filter(n => keepTouched(n) || (!n.has_document_anchor && !n.has_memo_link));
		}
		if (filterMode !== 'all') {
			result = result.filter(n => keepTouched(n) || (n.mode || 'entity') === filterMode);
		}
		if (hideCowork || hideAutonoma) {
			result = result.filter(n => {
				if (keepTouched(n)) return true;
				const persona = n.ai_persona ?? null;
				if (hideCowork && persona === 'cowork') return false;
				if (hideAutonoma && persona === 'autonoma') return false;
				// Legacy AI-created namings without persona tag: hide when either toggle is on
				// so the filter is not silently broken on older projects
				if (!persona && (hideCowork || hideAutonoma)) {
					const looksAi = n.properties?.aiSuggested
						|| (n.current_inscription || n.inscription).startsWith('AI:')
						|| n.source_inscription?.startsWith('AI:')
						|| n.target_inscription?.startsWith('AI:');
					if (looksAi) return false;
				}
				return true;
			});
		}
		if (hideWithdrawn) {
			// Was man hier eben zurückgezogen hat, bleibt ein paar Sekunden
			// ausgegraut mit „restore" stehen (keepTouched), wie nach jedem Akt,
			// der aus dem Filter fällt. Ein schon beim Laden zurückgezogenes, per
			// ?focus= aufgeschlagenes Naming bleibt sichtbar.
			result = result.filter(n => !isWithdrawn(n.naming_id, n.properties) || keepTouched(n));
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			// Eine Relation findet man auch über ihre Endpunkte und ihre Valenz —
			// so, wie sie in der Liste beschriftet ist.
			result = result.filter(n =>
				keepTouched(n) ||
				[
					n.current_inscription || n.inscription,
					...(n.mode === 'relation' ? [n.source_inscription, n.target_inscription, n.valence] : [])
				].some((t) => typeof t === 'string' && t.toLowerCase().includes(q))
			);
		}
		return result;
	});

	// Mode is a per-appearance collapse, not a naming category. Entities and
	// relations share one list; silences stay separate because absence is a
	// distinct analytical move (Barad) rather than a mode of the same gesture.
	const entitiesAndRelations = $derived(filtered.filter(n => n.mode !== 'silence'));
	const silences = $derived(filtered.filter(n => n.mode === 'silence'));
	// Abschnittszähler wie der Kopf: Zurückgezogenes gesondert.
	function sectionCount(rows: NamingRow[]) {
		const withdrawn = rows.filter(n => isWithdrawn(n.naming_id, n.properties)).length;
		return `${rows.length - withdrawn}${withdrawn > 0 ? ` + ${withdrawn} withdrawn` : ''}`;
	}

	// Zurückgezogenes zählt gesondert — wie im Kopf der Map und auf der Übersicht.
	const activeNamings = $derived((namings as NamingRow[]).filter(n => !isWithdrawn(n.naming_id, n.properties)));
	const counts = $derived({
		total: activeNamings.length,
		withdrawn: (namings as NamingRow[]).length - activeNamings.length,
		cue: activeNamings.filter(n => (n.designation || 'cue') === 'cue').length,
		char: activeNamings.filter(n => n.designation === 'characterization').length,
		spec: activeNamings.filter(n => n.designation === 'specification').length
	});

	// ---- API ----
	async function apiAction(action: string, params: Record<string, any> = {}) {
		const res = await fetch(`/api/projects/${data.projectId}/namings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...params })
		});
		const body = await res.json().catch(() => ({}));
		// Jede Ablehnung sagt etwas: ohne Text vom Server wenigstens, was nicht ging.
		if (!res.ok && !body?.error) body.error = `${action} did not go through (${res.status}).`;
		return body;
	}

	// Meldung in der Seite statt Browser-Dialog; bleibt, bis man sie schließt
	// oder die nächste Aktion gelingt.
	let actionError = $state<string | null>(null);
	// Bestätigung nach „technical error" auf der Detailseite (?hidden=naming).
	let hiddenNotice = $state(false);
	$effect(() => {
		if (new URL(window.location.href).searchParams.get('hidden')) hiddenNotice = true;
	});
	function showActionError(res: any): boolean {
		if (res?.error) {
			// Schon verbunden: kein Fehler — die vorhandene Relation öffnet sich.
			if (res.alreadyRelated && typeof res.id === 'string') {
				actionError = null;
				actionErrorOpen = null;
				showInfo(String(res.error).replace(/ Open that relation to rename or re-designate it\.$/, ' This is that relation: rename, re-designate or memo it here.'));
				void openExisting(res.id);
				return true;
			}
			actionError = String(res.error);
			actionErrorOpen = null;
			actionErrorOpenLabel = 'Open that relation';
			return true;
		}
		actionError = null;
		actionErrorOpen = null;
		return false;
	}
	let actionErrorOpen = $state<string | null>(null);
	let actionErrorOpenLabel = $state('Open that relation');
	// Kurze Bestätigung unten im Fenster (z. B. nach dem Zusammenführen).
	let infoNotice = $state<string | null>(null);
	let infoTimer: ReturnType<typeof setTimeout> | null = null;
	let infoUndo = $state<{ label: string; run: () => void } | null>(null);
	// Mit Rückgängig-Aktion bleibt die Meldung 15 s stehen, und solange der
	// Zeiger auf ihr liegt, läuft keine Zeit ab (Testlauf 10: nach 5 s war
	// „restore" weg).
	function armInfoTimer(ms: number) {
		if (infoTimer) clearTimeout(infoTimer);
		infoTimer = setTimeout(() => { infoNotice = null; infoUndo = null; }, ms);
	}
	function showInfo(text: string, undo: { label: string; run: () => void } | null = null) {
		infoNotice = text;
		infoUndo = undo;
		armInfoTimer(undo ? 15000 : 5000);
	}
	// Unter dem Zeiger hält die Meldung an, aber nicht unbegrenzt: erscheint sie
	// unter einem ruhenden Zeiger, stand sie sonst, bis man sie schloss
	// (Testlauf 13: Leisten verdeckten Zeilen).
	function holdInfo() {
		armInfoTimer(20000);
	}
	function releaseInfo() {
		if (infoNotice) armInfoTimer(infoUndo ? 6000 : 3000);
	}
	async function openExisting(id: string) {
		actionError = null;
		actionErrorOpen = null;
		markTouched(id);
		if (stackId !== id) await showStack(id);
		await tick();
		const el = document.querySelector(`[data-naming-id="${id}"]`);
		if (el) scrollIntoViewStable(el);
	}

	// ---- Create ----
	async function createNaming() {
		if (!newNamingValue.trim() || creatingNaming) return;
		// Gleicher Name (ohne Groß-/Kleinschreibung): wie auf der Map kein
		// zweites Naming, sondern der Weg zum vorhandenen — ein zweites
		// gleichen Namens spaltete seine Geschichte (Testlauf 09.11.).
		const wanted = newNamingValue.trim().toLocaleLowerCase();
		const same = namings.find(
			(n) => !researcherIds.has(n.naming_id) && (n.current_inscription || n.inscription || '').trim().toLocaleLowerCase() === wanted
		);
		if (same) {
			actionError = `“${labelOf(same)}” already exists in this project. Nothing was created.`;
			actionErrorOpen = same.naming_id;
			actionErrorOpenLabel = 'Open it';
			return;
		}
		creatingNaming = true;
		// Eine alte Duplikat-Meldung gilt nach erfolgreichem Anlegen nicht mehr
		// (Testlauf 11: sie blieb über 20 s stehen).
		actionError = null;
		actionErrorOpen = null;
		await apiAction('create', { inscription: newNamingValue.trim() });
		newNamingValue = '';
		creatingNaming = false;
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	// ---- Stack ----
	async function showStack(namingId: string) {
		if (stackId === namingId) { stackId = null; stackData = null; return; }
		stackId = namingId;
		stackData = await apiAction('getStack', { namingId });
	}

	// ---- Inline Rename ----
	function startRename(namingId: string, currentInscription: string) {
		editingId = namingId;
		editingValue = currentInscription;
	}

	function confirmRename() {
		if (!editingId || !editingValue.trim()) { editingId = null; return; }
		actTarget = editingId;
		actType = 'rename';
		actNewValue = editingValue.trim();
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		editingId = null;
	}

	// ---- Designation ----
	function startDesignation(namingId: string, designation: string) {
		actTarget = namingId;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
	}

	// ---- Valence ----
	function startValenceEdit(namingId: string, currentValence: string) {
		editingValenceId = namingId;
		editingValenceValue = currentValence;
	}

	async function confirmValence() {
		if (!editingValenceId) { editingValenceId = null; return; }
		await apiAction('setValence', { namingId: editingValenceId, valence: editingValenceValue.trim() });
		editingValenceId = null;
		editingValenceValue = '';
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	// ---- Relate ----
	function startRelate(namingId: string) {
		if (relateSource && relateSource !== namingId) {
			// Schon verbunden (dieselbe Richtung): gleich sagen, bevor Name und
			// Valenz getippt sind (Testlauf 09.11.: Eingaben gingen verloren).
			const taken = (namings as NamingRow[]).find((n) => n.part_source_id === relateSource && n.part_target_id === namingId);
			if (taken) {
				// Kein Fehler, sondern der Weg zur vorhandenen Relation — wie auf der
				// Map; „in dieser Richtung" nur, wenn sie gerichtet ist (Testlauf 13).
				const s = quoted(labelOf(findNaming(relateSource)));
				const t = quoted(labelOf(findNaming(namingId)));
				const directed = !!(taken.directed_from && taken.directed_to);
				relateSource = null;
				relateTarget = null;
				actionError = null;
				actionErrorOpen = null;
				showInfo(`${s} and ${t} are already related${directed ? ' in this direction' : ''}. This is that relation: rename, re-designate or memo it here.`);
				void openExisting(taken.naming_id);
				return;
			}
			// Second click: stage target for confirmation
			relateTarget = namingId;
		} else if (relateSource === namingId) {
			// Clicked same naming again: cancel
			relateSource = null;
			relateTarget = null;
		} else {
			relateSource = namingId;
			relateTarget = null;
			// Eine alte Meldung lag sonst unter der Relate-Leiste (beide unten).
			actionError = null;
			actionErrorOpen = null;
		}
	}

	async function confirmRelate() {
		if (!relateSource || !relateTarget) return;
		const srcId = relateSource;
		const tgtId = relateTarget;
		const said = `Related ${quoted(labelOf(findNaming(srcId)))} ${relDirected ? '→' : '↔'} ${quoted(labelOf(findNaming(tgtId)))}${relName.trim() ? ` as ${quoted(relName.trim())}` : ''} — the relation is now in this list.`;
		const result = await apiAction('relate', {
			sourceId: srcId,
			targetId: tgtId,
			...(relName.trim() ? { inscription: relName.trim() } : {}),
			...(relValence.trim() ? { valence: relValence.trim() } : {}),
			symmetric: !relDirected
		});
		relateSource = null;
		relateTarget = null;
		resetRelateFields();
		if (!showActionError(result)) {
			// Mark source and target so the user sees them flagged after the
			// relation is created. (The new relation naming itself is not
			// returned by the API; an active mode filter on it is unhandled.)
			markTouched(srcId);
			markTouched(tgtId);
			const module = await import('$app/navigation');
			await module.invalidateAll();
			showInfo(said);
		}
	}

	function cancelRelate() {
		relateSource = null;
		relateTarget = null;
		resetRelateFields();
	}

	// Wie auf der Karte: Name, Valenz, Richtung (Testlauf 09.11.).
	let relName = $state('');
	let relValence = $state('');
	let relDirected = $state(true);
	function resetRelateFields() {
		relName = '';
		relValence = '';
		relDirected = true;
	}

	// ---- Act-prompt actions ----
	async function submitAct() {
		if (!actTarget) return;
		const touchedId = actTarget;

		let res: any = null;
		if (actType === 'rename') {
			res = await apiAction('rename', {
				namingId: actTarget,
				inscription: actNewValue,
				memoText: actMemo,
				linkedNamingIds: actLinkedIds
			});
		} else if (actType === 'designate') {
			res = await apiAction('designate', {
				namingId: actTarget,
				designation: actNewValue,
				memoText: actMemo,
				linkedNamingIds: actLinkedIds
			});
		}
		showActionError(res);
		showLift(res);

		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		markTouched(touchedId);
		const module = await import('$app/navigation');
		module.invalidateAll();
		// Offener Stack desselben Namings zeigt den neuen Akt gleich.
		if (stackId === touchedId) stackData = await apiAction('getStack', { namingId: touchedId });
	}

	async function skipAct() {
		if (!actTarget) return;
		const touchedId = actTarget;

		let res: any = null;
		if (actType === 'rename') {
			res = await apiAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else if (actType === 'designate') {
			res = await apiAction('designate', { namingId: actTarget, designation: actNewValue });
		}
		showActionError(res);
		showLift(res);

		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		markTouched(touchedId);
		const module = await import('$app/navigation');
		module.invalidateAll();
		// Offener Stack desselben Namings zeigt den neuen Akt gleich.
		if (stackId === touchedId) stackData = await apiAction('getStack', { namingId: touchedId });
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
	}

	/** Hat das Umschreiben designiert (Notiz auf einem Cue, erster eigener Name
	 *  einer Relation), sagt die Liste es — sonst springt das Abzeichen stumm. */
	function showLift(res: any) {
		if (res?.liftedTo) showInfo(`“${res.inscription}” is now a ${res.liftedTo}.`);
	}

	/** Escape im Akt-Dialog: verwerfen wie „cancel", aber nicht still. */
	function discardAct() {
		if (!actTarget) return;
		const what = actType === 'rename' ? `Rename to “${actNewValue}”` : actType === 'designate' ? `Designation as ${actNewValue}` : 'Change';
		cancelAct();
		showInfo(`${what} discarded — nothing changed.`);
	}

	// ---- Memo Status ----
	// Satz IV: ein KI-Memo gehört erst zu den Memos des Namings, wenn der
	// Mensch es hereinholt (promote); „ack" ist ein Verdikt — wie im Map-Stack.
	const isAiPending = (m: any) => m.isAiAuthored && m.status !== 'promoted';

	async function setMemoStatus(memoId: string, status: string) {
		const res = await fetch(`/api/projects/${data.projectId}/memos/${memoId}/status`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) showActionError({ error: body?.error || `Status not saved (${res.status})` });
		else if (status === 'promoted') {
			showInfo('Promoted: Cowork’s memo is now a naming of your own — in this list and unplaced on the situational map.');
			const module = await import('$app/navigation');
			await module.invalidateAll();
		}
		// Refresh the stack to show updated status
		if (stackId) {
			stackData = await apiAction('getStack', { namingId: stackId });
		}
	}

	// ---- Withdraw ----
	async function withdraw(namingId: string, currentlyWithdrawn = false) {
		// Zurückziehen ist kein Löschen: das Naming bleibt durchgestrichen stehen
		// und lässt sich wiederherstellen.
		const next = !currentlyWithdrawn;
		localWithdrawn = new Map(localWithdrawn).set(namingId, next);
		// Wie nach jedem Akt, der aus dem Filter fällt: ein paar Sekunden noch
		// ausgegraut mit „restore" sichtbar, dann greift „Hide withdrawn"
		// (Testlauf 8: es blieb stehen, bis man den Schalter neu betätigte).
		markTouched(namingId);
		const res = await apiAction('withdraw', { namingId, withdrawn: next });
		if (res?.error) {
			const back = new Map(localWithdrawn);
			back.delete(namingId);
			localWithdrawn = back;
			showActionError(res);
		} else {
			actionError = null;
			// Es bleibt ausgegraut mit „restore" stehen, statt unter dem Zeiger zu
			// verschwinden — das sagen, damit „Hide withdrawn" nicht kaputt wirkt.
			const label = labelOf(findNaming(namingId));
			if (next) showInfo(
				hideWithdrawn
					? `Withdrawn ${quoted(label)}. “Hide withdrawn” takes it out of the list in a moment. Nothing was deleted; it stays in its stack.`
					: `Withdrawn ${quoted(label)}. Nothing was deleted; it stays in its stack.`,
				{ label: 'restore', run: () => withdraw(namingId, true) }
			);
			else showInfo(`Restored ${quoted(label)}.`);
			// Ein offener Stack zeigt den neuen Akt gleich (Testlauf 09.11.).
			if (stackId === namingId) stackData = await apiAction('getStack', { namingId });
		}
	}

	// ---- Merge ----
	let mergeTargetId = $state<string | null>(null);

	function startMerge(survivorId: string) {
		if (researcherIds.has(survivorId)) return;
		mergeSurvivorId = survivorId;
		mergeTargetId = null;
		actionError = null;
		actionErrorOpen = null;
	}

	function selectMergeTarget(mergedId: string) {
		if (!mergeSurvivorId || mergedId === mergeSurvivorId) return;
		// Ein Forscher-Naming geht in keinem anderen auf.
		if (researcherIds.has(mergedId)) return;
		mergeTargetId = mergedId;
	}

	async function confirmMerge() {
		if (!mergeSurvivorId || !mergeTargetId) return;
		const survivorId = mergeSurvivorId;
		const mergedLabel = labelOf(namings.find((x) => x.naming_id === mergeTargetId));
		const survivorLabel = labelOf(namings.find((x) => x.naming_id === survivorId));
		const result = await apiAction('merge', { survivorId, mergedId: mergeTargetId });
		if (!showActionError(result)) {
			markTouched(survivorId);
			showInfo(`Merged “${mergedLabel}” into “${survivorLabel}”. The merge is an act in its stack, with the stack of “${mergedLabel}” under it; nothing was deleted.`);
		}
		mergeSurvivorId = null;
		mergeTargetId = null;
		const module = await import('$app/navigation');
		await module.invalidateAll();
	}

	function cancelMerge() {
		mergeSurvivorId = null;
		mergeTargetId = null;
	}

	// ---- Phase API ----
	async function phaseAction(action: string, params: Record<string, any> = {}) {
		const res = await fetch(`/api/projects/${data.projectId}/phases`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...params })
		});
		return res.json();
	}

	async function createPhase() {
		if (!newPhaseName.trim()) return;
		await phaseAction('create', { inscription: newPhaseName.trim() });
		newPhaseName = '';
		showPhaseForm = false;
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	async function selectPhase(phaseId: string) {
		if (selectedPhaseId === phaseId) {
			selectedPhaseId = null;
			phaseMembers = [];
			phasePassages = [];
			return;
		}
		selectedPhaseId = phaseId;
		loadingPhase = true;
		const [membersRes, passagesRes] = await Promise.all([
			phaseAction('getMembers', { phaseId }),
			phaseAction('getPassages', { phaseId })
		]);
		phaseMembers = membersRes.members || [];
		phasePassages = passagesRes.passages || [];
		loadingPhase = false;
	}

	async function assignNamingToPhase(namingId: string) {
		if (!assigningToPhase) return;
		await phaseAction('assign', { phaseId: assigningToPhase, namingId });
		// Refresh phase detail if viewing this phase
		if (selectedPhaseId === assigningToPhase) {
			await selectPhase(selectedPhaseId);
		}
		assigningToPhase = null;
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	async function removeNamingFromPhase(phaseId: string, namingId: string) {
		await phaseAction('remove', { phaseId, namingId });
		if (selectedPhaseId === phaseId) {
			await selectPhase(phaseId);
		}
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	function findNaming(id: string): NamingRow | undefined {
		return (namings as NamingRow[]).find(n => n.naming_id === id);
	}

	const filterGroups: FilterGroup[] = $derived([
		{
			key: 'ccs',
			label: 'CCS',
			value: filterCCS,
			options: [
				{ value: 'all', label: 'All' },
				{ value: 'cue', label: 'Cue', dotColor: CCS_CUE },
				{ value: 'characterization', label: 'Char', dotColor: CCS_CHAR },
				{ value: 'specification', label: 'Spec', dotColor: CCS_SPEC }
			],
			onchange: (v: string) => filterCCS = v as typeof filterCCS
		},
		{
			key: 'grounding',
			label: 'Grounding',
			// Nur ein Dokumentanker erdet, ein Memo ist Reflexion: Formel des
			// Assistenten in S08 („Grounding = document anchor. Period."), von BJ
			// mit „document first, then refactor" übernommen.
			title: 'Grounding is a document anchor. A memo is reflection, not grounding.',
			value: filterGrounding,
			options: [
				{ value: 'all', label: 'All' },
				{ value: 'grounded', label: 'Doc anchor', icon: '/icons/text_snippet.svg', title: 'Grounded: anchored in a document passage' },
				{ value: 'memo', label: 'Memo, no anchor', icon: '/icons/stylus_note.svg', title: 'Not grounded, but reflected: a memo of yours is on it or refers to it (Cowork memos once promoted). No document anchor.' },
				{ value: 'ungrounded', label: 'No anchor', icon: '/icons/question_mark.svg', title: 'Not grounded: no document anchor, and no memo on it or referring to it' }
			],
			onchange: (v: string) => filterGrounding = v as typeof filterGrounding
		},
		{
			key: 'mode',
			label: 'Mode',
			value: filterMode,
			options: [
				{ value: 'all', label: 'All' },
				{ value: 'entity', label: 'Entity' },
				{ value: 'relation', label: 'Relation' },
				{ value: 'silence', label: 'Silence' }
			],
			onchange: (v: string) => filterMode = v as typeof filterMode
		}
	]);

	// Autonoma ist seit 04.08.2026 deprecated: der Schalter nur, wo es noch
	// Namings aus ihren Läufen gibt.
	const hasAutonomaNamings = $derived((namings as NamingRow[]).some(n => n.ai_persona === 'autonoma'));

	const filterToggles: Toggle[] = $derived([
		{ label: 'Hide withdrawn', value: hideWithdrawn, onchange: (v: boolean) => { hideWithdrawn = v; } },
		{ label: 'Hide Cowork', value: hideCowork, onchange: (v: boolean) => hideCowork = v },
		...(hasAutonomaNamings || hideAutonoma
			? [{
				label: 'Hide Autonoma',
				value: hideAutonoma,
				onchange: (v: boolean) => hideAutonoma = v,
				title: 'Namings from earlier Autonoma runs (Autonoma is deprecated since August 2026)'
			}]
			: [])
	]);

	// Adapter that routes NamingRow callbacks to page-level functions/state.
	// Closures here read the latest reactive values via lexical binding.
	const namingsActions: NamingActions = {
		findInscription: (id: string | null) => (id ? labelOf(findNaming(id)) : '?'),
		isWithdrawn: (id: string, props: any) => isWithdrawn(id, props),
		onShowStack: (id: string) => showStack(id),
		onChangeDesignation: (id: string, d: string) => startDesignation(id, d),
		onStartRename: (id: string, current: string) => startRename(id, current),
		onStartValenceEdit: (id: string, current: string) => startValenceEdit(id, current),
		onSubmitInlineEdit: (id: string, kind: 'rename' | 'valence', value: string) => {
			if (kind === 'rename') {
				editingValue = value;
				confirmRename();
			} else {
				editingValenceValue = value;
				confirmValence();
			}
		},
		onCancelInlineEdit: () => {
			editingId = null;
			editingValenceId = null;
		},
		onWithdraw: (id: string, currentlyWithdrawn: boolean) => withdraw(id, currentlyWithdrawn),
		onStartRelate: (id: string) => startRelate(id),
		onMerge: (id: string) => startMerge(id),
		onCardClick: (id: string) => {
			if (assigningToPhase) { assignNamingToPhase(id); return; }
			if (mergeSurvivorId && mergeSurvivorId !== id) { selectMergeTarget(id); return; }
			if (relateSource && !relateTarget && relateSource !== id) { startRelate(id); return; }
		}
	};
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="namings-layout">
<div class="namings-page">
	<PageHeader title="Namings">
		{#snippet summary()}
			{counts.total} total
			{#if counts.withdrawn > 0}<span class="sep">+</span> {counts.withdrawn} withdrawn{/if}
			<span class="sep">|</span>
			<span style="color: var(--ccs-cue)">{counts.cue} cue</span>
			<span class="sep">/</span>
			<span style="color: var(--ccs-char)">{counts.char} char</span>
			<span class="sep">/</span>
			<span style="color: var(--ccs-spec)">{counts.spec} spec</span>
		{/snippet}
		{#snippet actions()}
			<form class="create-form" onsubmit={e => { e.preventDefault(); createNaming(); }}>
				<input
					type="text"
					class="create-input"
					placeholder="New naming..."
					bind:value={newNamingValue}
					disabled={creatingNaming}
				/>
			</form>
		{/snippet}
		{#snippet filterBar()}
			<FilterBar groups={filterGroups} toggles={filterToggles} bind:search={searchQuery} searchPlaceholder="Search..." />
		{/snippet}
		{#snippet afterHeader()}
			{#if hiddenNotice}
				<div class="hidden-notice" role="status">
					<span>The naming is hidden as a technical error. Nothing was deleted: it stays in the database, with this act on record.</span>
					<button class="btn-xs" onclick={() => (hiddenNotice = false)} aria-label="Dismiss message">×</button>
				</div>
			{/if}
			{#if infoNotice}
				<div class="action-info" role="status" onpointerenter={holdInfo} onpointerleave={releaseInfo} onfocusin={holdInfo} onfocusout={releaseInfo}>
					<span>{infoNotice}</span>
					{#if infoUndo}
						<!-- Die Rückgängig-Aktion vor dem Schließen festhalten: {@const}
						     folgte infoUndo und war danach null (Testlauf 9). -->
						<button class="btn-xs" onclick={() => { const run = infoUndo?.run; infoNotice = null; infoUndo = null; run?.(); }}>{infoUndo.label}</button>
					{/if}
					<button class="btn-xs" onclick={() => { infoNotice = null; infoUndo = null; }} aria-label="Dismiss message">×</button>
				</div>
			{/if}
			{#if actionError}
				<div class="action-error" role="alert">
					<span>{actionError}</span>
					{#if actionErrorOpen}
						{@const openId = actionErrorOpen}
						<button class="btn-xs" onclick={() => openExisting(openId)}>{actionErrorOpenLabel}</button>
					{/if}
					<button class="btn-xs" onclick={() => { actionError = null; actionErrorOpen = null; }} aria-label="Dismiss message">×</button>
				</div>
			{/if}
			<!-- Relate mode indicator -->
			{#if relateSource}
				<div class="relate-banner">
					{#if relateTarget}
						{@const relDesig = relName.trim() && relValence.trim() ? 'specification' : relName.trim() ? 'characterization' : 'cue'}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<form class="relate-form" onsubmit={(e) => { e.preventDefault(); confirmRelate(); }}
							onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelRelate(); } }}>
							<span>Relate <strong>{labelOf(findNaming(relateSource))}</strong> {relDirected ? '→' : '↔'} <strong>{labelOf(findNaming(relateTarget))}</strong></span>
							<!-- svelte-ignore a11y_autofocus -->
							<input type="text" class="relate-input" placeholder="Valence (e.g. enables)" aria-label="Valence" bind:value={relValence} autofocus />
							<input type="text" class="relate-input" placeholder="Name (optional)" aria-label="Name (optional)" bind:value={relName} />
							<label class="relate-dir"><input type="checkbox" bind:checked={relDirected} /> directed</label>
							<button type="submit" class="btn-xs btn-confirm">relate</button>
							<button type="button" class="btn-xs" onclick={cancelRelate}>cancel</button>
							<span class="relate-effect">Saved as {relDesig}{relDesig === 'cue' ? ' (a name makes it a characterization, name and valence a specification)' : ''}; related cues rise to characterization.</span>
						</form>
					{:else}
						Relating: <strong>{labelOf(findNaming(relateSource))}</strong> — click another naming to connect
						<button class="btn-xs" onclick={cancelRelate}>cancel</button>
					{/if}
				</div>
			{/if}

			<!-- Merge mode indicator -->
			{#if mergeSurvivorId}
				{@const survLabel = quoted(labelOf(findNaming(mergeSurvivorId)))}
				<div class="relate-banner merge-banner">
					{#if mergeTargetId}
						<span class="banner-text">Merge <strong>{quoted(labelOf(findNaming(mergeTargetId)))}</strong> into <strong>{survLabel}</strong>?
						Its relations, map placements and passages go to {survLabel}; its stack, memos included, stays readable
						in the stack of {survLabel}. If it brings a memo, a cue {survLabel} becomes a characterization.</span>
						<button class="btn-xs btn-confirm" onclick={confirmMerge}>merge</button>
						<button class="btn-xs" onclick={cancelMerge}>cancel</button>
					{:else}
						Merge into <strong>{survLabel}</strong> — click the naming to absorb
						<button class="btn-xs" onclick={cancelMerge}>cancel</button>
					{/if}
				</div>
			{/if}


			<!-- Act-prompt bar -->
			{#if actTarget}
				{@const targetLabel = labelOf(findNaming(actTarget))}
				{@const allOtherNamings = (namings as NamingRow[]).filter(n => n.naming_id !== actTarget && n.mode !== 'relation')}
				<div class="act-prompt-bar">
					<div class="act-header">
						{#if actType === 'rename'}
							<!-- Anführungszeichen statt eines zweiten Pfeils: der Name einer
				     Relation trägt selbst schon einen (Testlauf 12). -->
				Rename <strong>{quoted(targetLabel)}</strong> to <strong>{quoted(actNewValue)}</strong>
						{:else if actType === 'designate'}
							Designation: <strong>{targetLabel}</strong> →
							<span style="color: {designationColor(actNewValue)}">{actNewValue}</span>
						{/if}
					</div>
					<!-- Fokus ins Feld wie auf der Map: sonst geht eine getippte
					     Begründung ins Leere (Testlauf 09.11.). Esc verwirft wie
					     „cancel" und sagt es (verwarf früher still); Strg/⌘+Enter
					     übernimmt mit Memo. -->
					<textarea
						placeholder="What influenced this act? What changed in your understanding?"
						aria-label="Memo on this act"
						bind:value={actMemo}
						rows="2"
						use:focusSelect
						onkeydown={(e) => {
							if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); discardAct(); }
							else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (actMemo.trim()) void submitAct(); }
						}}
					></textarea>
					{#if showActLinks}
						<div class="act-links">
							{#each allOtherNamings as n (n.naming_id)}
								<label class="act-link-item">
									<input
										type="checkbox"
										checked={actLinkedIds.includes(n.naming_id)}
										onchange={() => {
											if (actLinkedIds.includes(n.naming_id)) {
												actLinkedIds = actLinkedIds.filter(id => id !== n.naming_id);
											} else {
												actLinkedIds = [...actLinkedIds, n.naming_id];
											}
										}}
									/>
									{n.current_inscription || n.inscription}
								</label>
							{/each}
						</div>
					{/if}
					<div class="act-bottom">
						<!-- Dieselbe Beschriftung wie im Akt-Dialog der Map (Session 05:
						     „Namings I have in mind writing this memo"). -->
						<button class="btn-link-toggle" onclick={() => showActLinks = !showActLinks} aria-expanded={showActLinks}>
							<span aria-hidden="true">{showActLinks ? '▾' : '▸'}</span> namings I have in mind ({actLinkedIds.length})
						</button>
						<div class="act-actions">
							<button class="btn-primary btn-sm-primary" onclick={submitAct} disabled={!actMemo.trim()}
								title={actMemo.trim() ? 'Apply with this memo (Ctrl/⌘+Enter)' : 'Write a memo first — or apply without one'}>Apply + memo</button>
							<button class="btn-link" onclick={skipAct} title="Apply without a memo">skip memo</button>
							<button class="btn-link" onclick={cancelAct} title="Discard this {actType === 'rename' ? 'rename' : 'designation'} (Esc)">cancel</button>
						</div>
					</div>
				</div>
			{/if}
		{/snippet}
	</PageHeader>

	<!-- Page-level snippets reused by both Namings and Silences sections. -->
	{#snippet mapLinksFor(n: NamingRow)}
		{#if n.appears_on_maps && n.appears_on_maps.length > 0}
			<div class="map-links">
				{#each n.appears_on_maps as m (m.id)}
					<!-- ?focus= führt auf die Karte UND auf die Stelle darauf; ohne das
					     landet man vor der ganzen Karte und sucht sein Naming. -->
					<a
						href={viewHref(`/projects/${data.projectId}/maps/${m.id}`, {
							focus: n.naming_id,
							from: `/projects/${data.projectId}/namings`
						})}
						class="map-link"
					>{m.label}</a>
				{/each}
			</div>
		{/if}
	{/snippet}

	{#snippet stackPanelFor(n: NamingRow, includeMemos: boolean)}
		{#if stackId === n.naming_id && stackData}
			{@const dataMemos = (stackData.memos ?? []).filter((m: any) => !isAiPending(m))}
			{@const aiPendingMemos = (stackData.memos ?? []).filter(isAiPending)}
			<div class="stack-panel">
				<div class="stack-section">
					<h4>Stack</h4>
					{#if (stackData.silencePattern ?? []).length > 0}
						<!-- Stille = Participations ohne Appearances: aus welchem Muster sie folgt. -->
						<div class="silence-pattern">
							Absent from the pattern of:
							{#each stackData.silencePattern as p (p.id)}
								<button class="sp-chip" onclick={() => showStack(p.id)} title="Open its stack">{p.label}</button>
							{/each}
						</div>
					{/if}
					{#if stackData.relationEnds?.current}
						<div class="rel-ends">Relation: {stackData.relationEnds.source} {stackData.relationEnds.directed ? '→' : '↔'} {stackData.relationEnds.target}</div>
					{/if}
					<StackActs acts={stackData.acts ?? []} ends={stackData.relationEnds ?? null} onlinked={(id) => showStack(id)} />
					<NamingMemoForm projectId={data.projectId} namingId={n.naming_id}
						candidates={memoCandidates}
						oncreated={async () => {
							stackData = await apiAction('getStack', { namingId: n.naming_id });
							markTouched(n.naming_id);
							const module = await import('$app/navigation');
							module.invalidateAll();
						}} />
				</div>
				{#if includeMemos && dataMemos.length + (stackData.referringNotes?.length ?? 0) > 0}
					<div class="stack-section">
						<!-- Memos in anderen Stacks und Memo-Namings, die auf dieses Naming
						     verweisen (analytische Memos, ältere Memos); das Memo ZU diesem
						     Naming steht im Stack. -->
						<h4>Memos referring to this</h4>
						<ReferringNotes notes={stackData.referringNotes ?? []} onopen={(id) => showStack(id)} />
						{#each dataMemos as memo}
							{@render memoEntry(memo)}
						{/each}
					</div>
				{/if}
				{#if includeMemos && aiPendingMemos.length > 0}
					<div class="stack-section">
						<!-- Satz IV: KI-Hinweise stehen außerhalb des Datenraums, bis der
						     Mensch sie hereinholt; deshalb nicht unter den Memos dieses Namings. -->
						<h4>From Cowork</h4>
						<p class="ai-outside-hint">Cowork’s notes stay outside your data — judging them (ack, dismiss) does not make them memos of this naming.</p>
						{#each aiPendingMemos as memo}
							{@render memoEntry(memo)}
						{/each}
					</div>
				{/if}
				{#snippet memoEntry(memo: any)}
							<div class="memo-entry" class:memo-dismissed={memo.status === 'dismissed'}>
								<div class="memo-entry-header">
									<span class="memo-author-badge" class:badge-ai={memo.isAiAuthored}>
										{memo.isAiAuthored ? 'AI' : 'R'}
									</span>
									{#if memo.status && memo.status !== 'active'}
										<span class="memo-status-badge status-{memo.status}">{memo.status}</span>
									{/if}
									<span class="memo-label">{memo.label}</span>
								</div>
								<div class="memo-content">{memoText(memo.content)}</div>
								<div class="memo-entry-actions">
									<!-- ack/dismiss: Lebenszyklus eines KI-Hinweises, nicht eigener Memos -->
									{#if memo.isAiAuthored}
										{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
											<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'dismissed')}>dismiss</button>
											<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'acknowledged')}>ack</button>
											<button class="btn-xs btn-promote" onclick={() => setMemoStatus(memo.id, 'promoted')}>promote</button>
										{/if}
										{#if memo.status === 'acknowledged'}
											<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'dismissed')}>dismiss</button>
											<button class="btn-xs btn-promote" onclick={() => setMemoStatus(memo.id, 'promoted')} title="Acknowledged is not taken in — promote takes it in">promote</button>
										{/if}
										{#if memo.status === 'dismissed'}
											<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'presented')}>restore</button>
										{/if}
									{:else if memo.status === 'dismissed'}
										<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'active')}>restore</button>
									{/if}
									<a class="btn-xs" href="/projects/{data.projectId}/memos/{memo.id}">{memo.isAiAuthored ? 'open' : 'edit'}</a>
								</div>
							</div>
				{/snippet}
				{#if (stackData.annotations ?? []).length > 0}
					{@const annots = stackData.annotations ?? []}
					<div class="stack-section">
						<h4>Material ({annots.length})</h4>
						{#each Object.entries(annots.reduce((groups: Record<string, any>, a: any) => {
							const key = a.document_id;
							if (!groups[key]) groups[key] = { docLabel: a.document_label, docId: a.document_id, items: [] };
							groups[key].items.push(a);
							return groups;
						}, {})) as [docId, group]}
							{@const g = group as any}
							<div class="material-group">
								<a class="material-doc-link" href="/projects/{data.projectId}/documents/{g.docId}">{g.docLabel}</a>
								{#each g.items as p}
									<div class="material-passage">{p.properties?.anchor?.text || '(no text)'}</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
				{#if includeMemos && stackData.discussion && stackData.discussion.length > 0}
					<div class="stack-section">
						<h4>AI Discussion</h4>
						{#each stackData.discussion as msg}
							<div class="discussion-msg" class:ai={msg.role === 'ai'}>
								<span class="msg-role">{msg.role}</span>
								<span class="msg-content">{msg.content}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}

	<!-- Namings (entities + relations as a single flat list; mode is a
	     per-appearance collapse, not a naming category). -->
	{#if entitiesAndRelations.length > 0}
		<div class="section">
			<h2 class="section-label">Namings <span class="section-count">{sectionCount(entitiesAndRelations)}</span></h2>
			<!-- svelte-ignore a11y_no_static_element_interactions (nur: steht der Zeiger über der Liste?) -->
			<div class="naming-list" onpointerenter={() => { pointerInList = true; }} onpointerleave={() => { pointerInList = false; }}>
				{#each entitiesAndRelations as n (n.naming_id)}
					<div data-naming-id={n.naming_id} class:focused={focusId === n.naming_id}>
						<NamingRow
							item={n}
							density="rich"
							isEditing={editingId === n.naming_id}
							bind:editingValue
							isEditingValence={editingValenceId === n.naming_id}
							bind:editingValenceValue
							relatingFrom={relateSource}
							relatingTo={relateTarget}
							{assigningToPhase}
							{mergeSurvivorId}
							recentlyTouched={recentlyTouched.has(n.naming_id)}
							detailHref={viewHref(`/projects/${data.projectId}/namings/${n.naming_id}`, {
								focus: n.naming_id,
								from: $page.url.searchParams.get("from")
							})}
							isResearcher={researcherIds.has(n.naming_id)}
							axis={axisByNaming.get(n.naming_id) ?? null}
							actions={namingsActions}
						>
							{#snippet after()}
								{@render mapLinksFor(n)}
								{@render stackPanelFor(n, true)}
							{/snippet}
						</NamingRow>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Silences -->
	{#if silences.length > 0}
		<div class="section">
			<h2 class="section-label">Silences <span class="section-count">{sectionCount(silences)}</span></h2>
			<!-- svelte-ignore a11y_no_static_element_interactions (nur: steht der Zeiger über der Liste?) -->
			<div class="naming-list" onpointerenter={() => { pointerInList = true; }} onpointerleave={() => { pointerInList = false; }}>
				{#each silences as n (n.naming_id)}
					<div data-naming-id={n.naming_id} class:focused={focusId === n.naming_id}>
						<NamingRow
							item={n}
							density="rich"
							isEditing={editingId === n.naming_id}
							bind:editingValue
							recentlyTouched={recentlyTouched.has(n.naming_id)}
							detailHref={viewHref(`/projects/${data.projectId}/namings/${n.naming_id}`, {
								focus: n.naming_id,
								from: $page.url.searchParams.get("from")
							})}
							actions={namingsActions}
						>
							{#snippet after()}
								{@render mapLinksFor(n)}
								{@render stackPanelFor(n, false)}
							{/snippet}
						</NamingRow>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if filtered.length === 0}
		<p class="empty">No namings match your filters.</p>
	{/if}
</div>

<!-- Phase Panel (right sidebar). Bei schmalem Fenster eingeklappt zu einem
     Reiter wie auf der Map; sonst nahm es die halbe Breite (Testlauf 09.11.). -->
{#if phasesCollapsed !== false}
<button class="phase-tab" class:auto={phasesCollapsed === null} onclick={() => (phasesCollapsed = false)} title="Show phases" aria-expanded="false">
	<span>Phases ({phases.length})</span>
</button>
{/if}
{#if phasesCollapsed !== true}
<div class="phase-panel" class:auto={phasesCollapsed === null}>
	<div class="phase-panel-header">
		<h3>Phases</h3>
		<span class="phase-head-actions">
			<button class="btn-xs" onclick={() => showPhaseForm = !showPhaseForm} title={showPhaseForm ? 'Close' : 'New phase'}>
				{showPhaseForm ? '×' : '+'}
			</button>
			<button class="btn-xs" onclick={() => (phasesCollapsed = true)} title="Hide phases" aria-expanded="true">›</button>
		</span>
	</div>

	{#if showPhaseForm}
		<form class="phase-create-form" onsubmit={e => { e.preventDefault(); createPhase(); }}>
			<input type="text" placeholder="Phase name..." bind:value={newPhaseName} />
			<button type="submit" class="btn-xs">Create</button>
		</form>
	{/if}

	{#if phases.length === 0}
		<p class="phase-empty">No phases yet.</p>
	{:else}
		{#each phases as phase}
			<div
				class="phase-item"
				class:phase-selected={selectedPhaseId === phase.id}
				class:phase-assigning={assigningToPhase === phase.id}
			>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="phase-item-header" onclick={() => selectPhase(phase.id)}>
					<span class="phase-item-label">{phase.label}</span>
					<span class="phase-item-count">{phase.member_count}</span>
				</div>
				<button
					class="btn-xs"
					onclick={() => assigningToPhase = assigningToPhase === phase.id ? null : phase.id}
				>
					{assigningToPhase === phase.id ? 'done' : 'assign'}
				</button>
			</div>
		{/each}
	{/if}

	{#if assigningToPhase}
		<div class="phase-assign-hint">Click a naming to assign it to this phase.</div>
	{/if}

	<!-- Phase detail: members + passages -->
	{#if selectedPhaseId && !loadingPhase}
		<div class="phase-detail">
			<h4>Members</h4>
			{#if phaseMembers.length === 0}
				<p class="phase-empty">No members yet.</p>
			{:else}
				{#each phaseMembers as member}
					{@const memberNaming = findNaming(member.naming_id)}
					<div class="phase-member">
						<span class="designation-dot" style="background: {designationColor(member.designation)}"></span>
						<span class="phase-member-label">{memberNaming ? labelOf(memberNaming) : member.inscription}</span>
						<button class="btn-xs btn-remove" onclick={() => removeNamingFromPhase(selectedPhaseId!, member.naming_id)}>×</button>
					</div>
				{/each}
			{/if}

			{#if phasePassages.length > 0}
				<h4>Passages ({phasePassages.length})</h4>
				{@const passagesByNaming = phasePassages.reduce((groups: Record<string, any>, p: any) => {
					const key = p.naming_id;
					if (!groups[key]) groups[key] = { label: p.naming_label, docGroups: {} };
					const docKey = p.document_id;
					if (!groups[key].docGroups[docKey]) groups[key].docGroups[docKey] = { label: p.document_label, docId: p.document_id, items: [] };
					groups[key].docGroups[docKey].items.push(p);
					return groups;
				}, {})}
				{#each Object.entries(passagesByNaming) as [namingId, namingGroup]}
					{@const ng = namingGroup as any}
					<div class="passage-naming-group">
						<div class="passage-naming-header">{ng.label}</div>
						{#each Object.entries(ng.docGroups) as [docId, docGroup]}
							{@const dg = docGroup as any}
							<div class="passage-doc-group">
								<a class="passage-doc-link" href="/projects/{data.projectId}/documents/{dg.docId}">{dg.label}</a>
								{#each dg.items as p}
									<div class="passage-text">{p.properties?.anchor?.text || '(no text)'}</div>
								{/each}
							</div>
						{/each}
					</div>
				{/each}
			{/if}
		</div>
	{:else if loadingPhase}
		<p class="phase-empty">Loading...</p>
	{/if}
</div>
{/if}
</div><!-- .namings-layout -->

<style>
	.namings-layout {
		display: flex;
		height: 100%;
		overflow: hidden;
	}

	.namings-page {
		flex: 1;
		min-width: 0;
		max-width: 800px;
		padding-bottom: 2rem;
		overflow-y: auto;
		height: 100%;
		padding-right: 1rem;
	}

	/* Phase Panel */
	.phase-tab {
		flex-shrink: 0; width: 28px; height: 100%;
		background: #13151e; border: none; border-left: 1px solid #2a2d3a;
		color: #8b8fa3; cursor: pointer; padding: 0.75rem 0;
		writing-mode: vertical-rl; font-size: 0.75rem; letter-spacing: 0.03em;
	}
	.phase-tab:hover { color: #e1e4e8; background: #1a1d29; }
	.phase-tab.auto { display: none; }
	@media (max-width: 1099px) {
		.phase-tab.auto { display: block; }
		.phase-panel.auto { display: none; }
	}
	.phase-head-actions { display: inline-flex; gap: 0.25rem; }
	.phase-panel {
		width: clamp(220px, 26vw, 320px);
		flex-shrink: 0;
		border-left: 1px solid #2a2d3a;
		padding: 1rem;
		overflow-y: auto;
		height: 100%;
		background: #13151e;
	}
	.phase-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}
	.phase-panel-header h3 { font-size: 0.9rem; color: #8b8fa3; margin: 0; }
	.phase-create-form {
		display: flex; gap: 0.4rem; margin-bottom: 0.5rem;
	}
	.phase-create-form input {
		flex: 1; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.3rem 0.5rem; color: #e1e4e8; font-size: 0.8rem;
	}
	.phase-create-form input:focus { outline: none; border-color: #8b9cf7; }
	.phase-empty { color: #6b7280; font-size: 0.8rem; }
	.phase-item {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.4rem 0.6rem; margin-bottom: 0.3rem;
		display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;
	}
	.phase-item.phase-selected { border-color: #8b9cf7; background: #1e2030; }
	.phase-item.phase-assigning { border-color: #10b981; }
	.phase-item-header { cursor: pointer; flex: 1; display: flex; align-items: center; justify-content: space-between; }
	.phase-item-header:hover .phase-item-label { color: #8b9cf7; }
	.phase-item-label { font-size: 0.85rem; color: #e1e4e8; font-weight: 500; }
	.phase-item-count { font-size: 0.7rem; color: #6b7280; margin-left: 0.5rem; }
	.phase-assign-hint {
		font-size: 0.75rem; color: #10b981; padding: 0.4rem 0; font-style: italic;
	}
	.phase-detail {
		margin-top: 0.75rem; border-top: 1px solid #2a2d3a; padding-top: 0.5rem;
	}
	.phase-detail h4 {
		font-size: 0.75rem; color: #8b8fa3; margin: 0.5rem 0 0.3rem;
		text-transform: uppercase; letter-spacing: 0.05em;
	}
	.phase-member {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.2rem 0; font-size: 0.8rem; color: #c9cdd5;
	}
	.phase-member-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.btn-remove { color: #ef4444; border-color: transparent; padding: 0 0.3rem; }
	.btn-remove:hover { background: rgba(239, 68, 68, 0.1); }
	.passage-naming-group { margin-bottom: 0.5rem; }
	.passage-naming-header {
		font-size: 0.8rem; color: #c9cdd5; font-weight: 500;
		padding: 0.2rem 0; border-bottom: 1px solid #2a2d3a;
	}
	.passage-doc-group { margin-left: 0.5rem; margin-top: 0.2rem; }
	.passage-doc-link {
		font-size: 0.7rem; color: #6b7280; text-decoration: none;
	}
	.passage-doc-link:hover { color: #8b9cf7; }
	.passage-text {
		font-size: 0.75rem; color: #9ca3af; padding: 0.15rem 0 0.15rem 0.5rem;
		border-left: 2px solid #2a2d3a; margin: 0.15rem 0;
		line-height: 1.4;
	}

	.summary { font-size: 0.8rem; color: #6b7280; }
	.sep { color: #3a3d4a; margin: 0 0.15rem; }

	/* Create naming */
	.create-form { min-width: 160px; }
	.create-input {
		width: 100%;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 0.35rem 0.55rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		box-sizing: border-box;
	}
	.create-input:focus { outline: none; border-color: #8b9cf7; }
	.create-input::placeholder { color: #4b5563; }
	.create-input:disabled { opacity: 0.5; }

	/* Relate / merge banner — orange-pulse to break user attention when entering
	   a mode that requires a second click. Suppressed under reduce-motion. */
	/* Unten im Fenster, nicht oben in der Seite: wer weit unten „relate"
	   anklickt, sah Hinweis und Bestätigung nicht (Testlauf 09.11.). */
	.relate-banner {
		position: fixed;
		bottom: 1rem;
		left: calc(var(--content-left, 0px) + (100vw - var(--content-left, 0px)) / 2);
		transform: translateX(-50%);
		width: max-content;
		max-width: min(760px, calc(100vw - var(--content-left, 0px) - 2rem));
		flex-wrap: wrap;
		z-index: 60;
		background: #241d14;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		border: 1px solid var(--warning);
		border-left: 4px solid var(--warning);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		color: var(--text-1);
		margin-bottom: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		animation: banner-pulse 1.8s ease-in-out infinite;
	}

	.relate-form { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
	.relate-input {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.25rem 0.45rem; color: #e1e4e8; font-size: 0.8rem; font-family: inherit; width: 11rem;
	}
	.relate-input:focus { outline: none; border-color: #8b9cf7; }
	.relate-dir { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.78rem; color: #8b8fa3; }
	.relate-effect { flex-basis: 100%; font-size: 0.72rem; color: #8b8fa3; }

	@keyframes banner-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(232, 165, 75, 0.0); }
		50%      { box-shadow: 0 0 0 4px rgba(232, 165, 75, 0.22); }
	}

	@media (prefers-reduced-motion: reduce) {
		.relate-banner { animation: none; }
	}

	/* Act-prompt bar */
	/* Bleibt im Blick, auch wenn der Akt weit unten in der Liste begann
	   (Testlauf 13: der Dialog stand oben außer Sicht, Enter schien nichts
	   zu tun). */
	.act-prompt-bar {
		background: #161822;
		border: 1px solid #f59e0b;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
		position: sticky; top: 0.5rem; z-index: 60;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.act-header {
		font-size: 0.85rem;
		color: #c9cdd5;
		margin-bottom: 0.4rem;
	}
	.act-prompt-bar textarea {
		width: 100%;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 5px;
		padding: 0.4rem 0.5rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		resize: vertical;
		font-family: inherit;
		box-sizing: border-box;
	}
	.act-prompt-bar textarea:focus { outline: none; border-color: #8b9cf7; }
	.act-links {
		max-height: 120px;
		overflow-y: auto;
		margin-top: 0.4rem;
		padding: 0.3rem;
		background: #0f1117;
		border-radius: 4px;
	}
	.act-link-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: #8b8fa3;
		padding: 0.1rem 0;
		cursor: pointer;
	}
	.act-link-item input { width: 14px; height: 14px; }
	.act-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.4rem;
	}
	.act-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.btn-primary { background: #8b9cf7; color: #0f1117; border: none; font-weight: 600; cursor: pointer; }
	.btn-sm-primary { padding: 0.3rem 0.7rem; border-radius: 5px; font-size: 0.8rem; }
	.btn-primary:hover:not(:disabled) { background: #a0aff9; }
	.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
	.btn-link { background: none; border: none; color: #6b7280; font-size: 0.75rem; cursor: pointer; }
	.btn-link:hover { color: #c9cdd5; }
	.btn-link-toggle { background: none; border: none; color: #4b5563; font-size: 0.7rem; cursor: pointer; }
	.btn-link-toggle:hover { color: #8b8fa3; }

	/* Sections */
	.section { margin-bottom: 1.5rem; }
	.section-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.4rem;
		padding-left: 0.25rem;
	}
	.section-count {
		font-weight: 400;
		color: #4b5563;
	}

	/* Naming list */
	.naming-list {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.25rem;
	}

	/* Das per ?focus= aufgeschlagene Naming: markiert, solange man hier ist —
	   nicht als Blitz, der weg ist, bevor man am Ziel angekommen ist. */
	.focused {
		border-radius: 5px;
		box-shadow: inset 0 0 0 1px rgba(139, 156, 247, 0.55);
		background: rgba(139, 156, 247, 0.07);
	}

	/* Buttons reused across banners, act-prompt, phase panel, and stack-panel snippet. */
	.btn-xs {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.7rem;
		padding: 0.15rem 0.35rem;
		cursor: pointer;
		text-decoration: none;
	}
	.btn-xs:hover { border-color: #4b5060; color: #e1e4e8; }
	.btn-confirm { border-color: #8b9cf7; color: #8b9cf7; font-weight: 600; }
	.btn-confirm:hover { background: rgba(139, 156, 247, 0.12); color: #e1e4e8; }
	.merge-banner { border-color: #e8a54b; }
	.banner-text { flex: 1 1 22rem; line-height: 1.4; }
	.rel-ends { font-size: 0.74rem; color: #8b8fa3; margin-bottom: 0.35rem; }
	.silence-pattern { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; font-size: 0.74rem; color: #8b8fa3; margin-bottom: 0.4rem; }
	.sp-chip {
		font-size: 0.7rem; color: #a0a4b0; background: #1e2030; border: 1px solid #2a2d3a;
		border-radius: 10px; padding: 0 0.45rem; cursor: pointer; text-decoration: none;
	}
	.sp-chip:hover { border-color: #8b9cf7; color: #e1e4e8; }

	/* designation-dot reused in the phase-member sidebar. */
	.designation-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	/* Map links */
	.map-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.25rem;
		padding-left: 1.6rem;
	}
	.map-link {
		font-size: 0.65rem;
		color: #4b5563;
		background: #0f1117;
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		text-decoration: none;
	}
	.map-link:hover { color: #8b9cf7; }

	/* Stack panel */
	.stack-panel {
		margin-top: 0.4rem;
		padding: 0.5rem 0.65rem;
		padding-left: 1.6rem;
		border-top: 1px solid #2a2d3a;
	}
	.stack-section { margin-bottom: 0.5rem; }
	.stack-section h4 {
		font-size: 0.7rem;
		color: #4b5563;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.2rem;
	}
	.history-entry {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: #8b8fa3;
		padding: 0.1rem 0;
	}
	.he-value { color: #c9cdd5; }
	.he-by { color: #6b7280; }
	.he-by::before { content: '— '; }
	.he-date { color: #4b5563; margin-left: auto; font-size: 0.7rem; }

	.memo-entry { margin-bottom: 0.5rem; padding: 0.3rem 0.4rem; border: 1px solid #1e2030; border-radius: 4px; }
	.memo-entry.memo-dismissed { opacity: 0.5; }
	.memo-entry-header { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.15rem; }
	.memo-author-badge {
		font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0.02rem 0.25rem; border-radius: 3px; flex-shrink: 0;
	}
	.memo-author-badge.badge-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-status-badge {
		font-size: 0.52rem; font-weight: 600; text-transform: uppercase;
		padding: 0.02rem 0.25rem; border-radius: 3px; flex-shrink: 0;
	}
	.memo-status-badge.status-presented { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-status-badge.status-discussed { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	.memo-status-badge.status-acknowledged { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.btn-promote { border-color: #10b981; color: #10b981; }
	.memo-status-badge.status-promoted { background: rgba(16, 185, 129, 0.25); color: #10b981; }
	.memo-status-badge.status-dismissed { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-label { font-size: 0.75rem; color: #f59e0b; }
	.memo-content { font-size: 0.75rem; color: #8b8fa3; margin-top: 0.1rem; white-space: pre-wrap; }
	.memo-entry-actions { display: flex; gap: 0.25rem; margin-top: 0.25rem; }

	.discussion-msg {
		padding: 0.2rem 0;
		font-size: 0.75rem;
	}
	.discussion-msg .msg-role {
		color: #6b7280;
		font-size: 0.65rem;
		margin-right: 0.3rem;
	}
	.discussion-msg .msg-content { color: #c9cdd5; }
	.discussion-msg.ai .msg-role { color: #8b9cf7; }

	/* Material */
	.material-group { margin-bottom: 0.3rem; }
	.material-doc-link {
		font-size: 0.72rem; color: #10b981; display: block;
		margin-bottom: 0.1rem; text-decoration: none;
	}
	.material-doc-link:hover { text-decoration: underline; }
	.material-passage {
		font-size: 0.72rem; color: #c9cdd5; padding: 0.15rem 0.3rem;
		margin: 0.05rem 0; background: rgba(16, 185, 129, 0.04);
		border-left: 2px solid rgba(16, 185, 129, 0.2); border-radius: 3px;
		white-space: pre-wrap; max-height: 3em; overflow-y: auto;
	}

	.empty { color: #6b7280; font-size: 0.9rem; }
	.hidden-notice {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		background: #1c1a12; border: 1px solid #b45309; border-radius: 6px;
		padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; color: #f5d08a; font-size: 0.85rem;
	}
	/* Unten im Fenster wie die Relate-Leiste: wer weit unten handelt, sah die
	   Meldung oben in der Seite nicht. Mittig über dem Inhalt, nicht über der
	   Seitenleiste mit dem Cowork-Kasten (Testlauf 13). */
	.action-error {
		position: fixed; bottom: 1rem; z-index: 61;
		left: calc(var(--content-left, 0px) + (100vw - var(--content-left, 0px)) / 2); transform: translateX(-50%);
		width: max-content; max-width: min(760px, calc(100vw - var(--content-left, 0px) - 2rem)); flex-wrap: wrap;
		display: flex; align-items: center; justify-content: space-between; gap: 0.6rem;
		padding: 0.45rem 0.7rem; border: 1px solid #7f1d1d; border-radius: 6px;
		background: #2a1416; color: #fca5a5; font-size: 0.82rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.action-info {
		position: fixed; bottom: 1rem; z-index: 61;
		left: calc(var(--content-left, 0px) + (100vw - var(--content-left, 0px)) / 2); transform: translateX(-50%);
		width: max-content; max-width: min(760px, calc(100vw - var(--content-left, 0px) - 2rem)); flex-wrap: wrap;
		display: flex; align-items: center; justify-content: space-between; gap: 0.6rem;
		padding: 0.45rem 0.7rem; border: 1px solid #1e3a5f; border-radius: 6px;
		background: #111c2b; color: #bcd3f0; font-size: 0.82rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.ai-outside-hint { font-size: 0.72rem; color: #6b7280; margin: 0 0 0.4rem; line-height: 1.35; }
</style>
