<script lang="ts">
	let { data } = $props();
	let showCreate = $state(false);
	let newLabel = $state('');
	let newColor = $state('#8b9cf7');
	let newDescription = $state('');
	let creating = $state(false);

	type CodeNode = {
		id: string;
		label: string;
		properties: any;
		parent_id: string | null;
		children: CodeNode[];
	};

	const codeTree = $derived(buildTree(data.codes));

	function buildTree(codes: any[]): CodeNode[] {
		const map = new Map<string, CodeNode>();
		const roots: CodeNode[] = [];

		for (const c of codes) {
			map.set(c.id, { ...c, children: [] });
		}

		for (const c of codes) {
			const node = map.get(c.id)!;
			if (c.parent_id && map.has(c.parent_id)) {
				map.get(c.parent_id)!.children.push(node);
			} else {
				roots.push(node);
			}
		}
		return roots;
	}

	async function createCode() {
		if (!newLabel.trim()) return;
		creating = true;
		await fetch(`/api/projects/${data.projectId}/codes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				label: newLabel.trim(),
				color: newColor,
				description: newDescription.trim() || undefined
			})
		});
		creating = false;
		showCreate = false;
		newLabel = '';
		newDescription = '';
		window.location.reload();
	}
</script>

<div class="codes-page">
	<div class="header">
		<h1>Codes</h1>
		<button class="btn-primary" onclick={() => showCreate = !showCreate}>
			{showCreate ? 'Cancel' : 'New code'}
		</button>
	</div>

	{#if showCreate}
		<form class="create-form" onsubmit={e => { e.preventDefault(); createCode(); }}>
			<div class="row">
				<input type="text" placeholder="Code name" bind:value={newLabel} required />
				<input type="color" bind:value={newColor} />
			</div>
			<input type="text" placeholder="Description (optional)" bind:value={newDescription} />
			<button type="submit" class="btn-primary" disabled={creating}>Create</button>
		</form>
	{/if}

	{#if codeTree.length === 0}
		<p class="empty">No codes yet. Create one to start coding your data.</p>
	{:else}
		<div class="code-tree">
			{#each codeTree as node}
				{@render codeNode(node, 0)}
			{/each}
		</div>
	{/if}
</div>

{#snippet codeNode(node: CodeNode, depth: number)}
	<div class="code-item" style="padding-left: {depth * 1.25}rem">
		<span class="color-dot" style="background: {node.properties?.color || '#8b9cf7'}"></span>
		<span class="code-label">{node.label}</span>
		<span class="code-count">{data.annotationCounts[node.id] || 0}</span>
	</div>
	{#each node.children as child}
		{@render codeNode(child, depth + 1)}
	{/each}
{/snippet}

<style>
	.codes-page { max-width: 700px; }

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	h1 { font-size: 1.3rem; }

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

	.row { display: flex; gap: 0.5rem; }

	.create-form input[type="text"] {
		flex: 1;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		color: #e1e4e8;
		font-size: 0.9rem;
	}
	.create-form input:focus { outline: none; border-color: #8b9cf7; }

	.create-form input[type="color"] {
		width: 40px;
		height: 40px;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 2px;
		background: #0f1117;
		cursor: pointer;
	}

	.empty { color: #6b7280; font-size: 0.9rem; }

	.code-tree {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.5rem;
	}

	.code-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 5px;
		cursor: default;
	}
	.code-item:hover { background: #1e2030; }

	.color-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.code-label {
		flex: 1;
		font-size: 0.9rem;
	}

	.code-count {
		font-size: 0.75rem;
		color: #6b7280;
	}
</style>
