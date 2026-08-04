// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sequenz-Gliederung des offenen Dokuments, geteilt zwischen Dokumentseite und
// Projekt-Sidebar.
//
// Die Gliederung listet ALLE Sequenzen des Dokuments, nicht nur die benannten.
// Der KI-Lauf teilt das Dokument vollständig in Sequenzen; ein Titel entsteht
// aber nur dort, wo im Lauf einer die H1↔H2-Konfrontation überlebt. Zeigte die
// Gliederung nur diese, stünden die übrigen Passagen nirgends — nicht als leer,
// sondern gar nicht, und der Leser hielte eine lückenhafte Liste für die ganze.
// Unbenannte Sequenzen stehen deshalb mit ihrer Nummer da, sind anspringbar und
// benennbar.
//
// Die Daten und beide Schreibwege liegen auf der Dokumentseite — nur sie kann
// ans Ziel scrollen, und nur sie kennt Anker und Projektbezug. Also: die Seite
// trägt die Gliederung hier ein und hinterlegt, was Klick und Benennen tun; die
// Sidebar liest und ruft. Beim Verlassen räumt die Seite ab, damit unter einem
// Dokument nie die Gliederung eines anderen steht.

export interface OutlineEntry {
	/** Stabiler Schlüssel für die Liste (`seq:<n>` bzw. `ann:<id>`). */
	key: string;
	/** 1-basierte Nummer der Sequenz im Dokument; null, wenn zu keinem Segment zuordenbar. */
	seq: number | null;
	/** Titel — null heißt unbenannt. */
	label: string | null;
	/** Annotation der Sequenz, wenn benannt — Ziel des Scrollens (data-seq-anchor). */
	annId: string | null;
	/** Naming hinter der Sequenz, wenn benannt — Ziel des Umschreibens. */
	namingId: string | null;
	/** Textspanne der Sequenz, für das Benennen einer unbenannten. */
	charStart: number | null;
	charEnd: number | null;
}

class DocOutlineStore {
	docId = $state<string | null>(null);
	entries = $state<OutlineEntry[]>([]);
	/** Zuletzt angesprungene Sequenz — die Sidebar hebt sie hervor. */
	activeKey = $state<string | null>(null);

	onselect: ((entry: OutlineEntry) => void) | null = null;
	/** Benennt um (benannte Sequenz) oder benennt erstmals (unbenannte). */
	onname: ((entry: OutlineEntry, label: string) => Promise<void> | void) | null = null;

	set(docId: string, entries: OutlineEntry[]) {
		this.docId = docId;
		this.entries = entries;
	}

	clear() {
		this.docId = null;
		this.entries = [];
		this.activeKey = null;
		this.onselect = null;
		this.onname = null;
	}

	select(entry: OutlineEntry) {
		this.activeKey = entry.key;
		this.onselect?.(entry);
	}
}

export const docOutline = new DocOutlineStore();
