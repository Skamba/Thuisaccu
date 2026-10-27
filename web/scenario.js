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
      ["price_uncertainty_pct", "Onzekerheid tarieven (± %)", "0", "80", "1"],
    ["cost_uncertainty_pct", "Onzekerheid kosten (± %)", "0", "80", "1"]
  ];
  // Extra verbruik vanaf een later jaar, met dezelfde vormen als het geschatte profiel (crates/server/src/typical_profile.rs).
  const CONNECTIONS = Data.CONNECTIONS;
  // Groepen kostenposten in de optie-editor: [sleutel, kop]; teruggaven en restwaarde staan apart, want ze verlagen de kosten.
  const COST_GROUPS = [["upfront", "Startkosten"], ["annual", "Per jaar"], ["event", "Later: vervanging en einde"],
    ["credit", "Teruggaven, subsidie en restwaarde"]];
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
      kind: "unknown",
    battery: Object.fromEntries(TECH.map(([key]) => [key, ""])), assumptions: "", costs: {},
      loan: { amount: "0", interest: "0", years: "0" }, warranty: "", ...extra
  });
  function blank() {
    const d = Data.defaults();
    return {
      title: "Mijn berekening", address: "", site: null, profile: "", objective: "net_present_value", budget: "",
      params: Object.fromEntries(PARAMS.map(([key]) => [key, plain(d[key])])),
      tariff: { import: "", export: "", fee: "", change: plain(d.annual_price_change_pct), bands: "", fixed: 0 },
      variant: { on: false, label: "Geen terugleververgoeding vanaf 2030", year: "2030", export: "0", fee: "" },
        changes: [], basis: null, options: []
    };
  }
  let state = { ...blank(), ...store.get(STORE, {}) }, flow = null, saveTimer = null, focusOption = null, keptScroll = null;
  // Opnieuw tekenen na een knop in de stap zelf: dezelfde plek op de pagina, en de focus naar `target`
  // ({ index, what: "cost" | "summary" } of { add: true }) zodat toetsenbord en schermlezer hun plaats houden.
  const redraw = (target = null) => { focusOption = target; keptScroll = window.scrollY; flow.rerender(); };
  // Alleen voor dit bezoek: welke kostengroepen open staan en wat de totaalprijs laatst deed, per optie.
  const openGroups = new WeakMap(), quoteNotes = new WeakMap();
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(STORE, state), 300); };
  const bindValue = (control, read, write) => { control.value = read() ?? "";
    control.addEventListener("input", () => { write(control.value); persist(); }); return control; };

  // Neemt een bewaarde run over als nieuw concept; bevestigingen worden nooit overgenomen.
  // `extra` komt uit de offertecheck: een andere naam, de herkomst (`quote_basis`) en de stap om te openen.
  function load(request, extra = {}) {
    const money2 = minor => (minor / 100).toFixed(2).replace(".", ",");
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
        // De soort aansluiting staat sinds 26 oktober 2026 in de run; anders leidt stap 3 hem af uit de catalogus
        // (`resolveKinds`), en is hij bij een eigen optie onbekend.
        key: c.key, name: c.name, configuration_id: c.configuration_id,
          kind: CONNECTIONS.includes(c.connection) ? c.connection : c.configuration_id == null ? "unknown" : null,
          assumptions: c.assumptions,
        battery: Object.fromEntries(TECH.map(([key]) => [key, plain(c.battery[key])])),
        costs: Object.fromEntries(c.costs.map(l => [l.category,
          { status: l.status, amount: l.status === "priced" ? money2(l.amount_minor) : "",
            year: l.year == null ? "" : plain(l.year), source: l.source, notes: l.notes }])),
        loan: { amount: plain(c.financing.loan_amount_eur), interest: plain(c.financing.annual_interest_pct),
          years: plain(c.financing.years) },
        warranty: c.warranty_stress ? plain(c.warranty_stress.operating_life_years) : "",
          warrantyBasis: c.warranty_stress ? { years: c.warranty_stress.operating_life_years, text: c.warranty_stress.basis } : null,
          index: i
      }))
    };
    // De herkomst uit een offerte blijft bij een kopie bewaard; basis() rekent de verschillen opnieuw uit.
    state.basis = request.quote_basis ?? null;
    Object.assign(state, extra);
    store.set(STORE, state);
  }
  // De herkomst uit de offertecheck, met de waarden zoals ze nu in de opgebouwde optie staan; wat je
  // daarna terugzette naar de oude waarde vervalt, en zonder verschil vervalt de hele herkomst.
  function basis(candidates) {
    const option = state.basis && candidates.find(o => o.key === state.basis.candidate_key);
    const changes = option ? state.basis.changes.map(c => ({ ...c, after: Data.quoteValue(option, c.field) }))
      .filter(c => Number.isFinite(c.after) && c.after !== c.before) : [];
    // De prijsopbouw hoort bij de totaalprijs; zonder die wijziging vervalt hij. Is het bedrag op de accupost daarna
    // aangepast, dan telt de opbouw vanaf dat bedrag; is het geen totaalprijs uit de offerte meer, dan vervalt hij.
    const { price, ...rest } = state.basis || {};
    const total = option?.costs.find(l => l.category === "battery" && l.status === "priced" && l.source === Data.QUOTE_TOTAL);
    const current = price && total && changes.some(c => c.field === "upfront_eur") ? { ...price, total_eur: total.amount_minor / 100 } : null;
    return changes.length ? { ...rest, changes, ...(current ? { price: current } : {}) } : null;
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
  // Bouwt het API-verzoek en verzamelt alle problemen tegelijk, zodat de controlestap ze kan tonen:
  // `problems` voor de berekening als geheel, `optionProblems` per accu-optie (zelfde volgorde).
  const few = labels => labels.length <= 3 ? labels.map(l => `‘${l}’`).join(", ")
    : `${labels.slice(0, 3).map(l => `‘${l}’`).join(", ")} en ${labels.length - 3} andere`;
  function build(categories) {
    const problems = [], optionProblems = state.options.map(() => []),
      number = (raw, what, list = problems) => { const v = parse(raw); if (v == null) list.push(`${what} ontbreekt.`);
        return v ?? 0; },
      // Met dezelfde grenzen als het invoerveld: een overgenomen offertewaarde (12,5 jaar) komt niet langs het veld.
      within = (raw, what, min, max, step, list = problems) => {
        const v = number(raw, what, list);
        if (parse(raw) == null) return v;
        if (v < Number(min) || v > Number(max)) list.push(`${what}: vul ${min.replace(".", ",")} tot ${max} in.`);
        else if (step === "1" && !Number.isInteger(v)) list.push(`${what}: vul een heel getal in.`);
        return v;
      };
    if (!state.title.trim()) problems.push("Geef de berekening een naam.");
    if (!state.profile) problems.push("Kies een energieprofiel.");
    if (!state.options.length) problems.push("Voeg minstens één accu-optie toe.");
    let exportBands = [];
    try { exportBands = bands(); } catch (error) { problems.push(error.message); }
    const horizon = parse(state.params.horizon_years);
    const parameters = {
      ...Object.fromEntries(PARAMS.map(([key, label, min, max, step]) => [key, within(state.params[key], label, min, max, step)])),
      objective: state.objective, budget_eur: parse(state.budget, { money: true }),
      tariff: { import_eur_per_kwh: number(state.tariff.import, "Stroomprijs"),
        export_eur_per_kwh: number(state.tariff.export, "Terugleververgoeding"),
        export_fee_eur_per_kwh: number(state.tariff.fee, "Terugleverkosten"), export_fee_bands: exportBands,
        fixed_annual_eur: state.tariff.fixed, annual_price_change_pct: number(state.tariff.change, "Prijsverandering") },
      // Pieken binnen de meetperiode volgens gemeten huishoudens; zie docs/roi-model.md.
      load_variation: "households"
    };
    const start = parse(state.params.start_year), last = start != null && horizon != null ? start + horizon - 1 : null;
    if (state.variant.on) {
      if (!state.variant.label.trim()) problems.push("Geef de terugleveringsvariant een omschrijving.");
      const year = parse(state.variant.year);
      if (year != null && last != null && (year < start || year > last)) {
        problems.push(`Terugleveringsvariant: kies een beginjaar binnen de looptijd (${start} tot en met ${last}); daarna verandert er niets.`);
      }
      parameters.export_variant = {
        label: state.variant.label.trim(),
          from_calendar_year: number(state.variant.year, "Beginjaar terugleveringsvariant"),
        export_eur_per_kwh: number(state.variant.export, "Vergoeding in de variant"),
        export_fee_eur_per_kwh: number(state.variant.fee, "Terugleverkosten in de variant")
      };
    }
    const load_changes = (state.changes || []).map(change => {
      const kind = CHANGES[change.kind], year = parse(change.year), kwh = parse(change.kwh, { whole: true });
      if (year == null || last == null || year < start || year > last) {
        problems.push(`${kind.label}: kies een beginjaar binnen de looptijd${last == null ? "" : ` (${start} tot en met ${last})`}.`);
      }
      if (kwh == null || kwh < 1 || kwh > kind.max) problems.push(`${kind.label}: vul 1 tot ${n(kind.max, 0)} kWh extra per jaar in.`);
      return { kind: change.kind, from_calendar_year: year ?? 0, annual_kwh: kwh ?? 0,
        ...(change.kind === "ev" ? { charging: change.charging } : {}) };
    });
    const candidates = state.options.map((option, index) => {
      const mine = optionProblems[index], unknown = [], unsourced = [];
      // Leeg is geen lening; iets wat geen getal is, wordt niet stil een lening van nul.
      const loanValue = (raw, what, options) => {
        if (!String(raw ?? "").trim()) return 0;
        const value = parse(raw, options);
        if (value == null) mine.push(`${what}: ${UI.parseProblem(raw, options)}`);
        return value ?? 0;
      };
      const battery = Object.fromEntries(TECH.map(([key, label, min, max]) => [key,
        within(option.battery[key], label, min, max, key === "operating_life_years" ? "1" : "any", mine)]));
      if (!option.assumptions.trim()) mine.push("Beschrijf bron en aannames van de techniek.");
      const costs = categories.map(c => {
        const line = option.costs[c.key] || { status: "unknown", amount: "", year: "", source: "", notes: "" };
        if (line.status === "unknown") unknown.push(c.label);
        let amount = 0;
        if (line.status === "priced") {
          // Nederlandse notatie mag (6.500,00); hele centen, zoals de kostenposten.
          const euro = parse(line.amount, { money: true });
          if (euro == null || euro < 0 || Math.abs(euro * 100 - Math.round(euro * 100)) > 1e-6) mine.push(`Bedrag voor ‘${c.label}’ in euro met hoogstens twee decimalen.`);
          else amount = Math.round(euro * 100);
          if (c.timing === "event" && !(parse(line.year) >= 1 && parse(line.year) <= horizon)) mine.push(`Jaar voor ‘${c.label}’ moet binnen de looptijd vallen.`);
        }
        if (line.status !== "unknown" && !String(line.source || "").trim()) unsourced.push(c.label);
        return { category: c.key, status: line.status, amount_minor: amount, timing: c.timing,
          year: line.status === "priced" && c.timing === "event" ? parse(line.year) : null,
          source: String(line.source || "").trim(), notes: line.notes || "Invoer in Zelf doorrekenen" };
      });
      // Optioneel: de garantie voor de stresstest. Een overgenomen herkomst geldt alleen voor dezelfde jaren.
      let warranty_stress;
      if (String(option.warranty ?? "").trim()) {
        const years = parse(option.warranty);
        if (years == null || !Number.isInteger(years) || years < 1 || years > 30) mine.push("Garantie: vul een heel aantal jaren van 1 tot 30 in, of laat het veld leeg.");
        else warranty_stress = { operating_life_years: years, annual_capacity_loss_pct: Data.WARRANTY_LOSS,
          basis: option.warrantyBasis?.years === years ? option.warrantyBasis.text
            : Data.warrantyNote(`garantie van ${years} jaar, ingevoerd in Zelf doorrekenen`) };
      }
      if (unknown.length) mine.unshift(`${unknown.length} van ${categories.length} kostenposten ${unknown.length === 1 ? "is" : "zijn"} nog onbekend: ${few(unknown)}.`);
      if (unsourced.length) mine.push(`Geef een bron of aanname bij ${few(unsourced)}.`);
      const financing = { loan_amount_eur: loanValue(option.loan.amount, "Leningbedrag", { money: true }),
        annual_interest_pct: loanValue(option.loan.interest, "Rente"), years: loanValue(option.loan.years, "Looptijd van de lening") };
      // Dezelfde regels als `validate` in analysis.rs, zodat de controlestap ze noemt in plaats van de server.
      const upfront = costs.filter(l => l.timing === "upfront" && l.status === "priced")
        .reduce((sum, l) => sum + l.amount_minor / 100 * (Data.CREDITS.includes(l.category) ? -1 : 1), 0);
      if (upfront < -1e-9) mine.push(`Teruggaven en subsidie zijn samen ${money(-upfront, { decimals: 0 })} hoger dan de ` +
        "startkosten; meer dan de kosten krijg je niet terug. Verlaag ze tot hoogstens de startkosten.");
      else if (financing.loan_amount_eur > upfront + 1e-9) mine.push(`Leningbedrag: hoogstens de startinvestering na ` +
        `teruggaven (${money(upfront)}).`);
      if (financing.annual_interest_pct < 0 || financing.annual_interest_pct > 30) mine.push("Rente: vul 0 tot 30% per jaar in.");
      if (financing.loan_amount_eur > 0 && !(Number.isInteger(financing.years) && financing.years >= 1 && financing.years <= (horizon ?? 0)))
        mine.push(`Looptijd van de lening: een heel aantal jaren van 1 tot ${horizon ?? "de looptijd"}, binnen de looptijd van de berekening.`);
      return { key: option.key, name: option.name, configuration_id: option.configuration_id, battery, costs, financing,
        assumptions: option.assumptions, warranty_stress, connection: CONNECTIONS.includes(option.kind) ? option.kind : undefined };
    });
    // Het adres is alleen een label bij de berekening; zonder adres dezelfde omschrijving als in de keuzehulp.
    const site = state.site && state.site.address === state.address ? state.site
      : { address: state.address.trim() || "Nederland (geen adres opgegeven)", latitude: null, longitude: null, bag_id: null };
    return { problems, optionProblems, count: problems.length + optionProblems.flat().length,
      request: { title: state.title.trim(), solar_import_id: Number(state.profile), site, parameters, candidates,
        ...(load_changes.length ? { load_changes } : {}), ...(basis(candidates) ? { quote_basis: basis(candidates) } : {}) } };
  }

  function stepProfile(body) {
    // Wat de zoekknop vond, wordt voorgelezen; bij een treffer gaat de focus naar de keuzelijst.
    const results = h("div", { "aria-live": "polite" }),
      address = bindValue(input({ maxlength: "500",
        placeholder: "Postcode + huisnummer of straat en plaats" }),
        () => state.address, v => { state.address = v; });
    const lookup = button("Zoek adres via PDOK", () => UI.busy(lookup, async () => {
      const found = (await UI.api("/api/v1/locations/search",
        { method: "POST", json: { query: state.address } })).results;
      const choices = found.length ? select([["", "Kies het juiste adres…"], ...found.map((s, i) => [String(i), s.address])], "", { onchange: event => {
        const site = found[Number(event.target.value)]; if (!site) return;
        state.site = site; state.address = site.address; address.value = site.address; persist();
      } }) : null;
      results.replaceChildren(choices ? field(`Gevonden adressen (${found.length})`, choices)
        : h("p", { class: "help" }, "Geen adressen gevonden. Je kunt het adres ook handmatig gebruiken."));
      choices?.focus();
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
          const extras = state.changes.map(c => [parse(c.year), parse(c.kwh, { whole: true })])
            .filter(([y, kwh]) => y != null && kwh != null && year != null && y <= year).map(([, kwh]) => kwh);
          sum.textContent = base != null && year != null && parse(change.kwh, { whole: true }) != null
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
            own("Extra verbruik (kWh per jaar)", "kwh", { whole: true, min: "1", max: String(kind.max), step: "1" },
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
    // De zoekknop staat naast het adresveld waar hij bij hoort.
    const addressField = field("Adres in Nederland (optioneel)", address, "Alleen een label bij de berekening. Alleen de zoekknop stuurt je zoekterm naar PDOK; aansluiting en contract worden niet uit het adres afgeleid.");
    const addressRow = h("div", { class: "input-row" });
    address.replaceWith(addressRow);
    addressRow.append(address, lookup);
    body.append(h("h2", {}, "Profiel en doel"), h("div", { class: "grid" },
      field("Naam van de berekening",
        bindValue(input({ required: true, maxlength: "200" }), () => state.title, v => { state.title = v; })),
      addressField), results,
      h("div", { class: "grid" },
        field("Energieprofiel (volledig jaar met opwek en verbruik)", profile,
          h("span", {}, "Nog geen profiel? ", link("Importeer een bestand", "#/energie/import"),
            " of laat de keuzehulp een geschat profiel maken.")),
        field("Doel",
          bindValue(select(Object.entries(Data.objectives)), () => state.objective, v => { state.objective = v; })),
        field("Maximale startinvestering (€, optioneel)", bindValue(numberInput({ min: "0", step: "0.01", placeholder: "Geen maximum", money: true }), () => state.budget, v => { state.budget = v; }))),
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
        v => { state.tariff[key] = v; if (key === "import") checkPrice(); else checkFee(); }),
      help);
    const { element: priceCheck, run: checkPrice } = UI.liveCheck(() => Data.importPriceCheck(UI.parse(state.tariff.import)), "wide");
    // Met staffels zijn de terugleverkosten per kWh alleen een aanvulling; dan is 0 per kWh gewoon.
    const { element: feeCheck, run: checkFee } = UI.liveCheck(() => String(state.tariff.bands || "").trim() ? null
      : Data.exportCheck(UI.parse(state.tariff.export), UI.parse(state.tariff.fee), { own: true }), "wide");
    body.append(h("h2", {}, "Tarieven en looptijd"),
      h("p", { class: "help" },
        "Gebruik je contractbedragen inclusief belastingen. Het startjaar is het eerste volledige jaar met de accu; vanaf 2027 rekent het model zonder salderen. De overige waarden zijn aanpasbare aannames, geen voorspelling."),
      h("fieldset", {}, h("legend", {}, "Contract"), h("div", { class: "grid" },
        tariff("Stroomprijs, alles inbegrepen (€/kWh)", "import", { min: "-10", max: "10" }, Data.INDICATION.importHelp),
        priceCheck,
        tariff("Terugleververgoeding (€/kWh)", "export", { min: "-10", max: "10" }, "Vóór aparte terugleverkosten."),
        tariff("Terugleverkosten (€/kWh)", "fee", { min: "0", max: "10" },
          "Rekent je leverancier geen terugleverkosten per kWh, vul dan 0 in. Hogere terugleverkosten maken een accu gunstiger."),
        feeCheck,
        tariff("Prijsverandering per jaar (%)", "change", { min: "-20", max: "30", step: "0.1" }, Data.ASSUMPTION_HELP.annual_price_change_pct)),
        indications(),
        h("details", {}, h("summary", {}, "Terugleverkosten via vaste staffels"),
          field("Staffels", bindValue(h("textarea", { rows: "4", placeholder: "1000;120\n2000;240\n;360" }), () => state.tariff.bands, v => { state.tariff.bands = v; checkFee(); }),
            "Per regel: maximale teruglevering in kWh, puntkomma, jaarkosten in euro. Laat de laatste grens leeg. Alleen aanvullende staffelkosten."))),
      variantFields(),
      h("fieldset", {}, h("legend", {}, "Looptijd en aannames"), h("div", { class: "grid" },
        PARAMS.map(([key, label, min, max, step]) => field(label, bindValue(numberInput({ min, max, step, required: true }), () => state.params[key], v => { state.params[key] = v; }),
          Data.ASSUMPTION_HELP[key])))));
  }
  // Dezelfde gedateerde indicaties als in de keuzehulp, alleen na een klik; een eigen contract gaat voor.
  function indications() {
    const i = Data.INDICATION;
    const use = button("Gebruik de indicaties", () => {
      Object.assign(state.tariff, { import: plain(i.import), export: plain(i.export), fee: plain(i.exportFee) });
      // Zoals in de keuzehulp: in de variant zonder vergoeding vallen de terugleverkosten van de indicatie ook weg.
      if (state.variant.fee === "") state.variant.fee = "0";
      persist(); redraw();
    }, "secondary");
    return h("div", {}, h("p", { class: "help" },
      `Geen contract bij de hand? Indicatie: stroom ${money(i.import, { decimals: 4 })} per kWh, terugleververgoeding ` +
      `${money(i.export, { decimals: 4 })} en terugleverkosten ${money(i.exportFee, { decimals: 4 })} per kWh. Vervang ze door je eigen contract.`),
      h("p", { class: "actions" }, use),
      h("details", { class: "sources" }, h("summary", {}, "Waar komen de indicaties vandaan?"),
        h("p", { class: "help" }, i.importText), h("p", { class: "help" }, i.exportText),
        h("ul", {}, [...i.importSources, ...i.exportSources].map(([title, url]) => h("li", {}, UI.external(title, url))))));
  }

  // Vult een optie vanuit de catalogus: techniek met benoemde aannames en kostenindicaties.
  async function addFromCatalog(id) {
    const [cmp, costCatalog] = await Promise.all([Data.catalog(), Data.costs()]);
    const config = cmp.configurations.find(c => String(c.id) === id);
    if (!config) throw new Error("Kies eerst een uitvoering uit de catalogus.");
    const p = Data.plugLimit(Data.describe(cmp, config));
    const option = blankOption(state.options.length + 1, { name: p.name, configuration_id: config.id, kind: Data.connectionOf(p) || "unknown",
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
    if (p.warrantyStress) Object.assign(option, { warranty: plain(p.warrantyStress.operating_life_years),
      warrantyBasis: { years: p.warrantyStress.operating_life_years, text: p.warrantyStress.basis } });
    fillEstimates(option, costCatalog, p);
    state.options.push(option); persist();
  }
  // Zelf doorrekenen houdt het overzichtelijk: meer opties passen in een berekening van de keuzehulp, niet hier.
  const MAX_OPTIONS = 12;
  const full = () => `Er passen twaalf opties in een berekening; je hebt er nu ${state.options.length}. Verwijder er eerst een paar.`;
  // Een stekkerbatterij uit de catalogus volgt bij een andere aansluiting het vermogen van de keuzehulp: in een stopcontact
  // hoogstens 800 W (plugLimit), op een eigen groep het volle vermogen uit de bronnen (circuitVariant, of de bronwaarden
  // als de catalogus zelf een eigen-groepuitvoering heeft). Alleen als laad- en ontlaadvermogen nog op een van die twee
  // staan; eigen invoer blijft staan, met een waarschuwing als die niet bij een stopcontact past. De naam volgt als hij nog
  // de naam uit de catalogus is, en in de aannames (ook die van de keuzehulp) worden de zinnen van de vorige vorm vervangen
  // door die van de nieuwe. Kostenposten met de indicatie van de vorige aansluiting (`previous`) krijgen die van de nieuwe,
  // ook als het vermogen gelijk blijft (een stekkerbatterij tot 800 W op een eigen groep kost wel de extra groep).
  // Geeft de melding terug, of null als er niets veranderde.
  async function followConnection(option, previous) {
    if (option.configuration_id == null || !["plug", "circuit"].includes(option.kind)) return null;
    const cmp = await Data.catalog(), config = cmp.configurations.find(c => c.id === option.configuration_id);
    const base = config && Data.describe(cmp, config);
    if (!base || base.kind !== "plug" || !base.battery) return null;
    const forms = { plug: Data.plugLimit(base), circuit: Data.circuitVariant(cmp, base) || base };
    const target = forms[option.kind], power = ["charge_power_kw", "discharge_power_kw"];
    const at = form => power.every(key => Math.abs((parse(option.battery[key]) ?? NaN) - form.battery[key]) < 1e-9);
    const messages = [];
    const matched = at(target) ? null : Object.keys(forms).find(kind => at(forms[kind]));
    if (matched) {
      const old = forms[matched];
      for (const key of power) option.battery[key] = plain(target.battery[key]);
      if (old.name === option.name) option.name = target.name;
      const gone = old.notes.filter(note => !target.notes.includes(note)), added = target.notes.filter(note => !old.notes.includes(note));
      let text = option.assumptions || "";
      if (gone.length && gone.every(note => text.includes(note))) {
        text = text.replace(gone[0], added.join(" "));
        for (const note of gone.slice(1)) text = text.replace(note, "");
      } else if (!gone.length && added.length) text = `${text} ${added.join(" ")}`;
      option.assumptions = text.replace(/ {2,}/g, " ").trim();
      const n1 = v => n(v, Number.isInteger(v) ? 0 : 1);
      messages.push(`Vermogen aangepast aan de aansluiting: ${n1(target.battery.discharge_power_kw)} kW ontladen, ` +
        `${n1(target.battery.charge_power_kw)} kW laden.`);
    } else if (!at(target) && option.kind === "plug" && power.some(key => parse(option.battery[key]) > 0.8)) {
      messages.push("Let op: het ingevulde vermogen is meer dan 800 W. In een gewoon stopcontact rekent de keuzehulp met hoogstens 800 W.");
    }
    const from = ["plug", "circuit"].includes(previous) ? previous : matched;
    if (from && from !== option.kind) {
      const costCatalog = await Data.costs(), before = estimates(from, costCatalog, base), after = estimates(option.kind, costCatalog, base);
      const same = (a, b) => a?.status === b?.status && a?.amount === b?.amount && a?.source === b?.source;
      let costs = 0;
      for (const category of new Set([...before.keys(), ...after.keys()])) {
        const current = option.costs[category];
        if (!(before.has(category) ? same(current, before.get(category)) : !current || current.status === "unknown")) continue;
        if (same(current, after.get(category))) continue;
        if (after.has(category)) option.costs[category] = after.get(category); else delete option.costs[category];
        costs++;
      }
      if (costs) messages.push(`${costs === 1 ? "Eén kostenpost" : `${costs} kostenposten`} met indicaties aangepast aan de aansluiting.`);
    }
    return messages.length ? messages.join(" ") : null;
  }
  // Vult alleen posten die nog onbekend zijn; eigen invoer blijft staan.
  // De soort accu kiest de posten: een stekkerbatterij op een eigen groep (`circuit`) krijgt de stekkerposten plus een
  // extra groep, zoals in de keuzehulp.
  // Bij een onbekende soort de posten van de catalogus, of anders die van een vaste installatie; de soort zelf blijft onbekend.
  const hasQuoteTotal = option => option.costs.battery?.status === "priced" && option.costs.battery.source === Data.QUOTE_TOTAL;
  const filledText = (option, filled) => !filled ? "Er waren geen open posten om te vullen." : hasQuoteTotal(option)
    ? `${filled} posten ingevuld. Naast de totaalprijs tellen ze als inbegrepen; controleer dat in de offerte.`
    : `${filled} posten gevuld met indicaties. Vervang ze door offertebedragen waar je die hebt.`;
  // Staat er al een totaalprijs uit een offerte op de accupost, dan tellen eenmalige posten met een indicatie als
  // inbegrepen (met een notitie om dat na te gaan) in plaats van erbovenop, en komt er geen reserve voor meerwerk bij.
  function fillEstimates(option, costCatalog, described) {
    let filled = 0;
    const quoted = hasQuoteTotal(option);
    const timing = new Map(costCatalog.categories.map(c => [c.key, c.timing]));
    for (const [category, line] of estimates(option.kind, costCatalog, described)) {
      const current = option.costs[category];
      if (current && current.status !== "unknown") continue;
      const inQuote = quoted && line.status === "priced" && timing.get(category) === "upfront" && !Data.CREDITS.includes(category);
      option.costs[category] = !inQuote ? line : category === "contingency"
        ? { status: "not_applicable", amount: "", year: "", source: "Aanname bij een totaalprijs",
          notes: "Geen reserve voor meerwerk bovenop de totaalprijs. Is de prijs onder voorbehoud van schouw, vul dan een bedrag in." }
        : { status: "included", amount: "", year: "", source: "Aanname: in de totaalprijs van de offerte",
          notes: `Aanname: zit in de totaalprijs (indicatie los ${money(parse(line.amount, { money: true }), { decimals: 0 })}). ` +
            "Controleer dat in de offerte; staat het er niet in, vul dan het bedrag in." };
      filled++;
    }
    return filled;
  }
  // De kostenindicaties voor een soort aansluiting, als post → bewaarde regel; posten zonder indicatie ontbreken.
  function estimates(connection, costCatalog, described) {
    const chosen = CONNECTIONS.includes(connection) ? connection : Data.connectionOf(described) || "fixed";
    const circuit = chosen === "circuit", kind = circuit ? "fixed" : chosen;
    // Zonder product is een ingebouwde omvormer bij een stekkerbatterij een aanname, geen bronclaim.
    const lines = described ? Data.costLinesFor(costCatalog, { ...described, circuit }, {}, kind)
      : Data.estimateCosts(costCatalog, { kind, circuit, manufacturer: "", phases: null,
        inverterIncluded: chosen !== "fixed" }, {}).map(line => line.category !== "inverter" || line.status !== "included" ? line
          : { ...line, source: "Aanname", notes: "Aanname: een stekkerbatterij heeft een ingebouwde omvormer; controleer dat in de offerte." });
    return new Map(lines.filter(line => line.status !== "unknown").map(line => [line.category, { status: line.status,
      amount: line.status === "priced" ? (line.amount_minor / 100).toFixed(2).replace(".", ",") : "", year: "", source: line.source,
      notes: line.notes }]));
  }

  function optionCard(option, index, categories, catalogData) {
    // Een optie bevat vaak een hele offerte; verwijderen vraagt daarom om bevestiging, zoals elders in de app.
    const name = () => option.name || `Optie ${index + 1}`;
    const remove = button("Verwijder deze optie", () => UI.confirm("Optie verwijderen?", [
      `‘${name()}’ wordt met de techniek en alle kostenposten uit dit concept verwijderd. Dit kan niet ongedaan worden gemaakt.`
    ], "Verwijder optie", () => { state.options.splice(index, 1); persist();
      redraw(state.options.length ? { index: Math.max(0, index - 1), what: "summary" } : { add: true }); }), "ghost remove");
    const tech = h("div", { class: "grid" },
      field("Naam",
        bindValue(input({ required: true, maxlength: "200" }), () => option.name, v => { option.name = v; })),
      TECH.map(([key, label, min, max, help]) => field(label, bindValue(numberInput({ min, max, required: true, step: key === "operating_life_years" ? "1" : "any" }), () => option.battery[key], v => { option.battery[key] = v; }), help)),
      h("div", { class: "wide" }, field("Garantietermijn (jaar, optioneel)", bindValue(numberInput({ min: "1", max: "30", step: "1" }),
        () => option.warranty, v => { option.warranty = v; }),
        `Staat in de garantievoorwaarden; leeg is niet doorrekenen. Ingevuld rekenen we ook door wat de accu oplevert als hij direct ` +
        `na de garantie stopt, met ${n(Data.WARRANTY_LOSS, 1)}% verlies per jaar (ongeveer 70% over na 10 jaar) in plaats van het ` +
        "capaciteitsverlies hierboven. De rangorde en het advies veranderen niet.")));
    const assumptions = field("Bron en aannames van de techniek", bindValue(h("textarea", { rows: "3", required: true }), () => option.assumptions, v => { option.assumptions = v; }),
      "Controleer bruikbare capaciteit, werkelijk AC-vermogen en AC-systeemrendement; kVA en DC-rendement zijn hiervoor onvoldoende.");
    const progress = h("p", { class: "help" }), total = h("p", { class: "cost-total" });
    // Voortgang en lopend totaal van de ingevulde posten, zoals de rekenkern ze telt (teruggaven eraf).
    const refreshProgress = () => {
      const open = categories.filter(c => (option.costs[c.key]?.status || "unknown") === "unknown").length;
      progress.textContent = open ? `${categories.length - open} van ${categories.length} posten beoordeeld; onbekende posten blokkeren de berekening.` : `Alle ${categories.length} posten beoordeeld.`;
      let gross = 0, credit = 0, yearly = 0, invalid = 0;
      for (const c of categories) {
        const line = option.costs[c.key];
        if (line?.status !== "priced") continue;
        const euro = parse(line.amount, { money: true });
        if (euro == null) invalid++;
        else if (c.timing === "annual") yearly += euro;
        else if (c.timing === "upfront") { if (Data.CREDITS.includes(c.key)) credit += euro; else gross += euro; }
      }
      const eur = value => money(value, { decimals: 0 });
      for (const [key, , summary] of groups) {
        const members = categories.filter(c => groupOf(c) === key);
        const assessed = members.filter(c => (option.costs[c.key]?.status || "unknown") !== "unknown").length;
        const sum = members.reduce((acc, c) => acc + (option.costs[c.key]?.status === "priced"
          ? parse(option.costs[c.key].amount, { money: true }) ?? 0 : 0), 0);
        summary.textContent = ` · ${assessed} van ${members.length} beoordeeld${sum ? ` · ${eur(sum)}${key === "annual" ? " per jaar" : ""}` : ""}`;
      }
      // Teruggaven boven de kosten weigert de rekenkern; de controlestap noemt dat ook.
      total.textContent = `Startkosten volgens deze posten: ${eur(gross)}` +
        (credit ? (credit > gross ? ` vóór teruggaven; de teruggaven zijn ${eur(credit - gross)} hoger dan de kosten en ` +
          "mogen daar niet boven komen" : ` vóór teruggaven, ${eur(gross - credit)} erna`) : "") +
        ` · jaarlijks ${eur(yearly)}` +
        (invalid ? ` · ${invalid === 1 ? "één bedrag is" : `${invalid} bedragen zijn`} nog geen geldig getal` : "") +
        (open ? " · onbekende posten tellen nog niet mee" : "");
    };
    // De 26 posten in vier groepen, elk inklapbaar met een telling en bedrag in de kop. Standaard staat alleen de groep
    // met de eerste onbekende post open; wat je zelf open- of dichtklapt, blijft zo tot je de pagina verlaat.
    const groupOf = c => Data.CREDITS.includes(c.key) ? "credit" : c.timing;
    const groups = COST_GROUPS.filter(([key]) => categories.some(c => groupOf(c) === key))
      .map(([key, label]) => [key, label, h("span", { class: "fold-count" })]);
    const rows = categories.map(c => {
      const line = option.costs[c.key] ||= { status: "unknown", amount: "", year: "", source: "", notes: "" };
      const amount = numberInput({ min: "0", step: "0.01", money: true, disabled: line.status !== "priced" });
      const status = select(Object.entries(Data.costStatus), line.status);
      const year = c.timing === "event" ? numberInput({ min: "1", max: "30", step: "1",
        disabled: line.status !== "priced" }) : null;
      const source = input({ placeholder: "Offerte, bron of aanname" });
      bindValue(amount, () => line.amount, v => { line.amount = v; refreshProgress(); });
      if (year) bindValue(year, () => line.year, v => { line.year = v; });
      bindValue(source, () => line.source, v => { line.source = v; line.notes = "Invoer in Zelf doorrekenen"; });
      // Een onbekende post blokkeert de berekening: een rand en het woord ‘Nog open’, niet alleen kleur.
      const badge = h("span", { class: "badge warning open-badge" }, "Nog open");
      const mark = () => { const open = line.status === "unknown"; row.classList.toggle("is-open", open); badge.hidden = !open; };
      status.addEventListener("change",
        () => { line.status = status.value; amount.disabled = line.status !== "priced";
          if (year) year.disabled = amount.disabled;
          if (amount.disabled) { amount.value = ""; line.amount = ""; } mark(); persist(); refreshProgress(); });
      const sourceField = field("Bron of aanname", source, line.notes && line.notes !== "Invoer in Zelf doorrekenen" ? line.notes : undefined);
      sourceField.classList.add("cost-source");
      const statusField = field("Status", status);
      statusField.classList.add("cost-status");
      const amountField = field(c.timing === "annual" ? "Bedrag per jaar (€)" : "Bedrag (€)", amount);
      amountField.classList.add("cost-amount");
      const row = h("div", { class: "cost-row" }, h("div", {}, h("strong", {}, c.label), " ", badge, h("small", {}, c.note)),
        h("div", { class: "cost-controls" }, statusField, amountField,
          year ? field("Einde van jaar", year) : null,
          // De toelichting bij een indicatie (bijvoorbeeld wat niet is meegeteld) staat onder de bron.
          sourceField));
      mark();
      return [c, row];
    });
    const firstOpen = categories.find(c => (option.costs[c.key]?.status || "unknown") === "unknown");
    const opened = openGroups.get(option) || {};
    openGroups.set(option, opened);
    const costGroups = groups.map(([key, label, count]) => {
      const fold = h("details", { class: "fold cost-group", open: opened[key] ?? (firstOpen && groupOf(firstOpen) === key) },
        h("summary", {}, h("strong", {}, label), count),
        h("div", { class: "cost-rows" }, rows.filter(([c]) => groupOf(c) === key).map(([, row]) => row)));
      fold.addEventListener("toggle", () => { opened[key] = fold.open; });
      return fold;
    });
    const kind = select([["unknown", "Onbekend"], ["fixed", "Vaste installatie"], ["plug", "Stekkerbatterij in een stopcontact"],
      ["circuit", "Stekkerbatterij op een eigen groep"]], option.kind ?? "unknown",
      { onchange: async event => {
        const previous = option.kind;
        option.kind = event.target.value; persist();
        const followed = await followConnection(option, previous);
        if (!followed) return;
        persist(); toast(followed); redraw({ index, what: "summary" });
      } });
    const estimate = button("Vul open posten met indicaties", async () => {
      const [cmp, costCatalog] = await Promise.all([Data.catalog(), Data.costs()]);
      const config = cmp.configurations.find(c => c.id === option.configuration_id);
      const filled = fillEstimates(option, costCatalog, config ? Data.describe(cmp, config) : null);
      persist();
        toast(filledText(option, filled));
        redraw({ index, what: "cost" });
    }, "secondary");
    const loan = (label, key, props) => field(label,
      bindValue(numberInput({ min: "0", ...props }), () => option.loan[key], v => { option.loan[key] = v; }));
    refreshProgress();
    return h("details", { class: "panel option-editor", open: true }, h("summary", {}, option.name || `Optie ${index + 1}`),
      tech, assumptions,
      h("h3", {}, "Kosten"), progress, total,
        h("div", { class: "actions" }, field("Soort aansluiting", kind, "Bepaalt welke posten ‘Vul open posten’ invult en hoe " +
          "de uitkomst de aansluiting noemt. Al ingevulde posten blijven staan; een stekkerbatterij op een eigen groep krijgt " +
          "de post voor een extra groep."), estimate),
      h("p", { class: "help" },
        "Bedragen inclusief niet-teruggevraagde btw. Een pakketprijs staat één keer bij de accu; inbegrepen onderdelen tellen niet dubbel."),
      quoteTotal(option, categories), costGroups,
      h("details", {}, h("summary", {}, "Financiering (optioneel)"), h("p", { class: "help" }, "Een annuïtaire lening voegt alleen de rente toe; de aanschaf telt al als investering. Looptijd binnen de analysehorizon."),
        h("div", { class: "grid" }, loan("Leningbedrag (€)", "amount", { step: "0.01", money: true }), loan("Rente per jaar (%)", "interest", { max: "30", step: "0.01" }), loan("Looptijd (jaren)", "years", { max: "30", step: "1" }))),
      h("div", { class: "actions option-end" }, remove));
  }

  // Eén totaalprijs uit een offerte in de kostenposten, zoals de offertecheck bij een uitkomst (`Data.applyQuotePrice`): het
  // bedrag op de accupost, de aangevinkte posten met een bedrag als inbegrepen, en bij een vaste prijs geen reserve voor
  // meerwerk. Onbekende posten blijven onbekend; die moet je zelf beoordelen.
  function quoteTotal(option, categories) {
    const note = quoteNotes.get(option);
    const amountOf = line => line?.status === "priced" ? parse(line.amount, { money: true }) : null;
    const others = categories.filter(c => c.timing === "upfront" && !Data.CREDITS.includes(c.key) &&
      !["battery", "contingency"].includes(c.key) && amountOf(option.costs[c.key]) != null);
    // Niet verplicht: het blok is optioneel en mag ‘Volgende’ niet tegenhouden; ‘Zet in de kostenposten’ vraagt erom.
    const price = numberInput({ min: "1", step: "0.01", money: true });
    const boxes = others.map(c => [c, UI.checkbox(`${c.label} (${money(amountOf(option.costs[c.key]), { decimals: 0 })})`,
      { checked: true })]);
    const terms = select([["", "Weet ik niet"], ["fixed", "Vaste prijs"], ["survey", "Onder voorbehoud van schouw"]], "");
    const status = h("p", { class: "help", role: "status" }, note || "");
    const block = h("div", { class: "grid" });
    const apply = button("Zet in de kostenposten", () => {
      if (!UI.validate(block)) return;
      const value = parse(price.value, { money: true });
      if (value == null) { UI.reject(price, "Vul de totaalprijs uit de offerte in.", block); price.setCustomValidity(""); return; }
      const lines = categories.map(c => { const l = option.costs[c.key];
        return { category: c.key, timing: c.timing, status: l.status, source: l.source, notes: l.notes,
          amount_minor: l.status === "priced" ? Math.round((amountOf(l) ?? 0) * 100) : 0 }; });
      const before = lines.map(l => ({ ...l }));
      const separate = boxes.filter(([, b]) => !b.box.checked).map(([c]) => c.key);
      Data.applyQuotePrice({ costs: lines }, "upfront_eur", value, { separate, fixedPrice: terms.value === "fixed" });
      const changed = [];
      lines.forEach((l, i) => {
        const old = before[i];
        if (l.status === old.status && l.amount_minor === old.amount_minor && l.source === old.source) return;
        option.costs[l.category] = { ...option.costs[l.category], status: l.status, source: l.source, notes: l.notes,
          amount: l.status === "priced" ? (l.amount_minor / 100).toFixed(2).replace(".", ",") : "" };
        changed.push(l);
      });
      const label = key => categories.find(c => c.key === key).label;
      const included = changed.filter(l => l.status === "included").map(l => label(l.category).toLowerCase());
      const open = categories.filter(c => (option.costs[c.key]?.status || "unknown") === "unknown").length;
      quoteNotes.set(option, [`Totaalprijs ${money(value)} staat op de accupost.`,
        included.length ? `Als inbegrepen gemarkeerd: ${included.join(", ")}.` : null,
        separate.length ? `Apart gehouden: ${separate.map(key => label(key).toLowerCase()).join(", ")}.` : null,
        changed.some(l => l.category === "contingency") ? "De reserve voor meerwerk vervalt: de offerte heeft een vaste prijs." : null,
        open ? `${open === 1 ? "Eén post is" : `${open} posten zijn`} nog onbekend. Zet ze op Inbegrepen of Niet van toepassing, of kies ‘Vul open posten met indicaties’: naast de totaalprijs tellen die als inbegrepen, met een notitie om dat na te gaan.` : null]
        .filter(Boolean).join(" "));
      persist(); redraw();
    }, "secondary");
    block.append(field("Totaalprijs inclusief btw (€)", price, "Het bedrag dat je volgens de offerte in totaal betaalt."),
      field("Soort prijs", terms, "Alleen bij een vaste prijs vervalt de reserve voor meerwerk."));
    return h("details", { class: "fold", open: Boolean(note) }, h("summary", {}, "Eén totaalprijs uit een offerte invullen"),
      h("p", { class: "help" }, "Noemt je offerte één prijs voor alles? Die komt op de accupost; de posten hieronder met een " +
        "bedrag tellen dan als inbegrepen, behalve wat je uitvinkt omdat de offerte het niet noemt."),
      block,
      boxes.length ? h("fieldset", {}, h("legend", {}, "Telt als inbegrepen in de totaalprijs (vink uit wat de offerte niet noemt)"),
        boxes.map(([, b]) => b.element))
        : h("p", { class: "help" }, "Nog geen andere startposten met een bedrag. Vul eerst de open posten met indicaties om te zien wat de offerte moet dekken."),
      h("p", { class: "actions" }, apply), status);
  }

  // Een overgenomen run weet niet of een catalogusoptie een stekkeraccu is; zonder dat zou ‘Vul open posten’ het
  // installatiepakket van een vaste accu invullen.
  // Op naam, zodat een afgeleide uitvoering op een eigen groep geen stekkeraccu wordt (`Data.described`).
  async function resolveKinds(cmp) {
    const open = state.options.filter(o => o.kind == null);
    if (!open.length) return;
    const described = await Data.described(open).catch(() => new Map());
    for (const option of open) {
      const config = cmp.configurations.find(c => c.id === option.configuration_id);
      option.kind = Data.connectionOf(described.get(option.key) ?? (config && Data.describe(cmp, config))) || "unknown";
    }
  }

  function stepOptions(body) {
    body.append(h("h2", {}, "Accu-opties en kosten"),
      h("p", { class: "help" },
        "Elke optie wordt vergeleken met geen accu. Ontbrekende specificaties en prijzen worden niet stilzwijgend aangenomen: gebruik de knop voor indicaties of vul je offerte in."));
    const host = h("div", {}, h("p", { class: "help" }, "Laden…")); body.append(host);
    Promise.all([Data.catalog(), Data.costs()]).then(async ([cmp, costCatalog]) => {
      await resolveKinds(cmp);
      const pickConfig = select([["", "Kies een uitvoering…"],
        ...cmp.configurations.map(c => [String(c.id), `${c.manufacturer_name} · ${c.product_name} · ${c.name}`])],
        "");
      const fromCatalog = button("Neem over",
        () => UI.busy(fromCatalog,
          async () => { if (state.options.length >= MAX_OPTIONS) throw new Error(full());
            await addFromCatalog(pickConfig.value); redraw({ index: state.options.length - 1, what: "summary" }); }),
        "secondary");
      const own = button("+ Eigen optie",
        () => { if (state.options.length >= MAX_OPTIONS) { toast(full(), true);
          return; } state.options.push(blankOption(state.options.length + 1));
          persist(); redraw({ index: state.options.length - 1, what: "summary" }); },
        "secondary");
      host.replaceChildren();
      UI.append(host, [h("div", { class: "toolbar" }, field("Uit de catalogus", pickConfig), fromCatalog, own),
        state.options.length ? state.options.map((option, i) => optionCard(option, i, costCatalog.categories,
          cmp)) : h("p",
          { class: "empty" }, "Nog geen opties. Neem een accu over uit de catalogus of voeg een eigen optie toe."),
        h("details", { class: "sources" }, h("summary", {}, "Kostenonderzoek en bronnen"), h("p", {}, costCatalog.notes),
          h("ul", {}, costCatalog.sources.map(s => h("li", {}, UI.external(s.title, s.url), h("small", {}, s.note)))))]);
      // Vanuit de controlestap of na indicaties: naar de eerste onbekende kostenpost van die optie, of de optie zelf.
      // Na toevoegen of verwijderen naar de kop van de optie, zonder opties naar ‘+ Eigen optie’.
      const wanted = focusOption, y = keptScroll;
      focusOption = null; keptScroll = null;
      const card = wanted?.index == null ? null : host.querySelectorAll(".option-editor")[wanted.index];
      const target = wanted?.add ? own : !card ? null : (wanted.what === "cost"
        && [...card.querySelectorAll(".cost-row select")].find(s => s.value === "unknown")) || card.querySelector("summary");
      if (target) {
        const group = target.closest(".cost-group");
        if (group) group.open = true;
        target.scrollIntoView({ block: "center" }); target.focus();
      } else if (y != null) window.scrollTo(0, y);
    }).catch(error => host.replaceChildren(h("p", { class: "warning" }, error.message)));
  }

  // Wat er nog mist, per accu-optie gegroepeerd, met een weg terug: open posten vullen of naar de optie.
  function reviewProblems(problems, optionProblems, costCatalog) {
    const total = problems.length + optionProblems.flat().length;
    const groups = state.options.map((option, index) => [option, index, optionProblems[index]]).filter(([, , list]) => list.length);
    return h("div", { class: "callout review-problems", tabindex: "-1" },
      h("p", {}, `${total} ${total === 1 ? "punt vraagt" : "punten vragen"} nog aandacht:`),
      problems.length ? h("ul", {}, problems.map(p => h("li", {}, p))) : null,
      groups.map(([option, index, list]) => {
        const open = costCatalog.categories.some(c => (option.costs[c.key]?.status || "unknown") === "unknown");
        const fill = open ? button("Vul open posten met indicaties", () => UI.busy(fill, async () => {
          const cmp = await Data.catalog(), config = cmp.configurations.find(c => c.id === option.configuration_id);
          const filled = fillEstimates(option, costCatalog, config ? Data.describe(cmp, config) : null);
          persist();
          toast(filledText(option, filled));
          redraw();
        }), "secondary") : null;
        const go = button("Ga naar deze optie", () => { focusOption = { index, what: "cost" }; flow.show(2); }, "ghost");
        return h("div", { class: "problem-group" }, h("h3", {}, option.name || `Optie ${index + 1}`),
          h("ul", {}, list.map(p => h("li", {}, p))), h("div", { class: "actions" }, fill, go));
      }));
  }

  function stepReview(body) {
    body.append(h("h2", {}, "Controle en berekenen"));
    const host = h("div"), step = flow.current; body.append(host);
    Data.costs().then(costCatalog => {
      const { problems, optionProblems, count, request } = build(costCatalog.categories);
      const confirmations = [
        "Het profiel bevat bruto huishoudelijk verbruik en AC-zonneproductie, geen netafname of teruglevering als vervanging daarvan.",
        "De technische invoer is gecontroleerd of expliciet als aanname beschreven; geschiktheid voor de installatie is daarmee nog niet gegarandeerd.",
        "Alle kostenposten zijn beoordeeld; bedragen, inbegrepen of niet-toepasselijke posten en aftrekposten zijn offertegegevens of expliciete aannames."
      ].map(text => checkbox(text, { required: true }));
      const run = button("Bereken en bewaar", () => UI.busy(run, async () => {
        if (count) { host.querySelector(".review-problems")?.focus(); throw new Error("Los eerst de punten hierboven op."); }
        if (!UI.validate(host)) return;
        const response = await flow.busy(`Bezig met rekenen aan ${state.options.length} ${state.options.length === 1 ? "optie" : "opties"}…`,
          () => UI.api("/api/v1/analysis/runs",
            { method: "POST",
              json: { ...request, costs_confirmed: true, technical_assumptions_confirmed: true,
                consumption_is_gross: true, production_is_ac: true } }));
        store.set(STORE, null); state = blank();
        flow.arrive(`#/berekeningen/${response.id}`, "De berekening is klaar en bewaard.");
      }));
      UI.append(host, [table(["Onderdeel", "Invoer"], [
        ["Naam en adres", `${state.title} · ${state.address || "geen adres"}`],
          ["Doel", Data.objectives[state.objective]],
        ["Stroomprijs / terugleververgoeding / terugleverkosten",
          [state.tariff.import, state.tariff.export, state.tariff.fee].map(v => { const x = UI.parse(v);
            return x == null ? "?" : UI.money(x, { decimals: 4 }); }).join(" / ") + " per kWh" +
            (request.parameters.tariff.export_fee_bands.length ? ", plus staffels" : "")],
          ["Looptijd", `${state.params.horizon_years} jaar vanaf ${state.params.start_year}`],
        ["Accu-opties", state.options.length <= 3 ? state.options.map(o => o.name).join(", ") || "Geen"
          : h("details", { class: "fold" }, h("summary", {}, `${state.options.length} opties`),
            h("ul", { class: "compact" }, state.options.map(o => h("li", {}, o.name))))],
        // De garantie verandert de rangorde niet, maar wel de waarschuwing in de uitkomst; daarom ook hier.
        ["Garantie", state.options.map(o => `${o.name}: ${String(o.warranty ?? "").trim() ? `${o.warranty} jaar`
          : "niet ingevuld"}`).join("; ") || "—"],
        ...(request.quote_basis ? [["Uit de offerte", request.quote_basis.changes.map(Data.quoteChange).join("; ")]] : [])]),
        count ? reviewProblems(problems, optionProblems, costCatalog) : h("p", { class: "derived" }, "De invoer is compleet."),
        h("fieldset", {}, h("legend", {}, "Bevestig"), confirmations.map(c => c.element)),
        request.quote_basis ? h("p", { class: "help" }, "Je vinkt de bevestigingen bewust opnieuw aan: zo bevestig je dat de " +
          "waarden uit de offerte kloppen.") : null]);
      if (keptScroll != null) { window.scrollTo(0, keptScroll); keptScroll = null; }
      // De knop staat in de vaste balk onderaan, vlak onder de bevestigingen.
      if (flow.current === step) flow.action(run);
    });
  }

  UI.page("zelf", {
    nav: "Zelf doorrekenen", icon: "sliders", title: "Zelf doorrekenen",
      subtitle: "Voor wie offertes heeft: alle aannames en kostenposten zelf invullen.",
    render(view, actions) {
      state = { ...blank(), ...store.get(STORE, {}) };
      actions.append(button("Begin opnieuw", () => UI.confirm("Opnieuw beginnen?",
        ["Je concept met alle opties, kostenposten en aannames wordt gewist. Bewaarde berekeningen blijven staan."],
        "Wis het concept", () => { store.set(STORE, null); state = blank(); flow.show(0); }), "ghost"));
      view.append(h("details", { class: "help-box" }, h("summary", {}, "Over deze berekening"),
        h("p", {},
          "Het model simuleert zonnestroom opslaan voor eigen gebruik met vaste tarieven, per meetperiode over één volledig jaar, en vergelijkt elke optie met geen accu. Dynamische handel en onbalansinkomsten zijn niet opgenomen."),
        h("p", {}, "Zonder offertes? De ", link("keuzehulp", "#/keuzehulp"), " vult alles met bronvermelde indicaties.")));
      flow = UI.wizard([{ label: "Profiel en doel", render: stepProfile }, { label: "Tarieven", render: stepTariffs }, { label: "Accu-opties", render: stepOptions }, { label: "Controle", render: stepReview }],
        // Een nieuwe stap begint bovenaan; opnieuw tekenen (redraw) houdt de plek. De optie- en controlestap laden
        // eerst catalogus en kosten en zetten daarna zelf de plek of focus terug.
        { validate: (_, body) => UI.validate(body), onShow: index => {
          if (keptScroll == null) window.scrollTo(0, 0);
          else if (index < 2) { window.scrollTo(0, keptScroll); keptScroll = null; focusOption = null; } } });
      // Vanuit de offertecheck opent de controlestap direct; daarna begint de wizard weer vooraan.
      view.append(flow.element); flow.show(state.step ?? 0);
      if (state.step != null) { delete state.step; persist(); }
    }
  });

  // Uitvoeringen uit de catalogusvergelijking als extra opties in het concept; het concept opent bij de
  // opties, of bij het profiel als dat nog niet gekozen is. Geeft het aantal toegevoegde opties.
  // Voegt uitvoeringen toe aan het concept; wat er al als optie in staat, komt er niet nog eens bij.
  // Geeft terug hoeveel er zijn toegevoegd, al in het concept stonden, en hoeveel andere opties er al waren.
  async function addConfigurations(ids) {
    state = { ...blank(), ...store.get(STORE, {}) };
    const present = new Set(state.options.map(o => o.configuration_id));
    const others = state.options.filter(o => !ids.includes(o.configuration_id)).length;
    let added = 0, already = 0;
    for (const id of ids) {
      if (present.has(id)) { already++; continue; }
      if (state.options.length >= MAX_OPTIONS) break;
      await addFromCatalog(String(id)); added++;
    }
    clearTimeout(saveTimer);
    store.set(STORE, { ...state, step: state.profile ? 2 : 0 });
    return { added, already, others };
  }
  // Een concept met minstens één accu-optie; dat gooi je niet zonder te vragen weg.
  const hasDraft = () => (store.get(STORE, {})?.options || []).length > 0;

  return { load, hasDraft, addConfigurations, followConnection, PARAMS, MAX_OPTIONS };
})();
