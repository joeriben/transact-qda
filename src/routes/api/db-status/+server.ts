import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDbStatus } from '$lib/server/db/docker.js';

export const GET: RequestHandler = async () => {
	return json(getDbStatus());
};
