// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Coding Companion — LLM Comparator
 *
 * Receives material assembled by the retrieval layer and compares the
 * marked passage with the researcher's own namings on several levels at
 * once: semantic, structural, pragmatic, analytic. The LLM processes all
 * material simultaneously — it does not read sequentially like a human.
 *
 * Unter der Verfassung der KI-Schicht (docs/design-begleiten.md):
 * - Nachbarschaft zeigen, nie Zugehörigkeit behaupten (Satz I).
 * - Jeder Vergleich trägt die Verankerungen, auf die er sich stützt, im
 *   Wortlaut; einer ohne gültigen Beleg wird verworfen (Satz II).
 * - Ein leeres Ergebnis ist zulässig; keine Fragen an den Forscher, kein
 *   Gesprächsfaden (Satz III).
 * Nichts davon schreibt in den Datenraum. Ob aus einem Vergleich eine
 * Verankerung oder ein Memo wird, entscheidet ein Akt des Forschers.
 */

import { chat } from '../client.js';
import { logInteraction } from '../index.js';
import type { RetrievalResult } from './retrieval.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PassageComparison {
	namingId: string;
	namingLabel: string;
	designation: string;
	/** What connects and what distinguishes the passage and this naming's anchors */
	analysis: string;
	/** The anchors of this naming the comparison rests on — wording, not a pointer */
	anchors: Array<{ text: string; documentTitle: string }>;
}

export interface ComparisonResult {
	comparisons: PassageComparison[];
	/** How many namings the model compared against — makes an empty result readable */
	comparedWith: number;
	/** Comparisons dropped because they cited no valid anchor */
	droppedUnanchored: number;
	/** Token usage for cost tracking */
	tokensUsed: number;
}

// ── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `„Du bist ein Freund des Materials — Du bist ein Freund der/s codierenden Forscher_in — achte darauf, dass F gut und angemessen mit M umgeht; unterstütze F in dem, was es artikulierend vollzieht, und M in dem, was es (nicht) zeigt."

(F = the researcher, M = the material.)

The researcher has marked a passage. You compare it with the researcher's own namings — the analytic categories they have anchored in the material — and with the passages those namings are anchored in. You do not name, and you do not decide.

Compare on several levels at once:
- Semantic: what the passage is about — topic, vocabulary, concepts.
- Structural: its rhetorical shape — argument, narration, justification, deflection.
- Pragmatic: the discursive work it does — legitimising, problematising, face-saving, positioning.
- Analytic: the phenomenon it exhibits, also across topical boundaries. Two passages about different topics can show related moves.

Rules:
- Show neighbourhood and difference. Never state that the passage is an instance of a naming or belongs under it, and never claim sameness — not of passages, moves or phenomena. Whether it is the same, is the researcher's cut.
- Every comparison rests on specific anchored passages of that naming. Cite them by their numbers in the "anchors" field. Leave out any comparison you cannot rest on a cited passage.
- In the analysis text, refer to an anchored passage by what it says, never by its number: the researcher sees the quoted passages, not the numbers.
- Speak only where there is something non-trivial to see. Most namings will not be worth a comparison; include only those that are. An empty list is a valid and expected answer.
- No questions to the researcher, no suggestions for new namings, no advice on what to do next.
- At most 2–3 sentences per comparison.
- Write in the language of the passage.

