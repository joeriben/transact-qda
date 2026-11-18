-- Eine Schicht des Stacks aktivieren — und dass sie aktiviert wurde, ist selbst ein Akt.
--
-- Ein Naming IST sein Stack (BJ, Session 03: „das ELement IST diese Schichtung
-- seiner Veränderungen, acuh wenn wir die letzte als Naming verwenden
-- (Aufhebungen)"). „jedes Naming erhält eben einen INdex (default ist das
-- oberste), und diser INdex ist sein Collapse" (ebd.). Maps behalten ihre
-- Indizes (Session 09). Zwei Wege, eine Schicht zu aktivieren:
--
-- 1. Unter einer Perspektive (Map, Phase): die Perspektive kollabiert den
--    Stack auf diese Schicht. Der Zustand steht wie bisher an der Erscheinung
--    (appearances.properties.collapseAt = seq eines Akts dieses Namings); der
--    Akt des Kollabierens und des Zurückgehens auf die oberste Schicht steht
--    jetzt im selben Protokoll wie Platzieren, Zurückziehen, Wiederherstellen
--    (034, 038) — er betrifft die Erscheinung unter einer Perspektive, nicht
--    die Designation. Bisher wurde er nicht festgehalten; am 03.07.2026 nannte
--    der Assistent das als Befund („der Kollaps-Akt selbst wird nicht
--    historisiert"), BJ: „offensichtlich falsch implementiert. sollte aufgrund
--    der vorhandenen Ontologie leicht zu beheben sein."
--
-- 2. Im Datenraum (Naming-Liste, Detailseite): die Schicht wird wieder die
--    oberste — durch einen neuen Akt im Stack, der Inschrift und Designation
--    dieser Schicht aufnimmt. Nichts wird überschrieben (append-only, S08);
--    activates_seq sagt, welche Schicht der Akt aufnimmt.

ALTER TABLE situating_acts ADD COLUMN IF NOT EXISTS collapse_at BIGINT;

ALTER TABLE situating_acts DROP CONSTRAINT IF EXISTS situating_acts_act_check;
ALTER TABLE situating_acts ADD CONSTRAINT situating_acts_act_check
  CHECK (act IN ('situate', 'unsituate', 'withdraw', 'restore', 'collapse', 'release'));

ALTER TABLE naming_acts ADD COLUMN IF NOT EXISTS activates_seq BIGINT;

-- Akte über ihre seq finden (Kollaps-Indizes, aktivierte Schichten); der
-- Primärschlüssel beginnt mit naming_id.
CREATE INDEX IF NOT EXISTS idx_na_seq ON naming_acts (seq);

-- Ein Kollaps-Index aus den Eigenschaften einer Erscheinung — nur, wenn er
-- eine Zahl ist (properties ist JSONB; ein anderer Wert ist kein Index).
CREATE OR REPLACE FUNCTION collapse_seq(p_props JSONB) RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_props->>'collapseAt' ~ '^[0-9]{1,18}$' THEN (p_props->>'collapseAt')::bigint END
$$;

-- Wessen Schicht ist der Akt p_seq im Stack von p_naming? Die eigene, oder
-- die eines Namings, das (auch mittelbar) in p_naming aufgenommen wurde: der
-- Stack des Aufgenommenen steht unter dem Merge-Akt im Stack des
-- Überlebenden, und eine Map, die vor dem Merge eine seiner Schichten zeigte,
-- zeigt sie weiter. NULL: keine Schicht dieses Stacks.
DROP FUNCTION IF EXISTS naming_layer_owner(UUID, BIGINT);
CREATE FUNCTION naming_layer_owner(p_naming UUID, p_seq BIGINT) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM naming_acts WHERE naming_id = p_naming AND seq = p_seq) THEN p_naming
    ELSE (
      WITH RECURSIVE absorbed(id, depth) AS (
        SELECT p_naming, 0
        UNION
        SELECT l.id, ab.depth + 1
          FROM absorbed ab
          JOIN naming_acts m ON m.naming_id = ab.id
           AND m.memo_text IS NULL AND m.inscription IS NULL AND m.designation IS NULL
           AND m.mode IS NULL AND m.valence IS NULL AND m.activates_seq IS NULL
           AND cardinality(m.linked_naming_ids) > 0
          CROSS JOIN LATERAL unnest(m.linked_naming_ids) AS l(id)
          JOIN namings mn ON mn.id = l.id AND mn.deleted_at IS NOT NULL
         WHERE ab.depth < 8
      )
      SELECT h.naming_id FROM naming_acts h
       WHERE h.seq = p_seq AND h.naming_id IN (SELECT id FROM absorbed) AND h.naming_id <> p_naming
       LIMIT 1
    )
  END
$$;

