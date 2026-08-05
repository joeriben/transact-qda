-- Das Kriterium eines Namings — SEPARIERBAR vom empirischen Kern.
--
-- Bis hierher wurde das Kriterium bei jedem Öffnen des Panels neu abgeleitet.
-- Damit war jede Korrektur des Forschers nach dem Schließen weg, und die
-- Ableitung schwankte zwischen zwei Aufrufen (dasselbe Naming bekam einmal
-- einen, einmal drei Bestandteile). Ein Kriterium, das sich unter der Hand
-- ändert, macht zwei Läufe unvergleichbar und die Korrektur wertlos.
--
-- Deshalb: Das Kriterium eines Namings steht hier, EINE Zeile je Naming, und
-- die Ableitung läuft nur, wenn keines da ist oder der Forscher ausdrücklich
-- neu ableiten lässt. Was er ändert, bleibt stehen.
--
-- Das ist BUCHFÜHRUNG, kein Forschungsakt. Ein Kriterium ist kein Naming und
-- keine Designation: Es sagt, wonach der Helfer sucht, nicht was der Fall ist.
-- Deshalb liegt nichts davon in `naming_acts`.
--
-- Trennbarkeitsvertrag (Abhängigkeit nur in eine Richtung: Buchführung -> Kern):
--   * namings, naming_acts, appearances verweisen nicht hierher.
--   * Entfernen = DROP TABLE anker_kriterien. Die Ableitung fällt dann auf ihr
--     altes Verhalten zurück (bei jedem Öffnen neu), nichts bricht.

CREATE TABLE anker_kriterien (
  naming_id  UUID PRIMARY KEY REFERENCES namings(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  kriterium  JSONB NOT NULL,

  -- Kam es aus der Ableitung oder aus der Hand des Forschers? Die Unterscheidung
  -- steht im Panel und entscheidet, wie viel Vertrauen es verdient.
  von_hand   BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX anker_kriterien_project_idx ON anker_kriterien (project_id);
