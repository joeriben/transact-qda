// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stack-Prüfung: Ein Naming IST sein Stack.
 *
 * Prüft über die echte API, dass die Akte der Forschenden in den Stack des
 * Namings gehen, statt neue Namings zu erzeugen, und dass nichts hart gelöscht
 * wird (CLAUDE.md, Abschnitt A und C):
 *   - Memo ZU einem Naming = Akt in seinem Stack, hebt cue → characterization,
 *     kein Memo-Naming, keine Verknüpfungs-Participation (BJ, 09.11.2026).
 *   - Umbenennen und Designieren mit Notiz = ein Akt, keine neuen Namings.
 *   - Zurückziehen/Wiederherstellen = Markierung + Akt (migrations/038).
 *   - Relation: erster Akt trägt Inschrift/Valenz, Stufe nach der Regel aus
 *     S09; dasselbe Paar ein zweites Mal → 409 statt Serverfehler.
 *   - Entität/Relation-Wechsel und Valenzänderung = Akt (migrations/009).
 *   - Zusammenführen = Akt im Stack des Überlebenden, kein hartes Löschen.
 *
 * Legt einen Wegwerf-Nutzer `stacktest_…` mit einem Projekt an und löscht am
 * Ende nur, was es selbst angelegt hat.
 *
 *   DATABASE_URL  default postgresql://tqda:tqda_dev@localhost:5432/transact_qda
 *   APP_URL       default http://localhost:5174
 *
 * Exit-Code ≠ 0 bei einem FAIL.
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { loadEnv } from './lib/load-env.js';

loadEnv();

const DATABASE_URL =
	process.env.DATABASE_URL || 'postgresql://tqda:tqda_dev@localhost:5432/transact_qda';
const APP_URL = (process.env.APP_URL || 'http://localhost:5174').replace(/\/$/, '');

const PREFIX = 'stacktest_';
const stamp = Date.now();
const created = { userIds: /** @type {string[]} */ ([]), projectIds: /** @type {string[]} */ ([]) };
const pool = new pg.Pool({ connectionString: DATABASE_URL });

/** @type {Array<{ name: string; ok: boolean; detail: string }>} */
const results = [];
function record(name, ok, detail = '') {
	results.push({ name, ok, detail });
}

// ---- HTTP -------------------------------------------------------------------

