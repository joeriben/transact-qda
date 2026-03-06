<script lang="ts">
	let { data } = $props();
	let uploading = $state(false);
	let dragOver = $state(false);

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	async function uploadFiles(files: FileList | File[]) {
		uploading = true;
		for (const file of files) {
			const fd = new FormData();
			fd.append('file', file);
			await fetch(`/api/upload?projectId=${data.projectId}`, { method: 'POST', body: fd });
		}
		uploading = false;
		window.location.reload();
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files);
	}

	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) uploadFiles(input.files);
	}
</script>

<div class="documents-page">
	<div class="header">
		<h1>Documents</h1>
		<label class="btn-primary">
			Upload
			<input type="file" multiple hidden onchange={onFileInput} accept=".pdf,.txt,.md,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp" />
		</label>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="drop-zone"
		class:drag-over={dragOver}
		ondragover={e => { e.preventDefault(); dragOver = true; }}
		ondragleave={() => dragOver = false}
		ondrop={onDrop}
	>
		{#if uploading}
			<p>Uploading...</p>
		{:else if data.documents.length === 0}
			<p>Drop files here or click Upload</p>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Type</th>
						<th>Size</th>
						<th>Added</th>
					</tr>
				</thead>
				<tbody>
					{#each data.documents as doc}
						<tr>
							<td><a href="/projects/{data.projectId}/documents/{doc.id}">{doc.label}</a></td>
							<td class="meta">{doc.mime_type?.split('/')[1] || 'unknown'}</td>
							<td class="meta">{formatSize(doc.file_size)}</td>
							<td class="meta">{new Date(doc.created_at).toLocaleDateString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.documents-page { max-width: 900px; }

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

	.drop-zone {
		border: 2px dashed #2a2d3a;
		border-radius: 8px;
		padding: 1.5rem;
		min-height: 200px;
		transition: border-color 0.15s;
	}
	.drop-zone.drag-over {
		border-color: #8b9cf7;
		background: rgba(139, 156, 247, 0.05);
	}

	.drop-zone p {
		text-align: center;
		color: #6b7280;
		padding: 3rem 0;
	}

	table { width: 100%; border-collapse: collapse; }
	th {
		text-align: left;
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #2a2d3a;
	}
	td {
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid #1e2030;
		font-size: 0.9rem;
	}
	.meta { color: #6b7280; font-size: 0.8rem; }
</style>
