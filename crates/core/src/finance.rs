//! Incrementele Nederlandse energierekening en economische projectkasstromen.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportFeeBand {
    pub up_to_kwh: Option<f64>,
    pub annual_eur: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tariff {
    /// All-in vast tarief; belastingen niet opnieuw als losse kosten optellen.
    pub import_eur_per_kwh: f64,
    pub export_eur_per_kwh: f64,
    pub export_fee_eur_per_kwh: f64,
    pub export_fee_bands: Vec<ExportFeeBand>,
    pub fixed_annual_eur: f64,
    pub annual_price_change_pct: f64,
}

pub fn energy_bill(
    import_kwh: f64,
    export_kwh: f64,
    tariff: &Tariff,
    calendar_year: u32,
    price_factor: f64,
) -> f64 {
    let energy = if calendar_year <= 2026 {
        (import_kwh - export_kwh).max(0.0) * tariff.import_eur_per_kwh
            - (export_kwh - import_kwh).max(0.0) * tariff.export_eur_per_kwh
    } else {
        import_kwh * tariff.import_eur_per_kwh - export_kwh * tariff.export_eur_per_kwh
    };
    let band = tariff
        .export_fee_bands
        .iter()
        .find(|b| b.up_to_kwh.is_none_or(|limit| export_kwh <= limit))
        .map_or(0.0, |b| b.annual_eur);
    (energy + export_kwh * tariff.export_fee_eur_per_kwh + band) * price_factor
        + tariff.fixed_annual_eur
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostStatus {
    Priced,
    Included,
    NotApplicable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostTiming {
    Upfront,
    Annual,
    Event,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CostLine {
    pub category: String,
    pub status: CostStatus,
    /// Inclusief niet-teruggevraagde btw; in eurocenten.
    pub amount_minor: i64,
    pub timing: CostTiming,
    /// Event vindt plaats aan het einde van dit analysejaar.
    pub year: Option<u32>,
    pub source: String,
    pub notes: String,
}

pub const COST_CATEGORIES: &[&str] = &[
    "battery",
    "inverter",
    "ems_metering",
    "backup",
    "installation",
    "cabling_protection",
    "meter_cabinet",
    "grid_connection",
    "survey_permits",
    "delivery",
    "other_upfront",
    "contingency",
    "subscription",
    "maintenance",
    "insurance",
    "extra_grid_fees",
    "extra_contract_fees",
    "tax_administration",
    "tax_private_use",
    "other_annual",
    "inverter_replacement",
    "battery_replacement",
    "removal_recycling",
    "grant",
    "vat_refund",
    "residual_value",
];

pub fn is_credit(category: &str) -> bool {
    ["grant", "vat_refund", "residual_value"].contains(&category)
}

pub fn cost_eur(line: &CostLine, scale: f64) -> f64 {
    if line.status != CostStatus::Priced {
        return 0.0;
    }
    let sign = if is_credit(&line.category) { -1.0 } else { 1.0 };
    line.amount_minor as f64 / 100.0 * sign * scale
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Financing {
    pub loan_amount_eur: f64,
    pub annual_interest_pct: f64,
    pub years: u32,
}

/// Openstaande hoofdsom na `analysis_years` jaar van een annuïtaire lening; bij 0% rente
/// gelijke aflossingen. Na de looptijd is alles afgelost.
fn balance(financing: &Financing, analysis_years: u32) -> f64 {
    let (amount, years) = (financing.loan_amount_eur, financing.years);
    if amount == 0.0 || analysis_years >= years {
        return 0.0;
    }
    let r = financing.annual_interest_pct / 100.0;
    if r == 0.0 {
        return amount * (years - analysis_years) as f64 / years as f64;
    }
    // ln_1p/exp_m1 behouden precisie wanneer een geldige rente zeer klein is.
    let denominator = -(-(years as f64) * r.ln_1p()).exp_m1();
    let annuity = amount * r / denominator;
    let mut balance = amount;
    for _ in 0..analysis_years {
        balance = (balance * (1.0 + r) - annuity).max(0.0);
    }
    balance
}

/// Rente in een analysejaar (1 = eerste jaar).
pub fn annual_interest(financing: &Financing, analysis_year: u32) -> f64 {
    if analysis_year == 0 || analysis_year > financing.years {
        return 0.0;
    }
    balance(financing, analysis_year - 1) * financing.annual_interest_pct / 100.0
}

/// Aflossing in een analysejaar; over de looptijd samen precies het leenbedrag.
pub fn annual_principal(financing: &Financing, analysis_year: u32) -> f64 {
    if analysis_year == 0 || analysis_year > financing.years {
        return 0.0;
    }
    balance(financing, analysis_year - 1) - balance(financing, analysis_year)
}

/// Eerste jaargrens waarna het cumulatieve saldo niet meer negatief wordt.
/// Hierdoor geldt een tijdelijke terugverdientijd vóór een vervanging niet als blijvend.
pub fn stable_payback(cashflows: &[f64], discount_pct: f64) -> Option<u32> {
    let mut cumulative = 0.0;
    let balances: Vec<_> = cashflows
        .iter()
        .enumerate()
        .map(|(year, value)| {
            cumulative += value / (1.0 + discount_pct / 100.0).powi(year as i32);
            cumulative
        })
        .collect();
    (0..balances.len())
        .find(|&i| balances[i..].iter().all(|v| *v >= -1e-8))
        .map(|v| v as u32)
}
