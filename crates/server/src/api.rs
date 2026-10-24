use axum::{
    Json,
    extract::{Multipart, State},
    http::StatusCode,
};
use chrono::Utc;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thuisaccu_storage::{
    Catalog, StorageError,
    comparison::{CandidateDraft, Comparison},
};

use crate::solar_import::{self, ImportOptions};

pub type ApiError = (StatusCode, Json<Value>);

fn bad_request(message: impl Into<String>) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":"invalid_input", "message":message.into()})),
    )
}

pub fn database_error(error: StorageError) -> ApiError {
    match &error {
        StorageError::InvalidInput(_)
        | StorageError::UnknownCode(_)
        | StorageError::NonFiniteNumber => bad_request(error.to_string()),
        StorageError::Database(sqlx_error)
            if sqlx_error.as_database_error().is_some_and(|e| {
                e.is_check_violation()
                    || e.is_foreign_key_violation()
                    || e.is_unique_violation()
                    || e.code()
                        .and_then(|code| code.parse::<u32>().ok())
                        .is_some_and(|code| code & 255 == 19)
            }) =>
        {
            bad_request(
                "De invoer voldoet niet aan de gegevensregels; controleer waarden, codes en brongegevens.",
            )
        }
        _ => {
            tracing::error!(%error, "Database operation failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"database_error"})),
            )
        }
    }
}

pub async fn comparison(State(catalog): State<Catalog>) -> Result<Json<Comparison>, ApiError> {
    catalog.comparison().await.map(Json).map_err(database_error)
}

pub async fn add_candidate(
    State(catalog): State<Catalog>,
    Json(input): Json<CandidateDraft>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let id = catalog
        .add_candidate(&input, Utc::now().timestamp())
        .await
        .map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(json!({"configuration_id":id}))))
}

pub async fn references(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let drafts: Vec<CandidateDraft> =
        serde_json::from_str(include_str!("../resources/references.json")).map_err(|error| {
            tracing::error!(%error, "Invalid reference resource");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"reference_data_error"})),
            )
        })?;
    let imported = catalog
        .import_references("research-2026-10-24-v1", &drafts, Utc::now().timestamp())
        .await
        .map_err(database_error)?;
    Ok(Json(json!({"imported":imported})))
}

struct Upload {
    filename: String,
    bytes: Vec<u8>,
    options: ImportOptions,
}

async fn upload(mut multipart: Multipart) -> Result<Upload, ApiError> {
    let mut file = None;
    let mut options = ImportOptions::default();
    let mut options_seen = false;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| bad_request(e.to_string()))?
    {
        match field.name() {
            Some("file") => {
                if file.is_some() {
                    return Err(bad_request("Kies één bestand."));
                }
                let filename = field.file_name().unwrap_or("upload.csv").to_owned();
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| bad_request(e.to_string()))?;
                if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
                    return Err(bad_request("Gebruik een bestand van maximaal 10 MB."));
                }
                file = Some((filename, bytes.to_vec()));
            }
            Some("options") => {
                if options_seen {
                    return Err(bad_request("Importinstellingen zijn dubbel meegestuurd."));
                }
                options_seen = true;
                options = serde_json::from_str(
                    &field.text().await.map_err(|e| bad_request(e.to_string()))?,
                )
                .map_err(|e| bad_request(format!("Importinstellingen: {e}")))?;
            }
            _ => return Err(bad_request("Onbekend uploadveld.")),
        }
    }
    if options.header_row > 1000 {
        return Err(bad_request("Sla maximaal 1000 kopregels over."));
    }
    let (filename, bytes) = file.ok_or_else(|| bad_request("Geen bestand ontvangen."))?;
    Ok(Upload {
        filename,
        bytes,
        options,
    })
}

pub async fn inspect(multipart: Multipart) -> Result<Json<Value>, ApiError> {
    let input = upload(multipart).await?;
    let result = tokio::task::spawn_blocking(move || {
        solar_import::read_table(&input.filename, &input.bytes, &input.options)
            .map(|table| table.inspection())
    })
    .await
    .map_err(|_| bad_request("Bestand kon niet worden gelezen."))?
    .map_err(bad_request)?;
    Ok(Json(json!(result)))
}

async fn process(
    multipart: Multipart,
) -> Result<
    (
        Upload,
        Vec<thuisaccu_storage::solar::SolarInterval>,
        thuisaccu_storage::solar::SolarSummary,
    ),
    ApiError,
> {
    let input = upload(multipart).await?;
    tokio::task::spawn_blocking(move || {
        let table = solar_import::read_table(&input.filename, &input.bytes, &input.options)?;
        let (intervals, summary) = solar_import::normalize(&table, &input.options)?;
        Ok::<_, String>((input, intervals, summary))
    })
    .await
    .map_err(|_| bad_request("Bestand kon niet worden verwerkt."))?
    .map_err(bad_request)
}

pub async fn preview(multipart: Multipart) -> Result<Json<Value>, ApiError> {
    let (_, _, summary) = process(multipart).await?;
    Ok(Json(json!(summary)))
}

pub async fn save_solar(
    State(catalog): State<Catalog>,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (input, intervals, summary) = process(multipart).await?;
    let sha256 = format!("{:x}", Sha256::digest(&input.bytes));
    let options_json =
        serde_json::to_string(&input.options).map_err(|e| bad_request(e.to_string()))?;
    let summary_json = serde_json::to_string(&summary).map_err(|e| bad_request(e.to_string()))?;
    let id = catalog
        .save_solar(
            &input.filename,
            &sha256,
            &options_json,
            &summary_json,
            &intervals,
            Utc::now().timestamp(),
        )
        .await
        .map_err(database_error)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id, "summary":summary})),
    ))
}

pub async fn list_solar(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let imports = catalog.list_solar().await.map_err(database_error)?;
    Ok(Json(json!({"imports":imports})))
}
