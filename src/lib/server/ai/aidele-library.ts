// Aidele reference library: CRUD, text extraction, chunking, and retrieval.
// Installation-wide methodological reference texts for the didactic AI persona.

import { query, queryOne } from '../db/index.js';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LIBRARY_DIR = join(process.cwd(), 'aidele-library');
const TARGET_CHUNK_WORDS = 600;
const MAX_CHUNK_WORDS = 1000;

// Ensure library directory exists
function ensureDir() {
	if (!existsSync(LIBRARY_DIR)) mkdirSync(LIBRARY_DIR, { recursive: true });
}

// ── CRUD ─────────────────────────────────────────────────────────

export async function listReferences() {
	return (await query(
		`SELECT r.*,
		   (SELECT COUNT(*) FROM aidele_chunks c WHERE c.reference_id = r.id) as chunk_count,
		   (SELECT COALESCE(SUM(c.word_count), 0) FROM aidele_chunks c WHERE c.reference_id = r.id) as total_words
		 FROM aidele_references r
		 ORDER BY r.created_at DESC`
	)).rows;
}

export async function getReference(id: string) {
	return queryOne(
		`SELECT r.*,
		   (SELECT COUNT(*) FROM aidele_chunks c WHERE c.reference_id = r.id) as chunk_count,
		   (SELECT COALESCE(SUM(c.word_count), 0) FROM aidele_chunks c WHERE c.reference_id = r.id) as total_words
		 FROM aidele_references r WHERE r.id = $1`,
		[id]
	);
}

export async function getReferenceChunks(referenceId: string) {
	return (await query(
		`SELECT id, section, content, chunk_index, word_count
		 FROM aidele_chunks WHERE reference_id = $1
		 ORDER BY chunk_index`,
		[referenceId]
	)).rows;
}

export async function deleteReference(id: string) {
	// Get filename to delete from disk
	const ref = await queryOne<{ filename: string | null }>('SELECT filename FROM aidele_references WHERE id = $1', [id]);
	if (ref?.filename) {
		const path = join(LIBRARY_DIR, ref.filename);
		if (existsSync(path)) unlinkSync(path);
	}
	// Chunks cascade-deleted via FK
	await query('DELETE FROM aidele_references WHERE id = $1', [id]);
}

// ── Upload + Processing ──────────────────────────────────────────

export async function addReference(opts: {
	title: string;
	author?: string;
	description?: string;
	content: string;       // raw text content (already extracted if PDF)
	filename?: string;
	format: 'pdf' | 'text' | 'markdown';
	fileBuffer?: Buffer;   // original file to store on disk
	userId?: string;
}): Promise<string> {
	ensureDir();

	// Store original file on disk if provided
	let storedFilename: string | null = null;
	if (opts.fileBuffer && opts.filename) {
		// Sanitize filename, add timestamp prefix for uniqueness
		const safe = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
		storedFilename = `${Date.now()}-${safe}`;
		writeFileSync(join(LIBRARY_DIR, storedFilename), opts.fileBuffer);
	}

	// Create reference record
	const ref = await queryOne<{ id: string }>(
		`INSERT INTO aidele_references (title, author, description, filename, format, uploaded_by)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		[opts.title, opts.author || null, opts.description || null, storedFilename, opts.format, opts.userId || null]
	);
	const refId = ref!.id;

	// Chunk the text and insert
	const chunks = chunkText(opts.content);
	for (let i = 0; i < chunks.length; i++) {
		const c = chunks[i];
		await query(
			`INSERT INTO aidele_chunks (reference_id, section, content, chunk_index, word_count)
			 VALUES ($1, $2, $3, $4, $5)`,
			[refId, c.section || null, c.content, i, c.wordCount]
		);
	}

	return refId;
}

// ── Text extraction ──────────────────────────────────────────────

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
	const { PDFParse } = await import('pdf-parse');
	const parser = new PDFParse({ data: new Uint8Array(buffer) });
	const result = await parser.getText();
	return result.text;
}

// ── Chunking ─────────────────────────────────────────────────────

interface Chunk {
	section: string | null;
	content: string;
	wordCount: number;
}

function chunkText(text: string): Chunk[] {
	// Split by heading patterns (markdown ## or lines that look like section headers)
	const sections = splitBySections(text);

	const chunks: Chunk[] = [];
	for (const sec of sections) {
		// If section is small enough, keep as one chunk
		const words = countWords(sec.content);
		if (words <= MAX_CHUNK_WORDS) {
			if (sec.content.trim()) {
				chunks.push({ section: sec.heading, content: sec.content.trim(), wordCount: words });
			}
		} else {
			// Split large sections by paragraphs into target-sized chunks
			const subChunks = splitByParagraphs(sec.content, sec.heading);
			chunks.push(...subChunks);
		}
	}

	return chunks;
}

function splitBySections(text: string): Array<{ heading: string | null; content: string }> {
	// Match markdown headings (## ...) or all-caps lines followed by blank line
	const lines = text.split('\n');
	const sections: Array<{ heading: string | null; content: string }> = [];
	let currentHeading: string | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		const headingMatch = line.match(/^#{1,4}\s+(.+)/);
		const capsHeading = line.match(/^[A-ZÄÖÜ][A-ZÄÖÜ\s:.\-]{10,}$/);

		if (headingMatch || capsHeading) {
			// Flush previous section
			if (currentLines.length > 0) {
				sections.push({ heading: currentHeading, content: currentLines.join('\n') });
			}
			currentHeading = headingMatch ? headingMatch[1].trim() : line.trim();
			currentLines = [];
		} else {
			currentLines.push(line);
		}
	}

	// Flush last section
	if (currentLines.length > 0 || sections.length === 0) {
		sections.push({ heading: currentHeading, content: currentLines.join('\n') });
	}

	return sections;
}

function splitByParagraphs(text: string, sectionHeading: string | null): Chunk[] {
	const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
	const chunks: Chunk[] = [];
	let currentChunk: string[] = [];
	let currentWords = 0;

	for (const para of paragraphs) {
		const paraWords = countWords(para);
		if (currentWords + paraWords > TARGET_CHUNK_WORDS && currentChunk.length > 0) {
			// Flush current chunk
			const content = currentChunk.join('\n\n').trim();
			chunks.push({ section: sectionHeading, content, wordCount: currentWords });
			currentChunk = [];
			currentWords = 0;
		}
		currentChunk.push(para.trim());
		currentWords += paraWords;
	}

	// Flush remainder
	if (currentChunk.length > 0) {
		const content = currentChunk.join('\n\n').trim();
		chunks.push({ section: sectionHeading, content, wordCount: currentWords });
	}

	return chunks;
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

// ── Retrieval (full-text search) ─────────────────────────────────

export async function searchChunks(queryText: string, limit: number = 5) {
	// Build tsquery from user's words (OR-connected for broad matching)
	const words = queryText
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(w => w.length > 2)
		.slice(0, 15); // limit query terms

	if (words.length === 0) return [];

	const tsquery = words.map(w => `${w}:*`).join(' | ');

	return (await query(
		`SELECT r.title as reference_title, r.author as reference_author,
		        c.section, c.content,
		        ts_rank(c.tsv, to_tsquery('simple', $1)) as rank
		 FROM aidele_chunks c
		 JOIN aidele_references r ON r.id = c.reference_id
		 WHERE c.tsv @@ to_tsquery('simple', $1)
		 ORDER BY rank DESC
		 LIMIT $2`,
		[tsquery, limit]
	)).rows;
}
