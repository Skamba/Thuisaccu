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

/// Extra verbruik vanaf 1 januari van een kalenderjaar, zoals een warmtepomp of elektrische
/// auto, bovenop het gemeten of geschatte jaar. `steady_kwh` heeft één waarde per meetperiode
/// van het profiel en loopt binnen de periode gelijkmatig. De vorm (graaduren, laadmoment)
/// komt van buiten de rekenkern.
#[derive(Debug, Clone)]
pub struct LoadAddition {
    pub label: String,
    pub from_calendar_year: u32,
    pub steady_kwh: Vec<f64>,
}

/// Profiel per kalenderjaar: het basisjaar plus de extra verbruiken die dan al lopen.
struct Profiles<'a> {
    base: &'a [EnergyInterval],
    /// Op volgorde van beginjaar; elk profiel bevat alle eerdere uitbreidingen.
    stages: Vec<(u32, Vec<EnergyInterval>)>,
}

impl<'a> Profiles<'a> {
    fn new(base: &'a [EnergyInterval], additions: &[LoadAddition]) -> Self {
        let mut sorted: Vec<_> = additions.iter().collect();
        sorted.sort_by_key(|a| a.from_calendar_year);
        let mut stages: Vec<(u32, Vec<EnergyInterval>)> = Vec::new();
        for addition in sorted {
            let mut profile = stages
                .last()
                .map_or_else(|| base.to_vec(), |(_, p)| p.clone());
            for (interval, &extra) in profile.iter_mut().zip(&addition.steady_kwh) {
                if extra > 0.0 {
                    interval.consumption_kwh += extra;
                    interval.steady_consumption_kwh =
                        Some(interval.steady_consumption_kwh.unwrap_or(0.0) + extra);
                    // De meter mat het huis zonder dit verbruik; de gelijktijdigheid binnen de
                    // periode volgt dan weer de verdeling.
                    interval.measured_import_kwh = None;
                    interval.measured_export_kwh = None;
                }
            }
            match stages.last_mut() {
                Some((year, last)) if *year == addition.from_calendar_year => *last = profile,
                _ => stages.push((addition.from_calendar_year, profile)),
            }
        }
        Self { base, stages }
    }

    fn year(&self, calendar_year: u32) -> &[EnergyInterval] {
        self.stages
            .iter()
            .rev()
            .find(|(from, _)| *from <= calendar_year)
            .map_or(self.base, |(_, profile)| profile)
    }
}

/// Versie van het rekenmodel in elke uitkomst. Verhoog hem als de betekenis van uitkomsten
/// verandert en documenteer dat in `docs/roi-model.md`; de interface (`MODEL_VERSION` in
/// `web/data.js`) noemt oudere runs bij het vergelijken.
pub const MODEL_VERSION: &str = "nl-self-consumption-v8";

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
    /// Optionele stresstest met een kortere levensduur en sneller capaciteitsverlies, zoals een
    /// accu die stopt na de garantie. Ontbreekt in runs van vóór 26 oktober 2026.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warranty_stress: Option<BatteryStress>,
    /// Hoe de accu wordt aangesloten, als label voor de weergave; de rekenkern rekent er niet mee
    /// (vermogen en kosten staan al in `battery` en `costs`). Ontbreekt in runs van vóór 26 oktober 2026
    /// en bij een onbekende soort.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<Connection>,
}

/// Soort aansluiting: een stekkerbatterij in een gewoon stopcontact, een vaste installatie, of een
/// stekkerbatterij op een eigen groep door een elektricien.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Connection {
    Plug,
    Fixed,
    Circuit,
}

/// Andere levensduur- en verouderingsaannames voor dezelfde accu; al het andere blijft gelijk.
/// `basis` zegt waar de waarden vandaan komen (bijvoorbeeld de garantie uit de bron).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatteryStress {
    pub operating_life_years: u32,
    pub annual_capacity_loss_pct: f64,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearResult {
    pub year: u32,
    pub calendar_year: u32,
    pub energy: EnergyYear,
    /// Netafname en teruglevering zonder accu in dit jaar, zodat de besparing per jaar na te
    /// rekenen is; ontbreekt in runs van vóór 26 oktober 2026.
    #[serde(default)]
    pub baseline_grid_import_kwh: Option<f64>,
    #[serde(default)]
    pub baseline_grid_export_kwh: Option<f64>,
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

/// Uitkomst van de terugleveringsvariant of de garantiestresstest, zonder prijs- en kostenstress.
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
    /// Uitkomst met [`Candidate::warranty_stress`], met verder dezelfde aannames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warranty_stress: Option<ExportVariantResult>,
    /// Kantelpunten met de basisaannames; ontbreekt in runs van vóór 27 oktober 2026.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tipping_points: Option<TippingPoints>,
}

