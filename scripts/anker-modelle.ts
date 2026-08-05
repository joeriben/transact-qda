// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Modellvergleich für den Anker-Zug.
//
// Gemessen wird an dem einzigen Maßstab, den es gibt: den Marken des Forschers.
// Ein Modell taugt, wenn es die Stellen, die er selbst als Beleg gesetzt hat,
// als FALL zurückgibt. Alles andere — wie viele Stellen es sonst findet, wie
// oft die Antwort unlesbar ist, was es kostet — steht daneben, entscheidet
// aber nicht.
//
// Die Marken gehen dafür MIT in den Suchraum (belegstelleMitpruefen), sonst
// wäre die Frage nicht stellbar.
//
//   npm run anker:modelle
//   npm run anker:modelle -- --modelle z-ai/glm-5.2,xiaomi/mimo-v2.5-pro
//   npm run anker:modelle -- --concurrency 4
//
// Das Kriterium wird EINMAL abgeleitet (mit dem Referenzmodell) und danach für
// alle Modelle gleich gehalten. Sonst prüfte der Vergleich zwei Dinge auf
// einmal und keines davon sauber.

import { writeFileSync, mkdirSync } from 'node:fs';
import { query, pool } from '../src/lib/server/db/index.js';
import {
	vorbereiten,
	durchgehen,
	ladeMuster,
	type Kriterium,
	type Stelle
} from '../src/lib/server/ai/anchor-expansion/index.js';

const CACHE_DIR = '.tmp-anker';

/** Preise je Million Token, von OpenRouter am 05.08.2026 abgefragt. */
const PREISE: Record<string, { in: number; out: number; cacheR: number; cacheW: number }> = {
	'xiaomi/mimo-v2.5-pro': { in: 0.43, out: 0.87, cacheR: 0.0, cacheW: 0.43 },
	'z-ai/glm-5.2': { in: 0.76, out: 2.42, cacheR: 0.14, cacheW: 0.76 },
	'openai/gpt-5.6-terra-pro': { in: 1.0, out: 6.0, cacheR: 0.1, cacheW: 1.25 },
	'google/gemini-3.6-flash': { in: 1.5, out: 7.5, cacheR: 0.15, cacheW: 1.5 },
	'qwen/qwen3.8-max': { in: 2.0, out: 6.0, cacheR: 0.25, cacheW: 2.5 },
	'google/gemini-3.1-pro-preview': { in: 2.0, out: 12.0, cacheR: 0.2, cacheW: 0.38 },
	'moonshotai/kimi-k3': { in: 3.0, out: 15.0, cacheR: 0.3, cacheW: 3.75 },
	'anthropic/claude-sonnet-4.6': { in: 3.0, out: 15.0, cacheR: 0.3, cacheW: 3.75 }
};

const REFERENZ = 'anthropic/claude-sonnet-4.6';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

const modelle = (arg('modelle') ?? Object.keys(PREISE).join(',')).split(',').map((m) => m.trim());
const concurrency = Number(arg('concurrency') ?? 5);

interface Fall {
	namingId: string;
	inscription: string;
	memos: number;
	documentId: string;
	document: string;
	/** Zeichenspannen, die der Forscher selbst markiert hat. */
	marken: { pos0: number; pos1: number }[];
	kriterium: Kriterium;
}

/** Trifft die Stelle eine Marke des Forschers? Überlappung genügt — der Zugschnitt liegt nicht auf seinen Zeichen. */
const trifft = (s: Stelle, m: { pos0: number; pos1: number }) =>
	s.zug.charStart < m.pos1 && s.zug.charEnd > m.pos0;

async function baueFaelle(projectId: string): Promise<Fall[]> {
	const rows = await query<{ id: string; inscription: string }>(
		`SELECT DISTINCT n.id, n.inscription FROM namings n
		   JOIN appearances a ON a.directed_from=n.id AND a.mode='relation'
		    AND a.properties->>'anchorType'='text' AND a.properties->>'aiPersona' IS NULL
		    AND a.properties->'anchor'->>'pos0' IS NOT NULL
		  WHERE n.project_id=$1 AND n.deleted_at IS NULL
		  ORDER BY n.inscription`,
		[projectId]
	);

	const faelle: Fall[] = [];
	for (const r of rows.rows) {
		const muster = await ladeMuster(projectId, r.id);
		// Je Naming das Dokument mit den meisten Marken — dort ist die Bodenwahrheit am dichtesten.
		const jeDoc = new Map<string, { pos0: number; pos1: number }[]>();
		for (const a of muster.anchors) {
			jeDoc.set(a.documentId, [...(jeDoc.get(a.documentId) ?? []), { pos0: a.pos0, pos1: a.pos1 }]);
		}
		const [documentId, marken] = [...jeDoc.entries()].sort((x, y) => y[1].length - x[1].length)[0];
		const doc = await query<{ inscription: string }>(`SELECT inscription FROM namings WHERE id=$1`, [documentId]);

		process.stdout.write(`  Kriterium für „${r.inscription.slice(0, 50)}" …`);
		const v = await vorbereiten(projectId, r.id, documentId, {
			modell: { provider: 'openrouter', model: REFERENZ }
		});
		process.stdout.write(' ok\n');
		faelle.push({
			namingId: r.id,
			inscription: r.inscription,
			memos: muster.memos.length,
			documentId,
			document: doc.rows[0].inscription,
			marken,
			kriterium: v.kriterium!
		});
	}
	return faelle;
}

