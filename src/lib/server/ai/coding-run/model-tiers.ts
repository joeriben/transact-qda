// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Model-Tiers — per-faculty model routing for the per-document coding run.
// The tier mechanism is adopted from an earlier routing layer, scoped here
// to the coding run's two faculties.
//
// The coding run confronts two faculties per sequence — a thematic span
// computed algorithmically, see segmentation.ts (and prompts.ts):
//
//   H1 — the CODING line: code-extractive, frictionless, high call count.
//        H1 is *designed* to over-produce; the discipline against
//        over-coding is structural (H2's confrontation), not H1's restraint.
//        A cheap, fast model is therefore the *correct* H1 — not a saving.
//
//   H2 — the COMPREHENSION line: re-reads each sequence independently,
//        carries the cumulative Verständnislinie, and confronts H1's codes.
//        H2's reading is the *measure* against which over-coding is tested,
//        so H2 should be the sharper model.
//
// Two tiers, one per faculty:
//   - 'coding-run.h1' routes H1-propose + H1-react.
//   - 'coding-run.h2' routes H2-read + H2-confront.
//
// Each tier resolves to a user override from ai-settings.json `tiers`
// (keyed by tier ID), else the registry recommendation. `resolveTier()`
// is the dispatch-point accessor; the orchestrator passes the result to
// chat() as `modelOverride`. The global provider/model in AiSettings stays
// the default for non-tier-routed calls.
//
// Per tier:
//   - displayName / description: user-facing, for a settings UI.
//   - recommended: the model the tier defaults to.
//   - candidates: routes whose suitability for THIS tier is plausible,
//     each with a tier-specific note. KNOWN_ROUTES holds the tier-
//     independent master data (label, price, region, DSGVO).

import { loadSettings, type Provider } from '../client.js';

export type Tier =
	| 'coding-run.h1' // H1 propose + react — code extraction, frictionless, many calls
	| 'coding-run.h2'; // H2 read + confront — independent comprehension, the measure

export interface TierModel {
	provider: Provider;
	model: string;
}

/**
 * Tier-independent route master data. Price in USD per million tokens
 * (input / output). `null` = not verified.
 */
export interface RouteOption {
	provider: Provider;
	model: string;
	label: string;
	inputUSDPerMTok: number | null;
	outputUSDPerMTok: number | null;
	region: string;
	dsgvo: boolean;
}

