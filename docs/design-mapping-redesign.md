# Mapping-Neukonzeption — SitMap als material-gekoppelte Arbeitsfläche (Stand 2026-07-11)

> **Status:** Entwurf des Assistenten (11.07.2026), von BJ am 17.07.2026 zur Umsetzung freigegeben
> („ok, dann also: commit und push für cleares git, dann setze das um“). Durchgegangen durch vier
> adversariale Angriffe (Methode/Praxis, Verfassung, Baubarkeit, Prämisse) und gegen die kanonischen
> Design-Docs geprüft. Terminal entscheidet der Mensch: die Reihenfolge der Phasen ist umkehrbar, die
> Prinzipien nicht.

> **Revision 2026-10-31:** Die Halde ist Präsenz, keine Aufgabenliste. Das Ziel, jede Benennung
> zu situieren oder abzulehnen, und der Offen-Zähler entfallen. Cues des KI-Laufs kommen erst in
> die Halde, wenn die Forscherin an ihnen gehandelt hat. Ungeerdet (∅) ist kein Mangel.
> Begründung: `design-mother-map-and-naming-flow.md`. Eine am selben Tag eingeführte
> Weiterleitung nach „Art der Benennung" ist zurückgezogen; sie widersprach der Grundlegung.

*Zuschreibungen an Benjamin Jörissen am 9.11.2026 gegen die Protokolle geprüft und korrigiert; Formulierungen des Assistenten sind gekennzeichnet.*

## 0. Die eine Entscheidung

Das heutige Mapping ist primitiv, weil **die Kernhandlung fehlt**: Ein benanntes Stück Material
kommt nicht in die Situation. „Add" erzeugt ein Naming, das ohne Rückmeldung verschwindet; die
Liste ist eine Verwaltungstabelle ohne Brücke zur Canvas; die Canvas kann nur schon-Platziertes
umschieben. Der bewusste Akt „ich ziehe diesen Cue in die Situation" existiert nicht.

**Entscheidung des Assistenten:** Wir bauen nicht zuerst eine klügere Auto-Platzierung (die ist verfassungswidrig,
siehe §5.6), sondern **die material-gekoppelte Situierungshandlung** — Cue im Dokument geboren →
sichtbar in der Situation abgelegt → vom Menschen an seinen bedeutungsvollen Ort gezogen. Das ist
zugleich Dein „v.a. überhapt mal endlcih die Möglichkeit Namings in die Map hineinzuziehen“ **und**
die Naht zum Material, die die vier Kritiker als die tiefere Wunde identifiziert haben. Beides ist
dieselbe Bewegung, nicht zwei.

Die von Dir gewünschte „inteligente Platzierung“ kommt — aber als **Gerüst, nicht als Zeichnung**
(§5.6): die Maschine ordnet die Halde, richtet mechanisch aus, zeigt strukturelle Nachbarschaft
(geteilte Participations, nicht Embedding-Ähnlichkeit). Sie setzt nie still den bedeutungsvollen Ort.

*Abweichung vom Auftrag:* Die Umdeutung zum Gerüst stammt vom Assistenten und den vier Kritikern.
BJ, 10.07.2026: „Die Aufgabe war hier von ANFANG an Nähen und Entfernungen einzubeziehen.“ Wie Nähen
und Entfernungen in die Platzierung eingehen, ist offen.

---

## 1. Die Praxis der Userin (Clarke + CCS)

*Vom Assistenten rekonstruiert. BJs Auftrag (10.07.2026) lautete: „Du musst Dich dazu in die Praxis
der Userinnen versetzen.“*

Rekonstruktive qualitative Forschung, Situationsanalyse (Clarke). Korpus = Interviews, Bilder,
Policy-/Theorietexte — alles „Material", kein Kontext/Primär-Sekundär-Split. Der Arbeitsgang, wie
der Assistent ihn rekonstruiert:

1. Transkript lesen, bedeutungsvolle Passage finden, **benennen** → Cue, im Material verankert (📄).
2. Dutzende Cues sammeln (messy) — **alle gleichzeitig präsent**.
3. Alles „in die Situation kippen": räumlich anordnen **ist** die Analyse. Nähe = Verwandtschaft,
   Position = Bedeutung, Lücke = Silence. (Clarke: die messy map ist der *volle simultane* Wurf,
   kein leerer Eingangskorb.)
