use axum::{
    Json,
    extract::{Multipart, State},
    http::{StatusCode, header},
    response::IntoResponse,
};
use std::{collections::HashSet, sync::OnceLock};

use chrono::Utc;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thuisaccu_storage::{
    Catalog, StorageError,
    comparison::{CandidateDraft, Comparison},
};

use crate::{
    extract::{ApiJson, ApiMultipart, ApiPath},
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

/// De vergelijking, met per uitvoering `researched`: of ze in een ingebouwde onderzochte set staat.
/// De interface verbergt onderzochte uitvoeringen die niet zonder eigen invoer door te rekenen zijn;
/// wat de gebruiker zelf heeft toegevoegd blijft zichtbaar.
pub async fn comparison(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let data: Comparison = catalog.comparison().await.map_err(database_error)?;
    let researched = researched()?;
    let mut value = serde_json::to_value(data).map_err(|error| {
        tracing::error!(%error, "Comparison serialization failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"database_error"})),
        )
    })?;
    if let Some(configurations) = value["configurations"].as_array_mut() {
        for c in configurations {
            let text = |key: &str| c[key].as_str().unwrap_or_default().to_owned();
            let known = researched.contains(&identity(
                &text("manufacturer_name"),
                &text("product_name"),
                &text("model_code"),
                &text("name"),
            ));
            c["researched"] = Value::Bool(known);
        }
    }
    Ok(Json(value))
}

/// Identiteiten van alle ingebouwde onderzochte uitvoeringen, één keer ingelezen (de sets zijn samen
/// bijna een megabyte JSON).
fn researched() -> Result<&'static HashSet<[String; 4]>, ApiError> {
    static RESEARCHED: OnceLock<HashSet<[String; 4]>> = OnceLock::new();
    if let Some(set) = RESEARCHED.get() {
        return Ok(set);
    }
    let mut set = HashSet::new();
    for (key, json) in REFERENCE_SETS {
        for d in reference_drafts(key, json)? {
            set.insert(identity(
                &d.manufacturer,
                &d.product,
                &d.model_code,
                &d.configuration,
            ));
        }
    }
    Ok(RESEARCHED.get_or_init(|| set))
}

/// Identiteit van een uitvoering zoals de opslag die vastlegt (getrimd).
fn identity(
    manufacturer: &str,
    product: &str,
    model_code: &str,
    configuration: &str,
) -> [String; 4] {
    [manufacturer, product, model_code, configuration].map(|s| s.trim().to_owned())
}

pub async fn add_candidate(
    State(catalog): State<Catalog>,
    ApiJson(input): ApiJson<CandidateDraft>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let id = catalog
        .add_candidate(&input, Utc::now().timestamp())
        .await
        .map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(json!({"configuration_id":id}))))
}

/// Elke set heeft een eigen sleutel: een eerder geladen set wordt niet opnieuw ingevoegd.
const REFERENCE_SETS: [(&str, &str); 9] = [
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
    (
        "research-2026-10-25-nl-v7",
        include_str!("../resources/references-nl-7.json"),
    ),
    (
        "research-2026-10-26-nl-v8",
        include_str!("../resources/references-nl-8.json"),
    ),
];

/// Hoeveel ingebouwde sets er zijn en hoeveel daarvan nog niet geladen zijn; laadt zelf niets.
pub async fn reference_status(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let loaded = catalog
        .reference_import_keys()
        .await
        .map_err(database_error)?;
    let pending = REFERENCE_SETS
        .iter()
        .filter(|(key, _)| !loaded.iter().any(|k| k == key))
        .count();
    Ok(Json(
        json!({"sets": REFERENCE_SETS.len(), "pending": pending}),
    ))
}

/// Een samenhangende kopie van de hele database als SQLite-bestand, ook terwijl de app draait: de
/// kopie komt via de verbinding en bevat dus ook wat nog in het WAL-bestand staat.
pub async fn backup(State(catalog): State<Catalog>) -> Result<impl IntoResponse, ApiError> {
    let bytes = crate::blocking(move || catalog.to_bytes())
        .await?
        .map_err(database_error)?;
    let name = format!("thuisaccu-{}.sqlite3", Utc::now().format("%Y-%m-%d"));
    Ok((
        [
            (header::CONTENT_TYPE, "application/vnd.sqlite3".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{name}\""),
            ),
        ],
        bytes,
    ))
}

pub async fn references(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let mut imported = false;
    // De interface vraagt dit bij elk bezoek; geladen sets worden niet opnieuw ingelezen (ongeveer 1 MB JSON).
    let loaded = catalog
        .reference_import_keys()
        .await
        .map_err(database_error)?;
    for (key, json) in REFERENCE_SETS {
        if loaded.iter().any(|k| k == key) {
            continue;
        }
        let drafts = reference_drafts(key, json)?;
        imported |= catalog
            .import_references(key, &drafts, Utc::now().timestamp())
            .await
            .map_err(database_error)?;
    }
    Ok(Json(json!({"imported":imported})))
}

fn reference_drafts(key: &str, json: &str) -> Result<Vec<CandidateDraft>, ApiError> {
    serde_json::from_str(json).map_err(|error| {
        tracing::error!(%error, key, "Invalid reference resource");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"reference_data_error"})),
        )
    })
}

