export const SESSION_COOKIE = 'tqda_session';
export const MAP_TYPES = ['situational', 'social-worlds', 'positional', 'network'] as const;
export const COLLAPSE_MODES = ['entity', 'relation', 'constellation', 'process', 'silence', 'perspective'] as const;

export const SW_ROLES = ['social-world', 'arena', 'discourse', 'organization'] as const;

// Visual styles per formation role on SW/A maps
export const SW_ROLE_STYLES = {
	'social-world': { shape: 'ellipse' as const, dashArray: '3 3', fillOpacity: 0 },
	'arena':        { shape: 'ellipse' as const, dashArray: '8 4', fillOpacity: 0 },
	'organization': { shape: 'rect'    as const, dashArray: '8 4', fillOpacity: 0 },
	'discourse':    { shape: 'ellipse' as const, dashArray: '',    fillOpacity: 0.15 },
} as const;

// Default ellipse/rect radii per formation role
export const SW_ROLE_DEFAULTS = {
	'social-world': { rx: 140, ry: 90 },
	'arena':        { rx: 240, ry: 170 },
	'organization': { rx: 130, ry: 80 },
	'discourse':    { rx: 160, ry: 100 },
} as const;
