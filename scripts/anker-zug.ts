// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coding-Helfer: ein Strukturmuster am Material prüfen.
//
// Nimmt ein Naming des Forschers samt Memo und Belegstelle, macht das
// Kriterium explizit, und geht dann ein Dokument Äußerung für Äußerung durch.
// Zurück kommt je Stelle die RELATION zum Muster — Fall, Kontrast, Gegenzug,
// Akteur umgekehrt —, nicht ein Ja oder Nein.
//
//   npm run anker -- --project <…> --sichtung [--alle]
//       Nur die Sichtung: wie der Text gebaut ist, wie sich Oberflächenmarken
//       auf die Sprecherpositionen verteilen, wo die Zuschreibung reißt.
//       Deterministisch, ohne Modell, ohne Kosten.
//   npm run anker -- --project <…> --naming <…> --document <…> --kriterium
//       Das Kriterium ableiten und zeigen. Ein Aufruf. Zum Korrigieren,
//       bevor gelaufen wird.
//   npm run anker -- … --lauf
//       Das Dokument durchgehen.
//   npm run anker -- … --zuege
//       Nur den Schnitt zeigen, ohne Modell.
//
// Das abgeleitete Kriterium liegt in .tmp-anker/kriterium-<naming>.json und
// kann dort von Hand geändert werden; ein weiterer Lauf nimmt die geänderte
// Fassung, solange --neu nicht gesetzt ist.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { query, pool } from '../src/lib/server/db/index.js';
import {
	sichten,
	zuegeOf,
	zuegeOverlapping,
	type Gestalt,
	type Zug
} from '../src/lib/server/ai/anchor-expansion/gestalt.js';
import {
	ableitenKriterium,
	pruefeStellen,
	type Kriterium,
	type Stelle
} from '../src/lib/server/ai/anchor-expansion/recognize.js';

const CACHE_DIR = '.tmp-anker';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const projectArg = arg('project');
const namingArg = arg('naming');
const documentArg = arg('document');
const limit = arg('limit') ? Number(arg('limit')) : undefined;
const concurrency = Number(arg('concurrency') ?? 6);
const kriteriumOnly = flag('kriterium');
const doRun = flag('lauf');
const zuegeOnly = flag('zuege');
const sichtungOnly = flag('sichtung');
const alleDokumente = flag('alle');
const forceNew = flag('neu');

const short = (t: string, n = 150) => {
	const flat = (t ?? '').replace(/\s+/g, ' ').trim();
	return flat.length <= n ? flat : `${flat.slice(0, n)}…`;
};

async function resolveOne<T extends { id: string; label: string }>(
	rows: T[],
	needle: string | undefined,
	what: string,
	switchName: string
): Promise<T> {
	if (rows.length === 0) throw new Error(`Keine ${what} gefunden.`);
	if (!needle) {
		console.log(`\n${what}:`);
		for (const r of rows) console.log(`  ${r.id}  ${short(r.label, 100)}`);
		console.log(`\nMit --${switchName} auswählen.\n`);
		process.exit(0);
	}
	const exact = rows.find((r) => r.id === needle || r.id.startsWith(needle));
	if (exact) return exact;
	const hits = rows.filter((r) => r.label.toLowerCase().includes(needle.toLowerCase()));
	if (hits.length === 0) throw new Error(`Kein Treffer für "${needle}" unter ${what}.`);
	if (hits.length > 1) {
		throw new Error(
			`Mehrdeutig — ${hits.length} Treffer:\n` + hits.map((h) => `  ${h.id}  ${short(h.label, 100)}`).join('\n')
		);
	}
	return hits[0];
}

// ── Laden ─────────────────────────────────────────────────────────

async function loadNaming(projectId: string, namingId: string) {
	const head = await query<{ inscription: string }>(
		`SELECT inscription FROM namings WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL`,
		[namingId, projectId]
	);
	if (head.rows.length === 0) throw new Error('Naming nicht im Projekt.');
	const memos = await query<{ memo_text: string }>(
		`SELECT memo_text FROM naming_acts
		  WHERE naming_id=$1 AND memo_text IS NOT NULL AND btrim(memo_text) <> '' ORDER BY seq`,
		[namingId]
	);
	const anchors = await query<{ documentId: string; pos0: number; pos1: number }>(
		`SELECT a.directed_to AS "documentId",
		        (a.properties->'anchor'->>'pos0')::int AS pos0,
		        (a.properties->'anchor'->>'pos1')::int AS pos1
		   FROM appearances a
		   JOIN namings d ON d.id=a.directed_to AND d.deleted_at IS NULL
		  WHERE a.mode='relation' AND a.directed_from=$1
		    AND a.properties->>'anchorType'='text'
		    AND a.properties->>'aiPersona' IS NULL
		    AND a.properties->'anchor'->>'pos0' IS NOT NULL
		  ORDER BY (a.properties->'anchor'->>'pos0')::int`,
		[namingId]
	);
	return { inscription: head.rows[0].inscription, memos: memos.rows.map((r) => r.memo_text.trim()), anchors: anchors.rows };
}

