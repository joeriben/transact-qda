# transact-qda — Zwischenstand und epistemologische Bilanz

Stand: 2026-03-21 | Sessions 00–18 | 10 Migrationen, ~60 Commits

---

## 1. Was wir uns vorgenommen hatten

Eine QDA-Plattform, die Clarke's Situational Analysis nicht einfach digitalisiert, sondern die materialitaetsbedingten Grenzen des Papierverfahrens ueberwindet — auf Grundlage von Dewey/Bentleys transaktionaler Ontologie (Knowing and the Known, 1949). Drei Kernversprechen:

1. **Namings ohne fixe Identitaet** — dasselbe Naming kann Entity, Relation, Silence, Prozess sein, je nach perspektivischer Kollabierung
2. **Append-only Designation** — ein Naming IST seine Geschichte (CCS-Gradient: Cue → Characterization → Specification, bidirektional)
3. **Drei-Schichten-Hierarchie** — Datenstruktur > Liste > Canvas, strikt eingehalten

Dazu: AI als Naming im Datenraum (nicht als externes Tool), Forscher-als-Naming (kein ontologischer Bruch Subjekt/Objekt), Provenance als Designstruktur (nicht als Metadaten).

---

## 2. Epistemologische Bilanz: Was gehalten wurde

### 2.1 Transaktionale Ontologie — eingeloest

Das 3-Tabellen-Modell (namings/participations/appearances) mit dem unified naming_acts-Stack bildet die transaktionale Ontologie sauber ab:

- **Namings** sind reine Potentialitaet (kein inherenter Typ)
- **Participations** sind selbst Namings (undirected bonds, meta-relational)
- **Appearances** kollabieren Namings perspektivisch (mode, valence, directed_from/to, properties)
- **naming_acts** sind append-only, multi-dimensional (inscription, designation, mode, valence)

Kein anderes QDA-Tool implementiert Non-Identity im Datenmodell. ATLAS.ti und MAXQDA operieren mit fixierten Entitaeten (Codes, Codefamilien, Netzwerke), die sich nicht perspektivisch transformieren koennen.

### 2.2 CCS-Gradient — eingeloest

- Bidirektional (Specification kann zu Cue zurueckfallen)
- Append-only (jede Aenderung ist ein neuer naming_act)
- Designation-Profile zeigen aggregierten Stand
- "Messy" und "Ordered" sind keine Modi, sondern der Zustand des CCS-Aggregats

### 2.3 Provenance — eingeloest

Zwei orthogonale Dimensionen operationalisiert:

| Dimension | Achse | Werte |
|-----------|-------|-------|
| Bestimmungsgrad | CCS-Gradient | Cue ↔ Characterization ↔ Specification |
| Verankerung | Grounding | Empirisch (Dokument-Anker) / Analytisch (Memo) / Unverankert |

### 2.4 Forscher-als-Naming — eingeloest

- Researcher-Naming per User per Projekt (auto-created)
- AI-Naming per Projekt (auto-created)
- Alle Acts attributiert (by-Feld)
- Kein ontologischer Bruch zwischen Subjekt und Objekt der Analyse

### 2.5 Drei-Schichten-Hierarchie — eingeloest

- Liste zeigt alles, was der Canvas zeigt (Phasen, Provenance, CCS, Memo-Count, AI-Status)
- Keine canvas-only Operations
- Ground Truth ist die Datenstruktur (DB), nicht die Darstellung

### 2.6 AI als Naming — eingeloest

- AI ist ein Naming im Datenraum mit eigener Researcher-Identitaet
- AI-Suggestions sind Cues (aiSuggested=true), nur Forscher kann designieren
- Discussion-Threads sind Participations (normale Datenstruktur-Operationen)
- Withdrawal-Mechanismus (aiWithdrawn) fuer Zuruecknahme
- Socratic Posture implementiert (ask, remind, reflect — nicht co-producing)

---

## 3. Was steht: Feature-Inventar

### 3.1 Map-Typen (3 von 4 geplanten)

