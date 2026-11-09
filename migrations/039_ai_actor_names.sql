-- KI-Akteure tragen den Namen ihrer Funktion, keinen Firmennamen.
-- BJ, 09.11.2026: „KI-Naming - Firmennamen sind ohnehin nicht autorisiert.
-- KI-Agents haben bereits Namen (Coach)" — „oder heißten "(FUnktion)-Agent"".
--
-- Das KI-Naming eines Projekts hieß „Claude (Analyst)" und heißt jetzt
-- „Analysis-Agent"; der Akteur der Naming-Runs hieß in Projekten vor dem
-- 09.11. „Coding-Run" und heißt jetzt „Naming-Run" („Code" ist verabschiedet).
--
-- Umbenennen ist ein Akt im Stack, wie bei renameNaming: zuerst festhalten,
-- was dastand (falls noch kein Inskriptions-Akt existiert, mit dem Datum der
-- Entstehung), dann den Umschreib-Akt anhängen, dann die Inskription setzen.
-- Der Akt steht unter dem Naming selbst (wie sein Gründungsakt); die Notiz
-- sagt, dass die Plattform umbenannt hat. Nichts wird gelöscht.

-- 1. Analysis-Agent ------------------------------------------------------------
INSERT INTO naming_acts (naming_id, by, inscription, created_at)
SELECT n.id, n.id, n.inscription, n.created_at
  FROM namings n JOIN ai_namings a ON a.naming_id = n.id
 WHERE n.inscription = 'Claude (Analyst)'
   AND NOT EXISTS (SELECT 1 FROM naming_acts na WHERE na.naming_id = n.id AND na.inscription IS NOT NULL);

INSERT INTO naming_acts (naming_id, by, inscription, memo_text)
SELECT n.id, n.id, 'Analysis-Agent',
       'Renamed by the platform: AI actors are named by their function, not by a company name.'
  FROM namings n JOIN ai_namings a ON a.naming_id = n.id
 WHERE n.inscription = 'Claude (Analyst)';

UPDATE namings n SET inscription = 'Analysis-Agent'
  FROM ai_namings a
 WHERE a.naming_id = n.id AND n.inscription = 'Claude (Analyst)';

-- 2. Naming-Run ----------------------------------------------------------------
INSERT INTO naming_acts (naming_id, by, inscription, created_at)
SELECT n.id, n.id, n.inscription, n.created_at
  FROM namings n
  JOIN appearances ap ON ap.naming_id = n.id AND ap.perspective_id = n.id AND ap.mode = 'perspective'
 WHERE ap.properties->>'role' = 'coding-run-agent' AND n.inscription = 'Coding-Run'
   AND NOT EXISTS (SELECT 1 FROM naming_acts na WHERE na.naming_id = n.id AND na.inscription IS NOT NULL);

INSERT INTO naming_acts (naming_id, by, inscription, memo_text)
SELECT n.id, n.id, 'Naming-Run',
       'Renamed by the platform: "code" is retired in favour of "naming".'
  FROM namings n
  JOIN appearances ap ON ap.naming_id = n.id AND ap.perspective_id = n.id AND ap.mode = 'perspective'
 WHERE ap.properties->>'role' = 'coding-run-agent' AND n.inscription = 'Coding-Run';

UPDATE namings n SET inscription = 'Naming-Run'
  FROM appearances ap
 WHERE ap.naming_id = n.id AND ap.perspective_id = n.id AND ap.mode = 'perspective'
   AND ap.properties->>'role' = 'coding-run-agent' AND n.inscription = 'Coding-Run';
