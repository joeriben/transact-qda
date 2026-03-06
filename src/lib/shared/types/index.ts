// Collapse modes: how a naming appears from a perspective
export type CollapseMode = 'entity' | 'relation' | 'constellation' | 'process' | 'silence' | 'perspective';

export type MapType = 'situational' | 'social-worlds' | 'positional' | 'network';

export interface User {
	id: string;
	username: string;
	email: string;
	displayName: string | null;
	role: 'admin' | 'user';
}

export interface Project {
	id: string;
	name: string;
	description: string | null;
	createdBy: string;
	createdAt: string;
}

// The virtual object: pure potentiality.
// Neither entity nor relation intrinsically.
export interface Naming {
	id: string;
	projectId: string;
	inscription: string;
	createdBy: string;
	createdAt: string;
	deletedAt: string | null;
	seq: number;
}

// Undirected bond: co-constitution between namings.
// A participation IS a naming (its id is in the namings table).
export interface Participation {
	id: string;
	namingId: string;
	participantId: string;
	createdAt: string;
}

// How a naming appears from a perspective.
// This is where entity/relation/constellation EMERGES.
export interface Appearance {
	namingId: string;
	perspectiveId: string;
	mode: CollapseMode;
	directedFrom: string | null;
	directedTo: string | null;
	valence: string | null;
	properties: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}
