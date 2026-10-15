// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rückweg — Karte ↔ Naming-Liste ↔ Dokument.
//
// Die drei Ansichten zeigen dasselbe Naming: situiert (Karte), vollständig
// bearbeitbar (Liste), verankert (Dokument). Wer zwischen ihnen springt,
// wechselt nicht den Gegenstand, sondern die Sicht auf ihn. Deshalb steht
// beides — welches Naming, und woher — in der URL und nirgends sonst:
//
//   focus=<namingId>   welches Naming diese Ansicht aufschlägt
//   passage=<annId>    welche Verankerung im Dokument (nur Dokumentansicht)
//   from=<pfad>        die Ansicht, aus der man kam
//
// `from` trägt nur den Pfad. Der Rückweg hängt `focus` von selbst wieder an;
// dadurch landet man nicht auf der Karte, sondern auf derselben Stelle der
// Karte. Ein Zurück, das die Seite wiederfindet, aber nicht die Stelle, ist
// keines — und genau daran scheitert der Zurück-Knopf des Browsers hier: die
// Karte rahmt sich beim Betreten neu auf ihren Inhalt, man steht wieder vor
// dem Ganzen und sucht seine Karte erneut.
//
// URL statt sessionStorage, weil der Rückweg dann Neuladen, zweiten Tab und
// Weitergabe an KollegInnen übersteht — und weil er sichtbar ist statt
// verborgener Zustand zu sein.

export interface RueckwegParams {
	/** Naming, auf das die Zielansicht aufschlagen soll. */
	focus?: string | null;
	/** Verankerung, auf die die Dokumentansicht springen soll. */
	passage?: string | null;
	/** Pfad der Ansicht, aus der gesprungen wird — ohne Query. */
	from?: string | null;
}

/** Baut einen Sprung in eine andere Ansicht desselben Namings. */
export function viewHref(path: string, params: RueckwegParams = {}): string {
	const q = new URLSearchParams();
	if (params.focus) q.set('focus', params.focus);
	if (params.passage) q.set('passage', params.passage);
	if (params.from) q.set('from', params.from.split('?')[0]);
	const s = q.toString();
	return s ? `${path}?${s}` : path;
}

/**
 * Der Rückweg aus der aktuellen URL, oder null, wenn man nirgendwoher kam.
 * Der aktuelle `focus` reist mit zurück — sonst landet man auf der Seite,
 * aber nicht bei dem Naming, wegen dem man gegangen war.
 */
export function rueckwegHref(url: URL): string | null {
	const from = url.searchParams.get('from');
	// Nur app-interne Pfade. `//` wäre protokollrelativ und damit auswärts.
	if (!from || !from.startsWith('/') || from.startsWith('//')) return null;
	const focus = url.searchParams.get('focus');
	return focus ? `${from}?focus=${encodeURIComponent(focus)}` : from;
}

/**
 * Anzeigename der Ansicht hinter einem Pfad, aufgelöst aus den Layout-Daten
 * (`mapsByType`, `documents`). Der Rückweg soll sagen, wohin er führt —
 * „← Feldzugang" statt „← zurück".
 */
export function rueckwegLabel(path: string, data: any): string {
	const clean = path.split('?')[0];

	const mapMatch = clean.match(/\/maps\/([^/]+)$/);
	if (mapMatch) {
		for (const list of Object.values(data?.mapsByType ?? {}) as any[]) {
			const hit = list?.find((m: any) => m.id === mapMatch[1]);
			if (hit) return hit.label;
		}
		return 'Karte';
	}

	const docMatch = clean.match(/\/documents\/([^/]+)$/);
	if (docMatch) {
		const hit = (data?.documents ?? []).find((d: any) => d.id === docMatch[1]);
		return hit?.label ?? 'Dokument';
	}

	if (clean.endsWith('/namings')) return 'Namings';
	if (clean.endsWith('/memos')) return 'Memos';
	if (clean.endsWith('/concepts')) return 'Concepts';
	if (clean.endsWith('/documents')) return 'Documents';
	if (clean.endsWith('/maps')) return 'Maps';
	return 'zurück';
}

/**
 * Scrollt ein Element in die Mitte und bleibt dran, bis es liegen bleibt.
 *
 * Ein einmaliges scrollIntoView reicht in langen Listen nicht: die Naming-Liste
 * hat mehrere hundert Zeilen, deren Höhe erst nach dem ersten Frame feststeht.
 * Man scrollt an eine Stelle, der Inhalt darüber wächst nach, und das gesuchte
 * Naming ist wieder weit unten — nur dass die Seite jetzt so aussieht, als sei
 * der Sprung erfolgt. Deshalb: nachfassen, bis die Position stillsteht.
 *
 * Ohne `behavior: smooth` — über zehntausende Pixel wäre die Animation lang
 * genug, dass sie mit dem Nachfassen kollidiert.
 */
export function scrollIntoViewStable(
	el: Element,
	opts: { block?: ScrollLogicalPosition; tries?: number } = {}
) {
	const block = opts.block ?? 'center';
	let tries = opts.tries ?? 12;
	let last = Number.NaN;
	const step = () => {
		const top = el.getBoundingClientRect().top;
		if (Math.abs(top - last) < 1) return; // liegt still
		last = top;
		el.scrollIntoView({ behavior: 'auto', block });
		if (--tries > 0) setTimeout(step, 60);
	};
	step();
}