-- Der Zustand eines Namings auf einer Schicht seines Stacks: Inschrift,
-- Designation und Valenz, wie sie mit diesem Akt galten (S03: ein Index, aus
-- dem sich der Zustand ergibt).
--
-- Die Schichten folgen der Zeit der Akte (auf die Millisekunde, dann seq),
-- wie der Stack sie zeigt. seq allein genügt nicht: Nachträge tragen eine
-- spätere seq als ihre Zeit (renameNaming hält eine Inschrift fest, bevor es
-- sie überschreibt, mit der Zeit des Namings — über JavaScript auf die
-- Millisekunde gekürzt; zurückgenommene Memo-Akte vom 09.11.2026 stehen mit
-- ihrer ursprünglichen Zeit im Stack).
--
-- Ist p_seq ein Akt eines aufgenommenen Namings, gilt dessen Stack
-- (naming_layer_owner). Ist p_seq kein Akt (Kollaps aus der Zeit vor 009, als
-- die Ketten eigene seq hatten), gilt der letzte Akt bis zu diesem seq, liegt
-- keiner davor, der erste.
--
-- Inschrift: die letzte bis zu dieser Schicht; sonst eine mit derselben Zeit
-- (Nachtrag mit späterer seq). Gibt es bis hierher keine: trägt das Naming gar
-- keinen Inschrift-Akt, seine Inschrift; eine Relation hatte damals keinen
-- eigenen Namen (''); eine Entität hatte einen, der erst später als Akt
-- festgehalten wurde (der früheste bekannte).
-- Designation: die letzte bis hierher, sonst cue.
-- Valenz: die letzte bis hierher ('' = entfernt), sonst NULL (keine erfasst).
-- state_seq: die Schicht, die diesen Zustand setzt (Memo-Akte setzen keinen).
DROP FUNCTION IF EXISTS naming_state_at(UUID, BIGINT);
CREATE FUNCTION naming_state_at(p_naming UUID, p_seq BIGINT)
RETURNS TABLE (layer_seq BIGINT, layer_at TIMESTAMPTZ, inscription TEXT, designation TEXT,
               valence TEXT, state_seq BIGINT, owner UUID)
LANGUAGE sql STABLE AS $$
  WITH o AS (SELECT COALESCE(naming_layer_owner(p_naming, p_seq), p_naming) AS id),
  c AS (
    SELECT x.seq, x.created_at, date_trunc('milliseconds', x.created_at) AS t, x.naming_id
      FROM (
        (SELECT 0 AS pri, na.seq, na.created_at, na.naming_id FROM naming_acts na, o
          WHERE na.naming_id = o.id AND na.seq <= p_seq ORDER BY na.seq DESC LIMIT 1)
        UNION ALL
        (SELECT 1 AS pri, na.seq, na.created_at, na.naming_id FROM naming_acts na, o
          WHERE na.naming_id = o.id ORDER BY date_trunc('milliseconds', na.created_at), na.seq LIMIT 1)
      ) x
     ORDER BY x.pri LIMIT 1
  )
  SELECT c.seq, c.created_at,
    COALESCE(
      (SELECT na.inscription FROM naming_acts na
        WHERE na.naming_id = c.naming_id AND na.inscription IS NOT NULL
          AND (date_trunc('milliseconds', na.created_at), na.seq) <= (c.t, c.seq)
        ORDER BY date_trunc('milliseconds', na.created_at) DESC, na.seq DESC LIMIT 1),
      (SELECT na.inscription FROM naming_acts na
        WHERE na.naming_id = c.naming_id AND na.inscription IS NOT NULL
          AND date_trunc('milliseconds', na.created_at) <= c.t
        ORDER BY date_trunc('milliseconds', na.created_at) DESC, na.seq ASC LIMIT 1),
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM naming_acts na
                          WHERE na.naming_id = c.naming_id AND na.inscription IS NOT NULL)
          THEN (SELECT n.inscription FROM namings n WHERE n.id = c.naming_id)
        WHEN EXISTS (SELECT 1 FROM participations p WHERE p.id = c.naming_id) THEN ''
        ELSE (SELECT na.inscription FROM naming_acts na
               WHERE na.naming_id = c.naming_id AND na.inscription IS NOT NULL
               ORDER BY date_trunc('milliseconds', na.created_at), na.seq LIMIT 1)
      END
    ),
    COALESCE(
      (SELECT na.designation FROM naming_acts na
        WHERE na.naming_id = c.naming_id AND na.designation IS NOT NULL
          AND (date_trunc('milliseconds', na.created_at), na.seq) <= (c.t, c.seq)
        ORDER BY date_trunc('milliseconds', na.created_at) DESC, na.seq DESC LIMIT 1),
      'cue'),
    (SELECT na.valence FROM naming_acts na
      WHERE na.naming_id = c.naming_id AND na.valence IS NOT NULL
        AND (date_trunc('milliseconds', na.created_at), na.seq) <= (c.t, c.seq)
      ORDER BY date_trunc('milliseconds', na.created_at) DESC, na.seq DESC LIMIT 1),
    (SELECT na.seq FROM naming_acts na
      WHERE na.naming_id = c.naming_id
        AND (na.inscription IS NOT NULL OR na.designation IS NOT NULL OR na.valence IS NOT NULL)
        AND (date_trunc('milliseconds', na.created_at), na.seq) <= (c.t, c.seq)
      ORDER BY date_trunc('milliseconds', na.created_at) DESC, na.seq DESC LIMIT 1),
    c.naming_id
  FROM c
$$;
