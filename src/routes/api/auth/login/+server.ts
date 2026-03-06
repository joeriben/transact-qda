import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { verifyPassword, createSession } from '$lib/server/auth/index.js';
import { loginSchema } from '$lib/shared/validation.js';
import { SESSION_COOKIE } from '$lib/shared/constants.js';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json();
	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: 'Invalid input' }, { status: 400 });
	}

	const { username, password } = parsed.data;

	const user = await queryOne<{ id: string; password_hash: string }>(
		'SELECT id, password_hash FROM users WHERE username = $1',
		[username]
	);

	if (!user || !(await verifyPassword(user.password_hash, password))) {
		return json({ error: 'Invalid credentials' }, { status: 401 });
	}

	const { token, expiresAt } = await createSession(user.id);

	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: false, // set true behind cloudflared
		expires: expiresAt
	});

	return json({ ok: true });
};
