<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		titleIcon,
		back,
		summary,
		actions,
		filterBar,
		afterHeader
	}: {
		title: string;
		titleIcon?: string;
		back?: { href: string; label: string };
		summary?: Snippet;
		actions?: Snippet;
		filterBar?: Snippet;
		afterHeader?: Snippet;
	} = $props();
</script>

<header class="page-header">
	<div class="row-title">
		{#if back}
			<a href={back.href} class="back-link">← {back.label}</a>
		{/if}
		<h1>
			{#if titleIcon}<img src={titleIcon} alt="" class="header-icon" />{/if}
			{title}
		</h1>
		{#if summary}<span class="summary">{@render summary()}</span>{/if}
		{#if actions}<div class="header-actions">{@render actions()}</div>{/if}
	</div>
	{#if filterBar}<div class="row-filter">{@render filterBar()}</div>{/if}
	{#if afterHeader}{@render afterHeader()}{/if}
</header>

<style>
	.page-header {
		margin-bottom: 1rem;
	}
	.row-title {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.back-link {
		font-size: 0.85rem;
		color: var(--text-3);
		text-decoration: none;
	}
	.back-link:hover { color: var(--accent); }
	h1 {
		font-size: 1.3rem;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.header-icon { width: 24px; height: 24px; opacity: 0.7; }
	.summary {
		font-size: 0.8rem;
		color: var(--text-4);
		flex-shrink: 0;
	}
	.header-actions {
		margin-left: auto;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.row-filter {
		margin-bottom: 1rem;
	}
</style>