| Typ | Status | Besonderheiten |
|-----|--------|----------------|
| **Situational Maps** | Vollstaendig | Entities, Relations, Silences, Processes, Constellations; Phases; Center-on; DisplayMode 3-way |
| **Social Worlds/Arenas** | Vollstaendig | Formations (4 Rollen: SW, Arena, Discourse, Organization); Spatial Relations (containment, overlap); Resize/Rotate |
| **Positional Maps** | Vollstaendig (v1) | Achsen als Namings; Positionen mit (x,y); Quadrant-Analyse; Absent Positions |
| **Network Maps** | Zurueckgestellt | Ontologischer Mismatch mit graph-theoretischen Tools (Gephi, UCINET); kein transaktionaler Mehrwert identifiziert |

### 3.2 Dokument-System

- Upload (PDF, Word, Text, Bilder)
- Text-Annotation (CSS Custom Highlight API, Character-Offsets)
- Bild-Annotation (SVG Rectangle Selection, normalisierte Koordinaten)
- In-vivo Coding (inline creation waehrend Annotation)
- Grounding Workspace als Infrastruktur-Perspektive

### 3.3 DocNets

- Virtuelle, nicht-destruktive Dokumentsets ueber Participations
- CRUD, Import auf Maps, Comparative View (Venn: shared / only_A / only_B)

### 3.4 Memo-System

- Lebenszyklus: active → presented → discussed → acknowledged → promoted → dismissed
- Kontextuelle Erstellung (Right-Click auf Element oder Canvas)
- Discussion-Threads (Researcher ↔ AI)
- Promotion zu Naming
- Memo-zu-Memo-Verlinkung (analytische Faeden)
- Canvas-Integration (Badges, Tooltips)

### 3.5 Collaboration

- Multi-User mit Rollen (owner, admin, member, viewer)
- Read-Only Maps (Templates)
- Researcher-Identitaet erhalten in Provenance-Kette

### 3.6 Canvas/Visualisierung

- Infinite Canvas mit Pan/Zoom
- ELK.js Force-Directed und Radial Layout
- Topology Snapshots (Auto-Buffer + Manual Save/Restore)
- FormationNode (Ellipse/Rect, Resize, Rotate)

---

## 4. Wo es Spannungen gibt

### 4.1 Clarke-Kritik im Tool reflektiert?

Die Clarke-Kritik (Mathar 2008, Bibbert 2025) — dass Clarke's Methode inter-aktional, nicht trans-aktional operiert — ist im Datenmodell aufgeloest: Namings haben keine fixe Identitaet, Relations sind First-Class. Aber die **UI-Ebene** reproduziert teilweise noch die inter-aktionale Logik: "Add Element" vs. "Add Relation" sind getrennte Operationen, obwohl transaktional beides Naming-Acts sind. Das ist ein akzeptabler UX-Kompromiss — die Datenstruktur ist sauber, die UI bietet Zugaenglichkeit.

### 4.2 AI-Kalibrierung

Der AI-Agent ist konzeptionell sauber (Socratic, Cue-only, Withdrawal), aber empirisch unkalibriert — die Hyperaktivitaet bei kleinen Canvas-Operationen ist ein bekanntes Problem. Benoetigt Testprojekte mit echtem empirischen Material.

### 4.3 Positional Maps v1 Limitation

Coupled axis-relations sind als appearance-properties (x_value, y_value) implementiert, nicht als eigenstaendige Relation-Namings. Wenn Achsen unabhaengige CCS-Geschichten brauchen, muss refactored werden. Fuer v1 akzeptabel.

---

## 5. Was kein anderes QDA-Tool kann

1. **Non-Identity im Datenmodell**: Dasselbe Naming transformiert sich perspektivisch (Entity → Relation → Silence). ATLAS.ti/MAXQDA/NVivo kennen nur fixierte Codes.
2. **Append-only Designation**: CCS-Gradient als konstitutive Geschichte, nicht als Metadaten-Feld. Kein "Rename" das die alte Version ueberschreibt.
3. **Relations als First-Class Namings**: Relationen haben eigene CCS-Gradienten, eigene Memos, eigene Document-Anchors, eigene Meta-Relationen. In ATLAS.ti sind Links flache Verbindungen ohne Substanz.
4. **Forscher und AI als Namings im Datenraum**: Ontologisch konsistent, nicht als externes Tool angeflangscht.
5. **Perspektivische Unabhaengigkeit**: Dasselbe Naming erscheint auf verschiedenen Maps mit verschiedenen Modi, Properties, CollapseAt-Punkten.
