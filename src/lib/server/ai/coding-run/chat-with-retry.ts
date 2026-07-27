// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Empty-Retry-with-Escalation für die 4 chat()-Calls pro Sequenz.
//
// Warum es das gibt — Befund aus einer internen Teststrecke (2026-05-24,
// deutsche Quelle): MiMo (xiaomi/mimo-v2.5-pro) hat auf
// langen deutschen Sequenzen gelegentlich einen Token-Level-Meltdown — das
// SDK-Response-Objekt kommt sauber zurück, aber der Text ist
// unparseable garbage ("Transaktionale Ontologie ** Metadaten in-T Prozelleichtungen
// The process- itsung mit encodingierenatJungungen-Hierarch**..."). Der
// gehärtete parseJsonArray in index.ts wirft den Garbage korrekt weg →
// leeres Array → die ganze Sequenz verliert ihre H1-Codes oder die H2-
// Konfrontation. Im Lab: v1-DE seg 2/3 lieferten je 0 H1-Codes; mehrere
// Runs auf design-memo-ontology hatten "H2 confront: 0 verdicts" trotz
// vorhandener H1-Codes (H1-Codes überlebten dann unkonfrontiert, was die
// Strauss-Disziplin durchbricht).
//
// Pattern: chat() ist Primitiv — eine SDK-Antwort, drinnen rate-limit-Retry
// und das geteilte AbortSignal-Komponieren. ESKALATION ist eine Schicht
// darüber: primary → wenn leer, retry primary noch einmal → wenn immer
// noch leer, einmal mit dem Fallback-Modell (Sonnet, siehe
// model-tiers.ts:resolveFallback). Drei Attempts maximal, danach gibt der
// Helper die letzte (leere) Antwort durch und der Loop trifft den
// Status-quo: leere Sequenz, weiter zum nächsten.
//
// Was als "leer" zählt — und was NICHT:
//   • prose-Modus (H2 read): text.trim() === '' ist leer.
//   • json-Modus (H1 propose / H2 confront / H1 react): text.trim() === ''
//     ist leer, UND text.trim() === '[]' (mit oder ohne Fences) ist
//     LEGITIM-leer (das Modell sagt "nichts codable", siehe Prompt-Kontrakt
//     "Empty array [] if the passage carries nothing codable.") → kein
//     Retry. Nur das Meltdown-Pattern (Text non-empty, parst aber zu []) →
//     Retry/Escalate.
//
// Abort-Verhalten: AbortError und fatale Provider-Fehler werden NICHT
// retried — sie propagieren nach oben, der Cancel-Watcher und der
// Stuck-Watchdog im Orchestrator greifen wie bisher. Rate-Limit-429 ist
// schon in chat() abgefangen; eine 429 erscheint hier nicht als „leer".
//
// Token-Buchhaltung: alle Attempts summieren sich. Die zurückgegebene
// ChatResponse trägt die SUMME der tokensUsed / inputTokens /
// outputTokens / cacheReadTokens / cacheCreationTokens; text + model +
// provider + stopReason + toolCalls kommen vom finalen winning attempt.
// So bleibt der Orchestrator-Code unverändert für die Buchhaltung.

import { chat, isFatalProviderError, type ChatResponse } from '../client.js';
import type { TierModel } from './model-tiers.js';
import { parseJsonArray } from './index.js';

export type EmptyMode = 'prose' | 'json-array';

/**
 * Ist die Antwort leer/unparseable im Sinne der jeweiligen Modus-Semantik?
 *
 *   • 'prose'      — leer = text.trim().length === 0
 *   • 'json-array' — leer = text.trim() ist nichts ODER der Text ist nicht-
 *                    trivial aber parseJsonArray liefert []. Reines '[]'
 *                    (auch mit ```json …``` umrahmt) ist LEGITIM-leer und
 *                    zählt NICHT als retry-würdig.
 */
export function isResponseEmpty(text: string, mode: EmptyMode): boolean {
	const stripped = (text ?? '').trim();
	if (stripped.length === 0) return true;
	if (mode === 'prose') return false;
	// json-array: strip Markdown-Fences, dann "[]"-Test, dann Parser.
	let inner = stripped;
	const fence = inner.match(/```(?:json)?\n?([\s\S]*?)```/);
	if (fence) inner = fence[1].trim();
	if (inner === '[]') return false; // legitime leere Antwort
	return parseJsonArray(inner).length === 0;
}

export interface ChatWithEmptyRetryOptions {
	/** Same shape as `chat()`'s opts, MINUS modelOverride (wir setzen die Tiers selbst). */
	system?: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	maxTokens?: number;
	cacheSystem?: boolean;
	cacheableSystemPrefix?: string;
	responseFormat?: 'json';
	documentIds?: string[];
	timeoutMs?: number;
	signal?: AbortSignal;

	/** Primary-Modell — der gemessene Default für den Tier. */
	primary: TierModel;
	/** Fallback-Modell — null = Eskalation deaktiviert, gibt nach 2 leeren Versuchen die letzte Antwort durch. */
	fallback: TierModel | null;

