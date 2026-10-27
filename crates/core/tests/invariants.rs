//! Eigenschapstests voor de rekenkern: willekeurige, synthetische jaren (uur en kwartier), accu's,
//! kosten en tarieven, met regels die voor elke geldige invoer moeten gelden. De generator is een
//! eigen SplitMix64 met vaste startwaarden, zodat elke run hetzelfde doet en geen extra dependency
//! nodig is. Elke foutmelding noemt de startwaarde (`seed`); draai één geval opnieuw met
//! `INVARIANT_SEED=<seed> cargo test -p thuisaccu-core --test invariants`, of zoek breder met
//! `INVARIANT_CASES=<aantal>` (bijvoorbeeld met `--release`).
//!
//! Het aantal gevallen is bewust klein: een geldig profiel is altijd een volledig jaar.

use thuisaccu_core::{
    analysis::{
        self, AnalysisResult, BatteryStress, Candidate, CandidateResult, ExportVariant, Objective,
        Parameters,
    },
    finance::{self, CostLine, CostStatus, CostTiming, ExportFeeBand, Financing, Tariff},
    sizing::{self, Battery, EnergyInterval, EnergyYear, LoadVariation},
};

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

/// SplitMix64 (Steele, Lea en Flood 2014): klein, snel en ruim voldoende voor testinvoer.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Gelijkmatig in [0, 1).
    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn range(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.unit()
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    fn int(&mut self, low: u32, high: u32) -> u32 {
        low + self.below(u64::from(high - low + 1)) as u32
    }

    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i as u64 + 1) as usize;
            items.swap(i, j);
        }
    }
}

/// Startwaarden per eigenschap; `INVARIANT_SEED` draait alleen dat ene geval en
/// `INVARIANT_CASES` vervangt het aantal gevallen.
fn seeds(property: u64, count: u64) -> Vec<u64> {
    if let Some(seed) = std::env::var("INVARIANT_SEED")
        .ok()
        .and_then(|v| v.trim().parse().ok())
    {
        return vec![seed];
    }
    let count = std::env::var("INVARIANT_CASES")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(count);
    (0..count)
        .map(|i| 0x7468_7569_7361_6363 ^ (property << 40) ^ i)
        .collect()
}

/// Zo veel aan profielkeuzes; de eigenschappen kiezen zelf welke ze toestaan.
#[derive(Clone, Copy)]
struct ProfileShape {
    quarter: bool,
    measured: bool,
    steady: bool,
}

impl ProfileShape {
    fn random(rng: &mut Rng) -> Self {
        Self {
            quarter: rng.chance(0.3),
            measured: rng.chance(0.4),
            steady: rng.chance(0.4),
        }
    }

    fn plain(rng: &mut Rng) -> Self {
        Self {
            quarter: rng.chance(0.3),
            measured: false,
            steady: false,
        }
    }
}

/// Synthetisch jaar van 365 dagen: zon met seizoen en bewolking per dag, verbruik met een
/// basis, ochtend- en avondpiek en ruis. Optioneel kwartierwaarden, een gelijkmatig deel
/// (laadpaal) en voor sommige dagen gemeten netafname en teruglevering zonder accu.
fn profile(rng: &mut Rng, shape: ProfileShape) -> Vec<EnergyInterval> {
    let peak_kw = if rng.chance(0.1) {
        0.0
    } else {
        rng.range(0.5, 6.0)
    };
    let base_kw = rng.range(0.05, 0.6);
    let evening_kw = rng.range(0.0, 2.0);
    let steps = if shape.quarter { 4 } else { 1 };
    let duration = 1.0 / steps as f64;
    let mut out = Vec::with_capacity(8760 * steps);
    for day in 0..365 {
        let season = 0.25 + 0.75 * (std::f64::consts::PI * day as f64 / 365.0).sin();
        let cloud = rng.range(0.15, 1.0);
        let measured = shape.measured && rng.chance(0.3);
        for hour in 0..24 {
            let sun = ((hour as f64 - 6.0) / 13.0 * std::f64::consts::PI)
                .sin()
                .max(0.0);
            let evening = if (17..22).contains(&hour) {
                evening_kw
            } else {
                0.0
            };
            let ev = if shape.steady && (19..23).contains(&hour) {
                rng.range(0.0, 3.0)
            } else {
                0.0
            };
            for _ in 0..steps {
                let production = peak_kw * sun * season * cloud * rng.range(0.7, 1.0) * duration;
                let household = (base_kw + evening) * rng.range(0.3, 2.5) * duration;
                let steady = ev * duration;
                let consumption = household + steady;
                let overlap = production.min(consumption) * rng.range(0.6, 1.0);
                out.push(EnergyInterval {
                    duration_hours: duration,
                    production_kwh: production,
                    consumption_kwh: consumption,
                    steady_consumption_kwh: shape.steady.then_some(steady),
                    measured_import_kwh: measured.then_some(consumption - overlap),
                    measured_export_kwh: measured.then_some(production - overlap),
                });
            }
        }
    }
    out
}

fn battery(rng: &mut Rng) -> Battery {
    Battery {
        usable_capacity_kwh: rng.range(0.5, 30.0),
        charge_power_kw: rng.range(0.3, 10.0),
        discharge_power_kw: rng.range(0.3, 10.0),
        ac_round_trip_efficiency_pct: rng.range(60.0, 100.0),
        standby_w: if rng.chance(0.3) {
            0.0
        } else {
            rng.range(0.0, 40.0)
        },
        annual_capacity_loss_pct: rng.range(0.0, 5.0),
        operating_life_years: rng.int(2, 20),
    }
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
                source: "Synthetische eigenschapstest".into(),
                notes: String::new(),
            }
        })
        .collect()
}

