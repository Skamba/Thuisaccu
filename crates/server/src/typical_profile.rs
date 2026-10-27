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
    /// Deel van het jaarverbruik voor een warmtepomp (kWh). Zit al in het jaarverbruik;
    /// alleen de verdeling over het jaar verandert.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heat_pump_kwh: Option<f64>,
    /// Deel van het jaarverbruik voor het thuisladen van een elektrische auto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ev: Option<TypicalEv>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TypicalEv {
    pub annual_kwh: f64,
    /// `evening` (vanaf 18.00 uur), `night` (vanaf 01.00 uur) of `daytime` (vanaf 11.00 uur).
    pub charging: String,
}

/// Extra verbruik vanaf 1 januari van een later jaar, met dezelfde vorm als in het geschatte
/// profiel. Komt bovenop het verbruik in het gekozen energieprofiel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoadChange {
    /// `heat_pump` of `ev`.
    pub kind: String,
    pub from_calendar_year: u32,
    pub annual_kwh: f64,
    /// Alleen bij `ev`: `evening`, `night` of `daytime`, zoals bij [`TypicalEv`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charging: Option<String>,
}

/// Laadvermogen van een 1-fase laadpunt van 16 A: 230 V × 16 A.
const EV_CHARGE_KW: f64 = 3.68;

/// Aandeel warm tapwater in het warmtepompverbruik: CE Delft, factsheet bodemwarmtepomp
/// (2021), 2 personen (680 kWh tapwater + 320 kWh stilstandsverlies) naast 1.960 kWh
/// ruimteverwarming bij energielabel B.
const TAP_WATER_SHARE: f64 = 1000.0 / 2960.0;
const CE_DELFT_URL: &str =
    "https://ce.nl/wp-content/uploads/2021/04/05_Factsheet-Bodemwarmtepomp_DEF.pdf";

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
    heating: HeatingShape,
}

