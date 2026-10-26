"use strict";

// Gegevens van de lokale API, vaste labels en de gedeelde vertaling van bronclaims naar
// rekengegevens en kostenindicaties. Elke aanname wordt met naam vastgelegd.
window.Data = (() => {
  const { api, number: n } = UI;
  let catalogCache = null, costsCache = null, typicalCache = null, referencesLoaded = null;

  // Ontbrekende ingebouwde referentiesets worden één keer per bezoek bijgeladen, zodat de catalogus
  // altijd de nieuwste set bevat. Het laden is per set idempotent: eerder geladen sets en eigen
  // claims blijven ongewijzigd. Bewust zonder voorafgaande statusvraag, zodat dit ook werkt met een
  // oudere, nog in de browsercache staande WebAssembly-module.
  const loadReferences = () => (referencesLoaded ||= api("/api/v1/references", { method: "POST" })
    .catch(error => { referencesLoaded = null; throw error; }));
  // Een onderzochte uitvoering die niet zonder eigen invoer door te rekenen is (capaciteit,
  // AC-ontlaadvermogen, prijs inclusief btw en de omvormer), voegt weinig toe en wordt niet getoond;
  // `hidden` telt ze. Zelf toegevoegde uitvoeringen blijven altijd zichtbaar.
  const catalog = async (fresh = false) => {
    await loadReferences();
    if (fresh || !catalogCache) {
      const cmp = await api("/api/v1/comparison");
      const shown = cmp.configurations.filter(c => !c.researched || complete(describe(cmp, c)));
      catalogCache = { ...cmp, configurations: shown, hidden: cmp.configurations.length - shown.length };
    }
    return catalogCache;
  };
  const complete = p => p.battery != null && p.offer != null && (p.inverterIncluded || p.offer.includes_inverter === true);
  // De onderzochte uitvoering achter elke optie van een run, op nummer én naam: een gedeelde run kan uit
  // een andere database komen, waar hetzelfde nummer een andere accu is. Opties zonder overeenkomst ontbreken.
  async function described(candidates) {
    const cmp = await catalog(), out = new Map();
    for (const c of candidates) {
      const config = cmp.configurations.find(x => x.id === c.configuration_id);
      if (!config || !(c.name === describe(cmp, config).name || c.name.includes(config.product_name))) continue;
      out.set(c.key, describe(cmp, config));
    }
    return out;
  }
  const costs = async () => (costsCache ||= await api("/api/v1/analysis/costs"));
  // Gelijk aan `analysis::MODEL_VERSION` in de rekenkern (de HTTP-test controleert dat). Runs met een
  // andere versie zijn met andere rekenregels gemaakt.
  const MODEL_VERSION = "nl-self-consumption-v5";
  // Wat elke modelversie veranderde, in gewone taal (docs/roi-model.md), met een toets of het een
  // bewaarde run raakt: true, false, of null als dat uit de run niet te zien is.
  const MODEL_CHANGES = [
    ["nl-self-consumption-v2", "Verbruik binnen een meetperiode volgt een dagpatroon in plaats van gelijk verdeeld te zijn.", () => null],
    ["nl-self-consumption-v3", "Gemeten netafname en teruglevering uit je meterbestand tellen mee.", () => null],
    ["nl-self-consumption-v4", "Bij het doel ROI wint alleen een accu die in geld van nu niet verliest.",
      run => run.input.request.parameters.objective === "roi"],
    ["nl-self-consumption-v5", "Een lening telt als rente en aflossing in het jaar dat je ze betaalt; met een lening kwam de accu eerder te duur uit.",
      run => run.input.request.candidates.some(c => c.financing?.loan_amount_eur > 0)]
  ];
  // De veranderingen na `version`, als [{ text, affects }]; leeg bij een onbekende versie.
  function modelChanges(version, run) {
    const known = ["nl-self-consumption-v1", ...MODEL_CHANGES.map(([v]) => v)];
    const index = known.indexOf(version);
    if (index < 0) return [];
    return MODEL_CHANGES.slice(index).map(([, text, affects]) => ({ text, affects: affects(run) }));
  }
  // Of geen van de veranderingen sinds de run hem raakt; dan blijft de uitkomst naar verwachting gelijk.
  const unaffectedByModel = run => {
    const changes = modelChanges(run.result.model_version, run);
    return changes.length > 0 && changes.every(c => c.affects === false);
  };
  // Begrippen in gewone taal, voor wie de uitkomst samen met iemand anders leest.
  const GLOSSARY = [
    ["Netto voordeel (NPV)", "Wat de accu over de looptijd oplevert min wat hij kost, omgerekend naar geld van nu. Boven nul " +
      "verdient de accu zich terug én levert hij meer op dan je geld elders zou doen."],
    ["Discontovoet", "Wat je geld per jaar anders zou kunnen opbrengen, bijvoorbeeld op een spaarrekening of door minder te " +
      "lenen. Daardoor telt een euro over tien jaar minder dan een euro nu."],
    ["Lonend tot", "De hoogste startinvestering waarbij het netto voordeel nog nul is. Kost de accu minder, dan is hij lonend."],
    ["Terugverdiend na", "Na hoeveel jaar de besparingen de investering hebben goedgemaakt, zonder de discontovoet."],
    ["kWh en kW", "kWh is een hoeveelheid energie: wat er in de accu past of wat je per jaar verbruikt. kW is vermogen: hoe snel " +
      "de accu laadt of stroom levert. Een accu met 5 kWh die 0,8 kW levert, doet ruim zes uur over leeglopen."],
    ["Startinvestering", "Alles wat je bij aanschaf betaalt, zoals accu, installatie en aansluiting, min teruggaven en subsidie."]
  ];
  // Posten die de kosten verlagen, zoals `finance::is_credit` in de rekenkern.
  const CREDITS = ["grant", "vat_refund", "residual_value"];
  // Wat de offertecheck uit een offerte kan overnemen: [veld, naam, eenheid], gelijk aan QUOTE_FIELDS in
  // scenario_api.rs. De technische velden staan in `battery`; de totaalprijs is de som van alle betaalde
  // startposten vóór teruggaven (de totaalprijs plus wat je apart hield), het abonnement het bedrag per jaar (0 zonder).
  const QUOTE_FIELDS = [["usable_capacity_kwh", "bruikbare capaciteit", "kWh"], ["charge_power_kw", "laadvermogen AC", "kW"],
    ["discharge_power_kw", "ontlaadvermogen AC", "kW"], ["ac_round_trip_efficiency_pct", "rendement AC → AC", "%"],
    ["standby_w", "sluimerverbruik", "W"], ["operating_life_years", "levensduur", "jaar"],
    ["annual_capacity_loss_pct", "capaciteitsverlies per jaar", "%"],
    ["upfront_eur", "startkosten vóór teruggaven", "€"], ["subscription_eur", "abonnement per jaar", "€"]];
  const isPriceField = field => field === "upfront_eur" || field === "subscription_eur";
  // De waarde van een offerteveld bij een optie zoals die naar de rekenkern gaat (bedragen in eurocenten).
  function quoteValue(candidate, field) {
    const priced = l => l.status === "priced" ? l.amount_minor / 100 : 0;
    if (field === "upfront_eur") return candidate.costs.filter(l => l.timing === "upfront" && !CREDITS.includes(l.category))
      .reduce((sum, l) => sum + priced(l), 0);
    if (field === "subscription_eur") return priced(candidate.costs.find(l => l.category === "subscription") || { status: "" });
    return candidate.battery[field];
  }
  const plain = value => n(value, 2).replace(/,?0+$/, "");
  const quoteUnit = (field, value) => { const unit = QUOTE_FIELDS.find(([key]) => key === field)[2];
    return unit === "€" ? UI.money(value, { decimals: Number.isInteger(value) ? 0 : 2 }) : `${plain(value)}${unit === "%" ? "%" : ` ${unit}`}`; };
  const quoteChange = c => `${QUOTE_FIELDS.find(([key]) => key === c.field)[1]} ${quoteUnit(c.field, c.before)} → ${quoteUnit(c.field, c.after)}`;
  // Zet een offerteprijs in de kostenposten: de totaalprijs op de accupost en de apart geschatte startposten
  // als inbegrepen, behalve wat je apart houdt (`separate`, categorieën). De reserve voor meerwerk vervalt
  // alleen bij een vaste prijs. Het abonnement wordt een jaarbedrag. Bedragen in hele eurocenten.
  function applyQuotePrice(candidate, field, value, { separate = [], fixedPrice = false } = {}) {
    const set = (line, status, amount, source, notes) => Object.assign(line, { status, amount_minor: amount, source, notes });
    if (field === "subscription_eur") {
      const line = candidate.costs.find(l => l.category === "subscription");
      if (value > 0) set(line, "priced", Math.round(value * 100), "Offerte", "Abonnement per jaar volgens de offerte.");
      else set(line, "not_applicable", 0, "Offerte", "Geen abonnement volgens de offerte.");
      return;
    }
    for (const line of candidate.costs.filter(l => l.timing === "upfront" && !CREDITS.includes(l.category))) {
      if (line.category === "battery") set(line, "priced", Math.round(value * 100), "Offerte (totaalprijs inclusief btw)",
        "Totaalprijs uit de offerte, inclusief btw.");
      else if (line.category === "contingency") {
        if (fixedPrice && line.status === "priced") set(line, "not_applicable", 0, "Offerte",
          "Vaste prijs volgens de offerte; geen reserve voor meerwerk.");
      } else if (line.status === "priced" && !separate.includes(line.category)) set(line, "included", 0, "In de totaalprijs van de offerte",
        "Was eerder apart geschat; nu inbegrepen in de totaalprijs van de offerte.");
    }
  }
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
  const costStatus = { priced: "Bedrag", included: "Inbegrepen", not_applicable: "Niet van toepassing",
    unknown: "Nog onbekend" };
  const boundaries = { unspecified: "meetgrens onbekend", battery_dc: "accu DC", system_ac: "systeem AC",
    dc_dc: "DC → DC", ac_ac: "AC → AC", pv_ac: "PV → opslag → AC" };
  const qualifiers = { exact: "", approximate: "≈ ", at_least: "≥ ", at_most: "≤ ", less_than: "< ",
    greater_than: "> ", range: "" };
  const review = { unreviewed: "Nog niet nagekeken", reviewed: "Transcriptie nagekeken", disputed: "Betwist",
    superseded: "Vervangen" };
  // RESEARCHED_ON en RESEARCHED_ISO: de oudste peildatum (tarieven, regels, eerste sets); de waarschuwing telt daarvandaan.
  // RESEARCHED_SPAN: alle onderzochte productsets samen (REFERENCE_SETS in api.rs).
  const RESEARCHED_ON = "24 oktober 2026", RESEARCHED_ISO = "2026-10-24", RESEARCHED_SPAN = "24 tot en met 26 oktober 2026";
  // Prijzen en tarieven veranderen snel. Na drie maanden waarschuwt de interface dat de
  // momentopnamen verouderd kunnen zijn; de gegevens zelf blijven ongewijzigd.
  function priceAge(now = new Date()) {
    const researched = new Date(`${RESEARCHED_ISO}T00:00:00`);
    const months = (now.getFullYear() - researched.getFullYear()) * 12 + now.getMonth() - researched.getMonth()
      - (now.getDate() < researched.getDate() ? 1 : 0);
    return {
      months, stale: months >= 3,
      text: `Prijzen, tarieven en kostenindicaties zijn onderzocht op ${RESEARCHED_ON}, ${months} maanden geleden. ` +
        "Ze kunnen verouderd zijn; controleer de actuele prijs bij de verkoper en gebruik je eigen offerte en contract."
    };
  }

  // Geschiktheid van een bewaard profiel voor een berekening; uitsluitend op basis van importmetadata.
  function suitability(item) {
    const s = item.summary, o = item.options;
    if (s.consumption_kwh == null) return { ok: false, reason: "Verbruik ontbreekt" };
    if (s.gaps !== 0) return { ok: false, reason: "Gaten in de meetreeks" };
    if (![8760, 8784].some(hours => Math.abs(s.coverage_hours - hours) < 0.001)) return { ok: false,
      reason: "Geen volledig jaar" };
    if (s.rows > 110000) return { ok: false, reason: "Meer dan 110.000 meetperioden" };
    if (o.is_demo === true) return { ok: true, reason: "Bruikbaar · FICTIEF" };
    // Een combinatie met een meterbestand heeft altijd vaste perioden van `combined_period`.
    if (o.mode === "cumulative" && !o.combined_period) return { ok: null,
      reason: "Onbekend: intervalduur niet vast te stellen" };
    const hours = { "5min": 1 / 12, "10min": 1 / 6, "15min": 0.25, "30min": 0.5,
      hour: 1 }[o.combined_period || o.period];
    if (!hours) return { ok: false, reason: "Uur- of fijnere waarden nodig" };
    if (Math.abs(s.rows * hours - s.coverage_hours) > 0.001) return { ok: null,
      reason: "Onbekend: dekking niet eenduidig" };
    return { ok: true, reason: o.generator === "typical-nl-v1" ? "Bruikbaar · geschat profiel" : "Bruikbaar" };
  }
  const isDemo = item => item?.options?.is_demo === true;

  // Regels en veiligheidsadvies rond aansluiten, voor de keuzehulp en de uitkomst; gedateerde bronnen, geen juridisch advies.
  const RULES = {
    register: "Meld je thuisaccu aan bij je netbeheerder via energieleveren.nl. Volgens Netbeheer Nederland is dat verplicht, " +
      "net als voor zonnepanelen; dat geldt sinds een wijziging van de Netcode elektriciteit voor opslag vanaf 0,8 kW die op het " +
      "net is aangesloten. Aanmelden is gratis. Naar schatting is minder dan 40% van de thuisaccu’s aangemeld.",
    plug: "Milieu Centraal raadt stekkerbatterijen op dit moment niet aan, onder meer vanwege brandrisico: in één groep kan " +
      "stroom van twee kanten komen, van het net en van de accu. Een installateur sluit een accu volgens de NEN 1010-norm aan " +
      "op een aparte groep in de meterkast, niet op een stopcontact. Kies je toch voor een stekkerbatterij, gebruik dan een " +
      "vaste wandcontactdoos op een groep met weinig andere apparaten, geen verlengsnoer of stekkerdoos, en houd het " +
      "terugleververmogen op 800 W of minder. Die laatste adviezen geeft Milieu Centraal voor stekkerzonnepanelen; " +
      "ze gelden ook logisch voor een stekkerbatterij, maar zijn daarvoor niet afzonderlijk gepubliceerd.",
    sources: [
      ["Netbeheer Nederland: netbewust gebruik thuisbatterij (december 2024)",
        "https://www.netbeheernederland.nl/sites/default/files/2024-12/nbnl_netbewust-gebruik-thuisbatterij_a4_fc_.pdf"],
      ["Solar Magazine: registratie thuisbatterij en Netcode (8 mei 2024)",
        "https://solarmagazine.nl/nieuws-zonne-energie/i37394/verplichte-registratie-thuisbatterij-website-energieleveren-nl-vernieuwd"],
      ["Milieu Centraal: thuisbatterij (gewijzigd 28 september 2026)",
        "https://www.milieucentraal.nl/energie-besparen/zonnepanelen/thuisbatterij-zonne-energie-opslaan/"],
      ["Milieu Centraal: zonnepanelen met een stekker (gewijzigd 30 juni 2026)",
        "https://www.milieucentraal.nl/energie-besparen/zonnepanelen/zonnepanelen-met-een-stekker/"]
    ]
  };
  // Aannames voor gegevens die een bron niet noemt; altijd zichtbaar bij de accu. Rendement en
  // sluimerverbruik zijn bewust voorzichtig: gemeten stekkeraccu's halen 77–87% heen en terug en
  // gebruiken 3–14 W in rust (docs/keuzehulp.md).
  const FALLBACK = { usableShare: 90, efficiency: 77, standby: 10, degradation: 2, life: 15 };
  // Herkent in de vastgelegde aannametekst van een optie welke technische waarde een aanname is; de
  // offertecheck markeert die. Hoort bij de zinnen in describe() hieronder en bij de 800 W-begrenzing in
  // keuzehulp.js: pas ze samen aan. tests/e2e/data.test.js controleert dat elke zin herkend wordt.
  const ASSUMED = {
    usable_capacity_kwh: /Aanname: [\d,]+% van de opgegeven/,
    charge_power_kw: /Aanname: laadvermogen gelijk/,
    discharge_power_kw: /Aanname: ontladen ingesteld op 800 W/,
    ac_round_trip_efficiency_pct: /Aanname: [\d,]+% rendement|gebruikt als AC → AC-aanname/,
    standby_w: /Aanname: [\d,]+ W sluimerverbruik/,
    annual_capacity_loss_pct: /Aanname: [\d,]+% capaciteitsverlies/,
    operating_life_years: /Aanname: [\d,]+% capaciteitsverlies per jaar en [\d,]+ jaar levensduur/
  };
  // De aannametekst van een optie uit de keuzehulp begint zo; een eigen offerte of accu niet.
  const KEUZEHULP_PREFIX = "Keuzehulp.";
  const isAssumed = (field, assumptions) => ASSUMED[field]?.test(assumptions) === true;
  const fromKeuzehulp = candidate => candidate.assumptions.startsWith(KEUZEHULP_PREFIX);

  // Meetgrenzen op volgorde van voorkeur. Vermogen en rendement rekenen aan de AC-kant: een
  // DC-waarde (accu DC, DC → DC) mist de omvormer en telt daar niet mee.
  const ANY_BOUNDARY = ["system_ac", "ac_ac", "unspecified", "pv_ac", "battery_dc", "dc_dc"];
  const AC_BOUNDARY = ["system_ac", "ac_ac", "unspecified", "pv_ac"];
  // Bij meerdere bruikbare claims met dezelfde meetgrens telt de voorzichtigste waarde. Voor sluimerverbruik
  // telt de hoogste waarde over alle AC-meetgrenzen en ‘niet vermeld’ samen: een lagere waarde aan het
  // stopcontact (bijvoorbeeld met het apparaat uit) maakt een hoger gemeten verbruik in bedrijf niet minder waar.
  const HIGHER_IS_CAUTIOUS = new Set(["standby_power_w"]);
  // Rendementsclaims die niet als AC → AC-rendement voor de simulatie kunnen gelden; ze worden genoemd
  // maar niet gebruikt. Een bovengrens (‘tot 90%’, piekwaarde) zegt niets over de ondergrens. Een
  // rendement inclusief het eigen verbruik in rust telt het sluimerverbruik dubbel, want de simulatie
  // rekent dat apart. En sommige claims zeggen zelf dat ze niet voor de complete AC-installatie gelden.
  const UNUSABLE_EFFICIENCY = [
    [c => c.qualifier === "at_most", "is een bovengrens, geen verwachte waarde"],
    [c => /inclusief (het )?(eigen verbruik|stand-?by|sluimerverbruik)/i.test(c.conditions),
      "bevat ook het eigen verbruik in rust; dat telt al als sluimerverbruik"],
    [c => /geen rendement van de complete AC-installatie/i.test(c.conditions), "geldt niet voor de complete AC-installatie"]
  ];
  const unusableEfficiency = c => UNUSABLE_EFFICIENCY.find(([test]) => test(c))?.[1];
  const METRIC_LABELS = { usable_energy_wh: "bruikbare capaciteit", nominal_energy_wh: "nominale capaciteit",
    depth_of_discharge_pct: "ontlaaddiepte", continuous_discharge_power_w: "ontlaadvermogen",
    continuous_charge_power_w: "laadvermogen", round_trip_efficiency_pct: "rendement", standby_power_w: "sluimerverbruik" };
  // Waarde met eenheid zoals de interface rekent: energie in kWh, vermogen in kW, sluimerverbruik in W.
  const shown = c => c.unit === "Wh" ? `${n(c.value / 1000, 1)} kWh`
    : c.unit === "W" && c.metric_key !== "standby_power_w" ? `${n(c.value / 1000, 1)} kW` : `${n(c.value, 1)}${c.unit === "%" ? "%" : ` ${c.unit}`}`;

  // Rekengegevens uit de bronclaims van één uitvoering, met een lijst van aannames en ontbrekende gegevens.
  function describe(cmp, config) {
    const live = row => row.configuration_id === config.id && !["superseded", "disputed"].includes(row.review_status);
    const numbers = cmp.numbers.filter(live), features = cmp.features.filter(live), texts = cmp.texts.filter(live);
    const notes = [], missing = [], used = [];
    // Selectieregel: de meest geschikte meetgrens, daarbinnen de voorzichtigste waarde. Andere
    // waarden worden genoemd; claim-ID en bron gaan mee in de aannames van de berekening.
    const claim = (metric, order = ANY_BOUNDARY, skip = () => false) => {
      const fitting = numbers.filter(c => c.metric_key === metric && order.includes(c.boundary) && !skip(c));
      if (!fitting.length) return undefined;
      const boundary = order.find(b => fitting.some(c => c.boundary === b));
      const higher = HIGHER_IS_CAUTIOUS.has(metric);
      const ac = b => AC_BOUNDARY.includes(b);
      const same = fitting.filter(c => higher ? ac(c.boundary) === ac(boundary) : c.boundary === boundary);
      const pick = same.reduce((a, b) => (higher ? b.value > a.value : b.value < a.value) ? b : a);
      if (METRIC_LABELS[metric]) {
        used.push({ label: METRIC_LABELS[metric], claim: pick });
        const values = [...new Set(fitting.map(c => c.value))];
        if (values.length > 1) notes.push(`${fitting.length} bronclaims voor ${METRIC_LABELS[metric]} (${values.map(value => shown({ ...pick, value })).join(", ")}); ` +
          `gerekend met claim #${pick.id}: de ${higher && same.length > 1
            ? `hoogste waarde ${ac(boundary) ? "aan de AC-kant of zonder vermelde meetgrens" : "aan de DC-kant"} (${boundaries[pick.boundary] || pick.boundary})`
            : `${same.length > 1 ? "laagste waarde bij de " : ""}meest geschikte meetgrens (${boundaries[boundary] || boundary})`}.`);
      }
      return pick;
    };
    // DC-claims die niet als AC-waarde mogen gelden, voor de toelichting.
    const dcOnly = metric => numbers.find(c => c.metric_key === metric && !AC_BOUNDARY.includes(c.boundary));
    const feature = metric => features.find(f => f.metric_key === metric);

    let capacity = null;
    const usable = claim("usable_energy_wh"), nominal = claim("nominal_energy_wh"),
      dod = claim("depth_of_discharge_pct");
    if (usable) { capacity = usable.value / 1000;
      notes.push(`Bruikbaar ${n(capacity)} kWh volgens bron${usable.boundary === "unspecified" ? " (meetgrens niet vermeld)" : ""}.`); }
    else if (nominal && dod) { capacity = nominal.value / 1000 * dod.value / 100;
      notes.push(`Bruikbaar afgeleid: nominaal ${n(nominal.value / 1000)} kWh × ontlaaddiepte ${n(dod.value, 0)}%.`); }
    else if (nominal) { capacity = nominal.value / 1000 * FALLBACK.usableShare / 100;
      notes.push(`Aanname: ${FALLBACK.usableShare}% van de opgegeven ${n(nominal.value / 1000)} kWh is bruikbaar; de bron noemt geen bruikbare capaciteit.`); }
    else missing.push("bruikbare capaciteit");

    const dcNote = (metric, what) => {
      const dc = dcOnly(metric);
      return dc ? ` De bron noemt alleen ${shown(dc)} ${what} aan de DC-kant (${boundaries[dc.boundary]}); dat is geen AC-waarde en telt niet mee.` : "";
    };
    const discharge = claim("continuous_discharge_power_w", AC_BOUNDARY), charge = claim("continuous_charge_power_w", AC_BOUNDARY);
    const dischargeKw = discharge ? discharge.value / 1000 : null;
    let chargeKw = charge ? charge.value / 1000 : null;
    if (dischargeKw == null) {
      missing.push(dcOnly("continuous_discharge_power_w") ? "ontlaadvermogen aan de AC-kant (de bron noemt alleen DC)"
        : "werkelijk ontlaadvermogen in kW (kVA telt niet)");
    }
    if (chargeKw == null && dischargeKw != null) { chargeKw = dischargeKw;
      notes.push(`Aanname: laadvermogen gelijk aan ontlaadvermogen; de bron noemt geen laadvermogen aan de AC-kant.${dcNote("continuous_charge_power_w", "laadvermogen")}`); }

    const rte = claim("round_trip_efficiency_pct", AC_BOUNDARY, unusableEfficiency);
    for (const c of numbers.filter(c => c.metric_key === "round_trip_efficiency_pct" && unusableEfficiency(c))) {
      notes.push(`Rendement ${n(c.value, Number.isInteger(c.value) ? 0 : 2)}% (claim #${c.id}) ${unusableEfficiency(c)}, en telt daarom niet mee.`);
    }
    let efficiency = FALLBACK.efficiency;
    if (rte) {
      efficiency = rte.value;
      const range = rte.qualifier === "range" ? `${n(rte.value, 0)}–${n(rte.upper_value, 0)}%, gerekend met de ondergrens` : `${n(rte.value, 0)}%`;
      notes.push(`Rendement ${range}${rte.boundary === "ac_ac" || rte.boundary === "system_ac" ? " (AC → AC)" : `; meetgrens ${rte.boundary === "pv_ac" ? "PV → accu → AC" : "niet vermeld"}, gebruikt als AC → AC-aanname`}.`);
    } else notes.push(`Aanname: ${FALLBACK.efficiency}% rendement heen en terug; de bron noemt geen AC-rendement.${dcNote("round_trip_efficiency_pct", "rendement")}`);

    const standbyClaim = claim("standby_power_w"), standby = standbyClaim ? standbyClaim.value : FALLBACK.standby;
    if (!standbyClaim) notes.push(`Aanname: ${FALLBACK.standby} W sluimerverbruik; niet opgegeven.`);
    notes.push(`Aanname: ${FALLBACK.degradation}% capaciteitsverlies per jaar en ${FALLBACK.life} jaar levensduur; geen garantie of fabrieksvoorspelling.`);

    const coupling = texts.find(t => t.metric_key === "coupling")?.value || "";
    const kind = /stekker/i.test(coupling) ? "plug" : coupling ? "fixed" : null;
    // Een stekkeraccu op een eigen groep heet in de onderzochte sets altijd ‘… eigen groep …’.
    const circuit = kind === "fixed" && /eigen groep/i.test(config.name);
    // Alleen aanbiedingen die niet betwist, vervangen of verlopen zijn.
    const now = Date.now() / 1000;
    const offers = cmp.offers.filter(o => live(o) && (o.valid_until_unix_s == null || o.valid_until_unix_s >= now));
    const offer = offers
      .filter(o => o.currency === "EUR" && o.minor_unit_exponent === 2 && o.tax_basis === "included")
      .sort((a, b) => b.observed_at_unix_s - a.observed_at_unix_s)[0] ?? null;
    // Een prijs zonder btw of na btw-teruggave wordt niet als aanschafprijs gebruikt, wel genoemd.
    const otherOffer = offer ? null : offers[0] ?? null;
    const phases = claim("phase_count")?.value ?? null;
    const sources = new Map();
    for (const { label, claim: c } of used) {
      sources.set(c.source_title, [...(sources.get(c.source_title) || []), `${label} #${c.id}`]);
    }
    if (sources.size) notes.push(`Gebruikte bronclaims: ${[...sources].map(([title, list]) => `${title} (${list.join(", ")})`).join("; ")}.`);
    const warranty = cmp.warranties.filter(w => w.configuration_id === config.id && w.product_months != null).map(w => w.product_months);
    return {
      config, name: `${config.manufacturer_name} ${config.product_name} · ${config.name}`,
      capacity, chargeKw, dischargeKw, efficiency, standby, notes, missing, coupling, kind, circuit,
      phases, backup: feature("backup"), outdoor: feature("outdoor"),
      inverterIncluded: feature("inverter_included")?.status === "supported", offer, otherOffer,
      warrantyYears: warranty.length ? Math.max(...warranty) / 12 : null,
      battery: capacity != null && dischargeKw != null ? {
        usable_capacity_kwh: capacity, charge_power_kw: chargeKw, discharge_power_kw: dischargeKw,
        ac_round_trip_efficiency_pct: efficiency, standby_w: standby,
        annual_capacity_loss_pct: FALLBACK.degradation, operating_life_years: FALLBACK.life
      } : null
    };
  }

  // Kostenindicatie voor alle 26 posten. `item`: { kind, circuit, manufacturer, phases, inverterIncluded };
  // `situation`: { place, backup, phases } uit de keuzehulp. Elke regel noemt een bron of aanname.
  // Een stekkeraccu op een eigen groep (`circuit`) krijgt de stekkerposten plus een extra groep,
  // geen installatiepakket.
  function estimateCosts(catalogData, item, situation = {}) {
    const { amounts, meters, facts } = catalogData.estimates;
    const circuit = item.circuit === true && item.kind !== "plug", fixed = item.kind !== "plug" && !circuit;
    const byMaker = list => list.find(x => x.manufacturer === item.manufacturer);
    const lines = new Map(catalogData.categories.map(c => [c.key,
      { category: c.key, status: "not_applicable", amount_minor: 0, timing: c.timing, year: null, source: "Aanname", notes: "" }]));
    const set = (key, status, source, notes, eur = 0) =>
      Object.assign(lines.get(key),
        { status, amount_minor: status === "priced" ? Math.round(eur * 100) : 0, source, notes });
    const priced = (key, ref, eur = ref.amount_eur) => set(key, "priced", ref.url, `${ref.label}. ${ref.detail}`, eur);
    const assume = (key, notes, status = "not_applicable") => set(key, status, "Aanname", notes);
    const fact = (key, f, status = "not_applicable") => set(key, status, f.url, f.detail);
    const pack = detail => ({ url: amounts.installation_basic.url, detail });

    set("battery", "unknown", "Nog in te vullen", "Aanschafprijs van de accu.");
    if (item.inverterIncluded) set("inverter", "included", "Bronclaim van de fabrikant",
      "De omvormer zit in het product.");
    else set("inverter", "unknown", "Nog in te vullen",
      "Dit product heeft een aparte of hybride omvormer nodig; vraag de prijs na.");

    // Wat een aanbieding volgens de bron al omvat, telt niet nog eens als aparte post.
    const offer = item.offer;
    const inOffer = what => ({ url: offer.source_url, detail: `Inbegrepen in de aanbieding van ${offer.seller} (${what}).` });
    if (offer?.includes_inverter === true) fact("inverter", inOffer("omvormer"), "included");

    if (fixed) {
      const outside = situation.place === "outside", package_ = outside ? amounts.installation_extended : amounts.installation_basic;
      if (offer?.includes_installation === true) {
        fact("installation", inOffer("installatie; meerwerk na de schouw komt daar nog bij"), "included");
        for (const key of ["ems_metering", "cabling_protection", "survey_permits"]) fact(key, inOffer("installatie"), "included");
      } else {
        priced("installation", package_);
        fact("ems_metering", pack("Meting via P1 of CT-klem zit in het installatiepakket."), "included");
        fact("cabling_protection",
          pack(outside ? "Langere kabelroute, doorvoer en extra beveiliging zitten in het uitgebreide pakket." : "Aparte groep met beveiliging zit in het basispakket."),
          "included");
        fact("survey_permits", pack("Een schouw vooraf is altijd inbegrepen."), "included");
      }
      if (situation.backup === "yes") priced("backup", amounts.backup_extra);
        else assume("backup", "Geen noodstroom gevraagd.");
      if (item.phases === 3) priced("meter_cabinet", amounts.meter_cabinet_three_phase);
      else fact("meter_cabinet",
        pack("De aparte groep zit in het pakket. Een verouderde groepenkast vervangen (vanaf € 919) is niet meegeteld."),
        "included");
      if (item.phases === 3 && situation.phases === "1") priced("grid_connection", amounts.grid_one_to_three_phase);
      else assume("grid_connection",
        item.phases === 3 ? "Uitgaande van een bestaande 3-fasenaansluiting." : "Geen wijziging van de netaansluiting nodig.");
      assume("delivery",
        "Levering en voorrijkosten worden in de bron niet apart genoemd; aangenomen dat ze in pakket- of productprijs zitten.");
      // Zit de installatie in de aanbieding, dan geldt de reserve voor meerwerk over de indicatieve pakketprijs.
      const included = lines.get("installation").status === "included";
      const base = [...lines.values()].filter(l => ["installation", "backup", "meter_cabinet",
        "grid_connection"].includes(l.category)).reduce((sum, l) => sum + l.amount_minor,
        included ? Math.round(package_.amount_eur * 100) : 0);
      set("contingency", "priced", "Aanname",
        `${amounts.contingency_pct.label}. ${amounts.contingency_pct.detail}` +
          (included ? ` De installatie zit in de aanbieding; de reserve voor meerwerk rekent met de indicatieve pakketprijs van € ${n(package_.amount_eur, 0)}.` : ""),
        base / 100 * amounts.contingency_pct.amount_pct / 100);
    } else {
      assume("installation", "Stekkerbatterij: zelf aan te sluiten in een gewoon stopcontact.");
      assume("cabling_protection",
        "Aanname: geen installatiewerk. Een stopcontact op een groep waarop ook andere zware apparaten draaien kan overbelast raken; laat bij twijfel een installateur kijken of een eigen groep nodig is (dat kost extra) en controleer de voorwaarden van je verzekering.");
      assume("meter_cabinet", "Aanname: geen aanpassing van de meterkast; geldt alleen als de groep van het stopcontact het extra vermogen veilig aankan.");
      assume("survey_permits", "Geen schouw of keuring nodig voor een stekkerbatterij tot 800 W.");
      assume("backup", "Een stekkerbatterij levert geen noodstroom aan de woning.");
      assume("grid_connection", "Geen wijziging van de netaansluiting nodig.");
      assume("contingency", "Geen installatiewerk, dus geen reserve aangenomen.");
      const own = byMaker(meters), meter = own || meters.find(m => m.manufacturer === "HomeWizard");
      if (own) priced("ems_metering", own);
      else set("ems_metering", "priced", meter.url,
        `Aanname: een vergelijkbare P1-meter (${meter.label}) is nodig voor de regeling.`, meter.amount_eur);
      const delivery = byMaker(facts.delivery_free);
      if (delivery) fact("delivery", delivery, "included");
        else assume("delivery", "Verzendkosten niet vermeld; aangenomen dat ze in de prijs zitten.");
      if (circuit) {
        const group = amounts.dedicated_circuit;
        priced("installation", group);
        fact("cabling_protection", { url: group.url, detail: "De aansluiting met beveiliging zit in de richtprijs van de extra groep." },
          "included");
        assume("meter_cabinet",
          "Aanname: er is plek in de groepenkast. Een volle of verouderde kast uitbreiden of vervangen (vanaf € 919) is niet meegeteld.");
        assume("survey_permits",
          "De elektricien beoordeelt de aansluiting bij het aanleggen van de groep; een aparte keuring is niet meegeteld.");
        set("contingency", "priced", "Aanname",
          `${amounts.contingency_pct.label}, hier over de extra groep. ${amounts.contingency_pct.detail}`,
          group.amount_eur * amounts.contingency_pct.amount_pct / 100);
      }
    }
    const software = byMaker(facts.software_free);
    if (software) fact("subscription", software);
      else assume("subscription", "Geen abonnement vermeld voor de basisfuncties; aangenomen dat de app gratis is.");
    assume("maintenance",
      "Geen onderhoudskosten opgegeven; een LFP-accu met software-updates vraagt normaal geen periodiek onderhoud.");
    fact("insurance", facts.insurance);
    fact("extra_grid_fees", facts.grid_fees);
    assume("extra_contract_fees", "Een vast of variabel contract rekent geen extra kosten voor een accu.");
    for (const key of ["tax_administration", "tax_private_use", "vat_refund"]) fact(key, facts.vat);
    assume("other_upfront", "Geen overige startkosten bekend.");
    assume("other_annual", "Geen overige jaarkosten bekend.");
    assume("inverter_replacement",
      "De omvormer is onderdeel van het product; vervanging valt binnen de aangenomen levensduur van het geheel.");
    assume("battery_replacement", "Geen vervanging: het model stopt de accu na de aangenomen levensduur.");
    fact("removal_recycling", facts.recycling);
    fact("grant", facts.grant);
    assume("residual_value", "Geen restwaarde aangenomen (voorzichtig).");
    return [...lines.values()];
  }
  const isAssumption = line => line.source === "Aanname" || line.notes.startsWith("Aanname");

  // Standaard projectie-aannames, aanpasbaar in Instellingen; nooit voor bewaarde runs.
  const DEFAULTS = { start_year: 2027, horizon_years: 15, discount_pct: 4, annual_cost_escalation_pct: 2,
    annual_pv_loss_pct: 0, annual_load_growth_pct: 0, annual_price_change_pct: 0, price_uncertainty_pct: 20,
    cost_uncertainty_pct: 15 };
  // Oudere versies bewaarden de aannames per formulierveld-id.
  const LEGACY_IDS = { start_year: "analysis-start", horizon_years: "analysis-years",
    discount_pct: "analysis-discount", annual_cost_escalation_pct: "cost-escalation",
    annual_pv_loss_pct: "pv-degradation", annual_load_growth_pct: "load-growth",
    annual_price_change_pct: "tariff-escalation", price_uncertainty_pct: "price-uncertainty",
    cost_uncertainty_pct: "cost-uncertainty" };
  const defaults = () => {
    const legacy = UI.store.get("thuisaccu-defaults", {});
    const migrated = Object.fromEntries(Object.entries(LEGACY_IDS).map(([key, id]) => [key,
      Number(legacy[id])]).filter(([, v]) => Number.isFinite(v)));
    const saved = UI.store.get("thuisaccu-standaard", migrated), out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) if (Number.isFinite(saved[key])) out[key] = saved[key];
    return out;
  };

  return {
    RULES, described, CREDITS, modelChanges, unaffectedByModel, ASSUMED, KEUZEHULP_PREFIX, isAssumed, fromKeuzehulp, MODEL_VERSION, GLOSSARY, QUOTE_FIELDS, isPriceField, quoteValue, quoteUnit, quoteChange, applyQuotePrice,
    catalog, costs, typicalSources, imports, runs, invalidateCatalog, objectives, costStatus, boundaries,
      qualifiers, review,
    RESEARCHED_ON, RESEARCHED_SPAN, priceAge, suitability, isDemo, FALLBACK, describe, estimateCosts, isAssumption, DEFAULTS, defaults
  };
})();
