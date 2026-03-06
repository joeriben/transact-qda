import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query, queryOne } from '$lib/server/db/index.js';
import { hashPassword, createSession } from '$lib/server/auth/index.js';
import { registerSchema } from '$lib/shared/validation.js';
import { SESSION_COOKIE } from '$lib/shared/constants.js';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json();
	const parsed = registerSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
	}

	const { username, email, password, displayName } = parsed.data;

	const existing = await queryOne(
		'SELECT id FROM users WHERE username = $1 OR email = $2',
		[username, email]
	);
	if (existing) {
		return json({ error: 'Username or email already taken' }, { status: 409 });
	}

	const passwordHash = await hashPassword(password);

	const result = await queryOne<{ id: string }>(
		`INSERT INTO users (username, email, password_hash, display_name)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		[username, email, passwordHash, displayName || null]
	);

	if (!result) {
		return json({ error: 'Failed to create user' }, { status: 500 });
	}

	const { token, expiresAt } = await createSession(result.id);

	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false,
		expires: expiresAt
	});

	return json({ ok: true, userId: result.id });
};
