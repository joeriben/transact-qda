<!-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  AI-Evaluation control — part of the SEPARABLE AI-Evaluation audit layer.

  Records a researcher's verdict (+ rationale/memo) on ONE AI-produced code.
  This is an audit act over the provisional AI-Naming subsystem, not empirical
  coding — it writes to ai_naming_evaluations via the ai-eval endpoint, never
  to the core naming stack.

  Removal contract: delete src/lib/components/ai-eval + the single usage site in
  the document reader (guarded by `properties.aiPersona`). Nothing in the core
  depends on this component.
-->
<script lang="ts">
	type Verdict = 'accept' | 'reject' | 'revise';

	let {
		projectId,
		docId,
		subjectNamingId,
		subjectLabel,
		anchor = null
	}: {
		projectId: string;
		docId: string;
		subjectNamingId: string | null;
		subjectLabel: string;
		anchor?: { pos0?: number; pos1?: number; text?: string } | null;
	} = $props();

	let verdict = $state<Verdict | null>(null);
	let open = $state(false);
	let rationale = $state('');
	let betterReading = $state('');
	let saving = $state(false);
	let savedVerdict = $state<Verdict | null>(null);
	let errorMsg = $state<string | null>(null);

	const LABELS: Record<Verdict, string> = {
		accept: 'Übernehmen',
		reject: 'Verwerfen',
		revise: 'Revidieren'
	};

	function choose(v: Verdict) {
		verdict = v;
		open = true;
		errorMsg = null;
	}

	async function submit() {
		if (!verdict || saving) return;
		saving = true;
		errorMsg = null;
		const cleanAnchor =
			anchor && Number.isFinite(anchor.pos0) && Number.isFinite(anchor.pos1)
				? { pos0: anchor.pos0, pos1: anchor.pos1, text: anchor.text ?? '' }
				: null;
		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/ai-eval`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					subjectNamingId,
					subjectLabel,
					anchor: cleanAnchor,
					verdict,
					rationale,
					betterReading: verdict === 'revise' ? betterReading : null
				})
			});
			if (!res.ok) {
				const e = await res.json().catch(() => ({}));
				throw new Error(e?.message || `HTTP ${res.status}`);
			}
			savedVerdict = verdict;
			open = false;
			verdict = null;
			rationale = '';
			betterReading = '';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<div class="ai-eval">
	<div class="ai-eval-row">
		<span class="ai-eval-caption">KI-Urteil</span>
		{#each ['accept', 'reject', 'revise'] as const as v}
			<button class="ai-eval-btn" class:active={verdict === v} onclick={() => choose(v)}>
				{LABELS[v]}
			</button>
		{/each}
		{#if savedVerdict}
			<span class="ai-eval-saved">✓ {LABELS[savedVerdict]}</span>
		{/if}
	</div>

	{#if open}
		<textarea
			class="ai-eval-memo"
			bind:value={rationale}
			rows="2"
			placeholder="Begründung – warum der Code trägt oder nicht (das trainierbare Signal)…"
		></textarea>
		{#if verdict === 'revise'}
			<input
				class="ai-eval-better"
				bind:value={betterReading}
				placeholder="Bessere Lesart…"
			/>
		{/if}
		<div class="ai-eval-actions">
			<button class="ai-eval-save" onclick={submit} disabled={saving}>
				{saving ? 'Speichere…' : 'Urteil festhalten'}
			</button>
			<button class="ai-eval-cancel" onclick={() => { open = false; verdict = null; }}>
				Abbrechen
			</button>
		</div>
	{/if}

	{#if errorMsg}
		<div class="ai-eval-error">{errorMsg}</div>
	{/if}
</div>

<style>
	.ai-eval {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--border-color, #3a3a3a);
		font-size: 0.8rem;
	}
	.ai-eval-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.ai-eval-caption {
		opacity: 0.6;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-size: 0.7rem;
	}
	.ai-eval-btn {
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--border-color, #4a4a4a);
		background: transparent;
		color: inherit;
		cursor: pointer;
		font: inherit;
	}
	.ai-eval-btn.active {
		background: var(--accent, #8b9cf7);
		color: #10121a;
		border-color: var(--accent, #8b9cf7);
	}
	.ai-eval-saved {
		margin-left: auto;
		opacity: 0.7;
	}
	.ai-eval-memo,
	.ai-eval-better {
		width: 100%;
		margin-top: 0.35rem;
		box-sizing: border-box;
		background: var(--input-bg, #1a1a1a);
		color: inherit;
		border: 1px solid var(--border-color, #4a4a4a);
		border-radius: 4px;
		padding: 0.3rem;
		font: inherit;
		resize: vertical;
	}
	.ai-eval-actions {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.35rem;
	}
	.ai-eval-save {
		background: var(--accent, #8b9cf7);
		color: #10121a;
		border: none;
		border-radius: 4px;
		padding: 0.2rem 0.6rem;
		cursor: pointer;
		font: inherit;
	}
	.ai-eval-save:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ai-eval-cancel {
		background: transparent;
		border: 1px solid var(--border-color, #4a4a4a);
		border-radius: 4px;
		color: inherit;
		padding: 0.2rem 0.6rem;
		cursor: pointer;
		font: inherit;
	}
	.ai-eval-error {
		color: #ff6b6b;
		margin-top: 0.3rem;
	}
</style>
