// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bewegliche, in der Größe ziehbare Overlay-Panels über dem Canvas.
//
// Die Halde (Unplaced) und das Stack-Panel lagen beide fest oben rechts:
// gleiche Ecke, feste Breite, keine Möglichkeit sie beiseite zu schieben — wo
// beide offen waren, lag das Stack-Panel hinter der Halde. Ein Panel, das man
// weder bewegen noch verkleinern kann, entscheidet für den Forscher, was er
// sehen darf.
//
// Konvention wie bei den Reader-Spalten (documents/[docId]): ziehen mit der
// Maus, Werte geklemmt, Wahl in localStorage. Position und Größe hängen an der
// Karte, nicht an der Sitzung.

const STORE_PREFIX = 'tqda:map-panel:';

export type PanelAnchor = 'top-left' | 'top-right';

export interface FloatingPanelOptions {
	/** localStorage-Schlüssel, i.d.R. `${mapId}:${panelName}`. */
	key: string;
	width: number;
	/** null = Höhe nach Inhalt (max-height greift), Zahl = fest gezogen. */
	height?: number | null;
	anchor?: PanelAnchor;
	/** Abstand zur angesetzten Ecke, wenn noch nichts gespeichert ist. */
	offset?: number;
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
}

export type ResizeDir = 'w' | 'e' | 's' | 'sw' | 'se';

/** Mindestens so viel Panel bleibt immer im Container greifbar. */
const KEEP_VISIBLE = 60;

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

