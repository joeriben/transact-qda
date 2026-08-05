<!--
  SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
  SPDX-License-Identifier: AGPL-3.0-or-later

  Anker-Zug — ein Strukturmuster am Dokument prüfen.

  Drei Schritte, sichtbar getrennt, weil sie verschieden verantwortet sind:

    Sichtung   Was für ein Text das ist. Deterministisch, ohne Modell. Steht
               schon da, bevor irgendetwas gefragt wird.
    Kriterium  Die Hypothese des Forschers, explizit gemacht — und KORRIGIERBAR,
               bevor sie läuft. Das ist die Stelle, an der er verantwortet, was
               geprüft wird. Ohne diesen Schritt wäre es ein autonomer Lauf.
    Durchgang  Je Stelle eine Relation, keine Trefferliste. Die Funde bleiben
               außerhalb des Datenraums, bis er einen davon durch einen eigenen
               Akt hereinholt — als Anker oder gar nicht.
-->
<script lang="ts">
	interface Bestandteil { name: string; kenntlich: string }
	interface Relation { name: string; bedingung: string; ertrag: string }
	interface Kriterium { akteur: string; adressat: string; bestandteile: Bestandteil[]; relationen: Relation[] }
	interface Bruch { art: string; position: string; imBlockVon: string; wortlaut: string; was: string }
	interface Zug {
		charStart: number; charEnd: number; text: string;
		position: string; zuschreibung: string; embeddedMark: string | null; brueche: Bruch[];
	}
	interface Befund {
		wer: string; worueber: string; wie: string; tut: string;
		bestandteile: Record<string, boolean>; relation: string; zitat: string; begruendung: string;
	}
	interface Stelle { zug: Zug; befund: Befund }
	interface LaufNotiz {
		id: string; createdAt: string; model: string; stellen: number;
		abgebrochen: boolean; unlesbar: number; nichtBelegt: number;
	}
	interface DokumentStand {
		documentId: string; inscription: string; zeichen: number;
		zuege: number; marken: number; letzterLauf: LaufNotiz | null; aktuell: boolean;
	}
	interface Gestalt {
		form: string; chars: number; turns: number;
		positionen: { mark: string; turns: number; share: number; prompted: boolean }[];
		bau: string[]; verteilungBefund: string[]; brueche: Bruch[];
	}

	let {
		projectId,
		documentId,
		namingId,
		namingLabel,
		onclose,
		onjump,
		onanchor
	}: {
		projectId: string;
		documentId: string;
		namingId: string;
		namingLabel: string;
		onclose: () => void;
		onjump: (charStart: number, charEnd: number) => void;
		onanchor: (charStart: number, charEnd: number, text: string) => Promise<boolean>;
	} = $props();

	let phase = $state<'laden' | 'kriterium' | 'lauf' | 'fertig' | 'fehler'>('laden');
	let fehler = $state('');
	/** Kein Zugang zum Modell — der Lauf hat nichts geprüft, statt nichts gefunden. */
	let ausfall = $state(false);
	let gestalt = $state<Gestalt | null>(null);
	let zuegeGesamt = $state(0);
	let belegstelle = $state<string | null>(null);
	let belegAusAnderemDokument = $state(false);
	let kriterium = $state<Kriterium | null>(null);
	let belegstelleMitpruefen = $state(false);
	let sichtungOffen = $state(false);

	let stellen = $state<Stelle[]>([]);
	let done = $state(0);
	let total = $state(0);
	let geprueftJePosition = $state<Record<string, number>>({});
	let unlesbar = $state(0);
	let nichtBelegt = $state(0);
	let uebernommen = $state<Set<number>>(new Set());
	let verworfen = $state<Set<number>>(new Set());
	let controller: AbortController | null = null;

	let dokumente = $state<DokumentStand[]>([]);
	let ausgewaehlt = $state<Set<string>>(new Set());
	let dokumenteOffen = $state(false);
	let reihe = $state<{ doc: string; label: string; stellen: number | null; fehler?: string }[]>([]);
	/** Das gespeicherte Ergebnis dieses Dokuments, falls es mit diesem Kriterium schon lief. */
	let ausDerAkte = $state<{ wann: string; model: string } | null>(null);

	$effect(() => {
		void namingId;
		void documentId;
		laden();
		return () => controller?.abort();
	});

	async function laden() {
		phase = 'laden';
		fehler = '';
		stellen = [];
		reihe = [];
		ausDerAkte = null;
		uebernommen = new Set();
		verworfen = new Set();
		try {
			const res = await fetch(
				`/api/projects/${projectId}/anker-zug?namingId=${namingId}&documentId=${documentId}`
			);
			if (!res.ok) throw new Error(await res.text());
			const v = await res.json();
			gestalt = v.gestalt;
			zuegeGesamt = v.zuegeGesamt;
			belegstelle = v.belegstelle;
			belegAusAnderemDokument = v.belegAusAnderemDokument ?? false;
			kriterium = v.kriterium;
			phase = 'kriterium';
			await standLaden();
		} catch (e) {
			fehler = e instanceof Error ? e.message : String(e);
			phase = 'fehler';
		}
	}

	/**
	 * Welche Dokumente es gibt und was dort schon gelaufen ist. Kostet nichts —
	 * die Zugzahl ist gerechnet, nicht geschätzt, und sie ist der Kostentreiber.
	 * Vorausgewählt ist, was mit diesem Kriterium noch nicht gelaufen ist.
	 */
	async function standLaden() {
		if (!kriterium) return;
		const q = new URLSearchParams({ namingId, kriterium: JSON.stringify(kriterium) });
		const res = await fetch(`/api/projects/${projectId}/anker-zug/dokumente?${q}`);
		if (!res.ok) return;
		const v = await res.json();
		dokumente = v.dokumente ?? [];
		ausgewaehlt = new Set(dokumente.filter((d: DokumentStand) => !d.aktuell).map((d: DokumentStand) => d.documentId));

		// Was hier schon gelaufen ist, wird nicht noch einmal bezahlt: Das
		// Ergebnis kommt aus der Akte, und ein neuer Lauf ist eine Entscheidung.
		const hier = dokumente.find((d: DokumentStand) => d.documentId === documentId);
		if (hier?.aktuell && hier.letzterLauf) {
			const r = await fetch(`/api/projects/${projectId}/anker-zug/dokumente`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ runId: hier.letzterLauf.id })
			});
			if (r.ok) {
				const lauf = await r.json();
				stellen = lauf.stellen ?? [];
				ausDerAkte = { wann: lauf.createdAt, model: lauf.model };
				phase = 'fertig';
			}
		}
	}

	// Der Lauf schickt jeden Fund sofort, statt am Ende alles auf einmal: über
	// ein großes Dokument läuft er Minuten, und der erste Fund ist schon etwas
	// wert. Abbrechen heißt: Verbindung zu, laufende Aufrufe reißen ab.
	async function starten(ueberDocId = documentId) {
		if (!kriterium) return;
		phase = 'lauf';
		if (ueberDocId === documentId) {
			stellen = [];
			ausDerAkte = null;
		}
		ausfall = false;
		done = 0;
		total = 0;
		unlesbar = 0;
		nichtBelegt = 0;
		controller?.abort();
		controller = new AbortController();
		try {
			const res = await fetch(`/api/projects/${projectId}/anker-zug`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					namingId,
					documentId: ueberDocId,
					kriterium,
					belegstelleMitpruefen
				}),
				signal: controller.signal
			});
			if (!res.ok || !res.body) throw new Error(await res.text());
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { value, done: fin } = await reader.read();
				if (fin) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data:')) continue;
					const ev = JSON.parse(line.slice(5).trim());
					// Funde eines anderen Dokuments gehören nicht in diese Liste: Springen
					// und Übernehmen beziehen sich auf den Text, der hier offen ist.
					const hier = ueberDocId === documentId;
					if (ev.kind === 'stelle') { if (hier) stellen = [...stellen, ev.stelle]; }
					else if (ev.kind === 'progress') { done = ev.done; total = ev.total; }
					else if (ev.kind === 'done') {
						if (hier) {
							stellen = ev.stellen;
							geprueftJePosition = ev.geprueftJePosition;
							unlesbar = ev.unlesbar ?? 0;
							nichtBelegt = ev.nichtBelegt ?? 0;
						}
						gefunden = ev.stellen?.length ?? 0;
						phase = 'fertig';
					} else if (ev.kind === 'failed') {
						// Ein Ausfall des Zugangs sagt über dieses Dokument nichts. Er wird
						// als Ausfall gezeigt, damit er nicht als „nichts gefunden" zählt.
						ausfall = ev.abbruch === true;
						fehler = ausfall
							? `Kein Zugang zum Modell${ev.status ? ` (HTTP ${ev.status})` : ''}. Es wurde nichts geprüft — das ist kein Ergebnis über dieses Dokument. ${ev.message}`
							: ev.message;
						phase = 'fehler';
					}
				}
			}
			if (phase === 'lauf') phase = 'fertig';
		} catch (e) {
			if (e instanceof Error && e.name === 'AbortError') return;
			fehler = e instanceof Error ? e.message : String(e);
			phase = 'fehler';
		}
	}

	let gefunden = 0;

	/**
	 * Über die ausgewählten Dokumente laufen, eines nach dem anderen.
	 *
	 * Jeder Durchgang wird serverseitig verbucht, bevor der nächste beginnt.
	 * Bricht die Reihe ab, ist das Bezahlte gespeichert und ein erneuter Start
	 * setzt dort fort, wo es aufhörte.
	 */
	async function reiheStarten() {
		const ziele = dokumente.filter((d) => ausgewaehlt.has(d.documentId));
		if (ziele.length === 0) return;
		reihe = ziele.map((d) => ({ doc: d.documentId, label: d.inscription, stellen: null }));
		for (const [i, d] of ziele.entries()) {
			gefunden = 0;
			try {
				await starten(d.documentId);
				// Ohne diese Unterscheidung stünde nach einem Ausfall „0 Stellen" da —
				// gleich gelesen wie ein Dokument, das geprüft wurde und nichts hergab.
				reihe[i] =
					phase === 'fehler'
						? { ...reihe[i], stellen: null, fehler: ausfall ? 'Ausfall' : 'Fehler' }
						: { ...reihe[i], stellen: gefunden };
			} catch (e) {
				reihe[i] = { ...reihe[i], stellen: null, fehler: e instanceof Error ? e.message : String(e) };
			}
			reihe = [...reihe];
			if (phase === 'fehler') {
				for (let j = i + 1; j < reihe.length; j++) reihe[j] = { ...reihe[j], fehler: 'nicht gelaufen' };
				reihe = [...reihe];
				break;
			}
		}
		await standLaden();
	}

	function abbrechen() {
		controller?.abort();
		controller = null;
		phase = stellen.length > 0 ? 'fertig' : 'kriterium';
	}

	async function uebernehmen(i: number, s: Stelle) {
		const ok = await onanchor(s.zug.charStart, s.zug.charEnd, s.zug.text);
		if (ok) uebernommen = new Set([...uebernommen, i]);
	}

	function bestandteilFeld(k: Kriterium, i: number, feld: 'name' | 'kenntlich', wert: string) {
		k.bestandteile[i][feld] = wert;
		kriterium = { ...k };
	}
	function relationFeld(k: Kriterium, i: number, feld: 'name' | 'bedingung' | 'ertrag', wert: string) {
		k.relationen[i][feld] = wert;
		kriterium = { ...k };
	}

	// Der Fall zuerst, dann die Kontraste — an denen wird die Grenze scharf.
	let gruppen = $derived.by(() => {
		const order = kriterium?.relationen.map((r) => r.name) ?? [];
		const map = new Map<string, { stelle: Stelle; i: number }[]>();
		stellen.forEach((s, i) => {
			if (verworfen.has(i)) return;
			map.set(s.befund.relation, [...(map.get(s.befund.relation) ?? []), { stelle: s, i }]);
		});
		const namen = [
			...order.filter((n) => map.has(n)),
			...[...map.keys()].filter((n) => !order.includes(n))
		];
		return namen.map((name) => ({ name, eintraege: map.get(name)! }));
	});

	let positionen = $derived(gestalt?.positionen.map((p) => p.mark) ?? []);
	let offeneDokumente = $derived(dokumente.filter((d) => !d.aktuell));
	let offeneZuege = $derived(offeneDokumente.reduce((a, d) => a + d.zuege, 0));
