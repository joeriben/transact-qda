<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Memo-Editor. Ein Textfeld, kein contenteditable: Der frühere Editor
  renderte seinen eigenen Inhalt bei jeder Eingabe per {@html} erneut in das
  Feld, in das gerade getippt wurde, und Svelte entfernte dabei nur die
  Knoten, die es selbst eingefügt hatte. Alles, was der Browser beim Tippen
  neu angelegt hatte, blieb stehen, und der gesamte Text kam noch einmal
  dazu — mit jedem Tastendruck.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import TechnicalErrorButton from '$lib/components/TechnicalErrorButton.svelte';
	import { memoText } from '$lib/shared/memoText.js';
	import { formatWhen } from '$lib/shared/dates.js';

	let { data } = $props();

	let content = $state(untrack(() => memoText(data.memo.content)));
	// Was der Server hat, in der Form, in der das Feld es zeigt. Ein altes
	// HTML-Memo wird erst beim ersten Tippen als Text zurückgeschrieben.
	let savedContent = untrack(() => content);
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let lastSaved = $state<Date | null>(null);

	let saveTimeout: ReturnType<typeof setTimeout> | undefined;
	let inFlight = false;
	let again = false;

	const url = $derived(`/api/projects/${data.projectId}/memos/${data.memo.id}`);

	function onInput() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(save, 800);
	}

	async function save() {
		clearTimeout(saveTimeout);
		if (inFlight) { again = true; return; }
		if (content === savedContent) return;
		inFlight = true;
		status = 'saving';
		const toSave = content;
		try {
			const res = await fetch(url, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: toSave })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			savedContent = toSave;
			status = 'saved';
			lastSaved = new Date();
		} catch {
			status = 'error';
		} finally {
			inFlight = false;
		}
		if (again) {
			again = false;
			if (status !== 'error') save();
		}
	}

	// Nichts geht verloren, wenn man vor Ablauf der Wartezeit weiterklickt.
	beforeNavigate(() => { save(); });

	function onPageHide() {
		if (content === savedContent) return;
		clearTimeout(saveTimeout);
		// keepalive trägt höchstens 64 KB; darüber bleibt es beim Versuch.
		fetch(url, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content }),
			keepalive: true
		}).catch(() => {});
	}
</script>

<svelte:window onpagehide={onPageHide} />

<div class="memo-editor">
	<div class="memo-header">
		<a href="/projects/{data.projectId}/memos" class="back">&larr; Memos</a>
		<h1>{data.memo.label}</h1>
		<div class="save-status" class:error={status === 'error'}>
			{#if status === 'saving'}
				Saving…
			{:else if status === 'error'}
				Not saved. <button class="retry" onclick={save}>Retry</button>
			{:else if lastSaved}
				Saved {formatWhen(lastSaved)}
			{/if}
		</div>
	</div>

	<div class="editor-container">
		<div class="editor-main">
			<textarea
				class="memo-text"
				placeholder="Start writing..."
				bind:value={content}
				oninput={onInput}
				onblur={save}
			></textarea>
		</div>

		<div class="links-panel">
			<h3>Linked namings</h3>
			{#if data.memo.links.length === 0}
				<p class="empty">Not linked to any naming. Memos for a naming are written from the naming itself (+ Memo).</p>
			{:else}
				{#each data.memo.links as link}
					<a class="link-item" href="/projects/{data.projectId}/namings/{link.target_id}">
						{#if link.target_mode && link.target_mode !== 'entity'}
							<span class="link-kind">{link.target_mode}</span>
						{/if}
						<span>{link.target_label}</span>
					</a>
				{/each}
			{/if}
			<div class="te-row">
				<TechnicalErrorButton projectId={data.projectId} namingId={data.memo.id} what="memo"
					ondone={() => goto(`/projects/${data.projectId}/memos?hidden=memo`)} />
			</div>
		</div>
	</div>
</div>

<style>
	.memo-editor { display: flex; flex-direction: column; height: calc(100vh - 6rem); }

	.memo-header { margin-bottom: 1rem; }
	.back { font-size: 0.8rem; color: #6b7280; display: inline-block; margin-bottom: 0.5rem; }
	h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
	.save-status { font-size: 0.75rem; color: #6b7280; min-height: 1.1em; }
	.save-status.error { color: #f87171; }
	.retry {
		background: none; border: 1px solid #f87171; border-radius: 4px; color: #f87171;
		font-size: 0.7rem; padding: 0 0.4rem; cursor: pointer; margin-left: 0.3rem;
	}

	.editor-container { display: flex; gap: 1rem; flex: 1; min-height: 0; }

	.editor-main {
		flex: 1;
		display: flex;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		min-width: 0;
	}
	.editor-main:focus-within { border-color: #3a3d5a; }

	.memo-text {
		flex: 1;
		padding: 1.5rem;
		background: transparent;
		border: none;
		outline: none;
		resize: none;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.7;
		color: #d1d5db;
	}
	.memo-text::placeholder { color: #4b5563; }

	.links-panel {
		width: 240px;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1rem;
		overflow-y: auto;
	}
	.te-row { margin-top: 1.5rem; padding-top: 0.75rem; border-top: 1px solid #2a2d3a; }
	.links-panel h3 { font-size: 0.85rem; color: #8b8fa3; margin-bottom: 0.75rem; }
	.empty { font-size: 0.8rem; color: #6b7280; line-height: 1.5; }

	.link-item {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.35rem 0; font-size: 0.85rem; color: #c9cdd5; text-decoration: none;
	}
	.link-item:hover { color: #8b9cf7; }
	.link-kind {
		font-size: 0.7rem; color: #6b7280; text-transform: uppercase;
		background: #1e2030; padding: 0.1rem 0.35rem; border-radius: 3px;
	}
</style>
