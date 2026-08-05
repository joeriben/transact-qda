-- Lauf-Buchführung für den Anker-Zug — SEPARIERBAR vom empirischen Kern.
--
-- Hält fest, welcher Durchgang über welches Dokument schon gelaufen ist, mit
-- welchem Kriterium und mit welchem Ergebnis. Zweck ist doppelt: nicht zweimal
-- dasselbe bezahlen, und ein abgeschlossenes Ergebnis wieder öffnen können,
-- ohne es neu zu erzeugen.
--
-- Das ist BUCHFÜHRUNG, kein Forschungsakt. Was hier steht, sind Hinweise —
-- Vorschläge des Helfers, die AUSSERHALB des Datenraums bleiben, bis der
-- Forscher einen davon durch einen eigenen Akt hereinholt (als Anker über die
-- Annotations-Route). Deshalb liegt nichts davon in `naming_acts`, und der
-- Kern lernt das Wort „Durchgang" nicht.
--
-- Trennbarkeitsvertrag (Abhängigkeit nur in eine Richtung: Buchführung -> Kern):
--   * namings, naming_acts, appearances verweisen nicht hierher.
--   * Entfernen = DROP TABLE anker_zug_runs. Keine Migration an einer
--     Kerntabelle, keine verwaiste Spalte irgendwo.
--
-- Append-only: Ein erneuter Durchgang ist eine NEUE Zeile. Der letzte Lauf zu
-- (naming, document, kriterium_hash) gilt; die früheren bleiben stehen und
-- zeigen, was sich geändert hat, als das Kriterium oder das Modell wechselte.

CREATE TABLE anker_zug_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Weiche Verweise in den Kern: Verschwindet das Naming oder das Dokument,
  -- ist der Lauf gegenstandslos und geht mit.
  naming_id   UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,

  -- Womit gelaufen wurde. Der Hash entscheidet, ob ein Lauf als „schon
  -- gelaufen" gilt: Ein geändertes Kriterium ist ein anderer Durchgang.
  kriterium       JSONB NOT NULL,
  kriterium_hash  TEXT  NOT NULL,
  provider        TEXT  NOT NULL,
  model           TEXT  NOT NULL,

  -- Was herauskam. `stellen` trägt die Funde selbst, damit ein abgeschlossener
  -- Lauf ohne neuen Aufruf wieder angezeigt werden kann.
  zuege_gesamt  INTEGER NOT NULL,
  geprueft      INTEGER NOT NULL,
  stellen       JSONB   NOT NULL DEFAULT '[]'::jsonb,
  unlesbar      INTEGER NOT NULL DEFAULT 0,
  nicht_belegt  INTEGER NOT NULL DEFAULT 0,

  -- Was er gekostet hat, vom Anbieter gemeldet.
  verbrauch     JSONB NOT NULL DEFAULT '{}'::jsonb,
  sekunden      INTEGER,

  -- Abgebrochene Läufe werden ebenfalls verbucht: Ein Abbruch ist kein
  -- Ergebnis, und ohne Vermerk sähe er aus wie „nichts gefunden".
  abgebrochen   BOOLEAN NOT NULL DEFAULT false,
  fehler        TEXT,

  gestartet_von UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anker_runs_project  ON anker_zug_runs(project_id);
CREATE INDEX idx_anker_runs_naming   ON anker_zug_runs(naming_id, document_id);
CREATE INDEX idx_anker_runs_kriterium ON anker_zug_runs(naming_id, document_id, kriterium_hash);