/// Willekeurige optie met altijd een geprijsde accu vooraf; de rest (installatie, jaarkosten,
/// subsidie, vervanging, lening, garantiestresstest) is optioneel.
fn candidate(rng: &mut Rng, key: &str, horizon_years: u32, battery: Battery) -> Candidate {
    candidate_up_to(rng, key, horizon_years, battery, 1_500_000.0)
}

/// Als [`candidate`], met een accuprijs tot `max_price_minor` eurocent.
fn candidate_up_to(
    rng: &mut Rng,
    key: &str,
    horizon_years: u32,
    battery: Battery,
    max_price_minor: f64,
) -> Candidate {
    let price = rng.range(max_price_minor / 30.0, max_price_minor) as i64;
    let mut lines = vec![("battery", CostTiming::Upfront, None, price)];
    let mut upfront = price;
    if rng.chance(0.5) {
        let installation = rng.range(0.0, 150_000.0) as i64;
        lines.push(("installation", CostTiming::Upfront, None, installation));
        upfront += installation;
    }
    if rng.chance(0.3) {
        let grant = (price as f64 * rng.range(0.0, 0.3)) as i64;
        lines.push(("grant", CostTiming::Upfront, None, grant));
        upfront -= grant;
    }
    if rng.chance(0.4) {
        lines.push((
            "maintenance",
            CostTiming::Annual,
            None,
            rng.range(0.0, 10_000.0) as i64,
        ));
    }
    if rng.chance(0.2) {
        lines.push((
            "inverter_replacement",
            CostTiming::Event,
            Some(rng.int(1, horizon_years)),
            rng.range(0.0, 100_000.0) as i64,
        ));
    }
    if rng.chance(0.15) {
        lines.push((
            "battery_replacement",
            CostTiming::Event,
            Some(rng.int(1, horizon_years)),
            rng.range(0.0, 500_000.0) as i64,
        ));
    }
    let financing = if rng.chance(0.3) {
        Financing {
            loan_amount_eur: (upfront as f64 / 100.0 * rng.range(0.0, 1.0)).floor(),
            annual_interest_pct: rng.range(0.0, 8.0),
            years: rng.int(1, horizon_years),
        }
    } else {
        Financing::default()
    };
    let warranty_stress = rng.chance(0.2).then(|| BatteryStress {
        operating_life_years: rng.int(1, 15),
        annual_capacity_loss_pct: rng.range(0.0, 8.0),
        basis: "Synthetische garantie".into(),
    });
    Candidate {
        key: key.into(),
        name: format!("Optie {key}"),
        configuration_id: None,
        battery,
        costs: costs(&lines),
        financing,
        assumptions: "Fictieve optie voor een eigenschapstest".into(),
        warranty_stress,
        connection: None,
    }
}

fn tariff(rng: &mut Rng) -> Tariff {
    let export_fee_bands = if rng.chance(0.3) {
        vec![
            ExportFeeBand {
                up_to_kwh: Some(rng.range(100.0, 2000.0)),
                annual_eur: rng.range(0.0, 100.0),
            },
            ExportFeeBand {
                up_to_kwh: None,
                annual_eur: rng.range(100.0, 500.0),
            },
        ]
    } else {
        vec![]
    };
    Tariff {
        import_eur_per_kwh: rng.range(0.1, 0.45),
        export_eur_per_kwh: rng.range(-0.05, 0.15),
        export_fee_eur_per_kwh: if rng.chance(0.5) {
            0.0
        } else {
            rng.range(0.0, 0.12)
        },
        export_fee_bands,
        fixed_annual_eur: rng.range(0.0, 400.0),
        annual_price_change_pct: rng.range(-2.0, 4.0),
    }
}

fn parameters(rng: &mut Rng) -> Parameters {
    let start_year = rng.int(2026, 2030);
    let horizon_years = rng.int(1, 4);
    let objective = match rng.below(4) {
        0 => Objective::NetPresentValue,
        1 => Objective::Roi,
        2 => Objective::Payback,
        _ => Objective::SelfConsumption,
    };
    Parameters {
        start_year,
        horizon_years,
        discount_pct: rng.range(0.0, 8.0),
        annual_cost_escalation_pct: rng.range(-2.0, 5.0),
        annual_pv_loss_pct: rng.range(0.0, 1.0),
        annual_load_growth_pct: rng.range(-1.0, 2.0),
        objective,
        budget_eur: rng.chance(0.3).then(|| rng.range(0.0, 15_000.0)),
        tariff: tariff(rng),
        price_uncertainty_pct: rng.range(0.0, 40.0),
        cost_uncertainty_pct: rng.range(0.0, 40.0),
        export_variant: rng.chance(0.3).then(|| ExportVariant {
            label: "Lagere vergoeding".into(),
            from_calendar_year: start_year + rng.int(0, horizon_years - 1),
            export_eur_per_kwh: rng.range(-0.05, 0.05),
            export_fee_eur_per_kwh: rng.range(0.0, 0.15),
        }),
        load_variation: if rng.chance(0.5) {
            LoadVariation::Households
        } else {
            LoadVariation::Uniform
        },
    }
}

fn candidates(rng: &mut Rng, horizon_years: u32, count: u32) -> Vec<Candidate> {
    (0..count)
        .map(|i| {
            let b = battery(rng);
            candidate(rng, &format!("c{i}"), horizon_years, b)
        })
        .collect()
}

fn run(
    seed: u64,
    profile: &[EnergyInterval],
    p: &Parameters,
    candidates: &[Candidate],
) -> AnalysisResult {
    analysis::analyze(profile, p, candidates)
        .unwrap_or_else(|e| panic!("seed {seed}: gegenereerde invoer is ongeldig: {e}"))
}

/// Relatieve tolerantie voor sommen over een heel jaar (tot 35.040 optellingen).
fn near(a: f64, b: f64, scale: f64) -> bool {
    (a - b).abs() <= 1e-9 * (1.0 + scale.abs() + a.abs() + b.abs())
}