4. Iterieren: umbenennen, splitten, mergen, **relationieren**, zu Phasen gruppieren, Positionen finden.
5. Zurück ins Material: Cues erden/schärfen (CCS: cue → characterization → specification).

Zwei Bewegungen, beide gültig (Model C, fluid): Benennen im Material→Map (grounding-first) und
Map→Benennen im Material (theory-first). Der reflexive Kern der SA ist das **Memo** — der Inhalt einer Relation *ist* ihr Memo.

---

## 2. Bodenwahrheit — Soll vs. Ist

**Soll** (`design-mother-map-and-naming-flow.md`, `design-provenance-and-namings.md`):
Eine primäre Situational Map. Benennen einer Passage → Naming bekommt eine Appearance auf der SitMap
*ohne* Koordinaten → erscheint als „unresolved" → **die Forscherin zieht es bewusst auf die Canvas**.
„Placement is a conscious analytical act, not a layout operation." Naming↔Material bidirektional.

**Ist** (empirisch heute):
- „Add" erzeugt ein Naming, das **ohne Feedback verschwindet**; keine Ablage, kein „hier ist dein Cue".
- List-View = Tabelle (Designation-Dropdown, stack/withdraw/relate) — **kein** placed/unplaced,
  **keine** Drag-Affordanz, **keine** Brücke zur Canvas.
- Canvas = Auto-Layout + Reposition eines *schon* platzierten Knotens. Der bewusste Platzierungsakt
  (Liste/Material → Canvas) fehlt real. → deckt sich mit der User-Klage.
- `scrollToPassage(annId)` **existiert** im Reader (springt zur Passage, 2 s Highlight); es fehlt nur
  der Deep-Link-Parameter, um von außen dorthin zu springen. Die Naht ist also **billig**.

---

## 3. Prinzipien des Entwurfs

1. **KI schreibt nur Cues — zeigen, nicht zeichnen** (die Formel stammt vom Assistenten). Positionen/Topologie sind *derivative
   Projektion*, keine Designation. Intelligente Platzierung = Assistenz des menschlichen Akts, nie
   Automatik der Designation. Vorschlag/Ausrichtung/Struktur-Hinweis ok; der Mensch situiert.
2. **Placement = analytischer Akt des Menschen.** Die UI würdigt ihn (bestätigen/revidieren/ablehnen),
   automatisiert ihn nicht weg. „Passt nirgends" ist ein Befund, kein Fehler. Der Akt wird
   **append-only in der Topologie-Historie** protokolliert (beobachtbar, umkehrbar) — er ist *kein*
   `naming_act`, weil er nicht designiert.
3. **Datenstruktur, Liste, Map.** Ground truth ist die Datenstruktur; die Liste ist ihre ideale,
   vollständigste Darstellung. BJ, Sitzung 09 (12.03.2026): „Aber wir ARBEITEN nicht ind er Liste
   i.d.R., weil Menschen damit kognitiv überfordert sind.“ Die Maps sind „nciht einfach sekundär“
   (ebd.). Beide Sichten auf denselben Pool. Eine Map lässt Namings nur systematisch weg, nie
   willkürlich; BJ, Sitzung 26 (28.03.2026): „dann kann ich nciht willkürlich Namings aus der Map
   ausschließen, sondern nur systematisch (z.B. keine Cues anzeigen, nur char und spec).“
4. **Material↔Map-Fusion.** Benennen im Material *ist* ein Naming-Akt, der in der Situation landet
   (Cues des KI-Laufs erst nach einem Akt der Forscherin, Revision 31.10.2026). Rücklink
   Knoten→Passage und Passage→Knoten ist ein Klick, kein Seitenwechsel-Bruch.
5. **CCS ⊥ Grounding sichtbar.** Jeder Knoten trägt Designation (cue/char/spec), Provenienz (∅/📄/📝)
   und Situierungszustand sichtbar. „unresolved" ist ein erstklassiger Zustand mit Ort.
6. **Jeder KI-Hinweis ist ausweisbar, rückholbar, ausblendbar** (aiPersona/aiRunId). Der
   Similarity-Layout-Vorschlag wird vor Anwendung gesnapshottet und als KI-Akt markiert.
