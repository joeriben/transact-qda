// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Live-Activity-Tracker für laufende Coding-Runs.
//
// Unverändert aus einem älteren Pipeline-Tracker übernommen — der
// Mechanismus ist rein generisch (kein Bezug auf Pipeline-Phasen) und
// deshalb ohne Anpassung portierbar.
//
// Beantwortet die Frage „was tut der Server gerade konkret?" für einen
// laufenden Run, ohne dass die Callsites das durchreichen müssen. Über
// AsyncLocalStorage propagiert ein Run-Context entlang der await-Kette:
//
//   1) Run-ID → Status-Endpoint kann die Activity dieses Runs lesen.
//   2) Cancel-Signal → `chat()` liest es aus dem Context und reicht es an
//      die SDK durch (via AbortSignal.any). User-Cancel wird mid-fetch
//      wirksam, nicht erst zwischen Atomen.
//
// In-Memory, kein Schema. Activity ist Live-State, nicht Historie — nach
// Process-Restart ist eh kein Run mehr aktiv (Resume legt einen neuen
// Loop an, der Status kommt aus coding_runs).

import { AsyncLocalStorage } from 'node:async_hooks';

export type Activity =
	| {
			kind: 'llm-call';
			provider: string;
			model: string;
			stepLabel: string;
			startedAt: number;
	  }
	| {
			kind: 'processing';
			stepLabel: string;
			startedAt: number;
	  };

interface RunContext {
	runId: string;
	// Mutable — wird vom Orchestrator bei jedem Step-Start gesetzt. `chat()`
	// liest beim LLM-Call-Start daraus, damit die Activity das aktuelle
	// Step-Label trägt, ohne dass alle chat()-Callsites es durchreichen müssen.
	currentStepLabel: string;
	// Per-Run-AbortSignal. Wird vom Caller (coding-run/+server.ts) erzeugt
	// und vom Cancel-Watcher dort abgebrochen, wenn `cancel_requested=true`
	// in der DB auftaucht. `chat()` liest das Signal aus dem Context und
	// reicht es an die SDK / fetch durch — damit ein hängender LLM-Call
	// mittendrin abreißbar wird (vorher nur zwischen Atomen prüfbar).
	signal: AbortSignal;
}

const ctxStore = new AsyncLocalStorage<RunContext>();
const activityByRun = new Map<string, Activity>();

/**
 * Öffnet einen Run-Context, in dem alle await-Ketten (inklusive `chat()`)
 * den runId UND das Cancel-Signal lesen können. Wrap-Aufrufer
 * (coding-run/+server.ts) ruft das einmal um den Loop-Aufruf und übergibt
 * das per-Run-AbortSignal seines Watchers.
 */
export function withRun<T>(runId: string, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
	const ctx: RunContext = { runId, currentStepLabel: '', signal };
	return ctxStore.run(ctx, fn);
}

/**
 * Wird von `chat()` gelesen, um das Cancel-Signal des umgebenden Runs an die
 * SDK / fetch durchzureichen. Außerhalb eines Run-Contexts (z.B. Connection-
 * Test) gibt's keins — dann hat `chat()` nur das Default-Timeout.
 */
export function getRunAbortSignal(): AbortSignal | undefined {
	return ctxStore.getStore()?.signal;
}

/**
 * Wird vom Orchestrator bei jedem Step-Start aufgerufen (durch `updateProgress`).
 * Setzt das Step-Label im ALS-Context UND aktualisiert die sichtbare Activity
 * auf `processing` mit diesem Label — bis der nächste `startLlmCall` greift.
 */
export function setStepLabel(label: string): void {
	const ctx = ctxStore.getStore();
	if (!ctx) return;
	ctx.currentStepLabel = label;
	activityByRun.set(ctx.runId, {
		kind: 'processing',
		stepLabel: label,
		startedAt: Date.now()
	});
}

/**
 * Wird von `chat()` vor jedem API-Call aufgerufen. Setzt die Activity auf
 * `llm-call` mit provider/model und dem aktuellen Step-Label aus dem Context.
 */
export function startLlmCall(provider: string, model: string): void {
	const ctx = ctxStore.getStore();
	if (!ctx) return;
	activityByRun.set(ctx.runId, {
		kind: 'llm-call',
		provider,
		model,
		stepLabel: ctx.currentStepLabel,
		startedAt: Date.now()
	});
}

/**
 * Wird von `chat()` im `finally`-Block aufgerufen. Setzt die Activity zurück
 * auf `processing` — d.h. der „zwischen LLM-Calls"-Zustand mit dem aktuellen
 * Step-Label (DB-Write, Parse, Setup für den nächsten Call).
 */
export function endLlmCall(): void {
	const ctx = ctxStore.getStore();
	if (!ctx) return;
	activityByRun.set(ctx.runId, {
		kind: 'processing',
		stepLabel: ctx.currentStepLabel,
		startedAt: Date.now()
	});
}

/**
 * Wird vom Run-Caller im `finally`-Block aufgerufen, damit die Map nicht
 * unbegrenzt wächst.
 */
export function endRun(runId: string): void {
	activityByRun.delete(runId);
}

/**
 * Status-Endpoint liest die aktuelle Activity eines Runs.
 */
export function getActivity(runId: string): Activity | null {
	return activityByRun.get(runId) ?? null;
}
