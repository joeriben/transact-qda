<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';
	import { SW_ROLES, SW_ROLE_DEFAULTS } from '$lib/shared/constants.js';
	import type { SwRole } from '$lib/shared/types/index.js';
	import { quoted } from '$lib/shared/namingLabel.js';
	import { plural } from '$lib/shared/plural.js';

	let {
		viewMode,
		displayMode,
		centeredId,
		snapshotCount = 0,
		onswitchview,
		onsetdisplaymode,
		onrunautolayout,
		onuncenter,
		onopentopo,
		onreveal,
	}: {
		viewMode: 'canvas' | 'list';
		displayMode: 'entities' | 'relations' | 'full';
		centeredId: string | null;
		snapshotCount?: number;
		onswitchview: (mode: 'canvas' | 'list') => void;
		onsetdisplaymode: (mode: 'entities' | 'relations' | 'full') => void;
		onrunautolayout: () => void;
		onuncenter: () => void;
		onopentopo: () => void;
		/** Ein Naming dieser Karte in den Blick holen (zentrieren, hervorheben). */
		onreveal?: (id: string) => void;
	} = $props();

	const ms = getMapState();

	let newInscription = $state('');
	let newSwRole = $state<SwRole>('social-world');
	let newPosAbsent = $state(false);
	let adding = $state(false);
	let addInputRef = $state<HTMLInputElement | null>(null);
	let addWrapperEl = $state<HTMLDivElement | null>(null);

	// Positionskarte: Ein Naming, das schon auf anderen Karten steht, als
	// Position setzen? Clarke trennt Positionen von Akteuren — erst ein Hinweis
	// im Panel (kein Browser-Dialog), dann auf OK hin setzen.
	let positionHint = $state<{ id: string; label: string; count: number; kind: 'add' | 'place'; name?: string } | null>(null);

	// „Add" → benennen (BJ, 09.11.: „Konvention in UI ist "Add" → Benenen"):
	// Der Knopf öffnet ein Namensfeld; angelegt wird erst mit dem Namen, als
	// ein einziger Gründungsakt. Escape oder Abbrechen legt nichts an.
	let naming = $state(false);
	let draftName = $state('');
	let draftInputRef = $state<HTMLInputElement | null>(null);
	let draftExisting = $state<{ id: string; inscription: string } | null>(null);
	let draftDebounce: ReturnType<typeof setTimeout> | undefined;
	const draftOnMap = $derived.by(() => {
		const q = norm(draftName);
		if (!q) return null;
		const hit = ms.allItems.find((n: any) => n.mode !== 'perspective' && norm(ms.findInscription(n.naming_id)) === q);
		return hit ? { id: hit.naming_id as string, label: ms.findInscription(hit.naming_id) } : null;
	});
	const newWhat = $derived(ms.mapType === 'social-worlds' ? 'formation' : ms.mapType === 'positional' ? 'position' : 'naming');

	function openNaming() {
		if (adding) return;
		draftName = newInscription.trim();
		newInscription = '';
		closePlacementDropdown();
		positionHint = null;
		naming = true;
		onDraftInput();
		setTimeout(() => draftInputRef?.focus(), 0);
	}

	function cancelNaming() {
		naming = false;
		draftName = '';
		draftExisting = null;
		clearTimeout(draftDebounce);
	}

	// Gleichnamiges im Projekt: vorher sagen, dass das vorhandene Naming hierher
	// kommt (der Server legt kein zweites an).
	function onDraftInput() {
		clearTimeout(draftDebounce);
		draftExisting = null;
		const q = draftName.trim();
		if (q.length < 2) return;
		draftDebounce = setTimeout(async () => {
			const res = await ms.mapAction('searchForPlacement', { query: q });
			if (norm(draftName) !== norm(q)) return;
			const hit = ((res?.results ?? []) as any[]).find((r) => norm(r.inscription) === norm(q));
			draftExisting = hit ? { id: hit.id as string, inscription: String(hit.inscription) } : null;
		}, 250);
	}

	async function submitNaming() {
		const name = draftName.trim();
		if (!name || adding) return;
		if (draftOnMap) { const id = draftOnMap.id; cancelNaming(); revealOnMap(id); return; }
		const done = await createNaming(name);
		if (done) cancelNaming();
	}

	function onDraftKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelNaming(); }
		else if (e.key === 'Enter') { e.preventDefault(); void submitNaming(); }
	}

	// Placement search
	let placementResults = $state<any[]>([]);
	let placementOpen = $state(false);
	let placementLoading = $state(false);
	let placementDebounce: ReturnType<typeof setTimeout> | undefined;
	/** Tastaturauswahl im Vorschlagsmenü (Pfeiltasten), -1 = keine. */
	let activeIndex = $state(-1);

	const norm = (t: string | null | undefined) => (t ?? '').trim().toLowerCase();

	// Was schon auf DIESER Karte steht, findet die Projektsuche nicht (sie
	// schließt die Karte aus). Ohne diesen Abschnitt bot das Feld zu einem
	// vorhandenen Namen nur „Create new" an.
	const onMapMatches = $derived.by(() => {
		const q = norm(newInscription);
		if (q.length < 2) return [];
		return ms.allItems
			.filter((n: any) => n.mode !== 'perspective')
			.map((n: any) => ({ id: n.naming_id as string, label: ms.findInscription(n.naming_id), designation: n.designation, mode: n.mode as string, withdrawn: ms.isWithdrawn(n.properties) }))
			.filter((m) => m.label.toLowerCase().includes(q))
			.sort((a, b) => Number(norm(b.label) === q) - Number(norm(a.label) === q))
			.slice(0, 5);
	});
	const exactOnMap = $derived(onMapMatches.find((m) => norm(m.label) === norm(newInscription)) ?? null);
	const exactInProject = $derived(placementResults.find((r: any) => norm(r.inscription) === norm(newInscription)) ?? null);

	type Choice = { kind: 'onmap'; id: string } | { kind: 'place'; id: string } | { kind: 'create' };
	const choices = $derived<Choice[]>([
		...onMapMatches.map((m) => ({ kind: 'onmap' as const, id: m.id })),
		...placementResults.map((r: any) => ({ kind: 'place' as const, id: r.id as string })),
		...(exactOnMap || exactInProject ? [] : [{ kind: 'create' as const }])
	]);

	function pick(c: Choice) {
		if (c.kind === 'onmap') revealOnMap(c.id);
		else if (c.kind === 'place') placeExistingNaming(c.id);
		else addElement();
	}

	function revealOnMap(id: string) {
		closePlacementDropdown();
		newInscription = '';
		const label = ms.findInscription(id);
		ms.showAiNotification(`${quoted(label)} is already on this map.`);
		onreveal?.(id);
	}

	function onAddKeydown(e: KeyboardEvent) {
		if (!placementOpen || choices.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = (activeIndex + 1) % choices.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = activeIndex <= 0 ? choices.length - 1 : activeIndex - 1;
		} else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < choices.length) {
			e.preventDefault();
			pick(choices[activeIndex]);
		}
	}

	// Import
	let importDropdownOpen = $state(false);
	let importDocuments = $state<any[]>([]);
	let importDocNets = $state<any[]>([]);
	let importLoading = $state(false);

	// Während des Anlegens bleibt das Feld fokussiert (readonly statt disabled),
	// der Knopf sagt, dass etwas geschieht; der neue Knoten wird danach in den
	// Blick geholt (Primary: er wartet in Unplaced).
	/** Gleichnamiges Naming im Projekt, das schon auf anderen Karten steht (Positionskarte). */
	async function positionConflict(name: string): Promise<{ id: string; label: string; count: number } | null> {
		if (ms.mapType !== 'positional') return null;
		const res = await ms.mapRequest('searchForPlacement', { query: name });
		const hit = ((res.data?.results ?? []) as any[]).find((r) => norm(r.inscription) === norm(name));
		const count = Number(hit?.appearance_count) || 0;
		return hit && count > 0 ? { id: hit.id as string, label: String(hit.inscription), count } : null;
	}

	function confirmPositionHint() {
		const h = positionHint;
		positionHint = null;
		if (!h) return;
		if (h.kind === 'add') void createNaming(h.name ?? '', true).then((done) => { if (done) cancelNaming(); });
		else void placeExistingNaming(h.id, true);
	}

	/** Aus dem Suchfeld: „Create new: …" bzw. Enter ohne Treffer. */
	async function addElement() {
		const name = newInscription.trim();
		if (!name || adding) return;
		// Steht der Name schon auf dieser Karte: dorthin, statt ein zweites anzulegen.
		if (exactOnMap) { revealOnMap(exactOnMap.id); return; }
		await createNaming(name);
	}

	/** Legt ein Naming an; true, wenn erledigt (angelegt, wiederverwendet oder schon hier). */
	async function createNaming(name: string, confirmed = false): Promise<boolean> {
		if (!name || adding) return false;
		adding = true;
		closePlacementDropdown();
		try {
			if (!confirmed) {
				const conflict = await positionConflict(name);
				if (conflict) { positionHint = { ...conflict, kind: 'add', name }; return false; }
			}
			let res;
			if (ms.mapType === 'social-worlds') {
				res = await ms.mapRequest('addFormation', { inscription: name, swRole: newSwRole });
			} else if (ms.mapType === 'positional' && newPosAbsent) {
				res = await ms.mapRequest('addElement', { inscription: name, properties: { absent: true } });
			} else {
				res = await ms.mapRequest('addElement', { inscription: name });
			}
			// Gleicher Name schon auf dieser Karte (Server prüft ohne Groß/Klein).
			if (res.status === 409 && res.data?.alreadyOnMap) {
				newInscription = '';
				const id = res.data.id as string | undefined;
				const label = (id && ms.findNode(id) ? ms.findInscription(id) : null) ?? name;
				ms.showAiNotification(`${quoted(label)} is already on this map.`);
				if (id) onreveal?.(id);
				return true;
			}
			if (!res.ok) { ms.showError(serverError(res) ?? 'Not added (server error)'); return false; }
			newInscription = '';
			newPosAbsent = false;
			// Gleicher Name im Projekt: das vorhandene Naming steht jetzt hier.
			if (res.data?.reused) {
				ms.showAiNotification(`${quoted(res.data.inscription || name)} already exists in this project — placed the existing naming here.`);
			}
			if (!ms.isPrimary) ms.requestReveal();
			await ms.reload();
			return true;
		} finally {
			adding = false;
		}
	}

	function serverError(res: { data: any }): string | null {
		const e = res.data?.error;
		return typeof e === 'string' && e.trim() ? e.trim() : null;
	}

	function onAddInputChange(query: string) {
		clearTimeout(placementDebounce);
		activeIndex = -1;
		positionHint = null;
		if (query.trim().length < 2) { closePlacementDropdown(); return; }
		// Sofort öffnen: was schon auf der Karte steht, zeigt sich ohne Serverweg.
		placementOpen = true;
		placementDebounce = setTimeout(() => searchPlacement(query.trim()), 250);
	}

	async function searchPlacement(query: string) {
		placementLoading = true;
		const res = await ms.mapAction('searchForPlacement', { query });
		// Eine langsame Antwort auf eine ältere Eingabe überschreibt nichts.
		if (res?.results && norm(newInscription) === norm(query)) {
			placementResults = res.results;
			placementOpen = true;
		}
		placementLoading = false;
	}

	async function placeExistingNaming(namingId: string, confirmed = false) {
		if (adding) return;
		if (!confirmed && ms.mapType === 'positional') {
			const r = placementResults.find((x: any) => x.id === namingId);
			const count = Number(r?.appearance_count) || 0;
			if (r && count > 0) {
				closePlacementDropdown();
				positionHint = { id: namingId, label: String(r.inscription), count, kind: 'place' };
				return;
			}
		}
		closePlacementDropdown();
		adding = true;
		try {
			// Auf der SW/A-Karte erscheint das Naming in der gewählten Rolle, auf
			// der Positionskarte ggf. als abwesende Position — wie beim Anlegen.
			const properties =
				ms.mapType === 'social-worlds'
					? { ...(SW_ROLE_DEFAULTS[newSwRole] ?? SW_ROLE_DEFAULTS['social-world']), swRole: newSwRole }
					: ms.mapType === 'positional' && newPosAbsent
						? { absent: true }
						: undefined;
			const res = await ms.mapRequest('placeExisting', { namingId, ...(properties ? { properties } : {}) });
			if (res.status === 409) {
				ms.showAiNotification('Already on this map.');
				onreveal?.(namingId);
				return;
			}
			if (!res.ok) { ms.showError(serverError(res) ?? 'Not placed (server error)'); return; }
			newInscription = '';
			newPosAbsent = false;
			if (!ms.isPrimary) ms.requestReveal();
			await ms.reload();
		} finally {
			adding = false;
		}
	}

	function closePlacementDropdown() {
		placementOpen = false;
		placementResults = [];
		activeIndex = -1;
		clearTimeout(placementDebounce);
	}

	async function openImportDropdown() {
		if (importDropdownOpen) { importDropdownOpen = false; return; }
		importLoading = true;
		importDropdownOpen = true;
		const [docsRes, dnRes] = await Promise.all([
			ms.mapAction('listDocumentsForImport'),
			ms.mapAction('listDocNetsForImport')
		]);
		if (docsRes) importDocuments = docsRes.documents || [];
		if (dnRes) importDocNets = dnRes.docnets || [];
		importLoading = false;
	}

	async function importFromDocument(documentId: string) {
		importDropdownOpen = false;
		const res = await ms.mapAction('importFromDocument', { documentId });
		if (res?.placed > 0) await ms.reload();
	}

	async function importFromDocNet(docnetId: string) {
		importDropdownOpen = false;
		const res = await ms.mapAction('importFromDocNet', { docnetId });
		if (res?.placed > 0) await ms.reload();
	}

	// Die Suche schließt erst, wenn der Fokus das Formular verlässt — nicht
	// schon beim Wechsel in die Typauswahl (danach erschienen die Vorschläge
	// erst wieder nach erneutem Tippen).
	function onAddFocusOut(e: FocusEvent) {
		const next = e.relatedTarget as Node | null;
		if (next && addWrapperEl?.contains(next)) return;
		setTimeout(() => {
			if (addWrapperEl?.contains(document.activeElement)) return;
			closePlacementDropdown();
			// Ein leeres Namensfeld geht mit dem Fokus; ein angefangener Name bleibt stehen.
			if (naming && !draftName.trim() && !adding) cancelNaming();
		}, 200);
	}

	// Neuer Typ: die Vorschläge zum eingegebenen Namen gleich wieder zeigen.
	function onRoleChange() {
		if (newInscription.trim().length >= 2) onAddInputChange(newInscription);
	}

	// Expose for parent escape handler
	export function closeDropdowns() {
		if (positionHint) { positionHint = null; return true; }
		if (naming) { cancelNaming(); return true; }
		if (importDropdownOpen) { importDropdownOpen = false; return true; }
		if (placementOpen) { closePlacementDropdown(); return true; }
		return false;
	}
