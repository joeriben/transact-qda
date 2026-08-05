// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Anker-Zug auf der Kommandozeile — dieselbe Schicht, die die Route benutzt.
//
// Bewusst kein zweiter Weg durch das Material: Was hier läuft, sind
// `vorbereiten` und `durchgehen` aus `ai/anchor-expansion`, ohne HTTP und ohne
// Oberfläche. Was auf der Kommandozeile funktioniert, funktioniert deshalb auch
// in der Anwendung, und umgekehrt.
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
//   npm run anker -- --project <…> --naming <…> --stand
//       Welche Dokumente es gibt, wie viele Zuege sie haben (der Kostentreiber,
//       deterministisch gerechnet) und was dort schon gelaufen ist. Ohne Modell.
//   npm run anker -- --project <…> --naming <…> --alle-dokumente [--erneut]
//       Ueber alle Dokumente laufen, die mit DIESEM Kriterium noch nicht
//       gelaufen sind. --erneut laeuft auch ueber die schon gelaufenen.
//
// Das abgeleitete Kriterium liegt in .tmp-anker/kriterium-<naming>.json und
// kann dort von Hand geändert werden; ein weiterer Lauf nimmt die geänderte
// Fassung, solange --neu nicht gesetzt ist.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { query, pool } from '../src/lib/server/db/index.js';
import {
	vorbereiten,
	durchgehen,
	dokumentStand,
	verbucheLauf,
	LaufAbbruch,
	kriteriumHash,
	ladeVolltext,
	sichten,
	zuegeOf,
	bauformName,
	type Gestalt,
	type Kriterium,
	type Stelle,
	type DokumentStand
} from '../src/lib/server/ai/anchor-expansion/index.js';

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
const ankerAuch = flag('anker-auch');
const standOnly = flag('stand');
const alleDokumenteLaufen = flag('alle-dokumente');
const erneut = flag('erneut');

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

// ── Ausgabe ───────────────────────────────────────────────────────

