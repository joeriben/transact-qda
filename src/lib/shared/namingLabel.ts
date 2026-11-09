// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wie ein Naming in Listen, Bannern und Memo-Titeln heißt. Eine Relation ohne
// eigene Inschrift heißt nach ihren Endpunkten: „Quelle —valenz→ Ziel".

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Eine Inschrift, wie eine Forscherin sie schreibt: nicht leer, keine technische ID. */
export function hasOwnInscription(text: string | null | undefined): boolean {
	return !!text?.trim() && !UUID_RE.test(text);
}

export type RelationEnds = {
	source: string | null | undefined;
	target: string | null | undefined;
	valence: string | null | undefined;
	/** Beide Richtungsangaben gesetzt; sonst symmetrisch. */
	directed: boolean;
};

export function relationLabel(r: RelationEnds): string {
	const s = r.source?.trim() || '?';
	const t = r.target?.trim() || '?';
	const v = r.valence?.trim();
	if (v) return r.directed ? `${s} —${v}→ ${t}` : `${s} —${v}— ${t}`;
	return r.directed ? `${s} → ${t}` : `${s} ↔ ${t}`;
}

export function namingLabel(
	inscription: string | null | undefined,
	relation?: RelationEnds | null
): string {
	const own = inscription?.trim() ?? '';
	if (hasOwnInscription(own)) return own;
	if (relation && (relation.source || relation.target)) return relationLabel(relation);
	return own || '(unnamed)';
}

/**
 * In Anführungszeichen — außer die Inschrift bringt selbst welche mit (sonst
 * „KI-Chatbot „SchulBot““). Englische Zeichen für die englische Oberfläche,
 * deutsche für die deutschen Texte (Dokumentansicht, KI-Bewertung).
 */
export function quoted(text: string, lang: 'en' | 'de' = 'en'): string {
	if (/["„“”«»‚‘‹›]/.test(text)) return text;
	return lang === 'de' ? `„${text}“` : `“${text}”`;
}
