// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Provider-agnostic AI client with runtime-configurable provider and model.
// All providers except Anthropic use the OpenAI-compatible SDK.
// Settings from ai-settings.json, API keys from *.key files (gitignored).
//
// Robustness-Schicht (übernommen von SARAH's src/lib/server/ai/client.ts):
//   * executeWithNetworkRetry — 11-stufiger Backoff bis ~60 min, fängt
//     transient socket-Drops (UND_ERR_SOCKET, ECONNRESET) + Provider-5xx
//     (HTTP-Status + body-internal-5xx über OpenAI-kompatible Proxies wie
//     OpenRouter) + retryable-429 (Backpressure mit Retry-After-Header).
//   * withDeadline — Wall-Clock-Failsafe gegen SDK-Hänger, die das
//     AbortSignal nicht respektieren (beobachtet 2026-05-17 in SARAH).
//   * Run-Cancel-Signal-Threading — via AsyncLocalStorage aus
//     coding-run/activity-tracker.ts; `chat()` kombiniert es mit dem
//     Timeout-Signal via AbortSignal.any(). Mid-Call-Cancel wird wirksam,
//     nicht erst zwischen Atomen.
//   * Malformed-Response-Guard — OpenRouter et al. liefern in seltenen
//     Fällen HTTP-200 mit `{error:{...}}` ohne `choices`-Array; wir
//     normalisieren und markieren 5xx-Body-Codes als upstreamTransient.
//   * isFatalProviderError — distinguiert irrecoverable Probleme (401/402/
//     403, 429 ohne Retry-After) von transienten; Caller können den Loop
//     nach dem ersten fatalen Treffer abbrechen.
//
// Bewusst NICHT von SARAH übernommen:
//   * assertSafeForExternal / document_pii_seeds — transact-qda hat (noch)
//     kein PII-Seed-System. `opts.documentIds` ist als no-op-Param in der
//     Signatur, damit Callsites SARAH-konform geschrieben werden können,
//     wird aber nicht ausgewertet. Wenn das Failsafe-System nachgezogen
//     wird, hängt sich der Scan hier ein.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFileSync, writeFileSync } from 'node:fs';
import { getAiSettingsFile, getApiKeyFile } from '../paths.js';
import { startLlmCall, endLlmCall, getRunAbortSignal } from './coding-run/activity-tracker.js';

// Default per-call hard timeout. Coding-Run-LLM-Aufrufe sind typisch
// 10–60 s (H1-Propose, H2-Read, H2-Confront, H1-React je 1 Call/Sequenz).
// 3 min als Default deckt den schwersten Fall (Konfrontation auf voller
// Sequenz mit Reasoning-Modell) mit Reserve.
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;

// ── Wall-Clock-Deadline ──────────────────────────────────────────────
//
// Hard-Failsafe gegen Hänger, bei denen das SDK das übergebene AbortSignal
// nicht respektiert (beobachtet in SARAH 2026-05-17: 2h 39min stiller Hang
// trotz Default-3-min-Timeout-Signal). Diese Race-Wrapper setzt eine
// zweite, unabhängige Deadline über setTimeout, die vom Event-Loop
// garantiert gefeuert wird, selbst wenn der zugrundeliegende fetch in
// einem Zustand hängt, der die Abort-Semantik nicht mehr beachtet. Bei
// Timeout wirft `WallClockTimeoutError`; der Hintergrund-Promise mag noch
// laufen, aber der Run-Loop läuft sauber weiter bzw. wird im Catch sauber
// als failed markiert.
class WallClockTimeoutError extends Error {
	readonly isWallClockTimeout = true;
	constructor(label: string, ms: number) {
		super(`Wall-clock timeout: ${label} did not resolve within ${ms}ms (SDK ignored AbortSignal)`);
		this.name = 'WallClockTimeoutError';
	}
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new WallClockTimeoutError(label, ms)), ms);
	});
	return Promise.race([promise, deadline]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

// ── Network-Retry-Layer ───────────────────────────────────────────
//
// Übernommen von SARAH (Setzungen 2026-05-09 + 2026-05-13). Bei Coding-Runs
// auf langen Dokumenten (140 Sequenzen × 4 Calls = 560 Calls/Run) sind
// transient socket-Drops statistisch garantiert. Ohne Retry rauscht
// `TypeError: fetch failed { cause: terminated, code: UND_ERR_SOCKET }`
// durch und killt den ganzen Run.
//
// Drei Klassen, alle nicht-fatal:
//   1) transient-network — UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT, EAI_AGAIN,
//      EPIPE, "fetch failed", "terminated".
//   2) 429 MIT Retry-After-Header — Backpressure (typisch bei parallelen
//      Pipeline-Calls gegen Mistral-Tokens/min oder OpenRouter-RPS). Retry
//      mit Retry-After-Wartezeit (clamp 60s), max. 3 Versuche.
//   3) Provider-5xx — HTTP-Status 5xx ODER body-internal-5xx (OpenRouter
//      liefert manchmal HTTP-200 mit `{error:{code:500,...}}`). Transient
//      über längere Zeitskalen als Socket-Drops.
//
// 429 OHNE Retry-After bleibt fatal (echte Quota / Tageslimit / Auth).

function isTransientNetworkError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const e = err as any;
	const code: unknown = e?.code;
	const causeCode: unknown = e?.cause?.code;
	const name = err.name;
	const msg = (err.message ?? '').toLowerCase();
	const causeMsg = (e?.cause?.message ?? '').toString().toLowerCase();
	const isUndiciSocket =
		code === 'UND_ERR_SOCKET' || causeCode === 'UND_ERR_SOCKET' || causeMsg === 'terminated';
	const isResetLike =
		code === 'ECONNRESET' ||
		code === 'ETIMEDOUT' ||
		code === 'EAI_AGAIN' ||
		code === 'EPIPE' ||
		causeCode === 'ECONNRESET' ||
		causeCode === 'ETIMEDOUT' ||
		causeCode === 'EAI_AGAIN' ||
		causeCode === 'EPIPE';
	const isAbort = name === 'AbortError';
	const isFetchFailed =
		msg === 'terminated' ||
		msg === 'fetch failed' ||
		msg.includes('socket hang up') ||
		msg.includes('socket disconnected') ||
		msg.includes('other side closed') ||
		msg.includes('client network socket disconnected');
	return isUndiciSocket || isResetLike || isAbort || isFetchFailed;
}

