<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { getMapState } from './mapState.svelte.js';

	// Memo-Vorschau eines Kartenknotens. Liegt außerhalb der skalierten
	// Canvas-Ebene und fest im Fenster: im Knoten wuchs und schrumpfte sie mit
	// dem Zoom und war bei kleiner Ansicht unlesbar.

	const ms = getMapState();

	/** Entspricht max-width von .memo-tooltip. */
	const WIDTH = 320;
	const GAP = 4;

	const tip = $derived(ms.memoTip);
	const previews = $derived<any[]>(tip?.el.memo_previews ?? []);

	// Unter dem Knoten; liegt der Knoten in der unteren Fensterhälfte, darüber.
	const style = $derived.by(() => {
		if (!tip) return '';
		const r = tip.rect;
		const left = Math.max(GAP, Math.min(r.left, window.innerWidth - WIDTH - GAP));
		return r.bottom > window.innerHeight / 2
			? `left: ${left}px; bottom: ${window.innerHeight - r.top + GAP}px;`
			: `left: ${left}px; top: ${r.bottom + GAP}px;`;
	});

	// Zoomen, Verschieben und Ziehen bewegen den Knoten unter dem Kasten weg.
	$effect(() => {
		if (!tip) return;
		const hide = () => ms.hideMemoTip();
		const onDown = (e: PointerEvent) => {
			if (!(e.target as Element | null)?.closest('.memo-tooltip')) hide();
		};
		window.addEventListener('wheel', hide, { passive: true, capture: true });
		window.addEventListener('pointerdown', onDown, true);
		return () => {
			window.removeEventListener('wheel', hide, { capture: true });
			window.removeEventListener('pointerdown', onDown, true);
		};
	});
</script>

{#if tip && previews.length > 0}
	<div class="memo-tooltip" {style} role="tooltip"
		onmouseenter={() => ms.keepMemoTip()} onmouseleave={() => ms.hideMemoTip(150)}>
		{#each previews.slice(0, 4) as mp}
			<div class="memo-tip-entry">
				<div class="memo-tip-header">
					<span class="memo-tip-provenance" class:tip-ai={mp.isAi}>{mp.isAi ? 'AI' : 'R'}</span>
					<span class="memo-tip-label">{mp.label}</span>
					{#if mp.status && mp.status !== 'active'}
						<span class="memo-tip-status tip-status-{mp.status}">{mp.status}</span>
					{/if}
				</div>
				{#if mp.content}<span class="memo-tip-content">{mp.content.slice(0, 150)}{mp.content.length > 150 ? '…' : ''}</span>{/if}
			</div>
		{/each}
		{#if previews.length > 4}
			<span class="memo-tip-more">+{previews.length - 4} more</span>
		{/if}
		<button class="memo-tip-open" onclick={() => { const id = tip.el.naming_id; ms.hideMemoTip(); ms.showStack(id); }}>open stack</button>
	</div>
{/if}

<style>
	.memo-tooltip {
		position: fixed; z-index: 60;
		min-width: 280px; max-width: 320px;
		background: #1e2030; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
	}
	.memo-tip-entry { padding: 0.25rem 0; border-bottom: 1px solid #161822; }
	.memo-tip-entry:last-of-type { border-bottom: none; }
	.memo-tip-header { display: flex; align-items: center; gap: 0.3rem; }
	.memo-tip-provenance {
		font-size: 0.55rem; font-weight: 700; text-transform: uppercase;
		background: rgba(107, 114, 128, 0.2); color: #9ca3af;
		padding: 0 0.2rem; border-radius: 2px; flex-shrink: 0;
	}
	.memo-tip-provenance.tip-ai { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	.memo-tip-label { font-size: 0.7rem; color: #f59e0b; }
	.memo-tip-status {
		font-size: 0.55rem; font-weight: 600; text-transform: uppercase;
		padding: 0 0.2rem; border-radius: 2px; flex-shrink: 0; margin-left: auto;
	}
	:global(.tip-status-presented) { background: rgba(139, 156, 247, 0.15); color: #8b9cf7; }
	:global(.tip-status-discussed) { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
	:global(.tip-status-acknowledged) { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	:global(.tip-status-dismissed) { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.memo-tip-content { font-size: 0.75rem; color: #a0a4b0; display: block; margin-top: 0.1rem; }
	.memo-tip-more { font-size: 0.7rem; color: #6b7280; margin-top: 0.2rem; display: block; }
	.memo-tip-open {
		display: block; width: 100%; text-align: left;
		background: none; border: none; border-top: 1px solid #2a2d3a;
		font-size: 0.68rem; color: #8b9cf7; cursor: pointer;
		margin-top: 0.3rem; padding: 0.2rem 0 0;
	}
	.memo-tip-open:hover { text-decoration: underline; }
</style>