function kriteriumPath(namingId: string): string {
	return join(CACHE_DIR, `kriterium-${namingId}.json`);
}

function zeigeSichtung(label: string, g: Gestalt, ausfuehrlich: boolean): void {
	console.log(`\n════ ${label}`);
	console.log(`     ${g.chars} Zeichen · ${g.turns} Blöcke · Bauform ${g.form}\n`);
	for (const s of g.bau) console.log(`  • ${s}`);

	if (g.verteilungBefund.length > 0) {
		console.log('\n  Oberflächenmarken, auf die Positionen verteilt — Orientierung, kein Befund:');
		for (const s of g.verteilungBefund) console.log(`  • ${s}`);
		if (ausfuehrlich) {
			for (const v of g.verteilungen) {
				const mitBeleg = Object.entries(v.beispiele).filter(([, b]) => b.length > 0);
				if (mitBeleg.length === 0) continue;
				console.log(`\n    ${v.name}:`);
				for (const [p, b] of mitBeleg) for (const x of b) console.log(`      ${p}: „${short(x, 110)}"`);
			}
		}
	}

	if (g.brueche.length > 0) {
		const nach = new Map<string, typeof g.brueche>();
		for (const b of g.brueche) nach.set(b.art, [...(nach.get(b.art) ?? []), b]);
		console.log(`\n  Risse in der Zuschreibung (${g.brueche.length}):`);
		for (const [art, list] of nach) {
			console.log(`    ${art} — ${list.length}×`);
			if (!ausfuehrlich) continue;
			for (const b of list.slice(0, 6)) {
				const wo = b.imBlockVon === b.position ? b.position : `${b.position} (im Block von ${b.imBlockVon})`;
				console.log(`      [${b.charStart}] ${wo}: „${short(b.wortlaut, 120)}"`);
			}
			if (list.length > 6) console.log(`      … und ${list.length - 6} weitere`);
		}
	}
	console.log('');
}

function zeigeKriterium(k: Kriterium): void {
	console.log('\n── Kriterium, wie es aus Naming, Memo und Belegstelle folgt ──\n');
	console.log(`   Akteur:    ${k.akteur}`);
	console.log(`   Adressat:  ${k.adressat}\n`);
	console.log('   Bestandteile:');
	for (const b of k.bestandteile) console.log(`     • ${b.name}\n       ${b.kenntlich}`);
	console.log('\n   Relationen, in denen eine Stelle dazu stehen kann:');
	for (const r of k.relationen) {
		console.log(`     • ${r.name}\n       Bedingung: ${r.bedingung}\n       Ertrag:    ${r.ertrag}`);
	}
	console.log('');
}

// ── Lauf ──────────────────────────────────────────────────────────

