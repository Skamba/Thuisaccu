use rusqlite::params;
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
    /// Gemeten netafname en teruglevering over het hele profiel; alleen bij meterdata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_import_kwh: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_export_kwh: Option<f64>,
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

/// Een bewaard of al bestaand profiel na [`Catalog::import_solar`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSolar {
    pub id: i64,
    /// `true` als hetzelfde profiel al bewaard was; dan is niets gewijzigd.
    pub existing: bool,
    /// De naam van het bewaarde profiel; bij een bestaand profiel de naam van toen.
    pub filename: String,
}

/// Namen die eerdere versies in de instellingen bewaarden. Ze tellen niet mee bij de vraag of een
/// profiel al bestaat: dezelfde bestanden onder een andere naam zijn hetzelfde profiel.
const NAME_KEYS: [&str; 2] = ["meter_filename", "source_filename"];

fn without_names(mut options: serde_json::Value) -> serde_json::Value {
    if let Some(map) = options.as_object_mut() {
        for key in NAME_KEYS {
            map.remove(key);
        }
    }
    options
}

impl Catalog {
    /// Bewaart een profiel en geeft het ID; zie [`Catalog::import_solar`].
    pub async fn save_solar(
        &self,
        filename: &str,
        sha256: &str,
        options: &str,
        summary: &str,
        intervals: &[SolarInterval],
        now: i64,
    ) -> Result<i64> {
        Ok(self
            .import_solar(filename, sha256, options, summary, intervals, now)
            .await?
            .id)
    }

    /// Bewaart een profiel, tenzij er al een is met dezelfde hash en dezelfde instellingen (namen
    /// uit eerdere versies niet meegeteld). Opzoeken en bewaren gebeuren in één transactie, zodat
    /// twee gelijktijdige uploads niet allebei een nieuw profiel melden. Een bestaand profiel blijft
    /// ongewijzigd, zodat bewaarde berekeningen op dezelfde intervallen (en profiel-hash) blijven passen.
    pub async fn import_solar(
        &self,
        filename: &str,
        sha256: &str,
        options: &str,
        summary: &str,
        intervals: &[SolarInterval],
        now: i64,
    ) -> Result<StoredSolar> {
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
        let wanted = without_names(
            serde_json::from_str(options).map_err(|e| StorageError::InvalidInput(e.to_string()))?,
        );
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let candidates = tx
            .prepare(
                "SELECT id, filename, options_json FROM solar_imports WHERE sha256 = ? ORDER BY id",
            )?
            .query_map([sha256], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, existing_name, existing_options) in candidates {
            if without_names(json(&existing_options)?) == wanted {
                tx.commit()?;
                return Ok(StoredSolar {
                    id,
                    existing: true,
                    filename: existing_name,
                });
            }
        }
        let id: i64 = tx.query_row("INSERT INTO solar_imports (filename, sha256, imported_at_unix_s, options_json, summary_json) VALUES (?, ?, ?, ?, ?) RETURNING id",
            params![filename, sha256, now, options, summary], |row| row.get(0))?;
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
        Ok(StoredSolar {
            id,
            existing: false,
            filename: filename.to_owned(),
        })
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
