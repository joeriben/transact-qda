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
import { loadEnv } from './lib/load-env.js';

loadEnv();

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
	// Memo zu einem Naming (Akt im Stack), Zurückziehen und Zusammenführen:
	// dieselbe Klasse — eigenes Projekt in der URL, fremde UUID im Body.
	await expectDenied(
		'B note on A-naming via own project',
		await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'note',
			namingId: namingA,
			memoText: 'HIJACKED'
		})
	);
	await expectDenied(
		'B withdraw A-naming via own project',
		await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'withdraw',
			namingId: namingA
		})
	);
	{
		const res = await req('POST', `/api/projects/${projB}/namings`, B.cookie, {
			action: 'merge',
			survivorId: namingB,
			mergedId: namingA
		});
		record('B merge A-naming via own project', res.status >= 400 && res.status < 500, `status ${res.status} (want 4xx)`);
	}
	{
		const r = await pool.query(
			`SELECT
			   (SELECT count(*)::int FROM naming_acts WHERE naming_id = $1 AND memo_text = 'HIJACKED') AS notes,
			   (SELECT count(*)::int FROM appearances
			     WHERE naming_id = $1 AND COALESCE((properties->>'withdrawn')::boolean, false)) AS withdrawn,
			   (SELECT count(*)::int FROM namings WHERE id = $1 AND deleted_at IS NULL) AS alive`,
			[namingA]
		);
		const x = r.rows[0];
		record(
			'A-naming untouched by note/withdraw/merge attempts',
			x.notes === 0 && x.withdrawn === 0 && x.alive === 1,
			JSON.stringify(x)
		);
	}

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

	// --- 4b. B's OWN map, A's UUIDs im Body: relate, Entität/Relation-Umschalter,
	// Lage-Synchronisation, Memo-Status. relateElements legt fehlende
	// Erscheinungen an, der Umschalter schrieb Endpunkte einer Relation um —
	// beides darf mit fremden UUIDs nichts bewirken.
	{
		const mapB = await getPrimaryMapId(projB);
		const namingA2 = await createNaming(A.cookie, projA, 'secret-A2');
		const namingA3 = await createNaming(A.cookie, projA, 'secret-A3');
		const namingB2 = await createNaming(B.cookie, projB, 'secret-B2');
		// A verbindet zwei eigene Namings (nicht namingA: dessen Designationen zählt Abschnitt 7).
		let relA = null;
		if (mapA) {
			const r = await req('POST', `/api/projects/${projA}/maps/${mapA}`, A.cookie, {
				action: 'relate', sourceId: namingA2, targetId: namingA3, inscription: 'secret-A-relation'
			});
			relA = (await r.json().catch(() => ({})))?.id ?? null;
			record('A relate own namings on own map', r.status === 201 && !!relA, `status ${r.status}`);
			const again = await req('POST', `/api/projects/${projA}/maps/${mapA}`, A.cookie, {
				action: 'relate', sourceId: namingA2, targetId: namingA3
			});
			const againBody = await again.json().catch(() => ({}));
			record(
				'A relate same pair again -> 409 already related (no server error)',
				again.status === 409 && againBody.alreadyRelated === true && againBody.id === relA,
				`status ${again.status}`
			);
		}
		if (mapB) {
			await expectDenied(
				'B relate own naming with A-naming on own map',
				await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
					action: 'relate', sourceId: namingB, targetId: namingA
				})
			);
			await expectDenied(
				'B switch A-naming to relation on own map',
				await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
					action: 'switchAppearanceMode', namingId: namingA, mode: 'relation', sourceId: namingB, targetId: namingB2
				})
			);
			if (relA) {
				await expectDenied(
					'B rewrite A-relation endpoints via switch on own map',
					await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
						action: 'switchAppearanceMode', namingId: relA, mode: 'relation', sourceId: namingB, targetId: namingB2
					})
				);
			}
			await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
				action: 'syncSpatialRelations', add: [{ sourceId: namingB, targetId: namingA, valence: 'contains' }]
			});
			if (memoAId) {
				await expectDenied(
					'B set A-memo status via own map',
					await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
						action: 'updateMemoStatus', memoId: memoAId, status: 'dismissed'
					})
				);
			}
			const x = (
				await pool.query(
					`SELECT
					   (SELECT count(*)::int FROM appearances a JOIN namings n ON n.id = a.naming_id
					     WHERE a.perspective_id = $1 AND n.project_id = $2) AS a_on_b_map,
					   (SELECT count(*)::int FROM participations
					     WHERE naming_id = ANY($3::uuid[]) OR participant_id = ANY($3::uuid[])) AS cross_parts,
					   (SELECT count(*)::int FROM participations
					     WHERE id = $4 AND naming_id = $5 AND participant_id = $6) AS rel_a_intact,
					   (SELECT count(*)::int FROM memo_content WHERE naming_id = $7 AND status = 'dismissed') AS memo_dismissed`,
					[mapB, projA, [namingB, namingB2], relA, namingA2, namingA3, memoAId]
				)
			).rows[0];
			record(
				'No A-naming on B-map, no B<->A relation, A-relation and A-memo intact',
				x.a_on_b_map === 0 && x.cross_parts === 0 && (relA ? x.rel_a_intact === 1 : true) && x.memo_dismissed === 0,
				JSON.stringify(x)
			);
		}
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

	// --- 6b. Phasen: phaseId und namingId aus dem Body gehören zum Projekt ------
	{
		const phaseA = (await (await req('POST', `/api/projects/${projA}/phases`, A.cookie, {
			action: 'create', inscription: 'phase-A'
		})).json().catch(() => ({}))).id;
		const phaseB = (await (await req('POST', `/api/projects/${projB}/phases`, B.cookie, {
			action: 'create', inscription: 'phase-B'
		})).json().catch(() => ({}))).id;
		record('phases created for the phase checks', !!phaseA && !!phaseB, `${phaseA} / ${phaseB}`);
		if (phaseA && phaseB) {
			await expectDenied(
				'B getMembers of A-phase via own project',
				await req('POST', `/api/projects/${projB}/phases`, B.cookie, { action: 'getMembers', phaseId: phaseA })
			);
			await expectDenied(
				'B assign own naming into A-phase via own project',
				await req('POST', `/api/projects/${projB}/phases`, B.cookie, { action: 'assign', phaseId: phaseA, namingId: namingB })
			);
			await expectDenied(
				'B assign A-naming into own phase',
				await req('POST', `/api/projects/${projB}/phases`, B.cookie, { action: 'assign', phaseId: phaseB, namingId: namingA })
			);
			const mapB = await getPrimaryMapId(projB);
			if (mapB) {
				await expectDenied(
					'B assignToPhase A-phase via own map',
					await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
						action: 'assignToPhase', phaseId: phaseA, namingId: namingB
					})
				);
				await expectDenied(
					'B phase history of A-phase via own map',
					await req('POST', `/api/projects/${projB}/maps/${mapB}`, B.cookie, {
						action: 'getPhaseMembershipHistory', phaseId: phaseA
					})
				);
			}
			const m = await pool.query(
				`SELECT
				   (SELECT count(*)::int FROM appearances WHERE perspective_id = $1 AND naming_id <> $1) AS in_a,
				   (SELECT count(*)::int FROM appearances WHERE perspective_id = $2 AND naming_id = $3) AS a_in_b`,
				[phaseA, phaseB, namingA]
			);
			record(
				'phases untouched by cross-project attempts',
				m.rows[0].in_a === 0 && m.rows[0].a_in_b === 0,
				JSON.stringify(m.rows[0])
			);
			await expectOk(
				'A assign own naming into own phase',
				await req('POST', `/api/projects/${projA}/phases`, A.cookie, { action: 'assign', phaseId: phaseA, namingId: namingA })
			);
		}
	}

	// --- 7. Integrity: A's naming was never designated by B -------------------
	const afterDesignate = await designationCount(namingA);
	record(
		'A-naming designation count unchanged',
		afterDesignate === beforeDesignate,
		`${beforeDesignate} -> ${afterDesignate}`
	);

	// --- 7b. Installation-wide AI settings: only an admin account may change
	// them (BJ, 09.11.). A fresh account is role 'user'. The body changes
	// nothing even if the gate failed (empty = keep current values).
	{
		const res = await req('POST', '/api/settings/ai', A.cookie, {});
		record('non-admin POST /api/settings/ai denied', res.status === 403, `status ${res.status} (want 403)`);
		const get = await req('GET', '/api/settings/ai', A.cookie);
		const body = await get.json().catch(() => ({}));
		record('non-admin sees settings read-only', get.ok && body.canEdit === false, `status ${get.status}, canEdit ${body.canEdit}`);
		const leaked = (body.providers ?? []).filter((p) => p.keyMasked && p.keyMasked !== 'configured');
		record('non-admin sees no key fragments', get.ok && leaked.length === 0, `${leaked.length} provider(s) with a key fragment`);
	}

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
	// isotest_ marker. Real research projects are never referenced.
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
