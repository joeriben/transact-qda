<!--
SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>KI-Namings zurücksetzen — {data.projectName}</title>
</svelte:head>

<main style="max-width: 600px; margin: 4rem auto; padding: 0 1.5rem; font-family: system-ui;">
	<h1 style="margin-bottom: 0.5rem;">KI-Namings zurücksetzen</h1>
	<p style="color: #666; margin-top: 0;">
		Projekt: <strong>{data.projectName}</strong>
	</p>

	<div style="background: #fff8e1; border: 1px solid #f9a825; border-radius: 6px; padding: 1rem 1.25rem; margin: 1.5rem 0;">
		<strong>Was passiert:</strong>
		<ul style="margin: 0.5rem 0 0 1rem; padding: 0;">
			<li>Alle <em>AI-erzeugten</em> Annotationen (CName + SName) werden soft-gelöscht.</li>
			<li>Namings, die danach keine Verankerung mehr haben, werden soft-gelöscht.</li>
			<li>Die <code>coding_runs</code>-Historie wird hart gelöscht.</li>
			<li>Dokumente, Embeddings und von Hand angelegte Namings bleiben unangetastet.</li>
		</ul>
	</div>

	{#if form?.success}
		<div style="background: #e8f5e9; border: 1px solid #43a047; border-radius: 6px; padding: 1rem 1.25rem;">
			<strong>Fertig.</strong>
			<ul style="margin: 0.5rem 0 0 1rem; padding: 0;">
				<li>Dokumente verarbeitet: {form.documentsProcessed}</li>
				<li>Annotationen gelöscht: {form.annotationsDeleted}</li>
				<li>Namings gelöscht: {form.codesDeleted}</li>
				<li>Runs gelöscht: {form.runsDeleted}</li>
			</ul>
		</div>
	{:else if form?.error}
		<div style="background: #ffebee; border: 1px solid #e53935; border-radius: 6px; padding: 1rem 1.25rem;">
			{form.error}
		</div>
	{:else}
		<form
			method="POST"
			action="?/reset"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<label style="display: block; margin-bottom: 0.5rem;">
				Zur Bestätigung die Projekt-ID eintippen:
				<input
					type="text"
					name="confirm"
					placeholder={data.projectId}
					required
					style="display: block; width: 100%; padding: 0.5rem; font-family: monospace; margin-top: 0.25rem;"
				/>
			</label>
			<button
				type="submit"
				disabled={submitting}
				style="background: #c62828; color: white; border: 0; padding: 0.6rem 1.2rem; border-radius: 4px; cursor: pointer; font-size: 1rem;"
			>
				{submitting ? 'Lösche…' : 'Coding-Daten löschen'}
			</button>
		</form>

		<p style="color: #888; font-size: 0.85rem; margin-top: 2rem;">
			Project-ID zum Reinkopieren: <code style="user-select: all;">{data.projectId}</code>
		</p>
	{/if}
</main>
