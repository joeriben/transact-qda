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

// Clarke's 14 questions for Social Worlds analysis (SA 2nd ed., ch. 5)
export const CLARKE_SW_QUESTIONS = [
	'What are the key social worlds operating in this situation?',
	'What work does each social world do? What are its characteristic activities?',
	'What sites/locations are characteristic of each world?',
	'What technologies (material and conceptual) are used?',
	'What organizations are implicated or responsible?',
	'What commitments, ideologies, or shared perspectives characterize each world?',
	'In which arenas do these worlds participate? What issues draw them there?',
	'What discourses are produced and circulated within each world?',
	'What identities and identity positions are available within each world?',
	'How are the boundaries of each social world constituted, maintained, and challenged?',
	'What segments or subworlds exist within larger social worlds?',
	'Who/what are the implicated actors/actants — affected but silenced or not present?',
	'What silences are produced by the configuration of social worlds?',
	'Where and how do social worlds intersect, overlap, or segment?',
] as const;

// Clarke's 11 questions for Arena analysis (SA 2nd ed., ch. 5)
export const CLARKE_ARENA_QUESTIONS = [
	'Which social worlds are active in this arena? What brings them together?',
	'What are the contested issues? What is at stake?',
	'Who/what are the implicated actors/actants — affected but not fully engaged?',
	'What positions are taken on the key issues? By whom/what?',
	'What discourses circulate in this arena? Who produces them?',
	'What organizations are involved? How do they shape participation?',
	'What is the history of this arena? How did it form and change?',
	'What power dynamics are at work? Who sets the agenda?',
	'What are the "hot" issues — most actively contested right now?',
	'What silences are produced by the arena configuration?',
	'What boundary objects or shared repertoires mediate across worlds in this arena?',
] as const;

// 5 analytical deepening moments for SW/A maps
export const ANALYTICAL_DEEPENING = [
	{ key: 'stabilization', label: 'Stabilisierung', question: 'How is this formation stabilized? What commitments, routines, or material arrangements hold it together?' },
	{ key: 'conflict', label: 'Konflikt', question: 'What is contested here? Where do worlds collide, and what is at stake in the collision?' },
	{ key: 'dispositif', label: 'Dispositiv', question: 'What apparatus of knowledge/power operates through this formation? What discursive and material arrangements enable it?' },
	{ key: 'discursive-constitution', label: 'Diskursive Konstitution', question: 'How is this formation discursively constituted? Which discourses produce it as a recognizable entity?' },
	{ key: 'cross-map', label: 'Cross-Map', question: 'How do situational map elements map onto this formation? Which SitMap entities are constitutive of this world/arena?' },
] as const;
