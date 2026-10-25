//! AC-energiebalans voor zonnestroom opslaan en later zelf gebruiken.
use crate::load_spread::TABLES;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnergyInterval {
    pub duration_hours: f64,
    pub production_kwh: f64,
    pub consumption_kwh: f64,
    /// Deel van `consumption_kwh` dat binnen de periode gelijkmatig loopt, zoals warmtepomp en
    /// laadpaal in een geschat profiel. Alleen de rest volgt `LoadVariation::Households`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steady_consumption_kwh: Option<f64>,
    /// Netafname en teruglevering volgens de slimme meter in dezelfde periode, zonder accu. Met
    /// beide bekend is gemeten hoeveel opwek en verbruik binnen de periode samenvielen; dan
    /// vervangen ze de geschatte verdeling (zie `measured`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured_import_kwh: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured_export_kwh: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Battery {
    /// Bruikbare interne opslag; reeds gecorrigeerd voor toegestane DoD.
    pub usable_capacity_kwh: f64,
    /// Vermogens aan de AC-zijde, geen kVA.
    pub charge_power_kw: f64,
    pub discharge_power_kw: f64,
    pub ac_round_trip_efficiency_pct: f64,
    /// Continu extra AC-verbruik tijdens de operationele levensduur.
    pub standby_w: f64,
    pub annual_capacity_loss_pct: f64,
    pub operating_life_years: u32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct EnergyYear {
    pub production_kwh: f64,
    pub consumption_kwh: f64,
    pub grid_import_kwh: f64,
    pub grid_export_kwh: f64,
    pub direct_solar_kwh: f64,
    pub battery_to_load_kwh: f64,
    pub battery_charge_kwh: f64,
    pub standby_kwh: f64,
    pub conversion_and_fade_loss_kwh: f64,
    pub start_storage_kwh: f64,
    pub end_storage_kwh: f64,
    pub equivalent_cycles: f64,
    pub self_consumption_pct: f64,
    pub self_sufficiency_pct: f64,
    pub max_grid_import_kw: f64,
}

/// Verloop van het verbruik binnen één meetperiode. Opwek is binnen een periode altijd gelijkmatig.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoadVariation {
    /// Het gemiddelde vermogen geldt de hele periode, zoals in modelversie 1.
    #[default]
    Uniform,
    /// Gemiddelde verdeling binnen de periode van 74 per seconde gemeten huishoudens (HTW Berlin)
    /// voor perioden van 5, 10, 15, 30 en 60 minuten; andere perioden blijven gelijkmatig.
    Households,
}

/// Tien even lange delen van de periode, als factor van het gemiddelde verbruik.
const BANDS: usize = 10;

/// Verdeling voor deze periode en dit gemiddelde vermogen, lineair tussen de klassen van de tabel.
fn spread(variation: LoadVariation, duration_hours: f64, load_kw: f64) -> Option<[f64; BANDS]> {
    if variation == LoadVariation::Uniform {
        return None;
    }
    let seconds = duration_hours * 3600.0;
    let (_, rows) = TABLES
        .iter()
        .find(|(s, _)| (f64::from(*s) - seconds).abs() < 0.5)?;
    let (first, last) = (rows[0], rows[rows.len() - 1]);
    let mut shape = if load_kw <= first.0 {
        first.1
    } else if load_kw >= last.0 {
        last.1
    } else {
        let i = rows.iter().position(|r| r.0 > load_kw)?;
        let ((x0, a), (x1, b)) = (rows[i - 1], rows[i]);
        let t = (load_kw - x0) / (x1 - x0);
        std::array::from_fn(|k| a[k] + t * (b[k] - a[k]))
    };
    // Afronding in de tabel mag de energie van de periode niet veranderen.
    let mean = shape.iter().sum::<f64>() / BANDS as f64;
    shape.iter_mut().for_each(|q| *q /= mean);
    Some(shape)
}

/// Energiestromen binnen één periode vóór laadtoestand en standby.
#[derive(Default)]
struct Split {
    direct: f64,
    surplus: f64,
    deficit: f64,
    chargeable: f64,
    dischargeable: f64,
}

