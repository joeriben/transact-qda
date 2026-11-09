// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getContext, setContext, untrack } from 'svelte';
import { regionColor } from '$lib/canvas/regions.js';
import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';
import { namingLabel, quoted } from '$lib/shared/namingLabel.js';
import { formatWhen } from '$lib/shared/dates.js';
import { viewHref } from '$lib/shared/rueckweg.js';

const MAP_STATE_KEY = Symbol('mapState');

/** Persona-Präfix im Titel eines KI-Memos („Cowork: …"). „Coding-Run" ist die
 *  alte Bezeichnung des Naming-Runs und kann in gespeicherten Titeln stehen. */
const AI_MEMO_TITLE_PREFIX = /^(Cowork|AI|Autonoma|Naming-Run|Coding-Run|Comparative):\s*/;

/** ai-eval: das letzte Verdikt zu einem Naming, samt Urteilendem. */
export type RejectionInfo = {
	verdict: string;
	createdAt: string | null;
	evaluatorName: string | null;
	/** Hat der Betrachter selbst geurteilt? */
	mine: boolean;
	/** Zahl der Mitglieder, die zu diesem Naming geurteilt haben. */
	evaluatorCount: number;
};

export type StackData = {
	inscriptions: any[];
	designations: any[];
	/** Der Stack: jeder Akt mit allen Dimensionen und seiner Notiz (Memo zu
	 *  diesem Naming), chronologisch. */
	acts?: StackAct[];
	memos: any[];
	annotations?: any[];
	/** Akte, die nur eine Begründung tragen (memo_text ohne Inschrift/
	 *  Designation), verlinkt auf die Passage, für die sie gilt. Das ist die
	 *  Begründung eines KI-Cues. */
	reasonings?: any[];
	/** Entering/leaving a map's situation — a topological history, not a
	 *  designation history (see migrations/034_situating_acts.sql). */
	situating?: any[];
	discussion?: any[];
	/** Stille: die Namings, aus deren Muster sie folgt (Participations ohne Appearances). */
	silencePattern?: { id: string; label: string }[];
	relationEnds?: { source: string; target: string; directed: boolean; current?: boolean } | null;
	aiReasoning?: string | null;
	aiSuggested?: boolean;
	aiWithdrawn?: boolean;
};

export type StackAct = {
	seq: string;
	created_at: string;
	inscription: string | null;
	designation: string | null;
	mode: string | null;
	valence: string | null;
	memo_text: string | null;
	by_inscription: string;
	by_researcher: boolean;
	linked: { id: string; label: string }[];
};

export type MemoPanelData = {
	id: string;
	title: string;
	content: string;
	linkedIds: string[];
	authorId: string;
};

/** Urteile über ein KI-Memo — dieselbe Auswahl wie im Stack-Panel. */
export type MemoVerdict = 'acknowledged' | 'dismissed' | 'promoted';

/** Antwort einer Map-Aktion samt Status — für Fälle, in denen der Fehler etwas sagt (409). */
export type MapResponse = { ok: boolean; status: number; data: any };

/** Meldung über der Karte. Hinweise verschwinden von selbst, Fehler bleiben
 *  stehen, bis man sie schließt. */
export type Notice = {
	id: number;
	text: string;
	kind: 'info' | 'error';
	link?: { href: string; label: string };
};

/** Ein Naming in den Blick holen; mit `stack` auch seinen Stack öffnen. */
export type RevealOptions = { stack?: boolean };

export type MapState = ReturnType<typeof createMapState>;