</script>

<div class="map-toolbar">
	<a href="/projects/{ms.projectId}/maps" class="back">&larr; Maps</a>
	<h2 title={ms.mapLabel}>{ms.mapLabel}</h2>
	<span class="map-type-badge">{ms.mapType}</span>

	<!-- Ohne Zurückgezogenes (Withdraw); auf der Primary Map zählen die
	     unplatzierten Namings mit (sie gehören zur Situation). -->
	{#if ms.designationCounts.length > 0}
		<div class="designation-profile"
			title={ms.isPrimary
				? 'Namings on this map by designation — includes unplaced namings; withdrawn not counted'
				: 'Namings on this map by designation (withdrawn not counted)'}>
			{#each ms.designationCounts as dp}
				<span class="dp-item" style="color: {ms.designationColor(dp.designation)}">
					{dp.count} {ms.designationLabel(dp.designation)}
				</span>
			{/each}
		</div>
	{/if}

	<!-- Kein Offen-Zähler: Unplatziert ist ein Zustand, keine Aufgabe
	     (Revision vom 31.10.2026, von BJ mit „Ja, korrigieren" freigegeben).
	     Was keine Position hat, steht in der Unplaced-Liste. -->

	<!-- Abgeräumtes fällt aus der Unplaced-Liste, bleibt aber erreichbar — sonst
	     wäre „ausblenden" ein Verschwinden ohne Rückweg (wie im Reader-Fuß). -->
	{#if ms.hiddenCount > 0 || ms.showHidden}
		<button class="hidden-badge" class:showing={ms.showHidden}
			onclick={() => ms.showHidden = !ms.showHidden}
			title={ms.showHidden
				? 'Take them out of Unplaced again'
				: 'Unplaced namings whose passages were hidden in the reader, or whose cue was rejected — by you or by another member of this project. Click to list them again.'}>
			{ms.hiddenCount} hidden/rejected
		</button>
	{/if}

	<div class="toolbar-actions">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="add-form-wrapper" bind:this={addWrapperEl} onclick={(e) => e.stopPropagation()} onfocusout={onAddFocusOut}>
			<form class="add-form" onsubmit={e => { e.preventDefault(); addElement(); }}>
				{#if ms.mapType === 'social-worlds'}
					<select class="sw-role-select" bind:value={newSwRole} onchange={onRoleChange}
						aria-label="Type of the new formation" title="Type of the new formation">
						{#each SW_ROLES as role}
							<option value={role}>{role}</option>
						{/each}
					</select>
				{:else if ms.mapType === 'positional'}
					<label class="pos-absent-toggle" title="Mark as missing/absent position">
						<input type="checkbox" bind:checked={newPosAbsent} aria-label="Absent position" />
						<span>absent</span>
					</label>
				{/if}
				<input type="text" placeholder="Search namings…" bind:value={newInscription} bind:this={addInputRef} readonly={adding}
					aria-label="Search namings in this project to show or place them here"
					oninput={(e) => onAddInputChange((e.target as HTMLInputElement).value)}
					onkeydown={onAddKeydown}
					role="combobox" aria-expanded={placementOpen} aria-controls="map-add-suggestions" aria-autocomplete="list"
					onfocus={() => { if (newInscription.trim().length >= 2) onAddInputChange(newInscription); }}
				/>
				<button type="button" class="btn-primary" onclick={openNaming} disabled={adding}
					title="Add a new {newWhat} to this map — you name it next">{adding ? 'Adding…' : '+ Add'}</button>
			</form>
			{#if naming}
				<div class="naming-pop" role="dialog" aria-label="New {newWhat}">
					<label class="naming-pop-label" for="map-new-naming">New {newWhat}</label>
					{#if ms.mapType === 'social-worlds'}
						<div class="naming-pop-opts">
							<select class="sw-role-select" bind:value={newSwRole} aria-label="Type of the new formation">
								{#each SW_ROLES as role}
									<option value={role}>{role}</option>
								{/each}
							</select>
						</div>
					{:else if ms.mapType === 'positional'}
						<div class="naming-pop-opts">
							<label class="pos-absent-toggle" title="Mark as missing/absent position">
								<input type="checkbox" bind:checked={newPosAbsent} />
								<span>absent position</span>
							</label>
						</div>
					{/if}
					<div class="naming-pop-row">
						<input id="map-new-naming" type="text" placeholder="Name it…" bind:value={draftName} bind:this={draftInputRef}
							readonly={adding} oninput={onDraftInput} onkeydown={onDraftKeydown} autocomplete="off" />
						<button type="button" class="btn-primary" onclick={submitNaming} disabled={adding || !draftName.trim()}>
							{adding ? 'Adding…' : draftOnMap ? 'Show' : 'Add'}
						</button>
						<button type="button" class="btn-sm" onclick={cancelNaming} disabled={adding}>Cancel</button>
					</div>
					{#if draftOnMap}
						<p class="naming-pop-note">{quoted(draftOnMap.label)} is already on this map.</p>
					{:else if draftExisting}
						<p class="naming-pop-note">{quoted(draftExisting.inscription)} exists in this project — the existing naming is placed here, no second one.</p>
					{:else}
						<p class="naming-pop-hint">Enter adds · Esc cancels{ms.isPrimary ? ' · it waits in Unplaced until you place it' : ''}</p>
					{/if}
				</div>
			{/if}
			{#if placementOpen}
				<div class="placement-dropdown" id="map-add-suggestions" role="listbox">
					{#if onMapMatches.length > 0}
						<span class="placement-section">On this map</span>
						{#each onMapMatches as m, i (m.id)}
							<button class="placement-item" class:active={activeIndex === i} role="option" aria-selected={activeIndex === i}
								onmousedown={(e) => { e.preventDefault(); revealOnMap(m.id); }}
								title="Already on this map — show it">
								<span class="placement-inscription" class:withdrawn={m.withdrawn}>{m.label}</span>
								<span class="placement-badge" style="color: {ms.designationColor(m.designation)}; border-color: {ms.designationColor(m.designation)}">
									{ms.designationLabel(m.designation)}
								</span>
								<span class="placement-maps">{m.withdrawn ? 'withdrawn' : 'show'}</span>
							</button>
						{/each}
					{/if}
					{#if placementResults.length > 0}
						<span class="placement-section">In this project — place here</span>
						{#each placementResults as result, j (result.id)}
							{@const idx = onMapMatches.length + j}
							<button class="placement-item" class:active={activeIndex === idx} role="option" aria-selected={activeIndex === idx}
								onmousedown={(e) => { e.preventDefault(); placeExistingNaming(result.id); }}>
								<span class="placement-inscription">{result.inscription}</span>
								<span class="placement-badge" style="color: {ms.designationColor(result.designation)}; border-color: {ms.designationColor(result.designation)}">
									{ms.designationLabel(result.designation)}
								</span>
								<span class="placement-maps">{plural(Number(result.appearance_count) || 0, 'map')}</span>
							</button>
						{/each}
					{:else if !placementLoading && onMapMatches.length === 0}
						<span class="placement-empty">No existing namings found</span>
					{/if}
					{#if placementLoading}
						<span class="placement-loading">searching...</span>
					{/if}
					{#if !exactOnMap && !exactInProject}
						{@const idx = onMapMatches.length + placementResults.length}
						<div class="placement-separator"></div>
						<button class="placement-item placement-create" class:active={activeIndex === idx} role="option" aria-selected={activeIndex === idx}
							onmousedown={(e) => { e.preventDefault(); addElement(); }}>
							<span class="placement-create-label">Create new:</span>
							<span class="placement-create-value">{newInscription.trim()}</span>
						</button>
					{/if}
				</div>
			{/if}
			{#if positionHint}
				<div class="position-hint" role="alertdialog" aria-labelledby="position-hint-text">
					<p id="position-hint-text">
						{quoted(positionHint.label)} already appears on {plural(positionHint.count, 'other map')} —
						positional maps separate positions from actors. Use it as a position anyway?
					</p>
					<div class="position-hint-actions">
						<button type="button" class="btn-primary" onclick={confirmPositionHint}>Use as position</button>
						<button type="button" class="btn-sm" onclick={() => (positionHint = null)}>Cancel</button>
					</div>
				</div>
			{/if}
		</div>
		<div class="view-toggle">
			<button class="btn-view" class:active={viewMode === 'canvas'} aria-pressed={viewMode === 'canvas'} onclick={() => onswitchview('canvas')}>Canvas</button>
			<button class="btn-view" class:active={viewMode === 'list'} aria-pressed={viewMode === 'list'} onclick={() => onswitchview('list')}>List</button>
		</div>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="import-wrapper" onclick={(e) => e.stopPropagation()}>
			<button class="btn-sm" onclick={openImportDropdown} title="Import namings from a document">Import</button>
			{#if importDropdownOpen}
				<div class="import-dropdown">
					{#if importLoading}
						<span class="import-loading">loading...</span>
					{:else}
						{#if importDocNets.length > 0}
							<span class="import-section-label">DocNets</span>
							{#each importDocNets as dn}
								<button class="import-item" onmousedown={(e) => { e.preventDefault(); importFromDocNet(dn.id); }}
									disabled={dn.importable_count === 0}>
									<span class="import-doc-label">{dn.label}</span>
									{#if dn.importable_count > 0}
										<span class="import-doc-count">+{dn.importable_count}</span>
									{:else}
										<span class="import-doc-done">all placed</span>
									{/if}
								</button>
							{/each}
						{/if}
						{#if importDocuments.length > 0}
							{#if importDocNets.length > 0}
								<div class="import-separator"></div>
							{/if}
							<span class="import-section-label">Documents</span>
							{#each importDocuments as doc}
								<button class="import-item" onmousedown={(e) => { e.preventDefault(); importFromDocument(doc.id); }}
									disabled={doc.importable_count === 0}>
									<span class="import-doc-label">{doc.label}</span>
									{#if doc.importable_count > 0}
										<span class="import-doc-count">+{doc.importable_count}</span>
									{:else}
										<span class="import-doc-done">all placed</span>
									{/if}
								</button>
							{/each}
						{/if}
						{#if importDocuments.length === 0 && importDocNets.length === 0}
							<span class="import-empty">No documents or DocNets in project</span>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
		<div class="display-mode-group" style="{viewMode !== 'canvas' ? 'opacity: 0.3; pointer-events: none;' : ''}">
			<button class="btn-mode" class:active={displayMode === 'entities'}
				onclick={() => onsetdisplaymode('entities')}
				title="Entities only (messy map)">Entities</button>
			<button class="btn-mode" class:active={displayMode === 'relations'}
				onclick={() => onsetdisplaymode('relations')}
				title="Relations only (relational map)">Relations</button>
			<button class="btn-mode" class:active={displayMode === 'full'}
				onclick={() => onsetdisplaymode('full')}
				title="Full view: entities + relations + connections">Full</button>
		</div>
		{#if ms.mapType !== 'positional'}
			<button class="btn-sm" onclick={onrunautolayout} title="Re-compute layout (saves a snapshot first so you can revert)"
				disabled={viewMode !== 'canvas'} style="{viewMode !== 'canvas' ? 'opacity: 0.3;' : ''}">Layout</button>
		{/if}
		<button class="btn-sm btn-snapshots" onclick={onopentopo}
			title="Topology snapshots — save and restore map layouts"
			disabled={viewMode !== 'canvas'} style="{viewMode !== 'canvas' ? 'opacity: 0.3;' : ''}">
			Snapshots{#if snapshotCount > 0} <span class="snapshot-count">{snapshotCount}</span>{/if}
		</button>
		{#if centeredId}
			<button class="btn-sm btn-centered" onclick={onuncenter}
				title="Centered on: {ms.findInscription(centeredId)} — click to uncenter">
				<img src="/icons/target.svg" alt="centered" class="toolbar-icon" />
				<span class="centered-label">{ms.findInscription(centeredId)}</span>
				<span class="centered-close">×</span>
			</button>
		{/if}
	</div>
</div>

<style>
	/* Schmale Fenster: die Leiste bricht um, statt über den Rand zu ragen (ein
	   überstehendes Feld zog beim Fokussieren den ganzen Inhalt seitwärts). */
	.map-toolbar {
		display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem 0.6rem;
		padding: 0.45rem 0.75rem; border-bottom: 1px solid #2a2d3a;
		background: #13151e; flex-shrink: 0; min-width: 0;
	}
	.back { font-size: 0.8rem; color: #6b7280; text-decoration: none; white-space: nowrap; }
	h2 {
		font-size: 1rem; font-weight: 600; color: #e1e4e8; margin: 0;
		min-width: 0; max-width: 22ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.map-type-badge {
		font-size: 0.7rem; color: #8b9cf7; text-transform: uppercase; white-space: nowrap;
		background: rgba(139, 156, 247, 0.1); padding: 0.15rem 0.5rem; border-radius: 4px;
	}
	.designation-profile { display: flex; gap: 0.5rem; font-size: 0.75rem; white-space: nowrap; }
	.dp-item { font-weight: 500; }
	.hidden-badge {
		font-size: 0.75rem; color: #9ca3af; background: rgba(107, 114, 128, 0.12);
		border: 1px solid rgba(107, 114, 128, 0.3); border-radius: 4px;
		padding: 0.15rem 0.5rem; cursor: pointer;
	}
	.hidden-badge:hover { color: #e1e4e8; border-color: #6b7280; }
	.hidden-badge.showing { color: #f59e0b; border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.1); }
	.toolbar-actions {
		display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end;
		gap: 0.35rem 0.4rem; margin-left: auto; min-width: 0;
	}

	/* View toggle */
	.view-toggle { display: flex; border: 1px solid #2a2d3a; border-radius: 5px; overflow: hidden; }
	.btn-view {
		background: transparent; border: none; color: #6b7280; padding: 0.25rem 0.5rem;
		font-size: 0.75rem; cursor: pointer;
	}
	.btn-view.active { background: #2a2d3a; color: #e1e4e8; }
	.btn-view:hover:not(.active) { color: #c9cdd5; }

	/* Add form */
	.add-form { display: flex; gap: 0.4rem; }
	.add-form input {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.35rem 0.55rem; color: #e1e4e8; font-size: 0.85rem; width: clamp(130px, 15vw, 200px);
	}
	.add-form input[readonly] { color: #8b8fa3; }
	.add-form input:focus { outline: none; border-color: #8b9cf7; }
	.sw-role-select {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.3rem 0.4rem; color: #c9cdd5; font-size: 0.75rem; cursor: pointer;
	}
	.sw-role-select:focus { outline: none; border-color: #8b9cf7; }
	.pos-absent-toggle {
		display: flex; align-items: center; gap: 0.3rem;
		font-size: 0.75rem; color: #6b7280; cursor: pointer;
	}
	.pos-absent-toggle input[type="checkbox"] {
		width: 14px; height: 14px; accent-color: #8b9cf7;
	}
	.pos-absent-toggle:has(input:checked) { color: #f59e0b; }
	.add-form-wrapper { position: relative; }
	.naming-pop {
		position: absolute; top: 100%; right: 0; z-index: 985;
		margin-top: 4px; width: max(100%, 320px);
		background: #1e2030; border: 1px solid #8b9cf7; border-radius: 8px;
		padding: 0.55rem 0.7rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.naming-pop-label { display: block; font-size: 0.68rem; color: #8b8fa3; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.35rem; }
	.naming-pop-row { display: flex; gap: 0.4rem; }
	.naming-pop-opts { margin-bottom: 0.4rem; }
	.naming-pop-row input {
		flex: 1; min-width: 0; background: #161822; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.35rem 0.55rem; color: #e1e4e8; font-size: 0.85rem;
	}
	.naming-pop-row input:focus { outline: none; border-color: #8b9cf7; }
	.naming-pop-hint, .naming-pop-note { margin: 0.4rem 0 0; font-size: 0.72rem; line-height: 1.35; }
	.naming-pop-hint { color: #6b7280; }
	.naming-pop-note { color: #f59e0b; }
	.position-hint {
		position: absolute; top: 100%; right: 0; z-index: 980;
		margin-top: 4px; width: max(100%, 300px);
		background: #1e2030; border: 1px solid #f59e0b; border-radius: 8px;
		padding: 0.55rem 0.7rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.position-hint p { margin: 0 0 0.45rem; font-size: 0.8rem; color: #c9cdd5; line-height: 1.4; }
	.position-hint-actions { display: flex; gap: 0.4rem; justify-content: flex-end; }

	/* Placement dropdown */
	/* Rechtsbündig unter dem Feld: am rechten Fensterrand ragt nichts hinaus. */
	.placement-dropdown {
		position: absolute; top: 100%; right: 0;
		margin-top: 4px; min-width: 280px; width: 100%;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 8px;
		padding: 0.25rem 0; z-index: 980;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		max-height: 280px; overflow-y: auto;
	}
	.placement-item {
		display: flex; align-items: center; gap: 0.5rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.placement-item:hover, .placement-item.active { background: #2a2d3a; }
	.placement-section {
		display: block; padding: 0.3rem 0.75rem 0.15rem; font-size: 0.62rem;
		color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em;
	}
	.placement-inscription.withdrawn { color: #6b7280; text-decoration: line-through; }
	.placement-inscription { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.placement-badge {
		font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em;
		border: 1px solid; border-radius: 3px; padding: 0.05rem 0.3rem; flex-shrink: 0;
	}
	.placement-maps { font-size: 0.7rem; color: #6b7280; flex-shrink: 0; }
	.placement-separator { height: 1px; background: #2a2d3a; margin: 0.2rem 0.5rem; }
	.placement-create { color: #8b9cf7; }
	.placement-create:hover { background: rgba(139, 156, 247, 0.1); }
	.placement-create-label { font-size: 0.75rem; color: #6b7280; flex-shrink: 0; }
	.placement-create-value { font-weight: 600; }
	.placement-empty { display: block; padding: 0.35rem 0.75rem; font-size: 0.75rem; color: #4b5563; }
	.placement-loading { display: block; padding: 0.35rem 0.75rem; font-size: 0.75rem; color: #8b9cf7; }

	/* Import */
	.import-wrapper { position: relative; }
	.import-dropdown {
		position: absolute; top: 100%; right: 0; z-index: 980;
		background: #1e2030; border: 1px solid #3a3d4a; border-radius: 6px;
		min-width: 220px; max-height: 300px; overflow-y: auto;
		box-shadow: 0 4px 12px rgba(0,0,0,0.4); margin-top: 4px;
	}
	.import-item {
		display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
		width: 100%; background: none; border: none; color: #c9cdd5;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; cursor: pointer; text-align: left;
	}
	.import-item:hover:not(:disabled) { background: #2a2d3a; }
	.import-item:disabled { opacity: 0.4; cursor: default; }
	.import-doc-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.import-doc-count { color: #10b981; font-size: 0.7rem; font-weight: 600; flex-shrink: 0; }
	.import-doc-done { color: #6b7280; font-size: 0.7rem; flex-shrink: 0; }
	.import-loading, .import-empty { display: block; padding: 0.4rem 0.75rem; font-size: 0.75rem; color: #6b7280; }
	.import-section-label {
		display: block; padding: 0.25rem 0.75rem; font-size: 0.65rem;
		color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em;
	}
	.import-separator { height: 1px; background: #2a2d3a; margin: 0.2rem 0.5rem; }

	/* Buttons */
	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }
	.btn-sm {
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.btn-sm:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-snapshots { display: inline-flex; align-items: center; gap: 0.35rem; }
	.snapshot-count {
		background: rgba(245, 158, 11, 0.18); color: #f59e0b;
		font-size: 0.65rem; font-weight: 600;
		padding: 0.05rem 0.35rem; border-radius: 8px; line-height: 1.2;
	}
	/* Display mode selector */
	.display-mode-group {
		display: flex; border: 1px solid #2a2d3a; border-radius: 5px; overflow: hidden;
	}
	.btn-mode {
		background: #1e2030; border: none; color: #6b7280;
		font-size: 0.7rem; padding: 0.2rem 0.5rem; cursor: pointer;
		border-right: 1px solid #2a2d3a; white-space: nowrap;
	}
	.btn-mode:last-child { border-right: none; }
	.btn-mode:hover { color: #c9cdd5; }
	.btn-mode.active {
		background: rgba(139, 156, 247, 0.15); color: #8b9cf7; font-weight: 600;
	}
	.btn-centered {
		display: flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem;
		border-color: #f59e0b; color: #f59e0b; background: rgba(245, 158, 11, 0.1);
	}
	.btn-centered .toolbar-icon { width: 14px; height: 14px; opacity: 0.9; }
	.btn-centered .centered-label {
		font-size: 0.7rem; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.btn-centered .centered-close { font-size: 0.85rem; margin-left: 0.15rem; }
</style>
