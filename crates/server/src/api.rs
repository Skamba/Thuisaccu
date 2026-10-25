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

use crate::{
    solar_import::{self, ImportOptions, MeterOptions},
    typical_profile::{self, TypicalRequest},
};

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
        _ if error.is_constraint_violation() => bad_request(
            "De invoer voldoet niet aan de gegevensregels; controleer waarden, codes en brongegevens.",
        ),
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

/// Elke set heeft een eigen sleutel: een eerder geladen set wordt niet opnieuw ingevoegd.
const REFERENCE_SETS: [(&str, &str); 7] = [
    (
        "research-2026-10-24-v1",
        include_str!("../resources/references.json"),
    ),
    (
        "research-2026-10-24-nl-v1",
        include_str!("../resources/references-nl.json"),
    ),
    (
        "research-2026-10-24-nl-v2",
        include_str!("../resources/references-nl-2.json"),
    ),
    (
        "research-2026-10-25-nl-v3",
        include_str!("../resources/references-nl-3.json"),
    ),
    (
        "research-2026-10-25-nl-v4",
        include_str!("../resources/references-nl-4.json"),
    ),
    (
        "research-2026-10-25-nl-v5",
        include_str!("../resources/references-nl-5.json"),
    ),
    (
        "research-2026-10-25-nl-v6",
        include_str!("../resources/references-nl-6.json"),
    ),
];

pub async fn references(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let mut imported = false;
    for (key, json) in REFERENCE_SETS {
        let drafts: Vec<CandidateDraft> = serde_json::from_str(json).map_err(|error| {
            tracing::error!(%error, key, "Invalid reference resource");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"reference_data_error"})),
            )
        })?;
        imported |= catalog
            .import_references(key, &drafts, Utc::now().timestamp())
            .await
            .map_err(database_error)?;
    }
    Ok(Json(json!({"imported":imported})))
}

struct Upload {
    filename: String,
    bytes: Vec<u8>,
    options: ImportOptions,
    /// Optioneel meterbestand (netafname en teruglevering) naast het omvormerbestand.
    meter: Option<MeterUpload>,
}

struct MeterUpload {
    filename: String,
    bytes: Vec<u8>,
    options: MeterOptions,
}

async fn file_field(
    field: axum::extract::multipart::Field<'_>,
) -> Result<(String, Vec<u8>), ApiError> {
    let filename = field.file_name().unwrap_or("upload.csv").to_owned();
    let bytes = field
        .bytes()
        .await
        .map_err(|e| bad_request(e.to_string()))?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err(bad_request("Gebruik een bestand van maximaal 10 MB."));
    }
    Ok((filename, bytes.to_vec()))
}

async fn upload(mut multipart: Multipart) -> Result<Upload, ApiError> {
    let mut file = None;
    let mut options = ImportOptions::default();
    let mut options_seen = false;
    let mut meter_file = None;
    let mut meter_options: Option<MeterOptions> = None;
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
                file = Some(file_field(field).await?);
            }
            Some("meter_file") => {
                if meter_file.is_some() {
                    return Err(bad_request("Kies één meterbestand."));
                }
                meter_file = Some(file_field(field).await?);
            }
            Some("meter_options") => {
                if meter_options.is_some() {
                    return Err(bad_request("Meterinstellingen zijn dubbel meegestuurd."));
                }
                meter_options = Some(
                    serde_json::from_str(
                        &field.text().await.map_err(|e| bad_request(e.to_string()))?,
                    )
                    .map_err(|e| bad_request(format!("Meterinstellingen: {e}")))?,
                );
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
    if options.header_row > 1000 || meter_options.as_ref().is_some_and(|m| m.header_row > 1000) {
        return Err(bad_request("Sla maximaal 1000 kopregels over."));
    }
    let (filename, bytes) = file.ok_or_else(|| bad_request("Geen bestand ontvangen."))?;
    let meter = match (meter_file, meter_options) {
        (Some((filename, bytes)), Some(options)) => Some(MeterUpload {
            filename,
            bytes,
            options,
        }),
        (None, None) => None,
        _ => {
            return Err(bad_request(
                "Stuur bij een meterbestand ook de meterinstellingen mee.",
            ));
        }
    };
    Ok(Upload {
        filename,
        bytes,
        options,
        meter,
    })
}

