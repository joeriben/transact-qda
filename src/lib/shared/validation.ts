import { z } from 'zod';

export const loginSchema = z.object({
	username: z.string().min(1).max(100),
	password: z.string().min(8).max(200)
});

export const registerSchema = z.object({
	username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
	email: z.string().email().max(200),
	password: z.string().min(8).max(200),
	displayName: z.string().max(100).optional()
});

export const projectSchema = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(2000).optional()
});

export const elementSchema = z.object({
	kind: z.enum(['entity', 'relation', 'code', 'category', 'memo', 'map', 'document']),
	label: z.string().min(1).max(500),
	sourceId: z.string().uuid().optional(),
	targetId: z.string().uuid().optional(),
	properties: z.record(z.unknown()).optional()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ElementInput = z.infer<typeof elementSchema>;
