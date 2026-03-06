<script lang="ts">
	let { data } = $props();
	const doc = $derived(data.document);
	const isImage = $derived(doc.mime_type?.startsWith('image/'));

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}
</script>

<div class="doc-viewer">
	<div class="doc-header">
		<a href="/projects/{data.projectId}/documents" class="back">&larr; Documents</a>
		<h1>{doc.label}</h1>
		<span class="meta">{doc.mime_type} &middot; {formatSize(doc.file_size)}</span>
	</div>

	<div class="doc-body">
		<div class="text-panel">
			{#if isImage}
				<p class="placeholder">[Image viewer — Phase 3]</p>
			{:else if doc.full_text}
				<pre class="document-text">{doc.full_text}</pre>
			{:else}
				<p class="placeholder">No text content available</p>
			{/if}
		</div>

		<div class="code-panel">
			<h3>Annotations</h3>
			{#if data.annotations.length === 0}
				<p class="empty">No annotations yet. Select text and apply codes (Phase 3).</p>
			{:else}
				{#each data.annotations as ann}
					<div class="annotation">
						<span class="code-label" style="border-left: 3px solid {ann.code_properties?.color || '#8b9cf7'}">{ann.code_label}</span>
						{#if ann.comment}<p class="comment">{ann.comment}</p>{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.doc-viewer { display: flex; flex-direction: column; height: 100%; }

	.doc-header {
		margin-bottom: 1rem;
	}

	.back {
		font-size: 0.8rem;
		color: #6b7280;
		display: inline-block;
		margin-bottom: 0.5rem;
	}

	h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
	.meta { font-size: 0.8rem; color: #6b7280; }

	.doc-body {
		display: flex;
		gap: 1rem;
		flex: 1;
		min-height: 0;
	}

	.text-panel {
		flex: 1;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem;
		overflow-y: auto;
	}

	.document-text {
		white-space: pre-wrap;
		word-break: break-word;
		font-family: 'Georgia', serif;
		font-size: 0.9rem;
		line-height: 1.7;
		color: #d1d5db;
	}

	.code-panel {
		width: 280px;
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1rem;
		overflow-y: auto;
	}

	.code-panel h3 {
		font-size: 0.85rem;
		color: #8b8fa3;
		margin-bottom: 0.75rem;
	}

	.empty { font-size: 0.8rem; color: #6b7280; }

	.placeholder {
		text-align: center;
		color: #6b7280;
		padding: 3rem 0;
	}

	.annotation {
		margin-bottom: 0.5rem;
	}

	.code-label {
		font-size: 0.85rem;
		padding-left: 0.5rem;
		display: block;
	}

	.comment {
		font-size: 0.8rem;
		color: #6b7280;
		padding-left: 0.5rem;
		margin-top: 0.15rem;
	}
</style>
