# Mapping-Neukonzeption — SitMap als material-gekoppelte Arbeitsfläche (Stand 2026-07-11)

> **Status:** entschieden, nicht verzweigt. Dieses Dokument ist der Entwurf, auf den wir uns
> festlegen — durchgegangen durch vier adversariale Angriffe (Methode/Praxis, Verfassung,
> Baubarkeit, Prämisse) und gegen die kanonischen Design-Docs geprüft. Terminal entscheidet der
> Mensch: die Reihenfolge der Phasen ist umkehrbar, die Prinzipien nicht.

## 0. Die eine Entscheidung

Das heutige Mapping ist primitiv, weil **die Kernhandlung fehlt**: Ein benanntes Stück Material
kommt nicht in die Situation. „Add" erzeugt ein Naming, das ohne Rückmeldung verschwindet; die
Liste ist eine Verwaltungstabelle ohne Brücke zur Canvas; die Canvas kann nur schon-Platziertes
umschieben. Der bewusste Akt „ich ziehe diesen Cue in die Situation" existiert nicht.

**Entschieden:** Wir bauen nicht zuerst eine klügere Auto-Platzierung (die ist verfassungswidrig,
siehe §5.6), sondern **die material-gekoppelte Situierungshandlung** — Cue im Dokument geboren →
sichtbar in der Situation abgelegt → vom Menschen an seinen bedeutungsvollen Ort gezogen. Das ist
zugleich Dein „v.a. endlich Namings hineinziehen" **und** die Naht zum Material, die die vier
Kritiker als die tiefere Wunde identifiziert haben. Beides ist dieselbe Bewegung, nicht zwei.

Die von Dir gewünschte „intelligente Platzierung" kommt — aber als **Gerüst, nicht als Zeichnung**
(§5.6): die Maschine ordnet die Halde, richtet mechanisch aus, zeigt strukturelle Nachbarschaft
(geteilte Participations, nicht Embedding-Ähnlichkeit). Sie setzt nie still den bedeutungsvollen Ort.

---

## 1. Die Praxis der Userin (Clarke + CCS)

Rekonstruktive qualitative Forschung, Situationsanalyse (Clarke). Korpus = Interviews, Bilder,
Policy-/Theorietexte — alles „Material", kein Kontext/Primär-Sekundär-Split. Der reale Arbeitsgang:

1. Transkript lesen, bedeutungsvolle Passage finden, **benennen** → Cue, im Material verankert (📄).
2. Dutzende Cues sammeln (messy) — **alle gleichzeitig präsent**.
3. Alles „in die Situation kippen": räumlich anordnen **ist** die Analyse. Nähe = Verwandtschaft,
   Position = Bedeutung, Lücke = Silence. (Clarke: die messy map ist der *volle simultane* Wurf,
   kein leerer Eingangskorb.)
4. Iterieren: umbenennen, splitten, mergen, **relationieren**, zu Phasen gruppieren, Positionen finden.
5. Zurück ins Material: Cues erden/schärfen (CCS: cue → characterization → specification).

Zwei Bewegungen, beide gültig (Model C, fluid): Coding→Map (grounding-first) und Map→Coding
(theory-first). Der reflexive Kern der SA ist das **Memo** — der Inhalt einer Relation *ist* ihr Memo.

---

## 2. Bodenwahrheit — Soll vs. Ist

**Soll** (`design-mother-map-and-coding-flow.md`, `design-provenance-and-codes.md`):
Eine primäre Situational Map. Coden einer Passage → Naming bekommt eine Appearance auf der SitMap
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

## 3. Bindende Designprinzipien (Verfassung, nicht Vorschlag)

1. **KI schreibt nur Cues — zeigen, nicht zeichnen.** Positionen/Topologie sind *derivative
   Projektion*, keine Designation. Intelligente Platzierung = Assistenz des menschlichen Akts, nie
   Automatik der Designation. Vorschlag/Ausrichtung/Struktur-Hinweis ok; der Mensch situiert.
2. **Placement = analytischer Akt des Menschen.** Die UI würdigt ihn (bestätigen/revidieren/ablehnen),
   automatisiert ihn nicht weg. „Passt nirgends" ist ein Befund, kein Fehler. Der Akt wird
   **append-only in der Topologie-Historie** protokolliert (beobachtbar, umkehrbar) — er ist *kein*
   `naming_act`, weil er nicht designiert.
3. **Drei-Schichten-Hierarchie.** Datenstruktur = ground truth · Liste = privilegierte, vollständige
   Repräsentation · Canvas/Map = bequeme, epistemisch untergeordnete Projektion. Beide Sichten auf
   denselben Pool.
4. **Material↔Map-Fusion.** Coden *ist* ein Naming-Akt, der in der Situation landet. Rücklink
   Knoten→Passage und Passage→Knoten ist ein Klick, kein Seitenwechsel-Bruch.
