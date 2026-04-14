// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Provider-agnostic AI client with runtime-configurable provider and model.
// All providers except Anthropic use the OpenAI-compatible SDK.
// Settings from ai-settings.json, API keys from *.key files (gitignored).

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

const SETTINGS_FILE = join(process.cwd(), 'ai-settings.json');

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
		return readFileSync(join(process.cwd(), def.keyFile), 'utf-8').trim();
	} catch {
		return null;
	}
}

export function writeApiKey(provider: Provider, key: string): void {
	const def = PROVIDERS[provider];
	if (!def.keyFile) return;
	writeFileSync(join(process.cwd(), def.keyFile), key.trim() + '\n', 'utf-8');
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
	inputTokens: number;
	outputTokens: number;
	tokensUsed: number; // sum, for backwards compat
	stopReason: string;
}

// ── Chat ──────────────────────────────────────────────────────────

export async function chat(opts: {
	system?: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	maxTokens: number;
	tools?: ToolDef[];
}): Promise<ChatResponse> {
	init();

	if (_provider === 'anthropic') {
		const response = await anthropicClient!.messages.create({
			model: _model,
			max_tokens: opts.maxTokens,
			system: opts.system,
			messages: opts.messages,
			tools: opts.tools as Anthropic.Messages.Tool[]
		});

		const inputTokens = response.usage.input_tokens;
		const outputTokens = response.usage.output_tokens;

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
			provider: _provider,
			inputTokens,
			outputTokens,
			tokensUsed: inputTokens + outputTokens,
			stopReason: response.stop_reason || 'end_turn'
		};
	} else {
		// OpenAI-compatible path (OpenRouter, Mistral, IONOS, Mammouth, OpenAI, Ollama)
		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
		if (opts.system) messages.push({ role: 'system', content: opts.system });
		for (const m of opts.messages) messages.push({ role: m.role, content: m.content });

		const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = opts.tools?.map(t => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.input_schema
			}
		}));

		// OpenAI newer models (o-series, gpt-4.1+) require max_completion_tokens
		const tokenParam = _provider === 'openai'
			? { max_completion_tokens: opts.maxTokens }
			: { max_tokens: opts.maxTokens };

		const response = await openaiClient!.chat.completions.create({
			model: _model,
			...tokenParam,
			messages,
			tools
		});

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

		const inputTokens = response.usage?.prompt_tokens || 0;
		const outputTokens = response.usage?.completion_tokens || 0;

		return {
			text: choice.message.content || '',
			toolCalls,
			model: response.model || _model,
			provider: _provider,
			inputTokens,
			outputTokens,
			tokensUsed: inputTokens + outputTokens,
			stopReason: choice.finish_reason || 'end_turn'
		};
	}
}

// ── Connection test ───────────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string; model?: string }> {
	try {
		init();
		const response = await chat({
			messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
			maxTokens: 16
		});
		return { ok: true, model: response.model };
	} catch (e: unknown) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
