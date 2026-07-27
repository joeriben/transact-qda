<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" module>
	export type FilterOption = {
		value: string;
		label: string;
		dotColor?: string;
		icon?: string;
	};
	export type FilterGroup = {
		key: string;
		label: string;
		value: string;
		options: FilterOption[];
		onchange: (v: string) => void;
	};
	export type Toggle = {
		label: string;
		value: boolean;
		onchange: (v: boolean) => void;
	};
</script>

<script lang="ts">
	let {
		groups = [],
		toggles = [],
		search = $bindable(undefined),
		searchPlaceholder = 'Search…'
	}: {
		groups?: FilterGroup[];
		toggles?: Toggle[];
		search?: string;
		searchPlaceholder?: string;
	} = $props();
</script>

<div class="filter-bar">
	{#each groups as g (g.key)}
		<div class="filter-group">
			<span class="filter-label">{g.label}</span>
			{#each g.options as opt (opt.value)}
				<button
					class="filter-btn"
					class:active={g.value === opt.value}
					onclick={() => g.onchange(opt.value)}
				>
					{#if opt.dotColor}<span class="dot" style="background: {opt.dotColor}"></span>{/if}
					{#if opt.icon}<img src={opt.icon} alt="" class="filter-icon" />{/if}
					{opt.label}
				</button>
			{/each}
		</div>
	{/each}
	{#if toggles.length > 0}
		<div class="filter-group">
			{#each toggles as t (t.label)}
				<button
					class="filter-btn toggle"
					class:active={t.value}
					onclick={() => t.onchange(!t.value)}
				>{t.label}</button>
			{/each}
		</div>
	{/if}
	{#if search !== undefined}
		<input
			class="search-input"
			type="text"
			bind:value={search}
			placeholder={searchPlaceholder}
		/>
	{/if}
</div>

<style>
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.filter-group {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}
	.filter-label {
		font-size: 0.7rem;
		color: var(--text-4);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-right: 0.15rem;
	}
	.filter-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.55rem;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text-3);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.filter-btn:hover { border-color: var(--border-hi); color: var(--text-1); }
	.filter-btn.active {
		border-color: var(--accent);
		color: var(--text-1);
		background: rgba(139, 156, 247, 0.08);
	}
	.filter-icon { width: 13px; height: 13px; opacity: 0.5; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.search-input {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 0.3rem 0.55rem;
		color: var(--text-1);
		font-size: 0.8rem;
		width: 140px;
		margin-left: auto;
	}
	.search-input:focus { outline: none; border-color: var(--accent); }
	.search-input::placeholder { color: var(--text-4); }
</style>