5. **CCS ⊥ Grounding sichtbar.** Jeder Knoten trägt Designation (cue/char/spec), Provenienz (∅/📄/📝)
   und Situierungszustand sichtbar. „unresolved" ist ein erstklassiger Zustand mit Ort.
6. **Jeder KI-Hinweis ist ausweisbar, rückholbar, ausblendbar** (aiPersona/aiRunId). Der
   Similarity-Layout-Vorschlag wird vor Anwendung gesnapshottet und als KI-Akt markiert.
7. **Am eigenen Maßstab.** Gewichtung: KollegInnen-Daten/Isolation → Beobachtbarkeit der KI-Akte →
   Ontologietreue → Bedienbarkeit. Keine Diskurs-/Publikationslogik.

---

## 4. Der entschiedene Interaktionsentwurf

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
│  kodierte     │   └──────────────────────────────────────┘│               │
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

Das ist der kleinste Schnitt mit dem größten Hebel — und exakt Dein Wunsch, nur nicht als isolierte
Canvas-Geste, sondern als durchgehender Zug vom gelesenen Wort bis zum Ort in der Situation.

### 4.4 Die Naht schließen — Navigation Material ⇄ Map

Constant comparison als ein Klick, in beide Richtungen:

- **Knoten → Passage:** Klick auf 📄 eines Knotens → Reader öffnet/scrollt zur *exakten* Passage,
  2 s Highlight. (`scrollToPassage` existiert; es fehlt nur ein Load-/URL-Anker-Parameter.)
- **Passage → Knoten:** kodierte Passage im Reader zeigt ihren Knoten-Chip → Klick → Canvas
  fliegt zum Knoten (fly-to).
- **Signal beim Coden:** „dieser Cue ist in die Situation eingetreten" — leise, einmal.

### 4.5 Memo + Relationen — der reflexive Kern (nicht Reibung)

- **Relation ziehen:** von Knotenrand zu Knoten → Relation entsteht → **inline-Memo-Prompt**. Der
  Inhalt der Relation *ist* ihr Memo (SA). Eine unbenannte Relation ist unfertig, kein Fehler.
- **Platzierungs-Memo:** optionales „warum hier?" beim Situieren — der reflexive Kern, angeboten,
  nie erzwungen.
- **Knoten-Memos:** Beschreibungs-Memo ↔ analytisches Memo (bestehende Memo-Ontologie), im Inspektor.

### 4.6 Intelligente Platzierung als Gerüst, nicht als Zeichnung

Deine „intelligente Platzierung" — verfassungssicher. Was die Maschine **darf**:

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
Abwesenheits-Marker. Man inspiziert sie; ein *Mensch* darf eine Silence erden (= *neues* Naming mit
der Silence als Ursprung). Die KI darf das Muster *zeigen*, nie erden (cue-only). Keine ziehbare
positive Kachel — eine Silence bleibt Cue, steigt nie den Gradienten hoch.

### 4.8 Liste + Reader als Alltagsflächen

Die Canvas ist die *untergeordnete* Projektion — Liste und Reader sind die täglichen Flächen:

- **Liste:** privilegierte, vollständige Sicht. Bekommt placed/unplaced/declined-Zustand,
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
| **1 · Kernhandlung** | Cue aus Coding sichtbar in Halde (📄); Ziehen Halde→Feld = situieren (protokolliert, umkehrbar); Liste bekommt placed/unplaced + Drag + Filter | Wenn eine Kollegin 30 frische Cues nicht spürbar klarer situiert als mit Auto-Layout+Reposition — verworfen |

**Stand Phase 1 (2026-07-18):** Ziehen aus der Halde ins Feld, Zurücknehmen über das
Knoten-Menü und das append-only Protokoll beider Akte sind gebaut (`situating_acts`,
Migration 034; sichtbar im Stack des Namings als eigener Abschnitt *Situating*). Das
Protokoll liegt bewusst **außerhalb** von `naming_acts`: eine Position ist Projektion,
keine Designation. Nur die Schwelle zählt als Akt — Verschieben und jeder Maschinen-Layout
schreiben nichts. Beim Bauen fiel auf, dass der **Lade-Pfad** koordinatenlose Namings der
Primary Map automatisch platzierte *und persistierte*; damit hätte die Halde keinen Reload
überlebt und Coding-Run-Ergebnisse wären maschinell situiert worden. Behoben — unaufgelöst
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
- [x] Silence bleibt Cue; nur Mensch erdet; KI zeigt nur das Muster.
- [x] Append-only im Kern respektiert; keine Hard-Deletes (kein Inline-Merge im Entwurf).
- [x] Liste privilegiert, Canvas untergeordnet.
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
| Liste + Reader sind die Alltagsflächen | §4.8 |
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
