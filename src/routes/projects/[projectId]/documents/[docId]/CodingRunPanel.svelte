<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
<!--
  CodingRunPanel — UI-Trigger und Live-Stand für den Per-Dokument-Coding-Run.

  Bewusst klein: ein Streifen über dem Namings-Panel, der zwei Zustände kennt:
    (a) idle / kein aktiver Run → eine kompakte Zeile mit Start-Button. GET-
        Polling zeigt vorigen Status (failed-Meldung / „Resume möglich").
    (b) aktiver Run → ausgeklappt mit Schritt-Label, Sequenz-Fortschritt-Bar,
        kumulative Tokens, alive-Pulse und Pause/Cancel-Buttons.

  Eine fixe Coding-Strategie (H1↔H2-Konfrontation), kein User-wählbarer Modus,
  kein Sequenz-Cap. Der Run läuft über das ganze Dokument; Begrenzung erfolgt
  über Pause/Cancel.

  Switchbar, nicht automatisch (Header-Setzung des Subsystems). Der Cancel-
  Watcher serverseitig macht die mid-Call-Abwicklung; die UI ruft nur DELETE
  ?mode=pause|cancel und bekommt Pause/Cancel als SSE-Event zurück.

  Kein Auto-Reload nach completed — die Document-Page lädt Codes/Annotations
  per loader, die UI-Refresh ist vom Page-Reload abhängig. Wir feuern nach
  completed einen `oncompleted`-Callback, dem die Page die Reload-Logik
  anhängen kann.

  Styling folgt der Dark-Theme-Sprache der Document-Page (kein CSS-Variablen-
  Fallback, weil das Projekt keine globalen Theme-Tokens definiert — Farben
  sind im app-weiten Layout hartcodiert: #161822/#1e2030/#2a2d3a/#8b9cf7).
-->
<script lang="ts">
	type CodingRunEvent =
		| { type: 'run-init'; runId: string }
		| { type: 'segmented'; total: number; method: 'cohesion' | 'char-window' }
		| { type: 'sequence-start'; index: number; total: number; seq: number }
		| {
				type: 'sequence-done';
				index: number;
				total: number;
				seq: number;
				codesCommitted: number;
				tokens: number;
				cumulativeTokens: number;
		  }
		| { type: 'paused'; runId: string }
		| { type: 'cancelled'; runId: string }
		| { type: 'completed'; result: unknown }
		| { type: 'failed'; message: string }
		| { type: 'alive'; at: string };

	type RunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

	interface LatestRun {
		id: string;
		status: RunStatus;
		current_index: number;
		total_sequences: number | null;
		last_step_label: string | null;
		error_message: string | null;
		accumulated_input_tokens: number;
		accumulated_output_tokens: number;
		accumulated_cache_read_tokens: number;
		codes_committed: number;
		started_at: string;
		last_event_at: string;
	}

	interface Activity {
		kind: 'llm-call' | 'processing';
		stepLabel: string;
		startedAt: number;
		provider?: string;
		model?: string;
	}

	let {
		projectId,
		docId,
		distinctNamings = 0,
		oncompleted,
		onsequencedone
	}: {
		projectId: string;
		docId: string;
		/** Anzahl der DISTINKTEN Namings im Dokument — wird vom Parent aus den
		 * geladenen Annotations berechnet, über die ganze Dokumentgeschichte.
		 * Unterscheidet sich von codes_committed: das zählt die Verankerungen
		 * DIESES Laufs; ein Naming kann mehrfach verankert sein. */
		distinctNamings?: number;
		oncompleted?: () => void;
		/** Wird nach jedem committed-Sequence-Event aufgerufen, wenn Codes neu hinzugefügt
		 * wurden — die Parent-Page kann darauf die Code-Liste invalidieren. */
		onsequencedone?: (info: { newCodes: number; totalCodes: number }) => void;
	} = $props();

	// ── Live state ────────────────────────────────────────────────────────
	let latest = $state<LatestRun | null>(null);
	let activity = $state<Activity | null>(null);
	let streaming = $state(false);
	let lastAliveAt = $state<string | null>(null);
	let progress = $state<{
		index: number;
		total: number;
		stepLabel: string;
		codesCommitted: number;
		cumulativeTokens: number;
		errorMessage: string | null;
	}>({
		index: 0,
		total: 0,
		stepLabel: '',
		codesCommitted: 0,
		cumulativeTokens: 0,
		errorMessage: null
	});

	// Reader-Handle, damit Cancel/Pause den Stream sauber schließen können.
	let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let pollingHandle: ReturnType<typeof setInterval> | null = null;

	// ── Polling: zeigt pausierte/fehlgeschlagene Runs auch ohne Stream ───
	async function pollStatus() {
		try {
			const res = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-run`, {
				credentials: 'same-origin'
			});
			if (!res.ok) return;
			const body = (await res.json()) as { run: LatestRun | null; activity: Activity | null };
			latest = body.run;
			activity = body.activity;
		} catch {
			/* transient — nächster Tick versucht es erneut */
		}
	}

	function startPolling() {
		if (pollingHandle) return;
		pollStatus(); // sofort
		pollingHandle = setInterval(pollStatus, 5_000);
	}
	function stopPolling() {
		if (pollingHandle) clearInterval(pollingHandle);
		pollingHandle = null;
	}

	$effect(() => {
		// Auf docId-Wechsel (Page-Nav) Status sofort frisch lesen.
		void projectId;
		void docId;
		startPolling();
		return () => stopPolling();
	});

	// ── Start / Resume ────────────────────────────────────────────────────
	async function startRun() {
		streaming = true;
		// Bei Resume die schon-committeten Codes/Tokens aus dem persistierten
		// Run-State übernehmen — sonst zählt der Stream wieder bei 0 los und
		// die Anzeige springt ein für den Bruchteil einer Sekunde zurück, bis
		// das erste sequence-done-Event eintrifft.
		const seedCodes = Number(latest?.codes_committed ?? 0);
		const seedTokens =
			Number(latest?.accumulated_input_tokens ?? 0) +
			Number(latest?.accumulated_output_tokens ?? 0) +
			Number(latest?.accumulated_cache_read_tokens ?? 0);
		progress = {
			index: latest?.current_index ?? 0,
			total: latest?.total_sequences ?? 0,
			stepLabel: 'Starte…',
			codesCommitted: seedCodes,
			cumulativeTokens: seedTokens,
			errorMessage: null
		};

		let response: Response;
		try {
			response = await fetch(`/api/projects/${projectId}/documents/${docId}/coding-run`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
				credentials: 'same-origin'
			});
		} catch (e) {
			progress.errorMessage = e instanceof Error ? e.message : String(e);
			streaming = false;
			return;
		}

		if (!response.ok || !response.body) {
			let msg = `HTTP ${response.status}`;
			try {
				const j = await response.json();
				if (j?.message) msg = j.message;
			} catch {
				/* keine JSON-Antwort */
			}
			progress.errorMessage = msg;
			streaming = false;
			return;
		}

		await consumeSse(response.body);
		streaming = false;
		// Frischer Stand nach Stream-Ende.
		void pollStatus();
	}

	async function consumeSse(stream: ReadableStream<Uint8Array>) {
		const reader = stream.getReader();
		activeReader = reader;
		const decoder = new TextDecoder();
		let buffer = '';
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				// SSE-Records sind durch \n\n getrennt.
				let idx: number;
				while ((idx = buffer.indexOf('\n\n')) !== -1) {
					const raw = buffer.slice(0, idx);
					buffer = buffer.slice(idx + 2);
					const line = raw.split('\n').find((l) => l.startsWith('data: '));
					if (!line) continue;
					try {
						const evt = JSON.parse(line.slice(6)) as CodingRunEvent;
						handleEvent(evt);
					} catch {
						/* Stream-Drift, skip */
					}
				}
			}
		} catch (e) {
			// AbortError beim Pause/Cancel → kein UI-Fehler, der Watcher hat
			// schon ein paused/cancelled-Event geschickt.
			if (e instanceof Error && e.name !== 'AbortError') {
				progress.errorMessage = e.message;
			}
		} finally {
			activeReader = null;
		}
	}

	function handleEvent(e: CodingRunEvent) {
		switch (e.type) {
			case 'run-init':
				progress.stepLabel = 'Initialisiert';
				break;
			case 'segmented':
				progress.total = e.total;
				progress.stepLabel = `${e.total} Sequenzen segmentiert (${e.method})`;
				break;
			case 'sequence-start':
				progress.index = Math.max(progress.index, e.index - 1);
				progress.total = e.total;
				progress.stepLabel = `Sequenz ${e.index}/${e.total} startet (seq ${e.seq})`;
				break;
			case 'sequence-done':
				progress.index = e.index;
				progress.total = e.total;
				progress.codesCommitted += e.codesCommitted;
				progress.cumulativeTokens = e.cumulativeTokens;
				progress.stepLabel = e.codesCommitted > 0
					? `Sequenz ${e.index}/${e.total} fertig (+${e.codesCommitted} Verankerungen)`
					: `Sequenz ${e.index}/${e.total} fertig`;
				if (e.codesCommitted > 0 && onsequencedone) {
					onsequencedone({ newCodes: e.codesCommitted, totalCodes: progress.codesCommitted });
				}
				break;
			case 'alive':
				lastAliveAt = e.at;
				break;
			case 'paused':
				progress.stepLabel = 'Pausiert — Resume jederzeit möglich';
				break;
			case 'cancelled':
				progress.stepLabel = 'Abgebrochen';
				break;
			case 'completed':
				progress.stepLabel = `Lauf abgeschlossen — ${progress.codesCommitted} Verankerungen`;
				if (oncompleted) oncompleted();
				break;
			case 'failed':
				progress.errorMessage = e.message;
				progress.stepLabel = `Fehler: ${e.message}`;
				break;
		}
	}

	// ── Pause / Cancel ────────────────────────────────────────────────────
	async function requestPause() {
		await fetch(`/api/projects/${projectId}/documents/${docId}/coding-run?mode=pause`, {
			method: 'DELETE',
			credentials: 'same-origin'
		}).catch(() => {});
		// Der Cancel-Watcher serverseitig schickt das 'paused'-SSE-Event;
		// hier nichts weiter zu tun.
	}
	async function requestCancel() {
		const ok = confirm('Lauf endgültig abbrechen? Bereits geschriebene Namings bleiben erhalten.');
		if (!ok) return;
		await fetch(`/api/projects/${projectId}/documents/${docId}/coding-run?mode=cancel`, {
			method: 'DELETE',
			credentials: 'same-origin'
		}).catch(() => {});
	}

	// ── Derived ───────────────────────────────────────────────────────────
	const isActive = $derived(latest && (latest.status === 'running' || latest.status === 'paused'));
	const isExpanded = $derived(streaming || isActive);
	const canStart = $derived(!streaming && (!latest || latest.status !== 'running'));
	const showResume = $derived(!streaming && latest?.status === 'paused');
	const tokensTotal = $derived(
		latest
			? Number(latest.accumulated_input_tokens) +
			  Number(latest.accumulated_output_tokens) +
			  Number(latest.accumulated_cache_read_tokens)
			: 0
	);
	const displayTokens = $derived(progress.cumulativeTokens || tokensTotal);
	const displayIndex = $derived(progress.total > 0 ? progress.index : latest?.current_index ?? 0);
	const displayTotal = $derived(progress.total > 0 ? progress.total : latest?.total_sequences ?? 0);
	const displayLabel = $derived(progress.stepLabel || latest?.last_step_label || '');
	// codesCommitted: progress hat den Stream-Live-Zähler; nach Reload / Pause
	// ist progress=0 — dann fällt das UI auf den persistierten run.codes_committed
	// zurück (siehe Migration 028).
	const displayCodes = $derived(
		progress.codesCommitted > 0 ? progress.codesCommitted : Number(latest?.codes_committed ?? 0)
	);
	const aliveRecent = $derived.by(() => {
		if (!lastAliveAt) return false;
		return Date.now() - new Date(lastAliveAt).getTime() < 20_000;
	});
	const progressPct = $derived(displayTotal > 0 ? (displayIndex / displayTotal) * 100 : 0);

	function formatNum(n: number): string {
		if (n < 1000) return String(n);
		if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
		return `${(n / 1_000_000).toFixed(2)}M`;
	}
</script>

<section class="coding-run-panel" class:expanded={isExpanded}>
	<div class="crp-row">
		<div class="crp-title-line">
			<span class="crp-title">KI-Lauf</span>
			{#if latest}
				<span class="crp-status crp-status-{latest.status}">{latest.status}</span>
			{/if}
			{#if isExpanded && aliveRecent}
				<span class="crp-alive" title={lastAliveAt ?? ''}>● live</span>
			{/if}
		</div>

		{#if !isExpanded}
			<button
				class="btn-start"
				onclick={startRun}
				type="button"
				disabled={!canStart}
				title="Lauf für dieses Dokument starten"
			>{showResume ? 'Resume' : 'Start'}</button>
		{/if}
	</div>

	{#if isExpanded}
		<div class="crp-progress">
			<div class="crp-step">{displayLabel || '…'}</div>
			<div class="crp-bar"><div class="crp-bar-fill" style="width: {progressPct}%"></div></div>
			<div class="crp-meta">
				<span class="crp-meta-counter">{displayIndex}/{displayTotal || '?'}</span>
				<span class="crp-meta-sep">·</span>
				<span title="Distinkte Namings im Dokument · Verankerungen in diesem Lauf">{distinctNamings} Namings · {displayCodes} Verankerungen</span>
				<span class="crp-meta-sep">·</span>
				<span>{formatNum(displayTokens)} Tokens</span>
				{#if activity?.kind === 'llm-call' && activity.provider}
					<span class="crp-meta-sep">·</span>
					<span class="crp-model">{activity.provider}/{activity.model}</span>
				{/if}
			</div>
			{#if progress.errorMessage}
				<div class="crp-error">{progress.errorMessage}</div>
			{:else if latest?.error_message}
				<div class="crp-error">{latest.error_message}</div>
			{/if}
			<div class="crp-actions">
				{#if streaming || latest?.status === 'running'}
					<button class="btn-pause" onclick={requestPause} type="button">Pause</button>
					<button class="btn-cancel" onclick={requestCancel} type="button">Cancel</button>
				{:else if showResume}
					<button class="btn-resume" onclick={startRun} type="button">Resume</button>
					<button class="btn-cancel" onclick={requestCancel} type="button">Cancel</button>
				{/if}
			</div>
		</div>
	{:else if progress.errorMessage}
		<div class="crp-error">{progress.errorMessage}</div>
	{:else if latest?.status === 'failed' && latest.error_message}
		<div class="crp-hint crp-hint-error">letzter Run fehlgeschlagen: {latest.error_message}</div>
	{:else if latest?.status === 'completed'}
		<div class="crp-hint">letzter Run abgeschlossen ({latest.current_index} Sequenzen)</div>
	{:else if latest?.status === 'cancelled'}
		<div class="crp-hint">letzter Run abgebrochen</div>
	{/if}
</section>

<style>
	/* Dark-Theme-Sprache der Document-Page direkt übernommen (keine globalen
	   CSS-Variablen im Projekt; Farben hartcodiert wie in +layout.svelte und
	   den Schwesterpanels namings-panel/passages-panel). */
	.coding-run-panel {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		font-size: 0.78rem;
		color: #c9cdd5;
		flex-shrink: 0;
	}
	.coding-run-panel.expanded {
		padding: 0.45rem 0.6rem 0.55rem;
	}

	.crp-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 1.6rem;
	}
	.crp-title-line {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
	}
	.crp-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: #8b8fa3;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* Status-Pill, dark-theme-Töne — keine hellen Bootstrap-Farben mehr. */
	.crp-status {
		padding: 1px 7px;
		border-radius: 8px;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		line-height: 1.4;
	}
	.crp-status-running   { background: rgba(74, 222, 128, 0.15);  color: #4ade80; }
	.crp-status-paused    { background: rgba(245, 158, 11, 0.15);  color: #f59e0b; }
	.crp-status-completed { background: rgba(139, 156, 247, 0.15); color: #a5b4fc; }
	.crp-status-failed    { background: rgba(252, 165, 165, 0.15); color: #fca5a5; }
	.crp-status-cancelled { background: rgba(107, 114, 128, 0.18); color: #9ca3af; }

	.crp-alive {
		font-size: 0.62rem;
		color: #4ade80;
		letter-spacing: 0.03em;
		animation: crp-alive-pulse 1.6s ease-in-out infinite;
	}
	@keyframes crp-alive-pulse {
		0%, 100% { opacity: 0.55; }
		50%      { opacity: 1; }
	}

	/* Buttons — folgen der Sprache der Panel-Buttons im Sidebar (transparent
	   mit Border + Accent-Color, hover-fill). */
	.btn-start, .btn-resume, .btn-pause, .btn-cancel {
		background: none;
		border: 1px solid #2a2d3a;
		border-radius: 4px;
		padding: 0.22rem 0.7rem;
		font-size: 0.72rem;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
		line-height: 1.3;
		transition: background 0.15s, border-color 0.15s, color 0.15s;
	}
	.btn-start, .btn-resume {
		color: #8b9cf7;
	}
	.btn-start:hover:not(:disabled), .btn-resume:hover {
		background: rgba(139, 156, 247, 0.12);
		border-color: #8b9cf7;
		color: #a5b4fc;
	}
	.btn-start:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.btn-pause {
		color: #f59e0b;
	}
	.btn-pause:hover {
		background: rgba(245, 158, 11, 0.12);
		border-color: #f59e0b;
	}
	.btn-cancel {
		color: #fca5a5;
	}
	.btn-cancel:hover {
		background: rgba(252, 165, 165, 0.12);
		border-color: #fca5a5;
	}

	/* Progress-Block (running/paused) */
	.crp-progress {
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.crp-step {
		font-size: 0.72rem;
		color: #c9cdd5;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crp-bar {
		height: 4px;
		background: #1e2030;
		border-radius: 2px;
		overflow: hidden;
	}
	.crp-bar-fill {
		height: 100%;
		background: linear-gradient(90deg, #8b9cf7, #a5b4fc);
		transition: width 250ms ease-out;
	}
	.crp-meta {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.7rem;
		color: #6b7280;
		flex-wrap: wrap;
	}
	.crp-meta-counter {
		font-variant-numeric: tabular-nums;
		color: #c9cdd5;
		font-weight: 500;
	}
	.crp-meta-sep { color: #4b5563; }
	.crp-model {
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.65rem;
		color: #8b9cf7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.crp-actions {
		display: flex;
		gap: 0.35rem;
		justify-content: flex-end;
		margin-top: 0.15rem;
	}

	/* Error- und Hint-Zeilen — dezent, passt zu den anderen panel-internen
	   Statusmeldungen. */
	.crp-error {
		font-size: 0.7rem;
		color: #fca5a5;
		background: rgba(252, 165, 165, 0.08);
		border: 1px solid rgba(252, 165, 165, 0.25);
		border-radius: 4px;
		padding: 0.3rem 0.45rem;
		line-height: 1.35;
	}
	.crp-hint {
		font-size: 0.68rem;
		color: #6b7280;
		margin-top: 0.3rem;
		line-height: 1.3;
	}
	.crp-hint-error {
		color: #fca5a5;
		opacity: 0.85;
	}
</style>
