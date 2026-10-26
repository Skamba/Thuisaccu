//! Gouden uitkomsten: een volledige analyse van een synthetisch, gevarieerd jaar wordt vergeleken met
//! een vastgelegde uitkomst in `tests/golden/`. Elke verandering in de rekenkern die een getal raakt,
//! valt hier op, ook als geen enkele losse regel-test faalt. Getallen mogen alleen in de laatste
//! decimalen afwijken: wiskundige functies kunnen per platform op het laatste bit verschillen.
//!
//! Bewust veranderd? Draai `UPDATE_GOLDEN=1 cargo test -p thuisaccu-core --test golden`, controleer het
//! verschil in Git, en verhoog `MODEL_VERSION` als de betekenis van uitkomsten verandert.

use serde_json::Value;
use thuisaccu_core::{
    analysis::{self, Candidate, ExportVariant, LoadAddition, Objective, Parameters},
    finance::{self, CostLine, CostStatus, CostTiming, Financing, Tariff},
    sizing::{Battery, EnergyInterval, LoadVariation},
};

const DAYS: [usize; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Alleen eenvoudige rekenkunde, zodat het profiel op elk platform bit voor bit gelijk is.
const SUN: [f64; 24] = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.2, 0.5, 0.9, 1.3, 1.6, 1.7, 1.6, 1.3, 0.9, 0.5, 0.2,
    0.05, 0.0, 0.0, 0.0, 0.0, 0.0,
];
const SEASON: [f64; 12] = [
    0.3, 0.45, 0.7, 1.0, 1.2, 1.25, 1.2, 1.05, 0.8, 0.55, 0.35, 0.25,
];
const LOAD: [f64; 24] = [
    0.25, 0.2, 0.2, 0.2, 0.2, 0.25, 0.5, 0.7, 0.45, 0.3, 0.3, 0.35, 0.4, 0.3, 0.3, 0.35, 0.5, 0.9,
    1.1, 1.0, 0.8, 0.6, 0.4, 0.3,
];

fn month(day: usize) -> usize {
    let mut rest = day;
    for (m, days) in DAYS.iter().enumerate() {
        if rest < *days {
            return m;
        }
        rest -= days;
    }
    11
}

/// Uurwaarden met seizoenen, een weekend en in maart gemeten netafname en teruglevering.
fn hourly() -> Vec<EnergyInterval> {
    (0..8760)
        .map(|i| {
            let (day, hour) = (i / 24, i % 24);
            let production = SUN[hour] * SEASON[month(day)] * 2.0;
            let consumption = LOAD[hour] * if day % 7 >= 5 { 1.2 } else { 1.0 };
            let measured = (59..90).contains(&day);
            let overlap = production.min(consumption) * 0.9;
            EnergyInterval {
                duration_hours: 1.0,
                production_kwh: production,
                consumption_kwh: consumption,
                steady_consumption_kwh: None,
                measured_import_kwh: measured.then_some(consumption - overlap),
                measured_export_kwh: measured.then_some(production - overlap),
            }
        })
        .collect()
}

/// Kwartierwaarden uit het uurprofiel, met een laadpaal als gelijkmatig verbruik in de avond.
fn quarterly() -> Vec<EnergyInterval> {
    hourly()
        .iter()
        .enumerate()
        .flat_map(|(i, h)| {
            let ev = if (19..22).contains(&(i % 24)) {
                0.5
            } else {
                0.0
            };
            (0..4).map(move |_| EnergyInterval {
                duration_hours: 0.25,
                production_kwh: h.production_kwh / 4.0,
                consumption_kwh: (h.consumption_kwh + ev) / 4.0,
                steady_consumption_kwh: Some(ev / 4.0),
                measured_import_kwh: None,
                measured_export_kwh: None,
            })
        })
        .collect()
}

fn costs(lines: &[(&str, CostTiming, Option<u32>, i64)]) -> Vec<CostLine> {
    finance::COST_CATEGORIES
        .iter()
        .map(|category| {
            let line = lines.iter().find(|(c, ..)| c == category);
            CostLine {
                category: category.to_string(),
                status: if line.is_some() {
                    CostStatus::Priced
                } else {
                    CostStatus::NotApplicable
                },
                amount_minor: line.map_or(0, |l| l.3),
                timing: line.map_or(CostTiming::Upfront, |l| l.1),
                year: line.and_then(|l| l.2),
                source: "Synthetische gouden test".into(),
                notes: String::new(),
            }
        })
        .collect()
}

fn battery(capacity: f64, power: f64, efficiency: f64, standby: f64, life: u32) -> Battery {
    Battery {
        usable_capacity_kwh: capacity,
        charge_power_kw: power,
        discharge_power_kw: power,
        ac_round_trip_efficiency_pct: efficiency,
        standby_w: standby,
        annual_capacity_loss_pct: 2.5,
        operating_life_years: life,
    }
}

