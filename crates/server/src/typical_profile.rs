//! Geschat jaarprofiel uit jaartotalen, voor wie geen gemeten uurdata heeft.
//!
//! Verbruik volgt het Nederlandse standaardprofiel E1A (gemiddelde van veel kleinverbruikers);
//! opwek volgt een PVGIS-weerjaar voor De Bilt. Beide vormen zijn ingebakken bronmomentopnamen,
//! gebouwd met `tools/build_typical_profiles.py`. Er gaat geen locatie of verbruik naar buiten.

use std::{collections::BTreeMap, sync::OnceLock};

use chrono::{TimeZone, Utc};
use chrono_tz::Europe::Amsterdam;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thuisaccu_storage::solar::{SolarInterval, SolarPeriod, SolarSummary};

pub const GENERATOR: &str = "typical-nl-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypicalRequest {
    /// Bruto huishoudelijk jaarverbruik: netafname + eigen gebruikte zonnestroom.
    pub annual_consumption_kwh: f64,
    pub solar: Option<TypicalSolar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypicalSolar {
    /// `south`, `south_east`, `south_west`, `east`, `west` of `east_west`.
    pub orientation: String,
    /// AC-jaaropbrengst volgens omvormer of monitoring; anders `peak_power_kwp`.
    pub annual_production_kwh: Option<f64>,
    pub peak_power_kwp: Option<f64>,
}

#[derive(Deserialize)]
struct Resource {
    start_unix_s: i64,
    interval_s: i64,
    load: LoadShape,
    pv: PvShapes,
}

#[derive(Deserialize)]
struct LoadShape {
    source: String,
    url: String,
    values: Vec<u64>,
}

#[derive(Deserialize)]
struct PvShapes {
    source: String,
    url: String,
    annual_kwh_per_kwp: BTreeMap<String, f64>,
    orientations: BTreeMap<String, Vec<u64>>,
}

fn resource() -> &'static Resource {
    static RESOURCE: OnceLock<Resource> = OnceLock::new();
    RESOURCE.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/typical-profiles.json"))
            .expect("embedded typical profiles must be valid JSON")
    })
}

/// Openbare bronvermelding en opbrengst per kWp, zodat de interface de aanname kan tonen.
pub fn sources() -> Value {
    let r = resource();
    json!({
        "load": {"source": r.load.source, "url": r.load.url},
        "pv": {"source": r.pv.source, "url": r.pv.url, "annual_kwh_per_kwp": annual_yields()},
    })
}

fn annual_yields() -> BTreeMap<String, f64> {
    let mut yields = resource().pv.annual_kwh_per_kwp.clone();
    if let (Some(east), Some(west)) = (yields.get("east"), yields.get("west")) {
        yields.insert("east_west".into(), (east + west) / 2.0);
    }
    yields
}

fn pv_shape(orientation: &str) -> Option<Vec<f64>> {
    let shapes = &resource().pv.orientations;
    let as_f64 = |key: &str| -> Option<Vec<f64>> {
        Some(shapes.get(key)?.iter().map(|&v| v as f64).collect())
    };
    if orientation == "east_west" {
        // Helft van de panelen op elk dakvlak; geen afzonderlijke PVGIS-run.
        let east = as_f64("east")?;
        let west = as_f64("west")?;
        return Some(east.iter().zip(west).map(|(e, w)| (e + w) / 2.0).collect());
    }
    as_f64(orientation)
}

fn label_orientation(orientation: &str) -> &'static str {
    match orientation {
        "south" => "zuid",
        "south_east" => "zuidoost",
        "south_west" => "zuidwest",
        "east" => "oost",
        "west" => "west",
        "east_west" => "oost-west",
        _ => "onbekend",
    }
}

pub struct TypicalProfile {
    pub title: String,
    pub options: Value,
    pub intervals: Vec<SolarInterval>,
    pub summary: SolarSummary,
}

