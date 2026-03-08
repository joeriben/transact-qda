// Phase color palette for consistent phase visualization.
// Used by sidebar borders, node phase dots, and highlight glow.

const PHASE_COLORS = [
	'#5b6abf', // muted indigo
	'#4a9e7e', // muted teal
	'#b07840', // muted amber
	'#8b5ca0', // muted purple
	'#3d8ea6', // muted cyan
	'#a65d5d', // muted rose
];

export function regionColor(index: number): string {
	return PHASE_COLORS[index % PHASE_COLORS.length];
}
