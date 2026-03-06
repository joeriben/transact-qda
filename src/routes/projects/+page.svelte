<script lang="ts">
	let { data } = $props();
	let showCreate = $state(false);
	let name = $state('');
	let description = $state('');
	let creating = $state(false);

	async function createProject() {
		if (!name.trim()) return;
		creating = true;
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined })
		});
		if (res.ok) {
			window.location.reload();
		}
		creating = false;
	}
</script>

<div class="projects-page">
	<div class="header">
		<h1>Projects</h1>
		<button class="btn-primary" onclick={() => showCreate = !showCreate}>
			{showCreate ? 'Cancel' : 'New project'}
		</button>
	</div>

	{#if showCreate}
		<form class="create-form" onsubmit={e => { e.preventDefault(); createProject(); }}>
			<input type="text" placeholder="Project name" bind:value={name} required />
			<textarea placeholder="Description (optional)" bind:value={description} rows="2"></textarea>
			<button type="submit" class="btn-primary" disabled={creating}>Create</button>
		</form>
	{/if}

	{#if data.projects.length === 0}
		<p class="empty">No projects yet. Create one to get started.</p>
	{:else}
		<div class="project-grid">
			{#each data.projects as project}
				<a href="/projects/{project.id}" class="project-card">
					<h2>{project.name}</h2>
					{#if project.description}
						<p>{project.description}</p>
					{/if}
					<span class="meta">{project.role}</span>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.projects-page {
		max-width: 900px;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.btn-primary {
		background: #8b9cf7;
		color: #0f1117;
		border: none;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-primary:hover { background: #a5b4fc; }
	.btn-primary:disabled { opacity: 0.5; }

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.create-form input,
	.create-form textarea {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		color: #e1e4e8;
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}
	.create-form input:focus,
	.create-form textarea:focus {
		outline: none;
		border-color: #8b9cf7;
	}

	.empty {
		color: #6b7280;
		font-size: 0.9rem;
	}

	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.project-card {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		display: block;
		transition: border-color 0.15s;
	}
	.project-card:hover {
		border-color: #8b9cf7;
		color: #e1e4e8;
	}

	.project-card h2 {
		font-size: 1.05rem;
		font-weight: 600;
		color: #e1e4e8;
		margin-bottom: 0.4rem;
	}

	.project-card p {
		font-size: 0.85rem;
		color: #8b8fa3;
		margin-bottom: 0.75rem;
	}

	.meta {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