macro_rules! assert_near {
    ($a:expr, $b:expr, $scale:expr, $($msg:tt)+) => {{
        let (a, b): (f64, f64) = ($a, $b);
        let context = format!($($msg)+);
        assert!(near(a, b, $scale), "{context}: {a} != {b} (verschil {})", a - b);
    }};
}

// ---------------------------------------------------------------------------------------------
// 1. Energiebehoud
// ---------------------------------------------------------------------------------------------

/// Energiebalans van één jaar. Standby komt eerst uit het zonne-overschot en anders van het net;
/// dat zonnedeel staat niet apart in `EnergyYear`, maar volgt uit beide balansen en moet tussen
/// nul en het standbyverbruik liggen.
fn check_energy_year(e: &EnergyYear, context: &str) {
    let scale = e.production_kwh + e.consumption_kwh + e.standby_kwh + e.start_storage_kwh;
    let tol = 1e-9 * (1.0 + scale);
    for (name, value) in [
        ("netafname", e.grid_import_kwh),
        ("teruglevering", e.grid_export_kwh),
        ("direct gebruik", e.direct_solar_kwh),
        ("ontladen", e.battery_to_load_kwh),
        ("laden", e.battery_charge_kwh),
        ("standby", e.standby_kwh),
        ("verlies", e.conversion_and_fade_loss_kwh),
        ("eindlading", e.end_storage_kwh),
        ("cycli", e.equivalent_cycles),
    ] {
        assert!(value >= -tol, "{context}: {name} is negatief ({value})");
    }
    assert!(
        e.direct_solar_kwh <= e.production_kwh.min(e.consumption_kwh) + tol,
        "{context}: direct gebruik groter dan opwek of verbruik"
    );
    // Zonnekant: opwek = direct + laden + teruglevering + standby uit zon.
    let solar_standby =
        e.production_kwh - e.direct_solar_kwh - e.battery_charge_kwh - e.grid_export_kwh;
    assert!(
        solar_standby >= -tol && solar_standby <= e.standby_kwh + tol,
        "{context}: opwek {} ≠ direct {} + laden {} + teruglevering {} (+ standby uit zon tot {})",
        e.production_kwh,
        e.direct_solar_kwh,
        e.battery_charge_kwh,
        e.grid_export_kwh,
        e.standby_kwh
    );
    // Verbruikskant: verbruik + standby = direct + ontladen + netafname + standby uit zon.
    assert_near!(
        e.consumption_kwh + e.standby_kwh,
        e.direct_solar_kwh + e.battery_to_load_kwh + e.grid_import_kwh + solar_standby,
        scale,
        "{context}: verbruikskant klopt niet"
    );
    // Accu: beginlading + laden = ontladen + verliezen (ook afgekapte beginlading) + eindlading.
    assert_near!(
        e.start_storage_kwh + e.battery_charge_kwh,
        e.battery_to_load_kwh + e.conversion_and_fade_loss_kwh + e.end_storage_kwh,
        scale,
        "{context}: accubalans klopt niet"
    );
    // Hele systeem.
    assert_near!(
        e.production_kwh + e.grid_import_kwh + e.start_storage_kwh,
        e.consumption_kwh
            + e.standby_kwh
            + e.grid_export_kwh
            + e.conversion_and_fade_loss_kwh
            + e.end_storage_kwh,
        scale,
        "{context}: systeembalans klopt niet"
    );
    if e.production_kwh > 0.0 {
        assert_near!(
            e.self_consumption_pct,
            (e.direct_solar_kwh + e.battery_to_load_kwh) / e.production_kwh * 100.0,
            100.0,
            "{context}: eigen gebruik"
        );
    }
}