async function register() {
	const username = `${PREFIX}${stamp}`;
	const res = await fetch(`${APP_URL}/api/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, email: `${username}@stacktest.local`, password: `pw-${randomUUID()}`, displayName: 'Stack-Test' })
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.userId) throw new Error(`register failed: ${res.status} ${JSON.stringify(body)}`);
	const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
	const cookie = all.map((c) => /(^|;\s*)(tqda_session=[^;]+)/.exec(c)?.[2]).find(Boolean);
	if (!cookie) throw new Error('register returned no session cookie');
	created.userIds.push(body.userId);
	return cookie;
}

let cookie = '';
async function post(path, body) {
	const res = await fetch(`${APP_URL}${path}`, {
		method: 'POST',
		headers: { cookie, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ---- DB-Abfragen ------------------------------------------------------------

const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

async function namingCount(projectId) {
	return (await one(`SELECT count(*)::int AS c FROM namings WHERE project_id = $1`, [projectId])).c;
}
async function memoCount(projectId) {
	return (await one(
		`SELECT count(*)::int AS c FROM memo_content mc JOIN namings n ON n.id = mc.naming_id WHERE n.project_id = $1`,
		[projectId]
	)).c;
}
async function lastAct(namingId) {
	return one(
		`SELECT inscription, designation, mode, valence, memo_text, linked_naming_ids
		   FROM naming_acts WHERE naming_id = $1 ORDER BY seq DESC LIMIT 1`,
		[namingId]
	);
}
async function designationOf(namingId) {
	return (await one(
		`SELECT designation FROM naming_acts WHERE naming_id = $1 AND designation IS NOT NULL ORDER BY seq DESC LIMIT 1`,
		[namingId]
	))?.designation;
}
async function actCount(namingId) {
	return (await one(`SELECT count(*)::int AS c FROM naming_acts WHERE naming_id = $1`, [namingId])).c;
}

// ---- Ablauf -----------------------------------------------------------------

async function run() {
	cookie = await register();
	const pr = await post('/api/projects', { name: `${PREFIX}${stamp}` });
	if (!pr.body.id) throw new Error(`create project failed: ${pr.status}`);
	const P = pr.body.id;
	created.projectIds.push(P);
	const mapId = (await one(
		`SELECT n.id FROM namings n JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		  WHERE n.project_id = $1 AND a.mode = 'perspective' AND a.properties ? 'mapType' AND n.deleted_at IS NULL
		  ORDER BY n.seq DESC LIMIT 1`,
		[P]
	))?.id;
	if (!mapId) throw new Error('new project has no map');
	const N = `/api/projects/${P}/namings`;
	const M = `/api/projects/${P}/maps/${mapId}`;

	const make = async (inscription) => {
		const r = await post(M, { action: 'addElement', inscription, properties: { x: 0, y: 0 } });
		if (!r.body.id) throw new Error(`addElement ${inscription}: ${r.status} ${JSON.stringify(r.body)}`);
		return r.body.id;
	};
	const X = await make('Schulleitung');
	const Y = await make('Elternbeirat');
	const Z = await make('Kultusministerium');
	record('neue Namings beginnen als cue', (await designationOf(X)) === 'cue', String(await designationOf(X)));

	// 1. Gleicher Name auf derselben Map: 409, kein zweites Naming
	{
		const before = await namingCount(P);
		const r = await post(M, { action: 'addElement', inscription: '  schulleitung ', properties: {} });
		record('gleicher Name auf derselben Map → 409, kein neues Naming',
			r.status === 409 && r.body.id === X && (await namingCount(P)) === before, `status ${r.status}`);
	}

	// 2. Memo zu einem Naming
	{
		const before = { n: await namingCount(P), m: await memoCount(P) };
		const r = await post(N, { action: 'note', namingId: X, memoText: 'Entscheidet über Ausnahmen.', linkedNamingIds: [Y] });
		const a = await lastAct(X);
		record('Memo zu einem Naming: kein neues Naming, kein Memo-Naming',
			r.status < 300 && (await namingCount(P)) === before.n && (await memoCount(P)) === before.m,
			`status ${r.status}, namings ${before.n}→${await namingCount(P)}, memos ${before.m}→${await memoCount(P)}`);
		record('Memo steht als Akt im Stack, mit Verweis',
			a?.memo_text === 'Entscheidet über Ausnahmen.' && (a?.linked_naming_ids ?? []).includes(Y), JSON.stringify(a));
		record('Memo hebt cue → characterization', (await designationOf(X)) === 'characterization', String(await designationOf(X)));
		const again = await actCount(X);
		await post(N, { action: 'note', namingId: X, memoText: 'Zweite Notiz.' });
		const b = await lastAct(X);
		record('zweite Notiz: ein Akt, keine weitere Hebung', (await actCount(X)) === again + 1 && b?.designation === null, JSON.stringify(b));
	}

	// 3. Umbenennen und Designieren mit Notiz
	{
		const before = await namingCount(P);
		await post(N, { action: 'rename', namingId: Y, inscription: 'Schulelternbeirat', memoText: 'So heißt er offiziell.' });
		const a = await lastAct(Y);
		record('Umbenennen mit Notiz: ein Akt mit Inschrift und Notiz, hebt den Cue',
			a?.inscription === 'Schulelternbeirat' && a?.memo_text === 'So heißt er offiziell.' && a?.designation === 'characterization',
			JSON.stringify(a));
		await post(N, { action: 'designate', namingId: Z, designation: 'specification', memoText: 'Erlass liegt vor.' });
		const b = await lastAct(Z);
		record('Designieren mit Notiz: ein Akt mit Stufe und Notiz',
			b?.designation === 'specification' && b?.memo_text === 'Erlass liegt vor.', JSON.stringify(b));
		record('Umbenennen/Designieren erzeugen keine Namings', (await namingCount(P)) === before, `${before}→${await namingCount(P)}`);
	}

	// 4. Zurückziehen und Wiederherstellen
	{
		await post(M, { action: 'withdraw', namingId: Z, withdrawn: true });
		const w = await one(
			`SELECT (SELECT COALESCE((properties->>'withdrawn')::boolean, false) FROM appearances WHERE naming_id = $1 AND perspective_id = $2) AS flag,
			        (SELECT deleted_at IS NULL FROM namings WHERE id = $1) AS alive,
			        (SELECT count(*)::int FROM situating_acts WHERE naming_id = $1 AND act = 'withdraw') AS acts`,
			[Z, mapId]
		);
		record('Zurückziehen markiert, löscht nicht, steht als Akt', w.flag === true && w.alive === true && w.acts === 1, JSON.stringify(w));
		await post(M, { action: 'withdraw', namingId: Z, withdrawn: false });
		const r = await one(
			`SELECT (SELECT COALESCE((properties->>'withdrawn')::boolean, false) FROM appearances WHERE naming_id = $1 AND perspective_id = $2) AS flag,
			        (SELECT count(*)::int FROM situating_acts WHERE naming_id = $1 AND act = 'restore') AS acts`,
			[Z, mapId]
		);
		record('Wiederherstellen hebt die Markierung auf und steht als Akt', r.flag === false && r.acts === 1, JSON.stringify(r));
	}

	// 5. Relationen
	let R = null;
	{
		const r1 = await post(M, { action: 'relate', sourceId: X, targetId: Z, inscription: 'beantragt Ausnahme bei' });
		R = r1.body.id;
		const first = await one(`SELECT inscription, valence, designation FROM naming_acts WHERE naming_id = $1 ORDER BY seq LIMIT 1`, [R]);
		record('benannte Relation ohne Valenz beginnt als characterization, Inschrift im ersten Akt',
			r1.status === 201 && first?.designation === 'characterization' && first?.inscription === 'beantragt Ausnahme bei', JSON.stringify(first));
		const r2 = await post(M, { action: 'relate', sourceId: Y, targetId: Z, valence: 'kritisiert' });
		const first2 = await one(`SELECT valence, designation FROM naming_acts WHERE naming_id = $1 ORDER BY seq LIMIT 1`, [r2.body.id]);
		record('Relation nur mit Valenz bleibt cue (S09)', first2?.designation === 'cue' && first2?.valence === 'kritisiert', JSON.stringify(first2));
		const before = await namingCount(P);
		const r3 = await post(M, { action: 'relate', sourceId: X, targetId: Z, inscription: 'noch einmal' });
		record('dasselbe Paar ein zweites Mal → 409, kein neues Naming',
			r3.status === 409 && r3.body.alreadyRelated === true && r3.body.id === R && (await namingCount(P)) === before, `status ${r3.status}`);
		await post(N, { action: 'setValence', namingId: R, valence: 'fordert' });
		const v = await lastAct(R);
		record('Valenzänderung steht als Akt im Stack', v?.valence === 'fordert', JSON.stringify(v));
	}

	// 6. Entität ↔ Relation auf einer Map
	{
		const W = await make('Ganztagsangebot');
		await post(M, { action: 'switchAppearanceMode', namingId: W, mode: 'relation', sourceId: X, targetId: Y });
		const a = await lastAct(W);
		await post(M, { action: 'switchAppearanceMode', namingId: W, mode: 'entity' });
		const b = await lastAct(W);
		const p = await one(`SELECT naming_id = $2 AND participant_id = $3 AS same FROM participations WHERE id = $1`, [W, X, Y]);
		record('Wechsel Entität/Relation stehen als Akte, Endpunkte bleiben',
			a?.mode === 'relation' && b?.mode === 'entity' && p?.same === true, JSON.stringify({ a: a?.mode, b: b?.mode, p }));
		const r = await post(M, { action: 'switchAppearanceMode', namingId: W, mode: 'relation', sourceId: Y, targetId: Z });
		record('fremde Endpunkte überschreiben die Relation nicht (409)', r.status === 409, `status ${r.status}`);
		const W2 = await make('Hausaufgabenzeit');
		const E1 = await make('Lernbüro');
		const E2 = await make('Förderstunde');
		const before = await namingCount(P);
		await post(M, { action: 'switchAppearanceMode', namingId: W2, mode: 'relation', sourceId: E1, targetId: E2, memoText: 'eher ein Verhältnis als ein Ding' });
		const c = await lastAct(W2);
		record('Wechsel mit Notiz: Notiz im selben Akt, Cue gehoben, kein neues Naming',
			c?.mode === 'relation' && c?.memo_text === 'eher ein Verhältnis als ein Ding' && c?.designation === 'characterization'
				&& (await namingCount(P)) === before, JSON.stringify(c));
	}

	// 7. Zusammenführen
	{
		const A1 = await make('Mensa');
		const A2 = await make('Schulmensa');
		await post(N, { action: 'note', namingId: A2, memoText: 'Nur mittags geöffnet.' });
		const A3 = await make('Kantine');
		await post(N, { action: 'note', namingId: A3, memoText: 'Wie die Schulmensa.', linkedNamingIds: [A2] });
		const appsBefore = (await one(`SELECT count(*)::int AS c FROM appearances WHERE naming_id = $1`, [A2])).c;
		const r = await post(N, { action: 'merge', survivorId: A1, mergedId: A2 });
		// Der Merge-Akt selbst trägt kein Memo, nur den Verweis auf das
		// aufgenommene Naming; die Memos, die es mitbrachte, folgen ihm.
		const mergeAct = await one(
			`SELECT seq FROM naming_acts
			  WHERE naming_id = $1 AND memo_text IS NULL AND inscription IS NULL AND designation IS NULL
			    AND mode IS NULL AND valence IS NULL AND $2 = ANY(linked_naming_ids)
			  ORDER BY seq DESC LIMIT 1`,
			[A1, A2]
		);
		// Das Memo bleibt im Stack des aufgenommenen Namings (Zeit, Kontext)
		// und steht im Stack des Überlebenden unter dem Merge-Akt; ein eigener
		// Akt hebt den Cue (ein Memo hebt einen Cue).
		const kept = await one(
			`SELECT count(*)::int AS c FROM naming_acts WHERE naming_id = $1 AND memo_text = 'Nur mittags geöffnet.'`,
			[A2]
		);
		const copied = await one(
			`SELECT count(*)::int AS c FROM naming_acts WHERE naming_id = $1 AND memo_text = 'Nur mittags geöffnet.'`,
			[A1]
		);
		const lift = await one(
			`SELECT count(*)::int AS c FROM naming_acts
			  WHERE naming_id = $1 AND designation = 'characterization' AND memo_text IS NULL AND $2 = ANY(linked_naming_ids)`,
			[A1, A2]
		);
		const stack = await post(N, { action: 'getStack', namingId: A1 });
		const shown = (stack.body?.acts ?? []).some((a) =>
			(a.absorbed ?? []).some((b) => b.memo_text === 'Nur mittags geöffnet.'));
		// Ein Verweis auf das aufgenommene Naming zeigt auf den Überlebenden.
		const s3 = await post(N, { action: 'getStack', namingId: A3 });
		const pointsToSurvivor = (s3.body?.acts ?? []).some((a) => (a.linked ?? []).some((l) => l.id === A1));
		const referred = (stack.body?.referringNotes ?? []).some((n) => n.memo_text === 'Wie die Schulmensa.');
		record('Zusammenführen: Verweise auf das aufgenommene Naming zeigen auf den Überlebenden',
			pointsToSurvivor && referred, JSON.stringify({ pointsToSurvivor, referred }));
		const carried = { c: kept.c === 1 && copied.c === 0 && lift.c === 1 && shown ? 1 : 0, kept: kept.c, copied: copied.c, lift: lift.c, shown };
		const m = await one(
			`SELECT (SELECT deleted_at IS NOT NULL FROM namings WHERE id = $1) AS soft_deleted,
			        (SELECT count(*)::int FROM appearances WHERE naming_id = $1) AS apps`,
			[A2]
		);
		record('Zusammenführen: Akt im Stack des Überlebenden, Stack des Aufgenommenen darunter (nicht kopiert), Cue gehoben, aufgenommenes Naming soft-gelöscht, Erscheinung bleibt',
			r.status < 300 && !!mergeAct && carried.c === 1 && m.soft_deleted === true && m.apps === appsBefore,
			JSON.stringify({ status: r.status, mergeAct: !!mergeAct, carried, m, appsBefore }));
	}

	// 7b. Eine Relation zwischen den beiden wird keine Relation mit sich selbst.
	{
		const B1 = await make('Hausmeister');
		const B2 = await make('Hauswart');
		const rel = await post(M, { action: 'relate', sourceId: B2, targetId: B1, inscription: 'vertritt' });
		const r = await post(N, { action: 'merge', survivorId: B1, mergedId: B2 });
		const loop = await one(
			`SELECT count(*)::int AS c FROM participations p JOIN namings n ON n.id = p.id
			  WHERE p.naming_id = $1 AND p.participant_id = $1 AND n.deleted_at IS NULL`,
			[B1]
		);
		const relDeleted = await one(`SELECT deleted_at IS NOT NULL AS d FROM namings WHERE id = $1`, [rel.body.id]);
		record('Zusammenführen: Relation zwischen beiden wird nicht zur Relation mit sich selbst (bleibt soft-gelöscht)',
			r.status < 300 && loop.c === 0 && relDeleted?.d === true,
			JSON.stringify({ status: r.status, loop: loop.c, relDeleted }));
	}

	// 8. Anlegen in der Naming-Liste und in der Dokumentansicht: der Stack
	//    beginnt mit der Inschrift als Cue, und das Naming steht unplatziert
	//    auf der Situations-Map (S26: nicht willkürlich ausschließen).
	{
		const founding = (id) =>
			one(`SELECT inscription, designation FROM naming_acts WHERE naming_id = $1 ORDER BY seq ASC LIMIT 1`, [id]);
		const unplacedOnPrimary = async (id) =>
			(await one(
				`SELECT count(*)::int AS c FROM appearances a
				   JOIN namings pm ON pm.id = a.perspective_id
				   JOIN appearances pa ON pa.naming_id = pm.id AND pa.perspective_id = pm.id
				  WHERE a.naming_id = $1 AND a.mode = 'entity' AND a.properties->>'x' IS NULL
				    AND (pa.properties->>'isPrimary')::boolean = true`,
				[id]
			)).c;
		const L = await post(N, { action: 'create', inscription: 'Pausenhof' });
		const lf = L.body.id ? await founding(L.body.id) : null;
		const lm = L.body.id ? await unplacedOnPrimary(L.body.id) : 0;
		record('Liste: Stack beginnt mit Inschrift als Cue, Naming unplatziert auf der Situations-Map',
			L.status === 201 && lf?.inscription === 'Pausenhof' && lf?.designation === 'cue' && lm === 1,
			JSON.stringify({ status: L.status, lf, lm }));
		const D = await post(`/api/projects/${P}/naming-candidates`, { label: 'Sammelbox' });
		const df = D.body.id ? await founding(D.body.id) : null;
		const dm = D.body.id ? await unplacedOnPrimary(D.body.id) : 0;
		record('Dokument: Stack beginnt mit Inschrift als Cue, Naming unplatziert auf der Situations-Map',
			D.status === 201 && df?.inscription === 'Sammelbox' && df?.designation === 'cue' && dm === 1,
			JSON.stringify({ status: D.status, df, dm }));
	}

	record('kein Memo-Naming im ganzen Ablauf', (await memoCount(P)) === 0, String(await memoCount(P)));
}

// ---- Aufräumen --------------------------------------------------------------

async function cleanup() {
	try {
		if (created.projectIds.length > 0) {
			await pool.query(
				`DELETE FROM topology_snapshots ts USING namings n WHERE ts.map_id = n.id AND n.project_id = ANY($1::uuid[])`,
				[created.projectIds]
			);
			await pool.query(`DELETE FROM projects WHERE id = ANY($1::uuid[]) AND name LIKE $2`, [created.projectIds, `${PREFIX}%`]);
		}
		if (created.userIds.length > 0) {
			await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[]) AND username LIKE $2`, [created.userIds, `${PREFIX}%`]);
		}
	} catch (err) {
		console.error('[cleanup] WARNING:', err instanceof Error ? err.message : err);
	}
}

function report() {
	const pad = Math.max(...results.map((r) => r.name.length), 10);
	console.log('\nStack verification');
	console.log('='.repeat(pad + 24));
	for (const r of results) console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.name.padEnd(pad)}  ${r.detail}`);
	const failed = results.filter((r) => !r.ok);
	console.log('='.repeat(pad + 24));
	console.log(`  ${results.length - failed.length}/${results.length} passed\n`);
	return failed.length === 0;
}

let exitCode = 0;
try {
	await run();
} catch (err) {
	console.error('[run] ERROR:', err instanceof Error ? err.stack : err);
	record('script completed without throwing', false, String(err));
} finally {
	await cleanup();
	exitCode = report() ? 0 : 1;
	await pool.end();
}
process.exit(exitCode);
