export type ElementKind = 'entity' | 'relation' | 'code' | 'category' | 'memo' | 'map' | 'document';

export type MapType = 'situational' | 'social-worlds' | 'positional' | 'network';

export type EventType =
	| 'element.create'
	| 'element.update'
	| 'element.delete'
	| 'element.relate'
	| 'aspect.set'
	| 'code.create'
	| 'code.apply'
	| 'memo.create'
	| 'map.create'
	| 'ai.suggest'
	| 'ai.accept'
	| 'ai.reject';

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

export interface Element {
	id: string;
	projectId: string;
	kind: ElementKind;
	label: string;
	constitutedBy: string | null;
	sourceId: string | null;
	targetId: string | null;
	properties: Record<string, unknown>;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TEvent {
	id: string;
	projectId: string;
	type: EventType;
	createdBy: string;
	createdAt: string;
	contextId: string | null;
	data: Record<string, unknown>;
	seq: number;
}

export interface ElementAspect {
	id: string;
	elementId: string;
	contextId: string;
	properties: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface Annotation {
	id: string;
	projectId: string;
	codeId: string;
	documentId: string;
	constitutedBy: string | null;
	anchorType: 'text' | 'image_region';
	anchor: Record<string, unknown>;
	comment: string | null;
}