#[test]
fn energy_is_conserved_for_the_baseline_and_every_battery_year() {
    for seed in seeds(1, 12) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let p = parameters(&mut rng);
        let count = rng.int(1, 3);
        let cs = candidates(&mut rng, p.horizon_years, count);
        let r = run(seed, &profile, &p, &cs);
        let b = &r.baseline_first_year;
        check_energy_year(b, &format!("seed {seed}, geen accu"));
        // Zonder accu stroomt er niets door een accu.
        for v in [
            b.battery_to_load_kwh,
            b.battery_charge_kwh,
            b.standby_kwh,
            b.conversion_and_fade_loss_kwh,
            b.end_storage_kwh,
        ] {
            assert_eq!(v, 0.0, "seed {seed}: geen accu heeft accustromen");
        }
        for c in &r.candidates {
            for y in &c.years {
                let context = format!("seed {seed}, {} jaar {}", c.key, y.year);
                check_energy_year(&y.energy, &context);
            }
            // Direct gebruik, opwek en verbruik hangen niet van de accu af.
            let f = &c.first_year;
            let scale = b.production_kwh + b.consumption_kwh;
            assert_near!(
                f.direct_solar_kwh,
                b.direct_solar_kwh,
                scale,
                "seed {seed}, {}: direct gebruik",
                c.key
            );
            assert_near!(
                f.production_kwh,
                b.production_kwh,
                scale,
                "seed {seed}, {}",
                c.key
            );
            assert_near!(
                f.consumption_kwh,
                b.consumption_kwh,
                scale,
                "seed {seed}, {}",
                c.key
            );
            assert_eq!(
                c.years[0].baseline_grid_import_kwh,
                Some(b.grid_import_kwh),
                "seed {seed}"
            );
            assert_eq!(
                c.years[0].baseline_grid_export_kwh,
                Some(b.grid_export_kwh),
                "seed {seed}"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 2. Vermogens- en laadgrenzen
// ---------------------------------------------------------------------------------------------

/// De laadtoestand is de enige toestand tussen twee meetperioden, dus een jaar in losse
/// perioden doorrekenen (eindlading wordt beginlading) geeft hetzelfde jaar. Zo zijn de grenzen
/// per periode zichtbaar zonder de rekenkern te wijzigen.
#[test]
fn power_and_storage_limits_hold_in_every_interval() {
    for seed in seeds(2, 8) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let b = battery(&mut rng);
        // Een werkende accu: na de levensduur rekent de kern zonder accu.
        let age = rng.int(0, b.operating_life_years - 1);
        let capacity =
            b.usable_capacity_kwh * (1.0 - b.annual_capacity_loss_pct / 100.0).powi(age as i32);
        let eta = (b.ac_round_trip_efficiency_pct / 100.0).sqrt();
        let pv_factor = rng.range(0.8, 1.1);
        let load_factor = rng.range(0.8, 1.2);
        let initial = rng.range(0.0, 1.5) * b.usable_capacity_kwh;
        let variation = if rng.chance(0.5) {
            LoadVariation::Households
        } else {
            LoadVariation::Uniform
        };
        let year = sizing::simulate_year(
            &profile,
            Some(&b),
            age,
            pv_factor,
            load_factor,
            initial,
            variation,
        );
        let tol = 1e-9 * (1.0 + capacity);
        let mut storage = initial;
        let mut sums = EnergyYear::default();
        for (index, interval) in profile.iter().enumerate() {
            let e = sizing::simulate_year(
                std::slice::from_ref(interval),
                Some(&b),
                age,
                pv_factor,
                load_factor,
                storage,
                variation,
            );
            let context = format!("seed {seed}, periode {index}");
            let d = interval.duration_hours;
            assert!(
                e.battery_charge_kwh <= b.charge_power_kw * d + tol,
                "{context}: laden {} boven {} kW × {d} h",
                e.battery_charge_kwh,
                b.charge_power_kw
            );
            assert!(
                e.battery_to_load_kwh <= b.discharge_power_kw * d + tol,
                "{context}: ontladen {} boven {} kW × {d} h",
                e.battery_to_load_kwh,
                b.discharge_power_kw
            );
            assert!(
                e.end_storage_kwh >= 0.0 && e.end_storage_kwh <= capacity + tol,
                "{context}: lading {} buiten 0..{capacity}",
                e.end_storage_kwh
            );
            assert!(
                e.battery_charge_kwh <= e.production_kwh + tol,
                "{context}: geladen zonder zonne-overschot"
            );
            assert!(
                e.battery_to_load_kwh <= e.consumption_kwh + tol,
                "{context}: meer ontladen dan verbruikt"
            );
            // Geen netladen en geen teruglevering vanuit de accu.
            assert!(
                e.grid_export_kwh <= e.production_kwh + tol,
                "{context}: teruglevering boven opwek"
            );
            let expected =
                storage.min(capacity) + e.battery_charge_kwh * eta - e.battery_to_load_kwh / eta;
            assert!(
                (e.end_storage_kwh - expected).abs() <= tol,
                "{context}: lading {} ≠ {expected}",
                e.end_storage_kwh
            );
            check_energy_year(&e, &context);
            storage = e.end_storage_kwh;
            sums.battery_charge_kwh += e.battery_charge_kwh;
            sums.battery_to_load_kwh += e.battery_to_load_kwh;
            sums.grid_import_kwh += e.grid_import_kwh;
            sums.grid_export_kwh += e.grid_export_kwh;
            sums.max_grid_import_kw = sums.max_grid_import_kw.max(e.max_grid_import_kw);
        }
        let scale = year.production_kwh + year.consumption_kwh;
        for (name, x, y) in [
            ("laden", sums.battery_charge_kwh, year.battery_charge_kwh),
            (
                "ontladen",
                sums.battery_to_load_kwh,
                year.battery_to_load_kwh,
            ),
            ("netafname", sums.grid_import_kwh, year.grid_import_kwh),
            ("teruglevering", sums.grid_export_kwh, year.grid_export_kwh),
            ("eindlading", storage, year.end_storage_kwh),
            ("piek", sums.max_grid_import_kw, year.max_grid_import_kw),
        ] {
            assert_near!(x, y, scale, "seed {seed}: {name} per periode ≠ heel jaar");
        }
        // Jaargrenzen: nooit meer dan het vermogen over het hele jaar.
        let hours: f64 = profile.iter().map(|i| i.duration_hours).sum();
        assert!(year.battery_charge_kwh <= b.charge_power_kw * hours + tol);
        assert!(year.battery_to_load_kwh <= b.discharge_power_kw * hours + tol);
    }
}

// ---------------------------------------------------------------------------------------------
// 3. Een (bijna) lege accu werkt als geen accu
// ---------------------------------------------------------------------------------------------

/// Validatie weigert 0 kWh (minimaal 0,01 kWh), dus in `simulate_year` direct. Voorwaarde: geen
/// standby, want die kost ook zonder opslag stroom. `equivalent_cycles` is bij 0 kWh 0/0 (NaN);
/// dat valt buiten het geldige domein en `capacity_curve` geeft daarom bij 0 kWh geen accu mee.
#[test]
fn a_zero_capacity_battery_without_standby_changes_no_energy_flow() {
    for seed in seeds(3, 6) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let mut b = battery(&mut rng);
        b.usable_capacity_kwh = 0.0;
        b.standby_w = 0.0;
        let variation = if rng.chance(0.5) {
            LoadVariation::Households
        } else {
            LoadVariation::Uniform
        };
        let age = rng.int(0, b.operating_life_years - 1);
        let with = sizing::simulate_year(&profile, Some(&b), age, 1.0, 1.0, 0.0, variation);
        let without = sizing::simulate_year(&profile, None, 0, 1.0, 1.0, 0.0, variation);
        for (name, x, y) in [
            ("netafname", with.grid_import_kwh, without.grid_import_kwh),
            (
                "teruglevering",
                with.grid_export_kwh,
                without.grid_export_kwh,
            ),
            ("direct", with.direct_solar_kwh, without.direct_solar_kwh),
            ("ontladen", with.battery_to_load_kwh, 0.0),
            ("laden", with.battery_charge_kwh, 0.0),
            ("verlies", with.conversion_and_fade_loss_kwh, 0.0),
            (
                "eigen gebruik",
                with.self_consumption_pct,
                without.self_consumption_pct,
            ),
        ] {
            assert_eq!(x, y, "seed {seed}: {name}");
        }
    }
}

/// Kleinste geldige accu (0,01 kWh) in een volledige analyse. Voorwaarden: geen standby, geen
/// terugleverstaffel (een sprong van de staffel kan door 0,01 kWh minder teruglevering vallen),
/// geen PV-degradatie of verbruiksgroei en een gelijkmatig verbruik zonder meterwaarden, zodat
/// elke periode óf laadt óf ontlaadt. Dan neemt de lading per aaneengesloten overschotperiode met
/// hoogstens de capaciteit toe, en is de besparing per jaar begrensd door die kleine hoeveelheid.
#[test]
fn the_smallest_allowed_battery_saves_at_most_its_capacity_per_surplus_run() {
    for seed in seeds(4, 8) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::plain(&mut rng);
        let profile = profile(&mut rng, shape);
        let mut p = parameters(&mut rng);
        p.annual_pv_loss_pct = 0.0;
        p.annual_load_growth_pct = 0.0;
        p.load_variation = LoadVariation::Uniform;
        p.tariff.export_fee_bands.clear();
        p.export_variant = None;
        let mut b = battery(&mut rng);
        b.usable_capacity_kwh = 0.01;
        b.standby_w = 0.0;
        let c = candidate(&mut rng, "tiny", p.horizon_years, b.clone());
        let r = run(seed, &profile, &p, std::slice::from_ref(&c));
        let runs = profile
            .iter()
            .enumerate()
            .filter(|(i, iv)| {
                iv.production_kwh > iv.consumption_kwh
                    && (*i == 0 || profile[i - 1].production_kwh <= profile[i - 1].consumption_kwh)
            })
            .count() as f64;
        let eta = (b.ac_round_trip_efficiency_pct / 100.0).sqrt();
        let t = &p.tariff;
        let result = &r.candidates[0];
        for y in &result.years {
            let e = &y.energy;
            let context = format!("seed {seed}, jaar {}", y.year);
            // Beginlading plus per overschotreeks hoogstens één volle accu erbij.
            assert!(
                e.battery_to_load_kwh <= 0.01 * (runs + 1.0) + 1e-9,
                "{context}: {} kWh ontladen bij {runs} overschotreeksen",
                e.battery_to_load_kwh
            );
            assert!(
                e.battery_charge_kwh <= 0.01 * runs / eta + 1e-9,
                "{context}: {} kWh geladen bij {runs} overschotreeksen",
                e.battery_charge_kwh
            );
            let base_import = y.baseline_grid_import_kwh.unwrap();
            let base_export = y.baseline_grid_export_kwh.unwrap();
            let less_import = base_import - e.grid_import_kwh;
            let less_export = base_export - e.grid_export_kwh;
            assert_near!(less_import, e.battery_to_load_kwh, base_import, "{context}");
            assert_near!(less_export, e.battery_charge_kwh, base_export, "{context}");
            // De rekening is per kWh begrensd door de tarieven (ook met salderen).
            let price_factor = (1.0 + t.annual_price_change_pct / 100.0).powi(y.year as i32 - 1);
            let bound = ((less_import + less_export)
                * (t.import_eur_per_kwh.abs() + t.export_eur_per_kwh.abs())
                + less_export * t.export_fee_eur_per_kwh)
                * price_factor;
            assert!(
                y.energy_saving_eur.abs() <= bound + 1e-9,
                "{context}: besparing € {} boven grens € {bound}",
                y.energy_saving_eur
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 4. en 5. NPV, nettowinst en break-eveninvestering
// ---------------------------------------------------------------------------------------------

#[test]
fn without_discounting_the_npv_equals_the_net_profit() {
    for seed in seeds(5, 10) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let mut p = parameters(&mut rng);
        p.discount_pct = 0.0;
        let count = rng.int(1, 3);
        let cs = candidates(&mut rng, p.horizon_years, count);
        let r = run(seed, &profile, &p, &cs);
        for c in &r.candidates {
            let scale = c.initial_investment_eur + c.lifetime_energy_saving_eur.abs();
            let ctx = format!("seed {seed}, {}", c.key);
            assert_near!(c.npv_eur, c.net_profit_eur, scale, "{ctx}");
            assert_near!(
                c.pessimistic.npv_eur,
                c.pessimistic.net_profit_eur,
                scale,
                "{ctx}"
            );
            assert_near!(
                c.optimistic.npv_eur,
                c.optimistic.net_profit_eur,
                scale,
                "{ctx}"
            );
            for v in [&c.export_variant, &c.warranty_stress]
                .into_iter()
                .flatten()
            {
                assert_near!(v.npv_eur, v.net_profit_eur, scale, "{ctx} variant");
            }
            // Nettowinst is de som van de jaarlijkse kasstromen na de eigen inbreng op tijdstip
            // nul (de startinvestering min het geleende deel).
            let own = c.initial_investment_eur - cs_by_key(&cs, &c.key).financing.loan_amount_eur;
            let sum: f64 = c.years.iter().map(|y| y.net_cashflow_eur).sum();
            assert_near!(c.net_profit_eur, sum - own, scale, "{ctx}: kasstromen");
        }
    }
}

fn cs_by_key<'a>(cs: &'a [Candidate], key: &str) -> &'a Candidate {
    cs.iter().find(|c| c.key == key).unwrap()
}

/// Definitie (`CandidateResult::break_even_investment_eur`): huidige netto startinvestering plus
/// NPV. Ook inhoudelijk: met de accuprijs zo aangepast dat de startinvestering gelijk is aan dat
/// bedrag, wordt de NPV nul (op afronding naar centen na). Voorwaarde voor die tweede controle:
/// de aangepaste accuprijs is niet negatief en de startinvestering blijft minstens de lening,
/// anders is de invoer ongeldig.
#[test]
fn break_even_investment_is_the_investment_plus_npv_and_gives_zero_npv() {
    let mut rerun = 0;
    let all = seeds(6, 16);
    for &seed in &all {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let p = parameters(&mut rng);
        let count = rng.int(1, 3);
        let cs = candidates(&mut rng, p.horizon_years, count);
        let r = run(seed, &profile, &p, &cs);
        for c in &r.candidates {
            let ctx = format!("seed {seed}, {}", c.key);
            let scale = c.initial_investment_eur + c.npv_eur.abs();
            assert_near!(
                c.break_even_investment_eur,
                c.initial_investment_eur + c.npv_eur,
                scale,
                "{ctx}"
            );
            for v in [&c.export_variant, &c.warranty_stress]
                .into_iter()
                .flatten()
            {
                assert_near!(
                    v.break_even_investment_eur,
                    c.initial_investment_eur + v.npv_eur,
                    scale,
                    "{ctx} variant"
                );
            }
            let mut changed = cs_by_key(&cs, &c.key).clone();
            let line = changed
                .costs
                .iter_mut()
                .find(|l| l.category == "battery")
                .unwrap();
            let delta = (c.npv_eur * 100.0).round() as i64;
            line.amount_minor += delta;
            let new_upfront = c.initial_investment_eur + delta as f64 / 100.0;
            if line.amount_minor < 0 || new_upfront < changed.financing.loan_amount_eur {
                continue;
            }
            changed.warranty_stress = None;
            let again = run(seed, &profile, &p, std::slice::from_ref(&changed));
            let a = &again.candidates[0];
            // Kostenposten zijn hele centen, dus hoogstens een halve cent afrondingsverschil.
            assert!(
                (a.initial_investment_eur - c.break_even_investment_eur).abs() <= 0.006,
                "{ctx}: startinvestering {} na aanpassing ≠ {}",
                a.initial_investment_eur,
                c.break_even_investment_eur
            );
            assert!(
                a.npv_eur.abs() <= 0.006,
                "{ctx}: NPV {} bij de break-eveninvestering",
                a.npv_eur
            );
            rerun += 1;
        }
    }
    // Vaak ligt de break-eveninvestering onder de overige startkosten of de lening (de optie
    // kost zelfs met een gratis accu geld); die gevallen vallen buiten de tweede controle. Met
    // één vaste startwaarde (`INVARIANT_SEED`) kan het er nul zijn.
    assert!(
        rerun >= 4 || all.len() == 1,
        "te weinig gevallen nagerekend: {rerun}"
    );
}

// ---------------------------------------------------------------------------------------------
// 6. Tarieven schalen
// ---------------------------------------------------------------------------------------------

/// Alle geldbedragen in het tarief (prijzen per kWh, terugleverkosten, staffelbedragen, vast
/// bedrag en de terugleveringsvariant) maal k > 0: de energiebesparing schaalt met k. Er is geen
/// voorwaarde nodig: het vaste bedrag valt weg in het verschil en de prijsstress is relatief.
/// Staffelgrenzen zijn kWh en blijven gelijk; procentuele prijsstijging ook.
/// Elk kantelpunt geeft, ingevuld met al het andere gelijk, een NPV van nul: de NPV is lineair in
/// het afnametarief, de terugleververgoeding en (bij vaste kosten) in de besparing.
#[test]
fn tipping_points_give_zero_npv_when_filled_in() {
    let mut checked = 0;
    for seed in seeds(9, 12) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let p = parameters(&mut rng);
        let count = rng.int(1, 3);
        let cs = candidates(&mut rng, p.horizon_years, count);
        let r = run(seed, &profile, &p, &cs);
        for c in &r.candidates {
            let ctx = format!("seed {seed}, {}", c.key);
            let t = c.tipping_points.as_ref().expect("kantelpunten");
            let scale =
                c.initial_investment_eur + c.lifetime_energy_saving_eur.abs() + c.npv_eur.abs();
            let input = cs_by_key(&cs, &c.key);
            for (value, set) in [
                (
                    t.import_eur_per_kwh,
                    (|p: &mut Parameters, v| p.tariff.import_eur_per_kwh = v)
                        as fn(&mut Parameters, f64),
                ),
                (t.export_eur_per_kwh, |p: &mut Parameters, v| {
                    p.tariff.export_eur_per_kwh = v
                }),
            ] {
                // Buiten het geldige bereik (|€ 10| per kWh) valt niets na te rekenen.
                let Some(value) = value.filter(|v| v.abs() < 10.0) else {
                    continue;
                };
                let mut q = p.clone();
                set(&mut q, value);
                q.budget_eur = None;
                let again = run(seed, &profile, &q, std::slice::from_ref(input));
                assert_near!(
                    again.candidates[0].npv_eur,
                    0.0,
                    scale,
                    "{ctx}: NPV bij het kantelpunt"
                );
                checked += 1;
            }
            if let Some(share) = t.saving_share {
                let discount = 1.0 + p.discount_pct / 100.0;
                let savings: f64 = c
                    .years
                    .iter()
                    .map(|y| y.energy_saving_eur / discount.powi(y.year as i32))
                    .sum();
                assert_near!(
                    c.npv_eur + (share - 1.0) * savings,
                    0.0,
                    scale,
                    "{ctx}: besparingsdeel"
                );
            }
        }
    }
    assert!(checked >= 8, "te weinig kantelpunten nagerekend: {checked}");
}

