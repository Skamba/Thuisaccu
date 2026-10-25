-- Gemeten netafname en teruglevering per interval zonder accu (slimme meter). Met beide bekend is
-- de gelijktijdigheid van opwek en verbruik binnen het interval gemeten in plaats van geschat.
-- Leeg voor imports zonder meterdata en voor geschatte profielen.
ALTER TABLE solar_intervals ADD COLUMN measured_import_wh REAL CHECK (
    measured_import_wh IS NULL
    OR (consumption_wh IS NOT NULL AND measured_import_wh >= 0)
);
ALTER TABLE solar_intervals ADD COLUMN measured_export_wh REAL CHECK (
    (measured_export_wh IS NULL) = (measured_import_wh IS NULL)
    AND (measured_export_wh IS NULL OR measured_export_wh >= 0)
);
