<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<!--
  Concepts — UI-Trigger und Live-Stand für die GTM-Konstantvergleich-Engine (CName).

  Ein projektweiter Lauf: ein gesetztes Konzept (Name + Abgrenzungs-Gloss) wird
  über ≥2 Fall-Dokumente konstant-verglichen und zu einem Satz GEERDETER
  Kontrast-Dimensionen entwickelt; optional als Konzept-Naming + CCS-Kette
  persistiert (Aktant E). Der erste gewählte Fall ist der ANKER (Medoid-Saat +
  Minimize-Pool); die übrigen sind der Maximize-Pool.

  Verbraucht den SSE-Stream von POST /api/projects/[projectId]/comparative-run.
  Dark-Theme-Sprache 1:1 von CodingRunPanel/+layout übernommen (keine globalen
  Theme-Tokens im Projekt; Farben hartcodiert).
-->
<script lang="ts">
	import { page } from '$app/stores';

	const projectId = $derived($page.params.projectId);

	// ── wire types (mirror engine.ts ComparativeResult / ComparativeEvent + route framing) ──
	interface CaseRefDTO {
		name: string;
		docId: string;
	}
	interface AxisDTO {
		axisId: number;
		dimension: string;
		posA: string;
		posB: string;
		witnessCount: number;
	}
	interface ResultDTO {
		concept: string;
		model: string;
		seedStrategy: string;
		silence: string | null;
		verified: Record<string, number>;
		anchor: { case: string; elementId: string; centrality: number | null; querySim: number } | null;
		axes: AxisDTO[];
		acceptedPairings: number;
		conceptId: string | null;
		totalTokens: number;
	}
	type Evt =
		| { kind: 'run-init'; concept: string; cases: string[]; persist: boolean }
		| { kind: 'retrieve'; case: string; candidates: number }
		| { kind: 'verify'; case: string; similarity: number; verdict: string }
		| { kind: 'silence'; missing: string }
		| { kind: 'seed'; case: string; elementId: string; centrality: number | null }
		| { kind: 'pair'; mode: string; counterpartCase: string; dimension: string | null; accepted: boolean }
		| { kind: 'saturate'; axisCount: number; from: number }
		| { kind: 'persist'; conceptId: string }
		| { kind: 'done'; axes: number }
		| { kind: 'completed'; result: ResultDTO }
		| { kind: 'failed'; message: string }
		| { kind: 'alive'; at: string };

	// ── form state ──
	let conceptName = $state('');
	let conceptGloss = $state('');
	let persist = $state(false);
	let availableCases = $state<CaseRefDTO[]>([]);
	let selected = $state<string[]>([]); // docIds in order; [0] = anchor case
	let loadingCases = $state(false);
	let loadError = $state<string | null>(null);

	// ── run state ──
	let running = $state(false);
	let phase = $state('');
	let log = $state<string[]>([]);
	let verifyTally = $state<Record<string, { instance: number; seen: number }>>({});
	let lastAliveAt = $state<string | null>(null);
	let result = $state<ResultDTO | null>(null);
	let silence = $state<string | null>(null);
	let runError = $state<string | null>(null);

	const byId = $derived(new Map(availableCases.map((c) => [c.docId, c])));
	const canStart = $derived(
		!running &&
			conceptName.trim().length > 0 &&
			conceptGloss.trim().length > 0 &&
			selected.length >= 2
	);
	const aliveRecent = $derived.by(() => {
		if (!lastAliveAt) return false;
		return Date.now() - new Date(lastAliveAt).getTime() < 20_000;
	});

	function caseLabel(id: string): string {
		return byId.get(id)?.name ?? id.slice(0, 8);
	}

	async function loadCases() {
		loadingCases = true;
		loadError = null;
		try {
			const res = await fetch(`/api/projects/${projectId}/comparative-run`, {
				credentials: 'same-origin'
			});
			if (!res.ok) {
				loadError = `HTTP ${res.status}`;
				return;
			}
			const body = (await res.json()) as { cases: CaseRefDTO[] };
			availableCases = body.cases ?? [];
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loadingCases = false;
		}
	}

	$effect(() => {
		void projectId;
		loadCases();
	});

	// ── case selection (order matters: index 0 = anchor) ──
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}
	function moveUp(i: number) {
		if (i <= 0) return;
		const next = [...selected];
		[next[i - 1], next[i]] = [next[i], next[i - 1]];
		selected = next;
	}
	function moveDown(i: number) {
		if (i >= selected.length - 1) return;
		const next = [...selected];
		[next[i], next[i + 1]] = [next[i + 1], next[i]];
		selected = next;
	}
	function removeAt(i: number) {
		selected = selected.filter((_, j) => j !== i);
	}

	// ── run ──
	async function start() {
		if (!canStart) return;
		running = true;
		phase = 'Starte…';
		log = [];
		verifyTally = {};
		result = null;
		silence = null;
		runError = null;
		lastAliveAt = null;

		let res: Response;
		try {
			res = await fetch(`/api/projects/${projectId}/comparative-run`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					concept: { name: conceptName.trim(), gloss: conceptGloss.trim() },
					caseDocIds: selected,
					persist
				})
			});
		} catch (e) {
			runError = e instanceof Error ? e.message : String(e);
			running = false;
			return;
		}
		if (!res.ok || !res.body) {
			let msg = `HTTP ${res.status}`;
			try {
				const j = await res.json();
				if (j?.message) msg = j.message;
			} catch {
				/* no JSON body */
			}
			runError = msg;
			running = false;
			return;
		}
		await consume(res.body);
		running = false;
	}

	async function consume(stream: ReadableStream<Uint8Array>) {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let idx: number;
				while ((idx = buffer.indexOf('\n\n')) !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const line = raw.split('\n').find((l) => l.startsWith('data: '));
					if (!line) continue;
					try {
						handle(JSON.parse(line.slice(6)) as Evt);
					} catch {
						/* stream drift, skip */
					}
				}
			}
		} catch (e) {
			if (e instanceof Error && e.name !== 'AbortError') runError = e.message;
		}
	}

	function pushLog(s: string) {
		log = [...log.slice(-80), s];
	}

	function handle(e: Evt) {
		switch (e.kind) {
			case 'run-init':
				phase = `Konzept «${e.concept}» · ${e.cases.length} Fälle`;
				pushLog(`▸ Start: «${e.concept}» über ${e.cases.join(', ')}${e.persist ? ' · persist' : ''}`);
				break;
			case 'retrieve':
				phase = 'Retrieval & Verifikation';
				pushLog(`🔎 ${e.case}: ${e.candidates} Kandidaten abgerufen`);
				break;
			case 'verify': {
				const t = verifyTally[e.case] ?? { instance: 0, seen: 0 };
				verifyTally = {
					...verifyTally,
					[e.case]: {
						instance: t.instance + (e.verdict === 'instance' ? 1 : 0),
						seen: t.seen + 1
					}
				};
				break;
			}
			case 'silence':
				silence = e.missing;
				phase = 'Silence';
				pushLog(`🔇 Silence: «${e.missing}» — keine Instanz gefunden`);
				break;
			case 'seed':
				phase = 'Anker (Medoid)';
				pushLog(
					`⚓ Anker: ${e.case} · ${e.elementId.slice(0, 8)}${e.centrality != null ? ` (Zentralität ${e.centrality})` : ''}`
				);
				break;
			case 'pair':
				phase = 'Konstantvergleich';
				pushLog(`⚖︎ [${e.mode}] vs ${e.counterpartCase}: ${e.accepted ? '✓' : '✗'} ${e.dimension ?? '—'}`);
				break;
			case 'saturate':
				phase = 'Sättigung';
				pushLog(`🧪 Sättigung: ${e.from} → ${e.axisCount} Dimensionen`);
				break;
			case 'persist':
				pushLog(`💾 Persistiert als Konzept-Naming ${e.conceptId.slice(0, 8)}`);
				break;
			case 'done':
				phase = 'Fertig';
				break;
			case 'completed':
				result = e.result;
				phase = 'Fertig';
				break;
			case 'failed':
				runError = e.message;
				phase = 'Fehler';
				break;
			case 'alive':
				lastAliveAt = e.at;
				break;
		}
	}

	function fmt(n: number): string {
		if (n < 1000) return String(n);
		if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
		return `${(n / 1_000_000).toFixed(2)}M`;
	}
