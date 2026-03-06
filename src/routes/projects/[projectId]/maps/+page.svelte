<script lang="ts">
	let { data } = $props();
	let showCreate = $state(false);
	let newLabel = $state('');
	let newType = $state<string>('situational');
	let creating = $state(false);

	const mapTypeLabels: Record<string, string> = {
		'situational': 'Situational Map',
		'social-worlds': 'Social Worlds / Arenas Map',
		'positional': 'Positional Map',
		'network': 'Network Map'
	};

	async function createMap() {
		if (!newLabel.trim()) return;
		creating = true;
		const res = await fetch(`/api/projects/${data.projectId}/maps`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: newLabel.trim(), mapType: newType })
		});
		if (res.ok) {
			const map = await res.json();
			window.location.href = `/projects/${data.projectId}/maps/${map.id}`;
		}
		creating = false;
	}
</script>

<div class="maps-page">
	<div class="header">
		<h1>Maps</h1>
		<button class="btn-primary" onclick={() => showCreate = !showCreate}>
			{showCreate ? 'Cancel' : 'New map'}
		</button>
	</div>

	{#if showCreate}
		<form class="create-form" onsubmit={e => { e.preventDefault(); createMap(); }}>
			<input type="text" placeholder="Map name" bind:value={newLabel} required />
			<select bind:value={newType}>
				<option value="situational">Situational Map</option>
				<option value="social-worlds">Social Worlds / Arenas</option>
				<option value="positional">Positional Map</option>
				<option value="network">Network Map</option>
			</select>
			<button type="submit" class="btn-primary" disabled={creating}>Create</button>
		</form>
	{/if}

	{#if data.maps.length === 0}
		<p class="empty">No maps yet. Create one to start your situational analysis.</p>
	{:else}
		<div class="map-grid">
			{#each data.maps as map}
				<a href="/projects/{data.projectId}/maps/{map.id}" class="map-card">
					<div class="map-type">{mapTypeLabels[map.properties?.mapType] || map.properties?.mapType}</div>
					<h3>{map.label}</h3>
					<span class="meta">{new Date(map.created_at).toLocaleDateString()}</span>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.maps-page { max-width: 900px; }
	.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
	h1 { font-size: 1.3rem; }

	.btn-primary {
		background: #8b9cf7; color: #0f1117; border: none; border-radius: 6px;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
	}
	.btn-primary:disabled { opacity: 0.5; }

	.create-form {
		display: flex; gap: 0.75rem; background: #161822; border: 1px solid #2a2d3a;
		border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;
	}
	.create-form input, .create-form select {
		background: #0f1117; border: 1px solid #2a2d3a; border-radius: 6px;
		padding: 0.6rem 0.75rem; color: #e1e4e8; font-size: 0.9rem;
	}
	.create-form input { flex: 1; }
	.create-form input:focus, .create-form select:focus { outline: none; border-color: #8b9cf7; }

	.empty { color: #6b7280; font-size: 0.9rem; }

	.map-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 1rem;
	}

	.map-card {
		background: #161822; border: 1px solid #2a2d3a; border-radius: 8px;
		padding: 1.25rem; display: block; transition: border-color 0.15s;
	}
	.map-card:hover { border-color: #8b9cf7; color: #e1e4e8; }

	.map-type {
		font-size: 0.7rem; color: #8b9cf7; text-transform: uppercase; letter-spacing: 0.05em;
		margin-bottom: 0.35rem;
	}
	.map-card h3 { font-size: 1rem; font-weight: 600; color: #e1e4e8; margin-bottom: 0.5rem; }
	.meta { font-size: 0.75rem; color: #6b7280; }
</style>
