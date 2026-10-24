use crate::api::{ApiError, database_error};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{Datelike, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, time::Duration};
use thuisaccu_core::{
    analysis::{self, Candidate, Parameters},
    sizing::{self, EnergyInterval},
};
use thuisaccu_storage::{
    Catalog,
    analysis::NewAnalysis,
    solar::{SolarInterval, SolarPeriod, SolarSummary},
};

fn invalid(message: impl Into<String>) -> ApiError {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"error":"invalid_analysis", "message":message.into()})),
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Site {
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub bag_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRequest {
    pub title: String,
    pub solar_import_id: i64,
    pub site: Site,
    pub parameters: Parameters,
    pub candidates: Vec<Candidate>,
    pub costs_confirmed: bool,
    pub technical_assumptions_confirmed: bool,
    pub consumption_is_gross: bool,
    pub production_is_ac: bool,
}

pub async fn costs() -> Json<Value> {
    Json(
        serde_json::from_str(include_str!("../resources/cost-catalog.json"))
            .expect("embedded cost catalog must be valid JSON"),
    )
}

pub async fn run(
    State(catalog): State<Catalog>,
    Json(request): Json<RunRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if !request.costs_confirmed
        || !request.technical_assumptions_confirmed
        || !request.consumption_is_gross
        || !request.production_is_ac
    {
        return Err(invalid(
            "Controleer kosten, technische aannames en de meetgrenzen: AC-productie en bruto huishoudelijk verbruik, geen netafname of netexport.",
        ));
    }
    if request.title.trim().is_empty()
        || request.title.len() > 200
        || request.site.address.trim().is_empty()
        || request.site.address.len() > 500
    {
        return Err(invalid(
            "Geef een scenarionaam en een Nederlands adres of locatieomschrijving op.",
        ));
    }
    if request
        .site
        .latitude
        .is_some_and(|v| !v.is_finite() || !(50.0..=54.0).contains(&v))
        || request
            .site
            .longitude
            .is_some_and(|v| !v.is_finite() || !(3.0..=8.0).contains(&v))
        || request.site.latitude.is_some() != request.site.longitude.is_some()
    {
        return Err(invalid(
            "Ongeldige coördinaten voor de Nederlandse adresondersteuning.",
        ));
    }
    let profile = load_profile(&catalog, request.solar_import_id).await?;
    let metadata = catalog
        .solar_metadata(request.solar_import_id)
        .await
        .map_err(database_error)?;
    let profile_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&profile).map_err(|e| invalid(e.to_string()))?)
    );
    let input_snapshot = json!({"request":request,"profile":metadata,"profile_sha256":profile_hash,"cost_sources_researched_on":"2026-10-24"});
    let parameters = request.parameters.clone();
    let candidates = request.candidates.clone();
    let mut result =
        tokio::task::spawn_blocking(move || analysis::analyze(&profile, &parameters, &candidates))
            .await
            .map_err(|_| invalid("De scenarioanalyse kon niet worden voltooid."))?
            .map_err(|e| invalid(e.to_string()))?;
    if metadata["options"]["is_demo"] == true {
        result.warnings.insert(0, "FICTIEF DEMOPROFIEL: dit resultaat is uitsluitend een softwarevoorbeeld en geen advies voor het ingevoerde adres.".into());
    } else if metadata["options"]["generator"] == crate::typical_profile::GENERATOR {
        result.warnings.insert(
            0,
            "GESCHAT PROFIEL: verbruik en opwek zijn afgeleid uit jaartotalen met een standaardprofiel en één PVGIS-weerjaar. Dit is een indicatie, geen meting van dit huishouden.".into(),
        );
    } else if metadata["options"]["data_kind"] == "modelled" {
        result.warnings.insert(
            0,
            "De opwek is gemodelleerd; dit is geen volledig gemeten huishoudprofiel.".into(),
        );
    }
    let input_json = serde_json::to_string(&input_snapshot).map_err(|e| invalid(e.to_string()))?;
    let result_json = serde_json::to_string(&result).map_err(|e| invalid(e.to_string()))?;
    let id = catalog
        .save_analysis(&NewAnalysis {
            import_id: request.solar_import_id,
            title: &request.title,
            model_version: &result.model_version,
            profile_sha256: &profile_hash,
            input_json: &input_json,
            result_json: &result_json,
            now: Utc::now().timestamp(),
        })
        .await
        .map_err(database_error)?;
    Ok((StatusCode::CREATED, Json(json!({"id":id,"result":result}))))
}

