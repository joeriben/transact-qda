// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Memo-Inhalt ist Text. Jeder Pfad, der Memos anlegt (Map, Naming, Dokument,
// KI-Läufe), schreibt Klartext mit Zeilenumbrüchen. Nur der frühere
// contenteditable-Editor hat HTML abgelegt (`<div>`, `<br>`, `&nbsp;`). Diese
// Funktion macht aus beidem denselben Klartext — auf dem Server wie im Browser,
// deshalb Regex statt DOMParser. Angezeigt wird das Ergebnis immer als Text,
// nie per {@html}: Memos stammen auch von KollegInnen und KI-Läufen.

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
		if (code[0] === '#') {
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) ? String.fromCodePoint(n) : m;
		}
		return ENTITIES[code.toLowerCase()] ?? m;
	});
}

export function memoText(content: string | null | undefined): string {
	if (!content) return '';
	if (!/<\/?[a-z][^>]*>/i.test(content)) return content;
	const text = content
		// Leerzeile des Editors: <div><br></div>
		.replace(/<div[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<(div|li|h[1-6])[^>]*>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '');
	return decodeEntities(text)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
