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

export const namingSchema = z.object({
	inscription: z.string().min(1).max(2000),
	participantIds: z.array(z.string().uuid()).optional()
});

export const appearanceSchema = z.object({
	perspectiveId: z.string().uuid(),
	mode: z.enum(['entity', 'relation', 'constellation', 'process', 'silence', 'perspective']),
	directedFrom: z.string().uuid().optional(),
	directedTo: z.string().uuid().optional(),
	valence: z.string().max(100).optional(),
	properties: z.record(z.unknown()).optional()
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type NamingInput = z.infer<typeof namingSchema>;
export const addMemberSchema = z.object({
	username: z.string().min(1).max(100),
	role: z.enum(['admin', 'member', 'viewer']).default('member')
});

export const changeMemberRoleSchema = z.object({
	userId: z.string().uuid(),
	role: z.enum(['admin', 'member', 'viewer'])
});

export const removeMemberSchema = z.object({
	userId: z.string().uuid()
});

export type AppearanceInput = z.infer<typeof appearanceSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
