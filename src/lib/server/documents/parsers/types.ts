/**
 * Document element types and parser interfaces.
 * Elements form a directed graph (hierarchy via parent_id, cross-refs via refs).
 */

export interface ParsedElement {
	type: string;           // 'paragraph', 'sentence', 'heading', 'turn', ...
	content: string | null; // text content for leaf nodes; null for containers
	charStart: number;
	charEnd: number;
	properties?: Record<string, unknown>;
	children?: ParsedElement[];
	refs?: ElementRef[];
}

export interface ElementRef {
	/** Index into the flat list of all elements (resolved to UUID at store time) */
	toIndex: number;
	refType: string;        // 'overlap_at', 'cross_ref', ...
	properties?: Record<string, unknown>;
}

export interface ParseResult {
	elements: ParsedElement[]; // top-level elements (forest of trees)
	format: string;            // 'plain-text', 'transcript-tiq', 'academic', ...
}
