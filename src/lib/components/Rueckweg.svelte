<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Der sichtbare Rückweg. Steht nur da, wenn man wirklich woandersher kam,
  und sagt, wohin er führt. Begründung des Mechanismus: shared/rueckweg.ts.

  Fest an der unteren Kante des Inhaltsbereichs, nicht in der Kopfzeile: das
  Sprungziel liegt oft tausende Pixel weit unten (Naming-Liste, Transkript).
  Eine Kopfzeile ist genau dann weggescrollt, wenn man den Rückweg braucht.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { rueckwegHref, rueckwegLabel } from '$lib/shared/rueckweg.js';

	const href = $derived(rueckwegHref($page.url));
	const label = $derived(href ? rueckwegLabel(href, $page.data) : '');
</script>

{#if href}
	<a class="rueckweg" {href} title="Zurück zu „{label}“ — an dieselbe Stelle">
		&larr; {label}
	</a>
{/if}

<style>
	.rueckweg {
		position: fixed;
		/* --content-left setzt das Projekt-Layout aus der Breite der Menüspalte;
		   ohne die Variable (außerhalb eines Projekts) klebt der Weg links. */
		left: calc(var(--content-left, 0px) + 1rem);
		bottom: 1rem;
		z-index: 150;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid rgba(139, 156, 247, 0.45);
		border-radius: 999px;
		background: #1b1e2e;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
		color: #8b9cf7;
		font-size: 0.75rem;
		text-decoration: none;
		white-space: nowrap;
		max-width: 24ch;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rueckweg:hover {
		border-color: #8b9cf7;
		background: #232741;
		color: #b6c2ff;
	}
</style>
