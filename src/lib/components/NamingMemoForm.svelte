<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Memo ZU einem Naming schreiben, dort, wo das Naming gerade steht (Naming-
  Liste, Naming-Seite, Map-Stack, Dokumentansicht).

  Das Memo ist ein Akt im Stack dieses Namings (Aktion `note`, siehe
  noteOnNaming in queries/namings.ts) — kein eigenes Naming. Es trägt den
  Text und, wenn man will, die Namings, die man beim Schreiben im Sinn hat.
  Steht das Naming auf cue, hebt die Notiz es auf characterization.
-->
<script lang="ts">
	let {
		projectId,
		namingId,
		candidates = [],
		startOpen = false,
		oncreated,
		oncancel
	}: {
		projectId: string;
		namingId: string;
		/** Namings, auf die das Memo verweisen kann (optional). */
		candidates?: { id: string; label: string }[];
		startOpen?: boolean;
		oncreated?: () => void | Promise<void>;
		oncancel?: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let open = $state(startOpen);
	let text = $state('');
	let linked = $state<{ id: string; label: string }[]>([]);
	let linkQuery = $state('');
	let saving = $state(false);
	let failed = $state(false);

	const suggestions = $derived.by(() => {
		const q = linkQuery.trim().toLowerCase();
		if (q.length < 1) return [];
		const taken = new Set([namingId, ...linked.map((l) => l.id)]);
		return candidates
			.filter((c) => !taken.has(c.id) && (c.label ?? '').toLowerCase().includes(q))
			.slice(0, 8);
	});

	// Das Feld bekommt den Fokus, sobald es erscheint — auch wenn es in einem
	// Panel steht, das erst nach dem Laden des Stacks gerendert wird
	// (autofocus greift dort nicht).
	function focusOnMount(el: HTMLTextAreaElement) {
		const t = setTimeout(() => el.focus({ preventScroll: false }), 0);
		return { destroy: () => clearTimeout(t) };
	}

	function reset() {
		open = false;
		text = '';
		linked = [];
		linkQuery = '';
		failed = false;
	}

	function cancel() {
		reset();
		oncancel?.();
	}

	async function save() {
		if (!text.trim() || saving) return;
		saving = true;
		failed = false;
		try {
			const res = await fetch(`/api/projects/${projectId}/namings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'note',
					namingId,
					memoText: text.trim(),
					linkedNamingIds: linked.map((l) => l.id)
				})
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			reset();
			await oncreated?.();
		} catch {
			failed = true;
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form class="nmf" onsubmit={(e) => { e.preventDefault(); save(); }} onclick={(e) => e.stopPropagation()}>
		<textarea class="nmf-text" placeholder="Memo on this naming" aria-label="Memo on this naming" rows="5" bind:value={text} use:focusOnMount
			onkeydown={(e) => {
				if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
			}}></textarea>
		{#if candidates.length > 0}
			<div class="nmf-links">
				{#each linked as l (l.id)}
					<span class="nmf-chip">{l.label}<button type="button" title="Remove" aria-label="Remove reference to {l.label}" onclick={() => { linked = linked.filter((x) => x.id !== l.id); }}>×</button></span>
				{/each}
				<input class="nmf-link-input" type="text" placeholder="refer to a naming…" aria-label="Refer to a naming" bind:value={linkQuery}
					onkeydown={(e) => {
						if (e.key === 'Escape') { e.stopPropagation(); linkQuery = ''; }
						if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) { linked = [...linked, suggestions[0]]; linkQuery = ''; } }
					}} />
				{#if suggestions.length > 0}
					<div class="nmf-suggest">
						{#each suggestions as s (s.id)}
							<button type="button" onclick={() => { linked = [...linked, s]; linkQuery = ''; }}>{s.label}</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		<div class="nmf-actions">
			<button type="submit" class="nmf-save" disabled={!text.trim() || saving}>{saving ? 'Saving…' : 'Save memo'}</button>
			<button type="button" class="nmf-cancel" onclick={cancel}>Cancel</button>
			<span class="nmf-hint">⌘↵ saves</span>
			{#if failed}<span class="nmf-error">Not saved.</span>{/if}
		</div>
	</form>
{:else}
	<button type="button" class="nmf-add" onclick={(e) => { e.stopPropagation(); open = true; }}>+ Memo</button>
{/if}

<style>
	.nmf {
		display: flex; flex-direction: column; gap: 0.35rem;
		margin-top: 0.4rem; padding: 0.5rem;
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		position: relative;
	}
	.nmf-text, .nmf-link-input {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #e1e4e8; font: inherit; font-size: 0.8rem; padding: 0.35rem 0.5rem;
	}
	.nmf-text { resize: vertical; line-height: 1.5; min-height: 5em; }
	.nmf-text:focus, .nmf-link-input:focus { outline: none; border-color: #8b9cf7; }
	.nmf-links { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; position: relative; }
	.nmf-link-input { flex: 1; min-width: 8rem; font-size: 0.75rem; padding: 0.2rem 0.4rem; }
	.nmf-chip {
		display: inline-flex; align-items: center; gap: 0.2rem;
		font-size: 0.72rem; color: #c4c8d4; background: #1e2030;
		border: 1px solid #2a2d3a; border-radius: 10px; padding: 0.05rem 0.4rem;
	}
	.nmf-chip button { background: none; border: none; color: #6b7280; cursor: pointer; padding: 0; font-size: 0.8rem; }
	.nmf-chip button:hover { color: #f87171; }
	/* Im Fluss statt darüber gelegt: Die Liste schiebt Speichern/Abbrechen nach
	   unten, statt sie zu verdecken, und wird in engen Panels nicht abgeschnitten. */
	.nmf-suggest {
		flex-basis: 100%;
		display: flex; flex-direction: column;
		max-height: 10rem; overflow-y: auto;
		background: #161822; border: 1px solid #2a2d3a; border-radius: 4px;
	}
	.nmf-suggest button {
		text-align: left; background: none; border: none; color: #c4c8d4;
		font-size: 0.75rem; padding: 0.25rem 0.5rem; cursor: pointer;
	}
	.nmf-suggest button:hover { background: #1e2030; color: #e1e4e8; }
	.nmf-actions { display: flex; align-items: center; gap: 0.4rem; }
	.nmf-hint { font-size: 0.68rem; color: #4b5060; }
	.nmf-save {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 4px;
		font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.6rem; cursor: pointer;
	}
	.nmf-save:disabled { opacity: 0.5; cursor: default; }
	.nmf-cancel, .nmf-add {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.72rem; padding: 0.2rem 0.5rem; cursor: pointer;
	}
	.nmf-add { color: #8b9cf7; border-color: rgba(139, 156, 247, 0.35); margin-top: 0.3rem; align-self: flex-start; }
	.nmf-add:hover, .nmf-cancel:hover { border-color: #8b9cf7; }
	.nmf-error { font-size: 0.72rem; color: #f87171; }
</style>
