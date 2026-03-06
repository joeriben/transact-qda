<script lang="ts">
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { user: any }; children: Snippet } = $props();

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		window.location.href = '/login';
	}
</script>

<svelte:head>
	<title>transact-qda</title>
</svelte:head>

{#if data.user}
	<div class="app">
		<nav class="sidebar">
			<div class="logo">transact-qda</div>
			<a href="/projects">Projects</a>
			<div class="sidebar-spacer"></div>
			<div class="user-info">
				<span>{data.user.displayName || data.user.username}</span>
				<button onclick={logout}>Logout</button>
			</div>
		</nav>
		<main class="content">
			{@render children()}
		</main>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #0f1117;
		color: #e1e4e8;
		min-height: 100vh;
	}

	:global(a) {
		color: #8b9cf7;
		text-decoration: none;
	}
	:global(a:hover) {
		color: #a5b4fc;
	}

	.app {
		display: flex;
		min-height: 100vh;
	}

	.sidebar {
		width: 220px;
		background: #161822;
		border-right: 1px solid #2a2d3a;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.sidebar .logo {
		font-size: 1.1rem;
		font-weight: 700;
		color: #a5b4fc;
		margin-bottom: 1.5rem;
		letter-spacing: -0.02em;
	}

	.sidebar a {
		display: block;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		color: #c9cdd5;
		font-size: 0.9rem;
	}
	.sidebar a:hover {
		background: #1e2030;
		color: #fff;
	}

	.sidebar-spacer {
		flex: 1;
	}

	.user-info {
		border-top: 1px solid #2a2d3a;
		padding-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #8b8fa3;
	}

	.user-info button {
		background: none;
		border: 1px solid #2a2d3a;
		color: #8b8fa3;
		padding: 0.35rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.user-info button:hover {
		background: #1e2030;
		color: #e1e4e8;
	}

	.content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}
</style>
