// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Single source of truth for canvas node dimensions.
// CanvasMapNode renders cards at NODE_WIDTH (fixed, border-box); ELK layout
// (layout.ts) and free-spot placement (canvasPositions) estimate heights with
// the SAME model. If the card CSS changes, change it here too — the layout
// engine packing boxes that don't match the rendered boxes is exactly the
// overlap bug this module exists to prevent.

/** Fixed outer card width (border-box), matches .map-node/.silence-node CSS. */
export const NODE_WIDTH = 200;

const PADDING_X = 9.6 * 2; // 0.6rem left+right
const BORDER = 2 * 2;
const INNER_WIDTH = NODE_WIDTH - PADDING_X - BORDER; // ≈ 176px
const CHARS_PER_LINE = Math.floor(INNER_WIDTH / 8.2); // 0.85rem, wrap waste included ≈ 21
const LINE_HEIGHT = 19; // 0.85rem × ~1.4
const HEADER_HEIGHT = 17; // designation dot/icon row + margin
const PADDING_Y = 12.8; // 0.4rem top+bottom

/**
 * Estimated rendered height of a map card for a given label.
 * `header: false` for silence nodes (label only, no designation row).
 */
export function estimateNodeHeight(label: string, header = true): number {
	const lines = Math.max(1, Math.ceil((label ?? '').length / CHARS_PER_LINE));
	return Math.round(PADDING_Y + BORDER + (header ? HEADER_HEIGHT : 0) + lines * LINE_HEIGHT);
}

/** Box {width, height} for layout engines. */
export function estimateNodeSize(label: string, header = true): { width: number; height: number } {
	return { width: NODE_WIDTH, height: estimateNodeHeight(label, header) };
}
