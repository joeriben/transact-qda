import type { User } from '$lib/shared/types/index.js';

declare global {
	namespace App {
		interface Locals {
			user?: User;
			sessionId?: string;
		}
	}
}

export {};
