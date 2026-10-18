// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reasoning-Stärke und regionaler Ersatz — eine Setzung an einer Stelle.
//
// Reasoning-Stärke (Stand 15.10.2026): Für die Interpretationsarbeit ist die
// Denktiefe maßgeblich, nicht nur die Modellwahl. Ohne Angabe gilt der
// Default des Anbieters, und der ist weder stabil noch einheitlich — bei
// Claude Opus 5.5 ist er `medium`, bei GLM 5.3 `max`. Deshalb steht die
// Stufe hier ausdrücklich, je Modellfamilie:
//
//   GLM, Kimi — `max`. Beide kennen nur low/high/max; ein `xhigh` nimmt
//               OpenRouter an und stuft es stillschweigend herab.
//   Claude Opus 5.x — `xhigh`, nicht höher (Setzung des Forschers). Ältere
//               Opus-Generationen kennen `xhigh` nicht und bleiben beim Default.
//
// Modelle, die hier nicht stehen, laufen mit ihrem Default. Ein Aufruf kann
// die Stufe ausdrücklich überschreiben (modelOverride.effort), etwa für einen
// Modellvergleich; sonst gilt diese Tabelle.
//
// Anbieterwahl bei OpenRouter (Setzung 18.10.2026): Dasselbe Modell wird
// dort oft von mehreren Anbietern bedient, zu sehr verschiedenen Preisen —
// GLM 5.3 in der EU von Inceptron für 0,55/1,51 $ und von Mistral für
// 1,54/4,84 $ je Million Tokens (Eingabe/Ausgabe). Ohne Angabe verteilt
// OpenRouter die Aufrufe nach Preis gewichtet, schickt also auch einen Teil
// zum teureren. Mit `sort: price` geht jeder Aufruf zuerst an den
// günstigsten Anbieter, der gerade bedient; die teureren bleiben Ausweichweg,
// wenn er ausfällt. Die Reihenfolge folgt den jeweils aktuellen Preisen, nicht
// einer festen Anbieterliste.
//
// Regionaler Ersatz: Ein Schlüssel, dessen Workspace per Guardrail auf eine
// Datenregion beschränkt ist, erreicht dort nicht jedes Modell — Kimi K3 hat
// in der EU keinen Endpunkt. Steht ein Modell hier, wird es in diesem Fall
// durch das genannte ersetzt; die Ersetzung wird beim Laufstart festgestellt,
// damit der Lauf das Modell ausweist, das tatsächlich gerechnet hat.

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const EFFORT_BY_MODEL: { match: RegExp; effort: ReasoningEffort }[] = [
	{ match: /glm-/i, effort: 'max' },
	{ match: /kimi-k/i, effort: 'max' },
	{ match: /claude-opus-5/i, effort: 'xhigh' }
];

/** Reasoning-Stärke für ein Modell nach der Tabelle oben; undefined = Default des Anbieters. */
export function reasoningEffortFor(model: string): ReasoningEffort | undefined {
	return EFFORT_BY_MODEL.find((e) => e.match.test(model))?.effort;
}

/** Zusätzliche Body-Felder jedes OpenRouter-Aufrufs: Anbieterwahl und Reasoning-Stärke. */
export function openRouterRequestParams(effort: ReasoningEffort | undefined): Record<string, unknown> {
	return {
		provider: { sort: 'price' },
		...(effort ? { reasoning: { effort } } : {})
	};
}

/** OpenRouter-Modell → Ersatz, wenn es in der Datenregion des Schlüssels nicht bedient wird. */
export const REGION_SUBSTITUTES: Record<string, string> = {
	'moonshotai/kimi-k3': 'anthropic/claude-opus-5.5'
};