7. **Am eigenen Maßstab.** BJ, 03.07.2026, zur Gewichtung von Revisionsbefunden: „halte cih auch
   die Gewichtung des ganzen Feedbacks für unterirdisch. Sie ist nicht sensibel für die Gesamtanlage
   des Projekts, legt irgendwleche öußeren, diskursfremden Aktionen und Maßstübd ean“. Keine
   Diskurs-/Publikationslogik. Die Rangfolge KollegInnen-Daten/Isolation → Beobachtbarkeit der
   KI-Akte → Ontologietreue → Bedienbarkeit ist eine Triage des Assistenten vom selben Tag, keine
   Festlegung BJs; Bedienbarkeit wird nicht nachgeordnet.

---

## 4. Der Interaktionsentwurf

### 4.1 Die eine Fläche

Kein Seitenwechsel zwischen „Lesen" und „Mappen". Eine Arbeitsfläche, drei Zonen:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Situationsmap · Projekt X      142 Cues · 38 situiert · 104 offen · KI▾ │  ← Kopf: Zustand, Linsen, Karte/Liste
├───────────────┬─────────────────────────────────────────┬───────────────┤
│  MATERIAL     │  CANVAS  (der volle Wurf)                │  INSPEKTOR    │
│  (Reader)     │                                          │  (Stack des   │
│               │   ┌ Halde (offen, gedämpft/gestrichelt) ┐│   gewählten   │
│  Transkript,  │   │  ○ ○ ○   ○     ○   ○ ○  ○           ││   Namings)    │
│  benannte     │   └──────────────────────────────────────┘│               │
│  Passage      │        ● ──rel(memo)── ●                  │  CCS-Kette    │
│  hervorgeh.,  │      ●        ●     ⌀(silence-ghost)       │  cue→char     │
│  Knoten-Chip  │          ●  ← Ziehen aus der Halde         │  Memos        │
│  daran        │            = situieren (protokolliert)     │  📄 Passagen  │
│               │                                            │  → springen   │
├───────────────┴─────────────────────────────────────────┴───────────────┤
│  Auto-Anordnen (Vorschlag, revidierbar) · Was fehlt hier? · Zoom [fix]   │  ← Werkzeugleiste
└─────────────────────────────────────────────────────────────────────────┘
```

- **Material (links):** der Reader, angedockt. Passage markieren → benennen → der Cue fällt
  **sichtbar** in die Halde der Canvas (📄 grounded). Kein „auf welche Map?", kein Bruch.
- **Canvas (Mitte):** der *volle* Wurf — alle Cues gleichzeitig präsent. Situierte Knoten im Feld;
  offene (un-situierte) Cues in der **Halde** am Rand — präsent, aber gedämpft/gestrichelt, lose
  gestapelt. *Keine* versteckte Sidebar-Ablage: die messy map zeigt alles, das Situieren macht das
  Bedeutungsvolle aus dem Präsenten.
- *Abweichung von BJs Entwurf:* BJ, Sitzung 08 (11.03.2026), zum Menü: „…mit flachem Menü
  unterhalb der "project"-Ebene: Overwiew kommt weg. Sit Map, SW Map, Pos Map, Namings, Memos,
  Documents.“ und „die zweite Links spalte blendet immer die Namings ein, drag and drop.“ Dieser
  Entwurf legt die offenen Namings stattdessen in eine Halde auf der Canvas.
  BJ, 05.08.2026, zur umgesetzten Halde: „unplaced-Box ist starr und nicht in der größe
  veränderbar → standards beachten.“ Seither ist sie ein verschieb- und größenveränderbares Panel.
- **Inspektor (rechts):** erscheint bei Auswahl eines Knotens — seine CCS-Kette, seine Memos, seine
  verankerten Passagen (Klick → Reader springt dorthin), Aktionen (Relationieren · Memo · Situierung
  zurücknehmen · als „passt nirgends" markieren).

### 4.2 Der Zustand eines Namings — der Kompass

Vier orthogonale Achsen, alle am Knoten sichtbar:

| Achse | Werte | Anzeige |
|---|---|---|
| **CCS-Gradient** | cue · characterization · specification | Farbe/Form (aufsteigende Sättigung) |
| **Grounding** | ∅ ungegründet · 📄 dokument-verankert · 📝 memo | Icon |
| **Situierung** | offen (Halde) · situiert (Feld) · abgelehnt (Befund) | Ort + Randstil |
| **Provenienz** | Mensch · KI (markiert, ausblendbar) | Marker |

Die Provenienz-Matrix `{∅/📄} × {offen/situiert}` ist der Kompass des Arbeitsstands: *was ist
verankert und noch nicht situiert?* ist die tägliche Frage.

### 4.3 Die Kernhandlung: Cue → Situation (Dein „Hineinziehen"), material-gekoppelt

Die fehlende Handlung, gebaut als *eine* Bewegung vom Material bis ins Feld:

1. Im Reader Passage markieren → benennen → **Cue erscheint sichtbar in der Halde** (📄).
2. **Ziehen aus der Halde ins Feld = situieren.** On drop: Appearance bekommt x/y; der Cue verlässt
   die Halde; der Akt wird append-only in der Topologie-Historie protokolliert (Mensch-Akt, umkehrbar).
3. **Zurücknehmen:** Knoten → „zurück in die Halde" = Situierung revidieren (auch protokolliert).
4. **Ablehnen:** Cue → „passt nirgends" = bewusster Befund, eigener Filter, bleibt in der Akte.
5. Multi-Select + Sammel-Ziehen; Tastatur: Cue fokussieren → Enter „an den Cursor setzen".
6. Zustandsfilter überall (Liste *und* Canvas-Halde): alle · situiert · offen · abgelehnt.

Das ist der kleinste Schnitt mit dem größten Hebel — Dein Hineinziehen, erweitert um die
Materialkopplung (aus der Kritik der vier Kritiker): ein durchgehender Zug vom gelesenen Wort bis zum
Ort in der Situation.

### 4.4 Die Naht schließen — Navigation Material ⇄ Map

Constant comparison als ein Klick, in beide Richtungen:

- **Knoten → Passage:** Klick auf 📄 eines Knotens → Reader öffnet/scrollt zur *exakten* Passage,
  2 s Highlight. (`scrollToPassage` existiert; es fehlt nur ein Load-/URL-Anker-Parameter.)
- **Passage → Knoten:** benannte Passage im Reader zeigt ihren Knoten-Chip → Klick → Canvas
  fliegt zum Knoten (fly-to).
- **Signal beim Benennen:** „dieser Cue ist in die Situation eingetreten" — leise, einmal.

### 4.5 Memo + Relationen — der reflexive Kern (nicht Reibung)

- **Relation ziehen:** von Knotenrand zu Knoten → Relation entsteht → **inline-Memo-Prompt**. Der
  Inhalt der Relation *ist* ihr Memo (SA). Eine unbenannte Relation ist unfertig, kein Fehler.
- **Platzierungs-Memo:** optionales „warum hier?" beim Situieren — der reflexive Kern, angeboten,
  nie erzwungen.
- **Knoten-Memos:** Beschreibungs-Memo ↔ analytisches Memo (bestehende Memo-Ontologie), im Inspektor.

### 4.6 Intelligente Platzierung als Gerüst, nicht als Zeichnung

Deine „inteligente Platzierung“ — verfassungssicher. *(Abweichung vom Auftrag, siehe §0: wie Nähen
und Entfernungen in die Platzierung eingehen, ist offen.)* Was die Maschine **darf**:

- **Die Halde ordnen** (Orientierung, keine Bedeutung): gruppiert nach Dokument / Doc-Phase /
  Provenienz. Das ist Sortierung des Präsenten, keine Positionierung im Bedeutungsfeld.
- **Mechanisch ausrichten:** Snap-to-Grid, Ausrichten, Verteilen — reine Ergonomie, keine Semantik.
- **Strukturelle Nachbarschaft zeigen:** „diese zwei Namings teilen Participations" — ein *Struktur-
  Faktum* aus dem Datenmodell, kein Ähnlichkeits-Rateschluss. (Das ersetzt den verworfenen
  Embedding-Glow: SA-Raum ist *relational*, nicht Ähnlichkeit; Ähnlichkeits-Glow würde den heiligen
  Platzierungsakt trivialisieren und die Provenienz verwaschen. **Verworfen.**)
- **Similarity-Layout** bleibt als *ein* explizit vom Menschen ausgelöster, gesnapshotteter,
  revidierbarer, als KI markierter Vorschlag — **nie** der stille Default einer frischen Map.

Was die Maschine **nicht darf:** still den bedeutungsvollen Ort setzen; den Gradienten designieren;
einen Hinweis ohne aiPersona/aiRunId hinterlassen.

### 4.7 Silence als Abfrage, nicht als Objekt

„Was fehlt hier?" interrogiert die Map → zeigt **Participations ohne Appearances** als blasse
Abwesenheits-Marker. Man inspiziert sie. Die KI darf das Muster *zeigen*, nie erden; Silences
schreibt sie nur als Cue. Ein Mensch kann eine Silence grounden, erhärten und spezifizieren, ohne
Sonderregel. BJ, 03.07.2026: „ob der Cue kletter als Silence, wieso nicht, wenn Human die Slience
grounded erhärten und spezifizieren kann. Keine technische Sonderregel hier.“ Keine ziehbare
positive Kachel.

### 4.8 Liste und Reader neben der Map

Gearbeitet wird auf der Map; die Liste ist die vollständige Darstellung. BJ, Sitzung 09
(12.03.2026): „Aber wir ARBEITEN nicht ind er Liste i.d.R., weil Menschen damit kognitiv überfordert
sind.“

- **Liste:** vollständige Sicht. Bekommt placed/unplaced/declined-Zustand,
  Drag-Affordanz zur Canvas, dieselben Filter. Von hier situiert man genauso wie von der Halde.
- **Reader:** wo Cues geboren werden und wo die Naht sich schließt.

### 4.9 Positional- & Social-Worlds-Maps erstklassig

Clarkes andere zwei Kartentypen sind keine Nachzügler:

- **Positional Map:** Achsen (eingenommene / *nicht* eingenommene Positionen im Diskurs). Similarity-
  Layout hier **aus** — die Achsen tragen die Bedeutung.
- **Social-Worlds/Arenas Map:** commitment-basierte Zugehörigkeit, Arena-Grenzen. Ebenfalls keine
  Ähnlichkeits-Anordnung.

---

## 5. Der phasenweise Bau + Kill-Kriterien

**Kill-Maßstab für alles:** nicht Durchsatz bei 30 Cues, sondern **Oszillation bei 200+ Cues** —
kann die Forscherin den Zug Lesen↔Benennen↔Situieren↔Relationieren tragen, ohne den Faden zu verlieren?

| Phase | Inhalt | Kill-Kriterium |
|---|---|---|
| **1 · Kernhandlung** | Cue aus dem Benennen sichtbar in Halde (📄); Ziehen Halde→Feld = situieren (protokolliert, umkehrbar); Liste bekommt placed/unplaced + Drag + Filter | Wenn eine Kollegin 30 frische Cues nicht spürbar klarer situiert als mit Auto-Layout+Reposition — verworfen |

**Stand Phase 1 (2026-07-18):** Ziehen aus der Halde ins Feld, Zurücknehmen über das
Knoten-Menü und das append-only Protokoll beider Akte sind gebaut (`situating_acts`,
Migration 034; sichtbar im Stack des Namings als eigener Abschnitt *Situating*). Das
Protokoll liegt bewusst **außerhalb** von `naming_acts`: eine Position ist Projektion,
keine Designation. Nur die Schwelle zählt als Akt — Verschieben und jeder Maschinen-Layout
schreiben nichts. Beim Bauen fiel auf, dass der **Lade-Pfad** koordinatenlose Namings der
Primary Map automatisch platzierte *und persistierte*; damit hätte die Halde keinen Reload
überlebt und Ergebnisse des KI-Laufs wären maschinell situiert worden. Behoben — unaufgelöst
bleibt unaufgelöst. Offen aus Phase 1: Multi-Select/Sammel-Ziehen, Tastaturweg
(Cue fokussieren → Enter), „ablehnen" als eigener Zustand, Drag direkt aus der Liste.
| **2 · Naht** | Knoten→Passage (Anker-Param + `scrollToPassage`); Passage→Knoten fly-to; „eingetreten"-Signal | Wenn der Rücksprung nicht die exakte Passage trifft / Seitenwechsel-Bruch bleibt — verworfen |
| **3 · Memo + Relationen** | Relation ziehen → inline-Memo; Platzierungs-Memo; Memos im Inspektor | Wenn Memos als Reibung erlebt statt als Denkort — überdenken |
| **4 · Gerüste** | Halde nach Doc/Phase/Provenienz ordnen; Ausrichten/Snap; Participation-Nachbarschaft; Similarity nur als markierter Vorschlag; Silence-Abfrage | Wenn ein Hinweis den Platzierungsakt vorwegnimmt statt ihn zu stützen — zurückbauen |
| **5 · Kartentypen** | Positional (Achsen) · Social-Worlds (Arenen); Similarity dort aus | — |

Scope-Disziplin: Phase 1 ist der einzige zwingende Erst-Schnitt. Alles danach folgt nur, wenn
Phase 1 den Kill-Test besteht.

---

## 6. Verfassungs-Konformität (Checkliste)

- [x] KI schreibt nur Cues — kein Schreibpfad im Entwurf designiert oberhalb Cue-Höhe.
- [x] Positionen = derivative Projektion; Situieren protokolliert in Topologie-Historie, *kein* `naming_act`.
- [x] Similarity-Layout nur menschlich ausgelöst, gesnapshottet, markiert (ausweisbar/rückholbar/ausblendbar).
- [x] Embedding-Ähnlichkeits-Glow **verworfen** (relationaler SA-Raum, Provenienz-Schutz).
- [x] KI schreibt Silences nur als Cue und zeigt nur das Muster; ein Mensch kann eine Silence grounden, erhärten und spezifizieren, ohne Sonderregel.
- [x] Append-only im Kern respektiert; keine Hard-Deletes (kein Inline-Merge im Entwurf).
- [x] Datenstruktur = Ground truth, Liste = vollständige Darstellung, gearbeitet wird auf der Map; Auswahl auf Maps nur systematisch.
- [x] Datenisolation unberührt (Map-/Naming-Scoping über bestehende `getMap`/`namingInProject`).

---

## 7. Wie der Entwurf die adversariale Kritik beantwortet

| Kritik (Angriff) | Antwort im Entwurf |
|---|---|
| Die wahre Wunde ist die Naht Reader↔Map, nicht drag-to-place | §4.3+§4.4: Hineinziehen *ist* material-gekoppelt gebaut; Naht ist Phase 1/2, nicht später |
| Embedding-Similarity-Glow ist das falsche Signal (relational, nicht ähnlich) + Provenienz-Wäsche + mis-educates | §4.6: Glow **verworfen**; ersetzt durch Participation-Struktur-Faktum + mechanisches Gerüst |
| Clarkes messy map = *voller* Wurf, kein leerer Eingangskorb | §4.1: Halde ist der volle präsente Wurf am Rand, keine versteckte Ablage |
| Memo (reflexiver Kern) darf nicht als Reibung behandelt werden | §4.5: Relation = ihr Memo; Platzierungs-Memo; Memos im Inspektor |
| Placement soll append-only protokolliert sein | §3.2/§4.3: Topologie-Historie, umkehrbar, aber *kein* `naming_act` |
| Silence = Abfrage, nicht ziehbare Kachel | §4.7 |
| Liste + Reader sind die Alltagsflächen | §4.8, korrigiert: gearbeitet wird auf der Map, die Liste ist die vollständige Darstellung (BJ, Sitzung 09) |
| Positional/Social-Worlds müssen erstklassig sein | §4.9 |

---

## 8. Technische Anker (bekannt, für die Umsetzung)

- `scrollToPassage(annId)` existiert im Reader (`documents/[docId]/+page.svelte`) — springt + 2 s
  Highlight. **Fehlt nur:** Load-/URL-Anker-Parameter für den Deep-Link von außen.
- `application/x-naming-id` (HTML5-DnD-MIME) existiert reader→Anwendung — Grundlage für Drag-to-situate.
- `updatePositions`-Batch-API (`maps/[mapId]/+server.ts`) schreibt `appearances.properties.{x,y}` —
  hier hängt die Protokollierung des Situierungsakts an (Topologie-Snapshot, kein naming_act).
- Topologie-Snapshots (Ganz-Map-Blobs) = der append-only-Ort für die Situierungs-/Umordnungs-Historie.
- `CanvasRegion.svelte`/`regions.ts` existieren (derzeit farb-only/tot) — Kandidat für Arena-Grenzen (§4.9).
- Zoom/Pan ist gefixt und verifiziert (siehe `reference-map-canvas-zoom`): keine Regression zulassen.

> **Der Mensch behält die terminale Position** — Du kannst jede Festlegung hier kippen. Die
> Reihenfolge selbst ist aber keine offene Wahl zwischen 1 und 2: Phase 2 ist die *Rück-Navigation*
> Knoten⇄Passage und lohnt erst, wenn situierte Knoten existieren — auf einer unsituierten Halde
> springt sie ins Leere. Phase 1 trägt Phase 2, nicht umgekehrt. Darum: **1 zuerst.**
