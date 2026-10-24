//! AC-energiebalans voor zonnestroom opslaan en later zelf gebruiken.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnergyInterval {
    pub duration_hours: f64,
    pub production_kwh: f64,
    pub consumption_kwh: f64,
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

/// Geen netladen, netverkoop vanuit de accu of voorspelde handelsopbrengsten.
/// De laad-/ontlaadverliezen verdelen de AC-RTE symmetrisch over beide paden.
pub fn simulate_year(
    profile: &[EnergyInterval],
    battery: Option<&Battery>,
    age: u32,
    pv_factor: f64,
    load_factor: f64,
    initial_storage: f64,
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
        let direct = production.min(load);
        let mut surplus = production - direct;
        let mut deficit = load - direct;
        let standby = active.map_or(0.0, |b| b.standby_w / 1000.0 * i.duration_hours);
        let solar_standby = surplus.min(standby);
        surplus -= solar_standby;
        let mut charged = 0.0;
        let mut delivered = 0.0;
        if let Some(b) = active {
            charged = surplus
                .min(b.charge_power_kw * i.duration_hours)
                .min((capacity - storage).max(0.0) / efficiency);
            storage += charged * efficiency;
            surplus -= charged;
            delivered = deficit
                .min(b.discharge_power_kw * i.duration_hours)
                .min(storage * efficiency);
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