async function main() {
	const projects = await query<{ id: string; name: string }>(`SELECT id, name FROM projects ORDER BY created_at DESC`);
	const project = await resolveOne(projects.rows.map((p) => ({ id: p.id, label: p.name })), projectArg, 'Projekte', 'project');

	// ── Sichtung ──
	// Steht vor allem anderen und braucht weder Naming noch Modell.
	if (sichtungOnly) {
		const docs = await query<{ id: string; inscription: string; full_text: string }>(
			`SELECT d.id, d.inscription, dc.full_text FROM namings d
			   JOIN document_content dc ON dc.naming_id=d.id AND dc.full_text IS NOT NULL
			  WHERE d.project_id=$1 AND d.deleted_at IS NULL ORDER BY d.inscription`,
			[project.id]
		);
		const gewaehlt = alleDokumente
			? docs.rows
			: [
					await resolveOne(
						docs.rows.map((d) => ({ id: d.id, label: d.inscription })),
						documentArg,
						'Dokumente',
						'document'
					)
				].map((d) => docs.rows.find((x) => x.id === d.id)!);
		for (const d of gewaehlt) {
			zeigeSichtung(d.inscription, sichten(d.full_text), !alleDokumente);
		}
		if (alleDokumente) console.log(`(${gewaehlt.length} Dokumente. Ohne --alle je Dokument mit Belegen.)\n`);
		return;
	}

	const namings = await query<{ id: string; inscription: string }>(
		`SELECT DISTINCT n.id, n.inscription FROM namings n
		   JOIN appearances a ON a.mode='relation' AND a.directed_from=n.id
		    AND a.properties->>'anchorType'='text' AND a.properties->>'aiPersona' IS NULL
		  WHERE n.project_id=$1 AND n.deleted_at IS NULL ORDER BY n.inscription`,
		[project.id]
	);
	const naming = await resolveOne(namings.rows.map((n) => ({ id: n.id, label: n.inscription })), namingArg, 'Namings', 'naming');
	const { inscription, memos, anchors } = await loadNaming(project.id, naming.id);

	const documents = await query<{ id: string; inscription: string }>(
		`SELECT d.id, d.inscription FROM namings d
		   JOIN document_content dc ON dc.naming_id=d.id AND dc.full_text IS NOT NULL
		  WHERE d.project_id=$1 AND d.deleted_at IS NULL ORDER BY d.seq`,
		[project.id]
	);
	const document = await resolveOne(documents.rows.map((d) => ({ id: d.id, label: d.inscription })), documentArg, 'Dokumente', 'document');

	const ft = await query<{ full_text: string }>(`SELECT full_text FROM document_content WHERE naming_id=$1`, [document.id]);
	const fullText = ft.rows[0]?.full_text;
	if (!fullText) throw new Error('Dokument ohne Volltext.');
	const gestalt = sichten(fullText);
	const zuege = zuegeOf(fullText, gestalt);

	console.log(`\nMuster:    „${inscription}"`);
	console.log(`Memo:      ${memos.length > 0 ? short(memos.join(' // '), 260) : '(keins)'}`);
	console.log(`Dokument:  ${document.label}`);
	zeigeSichtung(document.label, gestalt, zuegeOnly);
	console.log(`Züge:      ${zuege.length}`);

	if (zuegeOnly) {
		for (const z of zuege.slice(0, limit ?? 60)) {
			const zu = z.zuschreibung === 'eigen' ? '' : ` (${z.zuschreibung}, Marke ${z.embeddedMark})`;
			console.log(
				`${String(z.index).padStart(4)} [${z.charStart}–${z.charEnd}] ${z.position}${zu}${z.brueche.length > 0 ? ` ⟂${z.brueche.length}` : ''}: ${short(z.text, 110)}`
			);
		}
		return;
	}

	// Belegstelle mit Anlauf — der markierte Ausschnitt allein trägt den Zug
	// oft nicht; bei diesem Muster steht die Zweiteilung im Satz davor.
	const anchorZuege: Zug[] = [];
	let belegstelle = '';
	for (const a of anchors) {
		if (a.documentId !== document.id) continue;
		const hit = zuegeOverlapping(zuege, a.pos0, a.pos1);
		if (hit.length === 0) continue;
		anchorZuege.push(...hit);
		const idx = zuege.indexOf(hit[0]);
		belegstelle = [...zuege.slice(Math.max(0, idx - 2), idx), ...hit]
			.map((z) => `[${z.position}] ${z.text}`)
			.join('\n');
		break;
	}
	if (!belegstelle) {
		console.log('\nKeine Belegstelle dieses Namings in diesem Dokument.\n');
		return;
	}
	console.log(`\nBelegstelle mit Anlauf:\n   ${short(belegstelle, 400)}`);

	// ── Kriterium ──
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
	const kp = kriteriumPath(naming.id);
	let kriterium: Kriterium | null = null;
	if (!forceNew && existsSync(kp)) {
		kriterium = JSON.parse(readFileSync(kp, 'utf-8')) as Kriterium;
		console.log(`\n(Kriterium aus ${kp} — mit --neu neu ableiten)`);
	} else {
		console.log('\nLeite das Kriterium ab …');
		kriterium = await ableitenKriterium(inscription, memos, belegstelle);
		if (!kriterium) throw new Error('Das Kriterium kam nicht auswertbar zurück.');
		writeFileSync(kp, JSON.stringify(kriterium, null, '\t'), 'utf-8');
	}
	zeigeKriterium(kriterium);
	console.log(`   Liegt in ${kp} — dort ändern, dann erneut laufen lassen.`);

	if (kriteriumOnly || !doRun) {
		console.log('\n(Kein Lauf. Mit --lauf das Dokument durchgehen.)\n');
		return;
	}

	// ── Lauf über die Züge ──
	// Die Belegstelle selbst bleibt draußen — sie ist die Vorgabe, nicht der
	// Fund. Mit --anker-auch läuft sie mit: eine Probe darauf, ob das Kriterium
	// die Stelle wiederfindet, aus der es abgeleitet wurde.
	const scope = (limit ? zuege.slice(0, limit) : zuege).filter(
		(z) => flag('anker-auch') || !anchorZuege.includes(z)
	);
	console.log(`\nGehe ${scope.length} Stellen durch …`);
	const stellen = await pruefeStellen(inscription, memos, belegstelle, kriterium, gestalt, zuege, scope, {
		concurrency,
		onProgress: (d, t) => {
			if (d % 10 === 0 || d === t) process.stdout.write(`\r  ${d}/${t}`);
		}
	});
	process.stdout.write('\n');

	const nachRelation = new Map<string, Stelle[]>();
	for (const s of stellen) {
		const list = nachRelation.get(s.befund.relation) ?? [];
		list.push(s);
		nachRelation.set(s.befund.relation, list);
	}

	console.log(`\n════ ${stellen.length} Stellen mit Bezug, von ${scope.length} geprüften ════`);

	// Der Fall zuerst, dann die Kontraste — an denen wird die Grenze scharf.
	const order = [
		...kriterium.relationen.map((r) => r.name).filter((n) => nachRelation.has(n)),
		...[...nachRelation.keys()].filter((n) => !kriterium!.relationen.some((r) => r.name === n))
	];

	// Verteilung auf die Positionen — am gelesenen Muster, nicht an Wortlisten.
	// Ohne sie steht eine Trefferliste da, als wäre das Muster positionslos.
	const positionen = gestalt.positionen.map((p) => p.mark);
	if (positionen.length > 1 && stellen.length > 0) {
		const geprueft = new Map<string, number>();
		for (const z of scope) geprueft.set(z.position, (geprueft.get(z.position) ?? 0) + 1);
		const spalte = (s: string) => s.padStart(14);
		console.log(`\n── Verteilung auf die Sprecherpositionen`);
		console.log(`   ${'Relation'.padEnd(38)}${positionen.map(spalte).join('')}`);
		for (const rel of order) {
			const list = nachRelation.get(rel)!;
			const zellen = positionen.map((p) => {
				const n = list.filter((s) => s.zug.position === p).length;
				const g = geprueft.get(p) ?? 0;
				return spalte(g > 0 ? `${n} / ${g}` : `${n}`);
			});
			console.log(`   ${rel.padEnd(38)}${zellen.join('')}`);
		}
		console.log(`   ${'(Nenner: geprüfte Stellen der Position)'.padEnd(38)}`);
	}

	for (const rel of order) {
		const list = nachRelation.get(rel)!;
		console.log(`\n── ${rel}  (${list.length})`);
		for (const s of list) {
			const teile = Object.entries(s.befund.bestandteile ?? {})
				.map(([k, v]) => `${v ? '+' : '−'}${k}`)
				.join(' ');
			const zu = s.zug.zuschreibung === 'eigen' ? '' : ` [${s.zug.zuschreibung}]`;
			console.log(`\n   [${s.zug.charStart}–${s.zug.charEnd}] ${s.zug.position}${zu}   ${teile}`);
			if (s.zug.brueche.length > 0) console.log(`   Riss:      ${s.zug.brueche.map((b) => b.art).join(', ')}`);
			console.log(`   Zitat:     ${short(s.befund.zitat, 240)}`);
			console.log(`   Geschieht: ${short(s.befund.wer, 60)} redet über ${short(s.befund.worueber, 70)} — ${short(s.befund.wie, 90)}`);
			console.log(`   Tut damit: ${short(s.befund.tut, 180)}`);
			console.log(`   Warum:     ${short(s.befund.begruendung, 200)}`);
		}
	}
	if (stellen.length === 0) console.log('\n(keine — das ist ein zulässiges Ergebnis)\n');
	console.log('');
}

main()
	.catch((err) => {
		console.error(`\nFehlgeschlagen: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exitCode = 1;
	})
	.finally(() => pool.end());