#[test]
fn scaling_all_tariff_amounts_scales_the_energy_savings() {
    for seed in seeds(7, 10) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let p = parameters(&mut rng);
        let count = rng.int(1, 3);
        let cs = candidates(&mut rng, p.horizon_years, count);
        let k = rng.range(0.2, 3.0);
        let mut q = p.clone();
        let t = &mut q.tariff;
        t.import_eur_per_kwh *= k;
        t.export_eur_per_kwh *= k;
        t.export_fee_eur_per_kwh *= k;
        t.fixed_annual_eur *= k;
        for band in &mut t.export_fee_bands {
            band.annual_eur *= k;
        }
        if let Some(v) = &mut q.export_variant {
            v.export_eur_per_kwh *= k;
            v.export_fee_eur_per_kwh *= k;
        }
        let a = run(seed, &profile, &p, &cs);
        let b = run(seed, &profile, &q, &cs);
        for (x, y) in a.candidates.iter().zip(&b.candidates) {
            let ctx = format!("seed {seed}, {}, k = {k}", x.key);
            let scale = x
                .years
                .iter()
                .map(|y| y.baseline_bill_eur.abs())
                .sum::<f64>();
            assert_near!(
                y.lifetime_energy_saving_eur,
                k * x.lifetime_energy_saving_eur,
                k * scale,
                "{ctx}"
            );
            for (u, v) in x.years.iter().zip(&y.years) {
                assert_eq!(
                    u.energy.grid_import_kwh, v.energy.grid_import_kwh,
                    "{ctx}: tarief verandert de energiestromen"
                );
                assert_near!(
                    v.energy_saving_eur,
                    k * u.energy_saving_eur,
                    k * u.baseline_bill_eur,
                    "{ctx}, jaar {}",
                    u.year
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 7. Meer capaciteit, nooit minder eigen gebruik
// ---------------------------------------------------------------------------------------------

/// Zelfde vermogen, rendement, standby, veroudering en levensduur; alleen de capaciteit groeit.
/// Standby hangt niet van de capaciteit af en kost beide accu's hetzelfde, dus is geen
/// voorwaarde. Vervangingen zijn hier uitgesloten zodat alle opties dezelfde leeftijden hebben.
#[test]
fn self_consumption_never_decreases_with_more_capacity() {
    for seed in seeds(8, 10) {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let p = parameters(&mut rng);
        let template = battery(&mut rng);
        let mut capacities: Vec<f64> = (0..rng.int(3, 5)).map(|_| rng.range(0.01, 40.0)).collect();
        capacities.sort_by(f64::total_cmp);
        let cs: Vec<Candidate> = capacities
            .iter()
            .enumerate()
            .map(|(i, &capacity)| {
                let mut c = candidate(
                    &mut rng,
                    &format!("c{i}"),
                    p.horizon_years,
                    Battery {
                        usable_capacity_kwh: capacity,
                        ..template.clone()
                    },
                );
                c.costs = costs(&[("battery", CostTiming::Upfront, None, 100_000)]);
                c.financing = Financing::default();
                c.warranty_stress = None;
                c
            })
            .collect();
        let r = run(seed, &profile, &p, &cs);
        for pair in r.candidates.windows(2) {
            let (small, large) = (&pair[0], &pair[1]);
            for (s, l) in small.years.iter().zip(&large.years) {
                let ctx = format!(
                    "seed {seed}, jaar {}: {} kWh → {} kWh",
                    s.year,
                    cs_by_key(&cs, &small.key).battery.usable_capacity_kwh,
                    cs_by_key(&cs, &large.key).battery.usable_capacity_kwh
                );
                assert!(
                    l.energy.self_consumption_pct >= s.energy.self_consumption_pct - 1e-9,
                    "{ctx}: eigen gebruik {} % < {} %",
                    l.energy.self_consumption_pct,
                    s.energy.self_consumption_pct
                );
                assert!(
                    l.energy.battery_to_load_kwh >= s.energy.battery_to_load_kwh - 1e-9,
                    "{ctx}: ontladen {} < {}",
                    l.energy.battery_to_load_kwh,
                    s.energy.battery_to_load_kwh
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 8. Volgorde van de opties
// ---------------------------------------------------------------------------------------------

/// Doelscore zoals de keuze die beschrijft; `None` is de optie buiten het budget.
fn score(objective: Objective, npv: f64, roi: Option<f64>, payback: Option<u32>, sc: f64) -> f64 {
    match objective {
        Objective::NetPresentValue => npv,
        Objective::Roi if npv >= 0.0 => roi.unwrap_or(if npv > 0.0 {
            f64::INFINITY
        } else {
            f64::NEG_INFINITY
        }),
        Objective::Roi => f64::NEG_INFINITY,
        Objective::Payback if npv >= 0.0 => payback.map_or(f64::NEG_INFINITY, |v| -(v as f64)),
        Objective::Payback => f64::NEG_INFINITY,
        Objective::SelfConsumption => sc,
    }
}

/// Is de beste optie (inclusief ‘geen accu’) duidelijk de beste? Bij de terugverdientijd beslist
/// bij gelijke jaren de NPV, zoals in de keuze.
fn unique_best(objective: Objective, baseline_sc: f64, options: &[(f64, f64)]) -> bool {
    let baseline = match objective {
        Objective::SelfConsumption => baseline_sc,
        Objective::Payback => f64::NEG_INFINITY,
        _ => 0.0,
    };
    let mut all = vec![(baseline, 0.0)];
    all.extend_from_slice(options);
    let best = all.iter().map(|o| o.0).fold(f64::NEG_INFINITY, f64::max);
    if best == f64::NEG_INFINITY {
        return true;
    }
    let top: Vec<_> = all
        .iter()
        .filter(|o| o.0 == best || (o.0 - best).abs() <= 1e-6)
        .collect();
    match (objective, top.len()) {
        (_, 1) => true,
        (Objective::Payback, _) => {
            let npv = top.iter().map(|o| o.1).fold(f64::NEG_INFINITY, f64::max);
            top.iter().filter(|o| (o.1 - npv).abs() <= 1e-6).count() == 1
        }
        _ => false,
    }
}

fn base_options(r: &AnalysisResult, objective: Objective) -> Vec<(f64, f64)> {
    let pick = |c: &CandidateResult| {
        (
            score(
                objective,
                c.npv_eur,
                c.roi_pct,
                c.payback_years,
                c.first_year.self_consumption_pct,
            ),
            c.npv_eur,
        )
    };
    r.candidates
        .iter()
        .filter(|c| c.within_budget)
        .map(pick)
        .collect()
}

fn variant_options(r: &AnalysisResult, objective: Objective) -> Vec<(f64, f64)> {
    r.candidates
        .iter()
        .filter(|c| c.within_budget)
        .filter_map(|c| {
            c.export_variant.as_ref().map(|v| {
                (
                    score(
                        objective,
                        v.npv_eur,
                        v.roi_pct,
                        v.payback_years,
                        c.first_year.self_consumption_pct,
                    ),
                    v.npv_eur,
                )
            })
        })
        .collect()
}

/// Voorwaarde: de beste score is uniek (marge 10⁻⁶). Bij precies gelijke scores wint de eerste
/// optie in de lijst; dat is volgordeafhankelijk, zie de genegeerde test hieronder.
#[test]
fn the_recommendation_does_not_depend_on_candidate_order() {
    let all = seeds(9, 14);
    let mut checked = 0;
    for &seed in &all {
        let mut rng = Rng::new(seed);
        let shape = ProfileShape::random(&mut rng);
        let profile = profile(&mut rng, shape);
        let p = parameters(&mut rng);
        // Ook goedkope opties, zodat de financiële doelen niet bijna altijd ‘geen accu’ kiezen.
        let cs: Vec<Candidate> = (0..rng.int(2, 5))
            .map(|i| {
                let b = battery(&mut rng);
                let max_price = if rng.chance(0.6) {
                    80_000.0
                } else {
                    1_500_000.0
                };
                candidate_up_to(&mut rng, &format!("c{i}"), p.horizon_years, b, max_price)
            })
            .collect();
        let mut shuffled = cs.clone();
        rng.shuffle(&mut shuffled);
        let a = run(seed, &profile, &p, &cs);
        let sc = a.baseline_first_year.self_consumption_pct;
        if unique_best(p.objective, sc, &base_options(&a, p.objective)) {
            let b = run(seed, &profile, &p, &shuffled);
            assert_eq!(
                a.recommended_key, b.recommended_key,
                "seed {seed}: doel {:?}, andere volgorde geeft een andere aanbeveling",
                p.objective
            );
            if unique_best(p.objective, sc, &variant_options(&a, p.objective)) {
                assert_eq!(
                    a.export_variant_recommended_key, b.export_variant_recommended_key,
                    "seed {seed}: terugleveringsvariant"
                );
            }
            // De uitkomst per optie hangt evenmin van de volgorde af.
            for x in &a.candidates {
                let y = b.candidates.iter().find(|y| y.key == x.key).unwrap();
                assert_eq!(x.npv_eur, y.npv_eur, "seed {seed}, {}", x.key);
            }
            checked += 1;
        }
    }
    assert!(
        checked >= all.len() / 2,
        "te weinig unieke gevallen: {checked}"
    );
}

/// Gevonden met de volgorde-eigenschap: bij het doel eigen gebruik krijgen twee accu's die nooit
/// vol of leeg raken (hier 200 en 300 kWh bij 2 kW, met weinig opwek) precies hetzelfde eigen
/// gebruik. Tot modelversie 8 won dan de eerste in de lijst, ook als de andere goedkoper was; nu
/// beslist de hoogste NPV, net als bij de terugverdientijd.
#[test]
fn self_consumption_ties_do_not_depend_on_candidate_order() {
    let profile: Vec<EnergyInterval> = (0..8760)
        .map(|i| EnergyInterval {
            duration_hours: 1.0,
            production_kwh: if i % 24 == 12 { 1.0 } else { 0.0 },
            consumption_kwh: if i % 24 == 20 { 1.0 } else { 0.1 },
            ..Default::default()
        })
        .collect();
    let mut p = parameters(&mut Rng::new(0));
    p.objective = Objective::SelfConsumption;
    p.budget_eur = None;
    let option = |key: &str, capacity: f64, price: i64| {
        let mut c = candidate(
            &mut Rng::new(1),
            key,
            p.horizon_years,
            Battery {
                usable_capacity_kwh: capacity,
                charge_power_kw: 2.0,
                discharge_power_kw: 2.0,
                ac_round_trip_efficiency_pct: 90.0,
                standby_w: 0.0,
                annual_capacity_loss_pct: 0.0,
                operating_life_years: 15,
            },
        );
        c.costs = costs(&[("battery", CostTiming::Upfront, None, price)]);
        c.financing = Financing::default();
        c.warranty_stress = None;
        c
    };
    let expensive = option("expensive", 300.0, 3_000_000);
    let cheap = option("cheap", 200.0, 200_000);
    let a = run(0, &profile, &p, &[expensive.clone(), cheap.clone()]);
    let b = run(0, &profile, &p, &[cheap, expensive]);
    assert_eq!(
        a.candidates[0].first_year.self_consumption_pct,
        a.candidates[1].first_year.self_consumption_pct,
        "voorwaarde: gelijk eigen gebruik"
    );
    assert_eq!(a.recommended_key, b.recommended_key);
    assert_eq!(a.recommended_key, "cheap");
}
