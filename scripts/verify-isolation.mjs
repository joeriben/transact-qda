// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Project-isolation acceptance test.
 *
 * Proves that the membership guard (hooks.server.ts) plus the body/query-UUID
 * scoping in the project API routes actually isolate projects: a member of
 * project A must never be able to read or mutate resources of project B —
 * neither by hitting B's URL directly (blocked by membership) nor by passing a
 * UUID from B into an endpoint under their OWN project A (blocked by per-route
 * UUID scoping).
 *
 * The script provisions two throwaway users (usernames prefixed `isotest_`),
 * one project + one naming each, runs the cross-project matrix, then deletes
 * EVERYTHING it created (only its own captured IDs — never foreign data).
 *
 *   DATABASE_URL  default postgresql://tqda:tqda_dev@localhost:5432/transact_qda
 *   APP_URL       default http://localhost:5174
 *
 * Exits non-zero on any FAIL.
 */

import pg from 'pg';

const DATABASE_URL =
	process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';
const APP_URL = (process.env.APP_URL || 'http://localhost:5174').replace(/\/$/, '');

const PREFIX = 'isotest_';
const stamp = Date.now();

/** Everything we create, for teardown. */
const created = {
	userIds: /** @type {string[]} */ ([]),
	projectIds: /** @type {string[]} */ ([])
};

const pool = new pg.Pool({ connectionString: DATABASE_URL });

/** @type {Array<{ name: string; ok: boolean; detail: string }>} */
const results = [];
function record(name, ok, detail = '') {
	results.push({ name, ok, detail });
}

// ---- HTTP helpers -----------------------------------------------------------

/**
 * Register a throwaway user via the normal auth route (handles argon2 hashing +
 * session creation). Returns the session cookie and the new user id.
 */
