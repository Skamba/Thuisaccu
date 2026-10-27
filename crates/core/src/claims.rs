//! Toets de belofte: wat zou er waar moeten zijn voor wat een verkoper of advertentie belooft, met de
//! getallen van één bewaarde berekening.
//!
//! Alles volgt uit de bewaarde uitkomst van één optie en de invoerparameters van die berekening; er
//! wordt niets opnieuw gesimuleerd en niets bewaard. Wat niet exact uit die getallen volgt, blijft
//! `None` (onbekend), nooit nul.
use crate::{
    analysis::{self, AnalysisError, CandidateResult, Parameters},
    finance::{self, Tariff},
    sizing::EnergyYear,
};
use serde::{Deserialize, Serialize};

/// Wat de verkoper belooft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimKind {
    /// ‘Bespaart € X per jaar’, vergeleken met de besparing in het eerste jaar.
    AnnualSavingEur,
    /// ‘Terugverdiend in N jaar’, ongedisconteerd zoals `payback_years` van de berekening.
    PaybackYears,
    /// ‘Y% zelfvoorzienend’, vergeleken met de zelfvoorziening in het eerste jaar.
    SelfSufficiencyPct,
}

impl ClaimKind {
    /// De soort bij de naam uit de API, of `None` bij een onbekende naam.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "annual_saving_eur" => Some(Self::AnnualSavingEur),
            "payback_years" => Some(Self::PaybackYears),
            "self_sufficiency_pct" => Some(Self::SelfSufficiencyPct),
            _ => None,
        }
    }
}

/// Eén belofte: de soort en het getal zoals de verkoper het noemt.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Claim {
    pub kind: ClaimKind,
    pub value: f64,
}

/// Een variant die de berekening al doorrekende.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimVariantKind {
    Base,
    Pessimistic,
    Optimistic,
    ExportVariant,
    WarrantyStress,
}

/// De waarde van de beloofde grootheid in één variant, en of de belofte daar uitkomt. `value` en
/// `holds` zijn `None` als de variant die grootheid niet exact vastlegt (bijvoorbeeld een oude run
/// zonder netafname zonder accu).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimVariant {
    pub variant: ClaimVariantKind,
    pub value: Option<f64>,
    pub holds: Option<bool>,
}

/// Het antwoord op één belofte voor één optie.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimCheck {
    pub kind: ClaimKind,
    pub claimed: f64,
    pub candidate_key: String,
    pub name: String,
    pub horizon_years: u32,
    /// De waarde volgens de berekening (basisaannames): besparing in jaar 1 in euro, terugverdientijd
    /// in jaren of zelfvoorziening in jaar 1 in procent. Bij de terugverdientijd betekent `None` dat
    /// de optie zich binnen de looptijd niet terugverdient.
    pub calculated: Option<f64>,
    /// Of de belofte met de basisaannames uitkomt; `None` als dat uit deze berekening niet volgt
    /// (bijvoorbeeld een terugverdientijd voorbij de looptijd).
    pub holds: Option<bool>,
    /// De varianten waarin de grootheid bekend is, de basis eerst.
    pub variants: Vec<ClaimVariant>,
    /// Of de belofte in minstens één van `variants` uitkomt; `None` als dat niet vast te stellen is.
    pub within_variants: Option<bool>,
    /// Factor op de berekende energiebesparing (1 = zoals berekend) waarmee de belofte precies
    /// uitkomt, met alle kosten, de lening en de energiestromen gelijk. Alleen bij besparing en
    /// terugverdientijd.
    pub saving_share: Option<f64>,
    /// All-in afnametarief in het eerste jaar waarmee de besparing in jaar 1 precies het beloofde
    /// bedrag is, met dezelfde energiestromen en verder hetzelfde tarief. Alleen bij besparing, en
    /// alleen als de bewaarde stromen de besparing exact reproduceren.
    pub import_eur_per_kwh: Option<f64>,
    /// Het afnametarief waarmee de berekening rekende (eerste jaar, basisaannames).
    pub current_import_eur_per_kwh: f64,
    /// Gemiddelde energiebesparing per jaar over de looptijd. Alleen bij besparing.
    pub average_annual_saving_eur: Option<f64>,
    /// Zelfvoorziening in jaar 1 zonder accu. Alleen bij zelfvoorziening.
    pub baseline_pct: Option<f64>,
    /// Hoeveel kWh zonnestroom het huis in jaar 1 extra zelf zou moeten gebruiken voor de beloofde
    /// zelfvoorziening (0 als die al gehaald wordt). Alleen bij zelfvoorziening.
    pub extra_solar_kwh: Option<f64>,
    /// Hoogst mogelijke zelfvoorziening in jaar 1 met deze opwek, zelfs met een verliesvrije accu
    /// zonder grenzen: opwek gedeeld door verbruik, hoogstens 100%. Alleen bij zelfvoorziening.
    pub max_self_sufficiency_pct: Option<f64>,
}

