/**
 * Coding Companion — LLM Comparator
 *
 * Receives material assembled by the retrieval layer and performs
 * multi-level comparison: semantic, structural, pragmatic, analytical.
 * The LLM processes all material simultaneously — it does not read
 * sequentially like a human.
 *
 * Output is a comparison result, NOT code suggestions. The researcher
 * (or Autonoma) makes the coding decision.
 */

import { chat } from '../client.js';
import { logInteraction } from '../index.js';
import type { RetrievalResult } from './retrieval.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PassageComparison {
	codeId: string;
	codeLabel: string;
	designation: string;
	/** What connects/distinguishes the current passage and this code's groundings */
	analysis: string;
}

export interface ComparisonResult {
	comparisons: PassageComparison[];
	/** Open questions for the researcher — not suggestions */
	questions: string[];
	/** Token usage for cost tracking */
	tokensUsed: number;
}

// ── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a comparison engine for qualitative data analysis (Grounded Theory / Situational Analysis). Your ONLY task is to compare a passage with existing codes and their grounded passages.

Compare on multiple levels simultaneously:
- **Semantic**: What is the passage about? Topic, vocabulary, concepts.
- **Structural**: What rhetorical structure does it have? Argumentation, narration, justification, deflection.
- **Pragmatic**: What discursive function does it serve? Legitimization, problematization, face-saving, positioning.
- **Analytical**: What phenomenon does it exhibit — even across topical boundaries? Two passages about different topics can show the same phenomenon.

Rules:
- Compare, do not suggest codes. The researcher decides.
- Be concise. Each comparison: 2-3 sentences maximum.
- Formulate open questions, not leading questions.
- If the passage does not relate to any existing code, say so clearly.
- Match the language of the passage in your output.

Output format (JSON):
{
  "comparisons": [
    {
      "codeId": "uuid",
      "codeLabel": "label",
      "analysis": "What connects or distinguishes this passage and the existing groundings of this code."
    }
  ],
  "questions": ["Open question 1", "Open question 2"]
}

Return ONLY the JSON object, no markdown fences, no commentary.`;

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Compare a passage with retrieved material using the LLM.
 * The LLM receives the passage + existing codes with their groundings
 * and performs multi-level comparison.
 */
export async function comparePassage(
	retrieval: RetrievalResult,
	projectId: string,
	options?: { language?: string; maxTokens?: number }
): Promise<ComparisonResult> {
	const maxTokens = options?.maxTokens ?? 2048;

	// Build the user message with all comparison material
	const userMessage = formatRetrievalForLLM(retrieval, options?.language);

	const response = await chat({
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: userMessage }],
		maxTokens
	});

	// Log for usage tracking
	await logInteraction(
		projectId,
		'coding-companion',
		response.model,
		{ passageElementId: retrieval.passage.elementId, passageLength: retrieval.passage.content.length },
		{ comparisonsCount: 0, questionsCount: 0 },
		response.tokensUsed,
		response.provider,
		response.inputTokens,
		response.outputTokens
	);

	// Parse structured response
	try {
		const parsed = JSON.parse(response.text.trim());
		const comparisons: PassageComparison[] = (parsed.comparisons || []).map((c: any) => ({
			codeId: c.codeId || '',
			codeLabel: c.codeLabel || '',
			designation: retrieval.existingCodes.find(ec => ec.id === c.codeId)?.designation || 'cue',
			analysis: c.analysis || ''
		}));
		const questions: string[] = parsed.questions || [];

		return { comparisons, questions, tokensUsed: response.tokensUsed };
	} catch {
		// If JSON parsing fails, return the raw text as a single question
		return {
			comparisons: [],
			questions: [response.text.trim()],
			tokensUsed: response.tokensUsed
		};
	}
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatRetrievalForLLM(retrieval: RetrievalResult, language?: string): string {
	const parts: string[] = [];

	if (language && language !== 'auto') {
		parts.push(`Output language: ${language}\n`);
	}

	// The passage being coded
	parts.push(`## Passage to compare\n`);
	parts.push(`Document: ${retrieval.passage.documentTitle}`);
	parts.push(`Text: "${retrieval.passage.content}"\n`);

	// Existing codes with their groundings
	if (retrieval.existingCodes.length > 0) {
		parts.push(`## Existing codes with grounded passages\n`);
		for (const code of retrieval.existingCodes) {
			parts.push(`### ${code.label} [${code.designation}] (${code.groundingCount} groundings)`);
			for (const g of code.sampleGroundings) {
				parts.push(`  - "${g.text}" (${g.documentTitle})`);
			}
			parts.push(`  Code ID: ${code.id}\n`);
		}
	} else {
		parts.push(`## No existing codes yet\n`);
		parts.push(`This is the first passage being coded. No comparison material available.`);
	}

	// Topically similar passages (for additional context)
	const codedSimilar = retrieval.similarPassages.filter(sp => sp.codes.length > 0);
	if (codedSimilar.length > 0) {
		parts.push(`## Topically related passages (embedding-based retrieval)\n`);
		parts.push(`Note: These are passages with similar vocabulary/topic. Analytical similarity may differ.\n`);
		for (const sp of codedSimilar.slice(0, 5)) {
			const codeLabels = sp.codes.map(c => `${c.label} [${c.designation}]`).join(', ');
			parts.push(`- "${sp.content}" (${sp.documentTitle}) — coded as: ${codeLabels}`);
		}
	}

	return parts.join('\n');
}
