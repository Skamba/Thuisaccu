use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{Catalog, Result, StorageError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolarInterval {
    pub start_unix_s: i64,
    pub end_unix_s: i64,
    pub production_wh: f64,
    pub consumption_wh: Option<f64>,
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
}

#[derive(Debug, Serialize)]
pub struct SavedSolar {
    pub id: i64,
    pub filename: String,
    pub imported_at_unix_s: i64,
    pub options: serde_json::Value,
    pub summary: serde_json::Value,
}

pub(crate) fn json(text: &str) -> Result<serde_json::Value> {
    serde_json::from_str(text).map_err(|e| StorageError::InvalidInput(e.to_string()))
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
                "Solar dataset must contain 1..250000 intervals".into(),
            ));
        }
        for (index, item) in intervals.iter().enumerate() {
            if !item.production_wh.is_finite()
                || item.consumption_wh.is_some_and(|v| !v.is_finite())
            {
                return Err(StorageError::NonFiniteNumber);
            }
            if index > 0 && intervals[index - 1].end_unix_s > item.start_unix_s {
                return Err(StorageError::InvalidInput(
                    "Overlapping solar intervals".into(),
                ));
            }
        }
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let inserted: Option<i64> = tx.query_row("INSERT INTO solar_imports (filename, sha256, imported_at_unix_s, options_json, summary_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256, options_json) DO NOTHING RETURNING id",
            params![filename, sha256, now, options, summary], |row| row.get(0)).optional()?;
        let Some(id) = inserted else {
            return Ok(tx.query_row(
                "SELECT id FROM solar_imports WHERE sha256 = ? AND options_json = ?",
                params![sha256, options],
                |row| row.get(0),
            )?);
        };
        {
            let mut insert = tx.prepare("INSERT INTO solar_intervals (import_id, start_unix_s, end_unix_s, production_wh, consumption_wh) VALUES (?, ?, ?, ?, ?)")?;
            for item in intervals {
                insert.execute(params![
                    id,
                    item.start_unix_s,
                    item.end_unix_s,
                    item.production_wh,
                    item.consumption_wh
                ])?;
            }
        }
        tx.commit()?;
        Ok(id)
    }

    pub async fn list_solar(&self) -> Result<Vec<SavedSolar>> {
        let connection = self.connection();
        let rows = connection
            .prepare("SELECT id, filename, imported_at_unix_s, options_json, summary_json FROM solar_imports ORDER BY id DESC")?
            .query_map([], |r| {
                Ok((
                    r.get("id")?,
                    r.get("filename")?,
                    r.get("imported_at_unix_s")?,
                    r.get::<_, String>("options_json")?,
                    r.get::<_, String>("summary_json")?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(id, filename, imported_at_unix_s, options, summary)| {
                Ok(SavedSolar {
                    id,
                    filename,
                    imported_at_unix_s,
                    options: json(&options)?,
                    summary: json(&summary)?,
                })
            })
            .collect()
    }
}
