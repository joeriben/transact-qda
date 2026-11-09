<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { focusSelect } from './dom.js';

	// Umbenennen an Ort und Stelle: Fokus im Feld, alter Name markiert, Enter
	// bestätigt, Escape bricht ab. Die Klasse .inline-rename nimmt CanvasElement
	// vom Ziehen aus.
	let {
		value = $bindable(''),
		onsubmit,
		oncancel
	}: {
		value?: string;
		onsubmit: () => void;
		oncancel: () => void;
	} = $props();
</script>

<form class="inline-rename" onsubmit={(e) => { e.preventDefault(); onsubmit(); }}>
	<input
		type="text"
		bind:value
		use:focusSelect
		aria-label="New name"
		onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); oncancel(); } }}
	/>
	<button type="submit" class="ir-btn">ok</button>
	<button type="button" class="ir-btn" onclick={oncancel} aria-label="Cancel renaming">×</button>
</form>

<style>
	.inline-rename {
		display: flex; gap: 0.3rem; align-items: center;
		min-width: 0; pointer-events: auto;
	}
	.inline-rename input {
		flex: 1 1 auto; min-width: 4rem; width: 9rem;
		background: #0f1117; border: 1px solid #8b9cf7; border-radius: 4px;
		padding: 0.15rem 0.35rem; color: #e1e4e8; font-size: 0.85rem; font-family: inherit;
		user-select: text;
	}
	.inline-rename input:focus { outline: none; }
	.ir-btn {
		flex-shrink: 0;
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 4px;
		color: #c9cdd5; font-size: 0.7rem; padding: 0.15rem 0.4rem; cursor: pointer;
	}
	.ir-btn:hover { border-color: #8b9cf7; color: #e1e4e8; }
</style>
