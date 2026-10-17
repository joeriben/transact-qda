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
//        H2's reading is the *measure* against which over-coding is tested.
//        Its independence from H1 lies in separate calls and prompts; in the
//        tests (17.10.2026) a stronger model was barely better here, so both
//        lines run on the same model.
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

import { loadSettings, effectiveRoute, type Provider } from '../client.js';

export type Tier =
	| 'coding-run.h1' // H1 propose + react — code extraction, frictionless, many calls
	| 'coding-run.h2' // H2 read + confront — independent comprehension, the measure
	| 'anker.geschehen' // Was geschieht an dieser Äußerung — einmal je Dokument
	| 'anker.wiedererkennung'; // Ist das derselbe Zug — je Naming über alle Einheiten

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

// OpenRouter-Routen laufen in der Datenregion des Schlüssels (client.ts,
// OpenRouter-Abschnitt): ein EU-beschränkter Schlüssel rechnet in der EU,
// sonst US. Kimi K3 hat keinen EU-Endpunkt; dort rechnet Opus 5.5
// (model-policy.ts). Preise Stand 15.10.2026.
export const KNOWN_ROUTES: RouteOption[] = [
	{ provider: 'openrouter', model: 'z-ai/glm-5.3', label: 'glm-5.3 (OpenRouter)', inputUSDPerMTok: 0.2, outputUSDPerMTok: 4.8, region: 'EU/US je nach Schlüssel', dsgvo: false },
	{ provider: 'openrouter', model: 'moonshotai/kimi-k3', label: 'kimi-k3 (OpenRouter)', inputUSDPerMTok: 0.45, outputUSDPerMTok: 15.0, region: 'US (kein EU-Endpunkt)', dsgvo: false },
	{ provider: 'openrouter', model: 'anthropic/claude-opus-5.5', label: 'claude-opus-5.5 (OpenRouter)', inputUSDPerMTok: 4.0, outputUSDPerMTok: 20.0, region: 'EU/US je nach Schlüssel', dsgvo: false },
	{ provider: 'mistral', model: 'mistral-large-latest', label: 'mistral-large (Mistral nativ EU)', inputUSDPerMTok: 0.5, outputUSDPerMTok: 1.5, region: 'EU', dsgvo: true }
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

// Zuordnung (Setzung 17.10.2026): alle Tiers auf GLM 5.3, Reasoning max
// (model-policy.ts). Kimi K3 war in allen Tests kaum besser. Der Fallback ist
// ebenfalls GLM 5.3 — nach zwei leeren Antworten ein dritter Versuch, keine
// Eskalation auf ein teureres Modell.
const GLM: TierModel = { provider: 'openrouter', model: 'z-ai/glm-5.3' };
const KIMI: TierModel = { provider: 'openrouter', model: 'moonshotai/kimi-k3' };
const OPUS: TierModel = { provider: 'openrouter', model: 'anthropic/claude-opus-5.5' };
const MISTRAL: TierModel = { provider: 'mistral', model: 'mistral-large-latest' };

const KIMI_BARELY_BETTER = 'In allen Tests (Stand 17.10.2026) kaum besser als GLM 5.3, im Output gut dreimal so teuer.';
const KIMI_NOT_IN_EU = 'In der EU nicht verfügbar; unter EU-Schlüssel rechnet Opus 5.5, und der Lauf weist das aus.';
const MISTRAL_NOTE =
	'Native EU-Route ohne OpenRouter. Driftet unter Last die Sprache (Französisch bzw. Deutsch je nach Position der Sprach-Direktive) — nur mit fest konfigurierter Sprache und Drift-Prüfung.';

export const TIER_REGISTRY: Record<Tier, TierMeta> = {
	'coding-run.h1': {
		displayName: 'Coding-Run — H1 (Coding-Linie)',
		description:
			'H1 schlägt pro Absatz Codes vor und reagiert einmal auf H2s Einwände. ' +
			'Code-extraktiv, frictionless, hohe Call-Zahl. H1 SOLL überproduzieren — ' +
			'die Disziplin gegen Over-Coding ist strukturell H2s Konfrontation, nicht ' +
			'H1s Zurückhaltung. Sprach-Lock ist hier kritisch: H1 generiert die ' +
			'sichtbaren Code-Labels, ein Sprachdrift kontaminiert das ganze Projekt.',
		recommended: GLM,
		fallback: GLM,
		candidates: [
			{
				...GLM,
				note: 'Empfehlung: günstig bei hoher Call-Zahl, Reasoning max. Für die Coding-Linie noch nicht gemessen — Sprach-Lock auf deutscher Quelle vor dem ersten Produktivlauf prüfen.'
			},
			{ ...KIMI, note: `${KIMI_BARELY_BETTER} ${KIMI_NOT_IN_EU}` },
			{ ...OPUS, note: 'Höchste Tiefe, Reasoning xhigh; im Input 20-, im Output 4-mal so teuer wie GLM. Für H1 nicht nötig.' },
			{ ...MISTRAL, note: MISTRAL_NOTE }
		]
	},
	'anker.geschehen': {
		displayName: 'Anker-Erweiterung — Geschehen',
		description:
			'Beschreibt je Äußerungseinheit, WAS DORT GESCHIEHT: welcher Akteur ' +
			'gegenüber wem was tut und was das in der Konstellation bewirkt. Sieht ' +
			'KEIN Naming — strukturell erzwungenes Nicht-Wissen, damit die Lesart ' +
			'nicht rückwärts aus einem gesuchten Begriff gebildet wird. Läuft einmal ' +
			'je Dokument und wird für jedes Naming wiederverwendet; entsprechend ' +
			'hohe Call-Zahl bei einmaligen Kosten.',
		recommended: GLM,
		fallback: GLM,
		candidates: [
			{ ...GLM, note: 'Empfehlung: Lesart je Einheit bei hoher Call-Zahl; günstig, Reasoning max.' },
			{ ...KIMI, note: `${KIMI_BARELY_BETTER} ${KIMI_NOT_IN_EU}` },
			{ ...OPUS, note: 'Referenz für die Lesart, Reasoning xhigh. Bei einmaligem Lauf je Dokument vertretbar; nicht gemessen.' },
			{ ...MISTRAL, note: MISTRAL_NOTE }
		]
	},
	'anker.wiedererkennung': {
		displayName: 'Anker-Erweiterung — Wiedererkennung',
		description:
			'Entscheidet je Einheit, ob das dort Geschehene unter das Naming des ' +
			'Forschers fällt. Bekommt Naming, Memo und die Belegstelle des Forschers ' +
			'samt deren Geschehen-Beschreibung. Nein ist die Vorgabe. Diese Stufe ' +
			'trägt die Unterscheidung, die alles entscheidet.',
		recommended: GLM,
		fallback: GLM,
		candidates: [
			{
				...GLM,
				note:
					'Empfehlung. Gemessen am 05.08.2026 am Vorgänger glm-5.2 (3 Namings, 4 eigene Marken, ' +
					'173 Züge): 3/4 Marken als Fall — gleichauf mit den teuersten — für $0.52 statt ' +
					'$2.46–3.88. Die verfehlte Marke war eine Kriteriums-, keine Modellfrage. glm-5.3 selbst ist hier ungemessen.'
			},
			{
				...KIMI,
				note: `${KIMI_BARELY_BETTER} Läuft je Naming über alle Einheiten — die Output-Kosten verdreifachen sich gegenüber GLM. ${KIMI_NOT_IN_EU}`
			},
			{ ...OPUS, note: 'Höchste Tiefe, Reasoning xhigh; im Output 4-mal so teuer wie GLM, ungemessen.' }
		]
	},
	'coding-run.h2': {
		displayName: 'Coding-Run — H2 (Comprehension-Linie)',
		description:
			'H2 liest jeden Absatz unabhängig (H1-agnostisch), führt die kumulative ' +
			'Verständnislinie fort und konfrontiert H1s Codes (keep/revise/drop + ' +
			'Code-Memo). H2s Lesart IST das Maß gegen Over-Coding. Derselbe Tier ' +
			'trägt die CName-Forensik und die komparative Dimensionalisierung.',
		recommended: GLM,
		fallback: GLM,
		candidates: [
			{ ...GLM, note: 'Empfehlung, Reasoning max. H1 und H2 rechnen damit auf demselben Modell; ihre Unabhängigkeit liegt in getrennten Aufrufen und Prompts.' },
			{ ...KIMI, note: `${KIMI_BARELY_BETTER} ${KIMI_NOT_IN_EU}` },
			{ ...OPUS, note: 'Reasoning xhigh (nicht höher). Teuerste Route, ungemessen.' },
			{ ...MISTRAL, note: MISTRAL_NOTE }
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

/**
 * Wie resolveTier/resolveFallback, aber mit regionalem Ersatz aufgelöst:
 * das Modell, das unter dem aktuellen Schlüssel tatsächlich rechnet. Am
 * Laufstart aufrufen, wo das Modell in Ergebnis und Protokoll eingeht.
 */
export async function resolveTierRoute(tier: Tier): Promise<TierModel> {
	return effectiveRoute(resolveTier(tier));
}

export async function resolveFallbackRoute(tier: Tier): Promise<TierModel | null> {
	const fallback = resolveFallback(tier);
	return fallback ? effectiveRoute(fallback) : null;
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
