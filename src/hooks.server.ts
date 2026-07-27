// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth/index.js';
import { isProjectMember } from '$lib/server/auth/authz.js';
import { SESSION_COOKIE } from '$lib/shared/constants.js';
import { preloadEmbedModel } from '$lib/server/documents/embeddings.js';

// Kick off model download/warm-up on server start so AI features are ready
// when the user first triggers them (and so the UI can report progress).
preloadEmbedModel();

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);

	if (token) {
		try {
			const session = await validateSession(token);
			if (session) {
				event.locals.user = { ...session.user, role: session.user.role as 'admin' | 'user' };
				event.locals.sessionId = session.sessionId;
			} else {
				event.cookies.delete(SESSION_COOKIE, { path: '/' });
			}
		} catch (err) {
			console.warn('[hooks] Session validation failed:', (err as Error).message);
		}
	}

	// Protect all routes except login and API auth
	const path = event.url.pathname;
	const isPublic = path === '/login' || path.startsWith('/api/auth') || path === '/api/db-status';

	if (!isPublic && !event.locals.user) {
		if (path.startsWith('/api/')) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		return new Response(null, {
			status: 303,
			headers: { location: '/login' }
		});
	}

	// Project-level authorization: a logged-in user may only touch a project's
	// API resources if they are a member of it. Page routes enforce this via
	// [projectId]/+layout.server.ts, but API routes do not inherit that guard.
	// projectId is always a UUID, so the keyword siblings (import, native-import,
	// sync) and the collection route (/api/projects) never match.
	const projectApiMatch = path.match(
		/^\/api\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i
	);
	if (projectApiMatch && event.locals.user) {
		const member = await isProjectMember(projectApiMatch[1], event.locals.user.id);
		if (!member) {
			return new Response(JSON.stringify({ error: 'Forbidden' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	return resolve(event);
};