function zeigeSichtung(label: string, g: Gestalt, ausfuehrlich: boolean): void {
	console.log(`\n════ ${label}`);
	console.log(`     ${g.chars} Zeichen · ${g.turns} Blöcke · ${bauformName(g.form)}\n`);
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
	console.log('\n── Kriterium, wie es aus Naming und Memo folgt ──\n');
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

function zeigeErgebnis(
	stellen: Stelle[],
	unlesbar: number,
	nichtBelegt: number,
	geprueft: number,
	geprueftJePosition: Record<string, number>,
	kriterium: Kriterium,
	gestalt: Gestalt
): void {
	const nachRelation = new Map<string, Stelle[]>();
	for (const s of stellen) nachRelation.set(s.befund.relation, [...(nachRelation.get(s.befund.relation) ?? []), s]);

	console.log(`\n════ ${stellen.length} Stellen mit Bezug, von ${geprueft} geprüften ════`);
	// Nicht verschweigen: eine fallengelassene Stelle sieht sonst aus wie eine
	// geprüfte ohne Bezug.
	if (unlesbar > 0) console.log(`     ${unlesbar} Stellen kamen nicht auswertbar zurück und sind UNGEPRÜFT.`);
	// Ein Befund, dessen Zitat aus der Umgebung stammt, hängt nicht an der Stelle,
	// auf die er zeigt. Weder mitzählen noch verschweigen.
	if (nichtBelegt > 0)
		console.log(`     ${nichtBelegt} Befunde beriefen sich auf Worte, die nicht in ihrer Stelle stehen — ausgesondert.`);

	// Der Fall zuerst, dann die Kontraste — an denen wird die Grenze scharf.
	const order = [
		...kriterium.relationen.map((r) => r.name).filter((n) => nachRelation.has(n)),
		...[...nachRelation.keys()].filter((n) => !kriterium.relationen.some((r) => r.name === n))
	];

	// Verteilung auf die Positionen — am gelesenen Muster, nicht an Wortlisten.
	// Ohne sie steht eine Trefferliste da, als wäre das Muster positionslos.
	const positionen = gestalt.positionen.map((p) => p.mark);
	if (positionen.length > 1 && stellen.length > 0) {
		const spalte = (s: string) => s.padStart(14);
		console.log(`\n── Verteilung auf die Sprecherpositionen`);
		console.log(`   ${'Relation'.padEnd(38)}${positionen.map(spalte).join('')}`);
		for (const rel of order) {
			const list = nachRelation.get(rel)!;
			const zellen = positionen.map((p) =>
				spalte(`${list.filter((s) => s.zug.position === p).length} / ${geprueftJePosition[p] ?? 0}`)
			);
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
	if (stellen.length === 0) console.log('\n(keine — das ist ein zulässiges Ergebnis)');
	console.log('');
}

// ── Stand und Reihenlauf ──────────────────────────────────────────

function zeigeStand(namingLabel: string, stand: DokumentStand[], k: Kriterium | null): void {
	console.log(`\n════ „${namingLabel}" — Stand über ${stand.length} Dokumente`);
	console.log(k ? `     Kriterium ${kriteriumHash(k)}\n` : '     (noch kein Kriterium abgeleitet — jeder Lauf gilt als nicht aktuell)\n');
	console.log(`  ${'Dokument'.padEnd(46)}${'Züge'.padStart(6)}${'Marken'.padStart(8)}   Stand`);
	let offen = 0;
	let offeneZuege = 0;
	for (const d of stand) {
		const l = d.letzterLauf;
		const wann = l ? new Date(l.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '';
		const zustand = !l
			? 'noch nicht gelaufen'
			: l.abgebrochen
				? `abgebrochen (${wann})`
				: d.aktuell
					? `${l.stellen} Stellen · ${wann} · ${l.model.split('/').pop()}`
					: `${l.stellen} Stellen, aber anderes Kriterium (${wann})`;
		if (!d.aktuell) {
			offen++;
			offeneZuege += d.zuege;
		}
		console.log(
			`  ${d.inscription.slice(-46).padEnd(46)}${String(d.zuege).padStart(6)}${String(d.marken).padStart(8)}   ${d.aktuell ? '✓ ' : '  '}${zustand}`
		);
	}
	console.log(`\n  Offen: ${offen} Dokumente, ${offeneZuege} Züge — das ist, was ein Lauf über alle kosten würde.\n`);
}

/**
 * Über alle Dokumente laufen, die mit DIESEM Kriterium noch nicht gelaufen sind.
 *
 * Der Reihenlauf verbucht jeden Durchgang einzeln. Bricht einer ab, sind die
 * vorherigen bezahlt und gespeichert; ein erneuter Aufruf setzt dort fort, wo
 * es aufhörte, statt von vorn zu beginnen.
 */
async function laufeUeberAlle(
	projectId: string,
	naming: { id: string; label: string },
	stand: DokumentStand[],
	k: Kriterium | null
): Promise<void> {
	if (!k) throw new Error('Kein Kriterium. Erst mit --kriterium ableiten und ansehen.');
	const offen = erneut ? stand : stand.filter((d) => !d.aktuell);
	if (offen.length === 0) {
		console.log('Alles mit diesem Kriterium gelaufen. Mit --erneut trotzdem laufen lassen.\n');
		return;
	}
	console.log(`Lauf über ${offen.length} Dokumente, ${offen.reduce((a, d) => a + d.zuege, 0)} Züge.\n`);

	let stellenGesamt = 0;
	let kosten = { eingabe: 0, ausgabe: 0, cacheGelesen: 0, cacheGeschrieben: 0, aufrufe: 0 };
	for (const [i, d] of offen.entries()) {
		const t0 = Date.now();
		process.stdout.write(`  [${i + 1}/${offen.length}] ${d.inscription.slice(-44).padEnd(46)}`);
		try {
			const r = await durchgehen(projectId, naming.id, d.documentId, k, { concurrency, belegstelleMitpruefen: ankerAuch });
			const sek = Math.round((Date.now() - t0) / 1000);
			await verbucheLauf({
				projectId,
				namingId: naming.id,
				documentId: d.documentId,
				kriterium: k,
				provider: r.modell.provider,
				model: r.modell.model,
				zuegeGesamt: r.zuegeGesamt,
				geprueft: r.geprueft,
				stellen: r.stellen,
				unlesbar: r.unlesbar.length,
				nichtBelegt: r.nichtBelegt.length,
				verbrauch: r.verbrauch,
				sekunden: sek
			});
			stellenGesamt += r.stellen.length;
			kosten.eingabe += r.verbrauch.eingabe;
			kosten.ausgabe += r.verbrauch.ausgabe;
			kosten.cacheGelesen += r.verbrauch.cacheGelesen;
			kosten.cacheGeschrieben += r.verbrauch.cacheGeschrieben;
			kosten.aufrufe += r.verbrauch.aufrufe;
			console.log(`${String(r.stellen.length).padStart(4)} Stellen von ${r.geprueft}   ${sek}s`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			const ausfall = err instanceof LaufAbbruch;
			await verbucheLauf({
				projectId,
				namingId: naming.id,
				documentId: d.documentId,
				kriterium: k,
				provider: 'unbekannt',
				model: 'unbekannt',
				zuegeGesamt: d.zuege,
				geprueft: 0,
				stellen: [],
				unlesbar: 0,
				nichtBelegt: 0,
				verbrauch: { aufrufe: 0, eingabe: 0, ausgabe: 0, cacheGeschrieben: 0, cacheGelesen: 0 },
				sekunden: Math.round((Date.now() - t0) / 1000),
				abgebrochen: true,
				fehler: (ausfall ? `Ausfall ${(err as LaufAbbruch).kennung}: ${msg}` : msg).slice(0, 300)
			});
			if (ausfall) {
				// Guthaben weg oder Schlüssel ungültig: Die übrigen Dokumente würden
				// nur noch Ausfälle verbuchen, die im Stand wie geprüfte Dokumente
				// ohne Fund aussehen. Der Reihenlauf endet hier.
				console.log(`AUSFALL (${(err as LaufAbbruch).kennung}): ${msg.slice(0, 90)}`);
				console.log(`\n  Kein Zugang zum Modell. ${offen.length - i - 1} Dokumente bleiben unangetastet;`);
				console.log('  ein erneuter Aufruf setzt dort fort, wo es aufhörte.');
				break;
			}
			console.log(`ABBRUCH: ${msg.slice(0, 70)}`);
		}
	}
	console.log(
		`\n  ${stellenGesamt} Stellen insgesamt · ${kosten.aufrufe} Aufrufe · ` +
			`${kosten.eingabe} Eingabe, ${kosten.cacheGelesen} aus dem Cache, ${kosten.ausgabe} Ausgabe (Token)\n`
	);
}

// ── Lauf ──────────────────────────────────────────────────────────

async function main() {
	const projects = await query<{ id: string; name: string }>(`SELECT id, name FROM projects ORDER BY created_at DESC`);
	const project = await resolveOne(projects.rows.map((p) => ({ id: p.id, label: p.name })), projectArg, 'Projekte', 'project');

	const documents = await query<{ id: string; inscription: string }>(
		`SELECT d.id, d.inscription FROM namings d
		   JOIN document_content dc ON dc.naming_id=d.id AND dc.full_text IS NOT NULL
		  WHERE d.project_id=$1 AND d.deleted_at IS NULL ORDER BY d.inscription`,
		[project.id]
	);

	// ── Sichtung — steht vor allem anderen und braucht weder Naming noch Modell.
	if (sichtungOnly) {
		const gewaehlt = alleDokumente
			? documents.rows
			: [await resolveOne(documents.rows.map((d) => ({ id: d.id, label: d.inscription })), documentArg, 'Dokumente', 'document')];
		for (const d of gewaehlt) {
			const text = await ladeVolltext(project.id, d.id);
			zeigeSichtung(('inscription' in d ? d.inscription : d.label) as string, sichten(text), !alleDokumente);
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

	// ── Stand: was gibt es, was ist gelaufen. Ohne Modell, ohne Kosten. ──
	if (standOnly || alleDokumenteLaufen) {
		const kp0 = join(CACHE_DIR, `kriterium-${naming.id}.json`);
		const k0 = existsSync(kp0) ? (JSON.parse(readFileSync(kp0, 'utf-8')) as Kriterium) : null;
		const stand = await dokumentStand(project.id, naming.id, k0);
		zeigeStand(naming.label, stand, k0);
		if (standOnly) return;
		await laufeUeberAlle(project.id, naming, stand, k0);
		return;
	}

	const document = await resolveOne(documents.rows.map((d) => ({ id: d.id, label: d.inscription })), documentArg, 'Dokumente', 'document');

	if (zuegeOnly) {
		const text = await ladeVolltext(project.id, document.id);
		const gestalt = sichten(text);
		const zuege = zuegeOf(text, gestalt);
		zeigeSichtung(document.label, gestalt, true);
		console.log(`Züge: ${zuege.length}\n`);
		for (const z of zuege.slice(0, limit ?? 60)) {
			const zu = z.zuschreibung === 'eigen' ? '' : ` (${z.zuschreibung}, Marke ${z.embeddedMark})`;
			console.log(
				`${String(z.index).padStart(4)} [${z.charStart}–${z.charEnd}] ${z.position}${zu}${z.brueche.length > 0 ? ` ⟂${z.brueche.length}` : ''}: ${short(z.text, 110)}`
			);
		}
		return;
	}

	// ── Kriterium: aus der Datei, sonst ableiten ──
	if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
	const kp = join(CACHE_DIR, `kriterium-${naming.id}.json`);
	const vorhanden = !forceNew && existsSync(kp) ? (JSON.parse(readFileSync(kp, 'utf-8')) as Kriterium) : null;

	const v = await vorbereiten(project.id, naming.id, document.id, { kriterium: vorhanden });

	console.log(`\nMuster:    „${v.inscription}"`);
	console.log(`Memo:      ${v.memos.length > 0 ? short(v.memos.join(' // '), 260) : '(keins)'}`);
	console.log(`Dokument:  ${document.label}`);
	zeigeSichtung(document.label, v.gestalt, false);
	console.log(`Züge:      ${v.zuegeGesamt}`);

	if (!v.belegstelle) {
		console.log('\nKeine Marke dieses Namings, nirgends. Gesucht wird allein nach dem Kriterium.');
	} else {
		const woher = v.belegAusAnderemDokument ? 'Marke aus einem anderen Dokument' : 'Belegstelle mit Anlauf';
		console.log(`\n${woher}:\n   ${short(v.belegstelle, 400)}`);
	}

	if (!v.kriterium) throw new Error('Das Kriterium kam nicht auswertbar zurück.');
	if (!vorhanden) writeFileSync(kp, JSON.stringify(v.kriterium, null, '\t'), 'utf-8');
	else console.log(`\n(Kriterium aus ${kp} — mit --neu neu ableiten)`);
	zeigeKriterium(v.kriterium);
	console.log(`   Liegt in ${kp} — dort ändern, dann erneut laufen lassen.`);

	if (kriteriumOnly || !doRun) {
		console.log('\n(Kein Lauf. Mit --lauf das Dokument durchgehen.)\n');
		return;
	}

	// ── Durchgang ──
	console.log('');
	const t0 = Date.now();
	const d = await durchgehen(project.id, naming.id, document.id, v.kriterium, {
		concurrency,
		belegstelleMitpruefen: ankerAuch,
		onProgress: (done, total) => {
			if (done % 5 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
		}
	});
	process.stdout.write('\n');
	// Auch der Einzellauf wird verbucht — sonst zeigt --stand ihn nicht.
	await verbucheLauf({
		projectId: project.id,
		namingId: naming.id,
		documentId: document.id,
		kriterium: v.kriterium,
		provider: d.modell.provider,
		model: d.modell.model,
		zuegeGesamt: d.zuegeGesamt,
		geprueft: d.geprueft,
		stellen: d.stellen,
		unlesbar: d.unlesbar.length,
		nichtBelegt: d.nichtBelegt.length,
		verbrauch: d.verbrauch,
		sekunden: Math.round((Date.now() - t0) / 1000)
	});
	zeigeErgebnis(d.stellen, d.unlesbar.length, d.nichtBelegt.length, d.geprueft, d.geprueftJePosition, v.kriterium, d.gestalt);
	console.log(
		`  Verbrauch: ${d.verbrauch.aufrufe} Aufrufe · ${d.verbrauch.eingabe} Eingabe · ` +
			`${d.verbrauch.cacheGelesen} aus dem Cache · ${d.verbrauch.ausgabe} Ausgabe (Token)\n`
	);
}

main()
	.catch((err) => {
		// Ein Ausfall des Zugangs ist kein Ergebnis über das Material. Er wird als
		// das benannt, was er ist, damit niemand ihn als „nichts gefunden" liest.
		if (err instanceof LaufAbbruch) {
			console.error(`\nAUSFALL (${err.kennung}): ${err.message}`);
			console.error('Kein Zugang zum Modell — es wurde nichts geprüft.\n');
		} else {
			console.error(`\nFehlgeschlagen: ${err instanceof Error ? err.message : String(err)}\n`);
		}
		process.exitCode = 1;
	})
	.finally(() => pool.end());
