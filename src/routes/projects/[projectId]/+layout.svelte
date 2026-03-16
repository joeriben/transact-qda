<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';

	let { data, children }: { data: any; children: Snippet } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
	const base = $derived(`/projects/${p.id}`);
	const mapsByType = $derived(data.mapsByType as Record<string, { id: string; label: string }[]>);
	const pathname = $derived($page.url.pathname);

	const mapTypeLabels: Record<string, string> = {
		situational: 'Situational Maps',
		'social-worlds': 'Social Worlds Maps',
		positional: 'Positional Maps',
		network: 'Network Maps'
	};
	const mapTypeOrder = ['situational', 'social-worlds', 'positional', 'network'];
</script>

<div class="project-layout">
	<div class="project-sidebar">
		<h2>{p.name}</h2>
		{#if p.description}
			<p class="desc">{p.description}</p>
		{/if}

		<nav>
			{#each mapTypeOrder as type}
				{#if mapsByType[type]?.length}
					<span class="map-group-label">{mapTypeLabels[type]}</span>
					{#each mapsByType[type] as map}
						<a
							href="{base}/maps/{map.id}"
							class="map-link"
							class:active={pathname === `${base}/maps/${map.id}`}
						>{map.label}</a>
					{/each}
				{/if}
			{/each}
			<a href="{base}/namings">Namings</a>
			<a href="{base}/documents">Documents</a>
			<a href="{base}/memos">Memos</a>
			<a href="{base}/members">Members</a>
		</nav>
	</div>

	<div class="project-content">
		{@render children()}
	</div>
</div>

<style>
	.project-layout {
		display: flex;
		gap: 0;
		height: calc(100vh - 4rem);
		margin: -2rem;
	}

	.project-sidebar {
		width: 200px;
		padding: 1.25rem;
		border-right: 1px solid #2a2d3a;
		background: #13151e;
	}

	.project-sidebar h2 {
		font-size: 0.95rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.desc {
		font-size: 0.8rem;
		color: #6b7280;
		margin-bottom: 1rem;
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-top: 1rem;
	}

	nav a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.65rem;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #c9cdd5;
	}
	nav a:hover {
		background: #1e2030;
		color: #fff;
	}

	.map-group-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.5rem 0.65rem 0.15rem;
		margin-top: 0.15rem;
	}

	.map-group-label:first-child {
		margin-top: 0;
	}

	.map-link {
		padding-left: 1.2rem !important;
	}

	.active {
		background: #1e2030;
		color: #fff;
	}

	.project-content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