fn split(
    production: f64,
    steady: f64,
    variable: f64,
    shape: &[f64],
    charge_limit: f64,
    discharge_limit: f64,
) -> Split {
    let share = 1.0 / shape.len() as f64;
    let mut s = Split::default();
    for q in shape {
        let part = steady + variable * q;
        let surplus = (production - part).max(0.0);
        let deficit = (part - production).max(0.0);
        s.direct += production.min(part) * share;
        s.surplus += surplus * share;
        s.deficit += deficit * share;
        s.chargeable += surplus.min(charge_limit) * share;
        s.dischargeable += deficit.min(discharge_limit) * share;
    }
    s
}

/// Overschot en tekort volgens de meter in plaats van de geschatte verdeling. Zonder accu is
/// `min(netafname, teruglevering)` de energie die binnen de periode eerst werd teruggeleverd en
/// later weer afgenomen (of omgekeerd): zoveel minder dan gelijkmatig viel direct samen. Bij
/// gewijzigde opwek of verbruik schaalt dat met de kleinste factor. Het deel dat binnen het
/// laad- en ontlaadvermogen past, volgt dezelfde verhouding als in de geschatte verdeling.
fn measured(
    estimate: Split,
    production: f64,
    load: f64,
    overlap: f64,
    charge_limit: f64,
    discharge_limit: f64,
) -> Split {
    let overlap = overlap.clamp(0.0, production.min(load));
    let surplus = (production - load).max(0.0) + overlap;
    let deficit = (load - production).max(0.0) + overlap;
    let within = |amount: f64, part: f64, whole: f64, limit: f64| {
        let share = if whole > 0.0 { part / whole } else { 1.0 };
        (amount * share).min(amount).min(limit)
    };
    Split {
        direct: production.min(load) - overlap,
        surplus,
        deficit,
        chargeable: within(surplus, estimate.chargeable, estimate.surplus, charge_limit),
        dischargeable: within(
            deficit,
            estimate.dischargeable,
            estimate.deficit,
            discharge_limit,
        ),
    }
}

