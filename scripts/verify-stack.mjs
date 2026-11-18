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
 *   - Jede Schicht des Stacks ist aktivierbar (migrations/040, BJ 17.11.2026):
 *     im Datenraum durch einen neuen Akt, der die Schicht aufnimmt
 *     (activates_seq, kein neues Naming, nichts überschrieben); unter einer
 *     Perspektive (Map, Phase) durch Kollaps, und Kollaps wie Rückkehr zur
 *     obersten Schicht stehen als Akt im Situierungs-Protokoll. Die Map zeigt
 *     die kollabierte Schicht, die Liste die oberste. Schichten folgen der
 *     Zeit der Akte, nicht der seq. Fremde Schichten und fremde Projekte
 *     werden abgewiesen.
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
import * as devalue from 'devalue';
import { loadEnv } from './lib/load-env.js';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

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
/** Daten einer Seite, wie die Oberfläche sie lädt (SvelteKit __data.json). */
async function pageData(path) {
	const res = await fetch(`${APP_URL}${path}/__data.json`, { headers: { cookie } });
	const body = await res.json().catch(() => ({}));
	return (body.nodes ?? []).map((n) => (n?.type === 'data' ? devalue.unflatten(n.data) : null));
}
/** Ein Naming in einer Liste der Seitendaten (z. B. elements, namings). */
function rowOf(nodes, key, namingId) {
	const page = nodes[nodes.length - 1] ?? {};
	return (page[key] ?? []).find((r) => r.naming_id === namingId) ?? null;
}

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
		// Nachträglich benannt: steht, wo sie mit diesem Namen beim Anlegen
		// gestanden hätte (Valenz + Name → specification); nur der erste Name hebt.
		const rn1 = await post(N, { action: 'rename', namingId: r2.body.id, inscription: 'hält für zu laut' });
		const d1 = await designationOf(r2.body.id);
		const rn2 = await post(N, { action: 'rename', namingId: r2.body.id, inscription: 'hält für laut' });
		const d2 = await lastAct(r2.body.id);
		record('Relation nachträglich benannt: erster Name hebt wie beim Anlegen, weiterer nicht',
			rn1.status === 200 && rn1.body.liftedTo === 'specification' && d1 === 'specification'
				&& rn2.status === 200 && !rn2.body.liftedTo && d2?.designation === null,
			JSON.stringify({ d1, lifted: rn1.body.liftedTo, again: rn2.body.liftedTo ?? null }));
	}

	// 5b. Freies Memo auf Namings beziehen und den Bezug wieder lösen
	{
		const mm = await post(`/api/projects/${P}/memos`, { label: 'Lärm im Haus', content: 'Wer klagt worüber?' });
		const memoId = mm.body.id;
		const MM = `/api/projects/${P}/memos/${memoId}`;
		const before = await namingCount(P);
		const l1 = await post(MM, { action: 'link', namingId: X });
		const l2 = await post(MM, { action: 'link', namingId: X });
		const linked = await one(
			`SELECT count(*)::int AS c FROM participations p JOIN namings pn ON pn.id = p.id AND pn.deleted_at IS NULL
			  WHERE (p.naming_id = $1 AND p.participant_id = $2) OR (p.naming_id = $2 AND p.participant_id = $1)`,
			[memoId, X]
		);
		const listed = await one(
			`SELECT count(*)::int AS c FROM appearances a JOIN appearances ms ON ms.naming_id = a.perspective_id
			   AND ms.perspective_id = a.perspective_id AND ms.properties->>'role' = 'memo-system'
			  WHERE a.naming_id = $1`,
			[l1.body.id]
		);
		const u = await post(MM, { action: 'unlink', linkId: l1.body.id });
		const gone = await one(`SELECT deleted_at IS NOT NULL AS soft FROM namings WHERE id = $1`, [l1.body.id]);
		record('Freies Memo: Bezug als Participation (einmal), nur auf der Memo-Perspektive, Lösen markiert nur',
			l1.status === 200 && l2.body.already === true && linked.c === 1 && listed.c >= 1
				&& u.status === 200 && gone.soft === true && (await namingCount(P)) === before + 1,
			JSON.stringify({ linked: linked.c, listed: listed.c, soft: gone.soft }));
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

	// 7c. Stand das übrige Naming unplatziert und das aufgenommene platziert,
	//     übernimmt es dessen Lage; das Platzieren steht in seinem Stack, und
	//     der Stack des aufgenommenen zeigt dessen eigene Platzierung weiter.
	{
		const C1 = (await post(N, { action: 'create', inscription: 'Schulhof' })).body.id;
		const C2 = await make('Hof');
		await post(M, { action: 'updatePosition', namingId: C2, x: 120, y: -80 });
		const r = await post(N, { action: 'merge', survivorId: C1, mergedId: C2 });
		const pos = await one(
			`SELECT properties->>'x' AS x, properties->>'y' AS y FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
			[C1, mapId]
		);
		const situated = await one(
			`SELECT count(*)::int AS c FROM situating_acts WHERE naming_id = $1 AND map_id = $2 AND act = 'situate'`,
			[C1, mapId]
		);
		const stack = await post(N, { action: 'getStack', namingId: C1 });
		const absorbedPlaced = (stack.body?.acts ?? []).some((a) => (a.absorbed ?? []).some((b) => b.kind === 'situate'));
		record('Zusammenführen: unplatziertes übriges Naming übernimmt die Lage des aufgenommenen (Platzierungsakt), dessen Platzierung bleibt in seinem Stack sichtbar',
			r.status < 300 && Number(pos?.x) === 120 && Number(pos?.y) === -80 && situated.c === 1 && absorbedPlaced,
			JSON.stringify({ status: r.status, pos, situated: situated.c, absorbedPlaced }));
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

	// 9. Jede Schicht des Stacks aktivieren (migrations/040, BJ 17.11.2026).
	//    „jedes Naming erhält eben einen INdex (default ist das oberste), und
	//    diser INdex ist sein Collapse" (S03). Die Map behält ihren Index (S09).
	{
		const S = await make('Lehrerzimmer');
		await post(N, { action: 'rename', namingId: S, inscription: 'Kollegium' });
		await post(N, { action: 'note', namingId: S, memoText: 'Wer trifft sich dort?' });
		await post(N, { action: 'rename', namingId: S, inscription: 'Konferenz' });
		const stackOf = async (id) => (await post(N, { action: 'getStack', namingId: id })).body ?? {};
		const layer = (st, ins, des) =>
			(st.acts ?? []).find((a) => a.kind === 'act' && a.inscription === ins && (des === undefined || a.designation === des));
		let st = await stackOf(S);
		const L0 = layer(st, 'Lehrerzimmer', 'cue');
		const L1 = layer(st, 'Kollegium');
		const L3 = layer(st, 'Konferenz');
		record('Stack zeigt jede Schicht mit ihrem Zustand, oberste Schicht benannt',
			!!L0 && !!L1 && !!L3 && st.currentLayerSeq === String(L3.seq)
				&& L0.state?.inscription === 'Lehrerzimmer' && L0.state?.designation === 'cue'
				&& L1.state?.inscription === 'Kollegium' && L1.state?.designation === 'cue'
				&& L3.state?.designation === 'characterization',
			JSON.stringify({ L0: L0?.state, L1: L1?.state, L3: L3?.state, top: st.currentLayerSeq, L3seq: L3?.seq }));

		// 9a. Im Datenraum: frühere Schicht wird wieder die oberste, als neuer Akt.
		const before = { n: await namingCount(P), m: await memoCount(P), acts: await actCount(S) };
		const earlier = (await pool.query(
			`SELECT seq, inscription, designation, memo_text FROM naming_acts WHERE naming_id = $1 ORDER BY seq`, [S]
		)).rows;
		const a1 = await post(N, { action: 'activateLayer', namingId: S, seq: L0.seq });
		const act1 = await one(
			`SELECT seq, inscription, designation, activates_seq, by FROM naming_acts WHERE naming_id = $1 ORDER BY seq DESC LIMIT 1`, [S]
		);
		const now = await one(`SELECT inscription FROM namings WHERE id = $1`, [S]);
		const unchanged = (await pool.query(
			`SELECT seq, inscription, designation, memo_text FROM naming_acts WHERE naming_id = $1 AND seq <= $2 ORDER BY seq`,
			[S, earlier[earlier.length - 1].seq]
		)).rows;
		record('Schicht aktivieren: neuer Akt nimmt Inschrift und Designation der Schicht auf (activates_seq), Naming heißt wieder so',
			a1.status === 200 && act1?.activates_seq === String(L0.seq) && act1?.inscription === 'Lehrerzimmer'
				&& act1?.designation === 'cue' && now?.inscription === 'Lehrerzimmer',
			JSON.stringify({ status: a1.status, body: a1.body?.error, act1, now }));
		record('Schicht aktivieren: kein neues Naming, kein Memo-Naming, frühere Akte unverändert',
			(await namingCount(P)) === before.n && (await memoCount(P)) === before.m && (await actCount(S)) === before.acts + 1
				&& JSON.stringify(unchanged) === JSON.stringify(earlier),
			JSON.stringify({ namings: [before.n, await namingCount(P)], acts: [before.acts, await actCount(S)] }));
		st = await stackOf(S);
		const shownAct = (st.acts ?? []).find((a) => String(a.seq) === String(act1?.seq));
		record('Stack zeigt den Aktivierungsakt mit der aufgenommenen Schicht als oberste',
			st.currentLayerSeq === String(act1?.seq) && shownAct?.activates_seq === String(L0.seq)
				&& shownAct?.activates?.inscription === 'Lehrerzimmer',
			JSON.stringify({ top: st.currentLayerSeq, act: act1?.seq, activates: shownAct?.activates }));

		const a2 = await post(N, { action: 'activateLayer', namingId: S, seq: L0.seq });
		record('dieselbe Schicht noch einmal → 409, kein Akt', a2.status === 409 && (await actCount(S)) === before.acts + 1, `status ${a2.status}`);

		const a3 = await post(M, { action: 'activateLayer', namingId: S, seq: L1.seq, memoText: 'Doch eher die Leute als der Raum.' });
		const act3 = await lastAct(S);
		record('Schicht mit Memo aktivieren (auch von der Map aus): Memo im selben Akt, Cue gehoben',
			a3.status === 200 && act3?.inscription === 'Kollegium' && act3?.memo_text === 'Doch eher die Leute als der Raum.'
				&& act3?.designation === 'characterization' && a3.body?.liftedTo === 'characterization',
			JSON.stringify({ status: a3.status, act3, lifted: a3.body?.liftedTo }));

		const foreign = await one(`SELECT seq FROM naming_acts WHERE naming_id = $1 ORDER BY seq LIMIT 1`, [X]);
		const a4 = await post(N, { action: 'activateLayer', namingId: S, seq: foreign.seq });
		record('Schicht eines anderen Namings → 404', a4.status === 404, `status ${a4.status}`);

		// 9b. Unter einer Perspektive: die Map kollabiert auf eine Schicht.
		const situated = async (act) => (await one(
			`SELECT count(*)::int AS c FROM situating_acts WHERE naming_id = $1 AND map_id = $2 AND act = $3`, [S, mapId, act]
		)).c;
		const topNow = (await stackOf(S)).currentLayerSeq;
		const c1 = await post(M, { action: 'setCollapse', namingId: S, collapseAt: L3.seq });
		const app = await one(
			`SELECT properties->>'collapseAt' AS at FROM appearances WHERE naming_id = $1 AND perspective_id = $2`, [S, mapId]
		);
		const cAct = await one(
			`SELECT sa.collapse_at, sa.by, n.inscription AS by_label FROM situating_acts sa JOIN namings n ON n.id = sa.by
			  WHERE sa.naming_id = $1 AND sa.map_id = $2 AND sa.act = 'collapse' ORDER BY sa.created_at DESC LIMIT 1`,
			[S, mapId]
		);
		record('Map auf eine Schicht kollabieren: Index an der Erscheinung, Kollaps als Akt mit Schicht und Urheber',
			c1.status === 200 && app?.at === String(L3.seq) && cAct?.collapse_at === String(L3.seq) && !!cAct?.by,
			JSON.stringify({ status: c1.status, at: app?.at, cAct }));
		const c2 = await post(M, { action: 'setCollapse', namingId: S, collapseAt: L3.seq });
		record('derselbe Kollaps noch einmal ist kein zweiter Akt', c2.status === 200 && (await situated('collapse')) === 1,
			`status ${c2.status}, collapse acts ${await situated('collapse')}`);

		// Was die Oberfläche lädt: die Map zeigt die kollabierte Schicht, die
		// oberste daneben; die Liste die oberste.
		const mapData = await pageData(`/projects/${P}/maps/${mapId}`);
		const el = rowOf(mapData, 'elements', S);
		record('Map zeigt die kollabierte Schicht und daneben die oberste',
			el?.inscription === 'Konferenz' && el?.designation === 'characterization' && el?.is_collapsed === true
				&& el?.current_inscription === 'Kollegium',
			JSON.stringify(el ? { ins: el.inscription, des: el.designation, collapsed: el.is_collapsed, now: el.current_inscription } : null));
		st = await stackOf(S);
		const persp = (st.perspectives ?? []).find((p) => p.id === mapId);
		const cEntry = (st.acts ?? []).find((a) => a.kind === 'collapse');
		record('Stack nennt die Perspektive mit ihrer Schicht und den Kollaps-Akt',
			persp?.layerSeq === String(L3.seq) && st.currentLayerSeq === topNow && cEntry?.collapse_layer?.inscription === 'Konferenz',
			JSON.stringify({ persp, top: st.currentLayerSeq, cEntry: cEntry?.collapse_layer }));
		const listData = await pageData(`/projects/${P}/namings`);
		const row = rowOf(listData, 'namings', S);
		record('Liste zeigt die oberste Schicht', row?.inscription === 'Kollegium' && row?.designation === 'characterization',
			JSON.stringify(row ? { ins: row.inscription, des: row.designation } : null));

		const c3 = await post(M, { action: 'setCollapse', namingId: S, collapseAt: null });
		const app2 = await one(
			`SELECT properties ? 'collapseAt' AS has FROM appearances WHERE naming_id = $1 AND perspective_id = $2`, [S, mapId]
		);
		const el2 = rowOf(await pageData(`/projects/${P}/maps/${mapId}`), 'elements', S);
		record('Map folgt wieder der obersten Schicht: Index entfernt, Rückkehr als Akt, Map zeigt die oberste',
			c3.status === 200 && app2?.has === false && (await situated('release')) === 1
				&& el2?.inscription === 'Kollegium' && el2?.is_collapsed === false,
			JSON.stringify({ status: c3.status, has: app2?.has, release: await situated('release'), ins: el2?.inscription }));

		const c4 = await post(M, { action: 'setCollapse', namingId: S, collapseAt: foreign.seq });
		record('Kollaps auf die Schicht eines anderen Namings → 404, kein Akt',
			c4.status === 404 && (await situated('collapse')) === 1, `status ${c4.status}`);

		// 9c. Phase: speichert den Index zur Zeit der Zuweisung (S03), behält ihn.
		const ph = await post(M, { action: 'createPhase', inscription: 'Erste Runde' });
		const phaseId = ph.body?.id;
		await post(M, { action: 'assignToPhase', phaseId, namingId: S });
		const topAtAssign = (await stackOf(S)).currentLayerSeq;
		await post(N, { action: 'rename', namingId: S, inscription: 'Gesamtkonferenz' });
		st = await stackOf(S);
		const pPhase = (st.perspectives ?? []).find((p) => p.id === phaseId);
		const pc = await post(N, { action: 'setCollapse', namingId: S, perspectiveId: phaseId, collapseAt: L0.seq });
		const pPhase2 = ((await stackOf(S)).perspectives ?? []).find((p) => p.id === phaseId);
		record('Phase behält die Schicht der Zuweisung, lässt sich (aus der Liste) auf eine andere kollabieren',
			!!phaseId && pPhase?.kind === 'phase' && pPhase?.layerSeq === topAtAssign && st.currentLayerSeq !== topAtAssign
				&& pc.status === 200 && pPhase2?.layerSeq === String(L0.seq),
			JSON.stringify({ phase: pPhase, topAtAssign, top: st.currentLayerSeq, after: pPhase2, status: pc.status }));

		// 9d. Schichten folgen der Zeit, nicht der seq: ein Nachtrag mit
		//     früherem Datum (wie renameNaming ihn schreibt) ist nicht die oberste.
		const T = await make('Alpha');
		await new Promise((r) => setTimeout(r, 20));
		await post(N, { action: 'rename', namingId: T, inscription: 'Beta' });
		const t0 = await one(`SELECT created_at, by FROM naming_acts WHERE naming_id = $1 ORDER BY seq LIMIT 1`, [T]);
		const late = await one(
			`INSERT INTO naming_acts (naming_id, by, inscription, created_at)
			 VALUES ($1, $2, 'Gamma', $3::timestamptz + interval '1 millisecond') RETURNING seq`,
			[T, t0.by, t0.created_at]
		);
		const stT = await stackOf(T);
		const beta = layer(stT, 'Beta');
		const gamma = (stT.acts ?? []).find((a) => String(a.seq) === String(late.seq));
		const z1 = await post(N, { action: 'activateLayer', namingId: T, seq: beta?.seq });
		const z2 = await post(N, { action: 'activateLayer', namingId: T, seq: late.seq });
		record('Schichten in Zeitfolge: der spätere Nachtrag mit früherem Datum ist nicht die oberste, lässt sich aber aktivieren',
			stT.currentLayerSeq === String(beta?.seq) && gamma?.state?.inscription === 'Gamma' && z1.status === 409
				&& z2.status === 200 && (await one(`SELECT inscription FROM namings WHERE id = $1`, [T]))?.inscription === 'Gamma',
			JSON.stringify({ top: stT.currentLayerSeq, beta: beta?.seq, gamma: gamma?.state, z1: z1.status, z2: z2.status }));

		// 9e. Fremdes Projekt: weder aktivieren noch kollabieren.
		const P2 = (await post('/api/projects', { name: `${PREFIX}${stamp}_b` })).body?.id;
		if (P2) created.projectIds.push(P2);
		const f1 = await post(`/api/projects/${P2}/namings`, { action: 'activateLayer', namingId: S, seq: L1.seq });
		const f2 = await post(`/api/projects/${P2}/namings`, { action: 'setCollapse', namingId: S, perspectiveId: mapId, collapseAt: L1.seq });
		const map2 = P2 ? (await one(
			`SELECT n.id FROM namings n JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			  WHERE n.project_id = $1 AND a.mode = 'perspective' AND a.properties ? 'mapType' LIMIT 1`, [P2]
		))?.id : null;
		const f3 = map2 ? await post(`/api/projects/${P2}/maps/${map2}`, { action: 'setCollapse', namingId: S, collapseAt: L1.seq }) : { status: 0 };
		const f4 = map2 ? await post(`/api/projects/${P2}/maps/${map2}`, { action: 'activateLayer', namingId: S, seq: L1.seq }) : { status: 0 };
		record('aus einem anderen Projekt: weder aktivieren noch kollabieren',
			!!P2 && [f1, f2, f3, f4].every((r) => r.status === 404 || r.status === 403) && (await situated('collapse')) === 1,
			JSON.stringify([f1.status, f2.status, f3.status, f4.status]));
	}

	// 10. Befunde der adversarialen Prüfung (17.11.2026)
	{
		const stackOf = async (id) => (await post(N, { action: 'getStack', namingId: id })).body ?? {};
		const firstAct = (st) => (st.acts ?? []).find((a) => a.kind === 'act');

		// 10a. Relation ohne eigenen Namen, später benannt, mit Valenz: die
		//      erste Schicht zurückholen nimmt den Namen weg und die Valenz zurück.
		const A = await make('Hausordnung');
		const B = await make('Schülervertretung');
		const rel = (await post(M, { action: 'relate', sourceId: A, targetId: B, valence: 'kritisiert' })).body.id;
		await post(N, { action: 'rename', namingId: rel, inscription: 'fordert Änderung' });
		await post(N, { action: 'setValence', namingId: rel, valence: 'unterstützt' });
		let st = await stackOf(rel);
		const r0 = firstAct(st);
		const ra = await post(N, { action: 'activateLayer', namingId: rel, seq: r0?.seq });
		const after = await one(
			`SELECT n.inscription, (SELECT valence FROM appearances WHERE naming_id = n.id AND mode = 'relation' LIMIT 1) AS valence
			   FROM namings n WHERE n.id = $1`, [rel]
		);
		const ract = await lastAct(rel);
		record('Relation: Schicht ohne eigenen Namen aktivieren nimmt den Namen weg, holt Stufe und Valenz zurück',
			ra.status === 200 && r0?.state?.inscription === '' && after.inscription === '' && after.valence === 'kritisiert'
				&& ract?.inscription === '' && ract?.designation === 'cue' && ract?.valence === 'kritisiert',
			JSON.stringify({ status: ra.status, err: ra.body?.error, r0: r0?.state, after, ract }));

		// 10b. Dieselbe Schicht ohne Memo: nichts zu tun (409). Mit Memo hebt
		//      sie den Cue (ein reflektierter Cue ist mindestens eine
		//      Characterization) — danach ändert sie auch mit Memo nichts mehr.
		const before = await actCount(rel);
		const rb0 = await post(N, { action: 'activateLayer', namingId: rel, seq: r0?.seq });
		const rb1 = await post(N, { action: 'activateLayer', namingId: rel, seq: r0?.seq, memoText: 'Wer fordert hier?' });
		const rb2 = await post(N, { action: 'activateLayer', namingId: rel, seq: r0?.seq, memoText: 'noch einmal' });
		record('dieselbe Schicht: ohne Memo 409; mit Memo hebt sie den Cue; dann auch mit Memo 409 (kein Memo-Akt als „Aktivierung")',
			rb0.status === 409 && rb1.status === 200 && rb1.body?.liftedTo === 'characterization' && rb2.status === 409
				&& (await actCount(rel)) === before + 1,
			`${rb0.status}/${rb1.status}/${rb2.status}`);

		// 10c. Dieselbe Stufe noch einmal designieren setzt keine leere Schicht.
		const D = await make('Pausenaufsicht');
		await post(N, { action: 'designate', namingId: D, designation: 'characterization' });
		const d0 = await actCount(D);
		const dm = await post(M, { action: 'designate', namingId: D, designation: 'characterization' });
		const dn = await post(N, { action: 'designate', namingId: D, designation: 'characterization' });
		record('dieselbe Stufe noch einmal designieren → 409 (Map und Liste), keine leere Schicht',
			dm.status === 409 && dn.status === 409 && (await actCount(D)) === d0, `${dm.status}/${dn.status}`);

		// 10d. Zwei gleichzeitige Klicks auf „show here" sind ein Akt.
		const D0 = (await stackOf(D)).acts.find((a) => a.kind === 'act' && a.designation === 'cue');
		const [c1, c2] = await Promise.all([
			post(M, { action: 'setCollapse', namingId: D, collapseAt: D0.seq }),
			post(M, { action: 'setCollapse', namingId: D, collapseAt: D0.seq })
		]);
		const nCollapse = (await one(
			`SELECT count(*)::int AS c FROM situating_acts WHERE naming_id = $1 AND map_id = $2 AND act = 'collapse'`, [D, mapId]
		)).c;
		record('zwei gleichzeitige Kollaps-Klicks schreiben einen Akt', c1.status === 200 && c2.status === 200 && nCollapse === 1,
			`${c1.status}/${c2.status}, acts ${nCollapse}`);

		// 10e. Ein Akt auf einer Map, die eine frühere Schicht zeigt: die Map
		//      folgt danach der obersten (Rückkehr als Akt); andere behalten ihren Index.
		const rn = await post(M, { action: 'rename', namingId: D, inscription: 'Hofaufsicht' });
		const rel1 = (await one(
			`SELECT count(*)::int AS c FROM situating_acts WHERE naming_id = $1 AND map_id = $2 AND act = 'release'`, [D, mapId]
		)).c;
		const elD = rowOf(await pageData(`/projects/${P}/maps/${mapId}`), 'elements', D);
		record('Umbenennen auf einer Map mit früherer Schicht: Map folgt danach der obersten, als Akt',
			rn.status === 200 && rn.body?.followed === true && rel1 === 1 && elD?.inscription === 'Hofaufsicht' && elD?.is_collapsed === false,
			JSON.stringify({ status: rn.status, followed: rn.body?.followed, rel1, ins: elD?.inscription }));

		// 10f. Der Index kommt nur über den Kollaps: Eigenschaften vom Client
		//      setzen ihn nicht, und ein Nicht-seq wird abgewiesen.
		const up = await post(M, { action: 'updateProperties', namingId: D, properties: { collapseAt: 'x', note: 1 } });
		const has = await one(`SELECT properties ? 'collapseAt' AS has FROM appearances WHERE naming_id = $1 AND perspective_id = $2`, [D, mapId]);
		const bad1 = await post(M, { action: 'setCollapse', namingId: D, collapseAt: 'x' });
		const bad2 = await post(N, { action: 'activateLayer', namingId: D, seq: '1; drop' });
		const mapOk = (await fetch(`${APP_URL}/projects/${P}/maps/${mapId}/__data.json`, { headers: { cookie } })).status;
		record('collapseAt über Eigenschaften ignoriert, Nicht-seq → 400, Map lädt',
			up.status === 200 && has.has === false && bad1.status === 400 && bad2.status === 400 && mapOk === 200,
			JSON.stringify({ up: up.status, has: has.has, bad1: bad1.status, bad2: bad2.status, mapOk }));

		// 10g. Zusammenführen: Eine Map, die eine Schicht des Aufgenommenen
		//      zeigte, zeigt sie weiter; die Schicht ist im Stack des Überlebenden
		//      aktivierbar.
		const mapK = (await post(`/api/projects/${P}/maps`, { label: 'Lehrmittel', mapType: 'situational' })).body?.id;
		const MK = `/api/projects/${P}/maps/${mapK}`;
		const K1 = await make('Lehrbuch');
		const K2 = (await post(MK, { action: 'addElement', inscription: 'Lehrwerk', properties: { x: 10, y: 10 } })).body.id;
		await post(N, { action: 'rename', namingId: K2, inscription: 'Schulbuch' });
		const k2first = firstAct(await stackOf(K2));
		await post(MK, { action: 'setCollapse', namingId: K2, collapseAt: k2first.seq });
		const mg = await post(N, { action: 'merge', survivorId: K1, mergedId: K2 });
		const elK = rowOf(await pageData(`/projects/${P}/maps/${mapK}`), 'elements', K1);
		const kst = await stackOf(K1);
		const kp = (kst.perspectives ?? []).find((p) => p.id === mapK);
		const ka = await post(N, { action: 'activateLayer', namingId: K1, seq: k2first.seq });
		const kname = await one(`SELECT inscription FROM namings WHERE id = $1`, [K1]);
		record('Zusammenführen: Map zeigt die Schicht des Aufgenommenen weiter; sie ist im Stack des Überlebenden aktivierbar',
			mg.status < 300 && elK?.inscription === 'Lehrwerk' && elK?.is_collapsed === true && kp?.layerSeq === String(k2first.seq)
				&& ka.status === 200 && kname?.inscription === 'Lehrwerk',
			JSON.stringify({ merge: mg.status, el: elK ? { ins: elK.inscription, c: elK.is_collapsed } : null, kp, ka: ka.status, err: ka.body?.error, kname }));

		// 10h. Nachtrag mit auf die Millisekunde gekürzter Zeit (renameNaming
		//      hält die alte Inschrift mit der Zeit des Namings fest): die frühe
		//      Schicht behält ihre Stufe.
		const by = (await one(`SELECT naming_id FROM researcher_namings WHERE project_id = $1 LIMIT 1`, [P])).naming_id;
		const legacy = await one(
			`WITH n AS (INSERT INTO namings (project_id, inscription, created_by)
			            VALUES ($1, 'Machtmechanismus', $2) RETURNING id, created_at),
			      a AS (INSERT INTO naming_acts (naming_id, by, designation, created_at)
			            SELECT id, $3, 'specification', created_at FROM n RETURNING naming_id)
			 SELECT id FROM n`,
			[P, created.userIds[0], by]
		);
		await pool.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties) VALUES ($1, $2, 'entity', '{}')`, [legacy.id, mapId]
		);
		await post(N, { action: 'rename', namingId: legacy.id, inscription: 'Disziplinarmacht' });
		const lst = await stackOf(legacy.id);
		const backfill = (lst.acts ?? []).find((a) => a.kind === 'act' && a.inscription === 'Machtmechanismus');
		const first = firstAct(lst);
		record('Nachtrag mit gekürzter Zeit: frühe Schicht heißt wie damals und behält ihre Stufe',
			backfill?.state?.designation === 'specification' && first?.state?.inscription === 'Machtmechanismus'
				&& first?.state?.designation === 'specification',
			JSON.stringify({ first: first?.state, backfill: backfill?.state }));

		// 10i. Phase zeigt ihre Schicht; eine Vorlagen-Map lässt sich nicht
		//      kollabieren, eine Infrastruktur-Perspektive auch nicht.
		const ph = (await post(M, { action: 'createPhase', inscription: 'Zweite Runde' })).body?.id;
		await post(M, { action: 'assignToPhase', phaseId: ph, namingId: D });
		await post(N, { action: 'rename', namingId: D, inscription: 'Aufsicht im Hof' });
		const members = (await post(`/api/projects/${P}/phases`, { action: 'getMembers', phaseId: ph })).body?.members ?? [];
		const mD = members.find((m) => m.naming_id === D);
		record('Phase zeigt die Schicht der Zuordnung, daneben die oberste',
			mD?.inscription === 'Hofaufsicht' && mD?.is_collapsed === true && mD?.current_inscription === 'Aufsicht im Hof',
			JSON.stringify(mD ? { ins: mD.inscription, c: mD.is_collapsed, now: mD.current_inscription } : null));
		const map2 = (await post(`/api/projects/${P}/maps`, { label: 'Vorlage', mapType: 'situational' })).body?.id;
		await post(`/api/projects/${P}/maps/${map2}`, { action: 'placeExisting', namingId: D, mode: 'entity', properties: { x: 0, y: 0 } });
		await pool.query(
			`UPDATE appearances SET properties = properties || '{"readOnly": true}' WHERE naming_id = $1 AND perspective_id = $1`, [map2]
		);
		const ro = await post(N, { action: 'setCollapse', namingId: D, perspectiveId: map2, collapseAt: D0.seq });
		const infra = await one(
			`SELECT a.perspective_id FROM appearances a JOIN appearances ps ON ps.naming_id = a.perspective_id
			   AND ps.perspective_id = a.perspective_id AND NOT (ps.properties ? 'mapType') AND COALESCE(ps.properties->>'role','') <> 'phase'
			  WHERE a.naming_id = $1 AND a.perspective_id <> a.naming_id LIMIT 1`, [D]
		);
		const inf = infra ? await post(N, { action: 'setCollapse', namingId: D, perspectiveId: infra.perspective_id, collapseAt: D0.seq }) : { status: 404 };
		record('Vorlagen-Map → 403, Infrastruktur-Perspektive → 404', ro.status === 403 && inf.status === 404,
			`${ro.status}/${inf.status}${infra ? '' : ' (keine Infrastruktur-Perspektive)'}`);

		// 10j. Map kopieren: die Indizes gehen mit, als Akt; eine fremde Map
		//      lässt sich nicht kopieren.
		await post(M, { action: 'setCollapse', namingId: D, collapseAt: D0.seq });
		const dup = await post(`/api/projects/${P}/maps`, { action: 'duplicate', sourceMapId: mapId, label: 'Kopie' });
		const dupActs = dup.body?.id ? (await one(
			`SELECT count(*)::int AS c FROM situating_acts WHERE map_id = $1 AND naming_id = $2 AND act = 'collapse'`, [dup.body.id, D]
		)).c : 0;
		const P3 = (await post('/api/projects', { name: `${PREFIX}${stamp}_c` })).body?.id;
		if (P3) created.projectIds.push(P3);
		const foreignDup = await post(`/api/projects/${P3}/maps`, { action: 'duplicate', sourceMapId: mapId, label: 'fremd' });
		record('Map kopieren: Index als Akt übernommen; fremde Map kopieren → 404',
			dup.status === 201 && dupActs === 1 && foreignDup.status === 404,
			JSON.stringify({ dup: dup.status, dupActs, foreign: foreignDup.status }));
	}

	// Außer dem einen ausdrücklich angelegten freien Memo (5b) entsteht keines.
	record('kein Memo-Naming im ganzen Ablauf (außer dem freien Memo)', (await memoCount(P)) === 1, String(await memoCount(P)));
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
	// Die Projekt-Synchronisation legt für die Wegwerf-Projekte Ordner unter
	// projekte/ an (stacktest-<stamp>…). Nur diese Ordner dieses Laufs gehen weg;
	// liegt der Zustandsordner des Servers woanders, findet sich hier nichts.
	try {
		const dir = join(process.env.TQDA_STATE_DIR?.trim() || process.cwd(), 'projekte');
		const own = `${PREFIX.replace(/_+$/, '')}-${stamp}`;
		for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
			if (e.isDirectory() && (e.name === own || e.name.startsWith(`${own}-`))) {
				await rm(join(dir, e.name), { recursive: true, force: true });
			}
		}
	} catch (err) {
		console.error('[cleanup] WARNING (projekte/):', err instanceof Error ? err.message : err);
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