export const KNOWN_ROUTES: RouteOption[] = [
	{ provider: 'mistral', model: 'mistral-large-latest', label: 'mistral-large (Mistral nativ EU)', inputUSDPerMTok: 0.5, outputUSDPerMTok: 1.5, region: 'EU', dsgvo: true },
	{ provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro', label: 'mimo-v2.5-pro (OpenRouter)', inputUSDPerMTok: 1.0, outputUSDPerMTok: 3.0, region: 'US', dsgvo: false },
	{ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6', label: 'claude-sonnet-4.6 (OpenRouter)', inputUSDPerMTok: 3.0, outputUSDPerMTok: 15.0, region: 'US', dsgvo: false },
	{ provider: 'mammouth', model: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 (Mammouth, EU-vermittelt)', inputUSDPerMTok: 3.0, outputUSDPerMTok: 15.0, region: 'EU', dsgvo: true },
	{ provider: 'openrouter', model: 'anthropic/claude-opus-4.7', label: 'claude-opus-4.7 (OpenRouter)', inputUSDPerMTok: 5.0, outputUSDPerMTok: 25.0, region: 'US', dsgvo: false },
	{ provider: 'mammouth', model: 'kimi-k2.5', label: 'kimi-k2.5 (Mammouth, EU-vermittelt)', inputUSDPerMTok: 0.45, outputUSDPerMTok: 2.25, region: 'EU', dsgvo: true },
	{ provider: 'openrouter', model: 'moonshotai/kimi-k2.5', label: 'kimi-k2.5 (OpenRouter)', inputUSDPerMTok: 0.45, outputUSDPerMTok: 2.25, region: 'US', dsgvo: false }
];

export interface TierCandidate {
	provider: Provider;
	model: string;
	/** What the experience says about this route specifically IN THIS tier. */
	note: string;
}

export interface TierMeta {
	/** Short, user-facing label for the settings UI. */
	displayName: string;
	/** Fuller description of the pipeline step. */
	description: string;
	recommended: TierModel;
	candidates: TierCandidate[];
	/**
	 * Escalation target wenn der primary tier auf eine Sequenz hin zweimal
	 * leer/unparsebar antwortet (MiMo-Token-Meltdown-Pattern, beobachtet in
	 * internen Testläufen auf deutscher Quelle). null = kein Fallback, Helper gibt nach 2
	 * leeren Versuchen auf und der Loop arbeitet mit der leeren Antwort
	 * weiter (Status-quo-Verhalten vor 2026-05-24).
	 */
	fallback: TierModel | null;
}

const MISTRAL: TierModel = { provider: 'mistral', model: 'mistral-large-latest' };
const MIMO: TierModel = { provider: 'openrouter', model: 'xiaomi/mimo-v2.5-pro' };
const SONNET_OR: TierModel = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' };
const SONNET_MAMMOUTH: TierModel = { provider: 'mammouth', model: 'claude-sonnet-4-6' };
const OPUS_OR: TierModel = { provider: 'openrouter', model: 'anthropic/claude-opus-4.7' };
const KIMI_MAMMOUTH: TierModel = { provider: 'mammouth', model: 'kimi-k2.5' };
const KIMI_OR: TierModel = { provider: 'openrouter', model: 'moonshotai/kimi-k2.5' };

export const TIER_REGISTRY: Record<Tier, TierMeta> = {
	'coding-run.h1': {
		displayName: 'Coding-Run — H1 (Coding-Linie)',
		description:
			'H1 schlägt pro Absatz Codes vor und reagiert einmal auf H2s Einwände. ' +
			'Code-extraktiv, frictionless, hohe Call-Zahl. H1 SOLL überproduzieren — ' +
			'die Disziplin gegen Over-Coding ist strukturell H2s Konfrontation, nicht ' +
			'H1s Zurückhaltung. Sprach-Lock ist hier kritisch: H1 generiert die ' +
			'sichtbaren Code-Labels, ein Sprachdrift kontaminiert das ganze Projekt.',
		recommended: MIMO,
		fallback: SONNET_OR,
		candidates: [
			{
				...MIMO,
				note: 'Empfehlung: hält den Sprach-Lock (PASSAGE-Sprache → Output-Sprache) zuverlässig. In internen Testläufen lang_match=true, gerund_ratio=1.0, memo_connective=1.0 auf englischer und deutscher Quelle. Reasoning-Klasse, geeignet für die Strauss-Process-Code-Disziplin.'
			},
			{
				...MISTRAL,
				note: 'Günstiger und EU-DSGVO — driftet aber unter Last die Sprache: mit der Sprach-Direktive im Footer defaultete er auf Französisch, mit front-anchored STEP-0-Direktive auf Deutsch. Kein Prompt-Position kuriert den Drift. Nur einsetzen, wenn Sprache pro Projekt fix konfiguriert ist UND eine Drift-Prüfung läuft.'
			},
			{
				...KIMI_MAMMOUTH,
				note: 'Preis-Profil nahe Mistral (~0.45/2.25 USD/MTok), EU-vermittelt über Mammouth. Nicht spezifisch für die Coding-Linie gemessen — Sprach-Lock-Verhalten unverifiziert.'
			},
			{
				...KIMI_OR,
				note: 'OpenRouter-Fallback zur Mammouth-Variante, preisidentisch. Nicht DSGVO-konform (US-Routing).'
			},
			{
				...SONNET_OR,
				note: 'Goldstandard-Referenz, ~3× teurer als MiMo. Für H1 nicht nötig — die Strauss-Disziplin ist eine Prompt-Funktion, nicht Reasoning-Tiefe.'
			}
		]
	},
	'coding-run.h2': {
		displayName: 'Coding-Run — H2 (Comprehension-Linie)',
		description:
			'H2 liest jeden Absatz unabhängig (H1-agnostisch), führt die kumulative ' +
			'Verständnislinie fort und konfrontiert H1s Codes (keep/revise/drop + ' +
			'Code-Memo). H2s Lesart IST das Maß gegen Over-Coding — hier gehört das ' +
			'schärfere Modell hin.',
		recommended: MIMO,
		fallback: SONNET_OR,
		candidates: [
			{
				...MIMO,
				note: 'Empfehlung: Reasoning-Klasse, für synthetische Per-Absatz-Memos validiert — ≈ Sonnet im Inhalt, 3× günstiger. Trägt die konnektive Comprehension und die Konfrontation.'
			},
			{
				...SONNET_OR,
				note: 'Goldstandard-Referenz für reflektierende Per-Absatz-Lesart, 3× teurer als mimo ohne gemessenen Vorteil.'
			},
			{
				...SONNET_MAMMOUTH,
				note: 'Wie Sonnet OR, EU-vermittelt über Mammouth — für DSGVO-Pflicht.'
			},
			{
				...OPUS_OR,
				note: 'Höhere Reasoning-Tiefe für die Konfrontation, ~8× teurer als mimo. Verteidigbare Höher-Tier-Wahl, für die Coding-Linie aber nicht gemessen.'
			},
			{
				...MISTRAL,
				note: 'Günstigste Route, EU-DSGVO. Tragfähig, wenn H1 und H2 dasselbe Modell teilen sollen — H2 verliert dann die Reasoning-Schärfe gegenüber H1.'
			}
		]
	}
};

/**
 * Resolve the model for a tier — user choice from ai-settings.json `tiers`,
 * else the registry recommendation. Called at each dispatch point.
 */
export function resolveTier(tier: Tier): TierModel {
	const settings = loadSettings();
	const choice = settings.tiers?.[tier];
	if (choice && choice.provider && choice.model) {
		return { provider: choice.provider, model: choice.model };
	}
	return TIER_REGISTRY[tier].recommended;
}

/**
 * Eskalations-Ziel für den Tier, wenn der primary tier zweimal leer/
 * unparsebar antwortet. User-Override greift via ai-settings.json
 * `tiers['<tier>.fallback']`, sonst die registry-Default. `null` schaltet
 * die Eskalation ab — Helper gibt nach zwei leeren Versuchen die letzte
 * Antwort durch.
 */
export function resolveFallback(tier: Tier): TierModel | null {
	const settings = loadSettings();
	const overrideKey = `${tier}.fallback` as const;
	// Per-tier override under the same `tiers` map; key is "<tier>.fallback".
	// Explicit user-set null is encoded as an empty model string — that
	// disables the fallback for this tier without touching the registry.
	const choice = settings.tiers?.[overrideKey];
	if (choice) {
		if (!choice.provider || !choice.model) return null;
		return { provider: choice.provider, model: choice.model };
	}
	return TIER_REGISTRY[tier].fallback;
}

export interface DescribedCandidate {
	provider: Provider;
	model: string;
	note: string;
	label: string;
	inputUSDPerMTok: number | null;
	outputUSDPerMTok: number | null;
	region: string;
	dsgvo: boolean;
	isRecommended: boolean;
}

export interface DescribedTier {
	tier: Tier;
	displayName: string;
	description: string;
	resolved: TierModel;
	recommended: TierModel;
	isRecommended: boolean;
	candidates: DescribedCandidate[];
}

/**
 * Tier descriptions with candidates (filtered + tier-specifically annotated),
 * joined to KNOWN_ROUTES master data — the shape a settings UI consumes.
 * Routes missing from KNOWN_ROUTES are skipped (defensive).
 */
export function describeTiers(): DescribedTier[] {
	const settings = loadSettings();
	return (Object.keys(TIER_REGISTRY) as Tier[]).map((tier) => {
		const meta = TIER_REGISTRY[tier];
		const choice = settings.tiers?.[tier];
		const resolved: TierModel =
			choice && choice.provider && choice.model
				? { provider: choice.provider, model: choice.model }
				: meta.recommended;
		const isRecommended =
			resolved.provider === meta.recommended.provider &&
			resolved.model === meta.recommended.model;

		const candidates: DescribedCandidate[] = [];
		for (const c of meta.candidates) {
			const route = KNOWN_ROUTES.find((r) => r.provider === c.provider && r.model === c.model);
			if (!route) continue;
			candidates.push({
				provider: c.provider,
				model: c.model,
				note: c.note,
				label: route.label,
				inputUSDPerMTok: route.inputUSDPerMTok,
				outputUSDPerMTok: route.outputUSDPerMTok,
				region: route.region,
				dsgvo: route.dsgvo,
				isRecommended:
					c.provider === meta.recommended.provider && c.model === meta.recommended.model
			});
		}

		// If the user's choice falls outside the candidate list (a stale
		// setting pointing at a since-dropped route): include it anyway so
		// the picker stays consistent and the choice remains visible.
		const resolvedInList = candidates.some(
			(c) => c.provider === resolved.provider && c.model === resolved.model
		);
		if (!resolvedInList) {
			const route = KNOWN_ROUTES.find(
				(r) => r.provider === resolved.provider && r.model === resolved.model
			);
			if (route) {
				candidates.push({
					provider: resolved.provider,
					model: resolved.model,
					note: 'Aktuelle Wahl liegt außerhalb der für diesen Tier hinterlegten Routen.',
					label: route.label,
					inputUSDPerMTok: route.inputUSDPerMTok,
					outputUSDPerMTok: route.outputUSDPerMTok,
					region: route.region,
					dsgvo: route.dsgvo,
					isRecommended: false
				});
			}
		}

		return {
			tier,
			displayName: meta.displayName,
			description: meta.description,
			resolved,
			recommended: meta.recommended,
			isRecommended,
			candidates
		};
	});
}