/// Waar de NPV van een optie nul wordt als je één invoer verandert en al het andere gelijk houdt,
/// met de basisaannames (geen prijs- of kostenstress, geen terugleveringsvariant). De NPV hangt bij
/// vaste energiestromen lineair af van elk van deze drie, dus het punt is exact. `None` als de
/// invoer de NPV niet verandert (bijvoorbeeld geen besparing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TippingPoints {
    /// Afnametarief in het eerste jaar (all-in, per kWh) waarbij de NPV nul is; de jaarlijkse
    /// prijsverandering blijft gelijk.
    pub import_eur_per_kwh: Option<f64>,
    /// Terugleververgoeding in het eerste jaar (per kWh) waarbij de NPV nul is, met dezelfde
    /// terugleverkosten.
    pub export_eur_per_kwh: Option<f64>,
    /// Deel van de berekende energiebesparing (1 = zoals berekend) waarbij de NPV nul is, met alle
    /// kosten gelijk: hoeveel de besparing mag tegenvallen.
    pub saving_share: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub model_version: String,
    pub recommended_key: String,
    pub recommendation: String,
    pub baseline_first_year: EnergyYear,
    pub candidates: Vec<CandidateResult>,
    /// Wat bij deze invoer aandacht vraagt: zaken die de uitkomst of de keuze kunnen veranderen.
    pub warnings: Vec<String>,
    /// Hoe het model rekent: vaste uitleg die bij iedere berekening hoort. Runs van vóór 27 oktober 2026 hebben
    /// deze zinnen nog tussen de waarschuwingen.
    #[serde(default)]
    pub notes: Vec<String>,
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

/// Afgerond geheel getal in Nederlandse notatie met een punt per duizendtal, zoals de interface: 5500 wordt ‘5.500’,
/// −1234 wordt ‘−1.234’ (met een echt minteken).
pub fn whole(value: f64) -> String {
    let digits = format!("{:.0}", value.abs());
    let mut grouped = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    if value.round() < 0.0 {
        grouped.insert(0, '−');
    }
    grouped
}

fn bounded(value: f64, low: f64, high: f64) -> bool {
    value.is_finite() && value >= low && value <= high
}

fn validate_additions(
    profile: &[EnergyInterval],
    p: &Parameters,
    additions: &[LoadAddition],
) -> Result<(), AnalysisError> {
    ensure(
        additions.len() <= 10,
        "Geef hoogstens 10 veranderingen in verbruik op.",
    )?;
    for a in additions {
        ensure(
            !a.label.trim().is_empty() && a.label.chars().count() <= 200,
            "Geef elke verandering in verbruik een korte omschrijving.",
        )?;
        ensure(
            (p.start_year..p.start_year + p.horizon_years).contains(&a.from_calendar_year),
            "Een verandering in verbruik begint binnen de looptijd, op of na het startjaar.",
        )?;
        ensure(
            a.steady_kwh.len() == profile.len()
                && a.steady_kwh.iter().all(|&v| bounded(v, 0.0, 1e6)),
            "Extra verbruik hoort één niet-negatieve waarde per meetperiode te hebben.",
        )?;
    }
    Ok(())
}

/// Controleert of een energieprofiel bruikbaar is voor een berekening: één volledig jaar met uur- of
/// fijnere perioden en geldige waarden. Ook de capaciteitsverkenning gebruikt deze controle.
pub fn validate_profile(profile: &[EnergyInterval]) -> Result<(), AnalysisError> {
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
    )
}

