<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { memoText } from '$lib/shared/memoText.js';
	import { getMapState, type MemoVerdict } from './mapState.svelte.js';

	// Ein neues KI-Memo (Cowork) als kompakte Karte in der Ecke über der Karte.
	// Schließen (×, Escape, Klick daneben) urteilt nicht: das Memo bleibt
	// „presented", steht weiter im Stack seiner Namings und lässt sich unter
	// MAP MEMOS wieder als Karte öffnen. Die Urteile sind dieselben wie im
	// Stack-Panel und setzen den Status wirklich.
	//
	// Ebene: über allen Panels der Karte und über dem Coach (der liegt fest
	// unten rechts, z 900), unter Kopfzeile und Dialogen. Ist der Coach offen,
	// rückt die Karte neben oder über ihn, statt ihn zu verdecken.

	const ms = getMapState();
	const p = $derived(ms.memoPanel);

	let cardEl = $state<HTMLDivElement | null>(null);
	let expanded = $state(false);
	/** Abstand zum rechten und unteren Rand der Bühne; null = Grundlage (Ecke). */
	let offset = $state<{ right: number; bottom: number } | null>(null);

	const BASE_RIGHT = 12;
	const BASE_BOTTOM = 54; // über der Zoom-Leiste
	const GAP = 12;

	// Neben oder über den Coach, wenn er dort liegt, wo die Karte stünde.
	function place() {
		const card = cardEl;
		const stage = card?.offsetParent as HTMLElement | null;
		if (!card || !stage) return;
		const coach = document.querySelector<HTMLElement>('.coach-panel');
		const s = stage.getBoundingClientRect();
		const w = card.offsetWidth;
		const h = card.offsetHeight;
		if (!coach) { offset = null; return; }
		const c = coach.getBoundingClientRect();
		// Die Karte an ihrer Grundlage (Bildschirmkoordinaten)
		const box = { left: s.right - BASE_RIGHT - w, right: s.right - BASE_RIGHT, top: s.bottom - BASE_BOTTOM - h, bottom: s.bottom - BASE_BOTTOM };
		const overlaps = box.left < c.right && box.right > c.left && box.top < c.bottom && box.bottom > c.top;
		if (!overlaps) { offset = null; return; }
		// Links daneben, wenn dort Platz ist …
		const rightBeside = s.right - c.left + GAP;
		if (s.right - rightBeside - w >= s.left + GAP) { offset = { right: rightBeside, bottom: BASE_BOTTOM }; return; }
		// … sonst darüber.
		const bottomAbove = s.bottom - c.top + GAP;
		if (s.bottom - bottomAbove - h >= s.top + GAP) { offset = { right: BASE_RIGHT, bottom: bottomAbove }; return; }
		offset = null; // kein Platz: die Karte liegt über dem Coach
	}

	$effect(() => {
		if (!p || !cardEl) return;
		let raf = 0;
		const schedule = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => { raf = 0; place(); });
		};
		schedule();
		// Der Coach erscheint und verschwindet (eigenes Bauteil im Layout) und
		// lässt sich in der Größe ziehen.
		let coachEl: Element | null = null;
		const ro = new ResizeObserver(schedule);
		ro.observe(cardEl);
		const watchCoach = () => {
			const c = document.querySelector('.coach-panel');
			if (c === coachEl) return;
			if (coachEl) ro.unobserve(coachEl);
			coachEl = c;
			if (c) ro.observe(c);
			schedule();
		};
		watchCoach();
		const mo = new MutationObserver(watchCoach);
		mo.observe(document.body, { childList: true, subtree: true });
		window.addEventListener('resize', schedule);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			ro.disconnect();
			mo.disconnect();
			window.removeEventListener('resize', schedule);
		};
	});

	// Jedes neue Memo beginnt eingeklappt.
	$effect(() => {
		void p?.id;
		expanded = false;
	});

	// Klick daneben schließt — außer im Stack-Panel (dorthin führen die
	// Naming-Chips der Karte) und in Menüs. Erst nach dem laufenden Ereignis
	// angemeldet, sonst schlösse der Klick, der die Karte geöffnet hat, sie gleich.
	$effect(() => {
		if (!p) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Element | null;
			if (!t || cardEl?.contains(t)) return;
			if (t.closest('.canvas-stack-panel, .context-menu, .canvas-context-menu')) return;
			ms.closeMemoPanel();
		};
		const timer = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('pointerdown', onDown, true);
		};
	});

	const LIMIT = 280;
	const content = $derived(p ? memoText(p.content) : '');
	const long = $derived(content.length > LIMIT);
	const shown = $derived(expanded || !long ? content : `${content.slice(0, LIMIT).trimEnd()}…`);
	const linked = $derived((p?.linkedIds ?? []).filter((id) => id !== ms.mapId && !!ms.findNode(id)));

	function judge(v: MemoVerdict) {
		void ms.judgeMemoPanel(v);
	}

	function showNaming(id: string) {
		ms.revealNaming(id, { stack: true });
	}