/// Eén aaneengesloten reeks met bruto verbruik per interval, of een gebruikersfout.
async fn load_profile(catalog: &Catalog, import_id: i64) -> Result<Vec<EnergyInterval>, ApiError> {
    let intervals = catalog
        .solar_intervals(import_id)
        .await
        .map_err(database_error)?;
    if intervals.is_empty() {
        return Err(invalid(
            "Kies een bestaand opwekoverzicht met bruto verbruik.",
        ));
    }
    if intervals
        .windows(2)
        .any(|w| w[0].end_unix_s != w[1].start_unix_s)
    {
        return Err(invalid(
            "De meetreeks bevat gaten; een ROI op basis van een onvolledig jaar wordt niet automatisch opgeschaald.",
        ));
    }
    let mut profile = Vec::with_capacity(intervals.len());
    for item in &intervals {
        let load = item.consumption_wh.ok_or_else(|| invalid("Deze import bevat geen volledig bruto verbruik. Importeer opwek én verbruik voor dezelfde tijdstippen."))?;
        profile.push(EnergyInterval {
            duration_hours: (item.end_unix_s - item.start_unix_s) as f64 / 3600.0,
            production_kwh: item.production_wh / 1000.0,
            consumption_kwh: load / 1000.0,
        });
    }
    Ok(profile)
}

/// Bovengrens van zelf gebruikte zonnestroom per accugrootte, als hulp bij het kiezen van een bereik.
pub async fn capacity_curve(
    State(catalog): State<Catalog>,
    Path(import_id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    let profile = load_profile(&catalog, import_id).await?;
    let hours: f64 = profile.iter().map(|i| i.duration_hours).sum();
    if !((hours - 8760.0).abs() < 0.01 || (hours - 8784.0).abs() < 0.01) {
        return Err(invalid(
            "Gebruik een volledig jaar van 365 of 366 dagen voor de capaciteitsverkenning.",
        ));
    }
    let capacities: Vec<f64> = [
        0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0, 20.0,
    ]
    .to_vec();
    let points = tokio::task::spawn_blocking(move || sizing::capacity_curve(&profile, &capacities))
        .await
        .map_err(|_| invalid("De capaciteitsverkenning kon niet worden voltooid."))?;
    Ok(Json(json!({
        "points": points,
        "assumptions": "Verliesvrije accu zonder vermogensgrens, standby of slijtage; alleen eigen zonnestroom, geen netladen. Een bovengrens om een capaciteitsbereik te kiezen, geen productberekening.",
    })))
}

pub async fn history(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"runs":catalog.list_analyses().await.map_err(database_error)?}),
    ))
}