</script>

<aside class="anker-panel">
	<header>
		<div class="titel">
			<span class="kicker">Muster prüfen</span>
			<strong>{namingLabel}</strong>
		</div>
		<button class="x" onclick={onclose} title="Schließen">×</button>
	</header>

	{#if phase === 'fehler'}
		<div class="fehler">{fehler}</div>
		<button class="tun" onclick={laden}>Nochmal</button>
	{/if}

	{#if gestalt}
		<section class="sichtung">
			<button class="klapp" onclick={() => (sichtungOffen = !sichtungOffen)}>
				<span class="pfeil" class:auf={sichtungOffen}>▸</span>
				Sichtung — {gestalt.turns} Blöcke, {zuegeGesamt} Züge
				{#if gestalt.brueche.length > 0}<span class="risse">{gestalt.brueche.length} Risse</span>{/if}
			</button>
			{#if sichtungOffen}
				<ul class="bau">
					{#each gestalt.bau as satz}<li>{satz}</li>{/each}
				</ul>
				{#if gestalt.verteilungBefund.length > 0}
					<p class="hinweis">
						Oberflächenmarken je Position — Orientierung, kein Befund. Das Modell bekommt sie nicht:
						es fände sonst zuverlässig die Position, die ihm genannt wurde.
					</p>
					<ul class="bau schwach">
						{#each gestalt.verteilungBefund as satz}<li>{satz}</li>{/each}
					</ul>
				{/if}
			{/if}
		</section>
	{/if}

	{#if phase === 'laden'}
		<div class="warten">Sichtung läuft, Kriterium wird abgeleitet …</div>
	{/if}

	<!-- Eine Marke ist keine Voraussetzung: Was gesucht wird, steht im Kriterium,
	     und das kommt aus Naming und Memo. Wo eine Marke da ist, geht sie als
	     Beispiel mit — auch aus einem anderen Dokument. -->
	{#if belegstelle === null && phase !== 'laden' && phase !== 'fehler'}
		<div class="leer">
			Keine Marke dieses Namings, nirgends. Gesucht wird allein nach dem Kriterium.
		</div>
	{:else if belegAusAnderemDokument && phase !== 'laden' && phase !== 'fehler'}
		<div class="leer">Deine Marke steht in einem anderen Dokument — sie geht als Beispiel mit.</div>
	{/if}

	{#if kriterium && (phase === 'kriterium' || phase === 'lauf' || phase === 'fertig')}
		<section class="kriterium" class:gesperrt={phase === 'lauf'}>
			<h3>Kriterium</h3>
			<p class="hinweis">
				Aus deinem Naming und deinem Memo. Ändere es, bevor es läuft — geprüft wird, was hier
				steht.
			</p>

			<div class="paar">
				<label>Akteur
					<input value={kriterium.akteur} disabled={phase === 'lauf'}
						oninput={(e) => (kriterium = { ...kriterium!, akteur: e.currentTarget.value })} />
				</label>
				<label>Adressat
					<input value={kriterium.adressat} disabled={phase === 'lauf'}
						oninput={(e) => (kriterium = { ...kriterium!, adressat: e.currentTarget.value })} />
				</label>
			</div>

			<h4>Bestandteile</h4>
			{#each kriterium.bestandteile as b, i}
				<div class="zeile">
					<input class="name" value={b.name} disabled={phase === 'lauf'}
						oninput={(e) => bestandteilFeld(kriterium!, i, 'name', e.currentTarget.value)} />
					<textarea rows="2" value={b.kenntlich} disabled={phase === 'lauf'}
						placeholder="woran im Text kenntlich"
						oninput={(e) => bestandteilFeld(kriterium!, i, 'kenntlich', e.currentTarget.value)}></textarea>
				</div>
			{/each}

			<h4>Relationen</h4>
			{#each kriterium.relationen as r, i}
				<div class="zeile">
					<input class="name" value={r.name} disabled={phase === 'lauf'}
						oninput={(e) => relationFeld(kriterium!, i, 'name', e.currentTarget.value)} />
					<textarea rows="2" value={r.bedingung} disabled={phase === 'lauf'}
						placeholder="welche Bestandteile vorliegen müssen und welche nicht"
						oninput={(e) => relationFeld(kriterium!, i, 'bedingung', e.currentTarget.value)}></textarea>
				</div>
			{/each}

			<label class="schalter">
				<input type="checkbox" bind:checked={belegstelleMitpruefen} disabled={phase === 'lauf'} />
				Belegstelle mitprüfen — eine Probe darauf, ob das Kriterium sie wiederfindet
			</label>

			{#if phase === 'lauf'}
				<div class="fortschritt">
					<div class="balken"><div style="width: {total ? (done / total) * 100 : 0}%"></div></div>
					<span>{done} / {total || zuegeGesamt} Stellen · {stellen.length} mit Bezug</span>
					<button class="tun aus" onclick={abbrechen}>Abbrechen</button>
				</div>
			{:else}
				<button class="tun" onclick={() => starten()}>
					{ausDerAkte ? 'Neu durchgehen' : phase === 'fertig' ? 'Erneut durchgehen' : `${zuegeGesamt} Stellen durchgehen`}
				</button>
			{/if}
		</section>

		<!-- Auswahl über das ganze Projekt. Die Zugzahl je Dokument ist gerechnet,
		     nicht geschätzt — was ein Lauf kostet, steht vor dem ersten Aufruf
		     fest. Vorausgewählt ist, was mit DIESEM Kriterium noch nicht lief. -->
		{#if dokumente.length > 1}
			<section class="dokumente">
				<button class="klapp" onclick={() => (dokumenteOffen = !dokumenteOffen)}>
					<span class="pfeil" class:auf={dokumenteOffen}>▸</span>
					Weitere Dokumente — {offeneDokumente.length} von {dokumente.length} offen, {offeneZuege} Stellen
				</button>
				{#if dokumenteOffen}
					<ul class="dokliste">
						{#each dokumente as d}
							<li class:hier={d.documentId === documentId}>
								<label>
									<input
										type="checkbox"
										checked={ausgewaehlt.has(d.documentId)}
										disabled={phase === 'lauf'}
										onchange={(e) => {
											const n = new Set(ausgewaehlt);
											if (e.currentTarget.checked) n.add(d.documentId); else n.delete(d.documentId);
											ausgewaehlt = n;
										}}
									/>
									<span class="name">{d.inscription}</span>
									<span class="zahl">{d.zuege}</span>
									{#if d.marken > 0}<span class="marken">{d.marken} Marken</span>{/if}
								</label>
								<div class="stand">
									{#if !d.letzterLauf}
										noch nicht gelaufen
									{:else if d.letzterLauf.abgebrochen}
										abgebrochen am {d.letzterLauf.createdAt.slice(0, 10)}
									{:else if d.aktuell}
										✓ {d.letzterLauf.stellen} Stellen · {d.letzterLauf.createdAt.slice(0, 10)}
									{:else}
										{d.letzterLauf.stellen} Stellen, aber mit anderem Kriterium ({d.letzterLauf.createdAt.slice(0, 10)})
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					<button class="tun" disabled={phase === 'lauf' || ausgewaehlt.size === 0} onclick={reiheStarten}>
						Über {ausgewaehlt.size} {ausgewaehlt.size === 1 ? 'Dokument' : 'Dokumente'} laufen
						({dokumente.filter((d) => ausgewaehlt.has(d.documentId)).reduce((a, d) => a + d.zuege, 0)} Stellen)
					</button>
				{/if}
				{#if reihe.length > 0}
					<ul class="reihe">
						{#each reihe as r}
							<li>
								<span class="name">{r.label}</span>
								<span class="ergebnis" class:schlecht={r.fehler} title={r.fehler ?? ''}>
									{#if r.fehler}{r.fehler.slice(0, 24)}{:else if r.stellen === null}…{:else}{r.stellen} Stellen{/if}
								</span>
							</li>
						{/each}
					</ul>
					<p class="hinweis">
						Funde anderer Dokumente stehen nicht hier — Springen und Übernehmen gelten für den
						offenen Text. Öffne das Dokument, dann liegt sein Ergebnis ohne neuen Aufruf vor.
					</p>
				{/if}
			</section>
		{/if}
	{/if}

	{#if ausDerAkte}
		<div class="aus-der-akte">
			Ergebnis vom {ausDerAkte.wann.slice(0, 10)} ({ausDerAkte.model.split('/').pop()}) — aus der Akte,
			nicht neu gerechnet.
		</div>
	{/if}

	{#if nichtBelegt > 0 && phase === 'fertig'}
		<div class="unlesbar">
			{nichtBelegt} {nichtBelegt === 1 ? 'Befund berief sich' : 'Befunde beriefen sich'} auf Worte, die nicht in
			{nichtBelegt === 1 ? 'seiner' : 'ihren'} Stelle{nichtBelegt === 1 ? '' : 'n'} stehen — <strong>ausgesondert</strong>.
		</div>
	{/if}

	{#if unlesbar > 0 && phase === 'fertig'}
		<div class="unlesbar">
			{unlesbar} {unlesbar === 1 ? 'Stelle kam' : 'Stellen kamen'} nicht auswertbar zurück und {unlesbar === 1 ? 'ist' : 'sind'}
			<strong>ungeprüft</strong> — nicht „ohne Bezug".
		</div>
	{/if}

	{#if stellen.length > 0}
		{#if phase === 'fertig' && positionen.length > 1}
			<section class="verteilung">
				<h3>Verteilung auf die Sprecherpositionen</h3>
				<table>
					<thead>
						<tr><th>Relation</th>{#each positionen as p}<th>{p}</th>{/each}</tr>
					</thead>
					<tbody>
						{#each gruppen as g}
							<tr>
								<td>{g.name}</td>
								{#each positionen as p}
									<td class="zahl">
										{g.eintraege.filter((e) => e.stelle.zug.position === p).length}
										<span class="nenner">/ {geprueftJePosition[p] ?? 0}</span>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<section class="funde">
			{#each gruppen as g}
				<h3 class="rel">{g.name} <span class="anzahl">{g.eintraege.length}</span></h3>
				{#each g.eintraege as { stelle: s, i }}
					<article class="fund" class:drin={uebernommen.has(i)}>
						<div class="kopf">
							<button class="sprung" onclick={() => onjump(s.zug.charStart, s.zug.charEnd)}>
								{s.zug.position}{s.zug.zuschreibung !== 'eigen' ? ` · ${s.zug.zuschreibung}` : ''}
								<span class="span">{s.zug.charStart}–{s.zug.charEnd}</span>
							</button>
							<div class="teile">
								{#each Object.entries(s.befund.bestandteile ?? {}) as [name, da]}
									<span class="teil" class:ja={da}>{da ? '+' : '−'}{name}</span>
								{/each}
							</div>
						</div>
						{#if s.zug.brueche.length > 0}
							<div class="riss">{s.zug.brueche.map((b) => b.was).join(' ')}</div>
						{/if}
						<blockquote>{s.befund.zitat}</blockquote>
						<p class="geschieht">
							<em>{s.befund.wer}</em> redet über {s.befund.worueber} — {s.befund.wie}
						</p>
						<p class="tut">{s.befund.tut}</p>
						<div class="akte">
							{#if uebernommen.has(i)}
								<span class="drin-marke">als Anker übernommen</span>
							{:else}
								<button class="tun klein" onclick={() => uebernehmen(i, s)}>Als Anker übernehmen</button>
								<button class="tun klein aus" onclick={() => (verworfen = new Set([...verworfen, i]))}>
									Verwerfen
								</button>
							{/if}
						</div>
					</article>
				{/each}
			{/each}
		</section>
	{:else if phase === 'fertig'}
		<div class="leer">Keine Stelle steht zu diesem Muster in einem Verhältnis. Das ist ein zulässiges Ergebnis.</div>
	{/if}
</aside>

<style>
	.anker-panel {
		display: flex; flex-direction: column; gap: 0.75rem;
		height: 100%; overflow-y: auto;
		padding: 0.85rem; background: var(--surface-1); border-left: 1px solid var(--border);
		color: var(--text-2); font-size: 0.82rem;
	}
	header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
	.titel { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
	.kicker { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-4); }
	.titel strong { color: var(--text-1); font-size: 0.92rem; overflow-wrap: anywhere; }
	.x {
		background: none; border: none; color: var(--text-4);
		font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 0 0.2rem;
	}
	.x:hover { color: var(--text-1); }

	h3 { margin: 0 0 0.3rem; font-size: 0.78rem; color: var(--text-1); font-weight: 600; }
	h4 { margin: 0.6rem 0 0.25rem; font-size: 0.72rem; color: var(--text-3); font-weight: 600; }
	.hinweis { margin: 0 0 0.5rem; font-size: 0.72rem; color: var(--text-4); line-height: 1.45; }

	.klapp {
		display: flex; align-items: center; gap: 0.4rem; width: 100%;
		background: none; border: none; color: var(--text-3);
		font-size: 0.75rem; text-align: left; cursor: pointer; padding: 0.15rem 0;
	}
	.klapp:hover { color: var(--text-1); }
	.pfeil { display: inline-block; transition: transform 0.12s; }
	.pfeil.auf { transform: rotate(90deg); }
	.risse { margin-left: auto; color: var(--warning); font-size: 0.7rem; }

	.bau { margin: 0.35rem 0 0; padding-left: 1rem; display: flex; flex-direction: column; gap: 0.3rem; }
	.bau li { font-size: 0.74rem; line-height: 1.45; color: var(--text-3); }
	.bau.schwach li { color: var(--text-4); }

	.kriterium { border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem; background: var(--surface-2); }
	.kriterium.gesperrt { opacity: 0.7; }
	.paar { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
	label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.7rem; color: var(--text-4); }
	input, textarea {
		background: var(--surface-0); border: 1px solid var(--border);
		border-radius: 5px; padding: 0.28rem 0.4rem;
		color: var(--text-2); font: inherit; font-size: 0.76rem; width: 100%;
		box-sizing: border-box; resize: vertical;
	}
	input:focus, textarea:focus { outline: none; border-color: var(--accent); }
	.zeile { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 0.4rem; }
	.zeile .name { font-weight: 600; color: var(--text-1); }
	.schalter {
		flex-direction: row; align-items: flex-start; gap: 0.4rem;
		margin-top: 0.6rem; font-size: 0.72rem; line-height: 1.4;
	}
	.schalter input { width: auto; margin-top: 0.15rem; }

	.tun {
		margin-top: 0.6rem; width: 100%;
		background: var(--accent); border: none; border-radius: 6px;
		color: var(--surface-0); font-size: 0.78rem; font-weight: 600;
		padding: 0.42rem 0.6rem; cursor: pointer;
	}
	.tun:hover { filter: brightness(1.08); }
	.tun.aus { background: none; border: 1px solid var(--border-hi); color: var(--text-3); }
	.tun.klein { width: auto; margin: 0; font-size: 0.72rem; padding: 0.25rem 0.55rem; font-weight: 500; }

	.fortschritt { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.72rem; color: var(--text-4); }
	.balken { height: 4px; background: var(--surface-0); border-radius: 2px; overflow: hidden; }
	.balken div { height: 100%; background: var(--accent); transition: width 0.2s; }

	.verteilung table { width: 100%; border-collapse: collapse; font-size: 0.72rem; }
	.verteilung th, .verteilung td { text-align: left; padding: 0.2rem 0.3rem; border-bottom: 1px solid var(--border); }
	.verteilung th { color: var(--text-4); font-weight: 500; }
	.verteilung .zahl { text-align: right; color: var(--text-1); font-variant-numeric: tabular-nums; }
	.verteilung .nenner { color: var(--text-4); }

	.funde { display: flex; flex-direction: column; gap: 0.5rem; }
	.rel { margin: 0.5rem 0 0; display: flex; align-items: center; gap: 0.4rem; }
	.anzahl { color: var(--text-4); font-weight: 400; }

	.fund { border: 1px solid var(--border); border-radius: 8px; padding: 0.55rem; background: var(--surface-2); }
	.fund.drin { border-color: var(--ccs-cue); opacity: 0.65; }
	.kopf { display: flex; align-items: baseline; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap; }
	.sprung {
		background: none; border: none; padding: 0; cursor: pointer;
		color: var(--accent); font-size: 0.74rem; font-weight: 600;
	}
	.sprung:hover { text-decoration: underline; }
	.span { color: var(--text-4); font-weight: 400; margin-left: 0.3rem; font-variant-numeric: tabular-nums; }
	.teile { display: flex; gap: 0.3rem; flex-wrap: wrap; }
	.teil { font-size: 0.66rem; color: var(--text-4); }
	.teil.ja { color: var(--ccs-spec); }
	.riss { margin-top: 0.35rem; font-size: 0.7rem; color: var(--warning); line-height: 1.4; }
	blockquote {
		margin: 0.4rem 0; padding-left: 0.5rem;
		border-left: 2px solid var(--border-hi);
		font-size: 0.76rem; color: var(--text-2); line-height: 1.45;
	}
	.geschieht, .tut { margin: 0.25rem 0; font-size: 0.73rem; line-height: 1.45; color: var(--text-3); }
	.geschieht em { color: var(--text-1); font-style: normal; font-weight: 600; }
	.akte { display: flex; gap: 0.35rem; margin-top: 0.45rem; }
	.drin-marke { font-size: 0.7rem; color: var(--ccs-cue); }

	.warten, .leer { font-size: 0.75rem; color: var(--text-4); line-height: 1.5; padding: 0.4rem 0; }
	.dokumente { border-top: 1px solid var(--border); padding-top: 0.5rem; }
	.dokliste { list-style: none; margin: 0.3rem 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
	.dokliste li { font-size: 0.72rem; line-height: 1.35; }
	.dokliste li.hier .name { color: var(--accent); }
	.dokliste label { display: flex; align-items: baseline; gap: 0.35rem; cursor: pointer; }
	.dokliste .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.dokliste .zahl { color: var(--text-4); font-variant-numeric: tabular-nums; }
	.dokliste .marken { color: var(--accent); font-size: 0.65rem; }
	.dokliste .stand { padding-left: 1.35rem; color: var(--text-4); font-size: 0.66rem; }
	.reihe { list-style: none; margin: 0.4rem 0 0; padding: 0; font-size: 0.7rem; }
	.reihe li { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--text-4); }
	.reihe .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.aus-der-akte {
		font-size: 0.7rem; color: var(--text-4); padding: 0.3rem 0.5rem;
		border: 1px dashed var(--border); border-radius: 6px;
	}
	.unlesbar {
		font-size: 0.73rem; color: var(--warning); line-height: 1.45;
		border: 1px solid var(--border); border-radius: 6px; padding: 0.4rem 0.5rem;
	}
	.unlesbar strong { color: var(--warning); }
	.ergebnis.schlecht { color: var(--warning); }
	.fehler { font-size: 0.75rem; color: var(--warning); line-height: 1.5; overflow-wrap: anywhere; }
</style>