struct Upload {
    filename: String,
    /// Eigen naam voor het profiel; de bestandsnaam bepaalt alleen het bestandsformaat.
    name: Option<String>,
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

/// Een kapot of te groot formulier; de Engelse foutmelding van de multipart-lezer blijft in het log.
fn multipart_error(error: axum::extract::multipart::MultipartError) -> ApiError {
    tracing::debug!(%error, "Upload niet leesbaar");
    bad_request(
        "Het bestand kon niet worden gelezen. Gebruik bestanden van elk hoogstens 10 MB en probeer het opnieuw.",
    )
}

async fn file_field(
    field: axum::extract::multipart::Field<'_>,
) -> Result<(String, Vec<u8>), ApiError> {
    let filename = field.file_name().unwrap_or("upload.csv").to_owned();
    let bytes = field.bytes().await.map_err(multipart_error)?;
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
    let mut name = None;
    while let Some(field) = multipart.next_field().await.map_err(multipart_error)? {
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
            Some("name") => {
                if name.is_some() {
                    return Err(bad_request("De naam is dubbel meegestuurd."));
                }
                let text = field.text().await.map_err(multipart_error)?;
                let text = text.trim();
                if text.is_empty() || text.chars().count() > 240 {
                    return Err(bad_request(
                        "Geef het profiel een naam van 1 tot 240 tekens.",
                    ));
                }
                name = Some(text.to_owned());
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
        name,
        bytes,
        options,
        meter,
    })
}

pub async fn inspect(ApiMultipart(multipart): ApiMultipart) -> Result<Json<Value>, ApiError> {
    let input = upload(multipart).await?;
    let result = crate::blocking(move || {
        solar_import::read_table(&input.filename, &input.bytes, &input.options)
            .map(|table| table.inspection())
    })
    .await?
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
        let (meter_intervals, meter_summary) =
            solar_import::normalize(&meter_table, &meter_options)
                .map_err(|e| format!("Meterbestand: {e}"))?;
        let (intervals, summary) = solar_import::combine_with_meter(
            &intervals,
            &summary,
            &meter_intervals,
            &meter_summary,
            &input.options.timezone,
        )?;
        Ok((input, intervals, summary))
    })
    .await?
    .map_err(import_error)
}

/// Een importfout; een tijdstip dat door de klokwisseling niet past, krijgt een eigen code, apart voor
/// het meterbestand, zodat de interface de oplossing bij de juiste tijdzone toont.
fn import_error(message: String) -> ApiError {
    if !solar_import::is_clock_change(&message) {
        return bad_request(message);
    }
    let code = if message.starts_with("Meterbestand: ") {
        "meter_clock_change"
    } else {
        "clock_change"
    };
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error": code, "message": message})),
    )
}

pub async fn preview(ApiMultipart(multipart): ApiMultipart) -> Result<Json<Value>, ApiError> {
    let (_, _, summary) = process(multipart).await?;
    Ok(Json(json!(summary)))
}

pub async fn save_solar(
    State(catalog): State<Catalog>,
    ApiMultipart(multipart): ApiMultipart,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (input, intervals, summary) = process(multipart).await?;
    let mut hasher = Sha256::new();
    hasher.update(Sha256::digest(&input.bytes));
    let mut options =
        serde_json::to_value(&input.options).map_err(|e| bad_request(e.to_string()))?;
    options["normalizer"] = json!(solar_import::NORMALIZER_VERSION);
    let mut filename = input.filename.clone();
    if let Some(meter) = &input.meter {
        // Een combinatie is uniek door beide bestanden en beide instellingen.
        hasher.update(Sha256::digest(&meter.bytes));
        options["meter"] =
            serde_json::to_value(&meter.options).map_err(|e| bad_request(e.to_string()))?;
        let seconds = intervals
            .first()
            .map_or(0, |i| i.end_unix_s - i.start_unix_s);
        options["combined_period"] = json!(match seconds {
            3600 => "hour".to_owned(),
            s => format!("{}min", s / 60),
        });
        filename = format!("{} + {}", input.filename, meter.filename);
    }
    // De naam hoort niet bij de instellingen: hetzelfde bestand onder een andere naam is hetzelfde
    // profiel.
    if let Some(name) = &input.name {
        filename.clone_from(name);
    }
    let sha256 = if input.meter.is_some() {
        format!("{:x}", hasher.finalize())
    } else {
        format!("{:x}", Sha256::digest(&input.bytes))
    };
    let options_json = serde_json::to_string(&options).map_err(|e| bad_request(e.to_string()))?;
    let summary_json = serde_json::to_string(&summary).map_err(|e| bad_request(e.to_string()))?;
    let stored = catalog
        .import_solar(
            &filename,
            &sha256,
            &options_json,
            &summary_json,
            &intervals,
            Utc::now().timestamp(),
        )
        .await
        .map_err(database_error)?;
    let status = if stored.existing {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((
        status,
        Json(
            json!({"id":stored.id, "existing":stored.existing, "filename":stored.filename, "summary":summary}),
        ),
    ))
}

pub async fn list_solar(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let imports = catalog.list_solar().await.map_err(database_error)?;
    Ok(Json(json!({"imports":imports})))
}

pub(crate) fn missing(message: &str) -> ApiError {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error":"not_found", "message":message})),
    )
}

/// Verwijdert een profiel en de berekeningen die erop zijn gemaakt; dat vraagt de interface eerst.
pub async fn delete_solar(
    State(catalog): State<Catalog>,
    ApiPath(id): ApiPath<i64>,
) -> Result<Json<Value>, ApiError> {
    let runs = catalog
        .delete_solar(id)
        .await
        .map_err(database_error)?
        .ok_or_else(|| missing("Dit energieprofiel bestaat niet (meer)."))?;
    Ok(Json(json!({"deleted_analysis_runs":runs})))
}

/// Maakt een geschat jaarprofiel uit jaartotalen en bewaart het als gemodelleerde import.
pub async fn save_typical(
    State(catalog): State<Catalog>,
    ApiJson(request): ApiJson<TypicalRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let profile = crate::blocking(move || typical_profile::build(&request))
        .await?
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
