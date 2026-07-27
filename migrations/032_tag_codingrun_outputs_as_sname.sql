-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Migration 032: Coding-Run-Outputs als Sequenz-Namings (SNames) taggen.
--
-- Pure DB-Operation. Diese Migration ändert KEINE Anwendungslogik in src/
-- und KEINEN LLM-Prompt — sie setzt ausschließlich den SName-Tag auf
-- bestehende DB-Zeilen, die per properties.aiPersona='coding-run' als
-- Output der per-document-Coding-Run-Engine identifiziert sind.
--
-- SName-Tag-Konvention im DB:
--   * valence = 'thematizes'
--   * properties.annotationKind = 'sequence-naming'
--
-- Diese Konvention bleibt mit dem Vokabular der inzwischen reverteten
-- Migrationen 029-031 konsistent (deren Dateien sind nicht mehr im
-- Codebase, ihre _migrations-Records bleiben als Audit-Spur erhalten),
-- führt aber keine neuen Spalten oder Tabellen ein.
--
-- Konsequenz für die UI: Der Codebase ist auf 1e3834e zurückgesetzt und
-- kennt SNames nicht — er filtert ausschließlich auf valence='codes'.
-- Nach dieser Migration sind die SName-Reihen für die UI unsichtbar.
-- Das ist gewollt und temporär: die nachfolgende Re-Implementierung
-- des SName/CName-Features wird die Render-Seite ergänzen.
--
-- Idempotent: WHERE-Klausel schließt bereits korrekt getaggte Zeilen aus.

UPDATE appearances
SET valence = 'thematizes',
    properties = (properties - 'annotationKind') || '{"annotationKind":"sequence-naming"}'::jsonb
WHERE mode = 'relation'
  AND properties->>'aiPersona' = 'coding-run'
  AND (valence != 'thematizes'
       OR (properties->>'annotationKind') IS DISTINCT FROM 'sequence-naming');
