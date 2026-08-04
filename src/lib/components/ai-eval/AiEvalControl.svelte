<!-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  AI-Evaluation control — part of the SEPARABLE AI-Evaluation audit layer.

  Records a researcher's verdict (+ rationale/better reading) on ONE AI-produced
  naming, SHOWS the recorded verdict history back at that naming, and offers the
  one explicit act by which a revision enters the material.

  Three planes, deliberately not collapsed into each other:
    · audit  — the verdict is written to ai_naming_evaluations. Never a naming_act.
      A `reject` greys the cue out; that greying is a consequence of the audit
      record, so it disappears with this layer and leaves the material as it was.
    · material — a revision only becomes a naming through a separate click by the
      researcher ("Als eigenes Naming übernehmen"): a HUMAN naming on the same
      passage, authored by them, alongside the AI cue, which stays untouched and
      auditable. Nothing here writes on behalf of the AI.
    · visibility — "Ausblenden" is the fourth, separate switch: it takes the cue
      out of the reader for good and is therefore only offered on an already
      rejected cue. It sets `properties.hidden` on the core row through the core
      endpoint — no deletion, so the act stays ausweisbar and rückholbar.

  The verdict is only an exercise of responsibility if it can be seen afterwards,
  so the history is loaded from the server — it survives collapsing the card and
  reloading the page.

  Removal contract: delete src/lib/components/ai-eval (component + verdicts store)
  and the usage sites in the document reader, each marked with an "ai-eval" comment
  and guarded by `properties.aiPersona`. Nothing in the core depends on this layer;
  it only calls existing core endpoints, never the reverse.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { verdicts, type EvalRow, type Verdict } from './verdicts.svelte.js';

	let {
		projectId,
		docId,
		annotationId,
		subjectNamingId,
		subjectLabel,
		anchor = null,
		hidden = false,
		onadopt = undefined,
		onhide = undefined
	}: {
		projectId: string;
		docId: string;
		/** The passage this cue is anchored in — the row that "Ausblenden" hides. */
		annotationId: string;
		subjectNamingId: string | null;
		subjectLabel: string;
		anchor?: { pos0?: number; pos1?: number; text?: string } | null;
		/** Current visibility of that passage — the switch toggles it back. */
		hidden?: boolean;
		/** Called after a revision was adopted as a human naming, so the reader can refresh. */
		onadopt?: (label: string) => void;
		/** Called after the passage was hidden, so the reader can drop it from the list. */
		onhide?: () => void;
	} = $props();

	let verdict = $state<Verdict | null>(null);
	let open = $state(false);
	let rationale = $state('');
	let betterReading = $state('');
	let saving = $state(false);
	let hiding = $state(false);
	let errorMsg = $state<string | null>(null);

	let adoptingId = $state<string | null>(null);
	/** Lower-cased labels already anchored on THIS passage — an adoption is visible as one of them. */
	let labelsOnPassage = $state<string[]>([]);

	const LABELS: Record<Verdict, string> = {
		accept: 'Übernehmen',
		reject: 'Verwerfen',
		revise: 'Revidieren'
	};

	const history = $derived(verdicts.forSubject(subjectNamingId, anchor));
	const latest = $derived(history.length ? history[history.length - 1] : null);
	const rejected = $derived(latest?.verdict === 'reject');

	/** A revision can only become a naming if the passage has text offsets. */
	const canAdopt = $derived(
		!!anchor && Number.isFinite(anchor.pos0) && Number.isFinite(anchor.pos1)
	);

	function fmt(ts: string): string {
		const d = new Date(ts);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
	}

	function isAdopted(row: EvalRow): boolean {
		const label = (row.betterReading ?? '').trim().toLowerCase();
		return !!label && labelsOnPassage.includes(label);
	}

	/** Which revisions are already in the material — so the state survives a reload. */
	async function loadPassageLabels() {
		if (!canAdopt) return;
		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/annotations`);
			if (!res.ok) return;
			const anns = (await res.json()) as {
				code_label: string;
				properties?: { anchor?: { pos0?: number; pos1?: number } };
			}[];
			labelsOnPassage = anns
				.filter(
					(a) =>
						a.properties?.anchor?.pos0 === anchor!.pos0 &&
						a.properties?.anchor?.pos1 === anchor!.pos1
				)
				.map((a) => (a.code_label ?? '').trim().toLowerCase());
		} catch {
			// Non-fatal: the adopt button stays offered; adopting twice is idempotent.
		}
	}

	onMount(() => {
		verdicts.load(projectId, docId);
		loadPassageLabels();
	});

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
		const sentRationale = rationale.trim() || null;
		const sentBetterReading = verdict === 'revise' ? betterReading.trim() || null : null;
		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/ai-eval`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					subjectNamingId,
					subjectLabel,
					anchor: cleanAnchor,
					verdict,
					rationale: sentRationale,
					betterReading: sentBetterReading
				})
			});
			if (!res.ok) {
				const e = await res.json().catch(() => ({}));
				throw new Error(e?.message || `HTTP ${res.status}`);
			}
			const { id, createdAt } = (await res.json()) as { id: string; createdAt: string };
			// Append-only, exactly like the table: the verdict stays visible.
			verdicts.add({
				id,
				createdAt,
				subjectNamingId,
				subjectLabel,
				anchor: cleanAnchor as EvalRow['anchor'],
				verdict,
				rationale: sentRationale,
				betterReading: sentBetterReading
			});
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

	/**
	 * The researcher's act: the better reading becomes THEIR naming on this
	 * passage. The AI cue is left as it is — the revision stands beside it, both
	 * remain readable. Idempotent: an existing naming is reused, and an identical
	 * passage anchor is deduplicated server-side.
	 */
	async function adopt(row: EvalRow) {
		const label = (row.betterReading ?? '').trim();
		if (!label || adoptingId || !canAdopt) return;
		adoptingId = row.id;
		errorMsg = null;
		try {
			let codeId: string | null = null;
			const created = await fetch(`/api/projects/${projectId}/codes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label, color: '#7fd1b9' })
			});
			if (created.ok) {
				codeId = ((await created.json()) as { id: string }).id;
			} else if (created.status === 409) {
				const list = await fetch(`/api/projects/${projectId}/codes`);
				if (!list.ok) throw new Error(`HTTP ${list.status}`);
				const all = (await list.json()) as { id: string; label: string }[];
				codeId =
					all.find((c) => (c.label ?? '').toLowerCase() === label.toLowerCase())?.id ?? null;
				if (!codeId) throw new Error(`Naming „${label}" existiert, ist aber nicht auffindbar`);
			} else {
				const e = await created.json().catch(() => ({}));
				throw new Error(e?.error || `HTTP ${created.status}`);
			}

			const ann = await fetch(`/api/projects/${projectId}/documents/${docId}/annotations`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					codeId,
					anchorType: 'text',
					anchor: { pos0: anchor!.pos0, pos1: anchor!.pos1, text: anchor!.text ?? '' },
					comment: `Revision von „${row.subjectLabel}"`
				})
			});
			if (!ann.ok) {
				const e = await ann.json().catch(() => ({}));
				throw new Error(e?.error || `HTTP ${ann.status}`);
			}
			labelsOnPassage = [...labelsOnPassage, label.toLowerCase()];
			onadopt?.(label);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			adoptingId = null;
		}
	}

	/**
	 * The fourth switch: take the rejected cue out of the reader. Only reachable
	 * once the cue has been rejected, because it costs its visibility. It is a
	 * flag on the core row, never a delete — the act stays in the data and can be
	 * brought back from the panel footer.
	 */
	async function toggleHidden() {
		if ((!rejected && !hidden) || hiding) return;
		hiding = true;
		errorMsg = null;
		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/annotations`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ annotationId, hidden: !hidden })
			});
			if (!res.ok) {
				const e = await res.json().catch(() => ({}));
				throw new Error(e?.error || `HTTP ${res.status}`);
			}
			onhide?.();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			hiding = false;
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
		<button
			class="ai-eval-btn"
			onclick={toggleHidden}
			disabled={(!rejected && !hidden) || hiding}
			title={hidden
				? 'Holt den Cue in den Reader zurück.'
				: rejected
					? 'Nimmt den verworfenen Cue aus dem Reader — gelöscht wird nichts, der Panel-Fuß holt ihn zurück.'
					: 'Erst verwerfen, dann ausblendbar.'}
		>
			{hiding ? '…' : hidden ? 'Einblenden' : 'Ausblenden'}
		</button>
		{#if latest}
			<span class="ai-eval-saved">✓ {LABELS[latest.verdict]}</span>
		{/if}
	</div>

	{#if open}
		<textarea
			class="ai-eval-memo"
			bind:value={rationale}
			rows="2"
			placeholder="Begründung – warum das Naming trägt oder nicht (das trainierbare Signal)…"
		></textarea>
		{#if verdict === 'revise'}
			<input class="ai-eval-better" bind:value={betterReading} placeholder="Bessere Lesart…" />
		{/if}
		<div class="ai-eval-actions">
			<button class="ai-eval-save" onclick={submit} disabled={saving}>
				{saving ? 'Speichere…' : 'Urteil festhalten'}
			</button>
			<button
				class="ai-eval-cancel"
				onclick={() => {
					open = false;
					verdict = null;
				}}
			>
				Abbrechen
			</button>
		</div>
	{/if}

	{#if !verdicts.loaded}
		<div class="ai-eval-hint">Urteilsverlauf lädt…</div>
	{:else if history.length > 0}
		<ul class="ai-eval-history">
			{#each history as row (row.id)}
				<li class="ai-eval-entry">
					<div class="ai-eval-entry-head">
						<span class="ai-eval-verdict ai-eval-verdict-{row.verdict}">{LABELS[row.verdict]}</span>
						<span class="ai-eval-when">{fmt(row.createdAt)}</span>
					</div>
					{#if row.betterReading}
						<div class="ai-eval-reading">„{row.betterReading}"</div>
					{/if}
					{#if row.rationale}
						<div class="ai-eval-rationale">{row.rationale}</div>
					{/if}
					{#if row.verdict === 'revise' && row.betterReading}
						{#if isAdopted(row)}
							<span class="ai-eval-adopted">✓ als eigenes Naming übernommen</span>
						{:else if canAdopt}
							<button
								class="ai-eval-adopt"
								onclick={() => adopt(row)}
								disabled={adoptingId !== null}
								title="Legt die bessere Lesart als eigenes Naming auf dieser Passage an – neben dem KI-Cue, unter deiner Autorschaft."
							>
								{adoptingId === row.id ? 'Übernehme…' : 'Als eigenes Naming übernehmen'}
							</button>
						{:else}
							<span class="ai-eval-hint">Passage ohne Textanker – nicht übernehmbar.</span>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
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
	.ai-eval-btn:disabled {
		opacity: 0.4;
		cursor: default;
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
	.ai-eval-history {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.ai-eval-entry {
		border-left: 2px solid var(--border-color, #4a4a4a);
		padding: 0.1rem 0 0.1rem 0.45rem;
	}
	.ai-eval-entry-head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.ai-eval-verdict {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.ai-eval-verdict-accept {
		color: #7fd1b9;
	}
	.ai-eval-verdict-reject {
		color: #ff9a8b;
	}
	.ai-eval-verdict-revise {
		color: var(--accent, #8b9cf7);
	}
	.ai-eval-when {
		opacity: 0.5;
		font-size: 0.7rem;
	}
	.ai-eval-reading {
		margin-top: 0.1rem;
	}
	.ai-eval-rationale {
		margin-top: 0.1rem;
		opacity: 0.75;
		font-style: italic;
	}
	.ai-eval-adopt {
		margin-top: 0.25rem;
		background: transparent;
		border: 1px solid var(--border-color, #4a4a4a);
		border-radius: 4px;
		color: inherit;
		padding: 0.12rem 0.45rem;
		cursor: pointer;
		font: inherit;
		font-size: 0.75rem;
	}
	.ai-eval-adopt:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ai-eval-adopted {
		display: inline-block;
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: #7fd1b9;
	}
	.ai-eval-hint {
		margin-top: 0.25rem;
		opacity: 0.55;
		font-size: 0.75rem;
	}
	.ai-eval-error {
		color: #ff6b6b;
		margin-top: 0.3rem;
	}
</style>