Output: a single JSON object, no Markdown fences, no commentary:
{"comparisons": [{"namingId": "<id as given>", "anchors": [1, 3], "analysis": "..."}]}`;

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Compare a passage with the researcher's namings using the LLM. Without
 * namings to compare against, no call is made.
 */
export async function comparePassage(
	retrieval: RetrievalResult,
	projectId: string,
	options?: { language?: string }
): Promise<ComparisonResult> {
	const comparedWith = retrieval.existingCodes.length;
	if (comparedWith === 0) {
		return { comparisons: [], comparedWith, droppedUnanchored: 0, tokensUsed: 0 };
	}

	// Keine Ausgabebegrenzung: die Kürze steht als weiche Vorgabe im
	// SYSTEM_PROMPT ("2–3 sentences" je Vergleich).
	const response = await chat({
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: formatRetrievalForLLM(retrieval, options?.language) }],
		responseFormat: 'json'
	});

	let raw: any[] | null = null;
	try {
		const parsed = JSON.parse(extractJsonObject(response.text));
		if (Array.isArray(parsed?.comparisons)) raw = parsed.comparisons;
	} catch {
		// raw bleibt null — wird unten nach der Buchung gemeldet
	}

	const comparisons: PassageComparison[] = [];
	let droppedUnanchored = 0;
	for (const c of raw ?? []) {
		// Nur Namings, die dem Modell vorlagen — eine erfundene ID darf
		// keinen Klick zum Verankern bekommen.
		const naming = retrieval.existingCodes.find((ec) => ec.id === c?.namingId);
		const analysis = typeof c?.analysis === 'string' ? c.analysis.trim() : '';
		if (!naming || !analysis) continue;
		type Grounding = (typeof naming.sampleGroundings)[number];
		const numbers: unknown[] = Array.isArray(c.anchors) ? c.anchors : [];
		const cited = numbers
			.map((n) => naming.sampleGroundings[Number(n) - 1])
			.filter((g): g is Grounding => !!g);
		const anchors = [...new Set(cited)].map((g) => ({ text: g.text, documentTitle: g.documentTitle }));
		if (anchors.length === 0) {
			droppedUnanchored++;
			continue;
		}
		comparisons.push({
			namingId: naming.id,
			namingLabel: naming.label,
			designation: naming.designation,
			analysis,
			anchors
		});
	}

	await logInteraction(
		projectId,
		'coding-companion',
		response.model,
		{ passageLength: retrieval.passage.content.length, comparedWith },
		{ parsed: raw !== null, comparisonsCount: comparisons.length, droppedUnanchored },
		response.tokensUsed,
		response.provider,
		response.inputTokens,
		response.outputTokens
	);

	if (raw === null) {
		throw new Error('Die Antwort des Modells war nicht auswertbar.');
	}
	return { comparisons, comparedWith, droppedUnanchored, tokensUsed: response.tokensUsed };
}

/** Tolerates Markdown fences or a preamble around the JSON object. */
function extractJsonObject(text: string): string {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatRetrievalForLLM(retrieval: RetrievalResult, language?: string): string {
	const parts: string[] = [];

	if (language && language !== 'auto') {
		parts.push(`Output language: ${language}\n`);
	}

	parts.push(`## Marked passage\n`);
	parts.push(`Document: ${retrieval.passage.documentTitle}`);
	parts.push(`"${retrieval.passage.content}"\n`);

	parts.push(`## The researcher's namings and their anchored passages\n`);
	for (const naming of retrieval.existingCodes) {
		parts.push(`### ${naming.label} [${naming.designation}] — namingId: ${naming.id}, anchored ${naming.groundingCount}×`);
		naming.sampleGroundings.forEach((g, i) => {
			parts.push(`[${i + 1}] "${g.text}" (${g.documentTitle})`);
		});
		parts.push('');
	}

	// Embedding-Nachbarn mit eigenen Namings: Zugang ins Material, nicht
	// Befund — sie liegen nah im Vokabular oder Register.
	const nearby = retrieval.similarPassages
		.map((sp) => ({ ...sp, own: sp.codes.filter((c) => c.own) }))
		.filter((sp) => sp.own.length > 0);
	if (nearby.length > 0) {
		parts.push(`## Further passages near the marked one\n`);
		parts.push(`Near in vocabulary or register (embedding neighbourhood), not necessarily the same phenomenon. For context only — do not cite them.\n`);
		for (const sp of nearby.slice(0, 5)) {
			const labels = sp.own.map((c) => `${c.label} [${c.designation}]`).join(', ');
			parts.push(`- "${sp.content}" (${sp.documentTitle}) — the researcher anchored here: ${labels}`);
		}
	}

	return parts.join('\n');
}
