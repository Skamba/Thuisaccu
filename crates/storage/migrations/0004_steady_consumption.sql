-- Deel van het bruto verbruik dat binnen een interval gelijkmatig loopt (bijvoorbeeld warmtepomp
-- en laadpaal in een geschat profiel). Leeg voor gemeten imports.
ALTER TABLE solar_intervals ADD COLUMN steady_consumption_wh REAL CHECK (
    steady_consumption_wh IS NULL
    OR (consumption_wh IS NOT NULL AND steady_consumption_wh >= 0 AND steady_consumption_wh <= consumption_wh)
);