function readHeader(err: unknown, name: string): string | null {
	if (!err || typeof err !== 'object') return null;
	const headers = (err as { headers?: unknown }).headers;
	if (!headers) return null;
	if (typeof Headers !== 'undefined' && headers instanceof Headers) {
		return headers.get(name);
	}
	if (typeof headers === 'object') {
		const h = headers as Record<string, unknown>;
		const v = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
		return typeof v === 'string' ? v : null;
	}
	return null;
}

function getRetryAfterMs(err: unknown): number | null {
	const raw = readHeader(err, 'retry-after');
	if (!raw) return null;
	const sec = Number(raw);
	if (Number.isFinite(sec) && sec >= 0) {
		return Math.min(Math.max(sec * 1000, 0), 60_000);
	}
	const ts = Date.parse(raw);
	if (Number.isFinite(ts)) {
		const ms = ts - Date.now();
		return Math.min(Math.max(ms, 0), 60_000);
	}
	return null;
}

export function isRetryable429(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	if ((err as { status?: unknown }).status !== 429) return false;
	return getRetryAfterMs(err) !== null;
}

function isTransientUpstream5xx(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const status = (err as { status?: unknown }).status;
	if (typeof status === 'number' && status >= 500 && status <= 599) return true;
	if ((err as { upstreamTransient?: unknown }).upstreamTransient === true) return true;
	return false;
}

function isAbortError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return err.name === 'AbortError' || err.name === 'TimeoutError';
}

const RATE_LIMIT_MAX_RETRIES = 3;

// Wachsendes Backoff-Profil für transient-network + transient-upstream-5xx.
// Frühe Versuche schnell (Socket-Wackler im laufenden Run), spätere generös
// (Provider-Outage wegwarten). Gesamt-Wartebudget ~60 min, 11 Versuche.
const TRANSIENT_BACKOFFS_MS = [
	0, //        Versuch 1: sofort
	1_000, //    Versuch 2: 1s
	3_000, //    Versuch 3: 3s
	30_000, //   Versuch 4: 30s
	60_000, //   Versuch 5: 1min
	120_000, //  Versuch 6: 2min
	300_000, //  Versuch 7: 5min
	600_000, //  Versuch 8: 10min
	900_000, //  Versuch 9: 15min
	900_000, //  Versuch 10: 15min
	900_000 //   Versuch 11: 15min
];