export function createMapState(
	initialData: any,
	viewport: { x: number; y: number; zoom: number },
) {
	// ─── Core data ───
	let axes = $state<any[]>(initialData.axes || []);
	let elements = $state<any[]>(initialData.elements);
	let relations = $state<any[]>(initialData.relations);
	let silences = $state<any[]>(initialData.silences);
	let phases = $state<any[]>(initialData.phases);
	let docPhases = $state<any[]>(initialData.docPhases || []);
	let designationProfile = $state<any[]>(initialData.designationProfile);
	let mapMeta = $state({ id: initialData.map.id, label: initialData.map.label, properties: initialData.map.properties });

	// ─── Derived ───
	const mapType = $derived(mapMeta.properties?.mapType || 'situational');
	const isPrimary = $derived(mapMeta.properties?.isPrimary === true);
	const allItems = $derived([...axes, ...elements, ...relations, ...silences]);
	// Nachschlagen per ID: findNode läuft beim Zeichnen jeder Relation mehrfach.
	const nodeIndex = $derived(new Map<string, any>(allItems.map((n: any) => [n.naming_id, n])));
	const phaseColorMap = $derived(
		new Map(phases.map((p: any, i: number) => [p.id, regionColor(i)]))
	);

	// ─── Zurückgezogenes (Withdraw) ───
	// Ausblenden ist ein eigener Schalter, kein Phasen-Fokus: als Phasen-Fokus
	// dimmte er alle übrigen Knoten mit, und jeder Klick auf die Fläche hob ihn
	// wieder auf.
	let hideWithdrawn = $state(false);
	// Gezählt wird, was die Leinwand zeigen kann. Aus der Lage abgeleitete
	// Relationen (SW/A: „contains", „overlaps") zeichnet sie nicht — ein
	// zurückgezogenes „contains" nach dem Herausziehen stand sonst als
	// „Withdrawn 1" ohne sichtbares Element da. Sie werden eigens genannt.
	const withdrawnCount = $derived(
		allItems.filter((n: any) => isWithdrawn(n.properties) && !n.properties?.spatiallyDerived).length
	);
	const withdrawnDerivedCount = $derived(
		allItems.filter((n: any) => isWithdrawn(n.properties) && n.properties?.spatiallyDerived).length
	);

	// CCS-Kopfzähler ohne Zurückgezogenes. Das Profil kommt vom Server (zählt
	// jede Erscheinung); abgezogen wird, was hier als zurückgezogen vorliegt.
	const designationCounts = $derived.by(() => {
		const withdrawnBy = new Map<string, number>();
		for (const n of allItems) {
			if (!isWithdrawn(n.properties)) continue;
			const d = n.designation || 'cue';
			withdrawnBy.set(d, (withdrawnBy.get(d) ?? 0) + 1);
		}
		return (designationProfile ?? [])
			.map((dp: any) => ({
				designation: dp.designation as string,
				count: Math.max(0, Number(dp.count) - (withdrawnBy.get(dp.designation) ?? 0))
			}))
			.filter((dp: { count: number }) => dp.count > 0);
	});

	// ─── Ausgeblendete und verworfene KI-Cues ───
	// Ausgeblendet = jede Passage des Namings ist im Reader ausgeblendet.
	// Verworfen = das letzte Urteil der Auditschicht lautet 'reject'.
	// Beides hält sie aus der Unplaced-Liste heraus: dort steht, was noch zu
	// platzieren ist, und was der Forscher schon abgeräumt hat, gehört da nicht
	// mehr hin. Auf dem Canvas bleiben sie stehen — ein platziertes Naming
	// verschwindet nicht, es wird nur als verworfen markiert.
	// `showHidden` holt sie in die Liste zurück, wie der Fuß der Passagenliste.
	let showHidden = $state(false);
	// ai-eval: verworfene Cues (letztes Urteil = reject), je mit dem Urteilenden.
	// Reine Audit-Folge — ohne die Audit-Schicht ist die Menge leer und nichts
	// ändert sich. Der Urteilende gehört dazu: in einem geteilten Projekt kann
	// das Urteil von jemand anderem sein, und dann darf die Ansicht es nicht als
	// das eigene ausgeben.
	let rejectedNamings = $state<Map<string, RejectionInfo>>(new Map());

	function isHidden(node: any): boolean {
		return node?.anchors_hidden === true;
	}

	function isRejected(node: any): boolean {
		return rejectedNamings.has(node?.naming_id);
	}

	/** Wer hat verworfen, wann, und stritten mehrere darüber. */
	function rejectionOf(node: any): RejectionInfo | null {
		return rejectedNamings.get(node?.naming_id) ?? null;
	}

	/** Ein Satz für Tooltips: „von wem, wann" statt eines anonymen Ausgrauens. */
	function rejectionLabel(node: any): string | null {
		const r = rejectionOf(node);
		if (!r) return null;
		const who = r.mine ? 'You' : (r.evaluatorName ?? 'Another member');
		const when = r.createdAt ? formatWhen(r.createdAt) || null : null;
		const base = `${who} rejected this cue${when ? ` on ${when}` : ''}`;
		return r.evaluatorCount > 1
			? `${base} — ${r.evaluatorCount} members have judged it, the latest verdict counts here`
			: base;
	}

	// ─── Unresolved tracking (primary SitMap only) ───
	// A naming is "unresolved" if it has no canvas position and is not declined.
	// The positionsRef is set externally by canvasPositions after init.
	let positionsRef = $state<Map<string, { x: number; y: number }> | null>(null);
	let listFilter = $state<'all' | 'placed' | 'unresolved' | 'withdrawn'>('all');

	/** Quelle und Ziel einer Relation. */
	function endpointsOf(node: any): [string | null, string | null] {
		return [node?.directed_from || node?.part_source_id || null, node?.directed_to || node?.part_target_id || null];
	}

	// Was der Forscher eben selbst angelegt hat, soll er sehen: die nächste
	// automatische Platzierung darf die Ansicht dorthin schieben (kurz gültig,
	// damit kein späterer KI- oder Import-Knoten die Ansicht verrückt).
	let revealUntil = 0;
	function requestReveal() { revealUntil = Date.now() + 8000; }
	function takeReveal(): boolean {
		const r = Date.now() < revealUntil;
		revealUntil = 0;
		return r;
	}

	// Eine Relation ist platziert, sobald ihre beiden Endpunkte es sind: auf dem
	// Canvas steht sie zwischen ihnen, eine eigene Position braucht sie nicht.
	function hasPosition(node: any, depth = 0): boolean {
		if (!positionsRef) return true;
		if (node?.mode === 'relation') {
			if (depth > 4) return false;
			const [s, t] = endpointsOf(node);
			if (!s || !t) return false;
			const sn = nodeIndex.get(s);
			const tn = nodeIndex.get(t);
			return !!sn && !!tn && hasPosition(sn, depth + 1) && hasPosition(tn, depth + 1);
		}
		return positionsRef.has(node?.naming_id);
	}

	// Zählt, was der Schalter zurückholt: unplatzierte Namings, die nur wegen
	// Ausblenden/Verwerfen nicht in der Unplaced-Liste stehen.
	const hiddenCount = $derived(
		isPrimary && positionsRef
			? allItems.filter(
					(n: any) =>
						(isHidden(n) || isRejected(n)) &&
						!hasPosition(n) &&
						!isWithdrawn(n.properties)
				).length
			: 0
	);

	// ─── Shared interaction state ───
	let stackId = $state<string | null>(null);
	let stackData = $state<StackData | null>(null);
	// Memo-Vorschau beim Überfahren eines Knotens oder einer Raute. Gerendert
	// außerhalb der skalierten Canvas-Ebene (MemoTooltip.svelte) — darin wuchs
	// und schrumpfte sie mit dem Zoom. Reine Anzeige: sie verschwindet beim
	// Verlassen und nimmt keine Klicks an (der Stack öffnet sich über das
	// Abzeichen oder den Doppelklick).
	let memoTip = $state.raw<{ el: any; rect: DOMRect } | null>(null);
	let memoTipTimer: ReturnType<typeof setTimeout> | null = null;

	// Kurz hervorgehoben: ein eben platziertes oder gesuchtes Naming, damit das
	// Auge es auf der Karte findet.
	let flashId = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	function flash(id: string) {
		flashId = id;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => { flashId = null; }, 2600);
	}
	let editingId = $state<string | null>(null);
	let editingValue = $state('');
	let relatingFrom = $state<string | null>(null);
	let relatingTo = $state<string | null>(null);

	// Per-map reify: flipping an entity appearance into a relation on THIS map.
	// reifyTarget is the naming being reified; reifySource is the first endpoint
	// the user picks. When the second endpoint is picked we fire the API.
	let reifyTarget = $state<string | null>(null);
	let reifySource = $state<string | null>(null);

	// Naming act prompt
	let actTarget = $state<string | null>(null);
	let actType = $state<'rename' | 'designate' | 'relate' | 'mode'>('rename');
	// Beim Moduswechsel (Entität ↔ Relation auf dieser Map) wartet der Akt auf
	// die Notiz: der Server schreibt Wechsel und Notiz in DENSELBEN Akt.
	let actModeEnds = $state<{ sourceId: string; targetId: string } | null>(null);
	let actNewValue = $state('');
	let actMemo = $state('');
	let actLinkedIds = $state<string[]>([]);
	let showActLinks = $state(false);
	let actExistingMemos = $state<any[]>([]);

	// Phases
	let assigningToPhase = $state<string | null>(null);
	let highlightedPhase = $state<string | null>(null);

	// AI
	let aiEnabled = $state(true);
	let notices = $state<Notice[]>([]);

	// Memo panel (Cowork-Karte: ein eben geschriebenes KI-Memo)
	let memoPanel = $state<MemoPanelData | null>(null);
	// KI-Memos, die auf ein Urteil warten („presented") und diese Karte oder
	// eines ihrer Namings betreffen. Aus „Map memos" lassen sie sich wieder als
	// Karte öffnen — auch nachdem sie ohne Urteil geschlossen wurde.
	let presentedMemos = $state<Array<MemoPanelData & { thread: { role: 'researcher' | 'ai'; content: string }[] }>>([]);
	let memoPanelBusy = $state(false);
	/** Gesprächsverlauf zum Memo in der Karte (Forscherin, KI), solange sie offen ist. */
	let memoPanelThread = $state<{ role: 'researcher' | 'ai'; content: string }[]>([]);

	// Outside participations
	let outsideId = $state<string | null>(null);
	let outsideData = $state<any[] | null>(null);
	let outsideLoading = $state(false);

	// Discussion (stack panel local)
	let discussInput = $state('');
	let discussLoading = $state(false);
	let memoDiscussInput = $state('');
	let memoDiscussLoading = $state(false);
	let memoDiscussTarget = $state<string | null>(null);
	let clarkeFormOpen = $state(false);
	let clarkeFormQuestion = $state('');
	let clarkeFormContent = $state('');

	// Memo creation from map
	let memoCreateOpen = $state(false);
	let memoCreateTitle = $state('');
	let memoCreateContent = $state('');
	let memoCreateLinkedIds = $state<string[]>([]);
	let memoCreateSaving = $state(false);

	// Phase sidebar state
	let showPhaseForm = $state(false);
	let newPhaseLabel = $state('');
	let expandedPhase = $state<string | null>(null);
	// Phasen gehören dem Projekt (parentMapId zeigt auf den Grounding
	// Workspace). Auf der Karte zählt und listet die Phase, was von ihr hier
	// steht — aus den Kartendaten, ohne eigene Abfrage.
	const phaseContents = $derived(
		expandedPhase ? allItems.filter((n: any) => n.phase_ids?.includes(expandedPhase)) : []
	);
	const phaseCountsOnMap = $derived.by(() => {
		const m = new Map<string, number>();
		for (const n of allItems) for (const pid of n.phase_ids ?? []) m.set(pid, (m.get(pid) ?? 0) + 1);
		return m;
	});

	// ─── Helpers ───

	function isWithdrawn(props: any): boolean {
		return props?.withdrawn === true || props?.aiWithdrawn === true;
	}

	function isHiddenByFilter(node: any): boolean {
		return hideWithdrawn && isWithdrawn(node.properties);
	}

	function isUnresolved(node: any): boolean {
		if (!isPrimary || !positionsRef) return false;
		// Ausgeblendetes und Verworfenes ist abgeräumt und steht nicht mehr zur
		// Platzierung an — auf dem Canvas bleibt es unberührt.
		if ((isHidden(node) || isRejected(node)) && !showHidden) return false;
		return !hasPosition(node) && !isWithdrawn(node.properties);
	}

	function isPlaced(node: any): boolean {
		return hasPosition(node);
	}

	function unresolvedCount(): number {
		if (!isPrimary || !positionsRef) return 0;
		return allItems.filter((n: any) => isUnresolved(n)).length;
	}

	function filterItem(node: any): boolean {
		if (listFilter === 'all') return true;
		if (listFilter === 'withdrawn') return isWithdrawn(node.properties);
		if (listFilter === 'unresolved') return isUnresolved(node);
		if (listFilter === 'placed') return isPlaced(node) && !isWithdrawn(node.properties);
		return true;
	}

	function isPhaseHighlighted(node: any): boolean {
		if (!highlightedPhase) return false;
		// Direct membership (entity or silence)
		if (node.phase_ids?.includes(highlightedPhase)) return true;
		// Relation: highlight it when both of its endpoints are in the phase.
		// Relations themselves are not assigned to phases — but a relation
		// *between* two phase members is part of the phase's footprint and
		// should not be dimmed.
		if (node.mode === 'relation') {
			const src = node.directed_from || node.part_source_id;
			const tgt = node.directed_to || node.part_target_id;
			const isIn = (id: string | null | undefined) => {
				if (!id) return false;
				const n = nodeIndex.get(id);
				return !!n?.phase_ids?.includes(highlightedPhase);
			};
			if (isIn(src) && isIn(tgt)) return true;
		}
		// Doc-phase fallback
		const dc = docPhases.find((d: any) => d.doc_id === highlightedPhase);
		if (dc) return dc.naming_ids?.includes(node.naming_id) ?? false;
		return false;
	}

	function connectionOpacity(rel: any, srcNode: any, tgtNode: any): number {
		if (hideWithdrawn && isWithdrawn(rel.properties)) return 0;
		if (hideWithdrawn && (isWithdrawn(srcNode?.properties) || isWithdrawn(tgtNode?.properties))) return 0;
		if (isWithdrawn(rel.properties)) return 0.2;
		return 1;
	}

	function designationColor(d: string | undefined) {
		if (d === 'specification') return CCS_SPEC;
		if (d === 'characterization') return CCS_CHAR;
		return CCS_CUE;
	}

	function designationLabel(d: string | undefined) {
		if (d === 'specification') return 'spec';
		if (d === 'characterization') return 'char';
		return 'cue';
	}

	function findNode(namingId: string) {
		return nodeIndex.get(namingId);
	}

	/** Anzeigename eines Bezugs — die Karte selbst ist kein Knoten auf ihr. */
	function linkLabel(id: string): string {
		if (id === mapMeta.id) return mapMeta.label;
		return findInscription(id);
	}

	/** Anzeigename eines Namings auf dieser Karte. Eine Relation ohne eigene
	 *  Inschrift heißt nach ihren Endpunkten („Quelle —valenz→ Ziel"), nicht
	 *  „(unnamed)" (shared/namingLabel.ts). */
	function findInscription(namingId: string, depth = 0): string {
		if (!namingId) return '?';
		const node = findNode(namingId);
		if (!node) return '?';
		if (node.mode === 'relation' && depth < 4) {
			const [s, t] = endpointsOf(node);
			return namingLabel(node.inscription, {
				source: s ? findInscription(s, depth + 1) : null,
				target: t ? findInscription(t, depth + 1) : null,
				valence: node.valence,
				directed: !!(node.directed_from && node.directed_to)
			});
		}
		return namingLabel(node.inscription, null);
	}

	function estimateNodeWidth(node: any): number {
		if (!node) return 100;
		if (node.mode === 'relation') {
			return node.inscription ? Math.max(100, Math.min(220, node.inscription.length * 8 + 40)) : 36;
		}
		return Math.max(100, Math.min(220, (node.inscription?.length || 5) * 8 + 40));
	}

	// ─── API ───

	async function mapAction(action: string, body: Record<string, unknown> = {}) {
		const res = await fetch(`/api/projects/${initialData.projectId}/maps/${mapMeta.id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...body })
		});
		if (!res.ok) {
			// Sagt der Server, was nicht ging, steht das in der Statusmeldung —
			// sonst tat ein abgelehnter Klick still nichts.
			const err = await res.json().catch(() => null);
			if (typeof err?.error === 'string' && err.error.trim()) showServerError(err.error.trim());
			return null;
		}
		return res.json();
	}

	/** Wie mapAction, aber mit Status und Fehlerkörper (etwa 409 „schon auf dieser Karte"). */
	async function mapRequest(action: string, body: Record<string, unknown> = {}): Promise<MapResponse> {
		try {
			const res = await fetch(`/api/projects/${initialData.projectId}/maps/${mapMeta.id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ...body })
			});
			const data = await res.json().catch(() => null);
			return { ok: res.ok, status: res.status, data };
		} catch {
			return { ok: false, status: 0, data: null };
		}
	}

	async function reload() {
		const res = await fetch(`/api/projects/${initialData.projectId}/maps/${mapMeta.id}`);
		if (!res.ok) return;
		const fresh = await res.json();
		axes = fresh.axes || [];
		elements = fresh.elements;
		relations = fresh.relations;
		silences = fresh.silences;
		phases = fresh.phases;
		docPhases = fresh.docPhases || [];
		designationProfile = fresh.designationProfile;
	}

	// ─── Shared actions ───

	// Der Stack eines anderen Namings ersetzt den alten sofort (leer, bis er
	// geladen ist) — nie steht für einen Moment der Stack des vorigen unter der
	// neuen Zeile. Spät eintreffende Antworten für ein anderes Naming verfallen.
	let stackRequest = 0;
	// Ein Satz über dem Stack, warum er gerade aufging (z. B. „schon verbunden").
	// Gilt nur für dieses Naming; ein anderer Stack räumt ihn ab.
	let stackHint = $state<{ id: string; text: string } | null>(null);

	async function loadStack(namingId: string) {
		if (stackHint && stackHint.id !== namingId) stackHint = null;
		stackId = namingId;
		stackData = null;
		const req = ++stackRequest;
		const data = await mapAction('getStack', { namingId });
		if (req !== stackRequest || stackId !== namingId) return;
		if (data) { stackData = data; return; }
		stackId = null;
		showError('Could not load the stack.');
	}

	/** Den offenen Stack neu laden, ohne ihn vorher zu leeren. */
	async function refreshStack() {
		const id = stackId;
		if (!id) return;
		const req = ++stackRequest;
		const fresh = await mapAction('getStack', { namingId: id });
		if (fresh && req === stackRequest && stackId === id) stackData = fresh;
	}

	/** Den Stack öffnen (ohne Umschalten: ist er schon offen, bleibt er offen). */
	async function openStack(namingId: string) {
		if (stackId === namingId) return;
		await loadStack(namingId);
	}

	async function showStack(namingId: string) {
		if (stackId === namingId) {
			stackRequest++;
			stackId = null;
			stackData = null;
			return;
		}
		await loadStack(namingId);
	}

	function keepMemoTip() {
		if (memoTipTimer) { clearTimeout(memoTipTimer); memoTipTimer = null; }
	}
	function showMemoTip(el: any, rect: DOMRect) {
		keepMemoTip();
		memoTip = { el, rect };
	}
	function hideMemoTip(delay = 0) {
		keepMemoTip();
		if (delay <= 0) { memoTip = null; return; }
		memoTipTimer = setTimeout(() => { memoTip = null; memoTipTimer = null; }, delay);
	}
	/** Die Vorschau dieses Namings ausblenden. Verglichen wird die ID, nicht das
	 *  Objekt: nach jedem Neuladen ist der Knoten ein neues Objekt, und der
	 *  Vergleich per Identität ließ die Vorschau stehen. */
	function hideMemoTipFor(namingId: string) {
		if (memoTip?.el?.naming_id === namingId) hideMemoTip();
	}

	async function submitAct() {
		if (!actTarget) return;
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue, memoText: actMemo.trim() || undefined, linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined });
		} else if (actType === 'designate') {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue, memoText: actMemo.trim() || undefined, linkedNamingIds: actLinkedIds.length > 0 ? actLinkedIds : undefined });
		} else if (actType === 'relate' && actMemo.trim()) {
			// Memo zur gerade gesetzten Relation: ein Akt in IHREM Stack (die
			// Relation ist ein Naming), kein eigenes Memo-Naming.
			await mapAction('note', { namingId: actTarget, memoText: actMemo.trim(), linkedNamingIds: actLinkedIds });
		} else if (actType === 'mode') {
			await commitModeAct(true);
			return;
		}
		cancelAct();
		await reload();
	}

	/** Moduswechsel auf dieser Map (Entität ↔ Relation), mit oder ohne Notiz —
	 *  ein Akt im Stack des Namings (naming_acts.mode, migrations/009). */
	async function commitModeAct(withMemo: boolean) {
		if (!actTarget || actType !== 'mode') return;
		const namingId = actTarget;
		const mode = actNewValue === 'relation' ? 'relation' : 'entity';
		const memoText = withMemo ? actMemo.trim() : '';
		const res = await mapRequest('switchAppearanceMode', {
			namingId,
			mode,
			...(mode === 'relation' && actModeEnds ? { sourceId: actModeEnds.sourceId, targetId: actModeEnds.targetId } : {}),
			memoText: memoText || undefined,
			linkedNamingIds: memoText && actLinkedIds.length > 0 ? actLinkedIds : undefined
		});
		const label = findInscription(namingId);
		cancelAct();
		if (!res.ok) {
			// z. B. „These two namings are already related by another relation."
			showRelateError(res, 'Not changed (server error)');
			return;
		}
		await reload();
		if (res.data?.lifted) showAiNotification(`The memo lifts “${label}” from cue to characterization.`);
	}

	async function skipAct() {
		if (!actTarget) return;
		if (actType === 'mode') { await commitModeAct(false); return; }
		if (actType === 'rename') {
			await mapAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else if (actType === 'designate') {
			await mapAction('designate', { namingId: actTarget, designation: actNewValue });
		}
		cancelAct();
		await reload();
	}

	async function loadActMemos(namingId: string) {
		const res = await mapAction('getMemosForNaming', { namingId });
		actExistingMemos = res?.memos || [];
	}

	function cancelAct() {
		actTarget = null;
		actModeEnds = null;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		actExistingMemos = [];
	}

	function toggleActLink(namingId: string) {
		if (actLinkedIds.includes(namingId)) {
			actLinkedIds = actLinkedIds.filter(id => id !== namingId);
		} else {
			actLinkedIds = [...actLinkedIds, namingId];
		}
	}

	function confirmRename() {
		if (!editingId || !editingValue.trim()) return;
		actTarget = editingId;
		actType = 'rename';
		actNewValue = editingValue.trim();
		actMemo = '';
		loadActMemos(editingId);
		editingId = null;
		editingValue = '';
	}

	function startDesignation(namingId: string, designation: string) {
		actTarget = namingId;
		actType = 'designate';
		actNewValue = designation;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		loadActMemos(namingId);
	}

	/** „Show as entity / Show as relation (this map)": fragt wie Rename und
	 *  Designation nach einer Notiz zum Akt („skip memo" bleibt). */
	function startModeAct(namingId: string, mode: 'entity' | 'relation', ends: { sourceId: string; targetId: string } | null = null) {
		actTarget = namingId;
		actType = 'mode';
		actNewValue = mode;
		actModeEnds = ends;
		actMemo = '';
		actLinkedIds = [];
		showActLinks = false;
		loadActMemos(namingId);
	}

	function startRelating(fromId: string) {
		relatingFrom = fromId;
	}

	function startMapReify(namingId: string) {
		reifyTarget = namingId;
		reifySource = null;
	}

	function cancelMapReify() {
		reifyTarget = null;
		reifySource = null;
	}

	async function mapReifyPick(id: string) {
		if (!reifyTarget || id === reifyTarget) return;
		if (!reifySource) {
			reifySource = id;
			return;
		}
		if (id === reifySource) return;
		const targetNamingId = reifyTarget;
		const src = reifySource;
		reifyTarget = null;
		reifySource = null;
		startModeAct(targetNamingId, 'relation', { sourceId: src, targetId: id });
	}

	function switchToEntityOnMap(namingId: string) {
		startModeAct(namingId, 'entity');
	}

	// Schon verbunden (409): die Meldung bleibt stehen. Steht die bestehende
	// Relation auf dieser Karte, wird sie gezeigt und ihr Stack geöffnet — dort
	// wird sie umbenannt oder neu designiert. Sonst sagt die Meldung, dass sie
	// nicht hier steht, und führt in die Naming-Liste.
	function showRelateError(res: MapResponse, fallback: string, typedValence = '') {
		const msg = responseError(res, fallback);
		const existing = res.data?.alreadyRelated && typeof res.data.id === 'string' ? (res.data.id as string) : null;
		if (existing && findNode(existing)) {
			// Der Stack der vorhandenen Relation öffnet sich; eine stehende
			// Fehlermeldung verdeckte dann seinen Kopf (Testlauf 09.11.).
			// Der Satz steht im Stack selbst; eine Meldung über der Karte
			// verdeckte dessen Kopf. Das Formular stünde sonst davor.
			cancelRelation();
			const kept = typedValence ? ` The valence you typed (${quoted(typedValence)}) was not applied — set it here.` : '';
			stackHint = { id: existing, text: msg.replace(/ Open that relation to rename or re-designate it\.$/, ' This is that relation: rename or re-designate it here.') + kept };
			revealNaming(existing, { stack: true });
		} else if (existing) {
			showError(`${msg} That relation is not on this map.`, { href: namingsHref(existing), label: 'Open it in Namings' });
		} else {
			showError(msg);
		}
	}

	function completeRelating(toId: string) {
		if (!relatingFrom || relatingFrom === toId) return;
		// Zurückgezogenes steht nicht mehr zur Verfügung — erst wiederherstellen.
		if (isWithdrawn(findNode(toId)?.properties)) {
			showError('Withdrawn on this map — restore it first to relate it.');
			return;
		}
		// Schon verbunden (dieselbe Richtung; der Server lässt je Richtung eine
		// Relation zu): gleich sagen und die vorhandene zeigen, statt erst
		// nach dem Ausfüllen abzulehnen (Testlauf 09.11.: getippte Valenz weg).
		const taken = relations.find((r: any) => r.part_source_id === relatingFrom && r.part_target_id === toId);
		if (taken) {
			const s = findInscription(relatingFrom);
			const t = findInscription(toId);
			cancelRelation();
			stackHint = {
				id: taken.naming_id,
				text: `${quoted(s)} and ${quoted(t)} are already related in this direction. This is that relation: rename, re-designate or memo it here.`
			};
			revealNaming(taken.naming_id, { stack: true });
			return;
		}
		relatingTo = toId;
	}

	/** true, wenn die Relation steht. Geht es nicht, bleibt das Formular mit
	 *  den Eingaben offen (Valenz, Name), und die Meldung bleibt stehen. */
	async function submitRelation(relInscription: string, relValence: string, relDirected: boolean): Promise<boolean> {
		if (!relatingFrom || !relatingTo) return false;
		const res = await mapRequest('relate', {
			sourceId: relatingFrom,
			targetId: relatingTo,
			inscription: relInscription.trim() || undefined,
			valence: relValence.trim() || undefined,
			symmetric: !relDirected
		});
		if (!res.ok) {
			showRelateError(res, 'Relation not created (server error)', relValence.trim());
			return false;
		}
		relatingFrom = null;
		relatingTo = null;
		const relationId = res.data?.id;
		await reload();
		if (relationId) {
			actTarget = relationId;
			actType = 'relate';
			actNewValue = relInscription.trim() || relValence.trim() || '';
			actMemo = '';
			actLinkedIds = [];
			showActLinks = false;
			loadActMemos(relationId);
		}
		return true;
	}

	function cancelRelation() {
		relatingFrom = null;
		relatingTo = null;
	}

	async function toggleWithdraw(namingId: string, currentlyWithdrawn: boolean) {
		// Sofort zeigen, was der Klick bewirkt; das Neuladen bestätigt oder
		// korrigiert es. Geschrieben wird wie zuvor nur über `withdraw`.
		const node = findNode(namingId);
		const before = node?.properties;
		if (node) node.properties = { ...(node.properties ?? {}), withdrawn: !currentlyWithdrawn };
		const res = await mapAction('withdraw', { namingId, withdrawn: !currentlyWithdrawn });
		if (!res && node) node.properties = before;
		await reload();
	}

	// ─── Meldungen ───
	// Hinweise verschwinden nach einigen Sekunden. Fehlermeldungen bleiben
	// stehen, bis man sie schließt (×) — eine Meldung, die verschwindet, bevor
	// man sie gelesen hat, sagt nichts. Hat der Server eben gesagt, was nicht
	// ging, und meldet der Aufrufer gleich danach sein allgemeines „… not
	// saved", wird daraus EINE Meldung: „Status not saved — <Grund>".
	let noticeSeq = 0;
	const noticeTimers = new Map<number, ReturnType<typeof setTimeout>>();
	let lastServerError: { id: number; text: string; at: number } | null = null;

	function clearNoticeTimer(id: number) {
		const t = noticeTimers.get(id);
		if (t) clearTimeout(t);
		noticeTimers.delete(id);
	}

	function dismissNotice(id: number) {
		clearNoticeTimer(id);
		notices = notices.filter((n) => n.id !== id);
	}

	function pushNotice(text: string, kind: Notice['kind'], link?: Notice['link'], duration = 4000): number {
		const same = notices.find((n) => n.text === text && n.kind === kind);
		if (same) {
			if (kind === 'info') {
				clearNoticeTimer(same.id);
				noticeTimers.set(same.id, setTimeout(() => dismissNotice(same.id), duration));
			}
			return same.id;
		}
		const n: Notice = { id: ++noticeSeq, text, kind, ...(link ? { link } : {}) };
		// Zugleich höchstens drei Fehlermeldungen und ein Hinweis.
		const all = [...notices, n];
		const keep = new Set([
			...all.filter((x) => x.kind === 'error').slice(-3).map((x) => x.id),
			...all.filter((x) => x.kind === 'info').slice(-1).map((x) => x.id)
		]);
		for (const x of notices) if (!keep.has(x.id)) clearNoticeTimer(x.id);
		notices = all.filter((x) => keep.has(x.id));
		if (kind === 'info') noticeTimers.set(n.id, setTimeout(() => dismissNotice(n.id), duration));
		return n.id;
	}

	// Folgt auf eine Serverantwort mit Grund gleich die allgemeine Meldung des
	// Aufrufers, wird daraus eine: „<allgemein> — <Grund>".
	function mergeWithServerError(text: string): boolean {
		const recent = lastServerError && Date.now() - lastServerError.at < 400 ? lastServerError : null;
		lastServerError = null;
		if (!recent || !notices.some((n) => n.id === recent.id)) return false;
		if (text !== recent.text) {
			const merged = `${text.replace(/[.\s]+$/, '')} — ${recent.text}`;
			notices = notices.map((n) => (n.id === recent.id ? { ...n, text: merged } : n));
		}
		return true;
	}

	function showServerError(text: string, link?: Notice['link']) {
		const id = pushNotice(text, 'error', link);
		lastServerError = { id, text, at: Date.now() };
	}

	/** Etwas ging nicht: die Meldung bleibt stehen, bis man sie schließt. */
	function showError(text: string, link?: Notice['link']) {
		if (mergeWithServerError(text)) return;
		pushNotice(text, 'error', link);
	}

	/** Ein Hinweis, der nach einigen Sekunden verschwindet (kein Fehler). */
	function showAiNotification(text: string) {
		pushNotice(text, 'info');
	}

	/** Weg zu einem Naming in der Naming-Liste, mit Rückweg auf diese Karte. */
	function namingsHref(id: string): string {
		const pid = initialData.projectId;
		return viewHref(`/projects/${pid}/namings`, { focus: id, from: `/projects/${pid}/maps/${mapMeta.id}` });
	}

	// Ein Naming dieser Karte in den Blick holen. Die Seite meldet, wie (sie
	// kennt Ausschnitt und Positionen); ohne sie wird es nur hervorgehoben.
	let revealHandler: ((id: string, opts?: RevealOptions) => void) | null = null;
	function revealNaming(id: string, opts: RevealOptions = {}) {
		if (revealHandler) { revealHandler(id, opts); return; }
		flash(id);
		if (opts.stack) void openStack(id);
	}

	/** Fehlertext einer Map-Antwort, sonst der allgemeine. */
	function responseError(res: MapResponse, fallback: string): string {
		const e = res.data?.error;
		return typeof e === 'string' && e.trim() ? e.trim() : fallback;
	}

	async function toggleAi() {
		const next = !aiEnabled;
		await mapAction('toggleAi', { enabled: next });
		aiEnabled = next;
	}

	// Discussion
	async function submitDiscussion() {
		if (!stackId || !discussInput.trim() || discussLoading) return;
		discussLoading = true;
		try {
			const result = await mapAction('discussCue', { namingId: stackId, message: discussInput.trim() });
			if (!result) { showError('Discussion failed (server error)'); return; }
			discussInput = '';
			await refreshStack();
			await reload();
		} catch {
			showError('Discussion failed');
		} finally {
			discussLoading = false;
		}
	}

	/** Antwort der KI auf die Nachricht der Forscherin (oder null). */
	async function submitMemoDiscussion(memoId: string): Promise<{ response?: string } | null> {
		if (!memoDiscussInput.trim() || memoDiscussLoading) return null;
		memoDiscussLoading = true;
		const message = memoDiscussInput.trim();
		try {
			const result = await mapAction('discussMemo', { memoId, message });
			if (!result) { showError('Memo discussion failed'); return null; }
			memoDiscussInput = '';
			if (memoPanel?.id === memoId) {
				memoPanelThread = [
					...memoPanelThread,
					{ role: 'researcher', content: message },
					...(result.response ? [{ role: 'ai' as const, content: String(result.response) }] : [])
				];
			}
			await refreshStack();
			return result;
		} catch {
			showError('Memo discussion failed');
			return null;
		} finally {
			memoDiscussLoading = false;
		}
	}

	async function updateMemoStatus(memoId: string, status: string): Promise<boolean> {
		const res = await mapAction('updateMemoStatus', { memoId, status });
		if (!res) { showError('Status not saved'); return false; }
		// Refresh stack to show updated status
		await refreshStack();
		// Beurteilt (auch aus dem Stack): die Cowork-Karte zeigt nur noch Unbewertete.
		void loadPresentedMemos();
		return true;
	}

	async function promoteMemo(memoId: string): Promise<boolean> {
		const result = await mapAction('promoteMemo', { memoId });
		if (!result) { showError('Promote failed'); return false; }
		// Refresh stack and reload map (new naming on map)
		await refreshStack();
		await reload();
		void loadPresentedMemos();
		return true;
	}

	// ─── Cowork-Karte: Urteil oder Schließen ohne Urteil ───
	// Schließen (×, Escape, Klick daneben) lässt das Memo, wie es ist
	// („presented"). Ein Urteil setzt den Status wirklich — dieselben Aktionen
	// wie im Stack-Panel (ack, dismiss, promote; link und discuss ohne Urteil).
	async function judgeMemoPanel(verdict: MemoVerdict) {
		const p = memoPanel;
		if (!p?.id || memoPanelBusy) return;
		memoPanelBusy = true;
		try {
			const ok = verdict === 'promoted' ? await promoteMemo(p.id) : await updateMemoStatus(p.id, verdict);
			if (!ok) return;
			const word = verdict === 'acknowledged' ? 'acknowledged' : verdict === 'dismissed' ? 'dismissed' : 'promoted to a naming';
			showAiNotification(`Memo ${word}.`);
			if (memoPanel?.id === p.id) closeMemoPanel();
			if (verdict !== 'promoted') await reload();
		} finally {
			memoPanelBusy = false;
		}
	}

	async function createClarkeQuestionMemo(question: string, content: string) {
		if (!stackId || !content.trim()) return;
		// Die Antwort auf eine Frage zu DIESEM Naming ist ein Memo zu ihm — ein
		// Akt in seinem Stack, kein eigenes Memo-Naming (siehe noteOnNaming).
		const res = await mapAction('note', { namingId: stackId, memoText: `${question}\n\n${content.trim()}` });
		if (!res) { showError('Memo not saved'); return; }
		clarkeFormOpen = false;
		clarkeFormQuestion = '';
		clarkeFormContent = '';
		await afterNote();
	}

	// Memo ZU einem Naming: das Stack-Panel öffnet sich mit offenem Memo-Feld.
	// Der Akt geht in den Stack dieses Namings (Aktion `note`).
	let noteOpenFor = $state<string | null>(null);

	async function openNamingMemo(namingId: string) {
		noteOpenFor = namingId;
		if (stackId !== namingId) await loadStack(namingId);
	}

	/** Nach einem Memo-Akt: Stack neu laden, Karte neu laden (die Designation
	 *  kann von cue auf characterization gestiegen sein). */
	async function afterNote() {
		noteOpenFor = null;
		await refreshStack();
		await reload();
	}

	/** Die Karte schließen, ohne zu urteilen — das Memo bleibt „presented". */
	function closeMemoPanel() {
		const id = memoPanel?.id;
		memoPanel = null;
		memoPanelThread = [];
		if (id && memoDiscussTarget === id) memoDiscussTarget = null;
		if (id && memoLinkTarget === id) cancelMemoLink();
	}

	/** KI-Memo in der Karte zeigen — neu (SSE ai:memo) oder wieder geöffnet
	 *  aus MAP MEMOS, dann mit dem bisherigen Gespräch. */
	function presentMemo(p: MemoPanelData, thread: { role: 'researcher' | 'ai'; content: string }[] = []) {
		const title = p.title.replace(AI_MEMO_TITLE_PREFIX, '') || p.title;
		memoPanel = { id: p.id, title, content: p.content, linkedIds: p.linkedIds, authorId: p.authorId };
		memoPanelThread = thread;
		if (p.id && !presentedMemos.some((m) => m.id === p.id)) {
			presentedMemos = [{ ...memoPanel, thread }, ...presentedMemos];
		}
	}

	/** Vorgelegte, noch nicht beurteilte Cowork-Memos dieser Map: mit der Map
	 *  selbst oder mit einem Naming auf ihr verknüpft. */
	async function loadPresentedMemos() {
		const forMap = mapMeta.id;
		try {
			const res = await fetch(`/api/projects/${initialData.projectId}/memos`);
			if (!res.ok || forMap !== mapMeta.id) return;
			const all: any[] = await res.json();
			const onMap = new Set<string>([forMap, ...elements.map((e: any) => e.naming_id), ...relations.map((r: any) => r.naming_id), ...silences.map((x: any) => x.naming_id)]);
			presentedMemos = all
				.filter((m) => m.isAiAuthored && m.status === 'presented' && (m.links ?? []).some((l: any) => onMap.has(l.id)))
				.map((m) => ({
					id: m.id as string,
					title: String(m.label ?? '').replace(AI_MEMO_TITLE_PREFIX, '') || String(m.label ?? ''),
					content: String(m.content ?? ''),
					linkedIds: (m.links ?? []).map((l: any) => l.id as string),
					authorId: String(m.created_by ?? ''),
					thread: (m.discussion ?? [])
						.filter((d: any) => typeof d.content === 'string' && d.content.trim())
						.map((d: any) => ({ role: d.role === 'ai' ? ('ai' as const) : ('researcher' as const), content: d.content as string }))
				}));
		} catch {
			// Ohne Netz bleibt die Liste, wie sie war.
		}
	}

	function openMemoCreate(linkedIds: string[] = []) {
		// Ein Memo zu genau EINEM Naming ist kein eigenes Naming, sondern ein Akt
		// in dessen Stack. Das Memo-Formular hier bleibt den analytischen Memos:
		// frei, zur Karte, zu einer Konstellation mehrerer Namings.
		if (linkedIds.length === 1 && linkedIds[0] !== mapMeta.id && findNode(linkedIds[0])) {
			void openNamingMemo(linkedIds[0]);
			return;
		}
		memoCreateLinkedIds = linkedIds;
		memoCreateTitle = '';
		memoCreateContent = '';
		memoCreateOpen = true;
	}

	async function createMapMemo() {
		if (!memoCreateTitle.trim() || memoCreateSaving) return;
		memoCreateSaving = true;
		try {
			const res = await fetch(`/api/projects/${initialData.projectId}/memos`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					label: memoCreateTitle.trim(),
					content: memoCreateContent.trim(),
					linkedElementIds: memoCreateLinkedIds
				})
			});
			if (!res.ok) { showError('Memo not saved'); return; }
			const created = await res.json().catch(() => null);
			const linked = memoCreateLinkedIds;
			// Ein Memo zur Karte oder ein freies hat auf der Karte keinen Platz
			// (der Abschnitt „Map Memos" ist entfernt, BJ 09.11.); der Hinweis
			// sagt, wo es steht.
			if (created?.id && (linked.length === 0 || linked.includes(mapMeta.id))) {
				pushNotice('Memo saved — map memos are on the Memos page.', 'info',
					{ href: `/projects/${initialData.projectId}/memos/${created.id}`, label: 'Open it' }, 8000);
			}
			memoCreateOpen = false;
			memoCreateTitle = '';
			memoCreateContent = '';
			memoCreateLinkedIds = [];
			await reload();
			// Das offene Stack-Panel zeigt das neue Memo sofort.
			if (stackId && linked.includes(stackId)) await refreshStack();
		} finally {
			memoCreateSaving = false;
		}
	}

	function cancelMemoCreate() {
		memoCreateOpen = false;
		memoCreateTitle = '';
		memoCreateContent = '';
		memoCreateLinkedIds = [];
	}

	// Memo-to-memo linking
	let memoLinkTarget = $state<string | null>(null);
	let memoLinkSearch = $state('');
	let memoLinkResults = $state<any[]>([]);
	let memoLinkLoading = $state(false);

	async function searchMemosForLink(query: string) {
		if (query.trim().length < 2) { memoLinkResults = []; return; }
		memoLinkLoading = true;
		const res = await fetch(`/api/projects/${initialData.projectId}/memos`);
		if (res.ok) {
			const all = await res.json();
			const q = query.toLowerCase();
			memoLinkResults = all
				.filter((m: any) => m.id !== memoLinkTarget && (m.inscription?.toLowerCase().includes(q) || m.content?.toLowerCase().includes(q)))
				.slice(0, 8);
		}
		memoLinkLoading = false;
	}

	async function linkMemoToMemo(sourceMemoId: string, targetMemoId: string) {
		const res = await fetch(`/api/projects/${initialData.projectId}/memos`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				label: 'Link: memo reference',
				content: '',
				linkedElementIds: [sourceMemoId, targetMemoId]
			})
		}).catch(() => null);
		memoLinkTarget = null;
		memoLinkSearch = '';
		memoLinkResults = [];
		if (res?.ok) showAiNotification('Memos linked.');
		else showError('Link not saved');
		await refreshStack();
	}

	function cancelMemoLink() {
		memoLinkTarget = null;
		memoLinkSearch = '';
		memoLinkResults = [];
	}

	// Outside participations
	async function showOutsideParticipations(namingId: string) {
		if (outsideId === namingId) { outsideId = null; outsideData = null; return; }
		outsideId = namingId;
		outsideLoading = true;
		const res = await mapAction('getOutsideParticipations', { namingId });
		outsideData = res.participations || [];
		outsideLoading = false;
	}

	async function pullOntoMap(namingId: string) {
		await mapAction('placeExisting', { namingId });
		await reload();
		if (outsideId) {
			const res = await mapAction('getOutsideParticipations', { namingId: outsideId });
			outsideData = res.participations || [];
		}
	}

	// Phases
	async function addPhase() {
		if (!newPhaseLabel.trim()) return;
		await mapAction('createPhase', { inscription: newPhaseLabel.trim() });
		newPhaseLabel = '';
		showPhaseForm = false;
		await reload();
	}

	// Zugehörigkeit sofort am Knoten zeigen (Punkt, Zähler, Liste); das
	// Neuladen bestätigt sie. Geschrieben wird wie zuvor über die Map-Aktion.
	async function assignToPhaseFn(phaseId: string, namingId: string) {
		const node = findNode(namingId);
		if (node && !node.phase_ids?.includes(phaseId)) node.phase_ids = [...(node.phase_ids ?? []), phaseId];
		await mapAction('assignToPhase', { phaseId, namingId });
		await reload();
	}

	async function removeFromPhaseFn(phaseId: string, namingId: string) {
		const node = findNode(namingId);
		if (node?.phase_ids?.includes(phaseId)) node.phase_ids = node.phase_ids.filter((id: string) => id !== phaseId);
		await mapAction('removeFromPhase', { phaseId, namingId });
		await reload();
	}

	// Eine Phase ist keine Karte: ihr Inhalt auf dieser Karte steht in den
	// Kartendaten (phase_ids). Früher wurde /maps/<phaseId> abgefragt — 404.
	function togglePhase(phaseId: string) {
		expandedPhase = expandedPhase === phaseId ? null : phaseId;
	}

	// Perspectival collapse
	async function pinToLayer(namingId: string, seq: number) {
		await mapAction('setCollapse', { namingId, collapseAt: seq });
		await reload();
	}

	async function unpinLayer(namingId: string) {
		await mapAction('setCollapse', { namingId, collapseAt: null });
		await reload();
	}

	// ─── Sync data from page props ───
	function syncData(data: any) {
		// untrack: syncData läuft in einem Effekt und schreibt mapMeta selbst.
		if (data.map.id !== untrack(() => mapMeta.id)) {
			memoPanel = null;
			memoPanelThread = [];
			presentedMemos = [];
		}
		axes = data.axes || [];
		elements = data.elements;
		relations = data.relations;
		silences = data.silences;
		phases = data.phases;
		docPhases = data.docPhases || [];
		designationProfile = data.designationProfile;
		mapMeta = { id: data.map.id, label: data.map.label, properties: data.map.properties };
	}

	return {
		// Data (getters)
		get axes() { return axes; },
		get elements() { return elements; },
		get relations() { return relations; },
		get silences() { return silences; },
		get phases() { return phases; },
		get docPhases() { return docPhases; },
		get designationProfile() { return designationProfile; },
		get mapType() { return mapType; },
		get allItems() { return allItems; },
		get phaseColorMap() { return phaseColorMap; },
		get isPrimary() { return isPrimary; },
		get withdrawnCount() { return withdrawnCount; },
		/** Zurückgezogene, aus der Lage abgeleitete Relationen (nicht gezeichnet). */
		get withdrawnDerivedCount() { return withdrawnDerivedCount; },
		get hideWithdrawn() { return hideWithdrawn; },
		set hideWithdrawn(v: boolean) { hideWithdrawn = v; },
		get designationCounts() { return designationCounts; },

		// Ausgeblendet (Kern) / verworfen (ai-eval)
		get hiddenCount() { return hiddenCount; },
		get showHidden() { return showHidden; },
		set showHidden(v: boolean) { showHidden = v; },
		isHidden,
		isRejected,
		rejectionOf,
		rejectionLabel,
		set rejectedNamings(v: Map<string, RejectionInfo>) { rejectedNamings = v; },

		// Unresolved tracking
		set positionsRef(v: Map<string, { x: number; y: number }> | null) { positionsRef = v; },
		get listFilter() { return listFilter; },
		set listFilter(v) { listFilter = v; },
		isUnresolved,
		isPlaced,
		unresolvedCount,
		filterItem,
		endpointsOf,
		requestReveal,
		takeReveal,

		// Interaction state (getters/setters)
		get stackId() { return stackId; },
		set stackId(v) { stackRequest++; stackId = v; },
		get stackData() { return stackData; },
		get stackHint() { return stackHint && stackHint.id === stackId ? stackHint.text : null; },
		clearStackHint() { stackHint = null; },
		set stackData(v) { stackData = v; },
		/** Ein Stack ist angefordert, aber noch nicht da. */
		get stackLoading() { return stackId !== null && stackData === null; },
		get memoTip() { return memoTip; },
		get flashId() { return flashId; },
		flash,
		get editingId() { return editingId; },
		set editingId(v) { editingId = v; },
		get editingValue() { return editingValue; },
		set editingValue(v) { editingValue = v; },
		get relatingFrom() { return relatingFrom; },
		set relatingFrom(v) { relatingFrom = v; },
		get relatingTo() { return relatingTo; },
		set relatingTo(v) { relatingTo = v; },
		get reifyTarget() { return reifyTarget; },
		get reifySource() { return reifySource; },
		get actTarget() { return actTarget; },
		set actTarget(v) { actTarget = v; },
		get actType() { return actType; },
		set actType(v) { actType = v; },
		get actNewValue() { return actNewValue; },
		set actNewValue(v) { actNewValue = v; },
		get actMemo() { return actMemo; },
		set actMemo(v) { actMemo = v; },
		get actLinkedIds() { return actLinkedIds; },
		set actLinkedIds(v) { actLinkedIds = v; },
		get showActLinks() { return showActLinks; },
		set showActLinks(v) { showActLinks = v; },
		get actExistingMemos() { return actExistingMemos; },
		/** Beim Moduswechsel zur Relation: die gewählten Enden. */
		get actModeEnds() { return actModeEnds; },
		get assigningToPhase() { return assigningToPhase; },
		set assigningToPhase(v) { assigningToPhase = v; },
		get highlightedPhase() { return highlightedPhase; },
		set highlightedPhase(v) { highlightedPhase = v; },
		get aiEnabled() { return aiEnabled; },
		/** Meldungen über der Karte: Hinweise verschwinden nach 4 s, Fehler
		 *  bleiben, bis sie geschlossen werden. */
		get notices() { return notices; },
		dismissNotice,
		get memoPanel() { return memoPanel; },
		get memoPanelBusy() { return memoPanelBusy; },
		get memoPanelThread() { return memoPanelThread; },
		get outsideId() { return outsideId; },
		set outsideId(v) { outsideId = v; },
		get outsideData() { return outsideData; },
		set outsideData(v) { outsideData = v; },
		get outsideLoading() { return outsideLoading; },

		// Discussion state
		get discussInput() { return discussInput; },
		set discussInput(v) { discussInput = v; },
		get discussLoading() { return discussLoading; },
		get memoDiscussInput() { return memoDiscussInput; },
		set memoDiscussInput(v) { memoDiscussInput = v; },
		get memoDiscussLoading() { return memoDiscussLoading; },
		get memoDiscussTarget() { return memoDiscussTarget; },
		set memoDiscussTarget(v) { memoDiscussTarget = v; },
		get clarkeFormOpen() { return clarkeFormOpen; },
		set clarkeFormOpen(v) { clarkeFormOpen = v; },
		get clarkeFormQuestion() { return clarkeFormQuestion; },
		set clarkeFormQuestion(v) { clarkeFormQuestion = v; },
		get clarkeFormContent() { return clarkeFormContent; },
		set clarkeFormContent(v) { clarkeFormContent = v; },

		// Memo creation
		get memoCreateOpen() { return memoCreateOpen; },
		set memoCreateOpen(v) { memoCreateOpen = v; },
		get memoCreateTitle() { return memoCreateTitle; },
		set memoCreateTitle(v) { memoCreateTitle = v; },
		get memoCreateContent() { return memoCreateContent; },
		set memoCreateContent(v) { memoCreateContent = v; },
		get memoCreateLinkedIds() { return memoCreateLinkedIds; },
		set memoCreateLinkedIds(v) { memoCreateLinkedIds = v; },
		get memoCreateSaving() { return memoCreateSaving; },

		// Memo-to-memo linking
		get memoLinkTarget() { return memoLinkTarget; },
		set memoLinkTarget(v) { memoLinkTarget = v; },
		get memoLinkSearch() { return memoLinkSearch; },
		set memoLinkSearch(v) { memoLinkSearch = v; },
		get memoLinkResults() { return memoLinkResults; },
		get memoLinkLoading() { return memoLinkLoading; },

		// Phase sidebar state
		get showPhaseForm() { return showPhaseForm; },
		set showPhaseForm(v) { showPhaseForm = v; },
		get newPhaseLabel() { return newPhaseLabel; },
		set newPhaseLabel(v) { newPhaseLabel = v; },
		get expandedPhase() { return expandedPhase; },
		get phaseContents() { return phaseContents; },
		/** Mitglieder einer Phase, die auf dieser Karte stehen. */
		phaseCountOnMap(phaseId: string) { return phaseCountsOnMap.get(phaseId) ?? 0; },

		// Helpers
		isWithdrawn,
		isHiddenByFilter,
		isPhaseHighlighted,
		connectionOpacity,
		designationColor,
		designationLabel,
		findNode,
		findInscription,
		linkLabel,
		estimateNodeWidth,

		// API
		mapAction,
		mapRequest,
		revealNaming,
		set revealHandler(fn: ((id: string, opts?: RevealOptions) => void) | null) { revealHandler = fn; },
		reload,
		syncData,

		// Actions
		showStack,
		openStack,
		refreshStack,
		showMemoTip,
		keepMemoTip,
		hideMemoTip,
		hideMemoTipFor,
		submitAct,
		skipAct,
		loadActMemos,
		cancelAct,
		toggleActLink,
		confirmRename,
		startDesignation,
		startRelating,
		completeRelating,
		startMapReify,
		cancelMapReify,
		mapReifyPick,
		switchToEntityOnMap,
		submitRelation,
		cancelRelation,
		toggleWithdraw,
		showAiNotification,
		showError,
		toggleAi,
		submitDiscussion,
		submitMemoDiscussion,
		updateMemoStatus,
		promoteMemo,
		createClarkeQuestionMemo,
		closeMemoPanel,
		presentMemo,
		judgeMemoPanel,
		/** Vorgelegte Cowork-Memos dieser Map — aus MAP MEMOS wieder als Karte öffnen. */
		get presentedMemos() { return presentedMemos; },
		loadPresentedMemos,
		openMemoCreate,
		openNamingMemo,
		afterNote,
		get noteOpenFor() { return noteOpenFor; },
		set noteOpenFor(v) { noteOpenFor = v; },
		createMapMemo,
		cancelMemoCreate,
		searchMemosForLink,
		linkMemoToMemo,
		cancelMemoLink,
		showOutsideParticipations,
		pullOntoMap,
		addPhase,
		assignToPhase: assignToPhaseFn,
		removeFromPhase: removeFromPhaseFn,
		togglePhase,
		pinToLayer,
		unpinLayer,

		// Data needed for API URLs
		projectId: initialData.projectId,
		get mapId() { return mapMeta.id; },
		get mapLabel() { return mapMeta.label; },
		get mapProperties() { return mapMeta.properties; },
	};
}

export function setMapState(state: MapState) {
	setContext(MAP_STATE_KEY, state);
}

export function getMapState(): MapState {
	return getContext<MapState>(MAP_STATE_KEY);
}