#[derive(Deserialize)]
struct HeatingShape {
    source: String,
    url: String,
    base_c: f64,
    degree_hours: Vec<u64>,
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
        "heat_pump": {
            "source": format!("{}; aandeel warm tapwater {:.0}% volgens CE Delft, factsheet bodemwarmtepomp (2 personen, label B)", r.heating.source, TAP_WATER_SHARE * 100.0),
            "url": r.heating.url,
            "tap_water_url": CE_DELFT_URL,
            "base_c": r.heating.base_c,
            "tap_water_share": TAP_WATER_SHARE,
        },
        "ev": {"charge_kw": EV_CHARGE_KW, "start_hours": {"evening": 18, "night": 1, "daytime": 11}},
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

/// Hele kWh in Nederlandse notatie met een punt per duizendtal, zoals de interface: 5500 wordt ‘5.500’.
fn whole(kwh: f64) -> String {
    let digits = format!("{:.0}", kwh.abs());
    let mut grouped = String::new();
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    if kwh.round() < 0.0 {
        grouped.insert(0, '−');
    }
    grouped
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
    let heat_pump = request.heat_pump_kwh.unwrap_or(0.0);
    let ev = request.ev.as_ref().map_or(0.0, |ev| ev.annual_kwh);
    if !heat_pump.is_finite() || !(0.0..=30_000.0).contains(&heat_pump) {
        return Err("Vul voor de warmtepomp 0 tot 30.000 kWh per jaar in.".into());
    }
    if !ev.is_finite() || !(0.0..=20_000.0).contains(&ev) {
        return Err("Vul voor de elektrische auto 0 tot 20.000 kWh per jaar in.".into());
    }
    let ev_start = request
        .ev
        .as_ref()
        .map(|ev| charging_start(&ev.charging))
        .transpose()?;
    let household = consumption - heat_pump - ev;
    if household < 100.0 {
        return Err("Warmtepomp en auto samen zijn bijna even groot als of groter dan je totale verbruik. Het jaarverbruik is inclusief warmtepomp en auto; controleer de getallen.".into());
    }
    let mut warnings = vec![
        "GESCHAT PROFIEL: het verbruik volgt het standaardprofiel E1A, een gemiddelde van veel huishoudens zonder zonnepanelen. Echte pieken en dalen van één huishouden zijn groter; de uitkomst is een indicatie, geen meting.".to_owned(),
    ];
    if heat_pump > 0.0 {
        warnings.push(format!(
            "Warmtepomp: {} kWh van het jaarverbruik. {:.0}% volgt de graaduren onder {} °C van het weerjaar 2023 in De Bilt (ruimteverwarming), {:.0}% is gelijkmatig over het jaar verdeeld (warm tapwater, verhouding uit een voorbeeld van CE Delft). Een lager rendement bij vorst en de regeling van je eigen warmtepomp zijn niet meegenomen.",
            whole(heat_pump),
            (1.0 - TAP_WATER_SHARE) * 100.0,
            r.heating.base_c,
            TAP_WATER_SHARE * 100.0
        ));
    }
    if let (Some(start), Some(request_ev)) = (ev_start, &request.ev) {
        warnings.push(format!(
            "Elektrische auto: {} kWh per jaar, elke dag dezelfde hoeveelheid, geladen met {} kW vanaf {start:02}.00 uur ({}). Echte laadmomenten wisselen per dag; met een hoger laadvermogen kan een accu een kleiner deel van het laden leveren.",
            whole(ev),
            EV_CHARGE_KW.to_string().replace('.', ","),
            match request_ev.charging.as_str() {
                "evening" => "’s avonds",
                "night" => "’s nachts",
                _ => "overdag",
            }
        ));
    }
    if heat_pump == 0.0 && ev == 0.0 {
        warnings.push("Extra verbruik van een warmtepomp, laadpaal of thuiswerken verandert het dagpatroon. Dat zit niet in dit profiel; geef het apart op voor een betere schatting.".to_owned());
    }
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
    let degree_sum: f64 = r.heating.degree_hours.iter().map(|&v| v as f64).sum();
    let charging = ev_start.map_or_else(|| vec![0.0; hours], |start| ev_load(r, ev, start));
    let intervals: Vec<SolarInterval> = (0..hours)
        .map(|i| {
            let start = r.start_unix_s + i as i64 * r.interval_s;
            let heating = heat_pump
                * ((1.0 - TAP_WATER_SHARE) * r.heating.degree_hours[i] as f64 / degree_sum
                    + TAP_WATER_SHARE / hours as f64);
            // Warmtepomp en laden lopen binnen het uur gelijkmatig; alleen het huishouden heeft pieken.
            // Zo opgeteld is het gelijkmatige deel nooit groter dan het totaal.
            let steady = heating + charging[i];
            let kwh = r.load.values[i] as f64 / load_sum * household + steady;
            SolarInterval {
                start_unix_s: start,
                end_unix_s: start + r.interval_s,
                production_wh: pv[i] * 1000.0,
                consumption_wh: Some(kwh * 1000.0),
                steady_consumption_wh: (steady > 0.0).then_some(steady * 1000.0),
                measured_import_wh: None,
                measured_export_wh: None,
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
        clipped_consumption_kwh: None,
        grid_import_kwh: None,
        grid_export_kwh: None,
    };
    let solar_label = request
        .solar
        .as_ref()
        .map_or("geen zonnepanelen".to_owned(), |s| {
            format!(
                "{} kWh opwek {}",
                whole(production_kwh),
                label_orientation(&s.orientation)
            )
        });
    // Het laadmoment staat in de naam: profielen die alleen daarin verschillen, zijn anders niet uit elkaar te houden.
    let ev_label = match request.ev.as_ref().map(|ev| ev.charging.as_str()) {
        Some("evening") => "auto, ’s avonds laden",
        Some("night") => "auto, ’s nachts laden",
        _ => "auto, overdag laden",
    };
    let extras: String = [(heat_pump, "warmtepomp"), (ev, ev_label)]
        .iter()
        .filter(|(kwh, _)| *kwh > 0.0)
        .map(|(kwh, label)| format!(" ({} kWh {label})", whole(*kwh)))
        .collect();
    Ok(TypicalProfile {
        title: format!(
            "Geschat profiel · {} kWh verbruik{extras} · {solar_label}",
            whole(consumption)
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

fn charging_start(charging: &str) -> Result<u32, String> {
    match charging {
        "evening" => Ok(18),
        "night" => Ok(1),
        "daytime" => Ok(11),
        _ => Err("Kies voor het laden van de auto ’s avonds, ’s nachts of overdag.".into()),
    }
}

/// Omschrijving van een verandering in verbruik, voor de waarschuwingen bij het resultaat.
pub fn load_change_label(change: &LoadChange) -> String {
    match (change.kind.as_str(), change.charging.as_deref()) {
        ("heat_pump", _) => "Warmtepomp".into(),
        (_, Some("night")) => "Elektrische auto, ’s nachts laden".into(),
        (_, Some("daytime")) => "Elektrische auto, overdag laden".into(),
        _ => "Elektrische auto, ’s avonds laden".into(),
    }
}

/// Extra verbruik per meetperiode (`[begin, einde)` in Unix-seconden) voor een verandering in
/// verbruik. De uurvorm van het referentiejaar wordt op lokale datum en uur gelegd (29 februari
/// als 28 februari), naar de periodeduur verdeeld en daarna op precies het jaarverbruik geschaald.
pub fn load_change(change: &LoadChange, periods: &[(i64, i64)]) -> Result<Vec<f64>, String> {
    use chrono::{Datelike, Timelike};
    let r = resource();
    let hours = r.load.values.len();
    let annual = change.annual_kwh;
    let hourly = match change.kind.as_str() {
        "heat_pump" => {
            if !annual.is_finite() || !(1.0..=30_000.0).contains(&annual) {
                return Err("Vul voor de warmtepomp 1 tot 30.000 kWh per jaar in.".into());
            }
            let degree_sum: f64 = r.heating.degree_hours.iter().map(|&v| v as f64).sum();
            r.heating
                .degree_hours
                .iter()
                .map(|&d| {
                    annual
                        * ((1.0 - TAP_WATER_SHARE) * d as f64 / degree_sum
                            + TAP_WATER_SHARE / hours as f64)
                })
                .collect()
        }
        "ev" => {
            if !annual.is_finite() || !(1.0..=20_000.0).contains(&annual) {
                return Err("Vul voor de elektrische auto 1 tot 20.000 kWh per jaar in.".into());
            }
            let start = charging_start(change.charging.as_deref().unwrap_or(""))?;
            ev_load(r, annual, start)
        }
        _ => {
            return Err(
                "Kies als verandering in verbruik een warmtepomp of een elektrische auto.".into(),
            );
        }
    };
    // Lokale (maand, dag, uur) → kWh in dat uur; het dubbele uur bij de wintertijd telt gemiddeld.
    let key = |unix_s: i64| -> Option<(u32, u32, u32)> {
        let local = Utc
            .timestamp_opt(unix_s, 0)
            .single()?
            .with_timezone(&Amsterdam);
        let (month, day) = match (local.month(), local.day()) {
            (2, 29) => (2, 28),
            other => other,
        };
        Some((month, day, local.hour()))
    };
    let mut by_hour: BTreeMap<(u32, u32, u32), (f64, f64)> = BTreeMap::new();
    for (index, value) in hourly.iter().enumerate() {
        if let Some(k) = key(r.start_unix_s + index as i64 * r.interval_s) {
            let entry = by_hour.entry(k).or_default();
            entry.0 += value;
            entry.1 += 1.0;
        }
    }
    let mut values = Vec::with_capacity(periods.len());
    for &(start, end) in periods {
        let (month, day, hour) = key(start).ok_or("Datum buiten bereik.")?;
        // Het uur dat bij de zomertijd in het referentiejaar ontbreekt, krijgt het uur erna.
        let (sum, count) = [hour, hour + 1, hour.saturating_sub(1)]
            .iter()
            .find_map(|&h| by_hour.get(&(month, day, h)))
            .copied()
            .unwrap_or((0.0, 1.0));
        values.push(sum / count * (end - start) as f64 / 3600.0);
    }
    let total: f64 = values.iter().sum();
    if total > 0.0 {
        values.iter_mut().for_each(|v| *v *= annual / total);
    }
    Ok(values)
}

/// Laadt elke dag dezelfde hoeveelheid met vast vermogen vanaf het gekozen lokale uur.
/// Wat niet binnen het uur past, schuift door naar de volgende uren.
fn ev_load(r: &Resource, annual_kwh: f64, start_hour: u32) -> Vec<f64> {
    use chrono::Timelike;
    let hours = r.load.values.len();
    let per_day = annual_kwh / (hours as f64 / 24.0);
    let mut load = vec![0.0; hours];
    for i in 0..hours {
        let local = Utc
            .timestamp_opt(r.start_unix_s + i as i64 * r.interval_s, 0)
            .single()
            .map(|t| t.with_timezone(&Amsterdam));
        if local.is_none_or(|t| t.hour() != start_hour) {
            continue;
        }
        let mut remaining = per_day;
        let mut index = i;
        while remaining > 1e-12 {
            let room = EV_CHARGE_KW - load[index % hours];
            let added = room.min(remaining);
            load[index % hours] += added;
            remaining -= added;
            index += 1;
        }
    }
    // Precies het opgegeven jaarverbruik, ook als het aantal laaddagen afwijkt door zomertijd.
    let total: f64 = load.iter().sum();
    if total > 0.0 {
        load.iter_mut().for_each(|v| *v *= annual_kwh / total);
    }
    load
}