pub async fn demo(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    let first = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).single().unwrap();
    let mut intervals = Vec::new();
    for hour in 0..8760 {
        let day = hour / 24;
        let h = (hour % 24) as f64;
        let seasonal = 0.6 + 0.4 * ((day as f64 - 172.0) * std::f64::consts::TAU / 365.0).cos();
        let solar = ((h - 6.0) * std::f64::consts::PI / 12.0).sin().max(0.0) * seasonal;
        let load = 0.25
            + if (6.0..9.0).contains(&h) { 0.4 } else { 0.0 }
            + if (17.0..23.0).contains(&h) { 0.7 } else { 0.0 };
        intervals.push(SolarInterval {
            start_unix_s: first.timestamp() + hour * 3600,
            end_unix_s: first.timestamp() + (hour + 1) * 3600,
            production_wh: solar,
            consumption_wh: Some(load),
        });
    }
    let solar_sum: f64 = intervals.iter().map(|i| i.production_wh).sum();
    let load_sum: f64 = intervals.iter().map(|i| i.consumption_wh.unwrap()).sum();
    for item in &mut intervals {
        item.production_wh *= 4_500_000.0 / solar_sum;
        item.consumption_wh = item.consumption_wh.map(|v| v * 4_200_000.0 / load_sum);
    }
    let mut months: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for item in &intervals {
        let timestamp = Utc.timestamp_opt(item.start_unix_s, 0).single().unwrap();
        let total = months
            .entry(format!("{}-{:02}", timestamp.year(), timestamp.month()))
            .or_default();
        total.0 += item.production_wh / 1000.0;
        total.1 += item.consumption_wh.unwrap() / 1000.0;
    }
    let summary = SolarSummary { rows: intervals.len(), from_unix_s: first.timestamp(), to_unix_s: intervals.last().unwrap().end_unix_s,
        coverage_hours: 8760.0, gaps: 0, production_kwh: 4500.0, consumption_kwh: Some(4200.0),
        interval_surplus_kwh: Some(intervals.iter().map(|i| (i.production_wh - i.consumption_wh.unwrap()).max(0.0) /1000.0).sum()),
        interval_deficit_kwh: Some(intervals.iter().map(|i| (i.consumption_wh.unwrap() - i.production_wh).max(0.0) /1000.0).sum()),
        months: months.into_iter().map(|(label,(production_kwh,consumption_kwh))| SolarPeriod { label, production_kwh, consumption_kwh:Some(consumption_kwh) }).collect(),
        warnings: vec!["Volledig fictief, synthetisch jaarprofiel voor softwaredemonstratie; niet gebaseerd op een adres, gemiddeld huishouden of weerschatting.".into()] };
    let serialized = serde_json::to_vec(&intervals).map_err(|e| invalid(e.to_string()))?;
    let hash = format!("{:x}", Sha256::digest(&serialized));
    let options =
        json!({"is_demo":true,"timezone":"UTC","data_kind":"synthetic","generator":"demo-v1"})
            .to_string();
    let summary_json = serde_json::to_string(&summary).map_err(|e| invalid(e.to_string()))?;
    let id = catalog
        .save_solar(
            "FICTIEF DEMOJAAR 2025",
            &hash,
            &options,
            &summary_json,
            &intervals,
            Utc::now().timestamp(),
        )
        .await
        .map_err(database_error)?;
    Ok(Json(json!({"id":id})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddressSearch {
    pub query: String,
}

pub async fn address(Json(input): Json<AddressSearch>) -> Result<Json<Value>, ApiError> {
    if !(4..=200).contains(&input.query.trim().len()) {
        return Err(invalid("Vul een adres of postcode met huisnummer in."));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Thuisaccu/0.1 (explicit address search)")
        .build()
        .map_err(|_| invalid("Adresdienst kon niet worden geopend."))?;
    let response = client.get("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free")
        .query(&[("q",input.query.trim()),("fq","type:adres"),("rows","5"),("fl","id,weergavenaam,centroide_ll,nummeraanduiding_id")])
        .send().await.map_err(|_| invalid("PDOK is niet bereikbaar. Je kunt het adres ook handmatig gebruiken; gemeten energiegegevens blijven leidend."))?
        .error_for_status().map_err(|_| invalid("PDOK gaf geen geldig antwoord."))?;
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| invalid("PDOK-antwoord kon niet worden gelezen."))?
    {
        if bytes.len() + chunk.len() > 1_000_000 {
            return Err(invalid("PDOK-antwoord is te groot."));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| invalid("PDOK-antwoord is niet geldig."))?;
    Ok(Json(
        json!({"results":parse_addresses(&value),"source":"https://www.pdok.nl/pdok-locatieserver"}),
    ))
}

pub fn parse_addresses(value: &Value) -> Vec<Site> {
    value["response"]["docs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|doc| {
            let raw = doc["centroide_ll"]
                .as_str()?
                .trim()
                .strip_prefix("POINT(")?
                .strip_suffix(')')?;
            let mut parts = raw.split_whitespace();
            let longitude: f64 = parts.next()?.parse().ok()?;
            let latitude: f64 = parts.next()?.parse().ok()?;
            if !(50.0..=54.0).contains(&latitude) || !(3.0..=8.0).contains(&longitude) {
                return None;
            }
            Some(Site {
                address: doc["weergavenaam"].as_str()?.to_owned(),
                latitude: Some(latitude),
                longitude: Some(longitude),
                bag_id: doc["nummeraanduiding_id"].as_str().map(str::to_owned),
            })
        })
        .collect()
}