pub fn validate(
    profile: &[EnergyInterval],
    p: &Parameters,
    candidates: &[Candidate],
) -> Result<(), AnalysisError> {
    validate_profile(profile)?;
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
            bounded(v.export_eur_per_kwh, -10.0, 10.0)
                && bounded(v.export_fee_eur_per_kwh, 0.0, 10.0),
            "Ongeldige terugleveringsvariant.",
        )?;
        // Na de looptijd zou de variant gelijk zijn aan de basis en toch als stresstest worden getoond.
        ensure(
            (p.start_year..p.start_year + p.horizon_years).contains(&v.from_calendar_year),
            "De terugleveringsvariant begint binnen de looptijd, op of na het startjaar.",
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
        if let Some(s) = &c.warranty_stress {
            ensure(
                bounded(s.annual_capacity_loss_pct, 0.0, 20.0)
                    && (1..=30).contains(&s.operating_life_years)
                    && !s.basis.trim().is_empty(),
                "Vul levensduur, capaciteitsverlies en herkomst van de garantiestresstest geldig in.",
            )?;
        }
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

/// Groei- en degradatiefactoren van verbruik en PV-opwek in looptijdjaar `year` (vanaf 1).
fn factors(p: &Parameters, year: u32) -> (f64, f64) {
    (
        (1.0 - p.annual_pv_loss_pct / 100.0).powi((year - 1) as i32),
        (1.0 + p.annual_load_growth_pct / 100.0).powi((year - 1) as i32),
    )
}

/// Energiestromen zonder accu en voor iedere accu (met haar leeftijden) per looptijdjaar. Jaar voor
/// jaar, zodat de verdeling binnen de meetperioden per jaar maar een keer wordt berekend.
fn simulate_all(
    profiles: &Profiles,
    p: &Parameters,
    batteries: &[(&Battery, Vec<u32>)],
) -> (Vec<EnergyYear>, Vec<Vec<EnergyYear>>) {
    let mut baseline = Vec::new();
    let mut tracks: Vec<Vec<EnergyYear>> = vec![Vec::new(); batteries.len()];
    let mut states = vec![0.0; batteries.len()];
    for year in 1..=p.horizon_years {
        let (pv_factor, load_factor) = factors(p, year);
        let load_year = sizing::LoadYear::new(
            profiles.year(p.start_year + year - 1),
            pv_factor,
            load_factor,
            p.load_variation,
        );
        let none = sizing::simulate_load_year(&load_year, None, 0, 0.0);
        for (((battery, ages), track), state) in batteries.iter().zip(&mut tracks).zip(&mut states)
        {
            let age = ages[(year - 1) as usize];
            // Een uitgediende accu zonder restlading werkt als geen accu: hetzelfde jaar, zonder
            // het opnieuw door te rekenen.
            let energy = if age >= battery.operating_life_years && *state == 0.0 {
                none.clone()
            } else {
                sizing::simulate_load_year(&load_year, Some(battery), age, *state)
            };
            // Restlading van de oude accu levert geen opbrengst in de nieuwe accu op.
            *state = if ages.get(year as usize) == Some(&0) {
                0.0
            } else {
                energy.end_storage_kwh
            };
            track.push(energy);
        }
        baseline.push(none);
    }
    (baseline, tracks)
}

fn project(
    baselines: &[EnergyYear],
    energies: &[EnergyYear],
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
    // Teruggaven en subsidie schalen niet mee met de kosten; in de gunstige variant kunnen ze zo
    // boven de kosten uitkomen. Meer dan de kosten krijg je niet terug.
    let upfront: f64 = c
        .costs
        .iter()
        .filter(|l| l.timing == CostTiming::Upfront)
        .map(scaled)
        .sum::<f64>()
        .max(0.0);
    // Het geleende deel betaal je niet op tijdstip nul maar via de aflossingen; zo telt de
    // discontovoet de lening niet dubbel naast de rente.
    let mut cashflows = vec![-upfront + c.financing.loan_amount_eur];
    // De terugverdientijd gaat over de investering zelf: de hele startinvestering op tijdstip nul,
    // de leningrente als kosten en de aflossingen niet. Anders is een volledig geleende accu
    // ‘direct terugverdiend’ zodra de besparing de aflossing dekt.
    let mut payback_flows = vec![-upfront];
    let mut years = Vec::new();
    let mut total_costs = upfront;
    let mut total_savings = 0.0;
    for (index, (baseline, energy)) in baselines.iter().zip(energies).enumerate() {
        let year = index as u32 + 1;
        let calendar_year = p.start_year + year - 1;
        let price_factor = (1.0 + p.tariff.annual_price_change_pct / 100.0).powi((year - 1) as i32);
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
        payback_flows.push(saving - costs - interest);
        let cumulative = cashflows.iter().sum();
        years.push(YearResult {
            year,
            calendar_year,
            energy: energy.clone(),
            baseline_grid_import_kwh: Some(baseline.grid_import_kwh),
            baseline_grid_export_kwh: Some(baseline.grid_export_kwh),
            baseline_bill_eur: baseline_bill,
            battery_bill_eur: battery_bill,
            energy_saving_eur: saving,
            extra_costs_eur: costs,
            financing_interest_eur: interest,
            financing_principal_eur: principal,
            net_cashflow_eur: saving - costs - interest - principal,
            cumulative_eur: cumulative,
        });
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
        payback_years: finance::stable_payback(&payback_flows, 0.0),
        discounted_payback_years: finance::stable_payback(&payback_flows, p.discount_pct),
        // De NPV hangt lineair af van de startinvestering (factor 1 op tijdstip nul); in de
        // kostenvarianten niet, daar schaalt `cost_factor` de investering mee.
        break_even_investment_eur: upfront + npv,
        first_year: years[0].energy.clone(),
        years,
        pessimistic: variant.clone(),
        optimistic: variant,
        within_budget: p.budget_eur.is_none_or(|budget| upfront <= budget),
        export_variant: None,
        warranty_stress: None,
        tipping_points: None,
    }
}

/// De kantelpunten van [`TippingPoints`] voor een optie met de basisuitkomst `base`. Omdat de NPV
/// lineair is in elk van de drie, volgt het nulpunt uit één extra doorrekening met een andere waarde.
fn tipping_points(
    baselines: &[EnergyYear],
    energies: &[EnergyYear],
    p: &Parameters,
    c: &Candidate,
    base: &CandidateResult,
) -> TippingPoints {
    // Eén euro per kWh erbij geeft de helling; het nulpunt ligt daarmee vast.
    let zero = |current: f64, change: &dyn Fn(&mut Tariff)| {
        let mut shifted = p.clone();
        change(&mut shifted.tariff);
        let slope = project(baselines, energies, &shifted, c, 0, None).npv_eur - base.npv_eur;
        (slope.abs() > 1e-9).then(|| current - base.npv_eur / slope)
    };
    let discount = 1.0 + p.discount_pct / 100.0;
    let savings: f64 = base
        .years
        .iter()
        .map(|y| y.energy_saving_eur / discount.powi(y.year as i32))
        .sum();
    TippingPoints {
        import_eur_per_kwh: zero(p.tariff.import_eur_per_kwh, &|t| {
            t.import_eur_per_kwh += 1.0
        }),
        export_eur_per_kwh: zero(p.tariff.export_eur_per_kwh, &|t| {
            t.export_eur_per_kwh += 1.0
        }),
        saving_share: (savings.abs() > 1e-9).then(|| 1.0 - base.npv_eur / savings),
    }
}

/// De accu in de garantiestresstest: nooit gunstiger dan de basis, dus de kortste levensduur en het
/// snelste capaciteitsverlies van de twee.
pub fn stressed_battery(battery: &Battery, stress: &BatteryStress) -> Battery {
    Battery {
        operating_life_years: stress
            .operating_life_years
            .min(battery.operating_life_years),
        annual_capacity_loss_pct: stress
            .annual_capacity_loss_pct
            .max(battery.annual_capacity_loss_pct),
        ..battery.clone()
    }
}

fn outcome(r: &CandidateResult) -> ExportVariantResult {
    ExportVariantResult {
        npv_eur: r.npv_eur,
        net_profit_eur: r.net_profit_eur,
        roi_pct: r.roi_pct,
        payback_years: r.payback_years,
        break_even_investment_eur: r.break_even_investment_eur,
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
    let mut best_npv = 0.0;
    for (r, npv, roi, payback) in options {
        if !r.within_budget {
            continue;
        }
        let score = match objective {
            Objective::NetPresentValue => npv,
            // Net als bij de terugverdientijd: geen optie die in geld van nu verlies geeft.
            // Zonder startinvestering (teruggaven dekken alles) is er geen ROI; met winst is dat
            // het best denkbare rendement.
            Objective::Roi if npv >= 0.0 => roi.unwrap_or(if npv > 0.0 {
                f64::INFINITY
            } else {
                f64::NEG_INFINITY
            }),
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
        // De terugverdientijd telt in hele jaren en twee accu's die nooit vol of leeg raken hebben
        // hetzelfde eigen gebruik; bij zo'n gelijkspel tussen accu's wint de hoogste NPV, niet de
        // eerste (kleinste) optie in de lijst. Bij -∞ (niet terugverdiend) is er geen gelijkspel.
        let tie_won = match objective {
            Objective::Payback => true,
            Objective::SelfConsumption => best_key != "no_battery",
            _ => false,
        } && (score - best_score).abs() <= 1e-8
            && npv > best_npv + 1e-8;
        if score > best_score + 1e-8 || tie_won {
            best_score = score;
            best_npv = npv;
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
    analyze_with(profile, parameters, candidates, &[])
}

/// Als [`analyze`], met extra verbruik dat pas in een later kalenderjaar begint.
pub fn analyze_with(
    profile: &[EnergyInterval],
    parameters: &Parameters,
    candidates: &[Candidate],
    additions: &[LoadAddition],
) -> Result<AnalysisResult, AnalysisError> {
    validate(profile, parameters, candidates)?;
    validate_additions(profile, parameters, additions)?;
    let profiles = Profiles::new(profile, additions);
    let stressed: Vec<Option<Battery>> = candidates
        .iter()
        .map(|c| {
            c.warranty_stress
                .as_ref()
                .map(|s| stressed_battery(&c.battery, s))
        })
        .collect();
    let batteries: Vec<(&Battery, Vec<u32>)> = candidates
        .iter()
        .map(|c| (&c.battery, battery_ages(c, parameters.horizon_years)))
        .chain(candidates.iter().zip(&stressed).filter_map(|(c, s)| {
            s.as_ref()
                .map(|b| (b, battery_ages(c, parameters.horizon_years)))
        }))
        .collect();
    let (baselines, mut tracks) = simulate_all(&profiles, parameters, &batteries);
    let mut stress_tracks = tracks.split_off(candidates.len()).into_iter();
    let mut results = Vec::new();
    for (c, energies) in candidates.iter().zip(&tracks) {
        let run = |stress, variant| project(&baselines, energies, parameters, c, stress, variant);
        let mut base = run(0, None);
        let low = run(-1, None);
        let high = run(1, None);
        if let Some(v) = &parameters.export_variant {
            base.export_variant = Some(outcome(&run(0, Some(v))));
        }
        base.tipping_points = Some(tipping_points(&baselines, energies, parameters, c, &base));
        // Zelfde accu met een kortere levensduur en sneller verlies; telt niet mee voor de keuze.
        if c.warranty_stress.is_some() {
            let energies = stress_tracks.next().unwrap_or_default();
            base.warranty_stress = Some(outcome(&project(
                &baselines, &energies, parameters, c, 0, None,
            )));
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
    let baseline = baselines[0].clone();
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
    let mut notes = vec![
        "Model: zonnestroom opslaan voor eigen gebruik, met vaste ingevoerde all-in tarieven. Geen dynamische handel, onbalansinkomsten of optimale prijsgestuurde aansturing.".into(),
        "Het gemeten jaar wordt ieder projectiejaar hergebruikt met de opgegeven groei/degradatie. Varianten zijn aannamegevoeligheid, geen kansinterval of gegarandeerde opbrengst.".into(),
        "ROI = ongedisconteerde nettowinst over de horizon / netto startinvestering. NPV houdt rekening met de opgegeven discontovoet. Een lening telt als rente en aflossing in het jaar waarin je ze betaalt; alleen het eigen deel van de investering staat op tijdstip nul. ROI deelt door de volledige netto startinvestering. Dit is geen eigenvermogenrendement.".into(),
        "Bedragen zijn inclusief niet-teruggevraagde btw. Geen automatische subsidie of btw-teruggave; voeg alleen een bevestigde teruggave toe. Verliezen en standby zijn al in de energierekening verwerkt.".into(),
        "Een adres bepaalt geen verbruiksprofiel, omvormercompatibiliteit, aansluiting of installatiemaatwerk. De fysieke geschiktheid blijft een apart te bevestigen voorwaarde.".into(),
    ];
    notes.push(match parameters.load_variation {
        LoadVariation::Households => "Binnen iedere meetperiode van 5 tot 60 minuten volgt het verbruik de gemiddelde verdeling van 74 per seconde gemeten Duitse huishoudens (HTW Berlin, 2010). Korte pieken boven het ontlaadvermogen en wisselingen tussen overschot en tekort binnen het uur tellen zo mee. Opwek is binnen de periode gelijkmatig. De regelvertraging van de accu is niet meegerekend: HTW Berlin mat bij 22 thuisaccusystemen gemiddeld 1 s totdat de accu reageert en 4,5 s totdat het nieuwe vermogen bereikt is (Stromspeicher-Inspektion 2025); in een controle per seconde kostte een vertraging van 2 tot 5 s ongeveer 2 tot 3% van de besparing.".into(),
        LoadVariation::Uniform => "Het verbruik is binnen iedere meetperiode gelijkmatig verondersteld. Bij uur- of kwartierwaarden ontbreken korte pieken, waardoor vermogensgrenzen van de accu minder vaak knellen dan in werkelijkheid.".into(),
    });
    let mut warnings = Vec::new();
    let measured = profile
        .iter()
        .filter(|i| i.measured_import_kwh.is_some())
        .count();
    if measured > 0 {
        notes.push(format!(
            "In {} van de {} meetperioden zijn netafname en teruglevering zonder accu gemeten. Daar volgt uit de meter hoeveel opwek en verbruik binnen de periode samenvielen; de verdeling hierboven bepaalt alleen nog welk deel binnen het laad- en ontlaadvermogen valt.",
            measured,
            profile.len()
        ));
    }
    for a in additions {
        warnings.push(format!(
            "Extra verbruik ‘{}’: vanaf 1 januari {} komt er {} kWh per jaar bij, bovenop het verbruik in het profiel; binnen iedere meetperiode loopt het gelijkmatig.",
            a.label,
            a.from_calendar_year,
            whole(a.steady_kwh.iter().sum::<f64>())
        ));
    }
    if let Some(first) = additions.iter().map(|a| a.from_calendar_year).min()
        && measured > 0
    {
        warnings.push(format!(
            "Vanaf {first} meet de slimme meter niet meer het huis waarmee gerekend wordt. In perioden met extra verbruik schat het model daarom weer met de verdeling hoeveel opwek en verbruik samenvallen; de uitkomst is vanaf dat jaar minder zeker en kan wat hoger of lager uitvallen."
        ));
    }
    let last = crate::finance::LAST_NETTING_YEAR;
    if parameters.start_year <= last {
        warnings.push(format!("Voor {last} gebruikt dit model vereenvoudigde jaarlijkse saldering met één vast tarief. Vanaf {} wordt iedere geïmporteerde kWh betaald en iedere teruggeleverde kWh apart vergoed. Controleer de contractafrekening.", last + 1));
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
    // Een kortere looptijd dan de levensduur telt de laatste werkende jaren niet mee; de accu heeft
    // in dit model geen restwaarde.
    let shorter: Vec<String> = candidates
        .iter()
        .filter(|c| {
            !c.costs
                .iter()
                .any(|l| l.category == "battery_replacement" && l.status == CostStatus::Priced)
                && c.battery.operating_life_years > parameters.horizon_years
        })
        .map(|c| c.name.clone())
        .collect();
    if !shorter.is_empty() {
        warnings.push(format!(
            "Bij {} is de aangenomen levensduur langer dan de looptijd van {} jaar. De jaren na de looptijd tellen niet mee en de accu heeft aan het eind geen restwaarde; met een langere looptijd (als je zo lang in dit huis blijft) komt de uitkomst gunstiger uit.",
            if shorter.len() > 3 {
                format!("{} en {} andere accu’s", shorter[..3].join(", "), shorter.len() - 3)
            } else {
                shorter.join(", ")
            },
            parameters.horizon_years
        ));
    }
    for c in candidates {
        if let Some(s) = &c.warranty_stress {
            let b = stressed_battery(&c.battery, s);
            warnings.push(format!(
                "Garantiestresstest bij {}: dezelfde berekening met {} jaar levensduur en {}% capaciteitsverlies per jaar ({}; nooit gunstiger dan de basisaannames). Het is een stresstest, geen voorspelling; de keuze hierboven gebruikt de basisaannames.",
                c.name,
                b.operating_life_years,
                format!("{}", b.annual_capacity_loss_pct).replace('.', ","),
                s.basis.trim()
            ));
        }
    }
    if matches!(parameters.objective, Objective::SelfConsumption) {
        warnings.push("Het gekozen doel optimaliseert eigen gebruik; de aanbeveling kan financieel onrendabel zijn. Controleer NPV en ROI naast het doelresultaat.".into());
    }
    Ok(AnalysisResult {
        model_version: MODEL_VERSION.into(),
        recommended_key: best_key,
        recommendation,
        baseline_first_year: baseline,
        candidates: results,
        warnings,
        notes,
        export_variant_recommended_key,
    })
}