pub fn build(request: &TypicalRequest) -> Result<TypicalProfile, String> {
    let r = resource();
    let consumption = request.annual_consumption_kwh;
    if !consumption.is_finite() || !(100.0..=100_000.0).contains(&consumption) {
        return Err("Vul een jaarverbruik tussen 100 en 100.000 kWh in.".into());
    }
    let hours = r.load.values.len();
    let mut warnings = vec![
        "GESCHAT PROFIEL: het verbruik volgt het standaardprofiel E1A, een gemiddelde van veel huishoudens zonder zonnepanelen. Echte pieken en dalen van één huishouden zijn groter; de uitkomst is een indicatie, geen meting.".to_owned(),
        "Extra verbruik van een warmtepomp, laadpaal of thuiswerken verandert het dagpatroon. Dat zit niet in het standaardprofiel.".to_owned(),
    ];
    let (production_kwh, pv) = match &request.solar {
        None => {
            warnings.push(
                "Zonder zonnepanelen levert een accu in dit model geen besparing op: er is geen overschot om op te slaan. Waarde uit dynamische tarieven wordt nog niet berekend.".into(),
            );
            (0.0, vec![0.0; hours])
        }
        Some(solar) => {
            let shape = pv_shape(&solar.orientation)
                .ok_or("Kies de ligging van de panelen: zuid, zuidoost, zuidwest, oost, west of oost-west.")?;
            let yields = annual_yields();
            let total = match (solar.annual_production_kwh, solar.peak_power_kwp) {
                (Some(kwh), None) if kwh.is_finite() && (1.0..=100_000.0).contains(&kwh) => kwh,
                (None, Some(kwp)) if kwp.is_finite() && (0.1..=100.0).contains(&kwp) => {
                    let per_kwp = yields[&solar.orientation];
                    warnings.push(format!(
                        "Jaaropwek geschat als {kwp} kWp × {per_kwp:.0} kWh/kWp ({}, PVGIS De Bilt, weerjaar 2023, 35° helling). Schaduw, regio, helling en paneeltype kunnen dit flink veranderen; de jaaropbrengst uit je omvormer-app is beter.",
                        label_orientation(&solar.orientation)
                    ));
                    kwp * per_kwp
                }
                _ => return Err("Geef óf de jaaropbrengst in kWh (1 tot 100.000), óf het piekvermogen in kWp (0,1 tot 100).".into()),
            };
            warnings.push("De opwek volgt het weer van één jaar (2023) in De Bilt; elk jaar en elke regio verschilt.".into());
            let sum: f64 = shape.iter().sum();
            (total, shape.iter().map(|v| v / sum * total).collect())
        }
    };
    let load_sum: f64 = r.load.values.iter().map(|&v| v as f64).sum();
    let intervals: Vec<SolarInterval> = (0..hours)
        .map(|i| {
            let start = r.start_unix_s + i as i64 * r.interval_s;
            SolarInterval {
                start_unix_s: start,
                end_unix_s: start + r.interval_s,
                production_wh: pv[i] * 1000.0,
                consumption_wh: Some(r.load.values[i] as f64 / load_sum * consumption * 1000.0),
            }
        })
        .collect();
    let mut months: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for item in &intervals {
        let local = Utc
            .timestamp_opt(item.start_unix_s, 0)
            .single()
            .ok_or("Datum buiten bereik.")?
            .with_timezone(&Amsterdam);
        let month = months.entry(local.format("%Y-%m").to_string()).or_default();
        month.0 += item.production_wh / 1000.0;
        month.1 += item.consumption_wh.unwrap_or(0.0) / 1000.0;
    }
    let consumption_of = |i: &SolarInterval| i.consumption_wh.unwrap_or(0.0);
    let summary = SolarSummary {
        rows: intervals.len(),
        from_unix_s: intervals[0].start_unix_s,
        to_unix_s: intervals[hours - 1].end_unix_s,
        coverage_hours: (hours as i64 * r.interval_s) as f64 / 3600.0,
        gaps: 0,
        production_kwh,
        consumption_kwh: Some(consumption),
        interval_surplus_kwh: Some(
            intervals
                .iter()
                .map(|i| (i.production_wh - consumption_of(i)).max(0.0) / 1000.0)
                .sum(),
        ),
        interval_deficit_kwh: Some(
            intervals
                .iter()
                .map(|i| (consumption_of(i) - i.production_wh).max(0.0) / 1000.0)
                .sum(),
        ),
        months: months
            .into_iter()
            .map(|(label, (production_kwh, consumption_kwh))| SolarPeriod {
                label,
                production_kwh,
                consumption_kwh: Some(consumption_kwh),
            })
            .collect(),
        warnings,
    };
    let solar_label = request
        .solar
        .as_ref()
        .map_or("geen zonnepanelen".to_owned(), |s| {
            format!(
                "{} kWh opwek {}",
                production_kwh.round(),
                label_orientation(&s.orientation)
            )
        });
    Ok(TypicalProfile {
        title: format!(
            "Geschat profiel · {} kWh verbruik · {solar_label}",
            consumption.round()
        ),
        options: json!({
            "generator": GENERATOR,
            "data_kind": "modelled",
            "mode": "interval",
            "period": "hour",
            "timezone": "UTC",
            "timestamp_position": "start",
            "consumption_is_gross": true,
            "inputs": request,
            "sources": sources(),
        }),
        intervals,
        summary,
    })
}