const TOLERANCE: f64 = 1e-9;

fn ensure(condition: bool, message: &str) -> Result<(), AnalysisError> {
    if condition {
        Ok(())
    } else {
        Err(AnalysisError(message.into()))
    }
}

/// Controleert of een belofte binnen redelijke grenzen ligt.
pub fn validate(claim: &Claim) -> Result<(), AnalysisError> {
    ensure(claim.value.is_finite(), "Vul een getal in.")?;
    match claim.kind {
        ClaimKind::AnnualSavingEur => ensure(
            claim.value > 0.0 && claim.value <= 100_000.0,
            "Vul een besparing per jaar in tussen € 0 en € 100.000.",
        ),
        ClaimKind::PaybackYears => ensure(
            claim.value.fract() == 0.0 && (1.0..=50.0).contains(&claim.value),
            "Vul een terugverdientijd in hele jaren in, van 1 tot 50.",
        ),
        ClaimKind::SelfSufficiencyPct => ensure(
            claim.value > 0.0 && claim.value <= 100.0,
            "Vul een zelfvoorziening in tussen 0 en 100%.",
        ),
    }
}

/// Besparing in jaar 1 met een ander tarief, uit de bewaarde netafname en teruglevering met en zonder
/// accu. In jaar 1 is de prijsfactor 1 en vallen de vaste kosten tegen elkaar weg. `None` in runs
/// zonder netafname en teruglevering zonder accu.
fn first_year_saving(c: &CandidateResult, tariff: &Tariff) -> Option<f64> {
    let y = c.years.first().filter(|y| y.year == 1)?;
    let bill = |import, export| finance::energy_bill(import, export, tariff, y.calendar_year, 1.0);
    Some(
        bill(y.baseline_grid_import_kwh?, y.baseline_grid_export_kwh?)
            - bill(y.energy.grid_import_kwh, y.energy.grid_export_kwh),
    )
}

/// Wat er waar zou moeten zijn voor `claim` bij optie `c`, met de parameters `p` van dezelfde
/// berekening en de energiestromen zonder accu in jaar 1 (`baseline`, als de run die heeft).
pub fn check(
    c: &CandidateResult,
    baseline: Option<&EnergyYear>,
    p: &Parameters,
    claim: &Claim,
) -> Result<ClaimCheck, AnalysisError> {
    validate(claim)?;
    let mut answer = ClaimCheck {
        kind: claim.kind,
        claimed: claim.value,
        candidate_key: c.key.clone(),
        name: c.name.clone(),
        horizon_years: p.horizon_years,
        calculated: None,
        holds: None,
        variants: Vec::new(),
        within_variants: None,
        saving_share: None,
        import_eur_per_kwh: None,
        current_import_eur_per_kwh: p.tariff.import_eur_per_kwh,
        average_annual_saving_eur: None,
        baseline_pct: None,
        extra_solar_kwh: None,
        max_self_sufficiency_pct: None,
    };
    match claim.kind {
        ClaimKind::AnnualSavingEur => annual_saving(c, p, claim.value, &mut answer),
        ClaimKind::PaybackYears => payback(c, p, claim.value as u32, &mut answer),
        ClaimKind::SelfSufficiencyPct => self_sufficiency(c, baseline, claim.value, &mut answer),
    }
    answer.within_variants = if answer.variants.iter().any(|v| v.holds == Some(true)) {
        Some(true)
    } else if !answer.variants.is_empty() && answer.variants.iter().all(|v| v.holds.is_some()) {
        Some(false)
    } else {
        None
    };
    Ok(answer)
}

fn variant(
    kind: ClaimVariantKind,
    value: Option<f64>,
    holds: impl Fn(f64) -> bool,
) -> ClaimVariant {
    ClaimVariant {
        variant: kind,
        value,
        holds: value.map(holds),
    }
}

