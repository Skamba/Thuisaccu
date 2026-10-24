"use strict";

// Keuzehulp: vragen in gewone taal, daarna een doorrekening met zichtbare aannames.
// Indicaties en aannames worden altijd getoond en kunnen worden aangepast; onbekend blijft onbekend.
window.Keuzehulp = (() => {
  const { $, el, button, link, badge, api, table, formatNumber: n, formatMoney: money, formatKwh: kwh } = UI;
  const STORE = "thuisaccu-keuzehulp";
  const RESEARCHED_ON = "24 oktober 2026";
  // Indicaties uit openbare bronnen; nooit stilzwijgend gebruikt.
  const INDICATION = {
    import: 0.2596,
    importText: "Indicatie € 0,26: gemiddeld variabel leveringstarief september 2026 (€ 0,1487, CBS) plus energiebelasting 2026 (€ 0,11085), beide per kWh inclusief btw. Vaste en dynamische contracten wijken af.",
    export: 0.0744,
    exportText: "Indicatie € 0,07: vanaf 2027 tot 2030 is de terugleververgoeding wettelijk minimaal 50% van de kale leveringsprijs. Bij € 0,1487 is dat ongeveer € 0,07. Of de grens inclusief of exclusief btw geldt, is niet geverifieerd. Je contract kan hoger zijn.",
    sources: [
      ["CBS: Verdeling energietarieven 2026 (september 2026)", "https://www.cbs.nl/nl-nl/maatwerk/2026/42/verdeling-energietarieven-2026"],
      ["ANWB: tarieven energiebelasting 2026", "https://www.anwb.nl/huis/energie/energiebelasting"],
      ["Solar Magazine: minimaal 50% terugleververgoeding tot 2030", "https://solarmagazine.nl/nieuws-zonne-energie/i39030/salderingsregeling-hoogte-terugleververgoeding-en-verlaging-terugleverkosten-in-wet-vastgelegd-door-tweede-kamer"]
    ]
  };
  // Rekenaannames voor gegevens die een fabrikant niet opgeeft; zichtbaar per accu.
  const FALLBACK = { usableShare: 90, efficiency: 85, standby: 5, degradation: 2, life: 15 };
  const blank = { panels: "yes", data: "totals", importId: "", gridImport: "", gridExport: "", production: "", kwp: "", orientation: "south", phases: "unknown", install: "any", place: "any", backup: "no", contract: "unknown", tariffImport: "", tariffExport: "", exportFee: "0", objective: "net_present_value", budget: "", horizon: "15", place_name: "" };
  let answers = { ...blank, ...UI.read(STORE, {}) }, flow, adviceHost, latest = null;
  const save = () => UI.write(STORE, answers);
  const number = value => value === "" || value == null ? null : Number(String(value).replace(",", "."));

  function field(label, key, attrs = {}, help) {
    const wrap = el("label", label), input = el("input"); input.value = answers[key] ?? ""; input.dataset.key = key;
    Object.assign(input, { type: "number", inputMode: "decimal", step: "any", ...attrs });
    input.addEventListener("input", () => { answers[key] = input.value; save(); refreshDerived(); });
    wrap.append(input); if (help) wrap.append(el("small", help, "muted")); return wrap;
  }
  function choice(legend, key, options, help) {
    const set = el("fieldset", null, "choice"); set.append(el("legend", legend));
    for (const [value, text, detail] of options) {
      const label = el("label", null, "choice-option"), input = el("input"); input.type = "radio"; input.name = `kh-${key}`; input.value = value; input.checked = answers[key] === value;
      input.addEventListener("change", () => { answers[key] = value; save(); render(); });
      const body = el("span"); body.append(el("strong", text)); if (detail) body.append(el("small", detail, "muted")); label.append(input, body); set.append(label);
    }
    if (help) set.append(el("p", help, "muted")); return set;
  }
  function select(label, key, options) {
    const wrap = el("label", label), input = el("select"); input.dataset.key = key;
    for (const [value, text] of options) { const o = el("option", text); o.value = value; input.append(o); }
    input.value = answers[key]; input.addEventListener("change", () => { answers[key] = input.value; save(); refreshDerived(); }); wrap.append(input); return wrap;
  }

  // Bruto verbruik = netafname + opwek − teruglevering (energiebalans zonder bestaande accu).
  function gross() {
    const imported = number(answers.gridImport); if (imported == null) return null;
    if (answers.panels === "no") return imported;
    const exported = number(answers.gridExport), produced = number(answers.production) ?? (number(answers.kwp) != null && latest?.yields ? number(answers.kwp) * latest.yields[answers.orientation] : null);
    if (exported == null || produced == null) return null;
    return imported + produced - exported;
  }
  function refreshDerived() {
    const out = $("kh-gross"); if (!out) return;
    const value = gross(), estimated = answers.panels === "yes" && number(answers.production) == null;
    out.textContent = value == null ? "Vul de getallen in om je totale verbruik te zien." : value <= 0 ? "Deze getallen kloppen niet: teruglevering is groter dan opwek plus afname." : `Je huis gebruikt in totaal ongeveer ${kwh(value)} per jaar${answers.panels === "yes" ? " (afname + opwek − teruglevering)" : ""}${estimated ? "; de opwek is geschat uit kWp" : ""}.`;
  }

  function stepEnergy() {
    const box = el("div");
    box.append(el("h2", "Je energie"), el("p", "Een accu slaat zonnestroom op die je overdag over hebt, om die ’s avonds zelf te gebruiken. Daarvoor kijken we naar je verbruik en je zonnepanelen.", "lead"));
    box.append(choice("Heb je zonnepanelen?", "panels", [["yes", "Ja"], ["no", "Nee"]]));
    box.append(choice("Welke gegevens heb je?", "data", [
      ["totals", "Jaartotalen", "Van je jaarafrekening en de app van je omvormer. We maken er een geschat uurprofiel van."],
      ["file", "Een bestand met uur- of kwartierwaarden", "Bijvoorbeeld een export van je omvormer of slimme meter (P1). Nauwkeuriger."]
    ]));
    if (answers.data === "file") {
      const fit = (window.Workspace?.data?.imports || []).filter(i => UI.suitability(i).ok === true);
      if (fit.length) {
        const options = [["", "Kies een bewaard profiel…"], ...fit.map(i => [String(i.id), i.filename])];
        if (!options.some(([v]) => v === answers.importId)) answers.importId = "";
        box.append(select("Bewaard energieprofiel", "importId", options));
      } else box.append(el("p", "Je hebt nog geen bruikbaar bestand bewaard. Importeer eerst één volledig jaar met opwek en verbruik (of P1-afname en -teruglevering); kom daarna terug.", "callout"));
      const actions = el("p", null, "actions"); actions.append(link("Importeer een bestand", "#/opwek/import", "button secondary")); box.append(actions);
      return box;
    }
    const grid = el("div", null, "field-grid");
    grid.append(field("Stroom van het net per jaar (kWh)", "gridImport", { min: "0", max: "100000", required: true }, "Op je jaarafrekening: ‘levering’ of ‘verbruik’. Bij een dag/nacht-meter tel je beide op."));
    if (answers.panels === "yes") {
      grid.append(field("Teruggeleverd aan het net per jaar (kWh)", "gridExport", { min: "0", max: "100000", required: true }, "Op je jaarafrekening: ‘teruglevering’."));
      grid.append(field("Opwek van je panelen per jaar (kWh)", "production", { min: "0", max: "100000" }, "In de app van je omvormer. Weet je het niet? Vul dan het vermogen hieronder in."));
      grid.append(field("Of: vermogen van je panelen (kWp)", "kwp", { min: "0.1", max: "100" }, "Aantal panelen × wattpiek per paneel ÷ 1000, bijvoorbeeld 10 × 400 Wp = 4 kWp."));
      grid.append(select("Ligging van de panelen", "orientation", [["south", "Zuid"], ["south_east", "Zuidoost"], ["south_west", "Zuidwest"], ["east_west", "Oost en west"], ["east", "Oost"], ["west", "West"]]));
    }
    box.append(grid);
    const derived = el("p", null, "derived"); derived.id = "kh-gross"; derived.setAttribute("aria-live", "polite"); box.append(derived);
    box.append(el("p", "We maken hiermee een geschat uurprofiel: het standaardverbruiksprofiel voor huishoudens (E1A 2026) en zonnedata van PVGIS voor De Bilt. Je echte pieken en dalen zijn groter, dus de uitkomst is een indicatie. Je gegevens blijven op deze computer.", "muted"));
    return box;
  }
  function stepHome() {
    const box = el("div"); box.append(el("h2", "Je woning"), el("p", "Deze vragen bepalen welke accu’s praktisch passen.", "lead"));
    box.append(choice("Hoe wil je de accu aansluiten?", "install", [
      ["plug", "Zelf, met de stekker", "Stekkerbatterij tot 800 W in een gewoon stopcontact. Goedkoper, kleiner, geen installateur."],
      ["fixed", "Laten installeren", "Vaste aansluiting in de meterkast. Meer vermogen en capaciteit, hogere kosten."],
      ["any", "Weet ik nog niet", "We laten beide soorten zien."]
    ]));
    box.append(choice("Wat voor aansluiting heb je?", "phases", [
      ["1", "1-fase", "Eén hoofdschakelaar in de meterkast, vaak 1×35 A of 1×40 A."],
      ["3", "3-fase", "Drie hoofdschakelaars of een brede driepolige schakelaar, vaak 3×25 A."],
      ["unknown", "Weet ik niet"]
    ], "Een paar accu’s werken alleen op 3-fase. Stekkerbatterijen werken op beide."));
    box.append(choice("Waar kan de accu staan?", "place", [["inside", "Binnen", "Bijvoorbeeld meterkast, berging of zolder (vorstvrij)."], ["outside", "Buiten", "Tegen de gevel of in een schuur zonder verwarming."], ["any", "Maakt niet uit"]]));
    box.append(choice("Wil je noodstroom bij een stroomstoring?", "backup", [["no", "Niet nodig"], ["yes", "Ja, dat is belangrijk", "Veel accu’s schakelen bij een storing uit. Noodstroom vraagt vaak extra onderdelen."]]));
    return box;
  }
  function stepContract() {
    const box = el("div"); box.append(el("h2", "Je energiecontract"), el("p", "Vanaf 1 januari 2027 stopt de salderingsregeling. Stroom die je teruglevert, levert dan minder op dan stroom die je koopt. Dat verschil bepaalt wat een accu bespaart.", "lead"));
    box.append(choice("Wat voor contract heb je?", "contract", [["fixed", "Vast"], ["variable", "Variabel"], ["dynamic", "Dynamisch (prijs per uur)"], ["unknown", "Weet ik niet"]]));
    if (answers.contract === "dynamic") box.append(el("p", "Met een dynamisch contract kan een accu ook geld verdienen door goedkoop te laden en duur te gebruiken. Dat rekent deze keuzehulp nog niet: we rekenen met een gemiddelde prijs. De uitkomst kan daardoor lager uitvallen dan in werkelijkheid.", "callout"));
    const grid = el("div", null, "field-grid");
    grid.append(field("Prijs voor stroom van het net (€ per kWh, alles inbegrepen)", "tariffImport", { min: "-1", max: "2", step: "0.0001" }, INDICATION.importText));
    grid.append(field("Vergoeding voor teruglevering vanaf 2027 (€ per kWh)", "tariffExport", { min: "-1", max: "2", step: "0.0001" }, INDICATION.exportText));
    grid.append(field("Terugleverkosten (€ per kWh)", "exportFee", { min: "0", max: "2", step: "0.0001" }, "Sommige leveranciers rekenen kosten per teruggeleverde kWh. Staat dit niet in je contract, laat dan 0 staan. Hogere terugleverkosten maken een accu gunstiger."));
    box.append(grid, button("Gebruik de indicaties", () => { answers.tariffImport = String(INDICATION.import); answers.tariffExport = String(INDICATION.export); save(); render(); }));
    box.append(sourceList(INDICATION.sources));
    return box;
  }
  function stepGoal() {
    const box = el("div"); box.append(el("h2", "Wat vind je belangrijk?"), el("p", "We vergelijken elke passende accu met géén accu. ‘Geen accu’ kan ook de beste keuze zijn.", "lead"));
    box.append(choice("Wanneer is een accu voor jou de beste?", "objective", [
      ["net_present_value", "Als hij over de hele looptijd het meeste oplevert", "Rekent toekomstige besparingen om naar geld van nu (netto contante waarde)."],
      ["payback", "Als ik mijn geld zo snel mogelijk terugverdien"],
      ["self_consumption", "Als ik zo veel mogelijk eigen zonnestroom gebruik", "Ook als dat financieel niet uitkomt."]
    ]));
    const grid = el("div", null, "field-grid");
    grid.append(field("Maximaal budget (€, optioneel)", "budget", { min: "0", max: "100000", step: "1" }, "Alle startkosten samen: accu, installatie en eventuele extra’s."));
    grid.append(select("Hoe lang wil je vooruitkijken?", "horizon", [["10", "10 jaar"], ["15", "15 jaar"], ["20", "20 jaar"]]));
    box.append(grid);
    return box;
  }

  function sourceList(sources) {
    const details = el("details", null, "sources"); details.append(el("summary", "Bronnen"));
    const list = el("ul"); for (const [title, href] of sources) { const li = el("li"), a = link(title, href); a.target = "_blank"; a.rel = "noopener noreferrer"; li.append(a); list.append(li); }
    details.append(list, el("p", `Geraadpleegd op ${RESEARCHED_ON}.`, "muted")); return details;
  }

  // Leidt rekengegevens af uit bronclaims; elke aanname wordt met naam vastgelegd.
  function product(cmp, config) {
    const live = row => row.configuration_id === config.id && !["superseded", "disputed"].includes(row.review_status);
    const numbers = cmp.numbers.filter(live), features = cmp.features.filter(live), texts = cmp.texts.filter(live);
    const order = ["system_ac", "ac_ac", "unspecified", "pv_ac", "battery_dc", "dc_dc"];
    const claim = metric => numbers.filter(x => x.metric_key === metric).sort((a, b) => order.indexOf(a.boundary) - order.indexOf(b.boundary))[0];
    const text = metric => texts.find(t => t.metric_key === metric)?.value;
    const feature = metric => features.find(f => f.metric_key === metric);
    const notes = [], missing = [];
    let capacity = null; const usable = claim("usable_energy_wh"), nominal = claim("nominal_energy_wh"), dod = claim("depth_of_discharge_pct");
    if (usable) { capacity = usable.value / 1000; notes.push(`Bruikbaar ${n(capacity)} kWh volgens bron${usable.boundary === "unspecified" ? " (meetgrens niet vermeld)" : ""}.`); }
    else if (nominal && dod) { capacity = nominal.value / 1000 * dod.value / 100; notes.push(`Bruikbaar afgeleid: nominaal ${n(nominal.value / 1000)} kWh × ontlaaddiepte ${n(dod.value, 0)}%.`); }
    else if (nominal) { capacity = nominal.value / 1000 * FALLBACK.usableShare / 100; notes.push(`Aanname: ${FALLBACK.usableShare}% van de opgegeven ${n(nominal.value / 1000)} kWh is bruikbaar; de bron noemt geen bruikbare capaciteit.`); }
    else missing.push("bruikbare capaciteit");
    const discharge = claim("continuous_discharge_power_w"), charge = claim("continuous_charge_power_w");
    let dischargeKw = discharge ? discharge.value / 1000 : null, chargeKw = charge ? charge.value / 1000 : null;
    if (dischargeKw == null) missing.push("werkelijk ontlaadvermogen (kW, geen kVA)");
    if (chargeKw == null && dischargeKw != null) { chargeKw = dischargeKw; notes.push("Aanname: laadvermogen gelijk aan ontlaadvermogen; de bron noemt geen laadvermogen."); }
    const rte = claim("round_trip_efficiency_pct"); let efficiency;
    if (rte) { efficiency = rte.value; notes.push(`Rendement ${rte.qualifier === "range" ? `${n(rte.value, 0)}–${n(rte.upper_value, 0)}%, gerekend met de ondergrens` : `${n(rte.value, 0)}%`}${rte.boundary === "ac_ac" ? " (AC→AC)" : `; meetgrens ${rte.boundary === "pv_ac" ? "PV→accu→AC" : "niet vermeld"}, gebruikt als AC→AC-aanname`}.`); }
    else { efficiency = FALLBACK.efficiency; notes.push(`Aanname: ${FALLBACK.efficiency}% rendement heen en terug; de bron noemt geen round-trip-rendement.`); }
    const standbyClaim = claim("standby_power_w"), standby = standbyClaim ? standbyClaim.value : FALLBACK.standby;
    if (!standbyClaim) notes.push(`Aanname: ${FALLBACK.standby} W sluimerverbruik; niet opgegeven.`);
    notes.push(`Aanname: ${FALLBACK.degradation}% capaciteitsverlies per jaar en ${FALLBACK.life} jaar levensduur; geen garantie of fabrieksvoorspelling.`);
    const coupling = text("coupling") || "", kind = /stekker/i.test(coupling) ? "plug" : coupling ? "fixed" : null;
    const phases = claim("phase_count")?.value ?? null;
    const offer = cmp.offers.filter(o => o.configuration_id === config.id && o.currency === "EUR" && o.minor_unit_exponent === 2 && o.tax_basis === "included").sort((a, b) => b.observed_at_unix_s - a.observed_at_unix_s)[0];
    const warranty = cmp.warranties.filter(w => w.configuration_id === config.id && w.product_months != null).map(w => w.product_months);
    return { config, name: `${config.manufacturer_name} ${config.product_name} · ${config.name}`, capacity, chargeKw, dischargeKw, efficiency, standby, notes, missing, coupling, kind, phases, backup: feature("backup"), outdoor: feature("outdoor"), inverterIncluded: feature("inverter_included")?.status === "supported", offer, warrantyYears: warranty.length ? Math.max(...warranty) / 12 : null };
  }
  // Indicatie voor alle kostenposten. Elke regel noemt een bron of is als aanname benoemd; de
  // accuprijs zelf vult de aanroeper in. `item`: { kind, manufacturer, phases, inverterIncluded }.
  function estimateCosts(catalog, item, situation = {}) {
    const est = catalog.estimates, amounts = est.amounts, facts = est.facts, fixed = item.kind !== "plug";
    const byMaker = list => list.find(x => x.manufacturer === item.manufacturer);
    const lines = new Map(catalog.categories.map(c => [c.key, { category: c.key, status: "not_applicable", amount_minor: 0, timing: c.timing, year: null, source: "Aanname", notes: "" }]));
    const set = (key, status, source, notes, eur = 0) => Object.assign(lines.get(key), { status, amount_minor: status === "priced" ? Math.round(eur * 100) : 0, source, notes });
    const priced = (key, ref, eur = ref.amount_eur) => set(key, "priced", ref.url, `${ref.label}. ${ref.detail}`, eur);
    const assume = (key, notes, status = "not_applicable") => set(key, status, "Aanname", notes);
    const fact = (key, f, status = "not_applicable") => set(key, status, f.url, f.detail);
    set("battery", "unknown", "Nog in te vullen", "Aanschafprijs van de accu.");
    if (item.inverterIncluded) set("inverter", "included", "Bronclaim van de fabrikant", "De omvormer zit in het product.");
    else set("inverter", "unknown", "Nog in te vullen", "Dit product heeft een aparte of hybride omvormer nodig; vraag de prijs na.");
    if (fixed) {
      const outside = situation.place === "outside";
      priced("installation", outside ? amounts.installation_extended : amounts.installation_basic);
      fact("ems_metering", { url: amounts.installation_basic.url, detail: "Meting via P1 of CT-klem zit in het installatiepakket." }, "included");
      fact("cabling_protection", { url: amounts.installation_basic.url, detail: outside ? "Langere kabelroute, doorvoer en extra beveiliging zitten in het uitgebreide pakket." : "Aparte groep met beveiliging zit in het basispakket." }, "included");
      fact("survey_permits", { url: amounts.installation_basic.url, detail: "Een schouw vooraf is altijd inbegrepen." }, "included");
      if (situation.backup === "yes") priced("backup", amounts.backup_extra); else assume("backup", "Geen noodstroom gevraagd.");
      if (item.phases === 3) priced("meter_cabinet", amounts.meter_cabinet_three_phase);
      else fact("meter_cabinet", { url: amounts.installation_basic.url, detail: "De aparte groep zit in het pakket. Een verouderde groepenkast vervangen (vanaf € 919) is niet meegeteld." }, "included");
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
      const meter = byMaker(est.meters) || est.meters.find(m => m.manufacturer === "HomeWizard");
      if (byMaker(est.meters)) priced("ems_metering", meter); else set("ems_metering", "priced", meter.url, `Aanname: een vergelijkbare P1-meter (${meter.label}) is nodig voor de regeling.`, meter.amount_eur);
      const delivery = byMaker(facts.delivery_free);
      if (delivery) fact("delivery", delivery, "included"); else assume("delivery", "Verzendkosten niet vermeld; aangenomen dat ze in de prijs zitten.");
    }
    const software = byMaker(facts.software_free);
    if (software) fact("subscription", software); else assume("subscription", "Geen abonnement vermeld voor de basisfuncties; aangenomen dat de app gratis is.");
    assume("maintenance", "Geen onderhoudskosten opgegeven; een LFP-accu met software-updates vraagt normaal geen periodiek onderhoud.");
    fact("insurance", facts.insurance);
    fact("extra_grid_fees", facts.grid_fees);
    assume("extra_contract_fees", "Een vast of variabel contract rekent geen extra kosten voor een accu.");
    fact("tax_administration", facts.vat); fact("tax_private_use", facts.vat); fact("vat_refund", facts.vat);
    assume("other_upfront", "Geen overige startkosten bekend."); assume("other_annual", "Geen overige jaarkosten bekend.");
    assume("inverter_replacement", "De omvormer is onderdeel van het product; vervanging valt binnen de aangenomen levensduur van het geheel.");
    assume("battery_replacement", "Geen vervanging: het model stopt de accu na de aangenomen levensduur.");
    fact("removal_recycling", facts.recycling);
    fact("grant", facts.grant);
    assume("residual_value", "Geen restwaarde aangenomen (voorzichtig).");
    return [...lines.values()];
  }
  const isAssumption = line => line.source === "Aanname" || line.notes.startsWith("Aanname");

  function fit(p) {
    const no = [], notes = [];
    if (answers.install === "plug" && p.kind === "fixed") no.push("Moet door een installateur worden aangesloten.");
    if (answers.install === "fixed" && p.kind === "plug") no.push("Dit is een stekkerbatterij, geen vaste installatie.");
    if (p.kind == null) notes.push("Soort aansluiting onbekend.");
    if (p.phases === 3 && answers.phases === "1") no.push("Werkt alleen op een 3-fasenaansluiting.");
    if (p.phases === 3 && answers.phases === "unknown") notes.push("Werkt alleen op een 3-fasenaansluiting; controleer je meterkast.");
    if (answers.backup === "yes") { if (p.backup?.status === "unsupported") no.push("Geen noodstroom."); else if (p.backup?.status === "conditional") notes.push(`Noodstroom onder voorwaarden: ${p.backup.conditions}`); else if (!p.backup || p.backup.status === "unknown") notes.push("Onbekend of noodstroom mogelijk is."); }
    if (answers.place === "outside" && p.outdoor?.status === "unsupported") no.push("Niet geschikt voor buiten.");
    if (/hybride/i.test(p.coupling)) notes.push("Hybride systeem: combineert met of vervangt je omvormer. Laat een installateur dat beoordelen.");
    if (/DC/.test(p.coupling) && !/hybride/i.test(p.coupling)) notes.push("Heeft een geschikte (hybride) omvormer nodig.");
    if (p.missing.length) notes.push(`Kan nog niet worden doorgerekend: ${p.missing.join(" en ")} onbekend.`);
    if (!p.offer) notes.push("Geen gepubliceerde prijs gevonden; vul een offertebedrag in om mee te rekenen.");
    return { ok: !no.length, no, notes };
  }

  function capacityAdvice(points) {
    const max = points[points.length - 1].battery_to_load_kwh; if (!(max > 0)) return null;
    const at = share => points.find(p => p.battery_to_load_kwh >= share * max)?.usable_capacity_kwh;
    return { low: at(0.75), high: at(0.9), max };
  }
  async function ensureProfile() {
    if (answers.data === "file") { if (!answers.importId) throw new Error("Kies eerst een bewaard energieprofiel in stap 1."); return Number(answers.importId); }
    const consumption = gross(); if (!(consumption > 0)) throw new Error("Vul in stap 1 je afname, teruglevering en opwek (of kWp) in.");
    const solar = answers.panels === "yes" ? { orientation: answers.orientation, annual_production_kwh: number(answers.production) ?? null, peak_power_kwp: number(answers.production) == null ? number(answers.kwp) : null } : null;
    const result = await api("/api/v1/solar/typical", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ annual_consumption_kwh: consumption, solar }) });
    return result.id;
  }

  async function advice() {
    adviceHost.replaceChildren(el("p", "Je advies wordt voorbereid…", "muted"));
    const [importId, cmp, costs] = await Promise.all([ensureProfile(), api("/api/v1/comparison"), api("/api/v1/analysis/costs")]);
    const curve = await api(`/api/v1/solar/imports/${importId}/capacity`);
    adviceHost.replaceChildren();
    const points = curve.points, base = points[0], range = capacityAdvice(points);
    const size = el("section", null, "panel"); size.append(el("p", "STAP 1 VAN HET ADVIES", "eyebrow"), el("h2", "Hoe groot moet een accu zijn?"));
    if (!range) size.append(el("p", answers.panels === "no" ? "Zonder zonnepanelen is er geen zonnestroom om op te slaan. In deze keuzehulp levert een accu dan niets op. Met een dynamisch contract kan dat anders zijn; dat rekenen we nog niet." : "Je hebt vrijwel geen zonnestroom over om op te slaan. Een accu levert in deze berekening weinig op."));
    else {
      size.append(el("p", `Zonder accu gebruik je ongeveer ${n(base.self_consumption_pct, 0)}% van je zonnestroom zelf. Met een accu kan dat oplopen, maar elke extra kWh wordt minder vaak gevuld. Een bruikbare capaciteit van ongeveer ${n(range.low, 0)} tot ${n(range.high, 0)} kWh benut het meeste van wat er te halen is.`, "lead"));
      size.append(UI.chart("line", { title: "Zonnestroom die je via de accu zelf gebruikt, per accugrootte", rows: points.map(p => ({ label: `${n(p.usable_capacity_kwh, 0)} kWh`, values: [p.battery_to_load_kwh] })), series: [{ label: "Uit de accu zelf gebruikt (kWh per jaar)" }], unit: "kWh/jaar" }));
      size.append(el("p", curve.assumptions, "muted"));
    }
    adviceHost.append(size);

    const products = cmp.configurations.filter(c => c.product_kind === "battery_system").map(c => product(cmp, c)).map(p => ({ ...p, fit: fit(p) }));
    const pick = el("section", null, "panel"); pick.append(el("p", "STAP 2 VAN HET ADVIES", "eyebrow"), el("h2", "Welke accu’s passen bij je woning?"));
    if (!products.length) { pick.append(el("p", "Er staan nog geen accu’s in je catalogus."), button("Laad onderzochte accu’s", async () => { await api("/api/v1/references", { method: "POST" }); window.dispatchEvent(new Event("app:data")); await advice(); }, "")); adviceHost.append(pick); return; }
    pick.append(el("p", `Gegevens en prijzen zijn bronmomentopnamen van ${RESEARCHED_ON}. Controleer de actuele prijs bij de verkoper. Een vinkje betekent: neem mee in de berekening.`, "muted"));
    const cards = el("div", null, "kh-products"), selected = new Map();
    const sorted = [...products].sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok) || (a.capacity ?? 99) - (b.capacity ?? 99));
    let preselected = 0;
    for (const p of sorted) {
      const card = el("article", null, `panel kh-product${p.fit.ok ? "" : " kh-unfit"}`), head = el("div", null, "kh-product-head"), check = el("input"); check.type = "checkbox"; check.id = `kh-pick-${p.config.id}`;
      check.disabled = !p.fit.ok || p.missing.length > 0;
      // Standaard maximaal zes passende accu's met een bekende prijs; de rest kan de gebruiker aanvinken.
      check.checked = !check.disabled && Boolean(p.offer) && preselected < 6;
      if (check.checked) preselected++;
      const label = el("label", p.name); label.htmlFor = check.id; head.append(check, label);
      card.append(head, el("p", [p.kind === "plug" ? "Stekkerbatterij" : p.kind === "fixed" ? "Vaste installatie" : "Aansluiting onbekend", p.capacity != null ? `${n(p.capacity, 1)} kWh bruikbaar` : "capaciteit onbekend", p.dischargeKw != null ? `${n(p.dischargeKw, 1)} kW ontladen` : "vermogen onbekend", p.warrantyYears ? `${n(p.warrantyYears, 0)} jaar productgarantie` : null].filter(Boolean).join(" · ")));
      if (p.capacity != null && range) card.append(badge(p.capacity < range.low ? "Kleiner dan het zinvolle bereik" : p.capacity > range.high ? "Groter dan het zinvolle bereik" : "Binnen het zinvolle bereik", p.capacity >= range.low && p.capacity <= range.high ? "success" : ""));
      for (const reason of p.fit.no) card.append(el("p", `Past niet: ${reason}`, "warning"));
      for (const note of p.fit.notes) card.append(el("p", note, "muted"));
      const price = el("label", "Aanschafprijs (€, incl. btw)"), priceInput = el("input"); priceInput.type = "number"; priceInput.min = "0"; priceInput.step = "0.01"; priceInput.inputMode = "decimal";
      priceInput.value = p.offer ? String(p.offer.upfront_amount_minor / 100) : ""; priceInput.placeholder = "Offertebedrag"; price.append(priceInput);
      if (p.offer) { const a = link(`Prijs volgens ${p.offer.seller}`, p.offer.source_url), small = el("small", null, "muted"); a.target = "_blank"; a.rel = "noopener noreferrer"; small.append(a, p.offer.includes_installation === false ? " · exclusief installatie" : ""); price.append(small); }
      card.append(price);
      const lines = estimateCosts(costs, { kind: p.kind, manufacturer: p.config.manufacturer_name, phases: p.phases, inverterIncluded: p.inverterIncluded }, answers);
      const editor = costEditor(lines, costs.categories, priceInput); card.append(editor.element);
      const assumptions = el("details"); assumptions.append(el("summary", "Zo rekenen we met deze accu"), table(["Rekengegeven", "Waarde"], [["Bruikbare capaciteit", p.capacity != null ? `${n(p.capacity, 2)} kWh` : "Onbekend"], ["Laden / ontladen (AC)", p.chargeKw != null && p.dischargeKw != null ? `${n(p.chargeKw, 2)} / ${n(p.dischargeKw, 2)} kW` : "Onbekend"], ["Rendement heen en terug", `${n(p.efficiency, 0)}%`], ["Sluimerverbruik", `${n(p.standby, 0)} W`]]));
      const ul = el("ul"); for (const note of p.notes) ul.append(el("li", note)); assumptions.append(ul, link("Bekijk alle bronclaims in de vergelijking", "#/accus")); card.append(assumptions);
      selected.set(p.config.id, { p, check, priceInput, editor }); cards.append(card);
    }
    pick.append(cards); adviceHost.append(pick);

    const run = el("section", null, "panel"); run.append(el("p", "STAP 3 VAN HET ADVIES", "eyebrow"), el("h2", "Reken het door"));
    const counted = el("details", null, "callout"); counted.append(el("summary", "Wat telt mee?"));
    counted.append(el("p", "Alle kostenposten hebben een indicatie: aanschaf, installatie, meter, noodstroom, meterkast en netaansluiting waar nodig, en de jaarlijkse en latere posten. Bij elke post staat de bron of de aanname; pas bedragen aan zodra je een offerte hebt. Je besparing op de energierekening rekent laadverliezen, sluimerverbruik en capaciteitsverlies al mee."));
    counted.append(el("p", "Niet meegeteld: meerwerk dat een installateur pas bij de schouw ziet (zoals hak- en breekwerk of een verouderde groepenkast), lokale subsidies en handel met een dynamisch contract.")); run.append(counted);
    const confirm = el("fieldset"); confirm.append(el("legend", "Bevestig"));
    const boxes = [
      answers.data === "file" ? "Mijn bestand bevat de opwek van mijn omvormer en het totale verbruik van het huis (of P1-afname en -teruglevering waaruit dat is afgeleid), zonder bestaande accu." : "Ik begrijp dat mijn verbruik en opwek zijn geschat uit jaartotalen met standaardprofielen.",
      "Ik begrijp dat de accugegevens uit de bronnen komen, aangevuld met de genoemde aannames, en dat de keuzehulp niet controleert of een accu in mijn meterkast past.",
      "Ik begrijp dat de kosten indicaties zijn uit de genoemde bronnen en aannames, en dat een offerte voor mijn woning daarvoor in de plaats komt."
    ].map(text => { const label = el("label", null, "inline"), input = el("input"); input.type = "checkbox"; input.required = true; label.append(input, ` ${text}`); confirm.append(label); return input; });
    run.append(confirm);
    const status = el("p", null, "muted"); status.setAttribute("aria-live", "polite");
    const go = button("Bereken mijn advies", async () => {
      try {
        if (!boxes.every(b => b.checked)) throw new Error("Vink de drie bevestigingen aan.");
        const chosen = [...selected.values()].filter(s => s.check.checked);
        if (!chosen.length) throw new Error("Kies minstens één accu om mee te vergelijken.");
        if (chosen.length > 12) throw new Error("Kies maximaal twaalf accu’s.");
        const request = buildRequest(importId, chosen);
        go.disabled = true; status.textContent = "Bezig met rekenen…";
        const response = await api("/api/v1/analysis/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
        await window.Analysis?.refreshData?.(); location.hash = `/scenarios/${response.id}`;
      } catch (error) { status.textContent = error.message; UI.toast(error.message, true); } finally { go.disabled = false; }
    }, "");
    run.append(go, status); adviceHost.append(run);
  }

  // Bewerkbare kostenopbouw per accu; een ingevuld bedrag vervangt de indicatie.
  function costEditor(lines, categories, priceInput) {
    const labels = Object.fromEntries(categories.map(c => [c.key, c.label])), inputs = new Map();
    const box = el("details", null, "kh-costs"), summary = el("summary"), totals = el("p", null, "muted"); box.append(summary);
    const statusText = { included: "Inbegrepen", not_applicable: "Niet van toepassing", unknown: "Nog in te vullen" };
    const item = line => {
      const row = el("div", null, "kh-cost"), head = el("div", null, "kh-cost-head"), name = el("span", labels[line.category]);
      if (line.timing === "event" || ["grant", "vat_refund"].includes(line.category)) head.append(name, el("span", line.status === "priced" ? money(line.amount_minor / 100) : statusText[line.status], "kh-cost-status"));
      else {
        const amount = el("input"); Object.assign(amount, { type: "number", min: "0", step: "0.01", inputMode: "decimal", placeholder: statusText[line.status] || "" });
        amount.value = line.status === "priced" ? String(line.amount_minor / 100) : ""; amount.setAttribute("aria-label", `${labels[line.category]} in euro`);
        amount.addEventListener("input", update); inputs.set(line.category, amount); head.append(name, amount);
      }
      const basis = el("p", null, "kh-cost-basis"); basis.append(badge(isAssumption(line) ? "Aanname" : "Bron", isAssumption(line) ? "warning" : "success"), " ", line.notes.replace(/^Aanname: /, ""));
      if (/^https:\/\//.test(line.source)) { const a = link("bron", line.source); a.target = "_blank"; a.rel = "noopener noreferrer"; basis.append(" · ", a); }
      row.append(head, basis); return row;
    };
    box.append(totals);
    const groups = [["Startkosten", l => l.timing === "upfront" && !["grant", "vat_refund"].includes(l.category)], ["Per jaar", l => l.timing === "annual"], ["Later en aftrekposten", l => l.timing === "event" || ["grant", "vat_refund"].includes(l.category)]];
    for (const [title, match] of groups) {
      const group = lines.filter(l => l.category !== "battery" && match(l)), shown = group.filter(l => l.status !== "not_applicable"), rest = group.filter(l => l.status === "not_applicable");
      const section = el("div", null, "kh-cost-group"); section.append(el("h4", title), ...shown.map(item));
      if (rest.length) { const more = el("details"); more.append(el("summary", `${rest.length} ${rest.length === 1 ? "post" : "posten"} niet van toepassing`), ...rest.map(item)); section.append(more); }
      box.append(section);
    }
    priceInput.addEventListener("input", update);
    function collect() {
      return lines.map(line => {
        const input = inputs.get(line.category); if (!input) return { ...line };
        const value = number(input.value), original = line.status === "priced" ? line.amount_minor : null;
        if (value != null && value > 0) return Math.round(value * 100) === original ? { ...line } : { ...line, status: "priced", amount_minor: Math.round(value * 100), source: "Eigen invoer in de keuzehulp", notes: `Aangepast; indicatie was: ${line.notes}` };
        if (original != null) return { ...line, status: "not_applicable", amount_minor: 0, source: "Eigen invoer in de keuzehulp", notes: "Door de gebruiker op nul gezet." };
        return { ...line };
      });
    }
    function update() {
      const all = collect(), start = all.filter(l => l.timing === "upfront" && l.status === "priced" && !["grant", "vat_refund"].includes(l.category)).reduce((t, l) => t + l.amount_minor, 0) / 100 + (number(priceInput.value) || 0);
      const yearly = all.filter(l => l.timing === "annual" && l.status === "priced").reduce((t, l) => t + l.amount_minor, 0) / 100, open = all.filter(l => l.status === "unknown" && l.category !== "battery").length;
      summary.textContent = `Kosten: ${money(start, { decimals: 0 })} bij de start${yearly ? ` + ${money(yearly, { decimals: 0 })} per jaar` : ""}${open ? ` · ${open} nog in te vullen` : ""}`;
      totals.textContent = `Startkosten inclusief accu: ${money(start, { decimals: 0 })}. Jaarlijkse extra kosten: ${money(yearly, { decimals: 0 })}. Vul een offertebedrag in om een indicatie te vervangen.`;
    }
    update();
    return { element: box, collect, label: key => labels[key] };
  }

  function buildRequest(importId, chosen) {
    const defaults = UI.read("thuisaccu-defaults", {}), d = (id, fallback) => { const v = Number(defaults[id]); return defaults[id] !== undefined && defaults[id] !== "" && Number.isFinite(v) ? v : fallback; };
    const tariffImport = number(answers.tariffImport), tariffExport = number(answers.tariffExport), exportFee = number(answers.exportFee) ?? 0, horizon = Number(answers.horizon);
    if (tariffImport == null || tariffExport == null) throw new Error("Vul in stap 3 je stroomprijs en terugleververgoeding in, of kies ‘Gebruik de indicaties’.");
    const candidates = chosen.map(({ p, priceInput, editor }) => {
      const price = number(priceInput.value); if (!(price > 0)) throw new Error(`Vul een aanschafprijs in voor ${p.name}.`);
      const fromOffer = p.offer && Math.round(price * 100) === p.offer.upfront_amount_minor;
      const lines = editor.collect();
      const open = lines.find(l => l.status === "unknown" && l.category !== "battery");
      if (open) throw new Error(`Vul bij ${p.name} een bedrag in voor ‘${editor.label(open.category)}’.`);
      Object.assign(lines.find(l => l.category === "battery"), { status: "priced", amount_minor: Math.round(price * 100), source: fromOffer ? `${p.offer.seller}: ${p.offer.source_url} (geraadpleegd ${RESEARCHED_ON})` : "Eigen invoer in de keuzehulp", notes: fromOffer ? "Gepubliceerde prijs inclusief btw, exclusief installatie." : "Door de gebruiker ingevoerd bedrag." });
      return { key: `c${p.config.id}`, name: p.name, configuration_id: p.config.id, battery: { usable_capacity_kwh: p.capacity, charge_power_kw: p.chargeKw, discharge_power_kw: p.dischargeKw, ac_round_trip_efficiency_pct: p.efficiency, standby_w: p.standby, annual_capacity_loss_pct: FALLBACK.degradation, operating_life_years: FALLBACK.life }, costs: lines, financing: { loan_amount_eur: 0, annual_interest_pct: 0, years: 0 }, assumptions: `Keuzehulp. ${p.notes.join(" ")}` };
    });
    const objective = answers.objective, budget = number(answers.budget);
    return {
      title: `Keuzehulp ${new Date().toLocaleDateString("nl-NL")}`, solar_import_id: importId,
      site: { address: answers.place_name?.trim() || "Nederland (keuzehulp, geen adres opgegeven)", latitude: null, longitude: null, bag_id: null },
      parameters: { start_year: 2027, horizon_years: horizon, discount_pct: d("analysis-discount", 4), annual_cost_escalation_pct: d("cost-escalation", 2), annual_pv_loss_pct: d("pv-degradation", 0), annual_load_growth_pct: d("load-growth", 0), objective, budget_eur: budget, tariff: { import_eur_per_kwh: tariffImport, export_eur_per_kwh: tariffExport, export_fee_eur_per_kwh: exportFee, export_fee_bands: [], fixed_annual_eur: 0, annual_price_change_pct: d("tariff-escalation", 0) }, price_uncertainty_pct: d("price-uncertainty", 20), cost_uncertainty_pct: d("cost-uncertainty", 15) },
      candidates, costs_confirmed: true, technical_assumptions_confirmed: true, consumption_is_gross: true, production_is_ac: true
    };
  }

  function validateStep(panel, index) {
    if (!UI.validate(panel)) return false;
    if (index === 0) {
      if (answers.data === "file" && !answers.importId) { UI.toast("Kies een bewaard energieprofiel of kies ‘Jaartotalen’.", true); return false; }
      if (answers.data === "totals") {
        if (answers.panels === "yes" && number(answers.production) == null && number(answers.kwp) == null) { UI.toast("Vul de opwek van je panelen of het vermogen in kWp in.", true); return false; }
        const g = gross(); if (g != null && !(g > 0)) { UI.toast("Deze getallen kloppen niet: teruglevering is groter dan opwek plus afname.", true); return false; }
      }
    }
    if (index === 2 && (number(answers.tariffImport) == null || number(answers.tariffExport) == null)) { UI.toast("Vul je stroomprijs en terugleververgoeding in, of kies ‘Gebruik de indicaties’.", true); return false; }
    return true;
  }

  const steps = [["Je energie", stepEnergy], ["Je woning", stepHome], ["Je contract", stepContract], ["Wat je belangrijk vindt", stepGoal], ["Advies", null]];
  let panels = [];
  function render() {
    // Herbouwen na een keuze; de focus blijft op hetzelfde veld zodat toetsenbordgebruik niet springt.
    const active = document.activeElement, key = active?.name || active?.dataset?.key, value = active?.type === "radio" ? active.value : null;
    steps.forEach(([, build], i) => { if (build) panels[i].replaceChildren(build()); });
    if (key) [...document.querySelectorAll(`#keuzehulp-flow [name="${key}"], #keuzehulp-flow [data-key="${key}"]`)].find(e => value == null || e.value === value)?.focus();
    refreshDerived();
  }
  function mount() {
    const out = UI.screens.get("keuzehulp"); if (out.dataset.mounted) return; out.dataset.mounted = "true";
    const intro = el("div", null, "kh-intro"); intro.append(el("p", "In vijf stappen zie je of een thuisaccu bij je past, hoe groot hij moet zijn en welke accu’s in aanmerking komen. Duurt ongeveer vijf minuten.", "lead"));
    const reset = button("Begin opnieuw", () => { answers = { ...blank }; UI.write(STORE, null); render(); flow.show(0); }, "text-button"); intro.append(reset);
    const host = el("form", null, "kh-flow"); host.id = "keuzehulp-flow"; host.noValidate = true; host.addEventListener("submit", e => e.preventDefault());
    panels = steps.map(() => el("div", null, "wizard-step")); adviceHost = panels[4]; adviceHost.id = "kh-advice";
    host.append(...panels); out.append(intro, host);
    flow = UI.wizard(host, steps.map(([label], i) => ({ label, panel: panels[i] })), { validateStep, onChange: index => { if (index === 4) advice().catch(error => { adviceHost.replaceChildren(el("p", error.message, "warning"), button("← Terug naar de vragen", () => flow.show(0))); }); window.scrollTo(0, 0); } });
    render();
  }
  // Opbrengst per kWp voor de schatting uit kWp; zonder dit blijft de afgeleide som onbekend.
  api("/api/v1/solar/typical").then(s => { latest = { yields: s.pv.annual_kwh_per_kwp }; refreshDerived(); }).catch(() => {});
  UI.ready.then(() => { mount(); window.addEventListener("app:route", ({ detail }) => { if (detail.key === "keuzehulp") render(); }); });
  return { get answers() { return answers; }, estimateCosts, describe: product };
})();
