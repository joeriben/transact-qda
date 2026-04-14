// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ParsedElement, ParseResult } from './types.js';

/**
 * Plain-text parser: splits text into paragraphs and sentences.
 *
 * Structure: paragraph → sentence (two levels).
 * Single-sentence paragraphs produce one sentence child (no special case —
 * consistent tree depth simplifies downstream code).
 */

// Sentence boundary: punctuation followed by whitespace and uppercase letter, or end of string.
// Handles: ". ", "? ", "! ", ".) ", '." ' etc.
const SENTENCE_BOUNDARY = /([.?!][)\]"'»]*)\s+(?=[A-ZÄÖÜ])/g;

function splitSentences(text: string, baseOffset: number): ParsedElement[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	// Find split points
	const parts: { text: string; start: number; end: number }[] = [];
	let lastEnd = 0;

	// Reset regex state
	SENTENCE_BOUNDARY.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = SENTENCE_BOUNDARY.exec(trimmed)) !== null) {
		const splitAt = match.index + match[1].length;
		const part = trimmed.slice(lastEnd, splitAt).trim();
		if (part) {
			const start = trimmed.indexOf(part, lastEnd);
			parts.push({ text: part, start, end: start + part.length });
		}
		lastEnd = splitAt;
		// Skip whitespace after split point
		while (lastEnd < trimmed.length && /\s/.test(trimmed[lastEnd])) lastEnd++;
	}

	// Remaining text after last split
	const remaining = trimmed.slice(lastEnd).trim();
	if (remaining) {
		const start = trimmed.indexOf(remaining, lastEnd);
		parts.push({ text: remaining, start, end: start + remaining.length });
	}

	// If no splits found, whole text is one sentence
	if (parts.length === 0) {
		parts.push({ text: trimmed, start: 0, end: trimmed.length });
	}

	// Map back to original full_text offsets
	const textStart = text.indexOf(trimmed);
	return parts.map((p, i) => ({
		type: 'sentence',
		content: p.text,
		charStart: baseOffset + textStart + p.start,
		charEnd: baseOffset + textStart + p.end,
		properties: {}
	}));
}

export function parsePlainText(text: string): ParseResult {
	const elements: ParsedElement[] = [];

	// Split at blank lines (one or more empty lines)
	const paragraphPattern = /\n\s*\n/g;
	let lastEnd = 0;
	let match: RegExpExecArray | null;
	const rawParagraphs: { text: string; start: number; end: number }[] = [];

	while ((match = paragraphPattern.exec(text)) !== null) {
		const chunk = text.slice(lastEnd, match.index);
		if (chunk.trim()) {
			rawParagraphs.push({ text: chunk, start: lastEnd, end: match.index });
		}
		lastEnd = match.index + match[0].length;
	}

	// Last paragraph (after final blank line or entire text if no blank lines)
	const lastChunk = text.slice(lastEnd);
	if (lastChunk.trim()) {
		rawParagraphs.push({ text: lastChunk, start: lastEnd, end: text.length });
	}

	for (const para of rawParagraphs) {
		const sentences = splitSentences(para.text, para.start);

		elements.push({
			type: 'paragraph',
			content: null,
			charStart: para.start,
			charEnd: para.end,
			children: sentences
		});
	}

	return { elements, format: 'plain-text' };
}
