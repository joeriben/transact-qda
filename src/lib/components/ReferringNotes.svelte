<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Memos in den Stacks ANDERER Namings, die auf dieses Naming verweisen
  (getNamingStack → referringNotes). Ein Bezug ist in beide Richtungen
  sichtbar: beim Naming, in dessen Stack das Memo steht, und hier.
-->
<script lang="ts">
	import { formatWhen } from '$lib/shared/dates.js';

	type Note = {
		seq: string | number;
		on_id: string;
		on_label: string;
		memo_text: string;
		created_at: string;
		by_inscription: string;
	};

	let { notes, onopen }: { notes: Note[]; onopen?: (id: string) => void } = $props();
</script>

{#each notes as n (n.seq)}
	<div class="rn">
		<div class="rn-head">
			<span class="rn-in">in the stack of</span>
			{#if onopen}
				<button class="rn-chip" onclick={() => onopen?.(n.on_id)}>{n.on_label}</button>
			{:else}
				<span class="rn-chip">{n.on_label}</span>
			{/if}
			<span class="rn-by">{n.by_inscription}</span>
			<span class="rn-date">{formatWhen(n.created_at)}</span>
		</div>
		<div class="rn-text">{n.memo_text}</div>
	</div>
{/each}

<style>
	.rn { border-left: 2px solid #2a2d3a; padding: 0.15rem 0 0.15rem 0.45rem; margin-bottom: 0.3rem; }
	.rn-head { display: flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; font-size: 0.72rem; }
	.rn-in { color: #6b7280; }
	.rn-chip {
		font-size: 0.68rem; color: #a0a4b0; background: #1e2030; border: 1px solid #2a2d3a;
		border-radius: 10px; padding: 0 0.4rem; cursor: pointer; font-family: inherit;
	}
	span.rn-chip { cursor: default; }
	button.rn-chip:hover { border-color: #8b9cf7; color: #e1e4e8; }
	.rn-by { color: #6b7280; font-size: 0.68rem; margin-left: auto; }
	.rn-date { color: #4b5060; font-size: 0.68rem; }
	.rn-text {
		margin-top: 0.15rem; font-size: 0.76rem; color: #c4c8d4; white-space: pre-wrap; line-height: 1.45;
		border-left: 2px solid rgba(245, 158, 11, 0.45); padding-left: 0.4rem;
	}
</style>
