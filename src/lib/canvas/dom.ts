// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Kleine DOM-Aktionen für Karte und Canvas.

/**
 * Fokus ins Feld, vorhandener Text markiert (Umbenennen: der alte Name ist
 * überschreibbar). preventScroll, weil focus() sonst auch Kästen mit
 * overflow:hidden verschiebt — der Inhalt rutschte dabei seitlich weg.
 */
export function focusSelect(node: HTMLInputElement | HTMLTextAreaElement) {
	const apply = () => {
		node.focus({ preventScroll: true });
		node.select();
	};
	apply();
	// Ein Menüpunkt, der das Feld öffnet, verschwindet im selben Durchgang und
	// kann den Fokus noch mitnehmen — dann im nächsten Frame nachfassen.
	const raf = requestAnimationFrame(() => {
		if (document.activeElement !== node) apply();
	});
	return {
		destroy() {
			cancelAnimationFrame(raf);
		}
	};
}

/**
 * Ein fest positioniertes Menü an (x, y) öffnen, aber im Fenster halten: reicht
 * der Platz nach unten nicht, öffnet es nach oben; nach rechts ebenso nach links.
 */
export function keepInWindow(node: HTMLElement, pos: { x: number; y: number }) {
	const M = 8;
	function place(p: { x: number; y: number }) {
		node.style.left = `${p.x}px`;
		node.style.top = `${p.y}px`;
		const r = node.getBoundingClientRect();
		const W = window.innerWidth;
		const H = window.innerHeight;
		// Oben endet der freie Raum an der App-Leiste: ein nach oben
		// aufklappendes Menü verschwand sonst mit seinem Kopf darunter
		// (Testlauf 11).
		const T = Math.max(M, (document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0) + M);
		let x = p.x;
		let y = p.y;
		if (x + r.width > W - M) x = p.x - r.width >= M ? p.x - r.width : Math.max(M, W - r.width - M);
		if (y + r.height > H - M) y = p.y - r.height >= T ? p.y - r.height : Math.max(T, H - r.height - M);
		if (y < T) y = T;
		node.style.left = `${x}px`;
		node.style.top = `${y}px`;
	}
	place(pos);
	return {
		update(p: { x: number; y: number }) {
			place(p);
		}
	};
}
