<script lang="ts">
	let { data } = $props();
	let content = $state(data.memo.content || '');
	let saving = $state(false);
	let lastSaved = $state<Date | null>(null);

	let saveTimeout: ReturnType<typeof setTimeout>;

	function onInput(e: Event) {
		const target = e.target as HTMLDivElement;
		content = target.innerHTML;

		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(save, 1000);
	}

	async function save() {
		saving = true;
		await fetch(`/api/projects/${data.projectId}/memos/${data.memo.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content })
		});
		saving = false;
		lastSaved = new Date();
	}
</script>

<div class="memo-editor">
	<div class="memo-header">
		<a href="/projects/{data.projectId}/memos" class="back">&larr; Memos</a>
		<h1>{data.memo.label}</h1>
		<div class="save-status">
			{#if saving}
				Saving...
			{:else if lastSaved}
				Saved {lastSaved.toLocaleTimeString()}
			{/if}
		</div>
	</div>

	<div class="editor-container">
		<div class="editor-main">
			<div
				class="rich-editor"
				contenteditable="true"
				oninput={onInput}
			>{@html content}</div>
		</div>

		<div class="links-panel">
			<h3>Linked elements</h3>
			{#if data.memo.links.length === 0}
				<p class="empty">No linked elements</p>
			{:else}
				{#each data.memo.links as link}
					<div class="link-item">
						<span class="link-kind">{link.target_kind}</span>
						<span>{link.target_label}</span>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.memo-editor { display: flex; flex-direction: column; height: calc(100vh - 6rem); }

	.memo-header { margin-bottom: 1rem; }
	.back { font-size: 0.8rem; color: #6b7280; display: inline-block; margin-bottom: 0.5rem; }
	h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
	.save-status { font-size: 0.75rem; color: #6b7280; }

	.editor-container { display: flex; gap: 1rem; flex: 1; min-height: 0; }

	.editor-main {
		flex: 1;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		overflow-y: auto;
	}

	.rich-editor {
		padding: 1.5rem;
		min-height: 100%;
		outline: none;
		font-size: 0.9rem;
		line-height: 1.7;
		color: #d1d5db;
	}
	.rich-editor:empty::before {
		content: 'Start writing...';
		color: #4b5563;
	}

	.links-panel {
		width: 240px;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1rem;
		overflow-y: auto;
	}
	.links-panel h3 { font-size: 0.85rem; color: #8b8fa3; margin-bottom: 0.75rem; }
	.empty { font-size: 0.8rem; color: #6b7280; }

	.link-item {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.35rem 0; font-size: 0.85rem;
	}
	.link-kind {
		font-size: 0.7rem; color: #6b7280; text-transform: uppercase;
		background: #1e2030; padding: 0.1rem 0.35rem; border-radius: 3px;
	}
</style>