async function executeWithNetworkRetry<T>(
	attempt: () => Promise<T>,
	context: { provider: string; model: string; signal?: AbortSignal }
): Promise<T> {
	let lastErr: unknown;
	let transientAttempt = 0;
	let rateLimitRetries = 0;
	while (transientAttempt < TRANSIENT_BACKOFFS_MS.length) {
		// Vor jedem Versuch prüfen, ob das Cancel/Timeout-Signal schon
		// gefeuert hat. Sonst würden wir nach einem Backoff den nächsten
		// SDK-Call starten, obwohl der User längst cancelt hat.
		if (context.signal?.aborted) {
			throw context.signal.reason ?? new DOMException('Aborted', 'AbortError');
		}
		const sleepMs = TRANSIENT_BACKOFFS_MS[transientAttempt];
		if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
		try {
			return await attempt();
		} catch (err) {
			lastErr = err;
			// AbortError nie retryen — ist entweder User-Cancel oder
			// hard-Timeout, beides definitive Signale.
			if (context.signal?.aborted || isAbortError(err)) {
				throw err;
			}
			if (isRetryable429(err) && rateLimitRetries < RATE_LIMIT_MAX_RETRIES) {
				const waitMs = getRetryAfterMs(err) ?? 2000;
				rateLimitRetries++;
				console.warn(
					`[client] 429 backpressure on ${context.provider}/${context.model}` +
						` retry ${rateLimitRetries}/${RATE_LIMIT_MAX_RETRIES} after ${waitMs}ms`
				);
				await new Promise((r) => setTimeout(r, waitMs));
				continue;
			}
			const transientNetwork = isTransientNetworkError(err);
			const transientUpstream = isTransientUpstream5xx(err);
			if (!transientNetwork && !transientUpstream) throw err;
			const msg = err instanceof Error ? err.message : String(err);
			const klass = transientUpstream ? 'upstream-5xx' : 'network';
			const nextIdx = transientAttempt + 1;
			const haveNext = nextIdx < TRANSIENT_BACKOFFS_MS.length;
			const nextWaitMs = haveNext ? TRANSIENT_BACKOFFS_MS[nextIdx] : 0;
			console.warn(
				`[client] transient ${klass} error on ${context.provider}/${context.model}` +
					` attempt ${transientAttempt + 1}/${TRANSIENT_BACKOFFS_MS.length}: ${msg.slice(0, 240)}` +
					(haveNext
						? ` — retrying in ${Math.round(nextWaitMs / 1000)}s`
						: ` — budget exhausted, will throw`)
			);
			transientAttempt++;
		}
	}
	throw lastErr;
}

// ── Provider definitions ──────────────────────────────────────────

export type Provider = 'ollama' | 'mistral' | 'ionos' | 'mammouth' | 'anthropic' | 'openai' | 'openrouter';

export interface ProviderDef {
	label: string;
	baseURL: string;
	defaultModel: string;
	keyFile: string | null; // null = no key needed (e.g. Ollama)
	dsgvo: boolean;
	region: string;
}

