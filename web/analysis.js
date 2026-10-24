(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const make = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined && text !== null) el.textContent = text; if (cls) el.className = cls; return el; };
  const number = (v, digits = 2) => UI.formatNumber(v, digits);
  const money = v => `€ ${number(v)}`;
  const names = { net_present_value: "Hoogste netto voordeel (NPV)", roi: "Hoogste ROI", payback: "Kortste blijvende terugverdientijd", self_consumption: "Meeste eigen zonnestroom gebruiken" };
  let costCatalog, catalog, savedRuns = [], sites = [], selectedSite = null, sequence = 0, fixedAnnual = 0;
  const candidateCards = new Map();
  function message(text, error = false) { UI.toast(text, error); }
  async function request(url, options) { const response = await fetch(url, options); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || body.error || `Verzoek mislukt (${response.status})`); return body; }
  const post = (url, payload) => request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  async function action(button, work) { button.disabled = true; try { await work(); } catch (e) { message(e.message, true); } finally { button.disabled = false; } }
  function numeric(id) { const value = Number(byId(id).value); if (!Number.isFinite(value)) throw new Error("Ongeldige numerieke invoer."); return value; }
  function minorUnits(raw) { const normalized = raw.trim().replace(",", "."); if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Kosten: gebruik eurobedragen met maximaal twee decimalen, zonder duizendtalscheiding."); const [whole, decimals = ""] = normalized.split("."); const minor = Number(whole + decimals.padEnd(2, "0")); if (!Number.isSafeInteger(minor)) throw new Error("Kostenbedrag is te groot."); return minor; }
  function field(parent, labelText, key, value = "", attrs = {}) { const label = make("label", labelText); const input = make("input"); input.dataset.field = key; Object.assign(input, { type: "number", step: "any", min: "0", value: String(value), ...attrs }); label.append(input); parent.append(label); return input; }
  function addCandidate(initial = {}) {
    if (candidateCards.size >= 12) { message("Je kunt maximaal twaalf rekenopties vergelijken.", true); return; }
    const key = initial.key || `option-${++sequence}`;
    const panel = make("article", null, "panel analysis-candidate"); panel.dataset.key = key;
    panel.dataset.configurationId = initial.configuration_id || "";
    const heading = make("div", null, "section-heading"), headingText = make("h3", initial.name || `Rekenoptie ${sequence}`), remove = make("button", "Verwijder optie", "text-button"); remove.type = "button";
    remove.addEventListener("click", () => { candidateCards.delete(key); panel.remove(); window.dispatchEvent(new Event("analysis:candidates")); }); heading.append(headingText, remove); panel.append(heading);
    const grid = make("div", null, "field-grid");
    const nameInput = field(grid, "Naam", "name", initial.name || `Eigen rekenoptie ${sequence}`, { type: "text", required: true, maxLength: 200 }); nameInput.addEventListener("input", () => headingText.textContent = nameInput.value);
    for (const [label, id, value, max] of [
      ["Bruikbare interne opslag (kWh)", "usable_capacity_kwh", initial.capacity, 1000], ["Continu laden AC (kW)", "charge_power_kw", initial.charge, 1000],
      ["Continu ontladen AC (kW)", "discharge_power_kw", initial.discharge, 1000], ["AC→AC round-trip-rendement (%)", "ac_round_trip_efficiency_pct", initial.efficiency, 100],
      ["Extra continu AC-standbyverbruik (W)", "standby_w", initial.standby, 10000], ["Capaciteitsverlies per jaar (%) — aanname", "annual_capacity_loss_pct", initial.degradation ?? 2, 20],
      ["Technische gebruiksduur (jaar) — aanname", "operating_life_years", initial.life ?? 15, 30]
    ]) field(grid, label, id, value ?? "", { required: true, max: String(max), min: id === "operating_life_years" ? "1" : ["standby_w", "annual_capacity_loss_pct"].includes(id) ? "0" : "0.01", step: id === "operating_life_years" ? "1" : "any" });
    panel.append(grid);
    const assumptionsLabel = make("label", "Technische bron en scenario-aannames"); const assumptions = make("textarea"); assumptions.dataset.field = "assumptions"; assumptions.required = true; assumptions.rows = 2; assumptions.value = initial.assumptions || "Eigen scenario: controleer bruikbare capaciteit, werkelijk AC-vermogen, systeemrendement, standby, kalenderdegradatie en technische levensduur; garantie is geen levensduurvoorspelling."; assumptionsLabel.append(assumptions); panel.append(assumptionsLabel);
    const details = make("details", null, "cost-details"); details.open = true;
    details.append(make("summary", "Kostenopbouw — euro, inclusief niet-teruggevraagde btw"));
    const controls = make("div", null, "actions");
    const included = make("button", "Markeer pakketonderdelen als inbegrepen", "secondary"); included.type = "button";
    const notApplicable = make("button", "Overige onbekende posten: niet van toepassing", "text-button"); notApplicable.type = "button";
    controls.append(included, notApplicable); details.append(controls, make("p", "Vul offertes of expliciete schattingen in. Bij een all-in pakket staat de prijs één keer bij accu/pakket; inbegrepen componenten mogen niet dubbel worden geteld. Beoordeel ook extra vaste netkosten, verzekering en fiscale administratie.", "muted"));
    const rows = make("div", null, "cost-rows");
    for (const category of costCatalog.categories) {
      const row = make("div", null, "cost-row"); row.dataset.category = category.key; row.dataset.timing = category.timing;
      const intro = make("div"); intro.append(make("strong", category.label), make("small", category.note));
      const amountLabel = make("label", category.timing === "annual" ? "€/jaar" : "€"), amount = make("input"); amount.dataset.cost = "amount"; amount.inputMode = "decimal"; amount.placeholder = "Nog onbekend"; amountLabel.append(amount);
      const statusLabel = make("label", "Status"), status = make("select"); status.dataset.cost = "status";
      for (const [value, label] of [["unknown", "Nog onbekend"], ["priced", "Bedrag ingevuld"], ["included", "Inbegrepen"], ["not_applicable", "Niet van toepassing"]]) { const option = make("option", label); option.value = value; status.append(option); } statusLabel.append(status);
      const sourceLabel = make("label", "Bron / aanname"), source = make("input"); source.dataset.cost = "source"; source.type = "text"; source.value = "Eigen offerte of expliciete aanname"; sourceLabel.append(source);
      row.append(intro, amountLabel, statusLabel);
      if (category.timing === "event") { const label = make("label", "Na jaar"), input = make("input"); input.type = "number"; input.min = "1"; input.max = "30"; input.step = "1"; input.dataset.cost = "year"; label.append(input); row.append(label); }
      row.append(sourceLabel); rows.append(row);
      amount.addEventListener("input", () => { status.value = amount.value.trim() ? "priced" : "unknown"; });
      status.addEventListener("change", () => { if (status.value !== "priced") amount.value = ""; });
      if (initial.demo) { status.value = "not_applicable"; source.value = "Fictieve demo-aanname: geen extra kosten"; }
    }
    included.addEventListener("click", () => { for (const row of rows.querySelectorAll(".cost-row")) { if (["inverter", "ems_metering", "installation", "cabling_protection", "delivery", "survey_permits"].includes(row.dataset.category) && row.querySelector('[data-cost="status"]').value === "unknown") { row.querySelector('[data-cost="status"]').value = "included"; row.querySelector('[data-cost="source"]').value = "Volgens gebruiker inbegrepen in pakket; controleer offerte"; } } });
    notApplicable.addEventListener("click", () => { for (const row of rows.querySelectorAll(".cost-row")) { if (row.querySelector('[data-cost="status"]').value === "unknown") { row.querySelector('[data-cost="status"]').value = "not_applicable"; row.querySelector('[data-cost="source"]').value = "Door gebruiker niet van toepassing verklaard"; } } });
    details.append(rows); panel.append(details);
    const finance = make("details"); finance.append(make("summary", "Optionele financiering — economische projectbasis"), make("p", "De aanschaf wordt één keer als investering geteld. Financiering voegt de rente op een annuïtaire lening toe; hoofdsom en aflossing worden niet nogmaals als kosten gerekend. Dit is geen kasstroom- of rendementberekening van je eigen vermogen. Looptijd binnen de analysehorizon.", "muted"));
    const financeGrid = make("div", null, "field-grid"); field(financeGrid, "Leningbedrag (€)", "loan_amount_eur", 0); field(financeGrid, "Rente per jaar (%)", "annual_interest_pct", 0, { max: "30" }); field(financeGrid, "Looptijd lening (jaren)", "loan_years", 0, { step: "1", max: "30" }); finance.append(financeGrid); panel.append(finance);
    byId("analysis-candidates").append(panel); candidateCards.set(key, panel);
    if (initial.demo) {
      setCost(panel, "battery", initial.price, "Fictief demopakket; geen marktprijs");
      setCost(panel, "maintenance", 50, "Fictieve onderhoudsaanname per jaar");
      for (const category of ["inverter", "ems_metering", "installation", "cabling_protection", "delivery"]) panel.querySelector(`[data-category="${category}"] [data-cost="status"]`).value = "included";
      setCost(panel, "inverter_replacement", 800, "Fictieve vervanging, geen garantieclaim", 8);
    }
    window.dispatchEvent(new Event("analysis:candidates"));
    return panel;
  }
  function setCost(panel, category, euros, source, year = null) { const row = panel.querySelector(`[data-category="${category}"]`); row.querySelector('[data-cost="amount"]').value = String(euros); row.querySelector('[data-cost="status"]').value = "priced"; row.querySelector('[data-cost="source"]').value = source; if (year !== null) row.querySelector('[data-cost="year"]').value = String(year); }
  function collectCandidate(key, card) {
    const get = name => card.querySelector(`[data-field="${name}"]`).value;
    const battery = {}; for (const name of ["usable_capacity_kwh", "charge_power_kw", "discharge_power_kw", "ac_round_trip_efficiency_pct", "standby_w", "annual_capacity_loss_pct", "operating_life_years"]) { if (get(name) === "") throw new Error("Vul alle technische rekenwaarden in; ontbrekende productspecificaties worden niet geraden."); battery[name] = Number(get(name)); }
    const costs = [...card.querySelectorAll(".cost-row")].map(row => {
      const status = row.querySelector('[data-cost="status"]').value, raw = row.querySelector('[data-cost="amount"]').value.trim();
      if (status === "unknown") throw new Error(`Beoordeel kostenpost ‘${row.querySelector("strong").textContent}’ bij ${get("name")}.`);
      if (status === "priced" && raw === "") throw new Error("Vul het bedrag van een geprijsde kostenpost in.");
      const year = row.querySelector('[data-cost="year"]');
      if (status === "priced" && year && !year.value) throw new Error("Vul het jaar van vervanging, verwijdering of restwaarde in.");
      return { category: row.dataset.category, status, amount_minor: status === "priced" ? minorUnits(raw) : 0, timing: row.dataset.timing, year: status === "priced" && year ? Number(year.value) : null, source: row.querySelector('[data-cost="source"]').value.trim(), notes: row.dataset.notes ?? "Invoer in de scenario-editor" };
    });
    return { key, name: get("name"), configuration_id: card.dataset.configurationId ? Number(card.dataset.configurationId) : null, battery, costs, financing: { loan_amount_eur: Number(get("loan_amount_eur")), annual_interest_pct: Number(get("annual_interest_pct")), years: Number(get("loan_years")) }, assumptions: get("assumptions") };
  }
  function bands() { const text = byId("export-fee-bands").value.trim(); if (!text) return []; return text.split(/\r?\n/).map(line => { const pieces = line.split(";"); if (pieces.length !== 2) throw new Error("Gebruik per staffel: bovengrens;jaarkosten, met een lege laatste bovengrens."); const up_to_kwh = pieces[0].trim() ? Number(pieces[0].trim().replace(",", ".")) : null; const annual_eur = Number(pieces[1].trim().replace(",", ".")); if ((up_to_kwh !== null && !Number.isFinite(up_to_kwh)) || !Number.isFinite(annual_eur)) throw new Error("Ongeldige staffelbedragen."); return { up_to_kwh, annual_eur }; }); }
  function parameters() { return { start_year: numeric("analysis-start"), horizon_years: numeric("analysis-years"), discount_pct: numeric("analysis-discount"), annual_cost_escalation_pct: numeric("cost-escalation"), annual_pv_loss_pct: numeric("pv-degradation"), annual_load_growth_pct: numeric("load-growth"), objective: byId("analysis-objective").value, budget_eur: byId("analysis-budget").value ? numeric("analysis-budget") : null, price_uncertainty_pct: numeric("price-uncertainty"), cost_uncertainty_pct: numeric("cost-uncertainty"), tariff: { import_eur_per_kwh: numeric("tariff-import"), export_eur_per_kwh: numeric("tariff-export"), export_fee_eur_per_kwh: numeric("tariff-export-fee"), export_fee_bands: bands(), fixed_annual_eur: fixedAnnual, annual_price_change_pct: numeric("tariff-escalation") } }; }
  async function refreshData() {
    const [profiles, comparison, history] = await Promise.all([request("/api/v1/solar/imports"), request("/api/v1/comparison"), request("/api/v1/analysis/runs")]); catalog = comparison; savedRuns = history.runs;
    const selected = byId("analysis-profile").value; byId("analysis-profile").replaceChildren(); const empty = make("option", "Kies een overzicht met bruto verbruik…"); empty.value = ""; byId("analysis-profile").append(empty);
    for (const item of [...profiles.imports].sort((a, b) => Number(UI.suitability(b).ok === true) - Number(UI.suitability(a).ok === true))) {
      const fit = UI.suitability(item), option = make("option", `${item.options.is_demo ? "FICTIEF · " : ""}${item.filename} · ${fit.reason}`);
      option.value = String(item.id); option.disabled = fit.ok === false; byId("analysis-profile").append(option);
    }
    if ([...byId("analysis-profile").options].some(o => o.value === selected)) byId("analysis-profile").value = selected;
    byId("analysis-catalog").replaceChildren(); const choose = make("option", "Kies catalogusuitvoering…"); choose.value = ""; byId("analysis-catalog").append(choose);
    for (const c of catalog.configurations) { const option = make("option", `${c.manufacturer_name} · ${c.product_name} · ${c.name}`); option.value = String(c.id); byId("analysis-catalog").append(option); }
    byId("analysis-history").replaceChildren(); const pick = make("option", "Kies een bewaarde analyse…"); pick.value = ""; byId("analysis-history").append(pick);
    for (const run of savedRuns) { const option = make("option", `${run.title} · ${new Date(run.created_at_unix_s * 1000).toLocaleString("nl-NL")}`); option.value = String(run.id); byId("analysis-history").append(option); }
  }
  byId("analysis-add").addEventListener("click", () => costCatalog && addCandidate());
  byId("analysis-add-catalog").addEventListener("click", () => {
    const c = catalog?.configurations.find(c => String(c.id) === byId("analysis-catalog").value); if (!c) return message("Kies eerst een catalogusuitvoering.", true);
    const unique = (metric, boundary) => { const found = catalog.numbers.filter(n => n.configuration_id === c.id && n.metric_key === metric && n.qualifier === "exact" && (!boundary || n.boundary === boundary) && n.review_status !== "superseded" && n.review_status !== "disputed"); return found.length === 1 ? found[0].value : undefined; };
    const kilo = (metric, boundary) => { const value = unique(metric, boundary); return value === undefined ? undefined : value / 1000; };
    addCandidate({ configuration_id: c.id, name: `${c.manufacturer_name} ${c.name}`, capacity: kilo("usable_energy_wh", "battery_dc"), charge: kilo("continuous_charge_power_w", "system_ac"), discharge: kilo("continuous_discharge_power_w", "system_ac"), efficiency: unique("round_trip_efficiency_pct", "ac_ac"), standby: unique("standby_power_w", "system_ac"), assumptions: "Gekoppeld aan catalogusuitvoering; alleen eenduidige nominale claims met passende meetgrenzen overgenomen. Vul ontbrekende waarden en offertegegevens in. Degradatie en levensduur zijn scenario-aannames." });
  });
  byId("refresh-analysis-data").addEventListener("click", () => action(byId("refresh-analysis-data"), refreshData));
  byId("analysis-demo").addEventListener("click", () => action(byId("analysis-demo"), async () => {
    byId("analysis-form").reset(); candidateCards.clear(); byId("analysis-candidates").replaceChildren(); fixedAnnual = 0;
    const result = await post("/api/v1/analysis/demo", {}); await refreshData(); byId("analysis-profile").value = String(result.id);
    byId("analysis-name").value = "FICTIEVE demonstratie — geen adresadvies"; byId("analysis-address").value = "Fictieve demolocatie, Nederland"; selectedSite = null;
    byId("tariff-import").value = "0.30"; byId("tariff-export").value = "0.08";
    if (!candidateCards.size) { addCandidate({ name: "FICTIEVE accu 5 kWh", capacity: 5, charge: 2.5, discharge: 2.5, efficiency: 90, standby: 3, price: 4500, demo: true, assumptions: "Volledig fictief softwarevoorbeeld. Geen fabrikantclaim of offerte voor dit adres." }); addCandidate({ name: "FICTIEVE accu 10 kWh", capacity: 10, charge: 4, discharge: 4, efficiency: 90, standby: 5, price: 6500, demo: true, assumptions: "Volledig fictief softwarevoorbeeld. Geen fabrikantclaim of offerte voor dit adres." }); }
    window.dispatchEvent(new Event("analysis:loaded")); UI.write("thuisaccu-draft", capture());
    message("Fictief demojaar en voorbeeldopties geladen. Tarieven en kosten zijn demonstratie-aannames; controleer de drie verklaringen voordat je rekent.");
  }));
  byId("analysis-address").addEventListener("input", () => { selectedSite = null; });
  byId("lookup-address").addEventListener("click", () => action(byId("lookup-address"), async () => {
    const result = await post("/api/v1/locations/search", { query: byId("analysis-address").value }); sites = result.results; byId("address-results").replaceChildren(); const empty = make("option", "Kies het juiste adres…"); empty.value = ""; byId("address-results").append(empty);
    sites.forEach((s, index) => { const option = make("option", s.address); option.value = String(index); byId("address-results").append(option); }); byId("address-results-label").hidden = !sites.length; message(sites.length ? "Kies het juiste adres uit de PDOK-resultaten." : "Geen adres gevonden. Pas de zoekterm aan of gebruik het adres handmatig.");
  }));
  byId("address-results").addEventListener("change", () => { const site = sites[Number(byId("address-results").value)]; if (byId("address-results").value !== "" && site) { selectedSite = site; byId("analysis-address").value = site.address; } });
  byId("analysis-form").addEventListener("submit", event => { event.preventDefault(); action(byId("analysis-run"), async () => {
    const input = { title: byId("analysis-name").value, solar_import_id: Number(byId("analysis-profile").value), site: selectedSite || { address: byId("analysis-address").value, latitude: null, longitude: null, bag_id: null }, parameters: parameters(), candidates: [...candidateCards].map(([key,card]) => collectCandidate(key,card)), costs_confirmed: byId("confirm-costs").checked, technical_assumptions_confirmed: byId("confirm-technical").checked, consumption_is_gross: byId("confirm-gross").checked, production_is_ac: byId("confirm-gross").checked };
    const response = await post("/api/v1/analysis/runs", input); UI.write("thuisaccu-draft", null); await refreshData(); location.hash = `/scenarios/${response.id}`; byId("analysis-history").value = String(response.id); message("Scenario doorgerekend en met invoer en modelversie in SQLite bewaard.");
  }); });
  byId("analysis-history").addEventListener("change", () => { const run = savedRuns.find(r => String(r.id) === byId("analysis-history").value); if (run) location.hash = `/scenarios/${run.id}`; });
  const parameterFields = { start_year: "analysis-start", horizon_years: "analysis-years", discount_pct: "analysis-discount", annual_cost_escalation_pct: "cost-escalation", annual_pv_loss_pct: "pv-degradation", annual_load_growth_pct: "load-growth", objective: "analysis-objective", budget_eur: "analysis-budget", price_uncertainty_pct: "price-uncertainty", cost_uncertainty_pct: "cost-uncertainty" };
  const tariffFields = { import_eur_per_kwh: "tariff-import", export_eur_per_kwh: "tariff-export", export_fee_eur_per_kwh: "tariff-export-fee", annual_price_change_pct: "tariff-escalation" };
  function capture() {
    const fields = {}; byId("analysis-form").querySelectorAll("[id]").forEach(f => { if (f.matches("input,select,textarea") && !f.closest(".analysis-candidate")) fields[f.id] = f.type === "checkbox" ? false : f.value; });
    return { version: 1, fields, site: selectedSite, fixedAnnual, candidates: [...candidateCards].map(([key, card]) => ({ key, configuration_id: card.dataset.configurationId, fields: Object.fromEntries([...card.querySelectorAll("[data-field]")].map(f => [f.dataset.field, f.value])), costs: [...card.querySelectorAll(".cost-row")].map(row => ({ category: row.dataset.category, notes: row.dataset.notes, fields: Object.fromEntries([...row.querySelectorAll("[data-cost]")].map(f => [f.dataset.cost, f.value])) })) })) };
  }
  function restore(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.candidates)) return;
    candidateCards.clear(); byId("analysis-candidates").replaceChildren(); sequence = 0;
    for (const [id, value] of Object.entries(raw.fields || {})) { const field = byId(id); if (field?.matches("input,select,textarea")) { if (field.type === "checkbox") field.checked = false; else field.value = value; } }
    selectedSite = raw.site || null; fixedAnnual = raw.fixedAnnual ?? 0;
    for (const saved of raw.candidates) { const card = addCandidate({ configuration_id: saved.configuration_id }); for (const [key, value] of Object.entries(saved.fields)) { const field = card.querySelector(`[data-field="${key}"]`); if (field) field.value = value; } for (const cost of saved.costs) { const row = [...card.querySelectorAll(".cost-row")].find(row => row.dataset.category === cost.category); if (row) { if (cost.notes !== undefined) row.dataset.notes = cost.notes; for (const [key, value] of Object.entries(cost.fields)) { const field = row.querySelector(`[data-cost="${key}"]`); if (field) field.value = value; } } } card.querySelector("h3").textContent = saved.fields.name; }
    window.dispatchEvent(new Event("analysis:loaded"));
  }
  async function load(input) {
    await Analysis.ready; await refreshData();
    const raw = { version: 1, fields: { "analysis-name": `${input.title} (kopie)`, "analysis-address": input.site.address, "analysis-profile": String(input.solar_import_id), "export-fee-bands": input.parameters.tariff.export_fee_bands.map(b => `${b.up_to_kwh ?? ""};${b.annual_eur}`).join("\n") }, site: input.site, fixedAnnual: input.parameters.tariff.fixed_annual_eur, candidates: [] };
    for (const [key, id] of Object.entries(parameterFields)) raw.fields[id] = input.parameters[key] ?? "";
    for (const [key, id] of Object.entries(tariffFields)) raw.fields[id] = input.parameters.tariff[key];
    raw.candidates = input.candidates.map(c => ({ configuration_id: c.configuration_id, fields: { name: c.name, ...c.battery, assumptions: c.assumptions, loan_amount_eur: c.financing.loan_amount_eur, annual_interest_pct: c.financing.annual_interest_pct, loan_years: c.financing.years }, costs: c.costs.map(cost => ({ category: cost.category, notes: cost.notes, fields: { amount: cost.status === "priced" ? (cost.amount_minor / 100).toFixed(2) : "", status: cost.status, source: cost.source, year: cost.year ?? "" } })) }));
    restore(raw); UI.write("thuisaccu-draft", capture());
  }
  window.Analysis = { refreshData, addCandidate, capture, restore, load, parameterFields, tariffFields, parameters, collectCandidate, get candidateCards() { return candidateCards; }, get costCatalog() { return costCatalog; }, get savedRuns() { return savedRuns; } };
  Analysis.ready = (async () => {
    costCatalog = await request("/api/v1/analysis/costs"); const sources = byId("analysis-cost-sources"); sources.append(make("p", `Onderzocht op ${costCatalog.researched_on}. ${costCatalog.notes}`));
    for (const source of costCatalog.sources) { const p = make("p"), link = make("a", source.title); link.href = source.url; link.target = "_blank"; link.rel = "noopener noreferrer"; p.append(link, make("small", source.note)); sources.append(p); }
    await refreshData();
  })().catch(error => message(error.message, true));
})();
