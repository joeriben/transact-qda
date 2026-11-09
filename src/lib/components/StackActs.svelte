<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Der Stack eines Namings: jeder Akt, chronologisch, mit dem, was er setzt
  (Inskription, Designation, Modus, Valenz) und dem Memo, das in ihm steht.
  Ein Naming IST diese Schichtung (Session 01: „seine eigene Blockchain";
  Session 03: „das Element IST diese Schichtung seiner Veränderungen").
-->
<script lang="ts">
	import { CCS_CUE, CCS_CHAR, CCS_SPEC } from '$lib/shared/tokens.js';
	import { formatWhen } from '$lib/shared/dates.js';
	import { quoted } from '$lib/shared/namingLabel.js';

	type Act = {
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
		kind?: 'act' | 'situate' | 'unsituate' | 'withdraw' | 'restore' | 'phase-assign' | 'phase-remove';
		map_inscription?: string | null;
		/** Phase, der das Naming zugeordnet oder aus der es genommen wurde. */
		phase_label?: string | null;
		/** Rolle auf der SW/A-Map (Arena, Soziale Welt, Organisation, Diskurs). */
		sw_role?: string | null;
		/** Erster Akt einer Relation: womit sie gezogen wurde (begründet ihre Anfangsstufe). */
		basis?: string | null;
	};

	let {
		acts,
		pinnedSeq = null,
		currentMap = null,
		onpin,
		onlinked
	}: {
		acts: Act[];
		/** Auf dieser Schicht ist die Perspektive kollabiert (collapseAt). */
		pinnedSeq?: string | number | null;
		/** Name der Map, auf der der Stack gerade gezeigt wird (dort ohne Map-Namen). */
		currentMap?: string | null;
		/** Perspektive auf diese Inskription festlegen (nur auf Karten). */
		onpin?: (seq: number) => void;
		/** Klick auf ein verknüpftes Naming. */
		onlinked?: (id: string) => void;
	} = $props();

	function color(d: string | null) {
		return d === 'specification' ? CCS_SPEC : d === 'characterization' ? CCS_CHAR : CCS_CUE;
	}

	const SITUATING_LABEL: Record<string, string> = {
		situate: 'placed on the map',
		unsituate: 'returned to Unplaced',
		withdraw: 'withdrawn',
		restore: 'restored',
		'phase-assign': 'assigned to phase',
		'phase-remove': 'removed from phase'
	};
</script>

<ol class="stack-acts">
	{#each acts as a (a.seq)}
		{#if a.kind && a.kind !== 'act'}
			<li class="sa sa-situating" class:sa-out={a.kind === 'withdraw' || a.kind === 'unsituate' || a.kind === 'phase-remove'}>
				<div class="sa-head">
					<span class="sa-dot sa-dot-none" class:sa-dot-withdrawn={a.kind === 'withdraw'}></span>
					<span class="sa-what">
						<span class="sa-sit">{SITUATING_LABEL[a.kind] ?? a.kind}</span>
						{#if a.phase_label}<span class="sa-tag" title="Phase">{a.phase_label}</span>{/if}
						{#if a.map_inscription && a.map_inscription !== currentMap}<span class="sa-tag" title="Map">{a.map_inscription}</span>{/if}
						{#if a.kind === 'situate' && a.sw_role}<span class="sa-tag" title="Role on this map">as {a.sw_role.replace(/-/g, ' ')}</span>{/if}
					</span>
					<span class="sa-by">{a.by_inscription}</span>
					<span class="sa-date">{formatWhen(a.created_at)}</span>
				</div>
			</li>
		{:else}
		<li class="sa" class:sa-pinned={pinnedSeq != null && String(pinnedSeq) === String(a.seq)}>
			<div class="sa-head">
				{#if a.designation}
					<span class="sa-dot" style="background: {color(a.designation)}" title={a.designation}></span>
				{:else}
					<span class="sa-dot sa-dot-none"></span>
				{/if}
				<span class="sa-what">
					{#if a.inscription}<span class="sa-ins">{quoted(a.inscription)}</span>{/if}
					{#if a.designation}<span class="sa-des" style="color: {color(a.designation)}">{a.designation}</span>{/if}
					{#if a.mode}<span class="sa-tag">as {a.mode}</span>{/if}
					{#if a.valence}<span class="sa-tag">valence: {a.valence}</span>{:else if a.valence === ''}<span class="sa-tag">valence removed</span>{/if}
					{#if !a.inscription && !a.designation && !a.mode && !a.valence && a.memo_text}<span class="sa-tag">memo</span>{/if}
				</span>
				<span class="sa-by">{a.by_inscription}</span>
				<span class="sa-date">{formatWhen(a.created_at)}</span>
				{#if onpin && a.inscription}
					<button class="sa-pin" title="Show this inscription on this map" onclick={() => onpin?.(Number(a.seq))}>pin</button>
				{/if}
			</div>
			{#if a.basis}
				<div class="sa-basis">{a.basis}</div>
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
	.sa-pinned { border-left-color: #8b9cf7; background: rgba(139, 156, 247, 0.06); }
	.sa-head { display: flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem; }
	.sa-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; align-self: center; }
	.sa-dot-none { background: transparent; border: 1px solid #3a3d4a; }
	.sa-what { display: inline-flex; gap: 0.35rem; flex-wrap: wrap; color: #e1e4e8; }
	.sa-ins { color: #e1e4e8; }
	.sa-des { font-size: 0.72rem; }
	.sa-tag { font-size: 0.68rem; color: #8b8fa3; border: 1px solid #2a2d3a; border-radius: 3px; padding: 0 0.25rem; }
	.sa-by { color: #6b7280; font-size: 0.68rem; margin-left: auto; }
	.sa-date { color: #4b5060; font-size: 0.68rem; }
	.sa-pin {
		background: none; border: 1px solid #2a2d3a; border-radius: 3px; color: #8b8fa3;
		font-size: 0.65rem; padding: 0 0.3rem; cursor: pointer;
	}
	.sa-pin:hover { border-color: #8b9cf7; color: #8b9cf7; }
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
	.sa-situating { border-left-style: dashed; }
	.sa-sit { color: #8b8fa3; font-size: 0.72rem; }
	.sa-out .sa-sit { color: #6b7280; }
	.sa-dot-withdrawn { border-color: #f87171; }
	.sa-through { font-size: 0.66rem; color: #6b7280; align-self: center; }
	button.sa-chip:hover { border-color: #8b9cf7; color: #e1e4e8; }
</style>