async function register(suffix) {
	const username = `${PREFIX}${suffix}_${stamp}`;
	const res = await fetch(`${APP_URL}/api/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username,
			email: `${username}@isotest.local`,
			password: 'isotest-pw-123456',
			displayName: username
		})
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.userId) {
		throw new Error(`register(${username}) failed: ${res.status} ${JSON.stringify(body)}`);
	}
	const cookie = extractSessionCookie(res);
	if (!cookie) throw new Error(`register(${username}) returned no session cookie`);
	created.userIds.push(body.userId);
	return { username, userId: body.userId, cookie };
}

function extractSessionCookie(res) {
	// node fetch exposes multiple Set-Cookie via getSetCookie()
	const all =
		typeof res.headers.getSetCookie === 'function'
			? res.headers.getSetCookie()
			: [res.headers.get('set-cookie')].filter(Boolean);
	for (const c of all) {
		const m = /(^|;\s*)(tqda_session=[^;]+)/.exec(c);
		if (m) return m[2];
	}
	return null;
}

function req(method, path, cookie, body) {
	return fetch(`${APP_URL}${path}`, {
		method,
		headers: {
			cookie,
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
}

// ---- Setup ------------------------------------------------------------------

async function createProject(cookie, name) {
	const res = await req('POST', '/api/projects', cookie, { name });
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.id) {
		throw new Error(`create project "${name}" failed: ${res.status} ${JSON.stringify(body)}`);
	}
	created.projectIds.push(body.id);
	return body.id;
}

async function createNaming(cookie, projectId, inscription) {
	const res = await req('POST', `/api/projects/${projectId}/namings`, cookie, {
		action: 'create',
		inscription,
		designation: 'cue'
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.id) {
		throw new Error(`create naming failed: ${res.status} ${JSON.stringify(body)}`);
	}
	return body.id;
}

async function getPrimaryMapId(projectId) {
	const r = await pool.query(
		`SELECT n.id
		   FROM namings n
		   JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		  WHERE n.project_id = $1 AND n.deleted_at IS NULL
		    AND a.mode = 'perspective' AND a.properties ? 'mapType'
		  ORDER BY n.seq DESC LIMIT 1`,
		[projectId]
	);
	return r.rows[0]?.id || null;
}

/** Read the designation-act count for a naming straight from the DB. */
async function designationCount(namingId) {
	const r = await pool.query(
		`SELECT count(*)::int AS c FROM naming_acts WHERE naming_id = $1 AND designation IS NOT NULL`,
		[namingId]
	);
	return r.rows[0].c;
}

// ---- Assertions -------------------------------------------------------------

/** Expect a request to be denied (403 or 404) and never 2xx. */
async function expectDenied(label, res) {
	const denied = res.status === 403 || res.status === 404;
	record(label, denied, `status ${res.status} (want 403/404)`);
}

/** Expect a request to succeed (2xx). */
async function expectOk(label, res) {
	record(label, res.ok, `status ${res.status} (want 2xx)`);
}

// ---- Main -------------------------------------------------------------------

async function run() {
	// Two isolated users, each with their own project + naming.
	const A = await register('a');
	const B = await register('b');

	const projA = await createProject(A.cookie, `${PREFIX}projA_${stamp}`);
	const projB = await createProject(B.cookie, `${PREFIX}projB_${stamp}`);
	const namingA = await createNaming(A.cookie, projA, 'secret-A');
	const namingB = await createNaming(B.cookie, projB, 'secret-B');
	const mapA = await getPrimaryMapId(projA);
	const memoAId = await createMemoInA(A.cookie, projA, namingA);

	// --- 1. Membership guard: B hits A's URLs directly -> 403 -----------------
	await expectDenied('B GET projectA namings', await req('GET', `/api/projects/${projA}/namings`, B.cookie));
	await expectDenied('B GET projectA members', await req('GET', `/api/projects/${projA}/members`, B.cookie));
	await expectDenied('B GET projectA settings', await req('GET', `/api/projects/${projA}/settings`, B.cookie));
	await expectDenied('B GET projectA export', await req('GET', `/api/projects/${projA}/export`, B.cookie));
	if (mapA)
		await expectDenied('B GET projectA map', await req('GET', `/api/projects/${projA}/maps/${mapA}`, B.cookie));
	await expectDenied(
		'B POST designate under projectA',
		await req('POST', `/api/projects/${projA}/namings`, B.cookie, {
			action: 'designate',
			namingId: namingA,
			designation: 'specification'
		})
	);

	// --- 2. Body-UUID scoping: B uses B's OWN project, A's naming UUID --------
	// This is the critical class: the URL passes the membership guard (B owns
	// projB) but the body carries a foreign UUID. Must be 404, no mutation.
	const beforeDesignate = await designationCount(namingA);

	await expectDenied(
		'B designate A-naming via own project',
		await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'designate',
			namingId: namingA,
			designation: 'specification'
		})
	);
	await expectDenied(
		'B rename A-naming via own project',
		await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'rename',
			namingId: namingA,
			inscription: 'HIJACKED'
		})
	);

	// getStack / getMemosForNaming are project-scoped at the query layer: they
	// return 200 but with EMPTY data for a foreign naming. 200-but-empty is a
	// non-leak, so assert the absence of A's secret data rather than the status.
	{
		const res = await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'getStack',
			namingId: namingA
		});
		const body = await res.json().catch(() => ({}));
		const leaked =
			Array.isArray(body.inscriptions) &&
			body.inscriptions.some((i) => String(i.inscription || '').includes('secret-A'));
		record('B getStack does not leak A stack', !leaked, leaked ? 'LEAKED secret-A' : 'empty, no leak');
	}
	{
		const res = await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'getMemosForNaming',
			namingId: namingA
		});
		const body = await res.json().catch(() => ({}));
		const leaked = Array.isArray(body.memos) && body.memos.length > 0;
		record('B getMemosForNaming does not leak A memos', !leaked, leaked ? `LEAKED ${body.memos.length}` : 'empty, no leak');
	}

	// setValence on a foreign naming is a scoped UPDATE that matches 0 rows: it
	// returns 200 { ok } but must not alter any of A's appearances. Assert that
	// no relation-appearance valence for A's project changed.
	{
		await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'setValence',
			namingId: namingA,
			valence: 'HIJACKED'
		});
		const v = await pool.query(
			`SELECT count(*)::int AS c FROM appearances a
			   JOIN namings n ON n.id = a.naming_id
			  WHERE n.project_id = $1 AND a.valence = 'HIJACKED'`,
			[projA]
		);
		record('B setValence did not mutate A appearances', v.rows[0].c === 0, `${v.rows[0].c} hijacked rows`);
	}

	// --- 3. Memo body-UUID scoping: B edits A's memo via own project ----------
	if (memoAId) {
		await expectDenied(
			'B PATCH A-memo content via own project',
			await req('PATCH', `/api/projects/${projB}/memos/${memoAId}`, B.cookie, { content: 'HIJACKED' })
		);
		await expectDenied(
			'B PUT A-memo status via own project',
			await req('PUT', `/api/projects/${projB}/memos/${memoAId}/status`, B.cookie, { status: 'dismissed' })
		);
		// And the memo content must be unchanged in the DB.
		const mc = await pool.query(`SELECT content FROM memo_content WHERE naming_id = $1`, [memoAId]);
		const untouched = !mc.rows[0] || mc.rows[0].content !== 'HIJACKED';
		record('A-memo content unchanged after B attempts', untouched, mc.rows[0]?.content ?? '(none)');
	}

	// --- 4. Map body-UUID scoping: B targets A's map via own project ----------
	if (mapA) {
		await expectDenied(
			'B GET A-map events via own project',
			await req('GET', `/api/projects/${projB}/maps/${mapA}/events`, B.cookie)
		);
		await expectDenied(
			'B designate on A-map via own project',
			await req('POST', `/api/projects/${projB}/maps/${mapA}`, B.cookie, {
				action: 'designate',
				namingId: namingA,
				designation: 'specification'
			})
		);
	}

	// --- 5. Document route: B deletes A's project docs (no doc, but 404 not 200)
	await expectDenied(
		'B DELETE A-naming as doc via own project',
		await req('DELETE', `/api/projects/${projB}/documents/${namingA}`, B.cookie)
	);

	// --- 6. `duplicate`: B duplicates A's project by UUID (collection route) ---
	await expectDenied(
		'B duplicate projectA by UUID',
		await req('POST', '/api/projects', B.cookie, { action: 'duplicate', sourceProjectId: projA })
	);

	// --- 7. Integrity: A's naming was never designated by B -------------------
	const afterDesignate = await designationCount(namingA);
	record(
		'A-naming designation count unchanged',
		afterDesignate === beforeDesignate,
		`${beforeDesignate} -> ${afterDesignate}`
	);

	// --- 8. Positive control: A on A's own resources -> 2xx -------------------
	await expectOk('A GET own members', await req('GET', `/api/projects/${projA}/members`, A.cookie));
	await expectOk(
		'A getStack own naming',
		await req('POST', `/api/projects/${projA}/namings`, A.cookie, { action: 'getStack', namingId: namingA })
	);
	await expectOk(
		'A designate own naming',
		await req('POST', `/api/projects/${projA}/namings`, A.cookie, {
			action: 'designate',
			namingId: namingA,
			designation: 'characterization'
		})
	);
	// The positive designate DID land: count went up by exactly one.
	const afterPositive = await designationCount(namingA);
	record(
		'A positive designate landed',
		afterPositive === beforeDesignate + 1,
		`${beforeDesignate} -> ${afterPositive}`
	);
}

/** Create a memo in A's project linked to A's naming; return the memo naming id. */
async function createMemoInA(cookie, projectId, namingId) {
	const res = await req('POST', `/api/projects/${projectId}/memos`, cookie, {
		label: 'secret-A-memo',
		content: 'secret memo body',
		linkedNamingIds: [namingId]
	});
	const body = await res.json().catch(() => ({}));
	return body?.id || null;
}

// ---- Teardown ---------------------------------------------------------------

async function cleanup() {
	// Only ever touch objects we created (captured IDs) that still carry the
	// isotest_ marker. Real projects (e.g. AI4ArtsEd) are never referenced.
	try {
		if (created.projectIds.length > 0) {
			// topology_snapshots.map_id is ON DELETE NO ACTION -> clear first.
			await pool.query(
				`DELETE FROM topology_snapshots ts
				  USING namings n
				  WHERE ts.map_id = n.id AND n.project_id = ANY($1::uuid[])`,
				[created.projectIds]
			);
			// Deleting the project cascades to namings and all their children.
			await pool.query(
				`DELETE FROM projects WHERE id = ANY($1::uuid[]) AND name LIKE $2`,
				[created.projectIds, `${PREFIX}%`]
			);
		}
		if (created.userIds.length > 0) {
			await pool.query(
				`DELETE FROM users WHERE id = ANY($1::uuid[]) AND username LIKE $2`,
				[created.userIds, `${PREFIX}%`]
			);
		}
	} catch (err) {
		console.error('[cleanup] WARNING:', err instanceof Error ? err.message : err);
	}
}

// ---- Report -----------------------------------------------------------------

function report() {
	const pad = Math.max(...results.map((r) => r.name.length), 10);
	console.log('\nProject-isolation verification');
	console.log('='.repeat(pad + 24));
	for (const r of results) {
		const tag = r.ok ? 'PASS' : 'FAIL';
		console.log(`  [${tag}] ${r.name.padEnd(pad)}  ${r.detail}`);
	}
	const failed = results.filter((r) => !r.ok);
	console.log('='.repeat(pad + 24));
	console.log(`  ${results.length - failed.length}/${results.length} passed\n`);
	return failed.length === 0;
}

// ---- Entrypoint -------------------------------------------------------------

let exitCode = 0;
try {
	await run();
} catch (err) {
	console.error('[run] ERROR:', err instanceof Error ? err.stack : err);
	record('script completed without throwing', false, String(err));
} finally {
	await cleanup();
	const ok = report();
	exitCode = ok ? 0 : 1;
	await pool.end();
}
process.exit(exitCode);