/// Geen netladen, netverkoop vanuit de accu of voorspelde handelsopbrengsten.
/// De laad-/ontlaadverliezen verdelen de AC-RTE symmetrisch over beide paden.
pub fn simulate_year(
    profile: &[EnergyInterval],
    battery: Option<&Battery>,
    age: u32,
    pv_factor: f64,
    load_factor: f64,
    initial_storage: f64,
    variation: LoadVariation,
) -> EnergyYear {
    let active = battery.filter(|b| age < b.operating_life_years);
    let capacity = active.map_or(0.0, |b| {
        b.usable_capacity_kwh * (1.0 - b.annual_capacity_loss_pct / 100.0).powi(age as i32)
    });
    let efficiency = active.map_or(1.0, |b| (b.ac_round_trip_efficiency_pct / 100.0).sqrt());
    let mut storage = initial_storage.min(capacity);
    let mut result = EnergyYear {
        start_storage_kwh: initial_storage,
        conversion_and_fade_loss_kwh: initial_storage - storage,
        ..Default::default()
    };
    let mut discharged_storage = 0.0;
    for i in profile {
        let production = i.production_kwh * pv_factor;
        let load = i.consumption_kwh * load_factor;
        let steady = (i.steady_consumption_kwh.unwrap_or(0.0) * load_factor).clamp(0.0, load);
        let shape = spread(
            variation,
            i.duration_hours,
            (load - steady) / i.duration_hours,
        );
        let (charge_limit, discharge_limit) = active.map_or((0.0, 0.0), |b| {
            (
                b.charge_power_kw * i.duration_hours,
                b.discharge_power_kw * i.duration_hours,
            )
        });
        let s = split(
            production,
            steady,
            load - steady,
            shape.as_ref().map_or(&[1.0][..], |s| &s[..]),
            charge_limit,
            discharge_limit,
        );
        let s = match (i.measured_import_kwh, i.measured_export_kwh) {
            (Some(imported), Some(exported)) => measured(
                s,
                production,
                load,
                imported.min(exported) * pv_factor.min(load_factor),
                charge_limit,
                discharge_limit,
            ),
            _ => s,
        };
        let direct = s.direct;
        let mut surplus = s.surplus;
        let mut deficit = s.deficit;
        let standby = active.map_or(0.0, |b| b.standby_w / 1000.0 * i.duration_hours);
        let solar_standby = surplus.min(standby);
        surplus -= solar_standby;
        let mut charged = 0.0;
        let mut delivered = 0.0;
        if active.is_some() {
            charged = s
                .chargeable
                .min(surplus)
                .min((capacity - storage).max(0.0) / efficiency);
            storage += charged * efficiency;
            surplus -= charged;
            delivered = s.dischargeable.min(storage * efficiency);
            storage -= delivered / efficiency;
            deficit -= delivered;
            discharged_storage += delivered / efficiency;
            result.conversion_and_fade_loss_kwh +=
                charged * (1.0 - efficiency) + delivered / efficiency - delivered;
        }
        result.production_kwh += production;
        result.consumption_kwh += load;
        let imported = deficit + standby - solar_standby;
        result.grid_import_kwh += imported;
        result.max_grid_import_kw = result.max_grid_import_kw.max(imported / i.duration_hours);
        result.grid_export_kwh += surplus;
        result.direct_solar_kwh += direct;
        result.battery_to_load_kwh += delivered;
        result.battery_charge_kwh += charged;
        result.standby_kwh += standby;
    }
    result.end_storage_kwh = storage.max(0.0);
    result.equivalent_cycles = battery.map_or(0.0, |b| discharged_storage / b.usable_capacity_kwh);
    let solar_used = result.direct_solar_kwh + result.battery_to_load_kwh;
    result.self_consumption_pct = if result.production_kwh > 0.0 {
        solar_used / result.production_kwh * 100.0
    } else {
        0.0
    };
    result.self_sufficiency_pct = if result.consumption_kwh > 0.0 {
        solar_used / result.consumption_kwh * 100.0
    } else {
        0.0
    };
    result
}

/// Bovengrens per capaciteit: verliesvrije accu zonder vermogensgrens of standby.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapacityPoint {
    pub usable_capacity_kwh: f64,
    pub battery_to_load_kwh: f64,
    pub self_consumption_pct: f64,
    pub self_sufficiency_pct: f64,
    pub equivalent_cycles: f64,
}

/// Simuleert twee opeenvolgende jaren zodat de beginlading geen invloed heeft op het resultaat.
/// Dit is een hulpmiddel om een capaciteitsbereik te kiezen, geen productberekening.
pub fn capacity_curve(
    profile: &[EnergyInterval],
    capacities_kwh: &[f64],
    variation: LoadVariation,
) -> Vec<CapacityPoint> {
    capacities_kwh
        .iter()
        .map(|&capacity| {
            let ideal = Battery {
                usable_capacity_kwh: capacity,
                charge_power_kw: f64::MAX,
                discharge_power_kw: f64::MAX,
                ac_round_trip_efficiency_pct: 100.0,
                standby_w: 0.0,
                annual_capacity_loss_pct: 0.0,
                operating_life_years: 2,
            };
            let battery = (capacity > 0.0).then_some(&ideal);
            let warm_up = simulate_year(profile, battery, 0, 1.0, 1.0, 0.0, variation);
            let year = simulate_year(
                profile,
                battery,
                1,
                1.0,
                1.0,
                warm_up.end_storage_kwh,
                variation,
            );
            CapacityPoint {
                usable_capacity_kwh: capacity,
                battery_to_load_kwh: year.battery_to_load_kwh,
                self_consumption_pct: year.self_consumption_pct,
                self_sufficiency_pct: year.self_sufficiency_pct,
                equivalent_cycles: year.equivalent_cycles,
            }
        })
        .collect()
}
