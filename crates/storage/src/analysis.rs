use crate::{Catalog, Result, StorageError, solar::SolarInterval};
use serde::Serialize;
use sqlx::Row;

#[derive(Debug, Serialize)]
pub struct SavedAnalysis {
    pub id: i64,
    pub title: String,
    pub created_at_unix_s: i64,
    pub input: serde_json::Value,
    pub result: serde_json::Value,
}

pub struct NewAnalysis<'a> {
    pub import_id: i64,
    pub title: &'a str,
    pub model_version: &'a str,
    pub profile_sha256: &'a str,
    pub input_json: &'a str,
    pub result_json: &'a str,
    pub now: i64,
}

impl Catalog {
    pub async fn solar_intervals(&self, id: i64) -> Result<Vec<SolarInterval>> {
        let rows = sqlx::query("SELECT start_unix_s, end_unix_s, production_wh, consumption_wh FROM solar_intervals WHERE import_id = ? ORDER BY start_unix_s")
            .bind(id).fetch_all(self.pool()).await?;
        rows.into_iter()
            .map(|r| {
                Ok(SolarInterval {
                    start_unix_s: r.try_get("start_unix_s")?,
                    end_unix_s: r.try_get("end_unix_s")?,
                    production_wh: r.try_get("production_wh")?,
                    consumption_wh: r.try_get("consumption_wh")?,
                })
            })
            .collect()
    }

    pub async fn solar_metadata(&self, id: i64) -> Result<serde_json::Value> {
        let row =
            sqlx::query("SELECT filename, sha256, options_json FROM solar_imports WHERE id = ?")
                .bind(id)
                .fetch_one(self.pool())
                .await?;
        let options: String = row.try_get("options_json")?;
        Ok(
            serde_json::json!({"filename":row.try_get::<String,_>("filename")?, "sha256":row.try_get::<String,_>("sha256")?, "options":serde_json::from_str::<serde_json::Value>(&options).map_err(|e| StorageError::InvalidInput(e.to_string()))?}),
        )
    }

    pub async fn save_analysis(&self, data: &NewAnalysis<'_>) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO analysis_runs (solar_import_id, title, model_version, profile_sha256, input_json, result_json, created_at_unix_s) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.import_id).bind(data.title).bind(data.model_version).bind(data.profile_sha256).bind(data.input_json).bind(data.result_json).bind(data.now)
            .fetch_one(self.pool()).await?)
    }

    pub async fn list_analyses(&self) -> Result<Vec<SavedAnalysis>> {
        let rows = sqlx::query("SELECT id, title, created_at_unix_s, input_json, result_json FROM analysis_runs ORDER BY id DESC LIMIT 100")
            .fetch_all(self.pool()).await?;
        rows.into_iter()
            .map(|r| {
                let input: String = r.try_get("input_json")?;
                let result: String = r.try_get("result_json")?;
                Ok(SavedAnalysis {
                    id: r.try_get("id")?,
                    title: r.try_get("title")?,
                    created_at_unix_s: r.try_get("created_at_unix_s")?,
                    input: serde_json::from_str(&input)
                        .map_err(|e| StorageError::InvalidInput(e.to_string()))?,
                    result: serde_json::from_str(&result)
                        .map_err(|e| StorageError::InvalidInput(e.to_string()))?,
                })
            })
            .collect()
    }
}