export const PROVIDERS: Record<Provider, ProviderDef> = {
	ollama:     { label: 'Ollama (local)',  baseURL: 'http://localhost:11434/v1',                            defaultModel: 'llama3.1',                            keyFile: null,             dsgvo: true,  region: 'local' },
	mistral:    { label: 'Mistral AI',      baseURL: 'https://api.mistral.ai/v1',                           defaultModel: 'mistral-large-latest',                 keyFile: 'mistral.key',    dsgvo: true,  region: 'EU' },
	ionos:      { label: 'IONOS',           baseURL: 'https://openai.inference.de-txl.ionos.com/v1',        defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct', keyFile: 'ionos.key',   dsgvo: true,  region: 'EU (Berlin)' },
	mammouth:   { label: 'Mammouth AI',     baseURL: 'https://api.mammouth.ai/v1',                          defaultModel: 'claude-sonnet-4-6',                    keyFile: 'mammouth.key',   dsgvo: true,  region: 'EU' },
	anthropic:  { label: 'Anthropic',       baseURL: 'https://api.anthropic.com',                           defaultModel: 'claude-opus-4-6',                      keyFile: 'anthropic.key',  dsgvo: false, region: 'US' },
	openai:     { label: 'OpenAI',          baseURL: 'https://api.openai.com/v1',                           defaultModel: 'gpt-5.4-pro',                          keyFile: 'openai.key',    dsgvo: false, region: 'US' },
	openrouter: { label: 'OpenRouter',      baseURL: 'https://openrouter.ai/api/v1',                        defaultModel: 'anthropic/claude-opus-4-6',            keyFile: 'openrouter.key', dsgvo: false, region: 'US' },
};

// ── Settings persistence ──────────────────────────────────────────

export interface DelegationAgent {
	provider: Provider;
	model: string;
}

export interface AiSettings {
	provider: Provider;
	model: string;
	/** Sub-agent for delegation (cheaper/faster model for simple tasks) */
	delegationAgent?: DelegationAgent;
	/** Analysis language — codes, memos, and AI output will use this language */
	language?: string;
	/**
	 * Per-tier model routing (adopted from SARAH). Keyed by tier ID
	 * (e.g. 'coding-run.h1'); each entry overrides that tier's registry
	 * recommendation. See coding-run/model-tiers.ts.
	 */
	tiers?: Partial<Record<string, { provider: Provider; model: string }>>;
}

export const SUPPORTED_LANGUAGES: Record<string, string> = {
	auto: 'Auto-detect (from documents)',
	de: 'Deutsch',
	en: 'English',
	fr: 'Français',
	es: 'Español',
	pt: 'Português',
	it: 'Italiano',
	nl: 'Nederlands',
	pl: 'Polski',
	ja: '日本語',
	zh: '中文',
	ko: '한국어'
};

const SETTINGS_FILE = getAiSettingsFile();

const DEFAULT_SETTINGS: AiSettings = { provider: 'openrouter', model: '' };

export function loadSettings(): AiSettings {
	try {
		const raw = readFileSync(SETTINGS_FILE, 'utf-8');
		const parsed = JSON.parse(raw);
		const settings: AiSettings = {
			provider: parsed.provider && parsed.provider in PROVIDERS ? parsed.provider : DEFAULT_SETTINGS.provider,
			model: parsed.model || ''
		};
		// Load delegation agent if configured
		if (parsed.delegationAgent?.provider && parsed.delegationAgent.provider in PROVIDERS) {
			settings.delegationAgent = {
				provider: parsed.delegationAgent.provider,
				model: parsed.delegationAgent.model || ''
			};
		}
		// Load language preference
		if (parsed.language && parsed.language in SUPPORTED_LANGUAGES) {
			settings.language = parsed.language;
		}
		// Load per-tier model routing (adopted from SARAH). Each entry
		// must name a known provider and a non-empty model string.
		if (parsed.tiers && typeof parsed.tiers === 'object') {
			const tiers: Partial<Record<string, { provider: Provider; model: string }>> = {};
			for (const [key, value] of Object.entries(parsed.tiers)) {
				const o = value as { provider?: unknown; model?: unknown };
				if (
					o &&
					typeof o.provider === 'string' &&
					o.provider in PROVIDERS &&
					typeof o.model === 'string' &&
					o.model.length > 0
				) {
					tiers[key] = { provider: o.provider as Provider, model: o.model };
				}
			}
			if (Object.keys(tiers).length > 0) settings.tiers = tiers;
		}
		return settings;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(settings: AiSettings): void {
	writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
	// Force re-init on next call
	_initialized = false;
}

// ── API key management ────────────────────────────────────────────

export function readApiKey(provider: Provider): string | null {
	const def = PROVIDERS[provider];
	if (!def.keyFile) return null; // Ollama needs no key
	try {
		return readFileSync(getApiKeyFile(def.keyFile), 'utf-8').trim();
	} catch {
		return null;
	}
}

export function writeApiKey(provider: Provider, key: string): void {
	const def = PROVIDERS[provider];
	if (!def.keyFile) return;
	writeFileSync(getApiKeyFile(def.keyFile), key.trim() + '\n', 'utf-8');
	// Force re-init on next call
	_initialized = false;
}

export function maskKey(key: string | null): string {
	if (!key) return '';
	if (key.length <= 12) return '***';
	return key.slice(0, 7) + '...' + key.slice(-4);
}

// ── Client init ───────────────────────────────────────────────────

let _initialized = false;
let _provider: Provider = 'openrouter';
let _model = '';
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function init() {
	if (_initialized) return;

	const settings = loadSettings();
	_provider = settings.provider;
	const def = PROVIDERS[_provider];
	_model = settings.model || def.defaultModel;

	if (_provider === 'anthropic') {
		const apiKey = readApiKey('anthropic');
		if (!apiKey) throw new Error('No API key found. Add anthropic.key or change provider in settings.');
		anthropicClient = new Anthropic({ apiKey });
		openaiClient = null;
	} else {
		// All other providers use OpenAI-compatible API
		const apiKey = readApiKey(_provider);
		if (def.keyFile && !apiKey) {
			throw new Error(`No API key found for ${def.label}. Add ${def.keyFile} or change provider in settings.`);
		}
		openaiClient = new OpenAI({
			apiKey: apiKey || 'ollama', // Ollama doesn't need a real key
			baseURL: def.baseURL
		});
		anthropicClient = null;
	}

	_initialized = true;
}

export function getModel(): string {
	init();
	return _model;
}

export function getProvider(): Provider {
	init();
	return _provider;
}

// ── Anthropic model max output (only place with max_tokens set) ──
//
// Übernommen von SARAH (Setzung 2026-05-18): Anthropic's Messages API
// verlangt `max_tokens` als required body parameter. Wert wird intern auf
// Modell-Max aus der offiziellen Anthropic-Doku gesetzt, nicht von außen
// steuerbar. transact-qda's bisheriger `opts.maxTokens` wird auf dem
// Anthropic-Pfad ignoriert (es sei denn explizit gesetzt — dann wins der
// Callsite-Wert; siehe chat() unten).
export function anthropicModelMaxOutput(model: string): number {
	switch (model) {
		case 'claude-opus-4-7':    return 128_000;
		case 'claude-sonnet-4-6':  return  64_000;
		case 'claude-haiku-4-5':
		case 'claude-haiku-4-5-20251001': return 64_000;
		case 'claude-opus-4-6':    return 128_000;
		case 'claude-sonnet-4-5':
		case 'claude-sonnet-4-5-20250929': return 64_000;
		case 'claude-opus-4-5':
		case 'claude-opus-4-5-20251101': return 64_000;
		case 'claude-opus-4-1':
		case 'claude-opus-4-1-20250805': return 32_000;
		default:
			// Fallback statt throw — transact-qda hat Bestands-Callsites mit
			// unbekannten Anthropic-IDs, die wir nicht versehentlich brechen
			// wollen. SARAH wirft hier; bei uns ist der konservative 64k-
			// Fallback der niedrige-Risiko-Weg.
			return 64_000;
	}
}

// ── Unified types ─────────────────────────────────────────────────

export interface ToolDef {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface ToolCall {
	name: string;
	input: Record<string, unknown>;
	id: string;
}

export interface ChatResponse {
	text: string;
	toolCalls: ToolCall[];
	model: string;
	provider: Provider;
	inputTokens: number;          // fresh input tokens (neither cached nor cache-creating)
	outputTokens: number;
	cacheCreationTokens: number;  // tokens written into cache on this call
	cacheReadTokens: number;      // tokens served from cache
	tokensUsed: number;           // sum of all input + output, for backwards compat
	stopReason: string;
}

// ── Chat ──────────────────────────────────────────────────────────

export async function chat(opts: {
	system?: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	tools?: ToolDef[];
	/**
	 * Optional. Backwards-Compat-Param für transact-qda-Callsites, die noch
	 * `maxTokens` setzen. SARAHs Setzung 2026-05-18 schafft Hartbegrenzungen
	 * ab; im Anthropic-Pfad wird stattdessen `anthropicModelMaxOutput(model)`
	 * genutzt, im OpenAI-Pfad kein max_tokens gesendet (Provider regelt
	 * selbst). Hier behalten wir das Feld optional, damit Bestands-Callsites
	 * compilieren — wenn gesetzt, wird der Wert auf BEIDEN Pfaden als
	 * max_tokens-Cap genutzt; wenn ungesetzt, greift die SARAH-Setzung.
	 */
	maxTokens?: number;
	/**
	 * If true, mark the system prompt as cacheable (Anthropic prompt caching,
	 * 5-min TTL). Honoured natively on the Anthropic provider, passed through
	 * on OpenRouter / Mammouth (Anthropic-proxying). Silently ignored elsewhere.
	 */
	cacheSystem?: boolean;
	/**
	 * Stable, cache-friendly prefix of the system prompt. When set, this is
	 * sent as a separate system block with `cache_control: ephemeral`, while
	 * `system` (the variable suffix) is sent as a second uncached block.
	 * Honoured on Anthropic native + OpenRouter + Mammouth.
	 */
	cacheableSystemPrefix?: string;
	/**
	 * Per-call provider/model override. Bypasses the module-level settings
	 * for this single call — used by tier-routed callsites (coding-run's H1/
	 * H2). The override builds a one-shot client; it does NOT mutate the
	 * shared client state, so concurrent default-config calls are unaffected.
	 */
	modelOverride?: { provider: Provider; model: string };
	/**
	 * If 'json', request strict JSON output. Passed as `response_format:
	 * { type: 'json_object' }` on OpenAI-compat providers. Reduces Markdown-
	 * wrapper / preamble issues from many models. No-op on Anthropic native.
	 */
	responseFormat?: 'json';
	/**
	 * Anonymisierungs-Failsafe-Hook. Aktuell NO-OP in transact-qda — das
	 * PII-Seed-System aus SARAH ist nicht portiert. Signatur-Treue: Callsites,
	 * die SARAH-konform geschrieben sind, kompilieren ohne Anpassung. Wenn
	 * das Failsafe nachgezogen wird, hängt sich der Scan hier ein.
	 */
	documentIds?: string[];
	/**
	 * Hard timeout für diesen Call (ms). Default: 3 min. Bei Erreichen wird
	 * der Call via AbortSignal abgebrochen und wirft `AbortError`. Plus eine
	 * unabhängige Wall-Clock-Deadline (siehe withDeadline) — Failsafe gegen
	 * SDKs, die das Signal ignorieren.
	 */
	timeoutMs?: number;
	/**
	 * Externes Cancel-Signal von der Callsite. Wird mit dem Run-Cancel-Signal
	 * (aus AsyncLocalStorage via withRun) und dem internen Timeout-Signal
	 * via `AbortSignal.any` kombiniert. Eintreffender Abort von einer der
	 * drei Quellen reißt den SDK-Call ab; der Caller fängt `AbortError`.
	 */
	signal?: AbortSignal;
}): Promise<ChatResponse> {
	init();

	const provider = opts.modelOverride?.provider ?? _provider;
	const model = opts.modelOverride?.model ?? _model;

	// documentIds ist aktuell no-op (siehe Header). Wenn das PII-Failsafe
	// nachgezogen wird, kommt hier assertSafeForExternal(payload, ids, provider).
	void opts.documentIds;

	let oneShotAnthropic: Anthropic | null = null;
	let oneShotOpenAI: OpenAI | null = null;
	if (opts.modelOverride && provider !== _provider) {
		const def = PROVIDERS[provider];
		const apiKey = readApiKey(provider);
		if (def.keyFile && !apiKey) {
			throw new Error(`No API key found for ${def.label}. Add ${def.keyFile} to use override.`);
		}
		if (provider === 'anthropic') {
			oneShotAnthropic = new Anthropic({ apiKey: apiKey! });
		} else {
			oneShotOpenAI = new OpenAI({ apiKey: apiKey || 'ollama', baseURL: def.baseURL });
		}
	}
	const useAnthropic = provider === 'anthropic' ? (oneShotAnthropic ?? anthropicClient!) : null;
	const useOpenAI = provider !== 'anthropic' ? (oneShotOpenAI ?? openaiClient!) : null;

	// Cancel/Timeout-Signal komponieren. Drei Quellen, alle optional, alle
	// gleichberechtigt: jeder Abort von einer reißt den Call ab.
	//   1) opts.signal — direkter Caller-Override (selten)
	//   2) Run-Signal aus AsyncLocalStorage — User-Cancel via Watcher in
	//      coding-run/+server.ts; greift mid-fetch, nicht nur zwischen Atomen
	//   3) Timeout — Default 3 min, via opts.timeoutMs überschreibbar
	// Außerhalb eines Run-Contexts (Connection-Test, coach-library, etc.)
	// fehlt (2); Timeout (3) gilt immer.
	const timeoutMs = opts.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const runSignal = getRunAbortSignal();
	const signals: AbortSignal[] = [timeoutSignal];
	if (opts.signal) signals.push(opts.signal);
	if (runSignal) signals.push(runSignal);
	const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

	// Live-Activity-Tracker: meldet dem Status-Layer „LLM-Call aktiv,
	// provider/model X". No-op außerhalb eines withRun-Blocks.
	startLlmCall(provider, model);
	try {
		if (provider === 'anthropic') {
			// System param — three modes:
			//   1. cacheableSystemPrefix set → two-block: cached prefix + uncached suffix
			//   2. cacheSystem true → single cached block
			//   3. plain → string passthrough
			let systemParam: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] | undefined;
			if (opts.cacheableSystemPrefix) {
				const blocks: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] = [
					{ type: 'text', text: opts.cacheableSystemPrefix, cache_control: { type: 'ephemeral' } }
				];
				if (opts.system) blocks.push({ type: 'text', text: opts.system });
				systemParam = blocks;
			} else if (opts.cacheSystem && opts.system) {
				systemParam = [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }];
			} else {
				systemParam = opts.system;
			}

			// max_tokens: Callsite-Override gewinnt; sonst Modell-Max aus
			// anthropicModelMaxOutput (SARAH-Setzung).
			const maxTokensValue = opts.maxTokens ?? anthropicModelMaxOutput(model);

			const response = await withDeadline(
				executeWithNetworkRetry(
					() =>
						useAnthropic!.messages.create(
							{
								model,
								max_tokens: maxTokensValue,
								system: systemParam,
								messages: opts.messages,
								tools: opts.tools as Anthropic.Messages.Tool[]
							},
							{ signal: combinedSignal }
						),
					{ provider, model, signal: combinedSignal }
				),
				timeoutMs,
				`${provider}/${model}`
			);

			const inputTokens = response.usage.input_tokens;
			const outputTokens = response.usage.output_tokens;
			const cacheCreationTokens = response.usage.cache_creation_input_tokens ?? 0;
			const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0;

			return {
				text: response.content
					.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
					.map(b => b.text)
					.join(''),
				toolCalls: response.content
					.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')
					.map(b => ({
						name: b.name,
						input: b.input as Record<string, unknown>,
						id: b.id
					})),
				model: response.model,
				provider,
				inputTokens,
				outputTokens,
				cacheCreationTokens,
				cacheReadTokens,
				tokensUsed: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
				stopReason: response.stop_reason || 'end_turn'
			};
		} else {
			// OpenAI-compatible path (OpenRouter, Mistral, IONOS, Mammouth, OpenAI, Ollama)
			const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

			// Providers that pass cache_control through to Anthropic-style caching.
			// Mistral native does its own implicit caching (no cache_control needed;
			// stable string prefix is detected server-side); sending cache_control
			// returns 422 there.
			const supportsCachePassThrough = provider === 'openrouter' || provider === 'mammouth';
			if (opts.cacheableSystemPrefix) {
				if (supportsCachePassThrough) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const content: any[] = [
						{ type: 'text', text: opts.cacheableSystemPrefix, cache_control: { type: 'ephemeral' } }
					];
					if (opts.system) content.push({ type: 'text', text: opts.system });
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					messages.push({ role: 'system', content } as any);
				} else {
					const collapsed = opts.system
						? opts.cacheableSystemPrefix + '\n\n' + opts.system
						: opts.cacheableSystemPrefix;
					messages.push({ role: 'system', content: collapsed });
				}
			} else if (opts.system) {
				if (opts.cacheSystem && supportsCachePassThrough) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					messages.push({
						role: 'system',
						content: [
							{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }
						]
					} as any);
				} else {
					messages.push({ role: 'system', content: opts.system });
				}
			}
			for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

			const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = opts.tools?.map(t => ({
				type: 'function' as const,
				function: {
					name: t.name,
					description: t.description,
					parameters: t.input_schema
				}
			}));

			// max_tokens: nur senden, wenn explizit gesetzt. SARAH-Setzung
			// 2026-05-18: keine Hartbegrenzungen mehr im OpenAI-Pfad
			// (Provider regelt selbst). Bestands-Callsites in transact-qda,
			// die `maxTokens` setzen, werden weiter respektiert.
			const tokenParam = opts.maxTokens !== undefined
				? (provider === 'openai'
					? { max_completion_tokens: opts.maxTokens }
					: { max_tokens: opts.maxTokens })
				: {};

			// JSON-mode opt-in.
			const responseFormatParam = opts.responseFormat === 'json'
				? { response_format: { type: 'json_object' as const } }
				: {};

			let response: OpenAI.Chat.Completions.ChatCompletion;
			try {
				response = await withDeadline(
					executeWithNetworkRetry(
						async () => {
							const r = await useOpenAI!.chat.completions.create(
								{
									model,
									...tokenParam,
									...responseFormatParam,
									messages,
									tools
								},
								{ signal: combinedSignal }
							);
							// Malformed-Response-Guard: OpenRouter et al. liefern in
							// seltenen Fällen einen HTTP-200-Response, dessen Body
							// kein gültiges OpenAI-Chat-Completion ist — typisch
							// `{ error: { message, code }, model, id }` ohne
							// `choices`-Array. Ohne diesen Guard crasht der nachfolgende
							// `response.choices[0]`-Zugriff. Wenn der inline-Code 5xx
							// ist (Upstream-Outage durchgereicht), markiere
							// upstreamTransient damit executeWithNetworkRetry den
							// Versuch wiederholt.
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const respAny = r as any;
							if (
								!r ||
								!Array.isArray(respAny.choices) ||
								respAny.choices.length === 0
							) {
								const inlineErr = respAny?.error;
								const inlineErrMsg = typeof inlineErr === 'string'
									? inlineErr
									: (inlineErr?.message ?? null);
								const inlineErrCode = inlineErr?.code ?? null;
								const inlineProvider = respAny?.provider ?? respAny?.provider_name ?? null;
								const requestId = respAny?.id ?? null;
								const detailParts: string[] = [];
								if (inlineProvider) detailParts.push(`upstream-provider=${inlineProvider}`);
								if (inlineErrCode != null) detailParts.push(`code=${inlineErrCode}`);
								if (inlineErrMsg) detailParts.push(`message=${String(inlineErrMsg).slice(0, 400)}`);
								if (requestId) detailParts.push(`request_id=${requestId}`);
								const choicesShape = !r
									? '(response is null/undefined)'
									: !Array.isArray(respAny.choices)
										? `choices is ${typeof respAny.choices}`
										: 'choices is empty array';
								const detail = detailParts.length > 0 ? ` | ${detailParts.join(' ')}` : '';
								const malformedErr = new Error(
									`Malformed response from ${provider}/${model}: ${choicesShape}.${detail}` +
										` (Body excerpt: ${JSON.stringify(respAny).slice(0, 400)})`
								);
								const numericCode =
									typeof inlineErrCode === 'number'
										? inlineErrCode
										: Number(inlineErrCode);
								if (Number.isFinite(numericCode) && numericCode >= 500 && numericCode <= 599) {
									(malformedErr as unknown as { upstreamTransient: boolean }).upstreamTransient = true;
								}
								throw malformedErr;
							}
							return r;
						},
						{ provider, model, signal: combinedSignal }
					),
					timeoutMs,
					`${provider}/${model}`
				);
			} catch (err) {
				// OpenRouter (und andere OpenAI-kompatible Proxies) packen
				// Upstream-Fehler in `err.error.metadata.raw` und/oder
				// `err.error.metadata.provider_name`. Das echte Provider-Detail
				// (Content-Filter-Reason, Schema-Beschwerde, Quota-Hinweis) steht
				// dort, NICHT in `err.message`. Wir reichern die Message defensiv
				// mit dem Body-Detail an, damit UI/Log nicht nur „400 Provider
				// returned error" sehen.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const e = err as any;
				const status = typeof e?.status === 'number' ? e.status : undefined;
				const meta = e?.error?.metadata;
				const raw = meta?.raw;
				const providerName = meta?.provider_name;
				const innerMessage = e?.error?.message;
				if (status && (raw || providerName || innerMessage)) {
					const detail =
						(providerName ? `[${providerName}] ` : '') +
						(innerMessage ? innerMessage : '') +
						(raw ? ` raw=${typeof raw === 'string' ? raw.slice(0, 800) : JSON.stringify(raw).slice(0, 800)}` : '');
					const enrichedMessage = `${e?.message ?? `HTTP ${status}`} | ${detail.trim()}`;
					const enriched = new Error(enrichedMessage);
					(enriched as unknown as { status: number }).status = status;
					throw enriched;
				}
				throw err;
			}

			const choice = response.choices[0];
			const toolCalls: ToolCall[] = [];
			for (const tc of choice.message.tool_calls || []) {
				if ('function' in tc) {
					toolCalls.push({
						name: tc.function.name,
						input: JSON.parse(tc.function.arguments),
						id: tc.id
					});
				}
			}

			// OpenAI-compat usage. OpenRouter + Mammouth (Anthropic-proxying)
			// expose cache reads via prompt_tokens_details.cached_tokens.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const usage = response.usage as any | undefined;
			const promptTotal = usage?.prompt_tokens ?? 0;
			const cacheReadTokens =
				usage?.prompt_tokens_details?.cached_tokens
				?? usage?.cache_read_input_tokens
				?? 0;
			const cacheCreationTokens =
				usage?.prompt_tokens_details?.cache_creation_tokens
				?? usage?.cache_creation_input_tokens
				?? 0;
			const inputTokens = Math.max(0, promptTotal - cacheReadTokens - cacheCreationTokens);
			const outputTokens = usage?.completion_tokens ?? 0;

			return {
				text: choice.message.content || '',
				toolCalls,
				model: response.model || model,
				provider,
				inputTokens,
				outputTokens,
				cacheCreationTokens,
				cacheReadTokens,
				tokensUsed: promptTotal + outputTokens,
				stopReason: choice.finish_reason || 'end_turn'
			};
		}
	} finally {
		endLlmCall();
	}
}

