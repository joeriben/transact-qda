import type { LayoutServerLoad } from './$types.js';
import { getDbStatus } from '$lib/server/db/docker.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user ?? null,
		dbStatus: getDbStatus()
	};
};