export function createFloatingPanel(opts: FloatingPanelOptions) {
	const offset = opts.offset ?? 12;
	const minW = opts.minWidth ?? 200;
	const minH = opts.minHeight ?? 120;
	const maxW = opts.maxWidth ?? 900;

	let x = $state<number | null>(null);
	let y = $state<number | null>(null);
	let w = $state(opts.width);
	let h = $state<number | null>(opts.height ?? null);
	let el: HTMLElement | null = null;
	let hydrated = false;

	function storageKey() {
		return STORE_PREFIX + opts.key;
	}

	function persist() {
		if (typeof window === 'undefined' || x === null || y === null) return;
		try {
			window.localStorage?.setItem(storageKey(), JSON.stringify({ x, y, w, h }));
		} catch {
			// Voller oder gesperrter Storage darf das Panel nicht lahmlegen.
		}
	}

	function container(): { width: number; height: number } {
		const parent = el?.offsetParent as HTMLElement | null;
		if (parent) return { width: parent.clientWidth, height: parent.clientHeight };
		if (typeof window !== 'undefined') return { width: window.innerWidth, height: window.innerHeight };
		return { width: 1200, height: 800 };
	}

	/** Panel im Container halten — auch nachdem das Fenster kleiner wurde. */
	function clampIntoView() {
		if (x === null || y === null) return;
		const c = container();
		// Container ohne Maß (Karte gerade in der Listenansicht, display:none):
		// daran lässt sich nichts messen, also nichts zurechtstutzen.
		if (c.width <= 0 || c.height <= 0) return;
		w = clamp(w, minW, Math.max(minW, Math.min(maxW, c.width - 8)));
		if (h !== null) h = clamp(h, minH, Math.max(minH, c.height - 8));
		x = clamp(x, KEEP_VISIBLE - w, Math.max(0, c.width - KEEP_VISIBLE));
		y = clamp(y, 0, Math.max(0, c.height - 32));
	}

	function hydrate() {
		if (hydrated || typeof window === 'undefined') return;
		// Ohne vermessbaren Container gäbe es nur eine Scheinposition; dann lieber
		// beim Anker bleiben und es beim nächsten Zugriff erneut versuchen.
		const probe = container();
		if (probe.width <= 0 || probe.height <= 0) return;
		hydrated = true;
		let stored: any = null;
		try {
			const raw = window.localStorage?.getItem(storageKey());
			if (raw) stored = JSON.parse(raw);
		} catch {
			stored = null;
		}
		const c = container();
		if (stored && typeof stored.x === 'number' && typeof stored.y === 'number') {
			x = stored.x;
			y = stored.y;
			if (typeof stored.w === 'number') w = stored.w;
			if (typeof stored.h === 'number' || stored.h === null) h = stored.h;
		} else {
			x = opts.anchor === 'top-left' ? offset : Math.max(offset, c.width - w - offset);
			y = offset;
		}
		clampIntoView();
	}

	/** Auf das Panel-Element anwenden: `use:panel.attach`. Mit `false` inaktiv
	 *  (dasselbe Bauteil wird auch fest im Fluss gerendert). */
	function attach(node: HTMLElement, enabled: boolean = true) {
		if (!enabled) return;
		el = node;
		hydrate();
		// Beim ersten Frame steht die Canvas-Fläche u.U. noch nicht; dann bleibt die
		// gespeicherte Lage bis zum nächsten Frame ungenutzt.
		if (!hydrated) requestAnimationFrame(() => hydrate());
		const onWindowResize = () => clampIntoView();
		window.addEventListener('resize', onWindowResize);
		return {
			destroy() {
				window.removeEventListener('resize', onWindowResize);
				if (el === node) el = null;
			}
		};
	}

	function drag(e: PointerEvent) {
		// Bedienelemente in der Kopfzeile bleiben bedienbar.
		if ((e.target as Element | null)?.closest('button, a, select, input, textarea')) return;
		if (e.button !== 0) return;
		hydrate();
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startY = e.clientY;
		const originX = x ?? 0;
		const originY = y ?? 0;
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);

		function onMove(ev: PointerEvent) {
			x = originX + (ev.clientX - startX);
			y = originY + (ev.clientY - startY);
			clampIntoView();
		}
		function onUp(ev: PointerEvent) {
			target.releasePointerCapture(ev.pointerId);
			target.removeEventListener('pointermove', onMove);
			target.removeEventListener('pointerup', onUp);
			target.removeEventListener('pointercancel', onUp);
			persist();
		}
		target.addEventListener('pointermove', onMove);
		target.addEventListener('pointerup', onUp);
		target.addEventListener('pointercancel', onUp);
	}

	function resize(e: PointerEvent, dir: ResizeDir) {
		if (e.button !== 0) return;
		hydrate();
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startY = e.clientY;
		const box = { x: x ?? 0, y: y ?? 0, w, h: h ?? (el?.offsetHeight ?? opts.width) };
		const c = container();
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);

		function onMove(ev: PointerEvent) {
			const dx = ev.clientX - startX;
			const dy = ev.clientY - startY;
			if (dir.includes('e')) {
				w = clamp(box.w + dx, minW, Math.min(maxW, c.width - box.x));
			}
			if (dir.includes('w')) {
				const nw = clamp(box.w - dx, minW, Math.min(maxW, box.x + box.w));
				x = box.x + (box.w - nw);
				w = nw;
			}
			if (dir.includes('s')) {
				h = clamp(box.h + dy, minH, Math.max(minH, c.height - box.y));
			}
		}
		function onUp(ev: PointerEvent) {
			target.releasePointerCapture(ev.pointerId);
			target.removeEventListener('pointermove', onMove);
			target.removeEventListener('pointerup', onUp);
			target.removeEventListener('pointercancel', onUp);
			persist();
		}
		target.addEventListener('pointermove', onMove);
		target.addEventListener('pointerup', onUp);
		target.addEventListener('pointercancel', onUp);
	}

	/** Zurück auf die Ausgangsecke und -größe. */
	function reset() {
		try {
			window.localStorage?.removeItem(storageKey());
		} catch {
			// egal
		}
		hydrated = false;
		w = opts.width;
		h = opts.height ?? null;
		x = null;
		y = null;
		hydrate();
	}

	return {
		attach,
		drag,
		resize,
		reset,
		get style() {
			// Vor der Hydration (SSR/erster Frame) die alte Anker-Position, damit das
			// Panel nicht kurz in der Ecke aufblitzt.
			if (x === null || y === null) {
				const side = opts.anchor === 'top-left' ? 'left' : 'right';
				return `${side}: ${offset}px; top: ${offset}px; width: ${w}px;` +
					(h !== null ? ` height: ${h}px;` : '');
			}
			return `left: ${x}px; top: ${y}px; width: ${w}px;` + (h !== null ? ` height: ${h}px;` : '');
		},
		get width() {
			return w;
		},
		get height() {
			return h;
		}
	};
}
