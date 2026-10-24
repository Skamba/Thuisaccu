use serde::{Deserialize, Serialize};
use sqlx::Row;

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
        let mut tx = self.pool().begin().await?;
        let inserted: Option<i64> = sqlx::query_scalar("INSERT INTO solar_imports (filename, sha256, imported_at_unix_s, options_json, summary_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256, options_json) DO NOTHING RETURNING id")
        .bind(filename).bind(sha256).bind(now).bind(options).bind(summary)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(id) = inserted else {
            let id: i64 = sqlx::query_scalar(
                "SELECT id FROM solar_imports WHERE sha256 = ? AND options_json = ?",
            )
            .bind(sha256)
            .bind(options)
            .fetch_one(&mut *tx)
            .await?;
            tx.rollback().await?;
            return Ok(id);
        };
        for item in intervals {
            sqlx::query("INSERT INTO solar_intervals (import_id, start_unix_s, end_unix_s, production_wh, consumption_wh) VALUES (?, ?, ?, ?, ?)")
                .bind(id).bind(item.start_unix_s).bind(item.end_unix_s).bind(item.production_wh).bind(item.consumption_wh).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(id)
    }

    pub async fn list_solar(&self) -> Result<Vec<SavedSolar>> {
        let rows = sqlx::query("SELECT id, filename, imported_at_unix_s, options_json, summary_json FROM solar_imports ORDER BY id DESC")
            .fetch_all(self.pool()).await?;
        rows.into_iter()
            .map(|r| {
                let options: String = r.try_get("options_json")?;
                let summary: String = r.try_get("summary_json")?;
                Ok(SavedSolar {
                    id: r.try_get("id")?,
                    filename: r.try_get("filename")?,
                    imported_at_unix_s: r.try_get("imported_at_unix_s")?,
                    options: serde_json::from_str(&options)
                        .map_err(|e| StorageError::InvalidInput(e.to_string()))?,
                    summary: serde_json::from_str(&summary)
                        .map_err(|e| StorageError::InvalidInput(e.to_string()))?,
                })
            })
            .collect()
    }
}
