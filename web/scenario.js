"use strict";

// Zelf doorrekenen: alle aannames, accu-opties en 26 kostenposten zelf invullen.
// De toestand staat in één object (ook als concept in deze browser) en het scherm wordt daaruit opgebouwd.
window.Scenario = (() => {
  const { h, button, link, badge, table, field, input, numberInput, select, checkbox, money, number: n, parse, plain, store,
    toast } = UI;
  const STORE = "thuisaccu-scenario";
  const TECH = [
    ["usable_capacity_kwh", "Bruikbare capaciteit (kWh)", "0.01", "1000"],
      ["charge_power_kw", "Laden AC (kW)", "0.01", "1000"],
    ["discharge_power_kw", "Ontladen AC (kW)", "0.01", "1000"],
      ["ac_round_trip_efficiency_pct", "Rendement AC → AC (%)", "1", "100"],
    ["standby_w", "Sluimerverbruik (W)", "0", "10000"],
      ["annual_capacity_loss_pct", "Capaciteitsverlies per jaar (%)", "0", "20",
        "Een gegarandeerde restcapaciteit van 70% na 10 jaar is ongeveer 3,5% verlies per jaar."],
    ["operating_life_years", "Levensduur (jaar)", "1", "30",
      "Na zoveel jaar stopt de accu in de berekening. Garantie is geen levensduur: garantiejaren zijn vaak korter dan hoe lang een accu meegaat."]
  ];
  const PARAMS = [
    ["start_year", "Startjaar", "2026", "2100", "1"], ["horizon_years", "Looptijd (jaren)", "1", "30", "1"],
      ["discount_pct", "Discontovoet per jaar (%)", "0", "30", "0.1"],
    ["annual_cost_escalation_pct", "Stijging extra jaarkosten (%)", "-20", "30", "0.1"],
      ["annual_pv_loss_pct", "Afname PV-opwek per jaar (%)", "0", "10", "0.1"],
    ["annual_load_growth_pct", "Verandering verbruik per jaar (%)", "-20", "30", "0.1"],
      ["price_uncertainty_pct", "Tariefvariatie gevoeligheid (%)", "0", "80", "1"],
    ["cost_uncertainty_pct", "Kostenvariatie gevoeligheid (%)", "0", "80", "1"]
  ];
  // Extra verbruik vanaf een later jaar, met dezelfde vormen als het geschatte profiel (crates/server/src/typical_profile.rs).
  const CHANGES = {
    heat_pump: { label: "Warmtepomp", max: 30000, kwh: "2500" },
    ev: { label: "Elektrische auto", max: 20000, kwh: "2000" }
  };
  const CHARGING = [["evening", "’s Avonds, vanaf 18.00 uur"], ["night", "’s Nachts, vanaf 01.00 uur"],
    ["daytime", "Overdag, vanaf 11.00 uur"]];
  // Omschrijving zonder adres, hier en in de keuzehulp; een kopie begint dan met een leeg adresveld.
  const NO_ADDRESS = /^Nederland \((keuzehulp, )?geen adres opgegeven\)$/;
  const blankOption = (index, extra = {}) => ({
    key: `optie-${Date.now().toString(36)}-${index}`, name: `Eigen optie ${index}`, configuration_id: null,
      kind: "fixed",
    battery: Object.fromEntries(TECH.map(([key]) => [key, ""])), assumptions: "", costs: {},
      loan: { amount: "0", interest: "0", years: "0" }, ...extra
  });
  function blank() {
    const d = Data.defaults();
    return {
      title: "Mijn berekening", address: "", site: null, profile: "", objective: "net_present_value", budget: "",
      params: Object.fromEntries(PARAMS.map(([key]) => [key, plain(d[key])])),
      tariff: { import: "", export: "", fee: "", change: String(d.annual_price_change_pct), bands: "", fixed: 0 },
      variant: { on: false, label: "Stresstest: geen terugleververgoeding vanaf 2030", year: "2030", export: "0", fee: "" },
        changes: [], basis: null, options: []
    };
  }
  let state = { ...blank(), ...store.get(STORE, {}) }, flow = null, saveTimer = null;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(STORE, state), 300); };
  const bindValue = (control, read, write) => { control.value = read() ?? "";
    control.addEventListener("input", () => { write(control.value); persist(); }); return control; };

  // Neemt een bewaarde run over als nieuw concept; bevestigingen worden nooit overgenomen.
  // `extra` komt uit de offertecheck: een andere naam, de herkomst (`quote_basis`) en de stap om te openen.
  function load(request, extra = {}) {
    const money2 = minor => (minor / 100).toFixed(2);
    state = {
      title: `${request.title} (kopie)`, address: NO_ADDRESS.test(request.site.address) ? "" : request.site.address,
        site: request.site.latitude != null ? request.site : null, profile: String(request.solar_import_id),
      objective: request.parameters.objective,
        budget: request.parameters.budget_eur == null ? "" : plain(request.parameters.budget_eur),
      params: Object.fromEntries(PARAMS.map(([key]) => [key, plain(request.parameters[key])])),
      tariff: { import: plain(request.parameters.tariff.import_eur_per_kwh),
        export: plain(request.parameters.tariff.export_eur_per_kwh),
        fee: plain(request.parameters.tariff.export_fee_eur_per_kwh),
        change: plain(request.parameters.tariff.annual_price_change_pct),
        bands: request.parameters.tariff.export_fee_bands.map(b => `${b.up_to_kwh ?? ""};${b.annual_eur}`).join("\n"),
        fixed: request.parameters.tariff.fixed_annual_eur },
      variant: request.parameters.export_variant ? {
        on: true, label: request.parameters.export_variant.label,
          year: plain(request.parameters.export_variant.from_calendar_year),
        export: plain(request.parameters.export_variant.export_eur_per_kwh),
          fee: plain(request.parameters.export_variant.export_fee_eur_per_kwh)
      } : blank().variant,
      changes: (request.load_changes || []).map(c => ({ kind: c.kind, year: plain(c.from_calendar_year),
        kwh: plain(c.annual_kwh), charging: c.charging || "evening" })),
      options: request.candidates.map((c, i) => ({
        key: c.key, name: c.name, configuration_id: c.configuration_id, kind: "fixed", assumptions: c.assumptions,
        battery: Object.fromEntries(TECH.map(([key]) => [key, plain(c.battery[key])])),
        costs: Object.fromEntries(c.costs.map(l => [l.category,
          { status: l.status, amount: l.status === "priced" ? money2(l.amount_minor) : "",
            year: l.year == null ? "" : plain(l.year), source: l.source, notes: l.notes }])),
        loan: { amount: plain(c.financing.loan_amount_eur), interest: plain(c.financing.annual_interest_pct),
          years: plain(c.financing.years) },
          index: i
      }))
    };
    Object.assign(state, extra);
    store.set(STORE, state);
  }
  // De herkomst uit de offertecheck, met de waarden zoals ze nu in de opgebouwde optie staan; wat je
  // daarna terugzette naar de oude waarde vervalt, en zonder verschil vervalt de hele herkomst.
  function basis(candidates) {
    const option = state.basis && candidates.find(o => o.key === state.basis.candidate_key);
    const changes = option ? state.basis.changes.map(c => ({ ...c, after: Data.quoteValue(option, c.field) }))
      .filter(c => Number.isFinite(c.after) && c.after !== c.before) : [];
    // De prijsopbouw hoort bij de totaalprijs; zonder die wijziging vervalt hij.
    const { price, ...rest } = state.basis || {};
    return changes.length ? { ...rest, changes, ...(price && changes.some(c => c.field === "upfront_eur") ? { price } : {}) } : null;
  }

  function bands() {
    const text = state.tariff.bands.trim();
    if (!text) return [];
    return text.split(/\r?\n/).map(line => {
      const parts = line.split(";");
      if (parts.length !== 2) throw new Error("Terugleverstaffel: gebruik per regel ‘bovengrens;jaarkosten’, met een lege laatste bovengrens.");
      const up = parts[0].trim() ? parse(parts[0]) : null, annual = parse(parts[1]);
      if ((parts[0].trim() && up == null) || annual == null) throw new Error("Terugleverstaffel: ongeldige getallen.");
      return { up_to_kwh: up, annual_eur: annual };
    });
  }
  // Bouwt het API-verzoek en verzamelt alle problemen tegelijk, zodat de controlestap ze kan tonen.
  function build(categories) {
    const problems = [],
      number = (raw, what) => { const v = parse(raw); if (v == null) problems.push(`${what} ontbreekt.`);
        return v ?? 0; };
    if (!state.title.trim()) problems.push("Geef de berekening een naam.");
    if (!state.profile) problems.push("Kies een energieprofiel.");
    if (!state.options.length) problems.push("Voeg minstens één accu-optie toe.");
    let exportBands = [];
    try { exportBands = bands(); } catch (error) { problems.push(error.message); }
    const horizon = parse(state.params.horizon_years);
    const parameters = {
      ...Object.fromEntries(PARAMS.map(([key, label]) => [key, number(state.params[key], label)])),
      objective: state.objective, budget_eur: parse(state.budget),
      tariff: { import_eur_per_kwh: number(state.tariff.import, "Stroomprijs"),
        export_eur_per_kwh: number(state.tariff.export, "Terugleververgoeding"),
        export_fee_eur_per_kwh: number(state.tariff.fee, "Terugleverkosten"), export_fee_bands: exportBands,
        fixed_annual_eur: state.tariff.fixed, annual_price_change_pct: number(state.tariff.change, "Prijsverandering") },
      // Pieken binnen de meetperiode volgens gemeten huishoudens; zie docs/roi-model.md.
      load_variation: "households"
    };
    if (state.variant.on) {
      if (!state.variant.label.trim()) problems.push("Geef de terugleveringsvariant een omschrijving.");
      parameters.export_variant = {
        label: state.variant.label.trim(),
          from_calendar_year: number(state.variant.year, "Beginjaar terugleveringsvariant"),
        export_eur_per_kwh: number(state.variant.export, "Vergoeding in de variant"),
        export_fee_eur_per_kwh: number(state.variant.fee, "Terugleverkosten in de variant")
      };
    }
    const start = parse(state.params.start_year), last = start != null && horizon != null ? start + horizon - 1 : null;
    const load_changes = (state.changes || []).map(change => {
      const kind = CHANGES[change.kind], year = parse(change.year), kwh = parse(change.kwh);
      if (year == null || last == null || year < start || year > last) {
        problems.push(`${kind.label}: kies een beginjaar binnen de looptijd${last == null ? "" : ` (${start} tot en met ${last})`}.`);
      }
      if (kwh == null || kwh < 1 || kwh > kind.max) problems.push(`${kind.label}: vul 1 tot ${n(kind.max, 0)} kWh extra per jaar in.`);
      return { kind: change.kind, from_calendar_year: year ?? 0, annual_kwh: kwh ?? 0,
        ...(change.kind === "ev" ? { charging: change.charging } : {}) };
    });
    const candidates = state.options.map(option => {
      const battery = Object.fromEntries(TECH.map(([key, label]) => [key,
        number(option.battery[key], `${option.name}: ${label}`)]));
      if (!option.assumptions.trim()) problems.push(`${option.name}: beschrijf bron en aannames van de techniek.`);
      const costs = categories.map(c => {
        const line = option.costs[c.key] || { status: "unknown", amount: "", year: "", source: "", notes: "" };
        if (line.status === "unknown") problems.push(`${option.name}: kostenpost ‘${c.label}’ is nog onbekend.`);
        let amount = 0;
        if (line.status === "priced") {
          // Nederlandse notatie mag (6.500,00); hele centen, zoals de kostenposten.
          const euro = parse(line.amount);
          if (euro == null || euro < 0 || Math.abs(euro * 100 - Math.round(euro * 100)) > 1e-6) problems.push(`${option.name}: bedrag voor ‘${c.label}’ in euro met hoogstens twee decimalen.`);
          else amount = Math.round(euro * 100);
          if (c.timing === "event" && !(parse(line.year) >= 1 && parse(line.year) <= horizon)) problems.push(`${option.name}: jaar voor ‘${c.label}’ moet binnen de looptijd vallen.`);
        }
        if (line.status !== "unknown" && !String(line.source || "").trim()) problems.push(`${option.name}: geef een bron of aanname voor ‘${c.label}’.`);
        return { category: c.key, status: line.status, amount_minor: amount, timing: c.timing,
          year: line.status === "priced" && c.timing === "event" ? parse(line.year) : null,
          source: String(line.source || "").trim(), notes: line.notes || "Invoer in Zelf doorrekenen" };
      });
      return { key: option.key, name: option.name, configuration_id: option.configuration_id, battery, costs,
        financing: { loan_amount_eur: parse(option.loan.amount) ?? 0, annual_interest_pct: parse(option.loan.interest) ?? 0, years: parse(option.loan.years) ?? 0 }, assumptions: option.assumptions };
    });
    // Het adres is alleen een label bij de berekening; zonder adres dezelfde omschrijving als in de keuzehulp.
    const site = state.site && state.site.address === state.address ? state.site
      : { address: state.address.trim() || "Nederland (geen adres opgegeven)", latitude: null, longitude: null, bag_id: null };
    return { problems,
      request: { title: state.title.trim(), solar_import_id: Number(state.profile), site, parameters, candidates,
        ...(load_changes.length ? { load_changes } : {}), ...(basis(candidates) ? { quote_basis: basis(candidates) } : {}) } };
  }

  function stepProfile(body) {
    const results = h("div"),
      address = bindValue(input({ maxlength: "500",
        placeholder: "Postcode + huisnummer of straat en plaats" }),
        () => state.address, v => { state.address = v; });
    const lookup = button("Zoek adres via PDOK", () => UI.busy(lookup, async () => {
      const found = (await UI.api("/api/v1/locations/search",
        { method: "POST", json: { query: state.address } })).results;
      results.replaceChildren(found.length ? field("Gevonden adressen", select([["", "Kies het juiste adres…"], ...found.map((s, i) => [String(i), s.address])], "", { onchange: event => {
        const site = found[Number(event.target.value)]; if (!site) return;
        state.site = site; state.address = site.address; address.value = site.address; persist();
      } })) : h("p", { class: "help" }, "Geen adressen gevonden. Je kunt het adres ook handmatig gebruiken."));
    }), "secondary");
    const totals = new Map(), changes = h("div"), sums = [];
    const profile = select([["", "Profielen laden…"]], "",
      { required: true, onchange: event => { state.profile = event.target.value; persist(); showSums(); } });
    const showSums = () => sums.forEach(show => show());
    // Per verandering het verbruik vanaf dat jaar: profiel plus alles wat er tot en met dat jaar bij komt.
    function renderChanges() {
      state.changes ||= [];
      sums.length = 0;
      changes.replaceChildren(...state.changes.map((change, index) => {
        const kind = CHANGES[change.kind], sum = h("p", { class: "help", "aria-live": "polite" });
        sums.push(() => {
          const { kwh: base, name } = totals.get(state.profile) || {}, year = parse(change.year);
          const extras = state.changes.map(c => [parse(c.year), parse(c.kwh)])
            .filter(([y, kwh]) => y != null && kwh != null && year != null && y <= year).map(([, kwh]) => kwh);
          sum.textContent = base != null && year != null && parse(change.kwh) != null
            ? `Je verbruik vanaf 1 januari ${year}: ${[base, ...extras].map(v => n(v, 0)).join(" + ")} = ongeveer ${n(extras.reduce((a, b) => a + b, base), 0)} kWh per jaar. ` +
              `De ${n(base, 0)} kWh is het bruto verbruik in profiel ‘${name}’: alles wat het huis gebruikt, ook direct van de panelen. ` +
              "Op je jaarafrekening staat alleen wat van het net kwam, dus daar staat een ander getal."
            : "Telt vanaf 1 januari van het gekozen jaar bovenop het verbruik in je energieprofiel.";
        });
        const own = (label, key, props, help) => field(label,
          bindValue(numberInput({ required: true, ...props }), () => change[key], v => { change[key] = v; showSums(); }), help);
        return h("fieldset", {}, h("legend", {}, kind.label),
          h("div", { class: "grid" },
            own("Vanaf jaar (1 januari)", "year", { min: "2026", max: "2100", step: "1" }),
            own("Extra verbruik (kWh per jaar)", "kwh", { min: "1", max: String(kind.max), step: "1" },
              change.kind === "heat_pump" ? "Wat er bij je huidige verbruik bij komt, niet je nieuwe totaal."
                : "Wat de auto thuis laadt, met 3,68 kW (16 A, één fase)."),
            change.kind === "ev" ? field("Laden", bindValue(select(CHARGING), () => change.charging, v => { change.charging = v; })) : null),
          sum,
          h("div", { class: "actions" }, button(`Verwijder ${kind.label.toLowerCase()}`, () => {
            state.changes.splice(index, 1); persist(); renderChanges(); }, "ghost")));
      }));
      showSums();
    }
    const addChange = kind => button(`+ ${CHANGES[kind].label}`, () => {
      const start = parse(state.params.start_year) ?? Data.defaults().start_year;
      const last = start + (parse(state.params.horizon_years) ?? Data.defaults().horizon_years) - 1;
      state.changes ||= [];
      state.changes.push({ kind, year: String(Math.min(start + 1, last)), kwh: CHANGES[kind].kwh, charging: "evening" });
      persist(); renderChanges();
    }, "secondary");
    Data.imports().then(items => {
      for (const item of items) if (item.summary.consumption_kwh != null) totals.set(String(item.id), { kwh: item.summary.consumption_kwh, name: item.filename });
      showSums();
      profile.replaceChildren(h("option", { value: "" }, "Kies een bewaard profiel…"), ...items.map(item => {
        const fit = Data.suitability(item);
        return h("option", { value: String(item.id), disabled: fit.ok === false },
          `${Data.isDemo(item) ? "FICTIEF · " : ""}${item.filename} · ${fit.reason}`);
      }));
      profile.value = state.profile;
    });
    body.append(h("h2", {}, "Profiel en doel"), h("div", { class: "grid" },
      field("Naam van de berekening",
        bindValue(input({ required: true, maxlength: "200" }), () => state.title, v => { state.title = v; })),
      field("Adres in Nederland (optioneel)", address, "Alleen een label bij de berekening. Alleen de zoekknop stuurt je zoekterm naar PDOK; aansluiting en contract worden niet uit het adres afgeleid.")),
      h("div", { class: "actions" }, lookup), results,
      h("div", { class: "grid" },
        field("Energieprofiel (volledig jaar met opwek en verbruik)", profile,
          h("span", {}, "Nog geen profiel? ", link("Importeer een bestand", "#/energie/import"),
            " of laat de keuzehulp een geschat profiel maken.")),
        field("Doel",
          bindValue(select(Object.entries(Data.objectives)), () => state.objective, v => { state.objective = v; })),
        field("Maximale startinvestering (€, optioneel)", bindValue(numberInput({ min: "0", step: "0.01", placeholder: "Geen maximum" }), () => state.budget, v => { state.budget = v; }))),
      h("section", { class: "panel" }, h("h3", {}, "Verandering in verbruik (optioneel)"),
        h("p", { class: "help" }, "Komt er later een warmtepomp of elektrische auto bij? Dan telt dat verbruik vanaf 1 januari van het jaar dat je kiest. " +
          "De warmtepomp volgt de buitentemperatuur van 2023 in De Bilt, met een gelijkmatig deel voor warm tapwater; de auto laadt elke dag even veel. " +
          "Rekent je profiel met gemeten netafname en teruglevering, dan schat het model vanaf dat jaar hoeveel opwek en verbruik samenvallen; de uitkomst is vanaf dan wat minder zeker. " +
          "De aanschaf van de warmtepomp of auto en het gas of de benzine die je bespaart tellen niet mee: het extra verbruik zit zowel in ‘geen accu’ als in iedere accu-optie, dus de uitkomst gaat alleen over de accu."),
        h("details", {}, h("summary", {}, "Hoeveel kWh gebruikt een warmtepomp?"),
          h("p", {}, "Kijk eerst in de offerte of het advies van je installateur. Staat het er niet in: Milieu Centraal rekent voor een goed geïsoleerd hoekhuis met 2 personen " +
            "dat een volledige warmtepomp het hele gasverbruik van ongeveer 950 m³ vervangt door 3.400 kWh stroom, ongeveer 3.150 kWh meer dan met een cv-ketel. " +
            "Een hybride warmtepomp halveert in een matig geïsoleerd hoekhuis het gasverbruik van 1.360 naar 680 m³, met ongeveer 1.600 kWh extra stroom."),
          h("p", {}, "Daaruit volgt grofweg, per m³ gas dat je nu per jaar verbruikt (onze afleiding): volledige warmtepomp 3,3 kWh extra, hybride warmtepomp 1,2 kWh extra. " +
            "Bij 1.200 m³ gas is dat ongeveer 4.000 kWh voor een volledige en 1.450 kWh voor een hybride warmtepomp. Je eigen huis, isolatie en warmtepomp kunnen flink afwijken."),
          h("p", {}, UI.external("Milieu Centraal: volledige warmtepomp (gewijzigd 14 oktober 2026)",
            "https://www.milieucentraal.nl/energie-besparen/duurzaam-verwarmen-en-koelen/volledige-warmtepomp/"), " · ",
          UI.external("Milieu Centraal: hybride warmtepomp (gewijzigd 14 oktober 2026)",
            "https://www.milieucentraal.nl/energie-besparen/duurzaam-verwarmen-en-koelen/hybride-warmtepomp/"))),
        changes, h("div", { class: "actions" }, addChange("heat_pump"), addChange("ev"))));
    renderChanges();
  }

  // Optionele tweede doorrekening met andere terugleverprijzen vanaf een gekozen jaar.
  function variantFields() {
    const v = state.variant, toggle = checkbox("Reken ook een variant met andere terugleverprijzen door");
    const own = (label, key, props, help) =>
      field(label,
        bindValue(numberInput({ step: "0.0001", required: true, ...props }), () => v[key],
          value => { v[key] = value; }),
        help);
    const fields = h("div", { class: "grid" },
      field("Omschrijving",
        bindValue(input({ required: true, maxlength: "200" }), () => v.label, value => { v.label = value; })),
      own("Vanaf kalenderjaar", "year", { min: "2026", max: "2100", step: "1" }, "Moet op of na het startjaar liggen."),
      own("Vergoeding in de variant (€/kWh)", "export", { min: "-10", max: "10" }),
      own("Terugleverkosten in de variant (€/kWh)", "fee", { min: "0", max: "10" }));
    // Uitgeschakelde velden tellen niet mee in de formuliercontrole.
    const show = () => { fields.hidden = !v.on;
      fields.querySelectorAll("input").forEach(control => { control.disabled = !v.on; }); };
    toggle.box.checked = v.on; show();
    toggle.box.addEventListener("change", () => { v.on = toggle.box.checked; show(); persist(); });
    return h("fieldset", {}, h("legend", {}, "Terugleveringsvariant (optioneel)"),
      h("p", { class: "help" },
        "Bijvoorbeeld: wat als de vergoeding na 2030 vervalt? Alleen vergoeding en terugleverkosten wijzigen; de uitkomst staat naast de basis."),
      toggle.element, fields);
  }

  function stepTariffs(body) {
    const tariff = (label, key, props, help) => field(label,
      bindValue(numberInput({ step: "0.0001", required: true, ...props }), () => state.tariff[key],
        v => { state.tariff[key] = v; }),
      help);
    body.append(h("h2", {}, "Tarieven en looptijd"),
      h("p", { class: "help" },
        "Gebruik je contractbedragen inclusief belastingen. Het startjaar is het eerste volledige jaar met de accu; vanaf 2027 rekent het model zonder salderen. De overige waarden zijn aanpasbare aannames, geen voorspelling."),
      h("fieldset", {}, h("legend", {}, "Contract"), h("div", { class: "grid" },
        tariff("Stroomprijs, alles inbegrepen (€/kWh)", "import", { min: "-10", max: "10" }),
        tariff("Terugleververgoeding (€/kWh)", "export", { min: "-10", max: "10" }, "Vóór aparte terugleverkosten."),
        tariff("Terugleverkosten (€/kWh)", "fee", { min: "0", max: "10" },
          "Rekent je leverancier geen terugleverkosten per kWh, vul dan 0 in. Hogere terugleverkosten maken een accu gunstiger."),
        tariff("Prijsverandering per jaar (%)", "change", { min: "-20", max: "30", step: "0.1" })),
        h("details", {}, h("summary", {}, "Terugleverkosten via vaste staffels"),
          field("Staffels", bindValue(h("textarea", { rows: "4", placeholder: "1000;120\n2000;240\n;360" }), () => state.tariff.bands, v => { state.tariff.bands = v; }),
            "Per regel: maximale teruglevering in kWh, puntkomma, jaarkosten in euro. Laat de laatste grens leeg. Alleen aanvullende staffelkosten."))),
      variantFields(),
      h("fieldset", {}, h("legend", {}, "Looptijd en aannames"), h("div", { class: "grid" },
        PARAMS.map(([key, label, min, max, step]) => field(label, bindValue(numberInput({ min, max, step, required: true }), () => state.params[key], v => { state.params[key] = v; }))))));
  }

  // Vult een optie vanuit de catalogus: techniek met benoemde aannames en kostenindicaties.
  async function addFromCatalog(id) {
    const [cmp, costCatalog] = await Promise.all([Data.catalog(), Data.costs()]);
    const config = cmp.configurations.find(c => String(c.id) === id);
    if (!config) throw new Error("Kies eerst een uitvoering uit de catalogus.");
    const p = Data.describe(cmp, config);
    const option = blankOption(state.options.length + 1, { name: p.name, configuration_id: config.id, kind: p.kind || "fixed",
      assumptions: `Overgenomen uit de catalogus. ${p.notes.join(" ")}${p.missing.length ? ` Nog in te vullen: ${p.missing.join(", ")}.` : ""}` });
    if (p.battery) for (const [key] of TECH) option.battery[key] = plain(p.battery[key]);
    else {
      for (const [key, value] of [["usable_capacity_kwh", p.capacity], ["charge_power_kw", p.chargeKw],
        ["discharge_power_kw", p.dischargeKw]]) if (value != null) option.battery[key] = plain(value);
      Object.assign(option.battery,
        { ac_round_trip_efficiency_pct: plain(p.efficiency), standby_w: plain(p.standby),
          annual_capacity_loss_pct: plain(Data.FALLBACK.degradation),
          operating_life_years: String(Data.FALLBACK.life) });
    }
    fillEstimates(option, costCatalog, p);
    state.options.push(option); persist();
  }
  // Vult alleen posten die nog onbekend zijn; eigen invoer blijft staan.
  function fillEstimates(option, costCatalog, described) {
    const lines = Data.estimateCosts(costCatalog,
      { kind: option.kind, circuit: described?.circuit === true, manufacturer: described?.config.manufacturer_name ?? "",
        phases: described?.phases ?? null,
        inverterIncluded: described ? described.inverterIncluded : option.kind === "plug" },
      {});
    if (described?.offer) Object.assign(lines.find(l => l.category === "battery"),
      { status: "priced", amount_minor: described.offer.upfront_amount_minor, source: described.offer.source_url,
        notes: `Gepubliceerde prijs van ${described.offer.seller}.` });
    let filled = 0;
    for (const line of lines) {
      const current = option.costs[line.category];
      if ((current && current.status !== "unknown") || line.status === "unknown") continue;
      option.costs[line.category] = { status: line.status,
        amount: line.status === "priced" ? (line.amount_minor / 100).toFixed(2) : "", year: "", source: line.source,
        notes: line.notes };
      filled++;
    }
    return filled;
  }

  function optionCard(option, index, categories, catalogData) {
    const remove = button("Verwijder", () => { state.options.splice(index, 1); persist(); flow.rerender(); }, "ghost");
    const tech = h("div", { class: "grid" },
      field("Naam",
        bindValue(input({ required: true, maxlength: "200" }), () => option.name, v => { option.name = v; })),
      TECH.map(([key, label, min, max, help]) => field(label, bindValue(numberInput({ min, max, required: true, step: key === "operating_life_years" ? "1" : "any" }), () => option.battery[key], v => { option.battery[key] = v; }), help)));
    const assumptions = field("Bron en aannames van de techniek", bindValue(h("textarea", { rows: "3", required: true }), () => option.assumptions, v => { option.assumptions = v; }),
      "Controleer bruikbare capaciteit, werkelijk AC-vermogen en AC-systeemrendement; kVA en DC-rendement zijn hiervoor onvoldoende.");
    const progress = h("p", { class: "help" });
    const refreshProgress = () => {
      const open = categories.filter(c => (option.costs[c.key]?.status || "unknown") === "unknown").length;
      progress.textContent = open ? `${categories.length - open} van ${categories.length} posten beoordeeld; onbekende posten blokkeren de berekening.` : `Alle ${categories.length} posten beoordeeld.`;
    };
    const rows = categories.map(c => {
      const line = option.costs[c.key] ||= { status: "unknown", amount: "", year: "", source: "", notes: "" };
      const amount = numberInput({ min: "0", step: "0.01", disabled: line.status !== "priced" });
      const status = select(Object.entries(Data.costStatus), line.status);
      const year = c.timing === "event" ? numberInput({ min: "1", max: "30", step: "1",
        disabled: line.status !== "priced" }) : null;
      const source = input({ placeholder: "Offerte, bron of aanname" });
      bindValue(amount, () => line.amount, v => { line.amount = v; });
      if (year) bindValue(year, () => line.year, v => { line.year = v; });
      bindValue(source, () => line.source, v => { line.source = v; line.notes = "Invoer in Zelf doorrekenen"; });
      status.addEventListener("change",
        () => { line.status = status.value; amount.disabled = line.status !== "priced";
          if (year) year.disabled = amount.disabled;
          if (amount.disabled) { amount.value = ""; line.amount = ""; } persist(); refreshProgress(); });
      return h("div", { class: "cost-row" }, h("div", {}, h("strong", {}, c.label), h("small", {}, c.note)),
        h("div", { class: "cost-controls" }, field("Status", status), field(c.timing === "annual" ? "Bedrag per jaar (€)" : "Bedrag (€)", amount), year ? field("Einde van jaar", year) : h("span"), field("Bron of aanname", source)));
    });
    const kind = select([["fixed", "Vaste installatie"], ["plug", "Stekkerbatterij"]], option.kind,
      { onchange: event => { option.kind = event.target.value; persist(); } });
    const estimate = button("Vul open posten met indicaties", async () => {
      const [cmp, costCatalog] = await Promise.all([Data.catalog(), Data.costs()]);
      const config = cmp.configurations.find(c => c.id === option.configuration_id);
      const filled = fillEstimates(option, costCatalog, config ? Data.describe(cmp, config) : null);
      persist();
        toast(filled ? `${filled} posten gevuld met indicaties. Vervang ze door offertebedragen waar je die hebt.` : "Er waren geen open posten om te vullen.");
        flow.rerender();
    }, "secondary");
    const loan = (label, key, props) => field(label,
      bindValue(numberInput({ min: "0", ...props }), () => option.loan[key], v => { option.loan[key] = v; }));
    refreshProgress();
    return h("details", { class: "panel option-editor", open: true }, h("summary", {}, option.name || `Optie ${index + 1}`),
      h("div", { class: "actions" }, remove), tech, assumptions,
      h("h3", {}, "Kosten"), progress,
        h("div", { class: "actions" }, field("Soort accu (voor de indicaties)", kind), estimate),
      h("p", { class: "help" },
        "Bedragen inclusief niet-teruggevraagde btw. Een pakketprijs staat één keer bij de accu; inbegrepen onderdelen tellen niet dubbel."),
        h("div", { class: "cost-rows" }, rows),
      h("details", {}, h("summary", {}, "Financiering (optioneel)"), h("p", { class: "help" }, "Een annuïtaire lening voegt alleen de rente toe; de aanschaf telt al als investering. Looptijd binnen de analysehorizon."),
        h("div", { class: "grid" }, loan("Leningbedrag (€)", "amount", { step: "0.01" }), loan("Rente per jaar (%)", "interest", { max: "30", step: "0.01" }), loan("Looptijd (jaren)", "years", { max: "30", step: "1" }))));
  }

  function stepOptions(body) {
    body.append(h("h2", {}, "Accu-opties en kosten"),
      h("p", { class: "help" },
        "Elke optie wordt vergeleken met geen accu. Ontbrekende specificaties en prijzen worden niet stilzwijgend aangenomen: gebruik de knop voor indicaties of vul je offerte in."));
    const host = h("div", {}, h("p", { class: "help" }, "Laden…")); body.append(host);
    Promise.all([Data.catalog(), Data.costs()]).then(([cmp, costCatalog]) => {
      const pickConfig = select([["", "Kies een uitvoering…"],
        ...cmp.configurations.map(c => [String(c.id), `${c.manufacturer_name} · ${c.product_name} · ${c.name}`])],
        "");
      const fromCatalog = button("Neem over",
        () => UI.busy(fromCatalog,
          async () => { if (state.options.length >= 12) throw new Error("Maximaal twaalf opties.");
            await addFromCatalog(pickConfig.value); flow.rerender(); }),
        "secondary");
      const own = button("+ Eigen optie",
        () => { if (state.options.length >= 12) { toast("Maximaal twaalf opties.", true);
          return; } state.options.push(blankOption(state.options.length + 1));
          persist(); flow.rerender(); },
        "secondary");
      host.replaceChildren();
      UI.append(host, [h("div", { class: "toolbar" }, field("Uit de catalogus", pickConfig), fromCatalog, own),
        state.options.length ? state.options.map((option, i) => optionCard(option, i, costCatalog.categories,
          cmp)) : h("p",
          { class: "empty" }, "Nog geen opties. Neem een accu over uit de catalogus of voeg een eigen optie toe."),
        h("details", { class: "sources" }, h("summary", {}, "Kostenonderzoek en bronnen"), h("p", {}, costCatalog.notes),
          h("ul", {}, costCatalog.sources.map(s => h("li", {}, UI.external(s.title, s.url), h("small", {}, s.note)))))]);
    }).catch(error => host.replaceChildren(h("p", { class: "warning" }, error.message)));
  }

  function stepReview(body) {
    body.append(h("h2", {}, "Controle en berekenen"));
    const host = h("div"), step = flow.current; body.append(host);
    Data.costs().then(costCatalog => {
      const { problems, request } = build(costCatalog.categories);
      const confirmations = [
        "Het profiel bevat bruto huishoudelijk verbruik en AC-zonneproductie, geen netafname of teruglevering als vervanging daarvan.",
        "De technische invoer is gecontroleerd of expliciet als aanname beschreven; geschiktheid voor de installatie is daarmee nog niet gegarandeerd.",
        "Alle kostenposten zijn beoordeeld; bedragen, inbegrepen of niet-toepasselijke posten en aftrekposten zijn offertegegevens of expliciete aannames."
      ].map(text => checkbox(text, { required: true }));
      const run = button("Bereken en bewaar", () => UI.busy(run, async () => {
        if (problems.length) throw new Error("Los eerst de punten hierboven op.");
        if (!UI.validate(host)) return;
        const response = await UI.api("/api/v1/analysis/runs",
          { method: "POST",
            json: { ...request, costs_confirmed: true, technical_assumptions_confirmed: true,
              consumption_is_gross: true, production_is_ac: true } });
        store.set(STORE, null); state = blank();
        location.hash = `#/berekeningen/${response.id}`;
      }));
      UI.append(host, [table(["Onderdeel", "Invoer"], [
        ["Naam en adres", `${state.title} · ${state.address || "geen adres"}`],
          ["Doel", Data.objectives[state.objective]],
        ["Stroomprijs / terugleververgoeding",
          [state.tariff.import, state.tariff.export].map(v => { const x = UI.parse(v);
            return x == null ? "?" : UI.money(x, { decimals: 4 }); }).join(" / ") + " per kWh"],
          ["Looptijd", `${state.params.horizon_years} jaar vanaf ${state.params.start_year}`],
        ["Accu-opties", state.options.map(o => o.name).join(", ") || "Geen"],
        ...(request.quote_basis ? [["Uit de offerte", request.quote_basis.changes.map(Data.quoteChange).join("; ")]] : [])]),
        problems.length ? h("div", { class: "callout" },
          h("p", {}, `${problems.length} ${problems.length === 1 ? "punt vraagt" : "punten vragen"} nog aandacht:`),
          h("ul", {}, problems.slice(0, 40).map(p => h("li", {}, p)))) : h("p", { class: "derived" },
          "De invoer is compleet."),
        h("fieldset", {}, h("legend", {}, "Bevestig"), confirmations.map(c => c.element)),
        request.quote_basis ? h("p", { class: "help" }, "Je vinkt de bevestigingen bewust opnieuw aan: zo bevestig je dat de " +
          "waarden uit de offerte kloppen.") : null]);
      // De knop staat in de vaste balk onderaan, vlak onder de bevestigingen.
      if (flow.current === step) flow.action(run);
    });
  }

  UI.page("zelf", {
    nav: "Zelf doorrekenen", icon: "sliders", title: "Zelf doorrekenen",
      subtitle: "Voor wie offertes heeft: alle aannames en kostenposten zelf invullen.",
    render(view, actions) {
      state = { ...blank(), ...store.get(STORE, {}) };
      actions.append(button("Begin opnieuw", () => { store.set(STORE, null); state = blank(); flow.show(0); },
        "ghost"));
      view.append(h("details", { class: "help-box" }, h("summary", {}, "Over deze berekening"),
        h("p", {},
          "Het model simuleert zonnestroom opslaan voor eigen gebruik met vaste tarieven, per meetperiode over één volledig jaar, en vergelijkt elke optie met geen accu. Dynamische handel en onbalansinkomsten zijn niet opgenomen."),
        h("p", {}, "Zonder offertes? De ", link("keuzehulp", "#/keuzehulp"), " vult alles met bronvermelde indicaties.")));
      flow = UI.wizard([{ label: "Profiel en doel", render: stepProfile }, { label: "Tarieven", render: stepTariffs }, { label: "Accu-opties", render: stepOptions }, { label: "Controle", render: stepReview }],
        { validate: (_, body) => UI.validate(body), onShow: () => window.scrollTo(0, 0) });
      // Vanuit de offertecheck opent de controlestap direct; daarna begint de wizard weer vooraan.
      view.append(flow.element); flow.show(state.step ?? 0);
      if (state.step != null) { delete state.step; persist(); }
    }
  });

  return { load, PARAMS };
})();
