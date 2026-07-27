-- 028: coding_runs.codes_committed
--
-- Hintergrund:
-- Der UI-seitige `codesCommitted`-Zähler lebte bisher nur im In-Memory-State
-- des SSE-Streams. Sobald ein Run pausiert wird oder das Browser-Fenster den
-- Stream verliert, fällt der Zähler bei der Status-Polling-Antwort auf 0
-- zurück — obwohl die Codes längst persistiert sind. Wir spiegeln den Zähler
-- jetzt auf die Run-Zeile, sodass auch nach Reload / Pause / Resume das echte
-- "X Codes" angezeigt werden kann.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DEFAULT 0.

ALTER TABLE coding_runs
    ADD COLUMN IF NOT EXISTS codes_committed INTEGER NOT NULL DEFAULT 0;
