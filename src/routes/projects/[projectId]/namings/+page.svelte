<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';
	import NamingRow, { type NamingActions } from '$lib/components/NamingRow.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import FilterBar, { type FilterGroup, type Toggle } from '$lib/components/FilterBar.svelte';

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
		appears_on_maps: { id: string; label: string }[] | null;
		created_at: string;
		seq: string;
	};

	type StackData = {
		inscriptions: any[];
		designations: any[];
		memos: any[];
		annotations?: any[];
		discussion?: any[];
		aiReasoning?: string | null;
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
	};

	// ---- State ----
	let namings = $derived<NamingRow[]>(data.namings);
	let phases = $derived<any[]>(data.phases ?? []);
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

	// Local withdrawn set (keeps items visible until next page load)
	let localWithdrawn = $state<Set<string>>(new Set());

	// 8-second persistence after any filter-mutating action so the user can
	// see the result of their click before the item leaves the filtered view.
	const RECENTLY_TOUCHED_MS = 8000;
	let recentlyTouched = $state<Set<string>>(new Set());

	function markTouched(namingId: string) {
		const next = new Set(recentlyTouched);
		next.add(namingId);
		recentlyTouched = next;
		setTimeout(() => {
			const after = new Set(recentlyTouched);
			after.delete(namingId);
			recentlyTouched = after;
		}, RECENTLY_TOUCHED_MS);
	}

	// ---- Helpers ----
	function designationColor(d: string | null | undefined) {
		if (d === 'specification') return CCS_SPEC;
		if (d === 'characterization') return CCS_CHAR;
		return CCS_CUE;
	}

	function isWithdrawn(namingId: string, props: any): boolean {
		return localWithdrawn.has(namingId) || props?.withdrawn === true || props?.aiWithdrawn === true;
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
		const keepTouched = (n: NamingRow) => recentlyTouched.has(n.naming_id);

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
				const persona = (n as any).ai_persona as string | null;
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
			result = result.filter(n => keepTouched(n) || !isWithdrawn(n.naming_id, n.properties));
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(n =>
				keepTouched(n) || (n.current_inscription || n.inscription).toLowerCase().includes(q)
			);
		}
		return result;
	});

	// Mode is a per-appearance collapse, not a naming category. Entities and
	// relations share one list; silences stay separate because absence is a
	// distinct analytical move (Barad) rather than a mode of the same gesture.
	const entitiesAndRelations = $derived(filtered.filter(n => n.mode !== 'silence'));
	const silences = $derived(filtered.filter(n => n.mode === 'silence'));

	const counts = $derived({
		total: (namings as NamingRow[]).length,
		cue: (namings as NamingRow[]).filter(n => (n.designation || 'cue') === 'cue').length,
		char: (namings as NamingRow[]).filter(n => n.designation === 'characterization').length,
		spec: (namings as NamingRow[]).filter(n => n.designation === 'specification').length
	});

	// ---- API ----
	async function apiAction(action: string, params: Record<string, any> = {}) {
		const res = await fetch(`/api/projects/${data.projectId}/namings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...params })
		});
		return res.json();
	}

	// ---- Create ----
	async function createNaming() {
		if (!newNamingValue.trim() || creatingNaming) return;
		creatingNaming = true;
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
			// Second click: stage target for confirmation
			relateTarget = namingId;
		} else if (relateSource === namingId) {
			// Clicked same naming again: cancel
			relateSource = null;
			relateTarget = null;
		} else {
			relateSource = namingId;
			relateTarget = null;
		}
	}

	async function confirmRelate() {
		if (!relateSource || !relateTarget) return;
		const srcId = relateSource;
		const tgtId = relateTarget;
		const result = await apiAction('relate', { sourceId: srcId, targetId: tgtId });
		relateSource = null;
		relateTarget = null;
		if (result.error) {
			alert(result.error);
		} else {
			// Mark source and target so the user sees them flagged after the
			// relation is created. (The new relation naming itself is not
			// returned by the API; an active mode filter on it is unhandled.)
			markTouched(srcId);
			markTouched(tgtId);
			const module = await import('$app/navigation');
			module.invalidateAll();
		}
	}

	function cancelRelate() {
		relateSource = null;
		relateTarget = null;
	}

	// ---- Act-prompt actions ----
	async function submitAct() {
		if (!actTarget) return;
		const touchedId = actTarget;

		if (actType === 'rename') {
			await apiAction('rename', {
				namingId: actTarget,
				inscription: actNewValue,
				memoText: actMemo,
				linkedNamingIds: actLinkedIds
			});
		} else if (actType === 'designate') {
			await apiAction('designate', {
				namingId: actTarget,
				designation: actNewValue,
				memoText: actMemo,
				linkedNamingIds: actLinkedIds
			});
		}

		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		markTouched(touchedId);
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	async function skipAct() {
		if (!actTarget) return;
		const touchedId = actTarget;

		if (actType === 'rename') {
			await apiAction('rename', { namingId: actTarget, inscription: actNewValue });
		} else if (actType === 'designate') {
			await apiAction('designate', { namingId: actTarget, designation: actNewValue });
		}

		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
		markTouched(touchedId);
		const module = await import('$app/navigation');
		module.invalidateAll();
	}

	function cancelAct() {
		actTarget = null;
		actMemo = '';
		actLinkedIds = [];
	}

	// ---- Memo Status ----
	async function setMemoStatus(memoId: string, status: string) {
		await fetch(`/api/projects/${data.projectId}/memos/${memoId}/status`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status })
		});
		// Refresh the stack to show updated status
		if (stackId) {
			stackData = await apiAction('getStack', { namingId: stackId });
		}
	}

	// ---- Withdraw ----
	async function withdraw(namingId: string) {
		// Mark locally first so the item stays in place with visual feedback
		localWithdrawn = new Set([...localWithdrawn, namingId]);
		markTouched(namingId);
		await apiAction('withdraw', { namingId });
		// Don't invalidate — item stays visible (struck through) until next navigation
	}

	// ---- Merge ----
	let mergeTargetId = $state<string | null>(null);

	function startMerge(survivorId: string) {
		mergeSurvivorId = survivorId;
		mergeTargetId = null;
	}

	function selectMergeTarget(mergedId: string) {
		if (!mergeSurvivorId || mergedId === mergeSurvivorId) return;
		mergeTargetId = mergedId;
	}

	async function confirmMerge() {
		if (!mergeSurvivorId || !mergeTargetId) return;
		const survivorId = mergeSurvivorId;
		const result = await apiAction('merge', { survivorId, mergedId: mergeTargetId });
		if (result.error) {
			alert(result.error);
		} else {
			markTouched(survivorId);
		}
		mergeSurvivorId = null;
		mergeTargetId = null;
		const module = await import('$app/navigation');
		module.invalidateAll();
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
			value: filterGrounding,
			options: [
				{ value: 'all', label: 'All' },
				{ value: 'grounded', label: 'Doc', icon: '/icons/text_snippet.svg' },
				{ value: 'memo', label: 'Memo', icon: '/icons/stylus_note.svg' },
				{ value: 'ungrounded', label: 'None', icon: '/icons/question_mark.svg' }
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

	const filterToggles: Toggle[] = $derived([
		{ label: 'Hide withdrawn', value: hideWithdrawn, onchange: (v: boolean) => hideWithdrawn = v },
		{ label: 'Hide Cowork', value: hideCowork, onchange: (v: boolean) => hideCowork = v },
		{ label: 'Hide Autonoma', value: hideAutonoma, onchange: (v: boolean) => hideAutonoma = v }
	]);

	// Adapter that routes NamingRow callbacks to page-level functions/state.
	// Closures here read the latest reactive values via lexical binding.
	const namingsActions: NamingActions = {
		findInscription: (id: string | null) => {
			if (!id) return '?';
			const n = findNaming(id);
			return n ? (n.current_inscription || n.inscription || '?') : '?';
		},
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
		onWithdraw: (id: string) => withdraw(id),
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
			<!-- Relate mode indicator -->
			{#if relateSource}
				{@const srcNaming = findNaming(relateSource)}
				<div class="relate-banner">
					{#if relateTarget}
						{@const tgtNaming = findNaming(relateTarget)}
						Relate: <strong>{srcNaming?.current_inscription || srcNaming?.inscription}</strong> → <strong>{tgtNaming?.current_inscription || tgtNaming?.inscription}</strong>
						<button class="btn-xs btn-confirm" onclick={confirmRelate}>ok</button>
						<button class="btn-xs" onclick={cancelRelate}>cancel</button>
					{:else}
						Relating: <strong>{srcNaming?.current_inscription || srcNaming?.inscription}</strong> — click another naming to connect
						<button class="btn-xs" onclick={cancelRelate}>cancel</button>
					{/if}
				</div>
			{/if}

			<!-- Merge mode indicator -->
			{#if mergeSurvivorId}
				{@const survNaming = findNaming(mergeSurvivorId)}
				<div class="relate-banner merge-banner">
					{#if mergeTargetId}
						{@const tgtNaming = findNaming(mergeTargetId)}
						Merge <strong>"{tgtNaming?.current_inscription || tgtNaming?.inscription}"</strong> into <strong>"{survNaming?.current_inscription || survNaming?.inscription}"</strong>?
						All participations, appearances, and annotations transfer to the survivor.
						<button class="btn-xs btn-confirm" onclick={confirmMerge}>merge</button>
						<button class="btn-xs" onclick={cancelMerge}>cancel</button>
					{:else}
						Merge into <strong>"{survNaming?.current_inscription || survNaming?.inscription}"</strong> — click the naming to absorb
						<button class="btn-xs" onclick={cancelMerge}>cancel</button>
					{/if}
				</div>
			{/if}

			<!-- Act-prompt bar -->
			{#if actTarget}
				{@const targetNaming = findNaming(actTarget)}
				{@const allOtherNamings = (namings as NamingRow[]).filter(n => n.naming_id !== actTarget && n.mode !== 'relation')}
				<div class="act-prompt-bar">
					<div class="act-header">
						{#if actType === 'rename'}
							Rename: <strong>{targetNaming?.current_inscription || targetNaming?.inscription}</strong> → <strong>{actNewValue}</strong>
						{:else if actType === 'designate'}
							Designation: <strong>{targetNaming?.current_inscription || targetNaming?.inscription}</strong> →
							<span style="color: {designationColor(actNewValue)}">{actNewValue}</span>
						{/if}
					</div>
					<textarea
						placeholder="What influenced this act? What changed in your understanding?"
						bind:value={actMemo}
						rows="2"
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
						<button class="btn-link-toggle" onclick={() => showActLinks = !showActLinks}>
							{showActLinks ? 'hide links' : 'link namings...'}
						</button>
						<div class="act-actions">
							<button class="btn-primary btn-sm-primary" onclick={submitAct}>Apply + memo</button>
							<button class="btn-link" onclick={skipAct}>skip memo</button>
							<button class="btn-link" onclick={cancelAct}>cancel</button>
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
					<a href="/projects/{data.projectId}/maps/{m.id}" class="map-link">{m.label}</a>
				{/each}
			</div>
		{/if}
	{/snippet}

	{#snippet stackPanelFor(n: NamingRow, includeMemos: boolean)}
		{#if stackId === n.naming_id && stackData}
			<div class="stack-panel">
				{#if stackData.inscriptions.length > 0}
					<div class="stack-section">
						<h4>Inscription Chain</h4>
						{#each stackData.inscriptions as hi}
							<div class="history-entry">
								<span class="he-value">{hi.inscription}</span>
								<span class="he-by">{hi.by_inscription}</span>
								<span class="he-date">{new Date(hi.created_at).toLocaleString()}</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if stackData.designations.length > 0}
					<div class="stack-section">
						<h4>Designation Chain</h4>
						{#each stackData.designations as hd}
							<div class="history-entry">
								<span class="he-value" style="color: {designationColor(hd.designation)}">{hd.designation}</span>
								<span class="he-by">{hd.by_inscription}</span>
								<span class="he-date">{new Date(hd.created_at).toLocaleString()}</span>
							</div>
						{/each}
					</div>
				{/if}
				{#if includeMemos && stackData.memos.length > 0}
					<div class="stack-section">
						<h4>Memos</h4>
						{#each stackData.memos as memo}
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
								<div class="memo-content">{@html memo.content}</div>
								<div class="memo-entry-actions">
									{#if memo.status === 'active' || memo.status === 'presented' || memo.status === 'discussed'}
										<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'dismissed')}>dismiss</button>
										<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'acknowledged')}>ack</button>
									{/if}
									{#if memo.status === 'acknowledged'}
										<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'dismissed')}>dismiss</button>
									{/if}
									{#if memo.status === 'dismissed'}
										<button class="btn-xs" onclick={() => setMemoStatus(memo.id, 'presented')}>restore</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
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
			<h2 class="section-label">Namings <span class="section-count">{entitiesAndRelations.length}</span></h2>
			<div class="naming-list">
				{#each entitiesAndRelations as n (n.naming_id)}
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
						detailHref={`/projects/${data.projectId}/namings/${n.naming_id}`}
						actions={namingsActions}
					>
						{#snippet after()}
							{@render mapLinksFor(n)}
							{@render stackPanelFor(n, true)}
						{/snippet}
					</NamingRow>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Silences -->
	{#if silences.length > 0}
		<div class="section">
			<h2 class="section-label">Silences <span class="section-count">{silences.length}</span></h2>
			<div class="naming-list">
				{#each silences as n (n.naming_id)}
					<NamingRow
						item={n}
						density="rich"
						isEditing={editingId === n.naming_id}
						bind:editingValue
						recentlyTouched={recentlyTouched.has(n.naming_id)}
						detailHref={`/projects/${data.projectId}/namings/${n.naming_id}`}
						actions={namingsActions}
					>
						{#snippet after()}
							{@render stackPanelFor(n, false)}
						{/snippet}
					</NamingRow>
				{/each}
			</div>
		</div>
	{/if}

	{#if filtered.length === 0}
		<p class="empty">No namings match your filters.</p>
	{/if}
</div>

<!-- Phase Panel (right sidebar) -->
<div class="phase-panel">
	<div class="phase-panel-header">
		<h3>Phases</h3>
		<button class="btn-xs" onclick={() => showPhaseForm = !showPhaseForm}>
			{showPhaseForm ? '×' : '+'}
		</button>
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
					<div class="phase-member">
						<span class="designation-dot" style="background: {designationColor(member.designation)}"></span>
						<span class="phase-member-label">{member.inscription}</span>
						<button class="btn-xs btn-remove" onclick={() => removeNamingFromPhase(selectedPhaseId!, member.naming_id)}>×</button>
					</div>
				{/each}
			{/if}

			{#if phasePassages.length > 0}
				<h4>Passages ({phasePassages.length})</h4>
				{@const passagesByCode = phasePassages.reduce((groups: Record<string, any>, p: any) => {
					const key = p.code_id;
					if (!groups[key]) groups[key] = { label: p.code_label, docGroups: {} };
					const docKey = p.document_id;
					if (!groups[key].docGroups[docKey]) groups[key].docGroups[docKey] = { label: p.document_label, docId: p.document_id, items: [] };
					groups[key].docGroups[docKey].items.push(p);
					return groups;
				}, {})}
				{#each Object.entries(passagesByCode) as [codeId, codeGroup]}
					{@const cg = codeGroup as any}
					<div class="passage-code-group">
						<div class="passage-code-header">{cg.label}</div>
						{#each Object.entries(cg.docGroups) as [docId, docGroup]}
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
	.phase-panel {
		width: 320px;
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
	.passage-code-group { margin-bottom: 0.5rem; }
	.passage-code-header {
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
	.relate-banner {
		position: sticky;
		top: 0;
		z-index: 10;
		background: rgba(232, 165, 75, 0.12);
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

	@keyframes banner-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(232, 165, 75, 0.0); }
		50%      { box-shadow: 0 0 0 4px rgba(232, 165, 75, 0.22); }
	}

	@media (prefers-reduced-motion: reduce) {
		.relate-banner { animation: none; }
	}

	/* Act-prompt bar */
	.act-prompt-bar {
		background: #161822;
		border: 1px solid #f59e0b;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
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
	.btn-primary:hover { background: #a0aff9; }
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

	/* Buttons reused across banners, act-prompt, phase panel, and stack-panel snippet. */
	.btn-xs {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #8b8fa3;
		font-size: 0.7rem;
		padding: 0.15rem 0.35rem;
		cursor: pointer;
	}
	.btn-xs:hover { border-color: #4b5060; color: #e1e4e8; }
	.btn-confirm { border-color: #8b9cf7; color: #8b9cf7; font-weight: 600; }
	.btn-confirm:hover { background: rgba(139, 156, 247, 0.12); color: #e1e4e8; }
	.merge-banner { border-color: #e8a54b; }

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
	.memo-status-badge.status-promoted { background: rgba(16, 185, 129, 0.25); color: #10b981; }
	.memo-status-badge.status-dismissed { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-label { font-size: 0.75rem; color: #f59e0b; }
	.memo-content { font-size: 0.75rem; color: #8b8fa3; margin-top: 0.1rem; }
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
</style>
