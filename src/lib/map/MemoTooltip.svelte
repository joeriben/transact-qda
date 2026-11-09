<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { memoText } from '$lib/shared/memoText.js';
	import { getMapState } from './mapState.svelte.js';

	// Memo-Vorschau eines Kartenknotens. Liegt außerhalb der skalierten
	// Canvas-Ebene und fest im Fenster: im Knoten wuchs und schrumpfte sie mit
	// dem Zoom und war bei kleiner Ansicht unlesbar.

	let {
		/** Fläche, in der die Vorschau bleibt (die Canvas) — sonst ragte sie in
		 *  die Seitenleiste. Ohne Angabe das Fenster. */
		bounds = null
	}: {
		bounds?: (() => DOMRect | null) | null;
	} = $props();

	const ms = getMapState();

	/** Entspricht max-width von .memo-tooltip. */
	const WIDTH = 320;
	const GAP = 4;

	const tip = $derived(ms.memoTip);
	const previews = $derived<any[]>(tip?.el.memo_previews ?? []);

	// Unter dem Knoten; liegt der Knoten in der unteren Hälfte der Fläche,
	// darüber. Waagerecht und in der Höhe bleibt sie in der Fläche.
	const style = $derived.by(() => {
		if (!tip) return '';
		const r = tip.rect;
		const b = bounds?.() ?? null;
		const L = b ? b.left : 0;
		const R = b ? b.right : window.innerWidth;
		const T = b ? b.top : 0;
		const B = b ? b.bottom : window.innerHeight;
		const width = Math.min(WIDTH, Math.max(160, R - L - 2 * GAP));
		const left = Math.max(L + GAP, Math.min(r.left, R - width - GAP));
		const below = r.bottom <= (T + B) / 2;
		const room = below ? B - r.bottom - 2 * GAP : r.top - T - 2 * GAP;
		const size = `width: ${width}px; max-height: ${Math.max(80, room)}px;`;
		return below
			? `left: ${left}px; top: ${Math.max(T + GAP, r.bottom + GAP)}px; ${size}`
			: `left: ${left}px; bottom: ${window.innerHeight - Math.min(B - GAP, r.top - GAP)}px; ${size}`;
	});

	// Zoomen, Verschieben, Ziehen und Kontextmenü: die Vorschau geht weg. Sie
	// ist reine Anzeige (fängt keine Zeiger ab); der Stack öffnet sich per
	// Doppelklick oder über das Memo-Abzeichen am Knoten.
	$effect(() => {
		if (!tip) return;
		const hide = () => ms.hideMemoTip();
		window.addEventListener('wheel', hide, { passive: true, capture: true });
		window.addEventListener('pointerdown', hide, true);
		window.addEventListener('contextmenu', hide, true);
		return () => {
			window.removeEventListener('wheel', hide, { capture: true });
			window.removeEventListener('pointerdown', hide, true);
			window.removeEventListener('contextmenu', hide, true);
		};
	});
</script>

{#if tip && previews.length > 0}
	<div class="memo-tooltip" {style} role="tooltip">
		{#each previews.slice(0, 4) as mp}
			<div class="memo-tip-entry">
				<div class="memo-tip-header">
					<!-- Nur was Cowork schrieb, trägt ein Kennzeichen; das eigene Memo nicht. -->
					{#if mp.isAi}<span class="memo-tip-provenance tip-ai" title="Written by Cowork">Cowork</span>{/if}
					<span class="memo-tip-label">{mp.label}</span>
					{#if mp.status && mp.status !== 'active'}
						<span class="memo-tip-status tip-status-{mp.status}">{mp.status}</span>
					{/if}
				</div>
				{#if mp.content}{@const t = memoText(mp.content)}<span class="memo-tip-content">{t.slice(0, 150)}{t.length > 150 ? '…' : ''}</span>{/if}
			</div>
		{/each}
		{#if previews.length > 4}
			<span class="memo-tip-more">+{previews.length - 4} more</span>
		{/if}
		<span class="memo-tip-hint">Double-click to open the stack</span>
	</div>
{/if}

<style>
	.memo-tooltip {
		position: fixed; z-index: 955; /* über der Cowork-Karte (950) */
		/* Nur Anzeige: Klicks und Rechtsklicks gehen an das, was darunter liegt. */
		pointer-events: none;
		max-width: 320px; overflow: hidden;
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
	.memo-tip-hint {
		display: block; border-top: 1px solid #2a2d3a;
		font-size: 0.65rem; color: #6b7280;
		margin-top: 0.3rem; padding: 0.2rem 0 0;
	}
</style>