pub async fn inspect(multipart: Multipart) -> Result<Json<Value>, ApiError> {
    let input = upload(multipart).await?;
    let result = crate::blocking(move || {
        solar_import::read_table(&input.filename, &input.bytes, &input.options)
            .map(|table| table.inspection())
    })
    .await
    .ok_or_else(|| bad_request("Bestand kon niet worden gelezen."))?
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
    crate::blocking(move || {
        let table = solar_import::read_table(&input.filename, &input.bytes, &input.options)?;
        let (intervals, summary) = solar_import::normalize(&table, &input.options)?;
        let Some(meter) = &input.meter else {
            return Ok::<_, String>((input, intervals, summary));
        };
        let meter_options = meter.options.as_import_options();
        let meter_table = solar_import::read_table(&meter.filename, &meter.bytes, &meter_options)
            .map_err(|e| format!("Meterbestand: {e}"))?;
        let (meter_intervals, _) = solar_import::normalize(&meter_table, &meter_options)
            .map_err(|e| format!("Meterbestand: {e}"))?;
        let (intervals, summary) = solar_import::combine_with_meter(
            &intervals,
            &summary,
            &meter_intervals,
            &input.options.timezone,
        )?;
        Ok((input, intervals, summary))
    })
    .await
    .ok_or_else(|| bad_request("Bestand kon niet worden verwerkt."))?
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
    let mut hasher = Sha256::new();
    hasher.update(Sha256::digest(&input.bytes));
    let mut options =
        serde_json::to_value(&input.options).map_err(|e| bad_request(e.to_string()))?;
    let mut filename = input.filename.clone();
    if let Some(meter) = &input.meter {
        // Een combinatie is uniek door beide bestanden en beide instellingen.
        hasher.update(Sha256::digest(&meter.bytes));
        options["meter"] =
            serde_json::to_value(&meter.options).map_err(|e| bad_request(e.to_string()))?;
        options["meter_filename"] = json!(meter.filename);
        let seconds = intervals
            .first()
            .map_or(0, |i| i.end_unix_s - i.start_unix_s);
        options["combined_period"] = json!(match seconds {
            3600 => "hour".to_owned(),
            s => format!("{}min", s / 60),
        });
        filename = format!("{} + {}", input.filename, meter.filename);
    }
    let sha256 = if input.meter.is_some() {
        format!("{:x}", hasher.finalize())
    } else {
        format!("{:x}", Sha256::digest(&input.bytes))
    };
    let options_json = serde_json::to_string(&options).map_err(|e| bad_request(e.to_string()))?;
    let summary_json = serde_json::to_string(&summary).map_err(|e| bad_request(e.to_string()))?;
    let id = catalog
        .save_solar(
            &filename,
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

/// Maakt een geschat jaarprofiel uit jaartotalen en bewaart het als gemodelleerde import.
pub async fn save_typical(
    State(catalog): State<Catalog>,
    Json(request): Json<TypicalRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let profile = crate::blocking(move || typical_profile::build(&request))
        .await
        .ok_or_else(|| bad_request("Het geschatte profiel kon niet worden gemaakt."))?
        .map_err(bad_request)?;
    let serialized =
        serde_json::to_vec(&profile.intervals).map_err(|e| bad_request(e.to_string()))?;
    let sha256 = format!("{:x}", Sha256::digest(&serialized));
    let options_json =
        serde_json::to_string(&profile.options).map_err(|e| bad_request(e.to_string()))?;
    let summary_json =
        serde_json::to_string(&profile.summary).map_err(|e| bad_request(e.to_string()))?;
    let id = catalog
        .save_solar(
            &profile.title,
            &sha256,
            &options_json,
            &summary_json,
            &profile.intervals,
            Utc::now().timestamp(),
        )
        .await
        .map_err(database_error)?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id, "filename":profile.title, "summary":profile.summary})),
    ))
}

pub async fn typical_sources() -> Json<Value> {
    Json(typical_profile::sources())
}
