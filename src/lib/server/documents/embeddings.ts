/**
 * Embedding client: generates sentence embeddings via Ollama.
 * Uses nomic-embed-text (768 dims) by default.
 * Designed for batch processing — one HTTP call per sentence.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const EMBED_DIMS = 768;

export { EMBED_DIMS };

interface OllamaEmbeddingResponse {
	embedding: number[];
}

/**
 * Generate embedding for a single text string.
 */
export async function embed(text: string): Promise<number[]> {
	const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
	});

	if (!res.ok) {
		throw new Error(`Embedding failed (${res.status}): ${await res.text()}`);
	}

	const data: OllamaEmbeddingResponse = await res.json();
	return data.embedding;
}

/**
 * Generate embeddings for multiple texts. Processes sequentially
 * (Ollama doesn't support batch embedding in a single call).
 * Returns array of vectors in same order as input.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
	const results: number[][] = [];
	for (const text of texts) {
		results.push(await embed(text));
	}
	return results;
}

/**
 * Format a vector as PostgreSQL pgvector literal: '[0.1,0.2,...]'
 */
export function toPgVector(vec: number[]): string {
	return `[${vec.join(',')}]`;
}
