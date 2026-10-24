"use strict";

// Gegevens van de lokale API, vaste labels en de gedeelde vertaling van bronclaims naar
// rekengegevens en kostenindicaties. Elke aanname wordt met naam vastgelegd.
window.Data = (() => {
  const { api, number: n } = UI;
  let catalogCache = null, costsCache = null, typicalCache = null;

  const catalog = async (fresh = false) => (catalogCache = (!fresh && catalogCache) || await api("/api/v1/comparison"));
  const costs = async () => (costsCache ||= await api("/api/v1/analysis/costs"));
  const typicalSources = async () => (typicalCache ||= await api("/api/v1/solar/typical"));
  const imports = async () => (await api("/api/v1/solar/imports")).imports;
  const runs = async () => (await api("/api/v1/analysis/runs")).runs;
  const invalidateCatalog = () => { catalogCache = null; };

  const objectives = {
    net_present_value: "Hoogste netto voordeel (NPV)",
    roi: "Hoogste ROI over de looptijd",
    payback: "Kortste blijvende terugverdientijd",
    self_consumption: "Meeste eigen zonnestroom gebruiken"
  };
  const costStatus = { priced: "Bedrag", included: "Inbegrepen", not_applicable: "Niet van toepassing", unknown: "Nog onbekend" };
  const boundaries = { unspecified: "meetgrens onbekend", battery_dc: "accu DC", system_ac: "systeem AC", dc_dc: "DC → DC", ac_ac: "AC → AC", pv_ac: "PV → opslag → AC" };
  const qualifiers = { exact: "", approximate: "≈ ", at_least: "≥ ", at_most: "≤ ", less_than: "< ", greater_than: "> ", range: "" };
  const review = { unreviewed: "Nog niet nagekeken", reviewed: "Transcriptie nagekeken", disputed: "Betwist", superseded: "Vervangen" };
  const RESEARCHED_ON = "24 oktober 2026";

  // Geschiktheid van een bewaard profiel voor een berekening; uitsluitend op basis van importmetadata.
  function suitability(item) {
    const s = item.summary, o = item.options;
    if (s.consumption_kwh == null) return { ok: false, reason: "Verbruik ontbreekt" };
    if (s.gaps !== 0) return { ok: false, reason: "Gaten in de meetreeks" };
    if (![8760, 8784].some(hours => Math.abs(s.coverage_hours - hours) < 0.001)) return { ok: false, reason: "Geen volledig jaar" };
    if (s.rows > 110000) return { ok: false, reason: "Meer dan 110.000 meetperioden" };
    if (o.is_demo === true) return { ok: true, reason: "Bruikbaar · FICTIEF" };
    if (o.mode === "cumulative") return { ok: null, reason: "Onbekend: intervalduur niet vast te stellen" };
    const hours = { "5min": 1 / 12, "10min": 1 / 6, "15min": 0.25, "30min": 0.5, hour: 1 }[o.period];
    if (!hours) return { ok: false, reason: "Uur- of fijnere waarden nodig" };
    if (Math.abs(s.rows * hours - s.coverage_hours) > 0.001) return { ok: null, reason: "Onbekend: dekking niet eenduidig" };
    return { ok: true, reason: o.generator === "typical-nl-v1" ? "Bruikbaar · geschat profiel" : "Bruikbaar" };
  }
  const isDemo = item => item?.options?.is_demo === true;

  // Aannames voor gegevens die een bron niet noemt; altijd zichtbaar bij de accu.
  const FALLBACK = { usableShare: 90, efficiency: 85, standby: 5, degradation: 2, life: 15 };

  // Rekengegevens uit de bronclaims van één uitvoering, met een lijst van aannames en ontbrekende gegevens.
  function describe(cmp, config) {
    const live = row => row.configuration_id === config.id && !["superseded", "disputed"].includes(row.review_status);
    const numbers = cmp.numbers.filter(live), features = cmp.features.filter(live), texts = cmp.texts.filter(live);
    const order = ["system_ac", "ac_ac", "unspecified", "pv_ac", "battery_dc", "dc_dc"];
    const claim = metric => numbers.filter(c => c.metric_key === metric).sort((a, b) => order.indexOf(a.boundary) - order.indexOf(b.boundary))[0];
    const feature = metric => features.find(f => f.metric_key === metric);
    const notes = [], missing = [];

    let capacity = null;
    const usable = claim("usable_energy_wh"), nominal = claim("nominal_energy_wh"), dod = claim("depth_of_discharge_pct");
    if (usable) { capacity = usable.value / 1000; notes.push(`Bruikbaar ${n(capacity)} kWh volgens bron${usable.boundary === "unspecified" ? " (meetgrens niet vermeld)" : ""}.`); }
    else if (nominal && dod) { capacity = nominal.value / 1000 * dod.value / 100; notes.push(`Bruikbaar afgeleid: nominaal ${n(nominal.value / 1000)} kWh × ontlaaddiepte ${n(dod.value, 0)}%.`); }
    else if (nominal) { capacity = nominal.value / 1000 * FALLBACK.usableShare / 100; notes.push(`Aanname: ${FALLBACK.usableShare}% van de opgegeven ${n(nominal.value / 1000)} kWh is bruikbaar; de bron noemt geen bruikbare capaciteit.`); }
    else missing.push("bruikbare capaciteit");

    const discharge = claim("continuous_discharge_power_w"), charge = claim("continuous_charge_power_w");
    const dischargeKw = discharge ? discharge.value / 1000 : null;
    let chargeKw = charge ? charge.value / 1000 : null;
    if (dischargeKw == null) missing.push("werkelijk ontlaadvermogen in kW (kVA telt niet)");
    if (chargeKw == null && dischargeKw != null) { chargeKw = dischargeKw; notes.push("Aanname: laadvermogen gelijk aan ontlaadvermogen; de bron noemt geen laadvermogen."); }

    const rte = claim("round_trip_efficiency_pct");
    let efficiency = FALLBACK.efficiency;
    if (rte) {
      efficiency = rte.value;
      const range = rte.qualifier === "range" ? `${n(rte.value, 0)}–${n(rte.upper_value, 0)}%, gerekend met de ondergrens` : `${n(rte.value, 0)}%`;
      notes.push(`Rendement ${range}${rte.boundary === "ac_ac" ? " (AC → AC)" : `; meetgrens ${rte.boundary === "pv_ac" ? "PV → accu → AC" : "niet vermeld"}, gebruikt als AC → AC-aanname`}.`);
    } else notes.push(`Aanname: ${FALLBACK.efficiency}% rendement heen en terug; de bron noemt geen round-trip-rendement.`);

    const standbyClaim = claim("standby_power_w"), standby = standbyClaim ? standbyClaim.value : FALLBACK.standby;
    if (!standbyClaim) notes.push(`Aanname: ${FALLBACK.standby} W sluimerverbruik; niet opgegeven.`);
    notes.push(`Aanname: ${FALLBACK.degradation}% capaciteitsverlies per jaar en ${FALLBACK.life} jaar levensduur; geen garantie of fabrieksvoorspelling.`);

    const coupling = texts.find(t => t.metric_key === "coupling")?.value || "";
    const kind = /stekker/i.test(coupling) ? "plug" : coupling ? "fixed" : null;
    const offer = cmp.offers
      .filter(o => o.configuration_id === config.id && o.currency === "EUR" && o.minor_unit_exponent === 2 && o.tax_basis === "included")
      .sort((a, b) => b.observed_at_unix_s - a.observed_at_unix_s)[0] ?? null;
    const warranty = cmp.warranties.filter(w => w.configuration_id === config.id && w.product_months != null).map(w => w.product_months);
    return {
      config, name: `${config.manufacturer_name} ${config.product_name} · ${config.name}`,
      capacity, chargeKw, dischargeKw, efficiency, standby, notes, missing, coupling, kind,
      phases: claim("phase_count")?.value ?? null, backup: feature("backup"), outdoor: feature("outdoor"),
      inverterIncluded: feature("inverter_included")?.status === "supported", offer,
      warrantyYears: warranty.length ? Math.max(...warranty) / 12 : null,
      battery: capacity != null && dischargeKw != null ? {
        usable_capacity_kwh: capacity, charge_power_kw: chargeKw, discharge_power_kw: dischargeKw,
        ac_round_trip_efficiency_pct: efficiency, standby_w: standby,
        annual_capacity_loss_pct: FALLBACK.degradation, operating_life_years: FALLBACK.life
      } : null
    };
  }

  // Kostenindicatie voor alle 26 posten. `item`: { kind, manufacturer, phases, inverterIncluded };
  // `situation`: { place, backup, phases } uit de keuzehulp. Elke regel noemt een bron of aanname.
  function estimateCosts(catalogData, item, situation = {}) {
    const { amounts, meters, facts } = catalogData.estimates, fixed = item.kind !== "plug";
    const byMaker = list => list.find(x => x.manufacturer === item.manufacturer);
    const lines = new Map(catalogData.categories.map(c => [c.key,
      { category: c.key, status: "not_applicable", amount_minor: 0, timing: c.timing, year: null, source: "Aanname", notes: "" }]));
    const set = (key, status, source, notes, eur = 0) =>
      Object.assign(lines.get(key), { status, amount_minor: status === "priced" ? Math.round(eur * 100) : 0, source, notes });
    const priced = (key, ref, eur = ref.amount_eur) => set(key, "priced", ref.url, `${ref.label}. ${ref.detail}`, eur);
    const assume = (key, notes, status = "not_applicable") => set(key, status, "Aanname", notes);
    const fact = (key, f, status = "not_applicable") => set(key, status, f.url, f.detail);
    const pack = detail => ({ url: amounts.installation_basic.url, detail });

    set("battery", "unknown", "Nog in te vullen", "Aanschafprijs van de accu.");
    if (item.inverterIncluded) set("inverter", "included", "Bronclaim van de fabrikant", "De omvormer zit in het product.");
    else set("inverter", "unknown", "Nog in te vullen", "Dit product heeft een aparte of hybride omvormer nodig; vraag de prijs na.");

    if (fixed) {
      const outside = situation.place === "outside";
      priced("installation", outside ? amounts.installation_extended : amounts.installation_basic);
      fact("ems_metering", pack("Meting via P1 of CT-klem zit in het installatiepakket."), "included");
      fact("cabling_protection", pack(outside ? "Langere kabelroute, doorvoer en extra beveiliging zitten in het uitgebreide pakket." : "Aparte groep met beveiliging zit in het basispakket."), "included");
      fact("survey_permits", pack("Een schouw vooraf is altijd inbegrepen."), "included");
      if (situation.backup === "yes") priced("backup", amounts.backup_extra); else assume("backup", "Geen noodstroom gevraagd.");
      if (item.phases === 3) priced("meter_cabinet", amounts.meter_cabinet_three_phase);
      else fact("meter_cabinet", pack("De aparte groep zit in het pakket. Een verouderde groepenkast vervangen (vanaf € 919) is niet meegeteld."), "included");
      if (item.phases === 3 && situation.phases === "1") priced("grid_connection", amounts.grid_one_to_three_phase);
      else assume("grid_connection", item.phases === 3 ? "Uitgaande van een bestaande 3-fasenaansluiting." : "Geen wijziging van de netaansluiting nodig.");
      assume("delivery", "Levering en voorrijkosten worden in de bron niet apart genoemd; aangenomen dat ze in pakket- of productprijs zitten.");
      const base = [...lines.values()].filter(l => ["installation", "backup", "meter_cabinet", "grid_connection"].includes(l.category)).reduce((sum, l) => sum + l.amount_minor, 0);
      set("contingency", "priced", "Aanname", `${amounts.contingency_pct.label}. ${amounts.contingency_pct.detail}`, base / 100 * amounts.contingency_pct.amount_pct / 100);
    } else {
      assume("installation", "Stekkerbatterij: zelf aan te sluiten in een gewoon stopcontact.");
      assume("cabling_protection", "Geen eigen groep nodig bij 800 W via een stopcontact.");
      assume("meter_cabinet", "Geen aanpassing van de meterkast nodig bij 800 W via een stopcontact.");
      assume("survey_permits", "Geen schouw of keuring nodig voor een stekkerbatterij tot 800 W.");
      assume("backup", "Een stekkerbatterij levert geen noodstroom aan de woning.");
      assume("grid_connection", "Geen wijziging van de netaansluiting nodig.");
      assume("contingency", "Geen installatiewerk, dus geen reserve aangenomen.");
      const own = byMaker(meters), meter = own || meters.find(m => m.manufacturer === "HomeWizard");
      if (own) priced("ems_metering", own);
      else set("ems_metering", "priced", meter.url, `Aanname: een vergelijkbare P1-meter (${meter.label}) is nodig voor de regeling.`, meter.amount_eur);
      const delivery = byMaker(facts.delivery_free);
      if (delivery) fact("delivery", delivery, "included"); else assume("delivery", "Verzendkosten niet vermeld; aangenomen dat ze in de prijs zitten.");
    }
    const software = byMaker(facts.software_free);
    if (software) fact("subscription", software); else assume("subscription", "Geen abonnement vermeld voor de basisfuncties; aangenomen dat de app gratis is.");
    assume("maintenance", "Geen onderhoudskosten opgegeven; een LFP-accu met software-updates vraagt normaal geen periodiek onderhoud.");
    fact("insurance", facts.insurance);
    fact("extra_grid_fees", facts.grid_fees);
    assume("extra_contract_fees", "Een vast of variabel contract rekent geen extra kosten voor een accu.");
    for (const key of ["tax_administration", "tax_private_use", "vat_refund"]) fact(key, facts.vat);
    assume("other_upfront", "Geen overige startkosten bekend.");
    assume("other_annual", "Geen overige jaarkosten bekend.");
    assume("inverter_replacement", "De omvormer is onderdeel van het product; vervanging valt binnen de aangenomen levensduur van het geheel.");
    assume("battery_replacement", "Geen vervanging: het model stopt de accu na de aangenomen levensduur.");
    fact("removal_recycling", facts.recycling);
    fact("grant", facts.grant);
    assume("residual_value", "Geen restwaarde aangenomen (voorzichtig).");
    return [...lines.values()];
  }
  const isAssumption = line => line.source === "Aanname" || line.notes.startsWith("Aanname");

  // Standaard projectie-aannames, aanpasbaar in Instellingen; nooit voor bewaarde runs.
  const DEFAULTS = { start_year: 2027, horizon_years: 15, discount_pct: 4, annual_cost_escalation_pct: 2, annual_pv_loss_pct: 0, annual_load_growth_pct: 0, annual_price_change_pct: 0, price_uncertainty_pct: 20, cost_uncertainty_pct: 15 };
  // Oudere versies bewaarden de aannames per formulierveld-id.
  const LEGACY_IDS = { start_year: "analysis-start", horizon_years: "analysis-years", discount_pct: "analysis-discount", annual_cost_escalation_pct: "cost-escalation", annual_pv_loss_pct: "pv-degradation", annual_load_growth_pct: "load-growth", annual_price_change_pct: "tariff-escalation", price_uncertainty_pct: "price-uncertainty", cost_uncertainty_pct: "cost-uncertainty" };
  const defaults = () => {
    const legacy = UI.store.get("thuisaccu-defaults", {});
    const migrated = Object.fromEntries(Object.entries(LEGACY_IDS).map(([key, id]) => [key, Number(legacy[id])]).filter(([, v]) => Number.isFinite(v)));
    const saved = UI.store.get("thuisaccu-standaard", migrated), out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) if (Number.isFinite(saved[key])) out[key] = saved[key];
    return out;
  };

  return {
    catalog, costs, typicalSources, imports, runs, invalidateCatalog, objectives, costStatus, boundaries, qualifiers, review,
    RESEARCHED_ON, suitability, isDemo, FALLBACK, describe, estimateCosts, isAssumption, DEFAULTS, defaults
  };
})();
