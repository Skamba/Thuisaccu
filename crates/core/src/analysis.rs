//! Transparante scenariovergelijking, inclusief de keuze om geen accu te kopen.
use crate::{
    finance::{self, CostLine, CostStatus, CostTiming, Financing, Tariff},
    sizing::{self, Battery, EnergyInterval, EnergyYear, LoadVariation},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct AnalysisError(pub String);

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Objective {
    NetPresentValue,
    Roi,
    Payback,
    SelfConsumption,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Parameters {
    pub start_year: u32,
    pub horizon_years: u32,
    pub discount_pct: f64,
    pub annual_cost_escalation_pct: f64,
    pub annual_pv_loss_pct: f64,
    pub annual_load_growth_pct: f64,
    pub objective: Objective,
    pub budget_eur: Option<f64>,
    pub tariff: Tariff,
    pub price_uncertainty_pct: f64,
    pub cost_uncertainty_pct: f64,
    /// Optionele tweede doorrekening met een lagere waarde voor teruglevering.
    /// Ontbreekt in runs van vóór deze uitbreiding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_variant: Option<ExportVariant>,
    /// Verloop van het verbruik binnen een meetperiode. Ontbreekt in runs van vóór
    /// modelversie 2 en is dan gelijkmatig.
    #[serde(default)]
    pub load_variation: LoadVariation,
}

/// Alternatieve terugleverprijzen vanaf een kalenderjaar, bijvoorbeeld wanneer het
/// wettelijke minimum voor de terugleververgoeding vervalt. Alleen deze twee
/// tariefdelen wijzigen; al het andere blijft gelijk aan de basis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportVariant {
    pub label: String,
    pub from_calendar_year: u32,
    pub export_eur_per_kwh: f64,
    pub export_fee_eur_per_kwh: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub key: String,
    pub name: String,
    pub configuration_id: Option<i64>,
    pub battery: Battery,
    pub costs: Vec<CostLine>,
    pub financing: Financing,
    pub assumptions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearResult {
    pub year: u32,
    pub calendar_year: u32,
    pub energy: EnergyYear,
    pub baseline_bill_eur: f64,
    pub battery_bill_eur: f64,
    pub energy_saving_eur: f64,
    pub extra_costs_eur: f64,
    pub financing_interest_eur: f64,
    /// Aflossing van de lening in dit jaar; vanaf modelversie 5 onderdeel van het netto
    /// voordeel, omdat het geleende deel van de investering niet op tijdstip nul wordt betaald.
    #[serde(default)]
    pub financing_principal_eur: f64,
    pub net_cashflow_eur: f64,
    pub cumulative_eur: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantResult {
    pub npv_eur: f64,
    pub net_profit_eur: f64,
    pub roi_pct: Option<f64>,
}

/// Uitkomst van de terugleveringsvariant, zonder prijs- en kostenstress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportVariantResult {
    pub npv_eur: f64,
    pub net_profit_eur: f64,
    pub roi_pct: Option<f64>,
    pub payback_years: Option<u32>,
    /// Zie [`CandidateResult::break_even_investment_eur`], binnen deze variant.
    #[serde(default)]
    pub break_even_investment_eur: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateResult {
    pub key: String,
    pub name: String,
    pub initial_investment_eur: f64,
    pub lifetime_extra_costs_eur: f64,
    pub lifetime_energy_saving_eur: f64,
    pub npv_eur: f64,
    pub net_profit_eur: f64,
    pub roi_pct: Option<f64>,
    pub payback_years: Option<u32>,
    pub discounted_payback_years: Option<u32>,
    /// Hoogste netto startinvestering waarbij de NPV nog niet negatief is, met alle andere
    /// kosten, de lening en de energiestromen gelijk: de huidige startinvestering plus de NPV.
    /// Negatief als de optie zelfs gratis geld kost. Ontbreekt in runs van vóór deze uitkomst.
    #[serde(default)]
    pub break_even_investment_eur: f64,
    pub first_year: EnergyYear,
    pub years: Vec<YearResult>,
    pub pessimistic: VariantResult,
    pub optimistic: VariantResult,
    pub within_budget: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_variant: Option<ExportVariantResult>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub model_version: String,
    pub recommended_key: String,
    pub recommendation: String,
    pub baseline_first_year: EnergyYear,
    pub candidates: Vec<CandidateResult>,
    pub warnings: Vec<String>,
    /// Beste optie volgens hetzelfde doel, maar binnen de terugleveringsvariant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_variant_recommended_key: Option<String>,
}

fn ensure(condition: bool, message: &str) -> Result<(), AnalysisError> {
    if condition {
        Ok(())
    } else {
        Err(AnalysisError(message.into()))
    }
}

/// Bedrag met vier decimalen en een decimale komma, zoals in de interface.
fn euro(value: f64) -> String {
    format!("{value:.4}").replace('.', ",")
}

fn bounded(value: f64, low: f64, high: f64) -> bool {
    value.is_finite() && value >= low && value <= high
}

pub fn validate(
    profile: &[EnergyInterval],
    p: &Parameters,
    candidates: &[Candidate],
) -> Result<(), AnalysisError> {
    ensure(
        !profile.is_empty() && profile.len() <= 110_000,
        "Gebruik één volledig meetjaar met hoogstens 110.000 intervallen.",
    )?;
    let mut hours = 0.0;
    for i in profile {
        ensure(
            bounded(i.duration_hours, 1.0 / 60.0, 1.0),
            "Voor ROI zijn aaneengesloten uur-, kwartier- of fijnere waarden nodig; dagtotalen zijn onvoldoende.",
        )?;
        ensure(
            bounded(i.production_kwh, 0.0, 1e6) && bounded(i.consumption_kwh, 0.0, 1e6),
            "Ongeldige opwek of bruto huishoudelijk verbruik.",
        )?;
        ensure(
            i.steady_consumption_kwh
                .is_none_or(|v| bounded(v, 0.0, i.consumption_kwh)),
            "Het gelijkmatige deel van het verbruik moet tussen nul en het totale verbruik liggen.",
        )?;
        ensure(
            match (i.measured_import_kwh, i.measured_export_kwh) {
                (Some(imported), Some(exported)) => {
                    bounded(imported, 0.0, 1e6) && bounded(exported, 0.0, 1e6)
                }
                (None, None) => true,
                _ => false,
            },
            "Gemeten netafname en teruglevering moeten samen en niet-negatief zijn.",
        )?;
        hours += i.duration_hours;
    }
    ensure(
        (hours - 8760.0).abs() < 0.01 || (hours - 8784.0).abs() < 0.01,
        "Gebruik een volledig jaar van 365 of 366 dagen. Korte meetreeksen worden niet automatisch naar een jaar opgeschaald.",
    )?;
    ensure(
        (2026..=2100).contains(&p.start_year) && (1..=30).contains(&p.horizon_years),
        "Kies een startjaar vanaf 2026 en een horizon van 1 tot 30 jaar.",
    )?;
    ensure(
        bounded(p.discount_pct, 0.0, 30.0)
            && bounded(p.annual_cost_escalation_pct, -20.0, 30.0)
            && bounded(p.annual_pv_loss_pct, 0.0, 10.0)
            && bounded(p.annual_load_growth_pct, -20.0, 30.0),
        "Ongeldige langetermijnaannames.",
    )?;
    ensure(
        bounded(p.price_uncertainty_pct, 0.0, 80.0) && bounded(p.cost_uncertainty_pct, 0.0, 80.0),
        "Onzekerheidsvarianten moeten tussen 0 en 80% liggen.",
    )?;
    ensure(
        p.budget_eur.is_none_or(|v| bounded(v, 0.0, 1e9)),
        "Ongeldig budget.",
    )?;
    let t = &p.tariff;
    ensure(
        bounded(t.import_eur_per_kwh, -10.0, 10.0)
            && bounded(t.export_eur_per_kwh, -10.0, 10.0)
            && bounded(t.export_fee_eur_per_kwh, 0.0, 10.0)
            && bounded(t.fixed_annual_eur, 0.0, 1e6)
            && bounded(t.annual_price_change_pct, -20.0, 30.0),
        "Ongeldige all-in tarieven.",
    )?;
    if let Some(v) = &p.export_variant {
        ensure(
            !v.label.trim().is_empty() && v.label.chars().count() <= 200,
            "Geef de terugleveringsvariant een korte omschrijving.",
        )?;
        ensure(
            (p.start_year..=2100).contains(&v.from_calendar_year)
                && bounded(v.export_eur_per_kwh, -10.0, 10.0)
                && bounded(v.export_fee_eur_per_kwh, 0.0, 10.0),
            "Ongeldige terugleveringsvariant; het beginjaar ligt op of na het startjaar.",
        )?;
    }
    let mut previous = -1.0;
    for (index, band) in t.export_fee_bands.iter().enumerate() {
        ensure(
            bounded(band.annual_eur, 0.0, 1e6),
            "Ongeldige terugleverkostenstaffel.",
        )?;
        if let Some(limit) = band.up_to_kwh {
            ensure(
                bounded(limit, 0.0, 1e9) && limit > previous,
                "Staffelgrenzen moeten oplopen.",
            )?;
            previous = limit;
        } else {
            ensure(
                index + 1 == t.export_fee_bands.len(),
                "Alleen de laatste staffel mag onbegrensd zijn.",
            )?;
        }
    }
    ensure(
        t.export_fee_bands.is_empty()
            || t.export_fee_bands
                .last()
                .is_some_and(|b| b.up_to_kwh.is_none()),
        "Sluit de terugleverkostenstaffel af met een onbegrensde laatste regel.",
    )?;
    ensure(
        (1..=50).contains(&candidates.len()),
        "Vergelijk 1 tot 50 accu-opties.",
    )?;
    let mut keys = std::collections::HashSet::new();
    for c in candidates {
        ensure(
            !c.key.is_empty() && c.key != "no_battery" && keys.insert(&c.key),
            "Accu-opties moeten unieke sleutels hebben.",
        )?;
        ensure(
            !c.name.trim().is_empty() && !c.assumptions.trim().is_empty(),
            "Vul de naam en herkomst/aannames van iedere accu-optie in.",
        )?;
        let b = &c.battery;
        ensure(
            bounded(b.usable_capacity_kwh, 0.01, 1000.0)
                && bounded(b.charge_power_kw, 0.01, 1000.0)
                && bounded(b.discharge_power_kw, 0.01, 1000.0)
                && bounded(b.ac_round_trip_efficiency_pct, 1.0, 100.0)
                && bounded(b.standby_w, 0.0, 10000.0)
                && bounded(b.annual_capacity_loss_pct, 0.0, 20.0)
                && (1..=30).contains(&b.operating_life_years),
            "Vul capaciteit, werkelijk AC-vermogen, systeemrendement en levensduuraannames geldig in.",
        )?;
        let mut categories = std::collections::HashSet::new();
        for line in &c.costs {
            ensure(
                finance::COST_CATEGORIES.contains(&line.category.as_str())
                    && categories.insert(line.category.as_str()),
                "Onbekende of dubbele kostencategorie.",
            )?;
            ensure(
                line.status != CostStatus::Unknown,
                &format!(
                    "Kostenpost {} is nog onbekend bij {}.",
                    line.category, c.name
                ),
            )?;
            ensure(
                (0..=100_000_000_000).contains(&line.amount_minor),
                "Kosten moeten niet-negatieve eurocenten zijn.",
            )?;
            ensure(
                line.status == CostStatus::Priced || line.amount_minor == 0,
                "Inbegrepen/niet-toepasselijke posten mogen geen extra bedrag bevatten.",
            )?;
            ensure(
                !line.source.trim().is_empty(),
                "Geef per kostenpost een bron of expliciete aanname.",
            )?;
            ensure(
                match line.timing {
                    CostTiming::Event => {
                        line.status != CostStatus::Priced
                            || line.year.is_some_and(|y| y >= 1 && y <= p.horizon_years)
                    }
                    _ => line.year.is_none(),
                },
                "Eenmalige toekomstige posten vereisen een jaar binnen de horizon.",
            )?;
            if line.category == "battery_replacement" && line.status == CostStatus::Priced {
                ensure(
                    line.timing == CostTiming::Event,
                    "Accuvervanging moet als gebeurtenis met jaartal worden ingevoerd.",
                )?;
            }
        }
        ensure(
            categories.len() == finance::COST_CATEGORIES.len(),
            "Beoordeel alle kostenposten, ook inbegrepen of niet-toepasselijke posten.",
        )?;
        let f = &c.financing;
        ensure(
            bounded(f.loan_amount_eur, 0.0, 1e9)
                && bounded(f.annual_interest_pct, 0.0, 30.0)
                && (f.loan_amount_eur == 0.0 || (f.years >= 1 && f.years <= p.horizon_years)),
            "Ongeldige financiering; de looptijd moet binnen de analysehorizon vallen.",
        )?;
        let upfront: f64 = c
            .costs
            .iter()
            .filter(|line| line.timing == CostTiming::Upfront)
            .map(|l| finance::cost_eur(l, 1.0))
            .sum();
        ensure(
            upfront >= 0.0 && f.loan_amount_eur <= upfront,
            "Teruggaven mogen de startinvestering niet overschrijden; de lening mag niet hoger zijn dan die investering.",
        )?;
    }
    Ok(())
}

/// Leeftijd van de accu in ieder projectiejaar. Een accuvervanging aan het einde van een jaar
/// laat het volgende jaar weer op nul beginnen.
fn battery_ages(c: &Candidate, horizon_years: u32) -> Vec<u32> {
    let replaced = |year| {
        c.costs.iter().any(|l| {
            l.category == "battery_replacement"
                && l.status == CostStatus::Priced
                && l.year == Some(year)
        })
    };
    let mut age = 0;
    (1..=horizon_years)
        .map(|year| {
            let current = age;
            age = if replaced(year) { 0 } else { age + 1 };
            current
        })
        .collect()
}

/// Aaneengesloten jaren als "3" of "11–15", gescheiden door komma's.
fn year_ranges(years: &[u32]) -> String {
    let mut ranges: Vec<(u32, u32)> = Vec::new();
    for &year in years {
        match ranges.last_mut() {
            Some((_, end)) if *end + 1 == year => *end = year,
            _ => ranges.push((year, year)),
        }
    }
    ranges
        .iter()
        .map(|&(start, end)| {
            if start == end {
                start.to_string()
            } else {
                format!("{start}–{end}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn project(
    profile: &[EnergyInterval],
    p: &Parameters,
    c: &Candidate,
    stress: i32,
    variant: Option<&ExportVariant>,
) -> CandidateResult {
    let price_shift = stress as f64 * p.price_uncertainty_pct / 100.0;
    let cost_factor = 1.0 - stress as f64 * p.cost_uncertainty_pct / 100.0;
    let mut tariff = p.tariff.clone();
    tariff.import_eur_per_kwh += tariff.import_eur_per_kwh.abs() * price_shift;
    tariff.export_eur_per_kwh -= tariff.export_eur_per_kwh.abs() * price_shift;
    // Een lagere vergoeding verhoogt de waarde van minder terugleveren.
    let mut varied = tariff.clone();
    if let Some(v) = variant {
        varied.export_eur_per_kwh = v.export_eur_per_kwh;
        varied.export_fee_eur_per_kwh = v.export_fee_eur_per_kwh;
    }
    let scaled = |l: &CostLine| {
        if finance::is_credit(&l.category) {
            finance::cost_eur(l, 1.0)
        } else {
            finance::cost_eur(l, cost_factor)
        }
    };
    let upfront: f64 = c
        .costs
        .iter()
        .filter(|l| l.timing == CostTiming::Upfront)
        .map(scaled)
        .sum();
    // Het geleende deel betaal je niet op tijdstip nul maar via de aflossingen; zo telt de
    // discontovoet de lening niet dubbel naast de rente.
    let mut cashflows = vec![-upfront + c.financing.loan_amount_eur];
    let mut years = Vec::new();
    let mut total_costs = upfront;
    let mut total_savings = 0.0;
    let mut state = 0.0;
    let ages = battery_ages(c, p.horizon_years);
    for year in 1..=p.horizon_years {
        let pv_factor = (1.0 - p.annual_pv_loss_pct / 100.0).powi((year - 1) as i32);
        let load_factor = (1.0 + p.annual_load_growth_pct / 100.0).powi((year - 1) as i32);
        let baseline = sizing::simulate_year(
            profile,
            None,
            0,
            pv_factor,
            load_factor,
            0.0,
            p.load_variation,
        );
        let energy = sizing::simulate_year(
            profile,
            Some(&c.battery),
            ages[(year - 1) as usize],
            pv_factor,
            load_factor,
            state,
            p.load_variation,
        );
        state = energy.end_storage_kwh;
        let price_factor = (1.0 + p.tariff.annual_price_change_pct / 100.0).powi((year - 1) as i32);
        let calendar_year = p.start_year + year - 1;
        let tariff = match variant {
            Some(v) if calendar_year >= v.from_calendar_year => &varied,
            _ => &tariff,
        };
        let baseline_bill = finance::energy_bill(
            baseline.grid_import_kwh,
            baseline.grid_export_kwh,
            tariff,
            calendar_year,
            price_factor,
        );
        let battery_bill = finance::energy_bill(
            energy.grid_import_kwh,
            energy.grid_export_kwh,
            tariff,
            calendar_year,
            price_factor,
        );
        let saving = baseline_bill - battery_bill;
        let annual_factor = (1.0 + p.annual_cost_escalation_pct / 100.0).powi((year - 1) as i32);
        let costs: f64 = c
            .costs
            .iter()
            .map(|l| match l.timing {
                CostTiming::Annual => scaled(l) * annual_factor,
                CostTiming::Event if l.year == Some(year) => scaled(l),
                _ => 0.0,
            })
            .sum();
        let interest = finance::annual_interest(&c.financing, year);
        let principal = finance::annual_principal(&c.financing, year);
        total_costs += costs + interest;
        total_savings += saving;
        cashflows.push(saving - costs - interest - principal);
        let cumulative = cashflows.iter().sum();
        years.push(YearResult {
            year,
            calendar_year,
            energy,
            baseline_bill_eur: baseline_bill,
            battery_bill_eur: battery_bill,
            energy_saving_eur: saving,
            extra_costs_eur: costs,
            financing_interest_eur: interest,
            financing_principal_eur: principal,
            net_cashflow_eur: saving - costs - interest - principal,
            cumulative_eur: cumulative,
        });
        if ages.get(year as usize) == Some(&0) {
            // Restlading van de oude accu levert geen opbrengst in de nieuwe accu op.
            state = 0.0;
        }
    }
    let profit: f64 = cashflows.iter().sum();
    let npv: f64 = cashflows
        .iter()
        .enumerate()
        .map(|(y, v)| v / (1.0 + p.discount_pct / 100.0).powi(y as i32))
        .sum();
    let roi = (upfront > 0.0).then_some(profit / upfront * 100.0);
    let variant = VariantResult {
        npv_eur: npv,
        net_profit_eur: profit,
        roi_pct: roi,
    };
    CandidateResult {
        key: c.key.clone(),
        name: c.name.clone(),
        initial_investment_eur: upfront,
        lifetime_extra_costs_eur: total_costs,
        lifetime_energy_saving_eur: total_savings,
        npv_eur: npv,
        net_profit_eur: profit,
        roi_pct: roi,
        payback_years: finance::stable_payback(&cashflows, 0.0),
        discounted_payback_years: finance::stable_payback(&cashflows, p.discount_pct),
        // De NPV hangt lineair af van de startinvestering (factor 1 op tijdstip nul); in de
        // kostenvarianten niet, daar schaalt `cost_factor` de investering mee.
        break_even_investment_eur: upfront + npv,
        first_year: years[0].energy.clone(),
        years,
        pessimistic: variant.clone(),
        optimistic: variant,
        within_budget: p.budget_eur.is_none_or(|budget| upfront <= budget),
        export_variant: None,
    }
}

/// Kiest de beste optie volgens het doel; "geen accu" wint bij gelijkspel.
fn choose<'a>(
    objective: Objective,
    baseline_self_consumption_pct: f64,
    options: impl Iterator<Item = (&'a CandidateResult, f64, Option<f64>, Option<u32>)>,
) -> String {
    let mut best_key = "no_battery".to_owned();
    let mut best_score = match objective {
        Objective::SelfConsumption => baseline_self_consumption_pct,
        Objective::Payback => f64::NEG_INFINITY,
        _ => 0.0,
    };
    for (r, npv, roi, payback) in options {
        if !r.within_budget {
            continue;
        }
        let score = match objective {
            Objective::NetPresentValue => npv,
            // Net als bij de terugverdientijd: geen optie die in geld van nu verlies geeft.
            Objective::Roi if npv >= 0.0 => roi.unwrap_or(f64::NEG_INFINITY),
            Objective::Roi => f64::NEG_INFINITY,
            Objective::Payback => {
                if npv >= 0.0 {
                    payback.map_or(f64::NEG_INFINITY, |v| -(v as f64))
                } else {
                    f64::NEG_INFINITY
                }
            }
            Objective::SelfConsumption => r.first_year.self_consumption_pct,
        };
        if score > best_score + 1e-8 {
            best_score = score;
            best_key = r.key.clone();
        }
    }
    best_key
}

pub fn analyze(
    profile: &[EnergyInterval],
    parameters: &Parameters,
    candidates: &[Candidate],
) -> Result<AnalysisResult, AnalysisError> {
    validate(profile, parameters, candidates)?;
    let mut results = Vec::new();
    for c in candidates {
        let mut base = project(profile, parameters, c, 0, None);
        let low = project(profile, parameters, c, -1, None);
        let high = project(profile, parameters, c, 1, None);
        if let Some(v) = &parameters.export_variant {
            let varied = project(profile, parameters, c, 0, Some(v));
            base.export_variant = Some(ExportVariantResult {
                npv_eur: varied.npv_eur,
                net_profit_eur: varied.net_profit_eur,
                roi_pct: varied.roi_pct,
                payback_years: varied.payback_years,
                break_even_investment_eur: varied.break_even_investment_eur,
            });
        }
        base.pessimistic = VariantResult {
            npv_eur: low.npv_eur,
            net_profit_eur: low.net_profit_eur,
            roi_pct: low.roi_pct,
        };
        base.optimistic = VariantResult {
            npv_eur: high.npv_eur,
            net_profit_eur: high.net_profit_eur,
            roi_pct: high.roi_pct,
        };
        results.push(base);
    }
    let baseline =
        sizing::simulate_year(profile, None, 0, 1.0, 1.0, 0.0, parameters.load_variation);
    let best_key = choose(
        parameters.objective,
        baseline.self_consumption_pct,
        results
            .iter()
            .map(|r| (r, r.npv_eur, r.roi_pct, r.payback_years)),
    );
    let export_variant_recommended_key = parameters.export_variant.as_ref().map(|_| {
        choose(
            parameters.objective,
            baseline.self_consumption_pct,
            results.iter().filter_map(|r| {
                r.export_variant
                    .as_ref()
                    .map(|v| (r, v.npv_eur, v.roi_pct, v.payback_years))
            }),
        )
    });
    let recommendation = if best_key == "no_battery" {
        "Geen accu komt binnen deze aannames en het gekozen doel als beste uit de vergelijking."
            .into()
    } else {
        format!(
            "{} scoort het beste binnen de doorgerekende opties en aannames.",
            results.iter().find(|r| r.key == best_key).unwrap().name
        )
    };
    let mut warnings = vec![
        "Model: zonnestroom opslaan voor eigen gebruik, met vaste ingevoerde all-in tarieven. Geen dynamische handel, onbalansinkomsten of optimale prijsgestuurde aansturing.".into(),
        "Het gemeten jaar wordt ieder projectiejaar hergebruikt met de opgegeven groei/degradatie. Varianten zijn aannamegevoeligheid, geen kansinterval of gegarandeerde opbrengst.".into(),
        "ROI = ongedisconteerde nettowinst over de horizon / netto startinvestering. NPV houdt rekening met de opgegeven discontovoet. Een lening telt als rente en aflossing in het jaar waarin je ze betaalt; alleen het eigen deel van de investering staat op tijdstip nul. ROI deelt door de volledige netto startinvestering. Dit is geen eigenvermogenrendement.".into(),
        "Bedragen zijn inclusief niet-teruggevraagde btw. Geen automatische subsidie of btw-teruggave; voeg alleen een bevestigde teruggave toe. Verliezen en standby zijn al in de energierekening verwerkt.".into(),
        "Een adres bepaalt geen verbruiksprofiel, omvormercompatibiliteit, aansluiting of installatiemaatwerk. De fysieke geschiktheid blijft een apart te bevestigen voorwaarde.".into(),
    ];
    warnings.push(match parameters.load_variation {
        LoadVariation::Households => "Binnen iedere meetperiode van 5 tot 60 minuten volgt het verbruik de gemiddelde verdeling van 74 per seconde gemeten Duitse huishoudens (HTW Berlin, 2010). Korte pieken boven het ontlaadvermogen en wisselingen tussen overschot en tekort binnen het uur tellen zo mee. Opwek is binnen de periode gelijkmatig. De regelvertraging van de accu is niet meegerekend: HTW Berlin mat bij 22 thuisaccusystemen gemiddeld 1 s totdat de accu reageert en 4,5 s totdat het nieuwe vermogen bereikt is (Stromspeicher-Inspektion 2025); in een controle per seconde kostte een vertraging van 2 tot 5 s ongeveer 2 tot 3% van de besparing.".into(),
        LoadVariation::Uniform => "Het verbruik is binnen iedere meetperiode gelijkmatig verondersteld. Bij uur- of kwartierwaarden ontbreken korte pieken, waardoor vermogensgrenzen van de accu minder vaak knellen dan in werkelijkheid.".into(),
    });
    let measured = profile
        .iter()
        .filter(|i| i.measured_import_kwh.is_some())
        .count();
    if measured > 0 {
        warnings.push(format!(
            "In {} van de {} meetperioden zijn netafname en teruglevering zonder accu gemeten. Daar volgt hoeveel opwek en verbruik binnen de periode samenvielen de meter; de verdeling hierboven bepaalt alleen nog welk deel binnen het laad- en ontlaadvermogen valt.",
            measured,
            profile.len()
        ));
    }
    if parameters.start_year <= 2026 {
        warnings.push("Voor 2026 gebruikt dit model vereenvoudigde jaarlijkse saldering met één vast tarief. Vanaf 2027 wordt iedere geïmporteerde kWh betaald en iedere teruggeleverde kWh apart vergoed. Controleer de contractafrekening.".into());
    }
    if let Some(v) = &parameters.export_variant {
        warnings.push(format!(
            "Terugleveringsvariant ‘{}’: vanaf {} rekent deze variant met € {} vergoeding en € {} terugleverkosten per kWh, met verder dezelfde aannames. Het is een stresstest voor toekomstige contracten, geen prognose of aangekondigde regel: volgens de ACM houd je recht op een redelijke vergoeding, tot 2030 minstens 50% van het kale leveringstarief, terwijl terugleverkosten die vergoeding kunnen overtreffen.",
            v.label,
            v.from_calendar_year,
            euro(v.export_eur_per_kwh),
            euro(v.export_fee_eur_per_kwh)
        ));
    }
    // De ACM wil vanaf 2029 volume- en tijdsafhankelijke nettarieven (ontwerpbesluit 8 oktober 2026).
    if parameters.start_year + parameters.horizon_years > 2029 {
        warnings.push("Nettarieven: de ACM wil vanaf 1 januari 2029 volume- en tijdsafhankelijke transporttarieven voor huishoudens invoeren (ontwerpbesluit van 8 oktober 2026, definitief besluit begin 2027). Ongeveer tweederde van het nettarief gaat dan afhangen van hoeveel en wanneer je stroom afneemt. Dit model rekent met de ingevoerde vaste tarieven; zo’n wijziging kan de besparing van een accu in beide richtingen veranderen.".into());
    }
    // Namen van opties met een ingevoerde teruggave of subsidie in deze categorie.
    let credited = |category: &str| {
        candidates
            .iter()
            .filter(|c| {
                c.costs.iter().any(|l| {
                    l.category == category && l.status == CostStatus::Priced && l.amount_minor != 0
                })
            })
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let vat = credited("vat_refund");
    if !vat.is_empty() {
        warnings.push(format!("Btw-teruggave ingevoerd bij {}. Dit model rekent alleen met eigen gebruik van zonnestroom; volgens de Belastingdienst geeft alleen privégebruik geen recht op teruggave. Teruggave vraagt onder meer handel in stroom als btw-ondernemer, en dan kan btw over privégebruik verschuldigd zijn in het aanschafjaar en de vier jaren daarna. Die lasten zitten niet in deze berekening.", vat));
    }
    let grant = credited("grant");
    if !grant.is_empty() {
        warnings.push(format!("Subsidie ingevoerd bij {}. Tel een subsidie alleen mee als die is toegekend; regionale regelingen hebben eigen voorwaarden en een beperkt budget. Noteer regeling, toekenning en datum bij de kostenpost.", grant));
    }
    for c in candidates {
        let inactive: Vec<u32> = battery_ages(c, parameters.horizon_years)
            .iter()
            .zip(1..)
            .filter(|(age, _)| **age >= c.battery.operating_life_years)
            .map(|(_, year)| year)
            .collect();
        if inactive.is_empty() {
            continue;
        }
        let annual = c.costs.iter().any(|l| {
            l.timing == CostTiming::Annual && l.status == CostStatus::Priced && l.amount_minor > 0
        });
        warnings.push(format!(
            "{}: na de aangenomen levensduur van {} jaar werkt de accu in jaar {} van de looptijd niet meer, en voor die jaren is geen accuvervanging ingevoerd. Die jaren leveren geen besparing op{}.",
            c.name,
            c.battery.operating_life_years,
            year_ranges(&inactive),
            if annual {
                "; de ingevoerde jaarkosten lopen wel door"
            } else {
                ""
            }
        ));
    }
    if matches!(parameters.objective, Objective::SelfConsumption) {
        warnings.push("Het gekozen doel optimaliseert eigen gebruik; de aanbeveling kan financieel onrendabel zijn. Controleer NPV en ROI naast het doelresultaat.".into());
    }
    Ok(AnalysisResult {
        model_version: "nl-self-consumption-v5".into(),
        recommended_key: best_key,
        recommendation,
        baseline_first_year: baseline,
        candidates: results,
        warnings,
        export_variant_recommended_key,
    })
}