interface Ergebnis {
	modell: string;
	fall: string;
	marken: number;
	wiedergefunden: number;
	alsFall: number;
	stellen: number;
	geprueft: number;
	unlesbar: number;
	nichtBelegt: number;
	kosten: number;
	sekunden: number;
	fehler?: string;
}

async function main() {
	const projects = await query<{ id: string; name: string }>(
		`SELECT id, name FROM projects WHERE name ILIKE '%autonoma%' ORDER BY created_at DESC LIMIT 1`
	);
	const projectId = projects.rows[0].id;
	console.log(`Projekt: ${projects.rows[0].name}\n`);

	console.log('── Kriterien (einmal, mit dem Referenzmodell) ──');
	const faelle = await baueFaelle(projectId);
	for (const f of faelle) {
		console.log(
			`\n  „${f.inscription}"\n    ${f.memos} Memo(s) · ${f.marken.length} Marke(n) · ${f.document.slice(-30)}` +
				`\n    Bestandteile: ${f.kriterium.bestandteile.map((b) => b.name).join(', ')}`
		);
	}

	const ergebnisse: Ergebnis[] = [];
	for (const modell of modelle) {
		console.log(`\n\n════ ${modell}`);
		for (const f of faelle) {
			const t0 = Date.now();
			try {
				const d = await durchgehen(projectId, f.namingId, f.documentId, f.kriterium, {
					concurrency,
					belegstelleMitpruefen: true,
					modell: { provider: 'openrouter', model: modell }
				});
				const getroffen = f.marken.filter((m) => d.stellen.some((s) => trifft(s, m)));
				const alsFall = f.marken.filter((m) =>
					d.stellen.some((s) => trifft(s, m) && /^fall$/i.test(s.befund.relation.trim()))
				);
				const p = PREISE[modell];
				const kosten =
					(d.verbrauch.eingabe * p.in +
						d.verbrauch.ausgabe * p.out +
						d.verbrauch.cacheGelesen * p.cacheR +
						d.verbrauch.cacheGeschrieben * p.cacheW) /
					1e6;
				const e: Ergebnis = {
					modell,
					fall: f.inscription,
					marken: f.marken.length,
					wiedergefunden: getroffen.length,
					alsFall: alsFall.length,
					stellen: d.stellen.length,
					geprueft: d.geprueft,
					unlesbar: d.unlesbar.length,
					nichtBelegt: d.nichtBelegt.length,
					kosten,
					sekunden: Math.round((Date.now() - t0) / 1000)
				};
				ergebnisse.push(e);
				console.log(
					`  ${f.inscription.slice(0, 42).padEnd(44)} Marken ${e.alsFall}/${e.marken} als Fall, ` +
						`${e.wiedergefunden}/${e.marken} überhaupt · ${e.stellen}/${e.geprueft} Stellen · ` +
						`unlesbar ${e.unlesbar} · unbelegt ${e.nichtBelegt} · $${kosten.toFixed(3)} · ${e.sekunden}s`
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ergebnisse.push({
					modell,
					fall: f.inscription,
					marken: f.marken.length,
					wiedergefunden: 0,
					alsFall: 0,
					stellen: 0,
					geprueft: 0,
					unlesbar: 0,
					nichtBelegt: 0,
					kosten: 0,
					sekunden: Math.round((Date.now() - t0) / 1000),
					fehler: msg.slice(0, 160)
				});
				console.log(`  ${f.inscription.slice(0, 42).padEnd(44)} FEHLER: ${msg.slice(0, 100)}`);
			}
		}
	}

	console.log('\n\n════════ Zusammenfassung ════════\n');
	console.log(
		`${'Modell'.padEnd(32)}${'Marken als Fall'.padStart(16)}${'Stellen'.padStart(10)}${'unlesbar'.padStart(10)}${'unbelegt'.padStart(10)}${'$ gesamt'.padStart(10)}${'Sek.'.padStart(7)}`
	);
	for (const m of modelle) {
		const e = ergebnisse.filter((x) => x.modell === m);
		const markenGesamt = e.reduce((a, x) => a + x.marken, 0);
		const fall = e.reduce((a, x) => a + x.alsFall, 0);
		const stellen = e.reduce((a, x) => a + x.stellen, 0);
		const geprueft = e.reduce((a, x) => a + x.geprueft, 0);
		const kosten = e.reduce((a, x) => a + x.kosten, 0);
		const sek = e.reduce((a, x) => a + x.sekunden, 0);
		const fehler = e.filter((x) => x.fehler).length;
		console.log(
			`${m.padEnd(32)}${`${fall}/${markenGesamt}`.padStart(16)}${`${stellen}/${geprueft}`.padStart(10)}` +
				`${String(e.reduce((a, x) => a + x.unlesbar, 0)).padStart(10)}` +
				`${String(e.reduce((a, x) => a + x.nichtBelegt, 0)).padStart(10)}` +
				`${kosten.toFixed(3).padStart(10)}${String(sek).padStart(7)}` +
				(fehler ? `   (${fehler} Fehler)` : '')
		);
	}

	mkdirSync(CACHE_DIR, { recursive: true });
	const out = `${CACHE_DIR}/modellvergleich.json`;
	writeFileSync(out, JSON.stringify({ faelle, ergebnisse }, null, '\t'), 'utf-8');
	console.log(`\nRohdaten: ${out}\n`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(() => pool.end());
