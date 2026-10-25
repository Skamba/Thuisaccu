use crate::api::{ApiError, database_error};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thuisaccu_core::{
    analysis::{self, Candidate, Parameters},
    sizing::{self, EnergyInterval, LoadVariation},
};
use thuisaccu_storage::{Catalog, analysis::NewAnalysis};

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
    let mut result = crate::blocking(move || analysis::analyze(&profile, &parameters, &candidates))
        .await
        .ok_or_else(|| invalid("De scenarioanalyse kon niet worden voltooid."))?
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
            steady_consumption_kwh: item.steady_consumption_wh.map(|v| v / 1000.0),
            measured_import_kwh: item.measured_import_wh.map(|v| v / 1000.0),
            measured_export_kwh: item.measured_export_wh.map(|v| v / 1000.0),
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
    let periods = profile.len();
    let measured = profile
        .iter()
        .filter(|i| i.measured_import_kwh.is_some())
        .count();
    let within = if measured == periods {
        "Gelijktijdigheid van opwek en verbruik binnen iedere meetperiode volgens de gemeten netafname en teruglevering."
    } else if measured > 0 {
        "Gelijktijdigheid binnen de meetperiode volgens de meter waar netafname en teruglevering gemeten zijn, elders verbruik verdeeld zoals bij gemeten huishoudens (HTW Berlin)."
    } else {
        "Verbruik binnen iedere meetperiode verdeeld zoals bij gemeten huishoudens (HTW Berlin)."
    };
    let points = crate::blocking(move || {
        sizing::capacity_curve(&profile, &capacities, LoadVariation::Households)
    })
    .await
    .ok_or_else(|| invalid("De capaciteitsverkenning kon niet worden voltooid."))?;
    Ok(Json(json!({
        "points": points,
        "periods": periods,
        "measured_periods": measured,
        "assumptions": format!("Verliesvrije accu zonder vermogensgrens, standby of slijtage; alleen eigen zonnestroom, geen netladen. {within} Een bovengrens om een capaciteitsbereik te kiezen, geen productberekening."),
    })))
}

pub async fn history(State(catalog): State<Catalog>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"runs":catalog.list_analyses().await.map_err(database_error)?}),
    ))
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
    let bytes = pdok::search(input.query.trim()).await.map_err(invalid)?;
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

/// PDOK Locatieserver: vaste host, HTTPS, timeout, geen redirects en een antwoordlimiet.
/// Alleen een expliciete zoekactie van de gebruiker komt hier.
mod pdok {
    const URL: &str = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
    const FIELDS: &str = "id,weergavenaam,centroide_ll,nummeraanduiding_id";
    const LIMIT: usize = 1_000_000;
    const UNREACHABLE: &str = "PDOK is niet bereikbaar. Je kunt het adres ook handmatig gebruiken; gemeten energiegegevens blijven leidend.";
    const BAD_STATUS: &str = "PDOK gaf geen geldig antwoord.";
    const UNREADABLE: &str = "PDOK-antwoord kon niet worden gelezen.";
    const TOO_LARGE: &str = "PDOK-antwoord is te groot.";

    #[cfg(not(target_family = "wasm"))]
    pub async fn search(query: &str) -> Result<Vec<u8>, &'static str> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Thuisaccu/0.1 (explicit address search)")
            .build()
            .map_err(|_| "Adresdienst kon niet worden geopend.")?;
        let mut response = client
            .get(URL)
            .query(&[
                ("q", query),
                ("fq", "type:adres"),
                ("rows", "5"),
                ("fl", FIELDS),
            ])
            .send()
            .await
            .map_err(|_| UNREACHABLE)?
            .error_for_status()
            .map_err(|_| BAD_STATUS)?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| UNREADABLE)? {
            if bytes.len() + chunk.len() > LIMIT {
                return Err(TOO_LARGE);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    /// De fetch van de browser is geen `Send`-future, zoals axum-handlers vereisen. Die draait
    /// daarom los op de JavaScript-eventloop en geeft alleen de bytes terug.
    #[cfg(target_family = "wasm")]
    pub async fn search(query: &str) -> Result<Vec<u8>, &'static str> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let query = query.to_owned();
        wasm_bindgen_futures::spawn_local(async move {
            let _ = sender.send(fetch(&query).await);
        });
        receiver.await.unwrap_or(Err(UNREACHABLE))
    }

    #[cfg(target_family = "wasm")]
    async fn fetch(query: &str) -> Result<Vec<u8>, &'static str> {
        use wasm_bindgen::JsCast;
        use wasm_bindgen_futures::JsFuture;
        use web_sys::{
            AbortSignal, ReferrerPolicy, RequestCredentials, RequestInit, RequestRedirect,
            Response, Url, Window, WorkerGlobalScope,
        };

        let url = Url::new(URL).map_err(|_| UNREACHABLE)?;
        let search = url.search_params();
        for (key, value) in [
            ("q", query),
            ("fq", "type:adres"),
            ("rows", "5"),
            ("fl", FIELDS),
        ] {
            search.append(key, value);
        }
        let init = RequestInit::new();
        init.set_method("GET");
        init.set_redirect(RequestRedirect::Error);
        init.set_credentials(RequestCredentials::Omit);
        init.set_referrer_policy(ReferrerPolicy::NoReferrer);
        init.set_signal(Some(&AbortSignal::timeout_with_u32(10_000)));
        let global = js_sys::global();
        let pending = if let Some(window) = global.dyn_ref::<Window>() {
            window.fetch_with_str_and_init(&url.href(), &init)
        } else {
            global
                .unchecked_ref::<WorkerGlobalScope>()
                .fetch_with_str_and_init(&url.href(), &init)
        };
        let response: Response = JsFuture::from(pending)
            .await
            .map_err(|_| UNREACHABLE)?
            .unchecked_into();
        if !response.ok() {
            return Err(BAD_STATUS);
        }
        let declared = response
            .headers()
            .get("content-length")
            .ok()
            .flatten()
            .and_then(|value| value.parse::<usize>().ok());
        if declared.is_some_and(|length| length > LIMIT) {
            return Err(TOO_LARGE);
        }
        let buffer = JsFuture::from(response.array_buffer().map_err(|_| UNREADABLE)?)
            .await
            .map_err(|_| UNREADABLE)?;
        let bytes = js_sys::Uint8Array::new(&buffer);
        if bytes.length() as usize > LIMIT {
            return Err(TOO_LARGE);
        }
        Ok(bytes.to_vec())
    }
}