fn candidate(key: &str, battery: Battery, costs: Vec<CostLine>, financing: Financing) -> Candidate {
    Candidate {
        key: key.into(),
        name: key.into(),
        configuration_id: None,
        battery,
        costs,
        financing,
        assumptions: "Synthetische gouden test".into(),
    }
}

fn candidates() -> Vec<Candidate> {
    vec![
        // Stekkeraccu met 800 W en een abonnement.
        candidate(
            "plug",
            battery(2.0, 0.8, 85.0, 8.0, 15),
            costs(&[
                ("battery", CostTiming::Upfront, None, 150_000),
                ("subscription", CostTiming::Annual, None, 2_400),
            ]),
            Financing::default(),
        ),
        // Vaste accu met installatie, een lening en een vervanging in jaar 4.
        candidate(
            "fixed",
            battery(9.5, 5.0, 90.0, 15.0, 3),
            costs(&[
                ("battery", CostTiming::Upfront, None, 520_000),
                ("installation", CostTiming::Upfront, None, 90_000),
                ("battery_replacement", CostTiming::Event, Some(4), 300_000),
            ]),
            Financing {
                loan_amount_eur: 3_000.0,
                annual_interest_pct: 4.5,
                years: 5,
            },
        ),
    ]
}

fn parameters() -> Parameters {
    Parameters {
        start_year: 2027,
        horizon_years: 6,
        discount_pct: 3.5,
        annual_cost_escalation_pct: 2.0,
        annual_pv_loss_pct: 0.5,
        annual_load_growth_pct: 0.5,
        objective: Objective::NetPresentValue,
        budget_eur: None,
        price_uncertainty_pct: 20.0,
        cost_uncertainty_pct: 15.0,
        tariff: Tariff {
            import_eur_per_kwh: 0.28,
            export_eur_per_kwh: 0.06,
            export_fee_eur_per_kwh: 0.04,
            export_fee_bands: vec![],
            fixed_annual_eur: 0.0,
            annual_price_change_pct: 1.5,
        },
        export_variant: Some(ExportVariant {
            label: "Geen vergoeding vanaf 2030".into(),
            from_calendar_year: 2030,
            export_eur_per_kwh: 0.0,
            export_fee_eur_per_kwh: 0.04,
        }),
        load_variation: LoadVariation::Households,
    }
}

/// Vergelijkt recursief; getallen met een relatieve marge van 1e-9.
fn compare(path: &str, actual: &Value, expected: &Value, differences: &mut Vec<String>) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(e)) => {
            let (a, e) = (a.as_f64().unwrap(), e.as_f64().unwrap());
            if (a - e).abs() > 1e-9 * e.abs().max(1.0) {
                differences.push(format!("{path}: {a} in plaats van {e}"));
            }
        }
        (Value::Array(a), Value::Array(e)) if a.len() == e.len() => {
            for (i, (a, e)) in a.iter().zip(e).enumerate() {
                compare(&format!("{path}[{i}]"), a, e, differences);
            }
        }
        (Value::Object(a), Value::Object(e)) if a.keys().eq(e.keys()) => {
            for (key, a) in a {
                compare(&format!("{path}.{key}"), a, &e[key], differences);
            }
        }
        _ if actual == expected => {}
        _ => differences.push(format!("{path}: {actual} in plaats van {expected}")),
    }
}

fn check(name: &str, result: &analysis::AnalysisResult) {
    let path = format!("{}/tests/golden/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let actual = serde_json::to_value(result).unwrap();
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, serde_json::to_string_pretty(&actual).unwrap() + "\n").unwrap();
        return;
    }
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let mut differences = vec![];
    compare(name, &actual, &expected, &mut differences);
    assert!(
        differences.is_empty(),
        "{} afwijkingen van de gouden uitkomst, eerste: {:#?}",
        differences.len(),
        &differences[..differences.len().min(10)]
    );
}

#[test]
fn hourly_year_with_measured_month_loan_replacement_addition_and_export_variant() {
    let winter: Vec<f64> = (0..8760)
        .map(|i| {
            if [0, 1, 10, 11].contains(&month(i / 24)) {
                0.4
            } else {
                0.05
            }
        })
        .collect();
    let addition = LoadAddition {
        label: "Warmtepomp".into(),
        from_calendar_year: 2029,
        steady_kwh: winter,
    };
    let result =
        analysis::analyze_with(&hourly(), &parameters(), &candidates(), &[addition]).unwrap();
    check("hourly", &result);
}

#[test]
fn quarter_hour_year_with_steady_ev_charging() {
    let mut p = parameters();
    p.horizon_years = 5;
    p.export_variant = None;
    p.objective = Objective::Payback;
    let result = analysis::analyze(&quarterly(), &p, &candidates()).unwrap();
    check("quarterly", &result);
}