</script>

{#if p}
	<div class="memo-card" bind:this={cardEl} role="dialog" aria-label="Cowork memo"
		style={offset ? `right: ${offset.right}px; bottom: ${offset.bottom}px;` : undefined}>
		<div class="mc-header">
			<span class="mc-author">Cowork</span>
			<span class="mc-title" title={p.title}>{p.title || '(untitled memo)'}</span>
			<button class="mc-close" onclick={() => ms.closeMemoPanel()}
				title="Close without a verdict — the memo stays presented in the stack of its namings"
				aria-label="Close without a verdict">×</button>
		</div>

		<div class="mc-body">
			{#if content}
				<div class="mc-content">{shown}</div>
				{#if long}
					<button class="mc-more" onclick={() => (expanded = !expanded)}>{expanded ? 'less' : 'more'}</button>
				{/if}
			{/if}

			{#if linked.length > 0}
				<div class="mc-links">
					{#each linked as lid (lid)}
						<button class="mc-chip" onclick={() => showNaming(lid)} title="Show it on the map and open its stack">
							{ms.findInscription(lid)}
						</button>
					{/each}
				</div>
			{/if}

			{#if ms.memoPanelThread.length > 0}
				<div class="mc-thread">
					{#each ms.memoPanelThread as turn, i (i)}
						<div class="mc-turn" class:turn-ai={turn.role === 'ai'}>
							<span class="mc-turn-role">{turn.role === 'ai' ? 'Cowork' : 'You'}</span>
							<span class="mc-turn-content">{turn.content}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="mc-actions">
			<button class="btn-xs" disabled={ms.memoPanelBusy} onclick={() => judge('acknowledged')}
				title="Acknowledge: taken note of">ack</button>
			<button class="btn-xs" disabled={ms.memoPanelBusy} onclick={() => judge('dismissed')}
				title="Dismiss: not relevant">dismiss</button>
			<button class="btn-xs btn-promote" disabled={ms.memoPanelBusy} onclick={() => judge('promoted')}
				title="Promote: make it a naming">promote</button>
			{#if ms.memoLinkTarget !== p.id}
				<button class="btn-xs" disabled={ms.memoPanelBusy}
					onclick={() => { ms.memoLinkTarget = p.id; ms.memoLinkSearch = ''; }}>link</button>
			{/if}
			{#if ms.memoDiscussTarget !== p.id}
				<button class="btn-xs" disabled={ms.memoPanelBusy}
					onclick={() => { ms.memoDiscussTarget = p.id; ms.memoDiscussInput = ''; }}>discuss</button>
			{/if}
		</div>

		{#if ms.memoLinkTarget === p.id}
			<div class="mc-form">
				<div class="mc-form-row">
					<!-- svelte-ignore a11y_autofocus -->
					<input type="text" placeholder="Search memos to link..." bind:value={ms.memoLinkSearch} autofocus
						oninput={() => ms.searchMemosForLink(ms.memoLinkSearch)} aria-label="Search memos to link" />
					<button class="btn-xs" onclick={() => ms.cancelMemoLink()} aria-label="Cancel linking">×</button>
				</div>
				{#if ms.memoLinkResults.length > 0}
					<div class="mc-results">
						{#each ms.memoLinkResults as r (r.id)}
							<button class="mc-result" onclick={() => ms.linkMemoToMemo(p.id, r.id)}>{r.inscription}</button>
						{/each}
					</div>
				{:else if ms.memoLinkSearch.length >= 2 && !ms.memoLinkLoading}
					<span class="mc-empty">no memos found</span>
				{/if}
			</div>
		{/if}

		{#if ms.memoDiscussTarget === p.id}
			<form class="mc-form mc-form-row" onsubmit={(e) => { e.preventDefault(); ms.submitMemoDiscussion(p.id); }}>
				<!-- svelte-ignore a11y_autofocus -->
				<input type="text" placeholder="Discuss this memo..." bind:value={ms.memoDiscussInput} autofocus
					disabled={ms.memoDiscussLoading} aria-label="Discuss this memo" />
				<button type="submit" class="btn-xs" disabled={ms.memoDiscussLoading || !ms.memoDiscussInput.trim()}>
					{ms.memoDiscussLoading ? '…' : 'send'}
				</button>
			</form>
		{/if}
	</div>
{/if}

<style>
	/* Kompakt in der Ecke über der Karte (über der Zoom-Leiste), nicht in ihrer
	   Mitte. z 950: über Panels und Coach (900), unter Kopfzeile (1000) und
	   Dialogen (Memo schreiben, Kontextmenüs). */
	.memo-card {
		position: absolute; right: 12px; bottom: 54px; z-index: 950;
		width: min(320px, calc(100% - 1.5rem)); max-height: 45%;
		display: flex; flex-direction: column;
		background: #1a1d2e; border: 1px solid #3a3d5a; border-radius: 10px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
		font-size: 0.8rem;
	}
	.mc-header {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.5rem 0.6rem 0.35rem 0.75rem; flex-shrink: 0;
	}
	.mc-author {
		font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
		background: rgba(139, 156, 247, 0.15); color: #8b9cf7;
		padding: 0.1rem 0.35rem; border-radius: 3px; flex-shrink: 0;
	}
	.mc-title {
		flex: 1; min-width: 0; font-size: 0.82rem; font-weight: 600; color: #e1e4e8;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.mc-close {
		background: none; border: none; color: #8b8fa3; cursor: pointer;
		font-size: 1rem; line-height: 1; padding: 0.1rem 0.3rem; border-radius: 4px; flex-shrink: 0;
	}
	.mc-close:hover { color: #e1e4e8; background: #2a2d3a; }
	.mc-body { overflow-y: auto; padding: 0 0.75rem 0.4rem; min-height: 0; }
	.mc-content { color: #c9cdd5; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
	.mc-more {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.72rem; padding: 0.1rem 0; text-decoration: underline;
	}
	.mc-links { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.4rem; }
	.mc-chip {
		font-size: 0.7rem; color: #8b9cf7; max-width: 100%;
		background: rgba(139, 156, 247, 0.1); border: 1px solid rgba(139, 156, 247, 0.2);
		padding: 0.12rem 0.45rem; border-radius: 4px; cursor: pointer;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.mc-chip:hover { background: rgba(139, 156, 247, 0.2); }
	.mc-thread { margin-top: 0.45rem; display: flex; flex-direction: column; gap: 0.3rem; }
	.mc-turn { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.3rem 0.4rem; border-radius: 5px; background: #161822; }
	.mc-turn.turn-ai { background: rgba(139, 156, 247, 0.08); }
	.mc-turn-role { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: #6b7280; }
	.mc-turn-content { color: #c9cdd5; white-space: pre-wrap; overflow-wrap: anywhere; }
	.mc-actions {
		display: flex; flex-wrap: wrap; gap: 0.3rem; flex-shrink: 0;
		padding: 0.45rem 0.75rem; border-top: 1px solid #2a2d3a;
	}
	.mc-form { padding: 0 0.75rem 0.55rem; flex-shrink: 0; }
	.mc-form-row { display: flex; gap: 0.3rem; align-items: center; }
	.mc-form input {
		flex: 1; min-width: 0; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 4px;
		padding: 0.25rem 0.45rem; color: #e1e4e8; font-size: 0.78rem;
	}
	.mc-form input:focus { outline: none; border-color: #8b9cf7; }
	.mc-results { display: flex; flex-direction: column; margin-top: 0.25rem; max-height: 140px; overflow-y: auto; }
	.mc-result {
		background: none; border: none; color: #c9cdd5; text-align: left; cursor: pointer;
		font-size: 0.75rem; padding: 0.2rem 0.3rem; border-radius: 3px;
	}
	.mc-result:hover { background: #2a2d3a; }
	.mc-empty { display: block; font-size: 0.72rem; color: #6b7280; margin-top: 0.2rem; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.45rem; cursor: pointer;
	}
	.btn-xs:hover:not(:disabled) { border-color: #8b9cf7; color: #e1e4e8; }
	.btn-xs:disabled { opacity: 0.5; cursor: default; }
	.btn-promote { border-color: rgba(16, 185, 129, 0.45); color: #10b981; }
</style>
