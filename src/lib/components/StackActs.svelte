<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Der Stack eines Namings: jeder Akt, chronologisch, mit dem, was er setzt
  (Inskription, Designation, Modus, Valenz) und dem Memo, das in ihm steht.
  Ein Naming IST diese Schichtung (Session 01: „jedes Naming IST diese Geschichte als Datenobjekt, also seine eigenen Blockchain";
  Session 03: „das ELement IST diese Schichtung seiner Veränderungen").

  Jede Schicht ist aktivierbar (Session 03: „jedes Naming erhält eben einen
  INdex (default ist das oberste), und diser INdex ist sein Collapse"):
  - activate: im Datenraum wird die Schicht wieder die oberste — ein neuer Akt
    im Stack, nichts wird überschrieben (stackLayers.ts, activateLayer);
  - show here: die Karte, auf der der Stack gerade steht, kollabiert auf diese
    Schicht; Liste und andere Karten behalten ihre (collapsePerspective).
  Welche Perspektive welche Schicht zeigt, steht an der Schicht (Session 09:
  Maps „behalten ihre Indizes/Stack-Positionen").
-->
<script lang="ts" module>
	/** inscription '' = ohne eigenen Namen (Relation); valence '' = keine, null = keine erfasst. */
	export type LayerState = { inscription: string | null; designation: string; valence?: string | null };
	export type Perspective = {
		id: string;
		label: string;
		kind: 'map' | 'phase';
		layerSeq: string | null;
		/** false: Index von vor dem 17.11.2026, ohne Akt im Stack. */
		recorded?: boolean;
		readOnly?: boolean;
	};
	export type Act = {
		seq: string | number;
		created_at: string;
		inscription: string | null;
		designation: string | null;
		mode: string | null;
		valence: string | null;
		memo_text: string | null;
		by_inscription: string;
		linked?: { id: string; label: string }[];
		/** Der Akt setzt nur die Designation, verursacht durch das verlinkte Naming (Relation). */
		through?: boolean;
		/** 'act' = naming_act; sonst ein Akt an der Erscheinung unter einer Perspektive. */
		kind?: 'act' | 'situate' | 'unsituate' | 'withdraw' | 'restore' | 'collapse' | 'release' | 'phase-assign' | 'phase-remove';
		map_inscription?: string | null;
		/** Map oder Phase des Akts (Kollaps, Platzieren, Phasen-Zuordnung). */
		map_id?: string | null;
		/** Phase, der das Naming zugeordnet oder aus der es genommen wurde. */
		phase_label?: string | null;
		/** Rolle auf der SW/A-Map (Arena, Soziale Welt, Organisation, Diskurs). */
		sw_role?: string | null;
		/** Erster Akt einer Relation: womit sie gezogen wurde (begründet ihre Anfangsstufe). */
		basis?: string | null;
		/** Merge: Inschrift des aufgenommenen Namings. */
		merged_from?: string | null;
		/** Merge: der Stack des aufgenommenen Namings, unverändert (Zeiten, Autorinnen, Kontexte). */
		absorbed?: Act[];
		/** Merge: Enden des aufgenommenen Namings, falls es einmal Relation war. */
		absorbed_ends?: { source: string; target: string; directed: boolean } | null;
		/** Moduswechsel zur Relation: ihre Enden unter den damaligen Namen. */
		mode_ends?: { source: string; target: string; directed: boolean } | null;
		/** Zustand des Namings auf dieser Schicht (Inschrift + Designation). */
		state?: LayerState | null;
		/** Dieser Akt hat eine frühere Schicht aktiviert: welche. */
		activates?: (LayerState & { at: string }) | null;
		/** Kollaps-Akt einer Perspektive (oder Phasen-Zuordnung): auf welche Schicht. */
		collapse_layer?: (LayerState & { at: string }) | null;
	};
</script>

<script lang="ts">
	import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';
	import { formatWhen } from '$lib/shared/dates.js';
	import { quoted } from '$lib/shared/namingLabel.js';
	import StackActs from './StackActs.svelte';

	let {
		acts,
		pinnedSeq = null,
		currentMap = null,
		onpin,
		onrelease,
		onactivate,
		onlinked,
		ends = null,
		currentLayerSeq = null,
		perspectives = [],
		currentPerspectiveId = null,
		topState = null,
		nested = false
	}: {
		acts: Act[];
		/** Auf diese Schicht kollabiert die Karte, auf der der Stack steht (collapseAt). */
		pinnedSeq?: string | number | null;
		/** Name der Map, auf der der Stack gerade gezeigt wird (dort ohne Map-Namen). */
		currentMap?: string | null;
		/** Diese Karte auf eine Schicht kollabieren (nur auf Karten). */
		onpin?: (seq: string) => void;
		/** Diese Karte wieder der obersten Schicht folgen lassen (nur auf Karten). */
		onrelease?: () => void;
		/** Eine Schicht im Datenraum wieder zur obersten machen; gibt einen Fehlertext zurück oder null. */
		onactivate?: (seq: string, note: { text: string }) => Promise<string | null>;
		/** Klick auf ein verknüpftes Naming. */
		onlinked?: (id: string) => void;
		/** Endpunkte, falls das Naming eine Relation ist (für „as relation"). */
		ends?: { source: string; target: string; directed: boolean } | null;
		/** Die oberste Schicht (Default-Kollaps). */
		currentLayerSeq?: string | null;
		/** Perspektiven, unter denen das Naming erscheint, mit ihrer Schicht (null = oberste). */
		perspectives?: Perspective[];
		/** Die Karte, auf der der Stack gerade steht (erscheint nicht als eigener Chip). */
		currentPerspectiveId?: string | null;
		/** Zustand der obersten Schicht, wenn er nicht in acts steht (Stack eines aufgenommenen Namings). */
		topState?: LayerState | null;
		/** Stack eines aufgenommenen Namings unter dem Merge-Akt. */
		nested?: boolean;
	} = $props();

	function color(d: string | null) {
		return d === 'specification' ? CCS_SPEC : d === 'characterization' ? CCS_CHAR : CCS_CUE;
	}

	// Vorige Inschrift je Akt (Akte kommen chronologisch): Ein Umbenennen
	// ohne Begründung zeigte sonst nur den neuen Namen (Testlauf 09.11.).
	const renamedFrom = $derived.by(() => {
		const out = new Map<string, string>();
		let last: string | null = null;
		for (const a of acts) {
			if (a.kind && a.kind !== 'act') continue;
			if (a.inscription === null) continue;
			if (last !== null && last !== a.inscription && last !== '') out.set(String(a.seq), last);
			last = a.inscription;
		}
		return out;
	});

	const SITUATING_LABEL: Record<string, string> = {
		situate: 'placed on the map',
		unsituate: 'returned to Unplaced',
		withdraw: 'withdrawn',
		restore: 'restored',
		collapse: 'shows the layer',
		release: 'follows the topmost layer again',
		'phase-assign': 'assigned to phase',
		'phase-remove': 'removed from phase'
	};

	const isStateLayer = (a: Act) =>
		(!a.kind || a.kind === 'act') && (a.inscription !== null || a.designation !== null || a.valence !== null);
	const topAct = $derived(acts.find((a) => String(a.seq) === currentLayerSeq) ?? null);
	const currentState = $derived(topAct?.state ?? topState ?? null);
	const normVal = (v: string | null | undefined) => (v ? v : null);
	/** Dieselbe Inschrift, Stufe und (wo erfasst) Valenz: Aktivieren änderte nichts. */
	const sameState = (x: LayerState | null | undefined, y: LayerState | null | undefined) =>
		!!x && !!y && (x.inscription ?? '') === (y.inscription ?? '') && x.designation === y.designation
		&& (x.valence === null || x.valence === undefined || y.valence === null || y.valence === undefined
			|| normVal(x.valence) === normVal(y.valence));
	/** Nach der obersten Schicht folgen noch Einträge (Memos, Akte unter Perspektiven). */
	const topNotLast = $derived.by(() => {
		if (!currentLayerSeq) return false;
		const i = acts.findIndex((a) => String(a.seq) === currentLayerSeq);
		return i >= 0 && i < acts.length - 1;
	});
	/** Die Schicht, die die Karte zeigt, auf der der Stack steht (ohne Index: die oberste). */
	const shownHereSeq = $derived(onpin ? (pinnedSeq != null ? String(pinnedSeq) : currentLayerSeq) : null);
	const followers = $derived(perspectives.filter((p) => p.layerSeq === null && p.id !== currentPerspectiveId));

	function stateLabel(s: LayerState | null | undefined): string {
		if (!s) return '';
		return s.inscription?.trim() ? quoted(s.inscription) : 'without a name of its own';
	}
	/** Eine Schicht für Knöpfe und Vorleser: Name, Stufe, Zeit. */
	function layerName(a: Act): string {
		return `${stateLabel(a.state)} ${a.state?.designation ?? ''} of ${formatWhen(a.created_at)}`.replace(/\s+/g, ' ').trim();
	}
	function valenceNote(s: LayerState | null | undefined): string {
		if (!s || s.valence === null || s.valence === undefined) return '';
		return s.valence ? `valence: ${s.valence}` : 'no valence';
	}
	function perspectiveName(p: Perspective) {
		return p.kind === 'phase' ? `phase ${p.label}` : p.label;
	}

	// Aktivieren: kleines Formular unter der Schicht (Notiz freiwillig).
	let activatingSeq = $state<string | null>(null);
	let actMemo = $state('');
	let actError = $state<string | null>(null);
	let busy = $state(false);

	function openActivate(seq: string) {
		activatingSeq = seq;
		actMemo = '';
		actError = null;
	}
	let listEl = $state<HTMLOListElement | null>(null);
	/** Nach dem Formular: Fokus zurück auf den Knopf der Schicht (oder die Liste). */
	function refocus(seq: string) {
		requestAnimationFrame(() => {
			const btn = listEl?.querySelector<HTMLElement>(`[data-activate="${seq}"]`);
			if (btn) btn.focus();
			else listEl?.focus();
		});
	}
	function cancelActivate() {
		const seq = activatingSeq;
		activatingSeq = null;
		actMemo = '';
		actError = null;
		if (seq) refocus(seq);
	}
	async function doActivate(seq: string, withMemo: boolean) {
		if (!onactivate || busy) return;
		busy = true;
		actError = null;
		try {
			const err = await onactivate(seq, { text: withMemo ? actMemo.trim() : '' });
			if (err) actError = err;
			else cancelActivate();
		} finally {
			busy = false;
		}
	}
	// Zwei schnelle Klicks auf „show here" / „follow topmost" sind ein Akt.
	let pinBusy = $state(false);
	async function guarded(fn: (() => unknown) | undefined) {
		if (!fn || pinBusy) return;
		pinBusy = true;
		try {
			await fn();
		} finally {
			pinBusy = false;
		}
	}
	function focusOnMount(node: HTMLTextAreaElement) {
		queueMicrotask(() => node.focus());
	}
</script>

{#if !nested && topNotLast && topAct && currentState}
	<div class="sa-summary">
		Topmost layer: <strong>{stateLabel(currentState)}</strong>
		<span style="color: {color(currentState.designation)}">{currentState.designation}</span>
		{#if valenceNote(currentState)}<span class="sa-tag">{valenceNote(currentState)}</span>{/if}
		of {formatWhen(topAct.created_at)} — entries after it are memos and acts under perspectives.
	</div>
{/if}
<ol class="stack-acts" bind:this={listEl} tabindex="-1">
	{#each acts as a (a.seq)}
		{#if a.kind && a.kind !== 'act'}
			{@const here = a.map_id ? a.map_id === currentPerspectiveId : a.map_inscription === currentMap}
			<li class="sa sa-situating" class:sa-out={a.kind === 'withdraw' || a.kind === 'unsituate' || a.kind === 'phase-remove'}
				class:sa-collapse={a.kind === 'collapse' || a.kind === 'release'}>
				<div class="sa-head">
					<span class="sa-dot sa-dot-none" class:sa-dot-withdrawn={a.kind === 'withdraw'}></span>
					<span class="sa-what">
						{#if (a.kind === 'collapse' || a.kind === 'release') && a.map_inscription && !here}
							<span class="sa-tag" title="Perspective">{a.map_inscription}</span>
						{/if}
						<span class="sa-sit">{SITUATING_LABEL[a.kind] ?? a.kind}</span>
						{#if a.phase_label}<span class="sa-tag" title="Phase">{a.phase_label}</span>{/if}
						{#if (a.kind === 'collapse' || a.kind === 'phase-assign') && a.collapse_layer}
							{#if a.kind === 'phase-assign'}<span class="sa-sit">holding the layer</span>{/if}
							<span class="sa-ins">{stateLabel(a.collapse_layer)}</span>
							<span class="sa-des" style="color: {color(a.collapse_layer.designation)}">{a.collapse_layer.designation}</span>
							<span class="sa-tag" title={a.kind === 'phase-assign' ? 'The layer that was topmost when the naming was assigned; the phase keeps it' : 'The layer this perspective collapses onto'}>of {formatWhen(a.collapse_layer.at)}</span>
						{/if}
						{#if a.kind !== 'collapse' && a.kind !== 'release' && a.map_inscription && a.map_inscription !== currentMap}<span class="sa-tag" title="Map">{a.map_inscription}</span>{/if}
						{#if (a.kind === 'collapse' || a.kind === 'release') && a.map_inscription && here}<span class="sa-tag">this map</span>{/if}
						{#if a.kind === 'situate' && a.sw_role}<span class="sa-tag" title="Role on this map">as {a.sw_role.replace(/-/g, ' ')}</span>{/if}
					</span>
					<span class="sa-by">{a.by_inscription}</span>
					<span class="sa-date">{formatWhen(a.created_at)}</span>
				</div>
			</li>
		{:else}
		{@const seq = String(a.seq)}
		{@const stateLayer = isStateLayer(a)}
		{@const isTop = stateLayer && seq === currentLayerSeq}
		{@const shownHere = stateLayer && shownHereSeq === seq}
		{@const pinnedHere = perspectives.filter((p) => p.layerSeq === seq && p.id !== currentPerspectiveId)}
		<li class="sa" class:sa-pinned={shownHere} class:sa-top={isTop}>
			<div class="sa-head">
				{#if a.activates && a.state}
					<span class="sa-dot" style="background: {color(a.state.designation)}" title={a.state.designation}></span>
				{:else if a.designation}
					<span class="sa-dot" style="background: {color(a.designation)}" title={a.designation}></span>
				{:else}
					<span class="sa-dot sa-dot-none"></span>
				{/if}
				<span class="sa-what">
					{#if a.merged_from}<span class="sa-sit">merged in {quoted(a.merged_from)}</span>{/if}
					{#if a.activates}
						<span class="sa-sit sa-activated" title="This act made an earlier layer the topmost again">activated the layer</span>
						<span class="sa-ins">{stateLabel(a.activates)}</span>
						<span class="sa-des" style="color: {color(a.activates.designation)}">{a.activates.designation}</span>
						<span class="sa-tag">of {formatWhen(a.activates.at)}</span>
						{#if a.state && a.state.designation !== a.activates.designation}
							<span class="sa-tag" title="A memo lifts a cue: a reflected cue is at least a characterization">→ <span style="color: {color(a.state.designation)}">{a.state.designation}</span> with the memo</span>
						{/if}
						{#if renamedFrom.has(seq)}<span class="sa-tag">renamed from {quoted(renamedFrom.get(seq) ?? '')}</span>{/if}
					{:else}
					{#if a.inscription}<span class="sa-ins">{quoted(a.inscription)}</span>{:else if a.inscription === '' && isStateLayer(a)}<span class="sa-sit">name removed</span>{/if}
					{#if renamedFrom.has(seq)}<span class="sa-tag">renamed from {quoted(renamedFrom.get(seq) ?? '')}</span>{/if}
					{#if a.designation}<span class="sa-des" style="color: {color(a.designation)}">{a.designation}</span>{/if}
					{/if}
					{#if a.mode}{@const me = a.mode_ends ?? ends}<span class="sa-tag">as {a.mode}{a.mode === 'relation' && me ? `: ${me.source} ${me.directed ? '→' : '↔'} ${me.target}` : ''}</span>{/if}
					{#if !a.activates}{#if a.valence}<span class="sa-tag">valence: {a.valence}</span>{:else if a.valence === ''}<span class="sa-tag">valence removed</span>{/if}{/if}
					{#if !a.inscription && !a.designation && !a.mode && !a.valence && a.memo_text && !a.activates}<span class="sa-tag">memo</span>{/if}
				</span>
				<span class="sa-by">{a.by_inscription}</span>
				<span class="sa-date">{formatWhen(a.created_at)}</span>
			</div>
			{#if stateLayer && (isTop || shownHere || pinnedHere.length > 0 || onactivate || onpin)}
				<div class="sa-layer">
					{#if isTop}
						<span class="sa-badge sa-badge-top"
							title={followers.length > 0
								? `The topmost layer: the list shows it, as does every perspective without a layer of its own (${followers.map(perspectiveName).join(', ')}).`
								: 'The topmost layer: the list shows it, as does every map without a layer of its own.'}>topmost</span>
					{/if}
					{#if shownHere}
						<span class="sa-badge sa-badge-here" title="This map shows the naming on this layer">shown on this map</span>
					{/if}
					{#if !isTop && (onactivate || nested) && sameState(a.state, currentState)}
						<span class="sa-badge sa-badge-same" title="This layer says the same as the topmost layer">same as topmost</span>
					{/if}
					{#if a.activates && valenceNote(a.state)}
						<span class="sa-tag">{valenceNote(a.state)}</span>
					{/if}
					{#each pinnedHere as p (p.id)}
						<span class="sa-badge sa-badge-persp"
							title="{p.kind === 'phase' ? 'This phase' : 'This map'} shows the naming on this layer{p.recorded === false ? ' (set before such changes were recorded as acts)' : ''}">shown on {perspectiveName(p)}</span>
					{/each}
					<span class="sa-layer-actions">
						{#if onpin && !shownHere}
							<button class="sa-btn sa-btn-here" disabled={pinBusy} onclick={() => guarded(() => onpin?.(seq))}
								aria-label="show the layer {layerName(a)} on this map"
								title="Collapse this map onto this layer: it shows {stateLabel(a.state)} as {a.state?.designation}. The list and other maps keep their own layer.">show here</button>
						{/if}
						{#if onpin && isTop && pinnedSeq == null}
							<button class="sa-btn sa-btn-here" disabled={pinBusy} onclick={() => guarded(() => onpin?.(seq))}
								aria-label="keep the layer {layerName(a)} on this map"
								title="This map follows the topmost layer. Keep this layer here, even when the naming changes later.">keep here</button>
						{/if}
						{#if onrelease && pinnedSeq != null && isTop && !shownHere}
							<button class="sa-btn sa-btn-here" disabled={pinBusy} onclick={() => guarded(() => onrelease?.())}
								aria-label="let this map follow the topmost layer"
								title="Let this map follow the topmost layer again">follow topmost</button>
						{/if}
						{#if onactivate && !isTop && !sameState(a.state, currentState)}
							<button class="sa-btn sa-btn-activate" data-activate={seq} onclick={() => openActivate(seq)} aria-expanded={activatingSeq === seq}
								aria-label="activate the layer {layerName(a)}"
								title="Make this layer the topmost again: a new act in the stack, nothing is overwritten. The list and every map without a layer of its own show it.">activate</button>
						{/if}
					</span>
				</div>
			{/if}
			{#if activatingSeq === seq && onactivate}
				<div class="sa-activate" role="group" aria-label="Activate this layer">
					<div class="sa-activate-head">
						Activate this layer: <strong>{stateLabel(a.state)}</strong>
						<span style="color: {color(a.state?.designation ?? null)}">{a.state?.designation}</span>
						{#if valenceNote(a.state)}<span class="sa-tag">{valenceNote(a.state)}</span>{/if}
						of {formatWhen(a.created_at)} becomes the topmost layer again — as a new act; the layers above stay in the stack.
						{#if actMemo.trim() && a.state?.designation === 'cue'}
							<strong>With your memo it becomes a <span style="color: {color('characterization')}">characterization</span></strong> (a reflected cue is at least a characterization); without a memo it stays a cue.
						{/if}
					</div>
					<textarea rows="2" bind:value={actMemo} use:focusOnMount
						placeholder="Why return to this layer? (optional)"
						aria-label="Memo on activating this layer"
						onkeydown={(e) => {
							if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelActivate(); }
							else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); void doActivate(seq, !!actMemo.trim()); }
						}}></textarea>
					{#if !actMemo.trim() && a.state?.designation === 'cue'}
						<div class="sa-hint">A memo lifts the cue to a characterization; “activate without memo” keeps it a cue.</div>
					{/if}
					{#if actError}<div class="sa-error" role="alert">{actError}</div>{/if}
					<div class="sa-activate-actions">
						<button class="sa-btn sa-btn-primary" disabled={!actMemo.trim() || busy} onclick={() => doActivate(seq, true)}
							title="Activate with this memo (Ctrl/⌘+Enter)">activate + memo</button>
						<button class="sa-btn" disabled={busy} onclick={() => doActivate(seq, false)}>activate without memo</button>
						<button class="sa-btn-link" onclick={cancelActivate} title="Nothing changes (Esc)">cancel</button>
					</div>
				</div>
			{/if}
			{#if a.basis}
				<div class="sa-basis">{a.basis}</div>
			{/if}
			{#if a.absorbed && a.absorbed.length > 0}
				<details class="sa-absorbed" open>
					<summary>stack of {quoted(a.merged_from ?? '')} until the merge ({a.absorbed.length})</summary>
					<!-- Die Schichten des aufgenommenen Namings gehören zum Stack des
					     Überlebenden: aktivierbar und auf einer Map zu zeigen. -->
					<StackActs acts={a.absorbed} {currentMap} {onlinked} ends={a.absorbed_ends ?? null}
						nested {onpin} {onactivate} {perspectives} {currentPerspectiveId} {pinnedSeq}
						topState={currentState} />
				</details>
			{/if}
			{#if a.memo_text}
				<div class="sa-memo">{a.memo_text}</div>
			{/if}
			{#if a.linked && a.linked.length > 0}
				<div class="sa-linked">
					{#if a.through}<span class="sa-through">through relation</span>{/if}
					{#each a.linked as l (l.id)}
						{#if onlinked}
							<button class="sa-chip" onclick={() => onlinked?.(l.id)}>{l.label}</button>
						{:else}
							<span class="sa-chip">{l.label}</span>
						{/if}
					{/each}
				</div>
			{/if}
		</li>
		{/if}
	{/each}
</ol>

<style>
	.stack-acts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.sa { border-left: 2px solid #2a2d3a; padding: 0.15rem 0 0.15rem 0.45rem; }
	.sa-top { border-left-color: #6b7280; }
	.sa-pinned { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.07); }
	.sa-head { display: flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem; }
	.sa-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; align-self: center; }
	.sa-dot-none { background: transparent; border: 1px solid #3a3d4a; }
	.sa-what { display: inline-flex; gap: 0.35rem; flex-wrap: wrap; color: #e1e4e8; }
	.sa-ins { color: #e1e4e8; }
	.sa-des { font-size: 0.72rem; }
	.sa-tag { font-size: 0.68rem; color: #8b8fa3; border: 1px solid #2a2d3a; border-radius: 3px; padding: 0 0.25rem; }
	.sa-by { color: #6b7280; font-size: 0.68rem; margin-left: auto; }
	.sa-date { color: #4b5060; font-size: 0.68rem; }
	.sa-layer { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.15rem; }
	.sa-layer-actions { display: inline-flex; gap: 0.3rem; margin-left: auto; }
	.sa-badge { font-size: 0.66rem; border-radius: 3px; padding: 0 0.3rem; border: 1px solid; }
	.sa-badge-top { color: #e1e4e8; border-color: #4b5060; }
	.sa-badge-here { color: #f59e0b; border-color: rgba(245, 158, 11, 0.6); }
	.sa-badge-persp { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }
	.sa-badge-same { color: #8b8fa3; border-color: #2a2d3a; }
	.sa-summary { font-size: 0.72rem; color: #a0a4b0; margin-bottom: 0.35rem; line-height: 1.45; }
	.stack-acts:focus { outline: none; }
	.sa-btn {
		background: none; border: 1px solid #3a3d4a; border-radius: 4px; color: #c4c8d4;
		font-size: 0.7rem; padding: 0.05rem 0.45rem; cursor: pointer;
	}
	.sa-btn:disabled { opacity: 0.45; cursor: default; }
	.sa-btn-here { border-color: rgba(245, 158, 11, 0.6); color: #f59e0b; }
	.sa-btn-here:hover { background: rgba(245, 158, 11, 0.1); }
	.sa-btn-activate { border-color: rgba(139, 156, 247, 0.6); color: #8b9cf7; }
	.sa-btn-activate:hover, .sa-btn-activate[aria-expanded='true'] { background: rgba(139, 156, 247, 0.12); }
	.sa-btn-primary { border-color: #8b9cf7; color: #e1e4e8; background: rgba(139, 156, 247, 0.18); }
	.sa-btn-link { background: none; border: none; color: #8b8fa3; font-size: 0.7rem; cursor: pointer; text-decoration: underline; }
	.sa-activate {
		margin: 0.3rem 0 0.2rem; padding: 0.4rem 0.5rem; border: 1px solid rgba(139, 156, 247, 0.4);
		border-radius: 5px; background: rgba(139, 156, 247, 0.06); display: flex; flex-direction: column; gap: 0.3rem;
	}
	.sa-activate-head { font-size: 0.74rem; color: #c4c8d4; line-height: 1.4; }
	.sa-activate textarea {
		width: 100%; box-sizing: border-box; background: #12141c; color: #e1e4e8; border: 1px solid #2a2d3a;
		border-radius: 4px; font: inherit; font-size: 0.76rem; padding: 0.3rem 0.4rem; resize: vertical;
	}
	.sa-activate-actions { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
	.sa-hint { font-size: 0.68rem; color: #8b8fa3; }
	.sa-error { font-size: 0.72rem; color: #f87171; }
	.sa-activated { color: #8b9cf7; }
	.sa-basis { margin-top: 0.1rem; font-size: 0.68rem; color: #8b8fa3; font-style: italic; }
	.sa-memo {
		margin-top: 0.15rem; font-size: 0.76rem; color: #c4c8d4; white-space: pre-wrap;
		line-height: 1.45; border-left: 2px solid rgba(245, 158, 11, 0.45); padding-left: 0.4rem;
	}
	.sa-linked { display: flex; flex-wrap: wrap; gap: 0.2rem; margin-top: 0.2rem; }
	.sa-chip {
		font-size: 0.68rem; color: #a0a4b0; background: #1e2030; border: 1px solid #2a2d3a;
		border-radius: 10px; padding: 0 0.4rem; cursor: default;
	}
	button.sa-chip { cursor: pointer; }
	.sa-absorbed { margin: 0.25rem 0 0.1rem; padding-left: 0.35rem; border-left: 1px dotted #3a3d4a; }
	.sa-absorbed > summary { font-size: 0.68rem; color: #6b7280; cursor: pointer; margin-bottom: 0.2rem; }
	.sa-situating { border-left-style: dashed; }
	.sa-collapse { border-left-color: rgba(245, 158, 11, 0.5); }
	.sa-sit { color: #8b8fa3; font-size: 0.72rem; }
	.sa-out .sa-sit { color: #6b7280; }
	.sa-dot-withdrawn { border-color: #f87171; }
	.sa-through { font-size: 0.66rem; color: #6b7280; align-self: center; }
	button.sa-chip:hover { border-color: #8b9cf7; color: #e1e4e8; }
</style>
