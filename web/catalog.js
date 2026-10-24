"use strict";

// Accucatalogus en vergelijking. Bronclaims blijven naast elkaar staan, elk met bron,
// vindplaats, markt en meetgrens. Er wordt geen winnaar gekozen.
(() => {
  const { h, button, link, external, badge, table, field, input, numberInput, select, money, number: n, toast,
    store } = UI;
  const SELECTION = "thuisaccu-vergelijking";
  const selected = new Set(store.get(SELECTION, []));
  const remember = () => store.set(SELECTION, [...selected]);
  const filters = { query: "", maker: "", kind: "" };

  const ofConfig = (rows, config) => rows.filter(row => row.configuration_id === config.id);
  const priceText = offer => `${offer.currency === "EUR" ? money(offer.upfront_amount_minor / 10 ** offer.minor_unit_exponent, { decimals: 0 }) : `${offer.currency} ${n(offer.upfront_amount_minor / 10 ** offer.minor_unit_exponent)}`}${{ included: " incl. btw", excluded: " excl. btw", unknown: "" }[offer.tax_basis]}`;

  function sourceDetails(claim) {
    let url = null;
    try { const parsed = new URL(claim.source_url); if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.href; } catch { /* handmatige bron */ }
    const lines = [claim.document_revision && `Revisie: ${claim.document_revision}`, claim.locator, claim.market, claim.conditions, claim.entry_conditions, claim.additional_costs_notes,
      claim.observed_at_unix_s && `Vastgelegd: ${UI.dateTime(claim.observed_at_unix_s)}`,
      ...[["test_temperature_c", "Testtemperatuur", "°C"], ["test_power_w", "Testvermogen", "W"],
        ["test_soc_pct", "SoC", "%"], ["test_depth_of_discharge_pct", "DoD", "%"], ["test_c_rate", "C-rate", "C"]]
        .filter(([key]) => claim[key] != null).map(([key, label, unit]) => `${label}: ${n(claim[key])} ${unit}`),
      Data.review[claim.review_status] || "Controlestatus onbekend"];
    return h("details", { class: "source" }, h("summary", {}, "Bron en context"),
      h("p", {}, claim.source_title || "Bron"),
        url ? external("Open bron ↗", url) : h("p", {}, "Handmatig opgegeven gegevens"),
      lines.filter(Boolean).map(text => h("p", {}, text)));
  }
  const unknown = () => h("span", { class: "unknown" }, "Onbekend");
  const smart = value => n(value, Number.isInteger(value) ? 0 : 2);
  function numbers(cmp, config, metric, scale, unit) {
    const claims = ofConfig(cmp.numbers, config).filter(c => c.metric_key === metric);
    if (!claims.length) return unknown();
    return h("div", {}, claims.map(c => h("div", { class: "claim" },
      h("strong", {},
        `${c.qualifier === "range" ? `${smart(c.value / scale)} – ${smart(c.upper_value / scale)}` : `${Data.qualifiers[c.qualifier] || ""}${smart(c.value / scale)}`} ${unit}`.trim()),
      h("small", {}, Data.boundaries[c.boundary] || c.boundary), sourceDetails(c))));
  }
  function texts(cmp, config, metric) {
    const claims = ofConfig(cmp.texts, config).filter(c => c.metric_key === metric);
    return claims.length ? h("div", {},
      claims.map(c => h("div", { class: "claim" }, h("strong", {}, c.value), sourceDetails(c)))) : unknown();
  }
  function features(cmp, config, metric) {
    const claims = ofConfig(cmp.features, config).filter(c => c.metric_key === metric);
    const label = { supported: "Ja", unsupported: "Nee", conditional: "Onder voorwaarden", unknown: "Onbekend" };
    return claims.length ? h("div", {},
      claims.map(c => h("div", { class: "claim" },
        h("strong", { class: c.status === "unknown" ? "unknown" : "" }, label[c.status]),
        sourceDetails(c)))) : unknown();
  }
  function warranties(cmp, config) {
    const claims = ofConfig(cmp.warranties, config);
    if (!claims.length) return unknown();
    return h("div", {}, claims.map(c => h("div", { class: "claim" },
      h("strong", {},
        c.product_months ? `${n(c.product_months / 12, 0)} jaar productgarantie` : "Productduur onbekend"),
      c.performance_months ? h("small", {}, `Prestatie: ${n(c.performance_months / 12, 0)} jaar`) : null,
      c.retained_capacity_pct != null ? h("small", {}, `Capaciteitsbehoud: ${n(c.retained_capacity_pct, 0)}%`) : null,
      c.throughput_wh != null ? h("small", {}, `Doorzetgrens: ${n(c.throughput_wh / 1000, 0)} kWh`) : null,
      c.cycle_limit != null ? h("small", {}, `Cyclusgrens: ${n(c.cycle_limit, 0)}`) : null,
      sourceDetails({ ...c, conditions: `${c.application}. ${c.exclusions}` }))));
  }
  function prices(cmp, config, perKwh = false) {
    const offers = ofConfig(cmp.offers, config);
    if (!offers.length) return h("span", { class: "unknown" }, "Geen prijs vastgelegd");
    const usable = ofConfig(cmp.numbers,
      config).filter(c => c.metric_key === "usable_energy_wh" && c.qualifier === "exact");
    return h("div", {}, offers.map(o => {
      if (perKwh && usable.length !== 1) return h("div", { class: "claim" },
        h("span", { class: "unknown" }, "Niet bepaald: geen eenduidige bruikbare capaciteit"));
      const value = o.upfront_amount_minor / 10 ** o.minor_unit_exponent / (perKwh ? usable[0].value / 1000 : 1);
      return h("div", { class: "claim" },
        h("strong", {},
          `${o.currency === "EUR" ? money(value) : `${o.currency} ${n(value)}`}${perKwh ? " per kWh" : ""}`),
        h("small", {},
          `${{ included: "Incl. btw", excluded: "Excl. btw", unknown: "Btw-basis onbekend" }[o.tax_basis]}; installatie ${o.includes_installation == null ? "onbekend" : o.includes_installation ? "inbegrepen" : "niet inbegrepen"}`),
        o.valid_until_unix_s && o.valid_until_unix_s < Date.now() / 1000 ? h("small", { class: "warning" },
          "Aanbieding verlopen") : null,
        sourceDetails(o));
    }));
  }

  // Rijen van de vergelijking, gegroepeerd. Elke cel toont alle bronclaims.
  const ROWS = [
    ["Prestaties", [
      ["Bruikbare energie", (d, c) => numbers(d, c, "usable_energy_wh", 1000, "kWh")],
        ["Opgegeven / nominale energie", (d, c) => numbers(d, c, "nominal_energy_wh", 1000, "kWh")],
      ["Ontlaaddiepte", (d, c) => numbers(d, c, "depth_of_discharge_pct", 1, "%")],
        ["Continu laden", (d, c) => numbers(d, c, "continuous_charge_power_w", 1000, "kW")],
      ["Continu ontladen", (d, c) => numbers(d, c, "continuous_discharge_power_w", 1000, "kW")],
        ["Schijnbaar vermogen", (d, c) => numbers(d, c, "apparent_power_va", 1000, "kVA")],
      ["Piekvermogen", (d, c) => numbers(d, c, "peak_discharge_power_w", 1000, "kW")],
        ["Round-trip-rendement", (d, c) => numbers(d, c, "round_trip_efficiency_pct", 1, "%")],
      ["Sluimerverbruik", (d, c) => numbers(d, c, "standby_power_w", 1, "W")], ["Cycli", (d, c) => numbers(d, c, "cycle_life_cycles", 1, "")]]],
    ["Installatie", [
      ["Koppeling", (d, c) => texts(d, c, "coupling")], ["Fasen", (d, c) => texts(d, c, "phase_topology")],
        ["Aantal fasen", (d, c) => numbers(d, c, "phase_count", 1, "")],
      ["Omvormer inbegrepen", (d, c) => features(d, c, "inverter_included")],
        ["Noodstroom", (d, c) => features(d, c, "backup")],
        ["Noodstroomvermogen", (d, c) => numbers(d, c, "backup_power_w", 1000, "kW")],
      ["Binnen", (d, c) => features(d, c, "indoor")], ["Buiten", (d, c) => features(d, c, "outdoor")],
        ["IP-klasse", (d, c) => texts(d, c, "ip_rating")],
      ["Chemie", (d, c) => texts(d, c, "chemistry")],
        ["Benodigde accessoires", (d, c) => texts(d, c, "required_accessories")],
        ["Gewicht", (d, c) => numbers(d, c, "weight_kg", 1, "kg")],
      ["Geluid", (d, c) => numbers(d, c, "noise_db_a", 1, "dB(A)")]]],
    ["Voorwaarden", [
      ["Garantie", (d, c) => warranties(d, c)], ["Uitbreidbaar", (d, c) => features(d, c, "expandable")],
        ["Cloud vereist", (d, c) => features(d, c, "cloud_required")],
      ["Abonnement vereist", (d, c) => features(d, c, "subscription_required")]]],
    ["Prijzen", [["Aanbiedingen", (d, c) => prices(d, c)], ["Prijs per bruikbare kWh", (d, c) => prices(d, c, true)]]]
  ];
  const plain = cell => { const clone = cell.cloneNode(true);
    clone.querySelectorAll("details").forEach(d => d.remove()); return clone.textContent.trim(); };

  function comparisonTable(cmp, configs, { differencesOnly, knownOnly }) {
    const tableEl = h("table", { class: "compare" },
      h("caption", {}, "Bronclaims naast elkaar; er wordt geen winnaar gekozen."),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Eigenschap"),
        configs.map(c => h("th", { scope: "col" }, h("small", {}, c.manufacturer_name), h("strong", {}, c.product_name), h("small", {}, c.name))))));
    for (const [group, rows] of ROWS) {
      const body = h("tbody", {},
        h("tr", { class: "group" }, h("th", { colspan: String(configs.length + 1), scope: "rowgroup" }, group)));
      for (const [label, render] of rows) {
        const cells = configs.map(c => render(cmp, c)), texts = cells.map(plain);
        if (knownOnly && texts.every(t => /^(Onbekend|Geen prijs vastgelegd)$/.test(t))) continue;
        if (differencesOnly && new Set(texts).size === 1) continue;
        body.append(h("tr", {}, h("th", { scope: "row" }, label), cells.map(cell => h("td", {}, cell))));
      }
      if (body.children.length > 1) tableEl.append(body);
    }
    return tableEl;
  }

  function exportComparison(tableEl) {
    UI.downloadCsv("thuisaccu-vergelijking.csv", [...tableEl.querySelectorAll("tr")].map(row => [...row.children].map(cell => {
      const sources = [...new Set([...cell.querySelectorAll("a[href]")].map(a => a.href))];
      return `${plain(cell).replace(/\s+/g, " ")}${sources.length ? ` Bronnen: ${sources.join(" | ")}` : ""}`;
    })));
  }

  async function loadReferences(target) {
    await UI.busy(target, async () => {
      const result = await UI.api("/api/v1/references", { method: "POST" });
      Data.invalidateCatalog();
      toast(result.imported ? "Onderzochte uitvoeringen toegevoegd. Controleer bron, markt en installatieomvang." : "Deze onderzochte uitvoeringen zijn al geladen.");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  }

  // Exact bedrag in minor units, zonder afronding via drijvende komma.
  function minorUnits(raw, exponent) {
    const text = raw.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("Gebruik een positief bedrag zonder duizendtalscheiding.");
    const [whole, fraction = ""] = text.split(".");
    if (fraction.length > exponent) throw new Error("Het bedrag heeft meer decimalen dan de valuta toestaat.");
    const minor = Number(whole + fraction.padEnd(exponent, "0"));
    if (!Number.isSafeInteger(minor)) throw new Error("Het bedrag is te groot.");
    return minor;
  }

  function openCandidateDialog(onSaved) {
    const f = {
      manufacturer: input({ required: true, maxlength: "200" }),
        product: input({ required: true, maxlength: "200" }), model_code: input({ maxlength: "200" }),
      product_kind: select([["battery_system", "Accusysteem"], ["battery_module", "Accumodule"]]),
        configuration: input({ required: true, maxlength: "200", placeholder: "Bijv. 2 modules met omvormer X" }),
      market: input({ required: true, maxlength: "200", value: "unspecified" }),
        source_title: input({ required: true, maxlength: "200", value: "Eigen invoer of offerte" }),
      source_url: input({ type: "url", placeholder: "https://…" }),
        locator: input({ required: true, maxlength: "200", value: "Handmatige invoer" }), document_revision: input(),
      conditions: h("textarea",
        { rows: "2", placeholder: "Meetcondities, firmware, benodigde accessoires of offerteomvang" }),
      usable_kwh: numberInput({ min: "0.001" }),
        energy_boundary: select([["unspecified", "Niet vastgesteld"], ["battery_dc", "Accu DC"],
          ["system_ac", "Systeem AC"]]),
      charge_kw: numberInput({ min: "0" }), discharge_kw: numberInput({ min: "0" }),
        power_boundary: select([["unspecified", "Niet vastgesteld"], ["system_ac", "Systeem AC"],
          ["battery_dc", "Accu DC"]]),
      efficiency_pct: numberInput({ min: "0", max: "100" }),
        efficiency_boundary: select([["unspecified", "Niet vastgesteld"], ["ac_ac", "AC → AC"], ["dc_dc", "DC → DC"],
          ["pv_ac", "PV → opslag → AC"]]),
      warranty_years: numberInput({ min: "0.25", step: "0.25" }),
      backup: select([["unknown", "Niet bekend"], ["supported", "Ondersteund"],
        ["unsupported", "Niet ondersteund"], ["conditional", "Onder voorwaarden"]]),
      price: input({ inputmode: "decimal", placeholder: "Bijv. 6500,00" }),
        currency: input({ value: "EUR", pattern: "[A-Z]{3}", maxlength: "3" }),
      exponent: select([["2", "2 (EUR/USD)"], ["0", "0 (JPY)"], ["3", "3 (KWD)"]]), seller: input(),
      tax_basis: select([["unknown", "Niet bekend"], ["included", "Inclusief btw"], ["excluded", "Exclusief btw"]]),
      includes_installation: select([["", "Niet bekend"], ["true", "Ja"], ["false", "Nee"]])
    };
    const grid = (...pairs) => h("div", { class: "grid" }, pairs.map(([label, key]) => field(label, f[key])));
    const save = button("Bewaar", async () => {
      if (!UI.validate(form)) return;
      await UI.busy(save, async () => {
        const get = key => f[key].value.trim(), numbersOut = [];
        for (const [key, metric, scale, unit, boundary] of [["usable_kwh", "usable_energy_wh", 1000, "kWh", "energy_boundary"], ["charge_kw", "continuous_charge_power_w", 1000, "kW", "power_boundary"], ["discharge_kw", "continuous_discharge_power_w", 1000, "kW", "power_boundary"], ["efficiency_pct", "round_trip_efficiency_pct", 1, "%", "efficiency_boundary"]]) {
          if (get(key)) numbersOut.push({ metric, qualifier: "exact", value: Number(get(key)) * scale,
            boundary: get(boundary), reported_value: `${get(key)} ${unit}` });
        }
        const featuresOut = get("backup") === "unknown" ? [] : [{ metric: "backup", status: get("backup"),
          conditions: get("conditions") }];
        if (featuresOut.some(v => v.status === "conditional" && !v.conditions)) throw new Error("Beschrijf de voorwaarden voor noodstroom onder voorwaarden.");
        let price = null;
        if (get("price")) {
          if (!get("seller")) throw new Error("Vul bij een prijs ook de verkoper in.");
          price = { seller: get("seller"), currency: get("currency"),
            minor_unit_exponent: Number(get("exponent")),
            amount_minor: minorUnits(get("price"), Number(get("exponent"))), tax_basis: get("tax_basis"),
            includes_installation: get("includes_installation") === "" ? null : get("includes_installation") === "true" };
        }
        const payload = {
          manufacturer: get("manufacturer"), product: get("product"), model_code: get("model_code"),
            product_kind: get("product_kind"), configuration: get("configuration"),
          market: get("market"), source_url: get("source_url"), source_title: get("source_title"),
            locator: get("locator"), document_revision: get("document_revision") || null,
          published_on: null, conditions: get("conditions"), numbers: numbersOut, features: featuresOut, texts: [],
          product_warranty_months: get("warranty_years") ? Math.round(Number(get("warranty_years")) * 12) : null, price
        };
        const result = await UI.api("/api/v1/candidates", { method: "POST", json: payload });
        if (selected.size < 4) { selected.add(result.configuration_id); remember(); }
        Data.invalidateCatalog(); dialogRef.close();
          toast("Opgeslagen als nieuwe bron. Bestaande gegevens zijn niet overschreven."); onSaved();
      });
    });
    const form = h("form", { novalidate: true, onsubmit: event => event.preventDefault() },
      h("p", {},
        "Leg de gegevens van één uitvoering en één bron vast. Lege velden blijven onbekend. Gebruik hetzelfde product en dezelfde uitvoering om een extra bron of offerte toe te voegen."),
      h("fieldset", {}, h("legend", {}, "Uitvoering en bron"),
        grid(["Fabrikant", "manufacturer"], ["Productnaam", "product"], ["Modelcode (optioneel)", "model_code"],
          ["Type", "product_kind"], ["Concrete uitvoering", "configuration"], ["Markt of regio", "market"],
          ["Brontitel", "source_title"], ["Bronlink (optioneel)", "source_url"], ["Vindplaats", "locator"],
          ["Documentrevisie (optioneel)", "document_revision"]),
        field("Context en voorwaarden", f.conditions)),
      h("fieldset", {}, h("legend", {}, "Techniek (optioneel)"),
        grid(["Bruikbare energie (kWh)", "usable_kwh"], ["Meetgrens energie", "energy_boundary"],
          ["Continu laden (kW)", "charge_kw"], ["Continu ontladen (kW)", "discharge_kw"],
          ["Meetgrens vermogen", "power_boundary"], ["Round-trip-rendement (%)", "efficiency_pct"],
          ["Meetgrens rendement", "efficiency_boundary"], ["Productgarantie (jaren)", "warranty_years"],
          ["Noodstroom", "backup"])),
      h("fieldset", {}, h("legend", {}, "Prijs (optioneel)"),
        grid(["Aanschafbedrag", "price"], ["Valuta", "currency"], ["Decimalen van de valuta", "exponent"],
          ["Verkoper", "seller"], ["Belastingbasis", "tax_basis"],
          ["Installatie inbegrepen", "includes_installation"])),
      h("p", { class: "help" }, "Nieuwe gegevens krijgen de status ‘nog niet nagekeken’."), h("div", { class: "actions" }, save));
    const dialogRef = UI.dialog("Eigen accu of offerte", form);
  }

  UI.page("accus", {
    nav: "Accu’s vergelijken", icon: "battery", title: "Accu’s vergelijken",
      subtitle: "Onderzochte uitvoeringen met bron, zonder automatische winnaar.",
    async render(view, actions) {
      const rerender = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
      actions.append(button("+ Eigen accu of offerte", () => openCandidateDialog(rerender), "secondary"));
      const cmp = await Data.catalog();
      if (!cmp.configurations.length) {
        view.append(UI.empty("Je catalogus is nog leeg", "Laad de onderzochte uitvoeringen (bronmomentopnamen van 24 oktober 2026) of voeg een eigen accu toe.",
          button("Laad onderzochte uitvoeringen", event => loadReferences(event.target))));
        return;
      }
      const list = h("div"), tray = h("div", { class: "tray" });
      const makers = [...new Set(cmp.configurations.map(c => c.manufacturer_name))];
      const search = input({ type: "search", value: filters.query,
        placeholder: "Bijvoorbeeld: Sessy, HomeWizard…",
        oninput: event => { filters.query = event.target.value; draw(); } });
      const maker = select([["", "Alle fabrikanten"], ...makers.map(m => [m, m])], filters.maker,
        { onchange: event => { filters.maker = event.target.value; draw(); } });
      const kind = select([["", "Alle typen"], ["battery_system", "Accusysteem"],
        ["battery_module", "Accumodule"]],
        filters.kind, { onchange: event => { filters.kind = event.target.value; draw(); } });
      view.append(h("div", { class: "toolbar" }, field("Zoek", search), field("Fabrikant", maker), field("Type", kind),
        h("details", { class: "menu" }, h("summary", {}, "Meer"), button("Laad onderzochte uitvoeringen", event => loadReferences(event.target), "secondary"))),
        Data.priceAge().stale ? h("p", { class: "callout", role: "note" }, Data.priceAge().text) : null,
        h("p", { class: "help" }, `Onderzochte uitvoeringen zijn bronmomentopnamen van ${Data.RESEARCHED_ON}. ` +
          "Kies maximaal vier om naast elkaar te zetten. Nieuwe onderzochte uitvoeringen haal je op via Meer."), list, tray);
      function drawTray() {
        tray.hidden = selected.size === 0;
        tray.replaceChildren(...cmp.configurations.filter(c => selected.has(c.id)).map(c => h("span", { class: "chip" }, `${c.product_name} · ${c.name}`,
          button("×", () => { selected.delete(c.id); remember(); draw(); }, "ghost", { "aria-label": `Verwijder ${c.product_name} ${c.name}` }))),
          link(`Vergelijk (${selected.size})`, "#/accus/vergelijk", "button"));
      }
      function draw() {
        const q = filters.query.toLocaleLowerCase();
        const configs = cmp.configurations.filter(c => `${c.manufacturer_name} ${c.product_name} ${c.name}`.toLocaleLowerCase().includes(q) && (!filters.maker || c.manufacturer_name === filters.maker) && (!filters.kind || c.product_kind === filters.kind));
        list.replaceChildren(configs.length ? table(["Vergelijk", "Accu", "Bruikbare energie", "Prijs", "Bronnen", "Status"], configs.map(c => {
          const box = h("input", { type: "checkbox", checked: selected.has(c.id), "aria-label": `Vergelijk ${c.manufacturer_name} ${c.product_name} ${c.name}`,
            onchange: event => {
              if (event.target.checked && selected.size >= 4) { event.target.checked = false;
                toast("Je kunt maximaal vier uitvoeringen tegelijk vergelijken.", true); return; }
              if (event.target.checked) selected.add(c.id); else selected.delete(c.id);
              remember(); drawTray();
            } });
          const claims = ["numbers", "features", "texts", "warranties", "offers"].flatMap(key => ofConfig(cmp[key], c));
          const usable = ofConfig(cmp.numbers, c).filter(v => v.metric_key === "usable_energy_wh"),
            nominal = ofConfig(cmp.numbers, c).find(v => v.metric_key === "nominal_energy_wh");
          const capacity = usable.length === 1 ? `${Data.qualifiers[usable[0].qualifier] || ""}${n(usable[0].value / 1000)} kWh · ${Data.boundaries[usable[0].boundary]}` : usable.length > 1 ? "Meerdere claims" : nominal ? `Onbekend (nominaal ${n(nominal.value / 1000)} kWh)` : "Onbekend";
          const offer = ofConfig(cmp.offers, c).sort((a, b) => b.observed_at_unix_s - a.observed_at_unix_s)[0];
          const reviewed = claims.length > 0 && claims.every(v => v.review_status === "reviewed");
          return [box, h("div", {}, h("strong", {}, `${c.manufacturer_name} ${c.product_name}`), h("small", {}, `${c.name} · ${c.product_kind === "battery_module" ? "accumodule" : "accusysteem"}`)),
            capacity, offer ? priceText(offer) : h("span", { class: "unknown" }, "Geen prijs"),
              String(new Set(claims.map(v => `${v.source_title}|${v.source_url}`)).size),
            badge(reviewed ? "Bronnen nagekeken" : "Bronnen niet nagekeken", reviewed ? "success" : "warning")];
        }), { caption: "Accucatalogus" }) : h("p", { class: "empty" }, "Geen uitvoeringen bij deze filters."));
        drawTray();
      }
      draw();
    }
  });

  UI.page("accus/vergelijk", {
    title: "Accu’s naast elkaar", subtitle: "Elke claim behoudt haar bron, vindplaats en meetgrens.", parent: "accus",
    async render(view, actions) {
      const cmp = await Data.catalog(), configs = cmp.configurations.filter(c => selected.has(c.id));
      if (!configs.length) { view.append(UI.empty("Nog niets gekozen",
        "Kies in de catalogus maximaal vier uitvoeringen.", link("Naar de catalogus", "#/accus", "button")));
        return; }
      const state = { differencesOnly: false, knownOnly: false },
        holder = h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Vergelijkingstabel" });
      const draw = () => holder.replaceChildren(comparisonTable(cmp, configs, state));
      const toggle = (text, key) => { const c = UI.checkbox(text);
        c.box.addEventListener("change", () => { state[key] = c.box.checked; draw(); }); return c.element; };
      actions.append(button("Exporteer CSV", () => exportComparison(holder.querySelector("table")), "secondary"));
      view.append(h("div", { class: "toolbar" }, toggle("Alleen verschillen", "differencesOnly"), toggle("Verberg rijen zonder bekende waarde", "knownOnly")),
        h("p", { class: "callout" },
          "Bruikbare energie, nominale energie en kVA zijn verschillende grootheden, en een rendement hoort bij een meetgrens. Open een bron voor de context; onbekend blijft onbekend."),
        holder, h("p", { class: "help" }, "Prijs per kWh is een kengetal, geen terugverdientijd. Een aanbeveling bestaat alleen binnen een doorgerekend scenario: gebruik daarvoor de keuzehulp."));
      draw();
    }
  });
})();