</script>

<div class="concepts-page">
	<header class="page-head">
		<h1>Konstantvergleich</h1>
		<p class="lede">
			Ein gesetztes <strong>Konzept</strong> (Cue) wird über mehrere Fall-Dokumente konstant
			verglichen und zu geerdeten <strong>Kontrast-Dimensionen</strong> entwickelt. Der zuerst
			gewählte Fall ist der <em>Anker</em>.
		</p>
	</header>

	<section class="card config">
		<div class="field">
			<label for="concept-name">Konzept</label>
			<input
				id="concept-name"
				type="text"
				bind:value={conceptName}
				placeholder="z. B. Umgang mit KI-Rahmungen"
				disabled={running}
			/>
		</div>
		<div class="field">
			<label for="concept-gloss">Abgrenzung (Gloss)</label>
			<textarea
				id="concept-gloss"
				bind:value={conceptGloss}
				rows="3"
				placeholder="Was zählt als Instanz, was nicht? Treibt Retrieval + Verifikation."
				disabled={running}
			></textarea>
		</div>

		<div class="field">
			<div class="field-label">Fälle (Dokumente)</div>
			{#if loadingCases}
				<div class="muted">Lädt Dokumente…</div>
			{:else if loadError}
				<div class="error-line">Fehler beim Laden: {loadError}</div>
			{:else if availableCases.length === 0}
				<div class="muted">Keine text-tragenden Dokumente — bitte zuerst Dokumente hochladen.</div>
			{:else}
				<div class="case-grid">
					<div class="case-col">
						<div class="case-col-head">Verfügbar</div>
						<div class="case-list">
							{#each availableCases as c (c.docId)}
								<button
									type="button"
									class="case-row"
									class:selected={selected.includes(c.docId)}
									onclick={() => toggle(c.docId)}
									disabled={running}
								>
									<span class="case-check">{selected.includes(c.docId) ? '✓' : '+'}</span>
									<span class="case-name">{c.name}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="case-col">
						<div class="case-col-head">Ausgewählt · Reihenfolge = Vergleichsbasis</div>
						{#if selected.length === 0}
							<div class="muted small">Mindestens 2 Fälle wählen. Der erste ist der Anker.</div>
						{:else}
							<ol class="selected-list">
								{#each selected as id, i (id)}
									<li class="selected-row">
										<span class="ord">{i + 1}</span>
										{#if i === 0}<span class="anchor-badge">Anker</span>{/if}
										<span class="case-name">{caseLabel(id)}</span>
										<span class="row-actions">
											<button type="button" title="nach oben" onclick={() => moveUp(i)} disabled={running || i === 0}>↑</button>
											<button type="button" title="nach unten" onclick={() => moveDown(i)} disabled={running || i === selected.length - 1}>↓</button>
											<button type="button" title="entfernen" onclick={() => removeAt(i)} disabled={running}>✕</button>
										</span>
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<div class="run-row">
			<label class="persist-toggle">
				<input type="checkbox" bind:checked={persist} disabled={running} />
				<span>Als Konzept-Naming speichern (Aktant E)</span>
			</label>
			<button class="btn-start" type="button" onclick={start} disabled={!canStart}>
				{running ? 'Läuft…' : 'Konstantvergleich starten'}
			</button>
		</div>
	</section>

	{#if running || result || runError || log.length > 0}
		<section class="card run">
			<div class="run-head">
				<span class="phase-chip">{phase || '…'}</span>
				{#if running && aliveRecent}<span class="alive">● live</span>{/if}
			</div>

			{#if Object.keys(verifyTally).length > 0 && !result}
				<div class="tally">
					{#each Object.entries(verifyTally) as [c, t] (c)}
						<span class="tally-item">{c}: <strong>{t.instance}</strong>/{t.seen} Instanzen</span>
					{/each}
				</div>
			{/if}

			{#if runError}
				<div class="error-box">{runError}</div>
			{/if}

			{#if result}
				{#if result.silence}
					<div class="silence-box">
						🔇 <strong>Silence</strong>: «{result.silence}» — in diesem Fall keine Instanz des Konzepts
						gefunden. (Muster der Nicht-Präsenz; kein Vergleich durchgeführt.)
					</div>
				{:else}
					<div class="result-meta">
						<strong>{result.axes.length}</strong> Dimensionen ·
						Anker {result.anchor?.case ?? '—'}
						{#if result.anchor?.centrality != null}(Zentralität {result.anchor.centrality}){/if}
						· {result.acceptedPairings} akzeptierte Paarungen · {fmt(result.totalTokens)} Tokens
						{#if result.conceptId}· <span class="saved">💾 gespeichert {result.conceptId.slice(0, 8)}</span>{/if}
					</div>
					<div class="verified-line">
						{#each Object.entries(result.verified) as [c, n] (c)}
							<span class="vchip">{c}: {n}</span>
						{/each}
						<span class="model">{result.model}</span>
					</div>
					<div class="axes">
						{#each result.axes as ax (ax.axisId)}
							<div class="axis-card">
								<div class="axis-name">
									«{ax.dimension}»
									{#if ax.witnessCount > 1}<span class="wc">{ax.witnessCount}×</span>{/if}
								</div>
								<div class="axis-poles">
									<span class="pole">{ax.posA}</span>
									<span class="pole-sep">↔</span>
									<span class="pole">{ax.posB}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}

			{#if log.length > 0}
				<details class="log-details" open={!result}>
					<summary>Verlauf ({log.length})</summary>
					<div class="log">
						{#each log as l, i (i)}<div class="log-line">{l}</div>{/each}
					</div>
				</details>
			{/if}
		</section>
	{/if}
</div>

<style>
	.concepts-page {
		max-width: 920px;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		color: #c9cdd5;
	}
	.page-head h1 {
		font-size: 1.3rem;
		font-weight: 600;
		margin: 0 0 0.3rem;
		color: #e1e4e8;
	}
	.lede {
		font-size: 0.85rem;
		color: #9ca3af;
		line-height: 1.5;
		margin: 0;
		max-width: 70ch;
	}
	.lede strong {
		color: #c9cdd5;
	}

	.card {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 10px;
		padding: 1rem 1.1rem;
	}
	.config {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field > label,
	.field-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #8b8fa3;
	}
	input[type='text'],
	textarea {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	textarea {
		resize: vertical;
		line-height: 1.45;
	}
	input[type='text']:focus,
	textarea:focus {
		outline: none;
		border-color: #8b9cf7;
	}

	.case-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}
	.case-col-head {
		font-size: 0.68rem;
		color: #6b7280;
		margin-bottom: 0.35rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.case-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		max-height: 260px;
		overflow-y: auto;
	}
	.case-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-align: left;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
		color: #c9cdd5;
		font-size: 0.8rem;
		font-family: inherit;
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.case-row:hover:not(:disabled) {
		border-color: #4b5563;
	}
	.case-row.selected {
		border-color: #8b9cf7;
		background: rgba(139, 156, 247, 0.08);
	}
	.case-row:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.case-check {
		flex-shrink: 0;
		width: 1rem;
		text-align: center;
		color: #8b9cf7;
		font-weight: 600;
	}
	.case-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.selected-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.selected-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
		font-size: 0.8rem;
	}
	.ord {
		font-variant-numeric: tabular-nums;
		color: #6b7280;
		font-size: 0.72rem;
		width: 1rem;
		flex-shrink: 0;
	}
	.anchor-badge {
		flex-shrink: 0;
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: #a5b4fc;
		background: rgba(139, 156, 247, 0.15);
		padding: 1px 6px;
		border-radius: 6px;
	}
	.row-actions {
		margin-left: auto;
		display: flex;
		gap: 0.15rem;
		flex-shrink: 0;
	}
	.row-actions button {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		color: #9ca3af;
		width: 1.5rem;
		height: 1.5rem;
		font-size: 0.75rem;
		cursor: pointer;
		font-family: inherit;
		line-height: 1;
	}
	.row-actions button:hover:not(:disabled) {
		border-color: #8b9cf7;
		color: #e1e4e8;
	}
	.row-actions button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.run-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		border-top: 1px solid #2a2d3a;
		padding-top: 0.85rem;
	}
	.persist-toggle {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.8rem;
		color: #9ca3af;
		cursor: pointer;
	}
	.persist-toggle input {
		accent-color: #8b9cf7;
	}
	.btn-start {
		background: rgba(139, 156, 247, 0.12);
		border: 1px solid #8b9cf7;
		border-radius: 6px;
		color: #a5b4fc;
		padding: 0.5rem 1.1rem;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: background 0.15s, color 0.15s;
	}
	.btn-start:hover:not(:disabled) {
		background: rgba(139, 156, 247, 0.22);
		color: #c7d2fe;
	}
	.btn-start:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* ── run / result ── */
	.run {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.run-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.phase-chip {
		font-size: 0.75rem;
		font-weight: 600;
		color: #c9cdd5;
		background: #1e2030;
		border-radius: 6px;
		padding: 0.25rem 0.6rem;
	}
	.alive {
		font-size: 0.65rem;
		color: #4ade80;
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 0.5; }
		50% { opacity: 1; }
	}

	.tally {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.76rem;
		color: #9ca3af;
	}
	.tally-item strong {
		color: #4ade80;
	}

	.result-meta {
		font-size: 0.8rem;
		color: #c9cdd5;
		line-height: 1.5;
	}
	.result-meta strong {
		color: #a5b4fc;
	}
	.saved {
		color: #4ade80;
	}
	.verified-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
	}
	.vchip {
		background: #1e2030;
		border-radius: 6px;
		padding: 0.15rem 0.5rem;
		color: #9ca3af;
	}
	.model {
		margin-left: auto;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.66rem;
		color: #6b7280;
	}

	.axes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.axis-card {
		background: #0f1117;
		border: 1px solid #2a2d3a;
		border-left: 2px solid #8b9cf7;
		border-radius: 6px;
		padding: 0.6rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.axis-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: #e1e4e8;
		line-height: 1.35;
	}
	.wc {
		font-size: 0.62rem;
		color: #a5b4fc;
		background: rgba(139, 156, 247, 0.15);
		padding: 1px 6px;
		border-radius: 6px;
		margin-left: 0.3rem;
		vertical-align: middle;
	}
	.axis-poles {
		display: flex;
		align-items: stretch;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: #9ca3af;
		line-height: 1.4;
	}
	.pole {
		flex: 1;
	}
	.pole-sep {
		color: #8b9cf7;
		flex-shrink: 0;
		align-self: center;
	}

	.silence-box {
		font-size: 0.82rem;
		line-height: 1.5;
		color: #fcd34d;
		background: rgba(252, 211, 77, 0.08);
		border: 1px solid rgba(252, 211, 77, 0.25);
		border-radius: 6px;
		padding: 0.6rem 0.7rem;
	}
	.error-box,
	.error-line {
		font-size: 0.8rem;
		color: #fca5a5;
		background: rgba(252, 165, 165, 0.08);
		border: 1px solid rgba(252, 165, 165, 0.25);
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		line-height: 1.4;
	}

	.muted {
		font-size: 0.8rem;
		color: #6b7280;
	}
	.muted.small {
		font-size: 0.74rem;
	}

	.log-details {
		font-size: 0.74rem;
	}
	.log-details summary {
		cursor: pointer;
		color: #6b7280;
		font-size: 0.72rem;
		user-select: none;
	}
	.log {
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		max-height: 240px;
		overflow-y: auto;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.7rem;
		color: #9ca3af;
		line-height: 1.5;
	}
	.log-line {
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