// ── Connection test ───────────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string; model?: string; fatal?: boolean }> {
	try {
		init();
		const response = await chat({
			messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
			maxTokens: 16
		});
		return { ok: true, model: response.model };
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, error: message, fatal: isFatalProviderError(e) };
	}
}

// ── Fatal-Error-Erkennung ─────────────────────────────────────────
//
// Provider-Fehler, die im aktuellen Run nicht von selbst weggehen:
// abgelaufene/ungültige API-Keys (401), erschöpfte Tages-/Wochen-Quotas
// (403 mit „limit"/„quota"/„key"-Wording bei OpenRouter), harte
// Rate-Limits ohne Retry-After (429 als Quota-Aus). Solche Fehler sind
// NICHT atom-spezifisch — der Orchestrator nutzt das Signal, um den
// Loop nach dem ersten Treffer abzubrechen.

const FATAL_MESSAGE_PATTERN =
	/(?:key\s*limit\s*exceeded|insufficient\s*quota|quota\s*exceeded|invalid\s*api\s*key|unauthor[iz]ed|forbidden|payment\s*required)/i;

export function isFatalProviderError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const status = (err as { status?: unknown }).status;
	if (typeof status === 'number') {
		if (status === 401 || status === 402 || status === 403) return true;
		if (status === 429) return !isRetryable429(err);
	}
	const message = (err as { message?: unknown }).message;
	if (typeof message === 'string' && FATAL_MESSAGE_PATTERN.test(message)) {
		return true;
	}
	return false;
}
