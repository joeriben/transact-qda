<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	// Einen Eintrag als technischen Fehler markieren und dauerhaft ausblenden
	// (markTechnicalError). Zwei Schritte in der Oberfläche statt eines
	// Browser-Dialogs: erst fragen, dann ausblenden.
	let {
		projectId,
		namingId,
		what = 'entry',
		ondone
	}: {
		projectId: string;
		namingId: string;
		what?: string;
		ondone?: () => void | Promise<void>;
	} = $props();

	let asking = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function hide() {
		busy = true;
		error = '';
		try {
			const res = await fetch(`/api/projects/${projectId}/namings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'technicalError', namingId })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error || `Not hidden (${res.status})`;
				return;
			}
			asking = false;
			await ondone?.();
		} finally {
			busy = false;
		}
	}
</script>

{#if asking}
	<span class="te-ask" role="group" aria-label="Hide as technical error">
		<span class="te-q">Hide this {what} and its links from every view, for good? It stays in the database, with this act on record.</span>
		<button class="btn-xs te-yes" onclick={hide} disabled={busy}>{busy ? '…' : 'hide'}</button>
		<button class="btn-xs" onclick={() => { asking = false; error = ''; }} disabled={busy}>cancel</button>
		{#if error}<span class="te-error" role="alert">{error}</span>{/if}
	</span>
{:else}
	<button class="btn-xs te-btn" onclick={() => (asking = true)}
		title="For entries a software error produced: hides it and its links from every view, for good. Nothing is deleted from the database; the act is kept on record.">
		hide as technical error…
	</button>
{/if}

<style>
	.te-ask { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; }
	.te-q { font-size: 0.72rem; color: #f59e0b; }
	.te-error { font-size: 0.72rem; color: #ef4444; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer; font-family: inherit;
	}
	.btn-xs:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.te-btn { color: #6b7280; }
	.te-yes { border-color: #b45309; color: #f59e0b; }
</style>
