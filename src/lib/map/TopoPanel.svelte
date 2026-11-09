<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { formatWhen } from '$lib/shared/dates.js';
	import { quoted } from '$lib/shared/namingLabel.js';
	import { focusSelect } from '$lib/canvas/dom.js';

	// Snapshots der Lage dieser Karte. Der Name steht im Feld (vorbelegt mit
	// Datum und Uhrzeit), Enter speichert — kein Browser-Dialog: prompt() war in
	// manchen Umgebungen gesperrt, und dann ging das Speichern still verloren.
	// Was geschah, sagt eine Statuszeile im Panel.

	let {
		snapshots,
		onclose,
		onsave,
		onrestore,
	}: {
		snapshots: any[];
		onclose: () => void;
		/** true, wenn gespeichert. */
		onsave: (label: string) => Promise<boolean>;
		/** ok und der Name der Sicherung, die vorher angelegt wurde (null, wenn
		 *  es nichts zu sichern gab). */
		onrestore: (seq: number) => Promise<{ ok: boolean; backup: string | null }>;
	} = $props();

	const defaultLabel = () => `Snapshot — ${formatWhen(new Date())}`;
	let label = $state(defaultLabel());
	let busy = $state(false);
	let status = $state<{ text: string; error: boolean } | null>(null);

	async function save() {
		if (busy) return;
		const name = label.trim() || defaultLabel();
		busy = true;
		try {
			const ok = await onsave(name);
			status = ok
				? { text: `Saved ${quoted(name)}.`, error: false }
				: { text: 'Snapshot not saved (server error).', error: true };
			if (ok) label = defaultLabel();
		} finally {
			busy = false;
		}
	}

	async function restore(snap: any) {
		if (busy) return;
		busy = true;
		status = null;
		try {
			const name = snap.label || `#${snap.seq}`;
			const r = await onrestore(snap.seq);
			if (r.ok) {
				status = {
					text: r.backup
						? `Restored ${quoted(name)}. The layout before is saved as ${quoted(r.backup)}.`
						: `Restored ${quoted(name)}.`,
					error: false
				};
			}
		} finally {
			busy = false;
		}
	}
</script>

<div class="topo-panel">
	<div class="topo-header">
		<span class="topo-title">Topology snapshots</span>
		<button class="btn-link" onclick={onclose}>close</button>
	</div>
	<form class="topo-save" onsubmit={(e) => { e.preventDefault(); save(); }}>
		<input type="text" bind:value={label} aria-label="Name of the new snapshot" use:focusSelect readonly={busy} />
		<button type="submit" class="btn-sm-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
	</form>
	<p class="topo-status" class:error={status?.error} role="status">{status?.text ?? ''}</p>
	{#if snapshots.length === 0}
		<span class="topo-empty">No snapshots yet</span>
	{:else}
		<div class="topo-list">
			{#each snapshots as snap (snap.seq)}
				<div class="topo-entry">
					<span class="topo-label">{snap.label || `#${snap.seq}`}</span>
					<span class="topo-meta">{snap.node_count} nodes · {formatWhen(snap.created_at)}</span>
					<button class="btn-xs" disabled={busy} onclick={() => restore(snap)}
						aria-label="Restore {snap.label || `#${snap.seq}`}"
						title="Restore this layout — the current one is saved as a snapshot first">restore</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Über der Karte, nicht im Fluss: die Karte rückt nicht nach unten. */
	.topo-panel {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 0.6rem 0.8rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.topo-header {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.8rem; color: #c9cdd5; margin-bottom: 0.4rem;
	}
	.topo-title { flex: 1; }
	.topo-save { display: flex; gap: 0.4rem; }
	.topo-save input {
		flex: 1; min-width: 0; background: #0f1117; border: 1px solid #2a2d3a; border-radius: 5px;
		padding: 0.3rem 0.5rem; color: #e1e4e8; font-size: 0.8rem; font-family: inherit;
	}
	.topo-save input:focus { outline: none; border-color: #8b9cf7; }
	.topo-status { margin: 0.3rem 0 0.2rem; min-height: 1em; font-size: 0.72rem; color: #10b981; }
	.topo-status.error { color: #f87171; }
	.topo-status:empty { margin: 0; min-height: 0; }
	.topo-list { max-height: 180px; overflow-y: auto; }
	.topo-empty { font-size: 0.75rem; color: #4b5563; }
	.topo-entry {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.25rem 0; border-bottom: 1px solid #1e2030;
		font-size: 0.78rem;
	}
	.topo-entry:last-child { border-bottom: none; }
	.topo-label { color: #f59e0b; flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.topo-meta { color: #4b5563; font-size: 0.7rem; flex-shrink: 0; }
	.btn-sm-primary { background: #8b9cf7; color: #0f1117; border: none; border-radius: 5px; padding: 0.3rem 0.75rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
	.btn-sm-primary:disabled { opacity: 0.6; cursor: default; }
	.btn-xs {
		background: none; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #8b8fa3; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer; flex-shrink: 0;
	}
	.btn-xs:hover:not(:disabled) { border-color: #8b9cf7; }
	.btn-xs:disabled { opacity: 0.5; cursor: default; }
	.btn-link {
		background: none; border: none; color: #8b9cf7; cursor: pointer;
		font-size: 0.8rem; text-decoration: underline;
	}
</style>
