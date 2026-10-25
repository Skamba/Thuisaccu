use crate::{
    Catalog, Result,
    solar::{SolarInterval, json},
};
use rusqlite::params;
use serde::Serialize;

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
        let connection = self.connection();
        let mut statement = connection.prepare("SELECT start_unix_s, end_unix_s, production_wh, consumption_wh, steady_consumption_wh, measured_import_wh, measured_export_wh FROM solar_intervals WHERE import_id = ? ORDER BY start_unix_s")?;
        let rows = statement.query_map([id], |r| {
            Ok(SolarInterval {
                start_unix_s: r.get("start_unix_s")?,
                end_unix_s: r.get("end_unix_s")?,
                production_wh: r.get("production_wh")?,
                consumption_wh: r.get("consumption_wh")?,
                steady_consumption_wh: r.get("steady_consumption_wh")?,
                measured_import_wh: r.get("measured_import_wh")?,
                measured_export_wh: r.get("measured_export_wh")?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub async fn solar_metadata(&self, id: i64) -> Result<serde_json::Value> {
        let (filename, sha256, options): (String, String, String) = self.connection().query_row(
            "SELECT filename, sha256, options_json FROM solar_imports WHERE id = ?",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        Ok(serde_json::json!({"filename":filename, "sha256":sha256, "options":json(&options)?}))
    }

    pub async fn save_analysis(&self, data: &NewAnalysis<'_>) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO analysis_runs (solar_import_id, title, model_version, profile_sha256, input_json, result_json, created_at_unix_s) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.import_id, data.title, data.model_version, data.profile_sha256,
                data.input_json, data.result_json, data.now],
            |row| row.get(0),
        )?)
    }

    pub async fn list_analyses(&self) -> Result<Vec<SavedAnalysis>> {
        let connection = self.connection();
        let rows = connection
            .prepare("SELECT id, title, created_at_unix_s, input_json, result_json FROM analysis_runs ORDER BY id DESC LIMIT 100")?
            .query_map([], |r| {
                Ok((
                    r.get("id")?,
                    r.get("title")?,
                    r.get("created_at_unix_s")?,
                    r.get::<_, String>("input_json")?,
                    r.get::<_, String>("result_json")?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(id, title, created_at_unix_s, input, result)| {
                Ok(SavedAnalysis {
                    id,
                    title,
                    created_at_unix_s,
                    input: json(&input)?,
                    result: json(&result)?,
                })
            })
            .collect()
    }
}
