-- Dateien zu benennen ist kein Naming.
--
-- Dokumente liegen als Zeile in `namings`, weil `namings` die universelle
-- Knotentabelle dieser Anlage ist — auch Annotationen, Participations, Memos
-- und der Coding-Run-Aktant stehen dort. Das ist eine Aussage über die
-- Speicherung, nicht über den Designations-Gradienten. Ein Dateiname
-- durchläuft kein Cue → Characterization → Specification: weder der aus dem
-- Scanner („895503ngfi_qx3.docx") noch der sorgfältig gesetzte
-- („Interview Frau K., 3.4.") zeichnet etwas AM MATERIAL aus. Beide adressieren
-- einen Behälter, damit man ihn wiederfindet.
--
-- Bis hierher stand der Importname trotzdem in `namings.inscription` des
-- Dokuments und war damit der EINZIGE Ort, an dem er stand — die Datei auf der
-- Platte heißt `files/<uuid>.<ext>`. Wer umbenannte, löschte ihn.
--
-- Er gehört zu den technischen Angaben über die Datei, neben file_path,
-- mime_type und file_size. Hier. Das Etikett in `namings.inscription` darf sich
-- darüber frei ändern; ein naming_act entsteht dabei nicht.
ALTER TABLE document_content ADD COLUMN IF NOT EXISTS original_filename TEXT;

-- Nachtrag für Bestandsdokumente: Steht die Inskription noch auf einem Namen
-- mit der Endung, die auch die abgelegte Datei trägt, ist sie der Importname
-- und wurde nie umgeschrieben. Wo sie das nicht tut, wurde umbenannt und der
-- Importname ist bereits fort — dort bleibt die Spalte leer, statt einen
-- Anzeigenamen als Dateinamen auszugeben.
UPDATE document_content dc
SET original_filename = n.inscription
FROM namings n
WHERE n.id = dc.naming_id
  AND dc.original_filename IS NULL
  AND dc.file_path IS NOT NULL
  AND dc.file_path ~ '\.'
  AND lower(n.inscription) LIKE '%.' || lower(regexp_replace(dc.file_path, '^.*\.', ''));