fn annual_saving(c: &CandidateResult, p: &Parameters, claimed: f64, answer: &mut ClaimCheck) {
    let Some(first) = c.years.first() else {
        return;
    };
    let saving = first.energy_saving_eur;
    let reaches = |value: f64| value >= claimed - TOLERANCE;
    answer.calculated = Some(saving);
    answer.holds = Some(reaches(saving));
    if p.horizon_years > 0 {
        answer.average_annual_saving_eur =
            Some(c.lifetime_energy_saving_eur / p.horizon_years as f64);
    }
    answer.saving_share = (saving > TOLERANCE).then(|| claimed / saving);
    // Alleen als de bewaarde stromen met het tarief van de berekening dezelfde besparing geven, is
    // de besparing in jaar 1 een exacte functie van het tarief.
    let exact = first_year_saving(c, &p.tariff)
        .is_some_and(|again| (again - saving).abs() <= 1e-6 * (1.0 + saving.abs()));
    let at = |tariff: &Tariff| {
        if exact {
            first_year_saving(c, tariff)
        } else {
            None
        }
    };
    if exact {
        // De rekening is lineair in de afnameprijs (de hoeveelheden hangen niet van de prijs af):
        // één euro per kWh meer geeft de helling, vanaf 2027 de vermeden netafname en bij salderen
        // de afname van de netto netafname.
        let mut shifted = p.tariff.clone();
        shifted.import_eur_per_kwh += 1.0;
        if let Some(slope) = at(&shifted).map(|v| v - saving)
            && slope > TOLERANCE
        {
            answer.import_eur_per_kwh =
                Some(p.tariff.import_eur_per_kwh + (claimed - saving) / slope);
        }
    }
    answer
        .variants
        .push(variant(ClaimVariantKind::Base, Some(saving), reaches));
    answer.variants.push(variant(
        ClaimVariantKind::Pessimistic,
        at(&analysis::stressed_tariff(p, -1)),
        reaches,
    ));
    answer.variants.push(variant(
        ClaimVariantKind::Optimistic,
        at(&analysis::stressed_tariff(p, 1)),
        reaches,
    ));
    if let Some(v) = &p.export_variant {
        let value = if first.calendar_year >= v.from_calendar_year {
            at(&analysis::varied_tariff(&p.tariff, v))
        } else {
            Some(saving)
        };
        answer
            .variants
            .push(variant(ClaimVariantKind::ExportVariant, value, reaches));
    }
}

/// De kleinste factor op de energiebesparing waarbij het cumulatieve saldo vanaf jaar `n` niet meer
/// negatief wordt, zoals `finance::stable_payback` de terugverdientijd telt: de hele startinvestering
/// op tijdstip nul, per jaar besparing min extra kosten en leningrente. `None` als geen factor dat
/// haalt of `n` voorbij de looptijd ligt.
fn payback_share(c: &CandidateResult, n: u32) -> Option<f64> {
    if n as usize > c.years.len() {
        return None;
    }
    let (mut costs, mut savings) = (c.initial_investment_eur, 0.0);
    let (mut low, mut high) = (0.0_f64, f64::INFINITY);
    for y in &c.years {
        costs += y.extra_costs_eur + y.financing_interest_eur;
        savings += y.energy_saving_eur;
        if y.year < n {
            continue;
        }
        // Het saldo na dit jaar is factor × besparing − kosten en moet minstens nul zijn.
        if savings > TOLERANCE {
            low = low.max(costs / savings);
        } else if savings < -TOLERANCE {
            high = high.min(costs / savings);
        } else if costs > 1e-8 {
            return None;
        }
    }
    (low <= high).then_some(low)
}

fn payback(c: &CandidateResult, p: &Parameters, n: u32, answer: &mut ClaimCheck) {
    let horizon = p.horizon_years;
    let reaches = |payback: Option<u32>| match payback {
        Some(years) => Some(years <= n),
        None if n <= horizon => Some(false),
        None => None,
    };
    answer.calculated = c.payback_years.map(f64::from);
    answer.holds = reaches(c.payback_years);
    // De factor geldt alleen als de bewaarde jaren dezelfde terugverdientijd geven als de berekening.
    let flows: Vec<f64> = std::iter::once(-c.initial_investment_eur)
        .chain(
            c.years
                .iter()
                .map(|y| y.energy_saving_eur - y.extra_costs_eur - y.financing_interest_eur),
        )
        .collect();
    if finance::stable_payback(&flows, 0.0) == c.payback_years {
        answer.saving_share = payback_share(c, n);
    }
    let entry = |kind, payback: Option<u32>| ClaimVariant {
        variant: kind,
        value: payback.map(f64::from),
        holds: reaches(payback),
    };
    answer
        .variants
        .push(entry(ClaimVariantKind::Base, c.payback_years));
    if let Some(v) = &c.export_variant {
        answer
            .variants
            .push(entry(ClaimVariantKind::ExportVariant, v.payback_years));
    }
    if let Some(v) = &c.warranty_stress {
        answer
            .variants
            .push(entry(ClaimVariantKind::WarrantyStress, v.payback_years));
    }
}

fn self_sufficiency(
    c: &CandidateResult,
    baseline: Option<&EnergyYear>,
    claimed: f64,
    answer: &mut ClaimCheck,
) {
    // Tarief- en kostenvarianten veranderen de energiestromen niet; alleen de basis telt.
    let first = &c.first_year;
    let current = first.self_sufficiency_pct;
    let reaches = |value: f64| value >= claimed - TOLERANCE;
    answer.calculated = Some(current);
    answer.holds = Some(reaches(current));
    answer.baseline_pct = baseline.map(|b| b.self_sufficiency_pct);
    if first.consumption_kwh > 0.0 {
        answer.extra_solar_kwh =
            Some(((claimed - current) / 100.0 * first.consumption_kwh).max(0.0));
        answer.max_self_sufficiency_pct =
            Some((first.production_kwh / first.consumption_kwh * 100.0).min(100.0));
    }
    answer
        .variants
        .push(variant(ClaimVariantKind::Base, Some(current), reaches));
}