	/** Was zählt als leer? json-array für H1-Propose/H2-Confront/H1-React, prose für H2-Read. */
	emptyMode: EmptyMode;

	/** Für Logs: runId + phase-Label (z.B. "seq 3/8 H1 propose"). */
	runId: string;
	phaseLabel: string;
}

export interface ChatWithEmptyRetryResult extends ChatResponse {
	/** 1 / 2 / 3 — wie viele chat()-Calls wurden gefahren. */
	attempts: number;
	/** True wenn der finale (oder letzte) Call das Fallback-Modell traf. */
	escalated: boolean;
	/** True wenn der finale (oder letzte) Call selbst immer noch leer war. */
	finalEmpty: boolean;
}

function sumTokens(into: ChatResponse, add: ChatResponse): void {
	into.inputTokens += add.inputTokens;
	into.outputTokens += add.outputTokens;
	into.cacheCreationTokens += add.cacheCreationTokens;
	into.cacheReadTokens += add.cacheReadTokens;
	into.tokensUsed += add.tokensUsed;
}

/**
 * chat() + Empty-Retry + Escalation. Token-Buchhaltung summiert ALLE
 * Attempts; alle anderen Felder (text/model/provider/stopReason/toolCalls)
 * kommen vom finalen Call. Wirft alles weiter, was chat() wirft (AbortError,
 * fatal provider errors, rate-limit-exhaustion etc.) — Retry-on-empty greift
 * NUR auf erfolgreichen-aber-leeren chat()-Ergebnissen.
 */
export async function chatWithEmptyRetry(
	opts: ChatWithEmptyRetryOptions
): Promise<ChatWithEmptyRetryResult> {
	const baseOpts = {
		system: opts.system,
		messages: opts.messages,
		maxTokens: opts.maxTokens,
		cacheSystem: opts.cacheSystem,
		cacheableSystemPrefix: opts.cacheableSystemPrefix,
		responseFormat: opts.responseFormat,
		documentIds: opts.documentIds,
		timeoutMs: opts.timeoutMs,
		signal: opts.signal
	};

	// 1) Primary attempt.
	let resp = await chat({ ...baseOpts, modelOverride: opts.primary });
	let attempts = 1;
	if (!isResponseEmpty(resp.text, opts.emptyMode)) {
		return { ...resp, attempts, escalated: false, finalEmpty: false };
	}
	console.warn(
		`[coding-run ${opts.runId}] ${opts.phaseLabel}: primary (${opts.primary.provider}/${opts.primary.model}) returned empty — retrying primary once. ` +
			`text.length=${resp.text.length} preview=${JSON.stringify(resp.text.slice(0, 200))}`
	);

	// 2) Retry primary once.
	try {
		const retryResp = await chat({ ...baseOpts, modelOverride: opts.primary });
		attempts = 2;
		// Token-Sum: vorheriger leerer Call zählt mit.
		sumTokens(retryResp, resp);
		resp = retryResp;
		if (!isResponseEmpty(resp.text, opts.emptyMode)) {
			return { ...resp, attempts, escalated: false, finalEmpty: false };
		}
	} catch (err) {
		// Wenn die Retry selbst hart fehlschlägt (nicht "leer", sondern wirft):
		// versuche Eskalation auf Fallback, sonst propagiere.
		if (isFatalProviderError(err) || isAbort(err)) throw err;
		console.warn(
			`[coding-run ${opts.runId}] ${opts.phaseLabel}: primary retry threw (${(err as Error)?.message ?? err}) — falling through to escalation if configured.`
		);
		// Attempts bleibt 1, der retry-Throw zählt nicht als usable Antwort.
	}

	// 3) Escalate to fallback if configured.
	if (!opts.fallback) {
		console.warn(
			`[coding-run ${opts.runId}] ${opts.phaseLabel}: primary leer nach 2 Versuchen, kein fallback konfiguriert — gebe leere Antwort durch.`
		);
		return { ...resp, attempts, escalated: false, finalEmpty: true };
	}
	console.warn(
		`[coding-run ${opts.runId}] ${opts.phaseLabel}: escalating to fallback (${opts.fallback.provider}/${opts.fallback.model}).`
	);
	const escResp = await chat({ ...baseOpts, modelOverride: opts.fallback });
	attempts += 1;
	sumTokens(escResp, resp);
	const finalEmpty = isResponseEmpty(escResp.text, opts.emptyMode);
	if (finalEmpty) {
		console.warn(
			`[coding-run ${opts.runId}] ${opts.phaseLabel}: escalation to ${opts.fallback.provider}/${opts.fallback.model} ALSO empty — giving up. text.length=${escResp.text.length}`
		);
	}
	return { ...escResp, attempts, escalated: true, finalEmpty };
}

function isAbort(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const name = (err as { name?: unknown }).name;
	return name === 'AbortError';
}
