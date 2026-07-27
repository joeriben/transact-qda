-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Migration 027: coding_runs — State-Persistenz für den Per-Dokument-Coding-Run
--
-- Adoption von SARAHs Migration 038 (pipeline_runs) + 056 (cancelled-Status)
-- für transact-qdas SA-agnostischen Coding-Run pro Dokument. Wir folgen
-- SARAHs Run-Management 1:1 (start/resume, pause/cancel, status-Lifecycle,
-- partial-unique-Slot, accumulated tokens, last_event_at als Heartbeat-
-- Anker für den Stuck-Watchdog) und passen nur an, was strukturell
-- transact-qda statt SARAH ist:
--
--   * (case_id, central_document_id) → (project_id, document_id).
--     Coding-Run ist projektgebunden und dokumentbezogen, kein „Case".
--   * Heuristik-Pfade (h1/h2/h3/h4/h5/meta) → eine einzige Coding-Strategie
--     (H1↔H2-Konfrontation auf der vollen Dokumentlänge). Keine User-
--     Auswahl, kein Sequenz-Cap — Begrenzung erfolgt über Pause/Cancel.
--   * NEU: segmentation_snapshot JSONB. Die thematischen Sequenzen werden
--     algorithmisch berechnet (segmentation.ts, TextTiling-on-embeddings)
--     und im Default-Pfad nicht persistiert (Variante A: ephemer pro Run).
--     Für Resume-Konsistenz schreibt der Orchestrator die Sequenz-Liste
--     beim Run-Start in dieses Feld; Resume re-segmentiert NICHT, sondern
--     liest den Snapshot. Sonst würde eine Tunable-Änderung oder ein
--     Embedding-Drift zwischen Start und Resume das current_index-Mapping
--     zerstören.
--   * NEU: sequence_status JSONB. Map { "<seq_index>": "done" } — gefüllt
--     von commitCodedPassage über den Run-Loop nach jedem erfolgreich
--     committeten Sequenz-Atom. Resume liest das, um bereits erledigte
--     Sequenzen zu skippen. Die kombinierte Idempotenz-Linie ist:
--       a) write.ts commitCodedPassage skip-on-existing (server-seitig),
--       b) sequence_status (Loop-seitig, vermeidet die Re-Berechnung
--          des LLM-Trips für bereits erledigte Sequenzen).
--
-- Status-Lifecycle (1:1 SARAH):
--   'running'   — Loop aktiv
--   'paused'    — User-Pause; Resume durch erneuten Start möglich
--   'completed' — alle Sequenzen abgeschlossen
--   'failed'    — irrecoverabler Fehler; error_message gesetzt
--   'cancelled' — User-Cancel mit intent='cancel'; gibt den Doc-Slot frei,
--                 ein erneutes POST startet einen frischen Run (cancelled
--                 ist im partial-unique-index ausgeschlossen).
--
-- Cancel-Signal-Trennung (SARAH Migration 056):
--   cancel_intent='pause'  → bei nächster Idempotenz-Grenze status='paused'
--   cancel_intent='cancel' → bei nächster Idempotenz-Grenze status='cancelled'
--   cancel_intent=NULL     → kein Cancel angefordert
--
-- Genau ein nicht-terminaler Run pro (project, document): ein laufender
-- Coding-Run auf demselben Dokument würde dieselben Sequenzen idempotent
-- bearbeiten (Verschwendung); der partial-unique-index erzwingt das DB-
-- seitig. Mehrere Runs auf verschiedenen Dokumenten desselben Projekts
-- sind erlaubt.

CREATE TABLE IF NOT EXISTS coding_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES namings(id) ON DELETE CASCADE,
    started_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),

    -- Anzeige- und Resume-Information. current_index ist 0-basiert; bei
    -- Resume zählt der Loop schon-erledigte Sequenzen via sequence_status
    -- neu, also dient dieser Wert primär der UI beim Reconnect.
    current_index INTEGER NOT NULL DEFAULT 0,
    total_sequences INTEGER NULL,
    last_step_label TEXT NULL,

    -- Original-Optionen-Slot (für zukünftige path-relevante Felder, falls
    -- jemals nötig). Aktuell leer; mergeOptions ist trivial.
    options JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Sequenz-Liste, eingefroren beim Run-Start. Format: Array von
    -- { seq, charStart, charEnd, text, sentenceCount, method }.
    -- Beim Resume nicht neu berechnen — sonst kann eine Tunable-
    -- Änderung oder ein Embedding-Drift die Boundaries verschieben und
    -- das current_index-Mapping unhaltbar machen.
    segmentation_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    segmentation_method TEXT NULL CHECK (segmentation_method IN ('cohesion', 'char-window') OR segmentation_method IS NULL),

    -- Per-Sequenz-Status: Map { "<seq_index>": "done" }. Wird vom Loop
    -- nach jedem erfolgreichen commitCodedPassage gesetzt. Resume liest
    -- das, um bereits erledigte Sequenzen zu skippen.
    sequence_status JSONB NOT NULL DEFAULT '{}'::jsonb,

    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    cancel_intent TEXT NULL CHECK (cancel_intent IS NULL OR cancel_intent IN ('pause', 'cancel')),
    error_message TEXT NULL,

    accumulated_input_tokens BIGINT NOT NULL DEFAULT 0,
    accumulated_output_tokens BIGINT NOT NULL DEFAULT 0,
    accumulated_cache_read_tokens BIGINT NOT NULL DEFAULT 0,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paused_at TIMESTAMPTZ NULL,
    resumed_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coding_runs_project_document
    ON coding_runs(project_id, document_id, started_at DESC);

-- Genau ein nicht-terminaler Run pro (project, document). 'cancelled' ist
-- aus dem partial-unique-Index ausgeschlossen (1:1 SARAH-Setzung Mig 056):
-- ein cancelled Run gibt den Slot frei, ein neuer Lauf darf gestartet
-- werden. 'paused' bleibt im Index, weil ein pausierter Run resumierbar
-- ist und der Slot belegt bleiben muss.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_coding_runs_document_active
    ON coding_runs(project_id, document_id)
    WHERE status IN ('running', 'paused');
