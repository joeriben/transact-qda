-- Zurückziehen und Wiederherstellen sind Akte.
--
-- Bisher setzte Withdraw nur ein Flag an der Erscheinung eines Namings
-- (appearances.properties.withdrawn); dass und wann es geschah und wer es tat,
-- ging verloren, und der Stack zeigte nach Withdraw und Restore nichts davon.
-- Beide Akte kommen in dasselbe append-only Protokoll wie das Eintreten in die
-- Situation einer Map und das Verlassen (034): Sie betreffen die Erscheinung
-- unter einer Perspektive (map_id), nicht die Designation.
--
-- Das Flag bleibt der Zustand; dieses Protokoll ist seine Geschichte.

ALTER TABLE situating_acts DROP CONSTRAINT IF EXISTS situating_acts_act_check;
ALTER TABLE situating_acts ADD CONSTRAINT situating_acts_act_check
  CHECK (act IN ('situate', 'unsituate', 'withdraw', 'restore'));
