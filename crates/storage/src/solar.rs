use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{Catalog, Result, StorageError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolarInterval {
    pub start_unix_s: i64,
    pub end_unix_s: i64,
    pub production_wh: f64,
    pub consumption_wh: Option<f64>,
    /// Deel van het verbruik dat binnen het interval gelijkmatig loopt; alleen bij geschatte profielen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steady_consumption_wh: Option<f64>,
    /// Netafname en teruglevering volgens de meter, zonder accu; alleen samen bekend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured_import_wh: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured_export_wh: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolarPeriod {
    pub label: String,
    pub production_kwh: f64,
    pub consumption_kwh: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolarSummary {
    pub rows: usize,
    pub from_unix_s: i64,
    pub to_unix_s: i64,
    pub coverage_hours: f64,
    pub gaps: usize,
    pub production_kwh: f64,
    pub consumption_kwh: Option<f64>,
    pub interval_surplus_kwh: Option<f64>,
    pub interval_deficit_kwh: Option<f64>,
    pub months: Vec<SolarPeriod>,
    pub warnings: Vec<String>,
    /// Negatief afgeleid bruto verbruik dat als meetafwijking op nul is gezet; alleen bij
    /// afleiding uit netafname en teruglevering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clipped_consumption_kwh: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SavedSolar {
    pub id: i64,
    pub filename: String,
    pub imported_at_unix_s: i64,
    pub options: serde_json::Value,
    pub summary: serde_json::Value,
    /// Bewaarde berekeningen op dit profiel; die verdwijnen mee als het profiel wordt verwijderd.
    pub analysis_runs: i64,
}

pub(crate) fn json<T: serde::de::DeserializeOwned>(text: &str) -> Result<T> {
    serde_json::from_str(text).map_err(|e| StorageError::Corrupt(e.to_string()))
}

impl Catalog {
    pub async fn save_solar(
        &self,
        filename: &str,
        sha256: &str,
        options: &str,
        summary: &str,
        intervals: &[SolarInterval],
        now: i64,
    ) -> Result<i64> {
        if intervals.is_empty() || intervals.len() > 250_000 {
            return Err(StorageError::InvalidInput(
                "Een profiel moet 1 tot 250.000 meetperioden bevatten.".into(),
            ));
        }
        for (index, item) in intervals.iter().enumerate() {
            if !item.production_wh.is_finite()
                || item.consumption_wh.is_some_and(|v| !v.is_finite())
                || [
                    item.steady_consumption_wh,
                    item.measured_import_wh,
                    item.measured_export_wh,
                ]
                .iter()
                .any(|v| v.is_some_and(|v| !v.is_finite()))
            {
                return Err(StorageError::NonFiniteNumber);
            }
            if item
                .steady_consumption_wh
                .is_some_and(|v| v < 0.0 || item.consumption_wh.is_none_or(|total| v > total))
            {
                return Err(StorageError::InvalidInput(
                    "Gelijkmatig verbruik moet tussen nul en het bruto verbruik liggen.".into(),
                ));
            }
            let measured = [item.measured_import_wh, item.measured_export_wh];
            if measured.iter().any(|v| v.is_some_and(|v| v < 0.0))
                || item.measured_import_wh.is_some() != item.measured_export_wh.is_some()
                || (item.measured_import_wh.is_some() && item.consumption_wh.is_none())
            {
                return Err(StorageError::InvalidInput(
                    "Gemeten netafname en teruglevering moeten samen voorkomen, niet negatief zijn en bruto verbruik hebben.".into(),
                ));
            }
            if index > 0 && intervals[index - 1].end_unix_s > item.start_unix_s {
                return Err(StorageError::InvalidInput(
                    "Meetperioden overlappen elkaar.".into(),
                ));
            }
        }
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let inserted: Option<i64> = tx.query_row("INSERT INTO solar_imports (filename, sha256, imported_at_unix_s, options_json, summary_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256, options_json) DO NOTHING RETURNING id",
            params![filename, sha256, now, options, summary], |row| row.get(0)).optional()?;
        let Some(id) = inserted else {
            let id: i64 = tx.query_row(
                "SELECT id FROM solar_imports WHERE sha256 = ? AND options_json = ?",
                params![sha256, options],
                |row| row.get(0),
            )?;
            // Hetzelfde bestand met dezelfde instellingen: het bestaande profiel blijft ongewijzigd,
            // zodat bewaarde berekeningen op dezelfde intervallen (en profiel-hash) blijven passen.
            tx.commit()?;
            return Ok(id);
        };
        {
            let mut insert = tx.prepare("INSERT INTO solar_intervals (import_id, start_unix_s, end_unix_s, production_wh, consumption_wh, steady_consumption_wh, measured_import_wh, measured_export_wh) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")?;
            for item in intervals {
                insert.execute(params![
                    id,
                    item.start_unix_s,
                    item.end_unix_s,
                    item.production_wh,
                    item.consumption_wh,
                    item.steady_consumption_wh,
                    item.measured_import_wh,
                    item.measured_export_wh
                ])?;
            }
        }
        tx.commit()?;
        Ok(id)
    }

    pub async fn list_solar(&self) -> Result<Vec<SavedSolar>> {
        let connection = self.connection();
        let rows = connection
            .prepare("SELECT id, filename, imported_at_unix_s, options_json, summary_json, (SELECT count(*) FROM analysis_runs WHERE solar_import_id = solar_imports.id) AS analysis_runs FROM solar_imports ORDER BY id DESC")?
            .query_map([], |r| {
                Ok((
                    r.get("id")?,
                    r.get("filename")?,
                    r.get("imported_at_unix_s")?,
                    r.get::<_, String>("options_json")?,
                    r.get::<_, String>("summary_json")?,
                    r.get("analysis_runs")?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(
                |(id, filename, imported_at_unix_s, options, summary, analysis_runs)| {
                    Ok(SavedSolar {
                        id,
                        filename,
                        imported_at_unix_s,
                        options: json(&options)?,
                        summary: json(&summary)?,
                        analysis_runs,
                    })
                },
            )
            .collect()
    }

    /// Verwijdert een profiel met zijn intervallen en de berekeningen erop, in één transactie.
    /// Geeft het aantal verwijderde berekeningen, of `None` als het profiel niet bestaat.
    pub async fn delete_solar(&self, id: i64) -> Result<Option<usize>> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let runs = tx.execute("DELETE FROM analysis_runs WHERE solar_import_id = ?", [id])?;
        tx.execute("DELETE FROM solar_intervals WHERE import_id = ?", [id])?;
        if tx.execute("DELETE FROM solar_imports WHERE id = ?", [id])? == 0 {
            return Ok(None);
        }
        tx.commit()?;
        Ok(Some(runs))
    }
}
