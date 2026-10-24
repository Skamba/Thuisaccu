"use strict";

// Schermen en werkstromen boven op de bestaande, expliciete API-invoer.
window.Workspace = (() => {
  const { $, el, button, link, badge, api, table, formatNumber: n, formatMoney: money, formatKwh: kwh, date, suitability } = UI;
  const objectives = { net_present_value: "Netto voordeel (NPV)", roi: "ROI", payback: "Terugverdientijd", self_consumption: "Eigen gebruik" };
  let data = { configurations: [], imports: [], runs: [] };
  const screen = key => UI.screens.get(key);
  const actionBar = (...items) => { const a = el("div", null, "actions"); a.append(...items); return a; };
  const profileName = item => { const name = el("span", item.filename); if (item.options?.is_demo) name.append(" ", badge("FICTIEF", "demo")); return name; };
  const recommended = run => run.result.candidates.find(c => c.key === run.result.recommended_key);
  const period = item => `${new Date(item.summary.from_unix_s * 1000).toLocaleDateString("nl-NL")} – ${new Date(item.summary.to_unix_s * 1000).toLocaleDateString("nl-NL")}`;
  const resolution = item => ({ "5min": "5 min", "10min": "10 min", "15min": "15 min", "30min": "30 min", hour: "1 uur", day: "Dag", week: "Week", month: "Maand", year: "Jaar" })[item.options.period] || (item.options.is_demo ? "1 uur" : "Onbekend");
  const empty = (title, text, ...actions) => { const box = el("div", null, "empty"); box.append(el("h2", title), el("p", text, "muted"), actionBar(...actions)); return box; };
  const kpi = (label, value, extra) => { const card = el("div", null, "panel kpi"); card.append(el("small", label), el("strong", value)); if (extra) card.append(el("small", extra)); return card; };
  function runRows(runs, compact = false) {
    return runs.map(run => {
      const request = run.input.request, r = recommended(run), title = el("div"); title.append(link(run.title, `#/scenarios/${run.id}`));
      if (run.input.profile?.options?.is_demo) title.append(" ", badge("FICTIEF", "demo"));
      const actions = actionBar(link("Open", `#/scenarios/${run.id}`), button("Dupliceer", () => duplicate(run), "text-button"));
      return compact ? [title, objectives[request.parameters.objective], r?.name || (run.result.recommended_key === "no_battery" ? "Geen accu" : "Onbekend"), money(r ? r.npv_eur : run.result.recommended_key === "no_battery" ? 0 : null), date(run.created_at_unix_s)] : [title, request.site.address, run.input.profile?.filename || `Profiel ${request.solar_import_id}`, objectives[request.parameters.objective], UI.formatYears(request.parameters.horizon_years), r?.name || (run.result.recommended_key === "no_battery" ? "Geen accu" : "Onbekend"), money(r ? r.npv_eur : run.result.recommended_key === "no_battery" ? 0 : null), date(run.created_at_unix_s), actions];
    });
  }
  function importRows(imports, compact = false) {
    return imports.map(item => { const s = item.summary, fit = suitability(item), title = link("", `#/opwek/${item.id}`); title.append(profileName(item));
      return compact ? [title, period(item), kwh(s.production_kwh), resolution(item), s.consumption_kwh == null ? "Geen verbruik" : "Met verbruik"] : [title, period(item), n(s.rows, 0), resolution(item), kwh(s.production_kwh), s.consumption_kwh == null ? "Nee" : "Ja", badge(fit.reason, fit.ok ? "success" : fit.ok === false ? "warning" : "")];
    });
  }
  function dashboard() {
    const out = screen("dashboard"); out.replaceChildren();
    $("page-actions").append(link("+ Nieuw scenario", "#/scenarios/nieuw", "button"));
    const hero = el("div", null, "panel next-step hero-start"), heroText = el("div"); heroText.append(el("p", "NIEUW HIER?", "eyebrow"), el("h2", "Welke thuisaccu past bij jou?"), el("p", "De keuzehulp stelt vijf vragen in gewone taal en rekent passende accu’s door, met ‘geen accu’ als volwaardige uitkomst."));
    hero.append(heroText, link("Start de keuzehulp", "#/keuzehulp", "button")); out.append(hero);
    const last = data.runs[0], rec = last && recommended(last), tiles = el("div", null, "kpis"); tiles.append(kpi("Accu-uitvoeringen", n(data.configurations.length, 0)), kpi("Opwekimports", n(data.imports.length, 0), `${data.imports.filter(i => suitability(i).ok === true).length} geschikt voor ROI`), kpi("Bewaarde analyses", n(data.runs.length, 0), data.runs.length === 100 ? "API toont de laatste 100" : "Oorspronkelijke invoer bewaard"), kpi("Laatste aanbeveling", last ? rec?.name || (last.result.recommended_key === "no_battery" ? "Geen accu" : "Onbekend") : "Nog geen analyse", last ? date(last.created_at_unix_s) : "Begin met een energieprofiel")); out.append(tiles);
    const next = el("div", null, "panel next-step"); next.append(el("p", "JE VOLGENDE STAP", "eyebrow"));
    if (!data.configurations.length) next.append(el("h2", "Begin je onderzoek"), el("p", "Laad onderzochte uitvoeringen of leg een eigen offerte vast."), actionBar(button("Laad onderzochte uitvoeringen", () => $("references").click(), ""), button("+ Eigen accu", () => Research.openCandidate())));
    if (!data.imports.some(i => suitability(i).ok === true)) next.append(el("h2", "Breng opwek en verbruik samen"), el("p", "Voor ROI heb je één volledig aaneengesloten jaar nodig."), actionBar(link("Importeer opwek + verbruik", "#/opwek/import", "button")));
    else next.append(el("h2", data.runs.length ? "Vergelijk een nieuwe aanname" : "Je profiel is klaar voor een scenario"), actionBar(link("Start scenario", "#/scenarios/nieuw", "button")));
    out.append(next, el("h2", "Recente analyses"));
    out.append(data.runs.length ? table(["Scenario", "Doel", "Aanbevolen optie", "NPV", "Datum"], runRows(data.runs.slice(0, 5), true)) : empty("Nog geen analyses", "Een berekende vergelijking wordt hier bewaard.", link("Nieuw scenario", "#/scenarios/nieuw", "button secondary")));
    out.append(el("h2", "Recente imports")); out.append(data.imports.length ? table(["Profiel", "Periode", "Opwek", "Resolutie", "Verbruik"], importRows(data.imports.slice(0, 5), true)) : empty("Je energieprofielen komen hier", "Importeer je opwek en verbruik om je energieprofiel te bekijken.", link("Importeer bestand", "#/opwek/import", "button secondary")));
  }
  function lists(key) {
    if (key === "opwek") { const out = screen(key); out.replaceChildren(); $("page-actions").append(link("+ Importeer bestand", "#/opwek/import", "button")); out.append(data.imports.length ? table(["Bestand", "Periode", "Intervallen", "Resolutie", "Opwek", "Verbruik", "ROI-geschiktheid"], importRows(data.imports)) : empty("Nog geen energieprofielen", "Controleer je bestand stap voor stap voordat je het bewaart.", link("Importeer bestand", "#/opwek/import", "button"))); }
    if (key === "scenarios") { const out = screen(key); out.replaceChildren(); $("page-actions").append(link("+ Nieuw scenario", "#/scenarios/nieuw", "button")); out.append(data.runs.length ? table(["Scenario", "Adres", "Profiel", "Doel", "Horizon", "Aanbevolen", "NPV", "Datum", "Acties"], runRows(data.runs)) : empty("Nog geen bewaarde analyses", "Vergelijk accu-opties met geen accu, met expliciete aannames.", link("Nieuw scenario", "#/scenarios/nieuw", "button"))); }
  }
  async function refresh() {
    const [comparison, profiles, runs] = await Promise.all([api("/api/v1/comparison"), api("/api/v1/solar/imports"), api("/api/v1/analysis/runs")]);
    data = { ...comparison, imports: profiles.imports, runs: runs.runs }; if (runs.runs[0]) $("service").lastChild.textContent = `Model ${runs.runs[0].result.model_version}`; window.dispatchEvent(new Event("app:refreshed")); return data;
  }
  async function duplicate(run) {
    if (window.Analysis?.load) { await Analysis.load(run.input.request); location.hash = "/scenarios/nieuw"; UI.toast("Kopie geladen als nieuw scenario. Controleer en bevestig de invoer opnieuw."); }
    else UI.toast("Dupliceren wordt voorbereid.");
  }
  function researchScreens() {
    for (const id of ["differences-only", "known-only"]) $(id).addEventListener("change", () => Research.renderComparison());
    for (const id of ["kind-filter", "maker-filter"]) $(id).addEventListener("change", () => Research.renderCatalog());
    const updateMakers = () => { const select = $("maker-filter"), selected = select.value; select.replaceChildren(); for (const name of ["", ...new Set(Research.dataset?.configurations.map(c => c.manufacturer_name))]) { const option = el("option", name || "Alle fabrikanten"); option.value = name; select.append(option); } select.value = selected; };
    Research.ready.then(() => { updateMakers(); Research.renderCatalog(); Research.renderComparison(); }); window.addEventListener("app:data", updateMakers);
    const form = $("candidate-form"), steps = [...form.querySelectorAll(":scope > fieldset")].map((panel, i) => ({ label: ["Uitvoering & bron", "Technische gegevens", "Prijsaanbieding"][i], panel }));
    const wizard = UI.wizard(form, steps);
    form.addEventListener("submit", event => { if (wizard.current < steps.length - 1) { event.preventDefault(); event.stopImmediatePropagation(); wizard.next.click(); return; } for (let i = 0; i < steps.length; i++) { const invalid = [...steps[i].panel.querySelectorAll("input,select,textarea")].find(f => !f.checkValidity()); if (invalid) { event.preventDefault(); event.stopImmediatePropagation(); wizard.show(i); UI.validate(steps[i].panel); return; } } }, true);
    window.addEventListener("candidate:open", () => wizard.show(0));
    form.addEventListener("input", event => { if (event.target.matches("input,select,textarea")) UI.invalid(event.target, ""); });
  }
  function importWizard() {
    const form = $("solar-form"), mapping = $("mapping"), panels = [...form.querySelectorAll(":scope > .wizard-step")];
    const preview = $("preview-file"), save = $("save-file"), filename = $("import-filename");
    let inspectedFingerprint;
    const fingerprint = () => JSON.stringify([$("solar-file").files[0]?.name, $("solar-file").files[0]?.size, $("solar-file").files[0]?.lastModified, ...["import-profile", "header-row", "delimiter", "sheet"].map(id => $(id).value)]);
    const wizard = UI.wizard(form, panels.map((panel, i) => ({ label: ["Bestand", "Kolommen & eenheden", "Controle", "Bewaren"][i], panel })), { validateStep: (panel, index) => {
      if (index === 0) { if (inspectedFingerprint === fingerprint() && !mapping.hidden) return true; $("inspect-file").click(); return false; }
      if (index === 1) { preview.click(); return false; }
      return UI.validate(panel);
    } });
    window.addEventListener("solar:inspected", () => { inspectedFingerprint = fingerprint(); wizard.show(1); markColumns(); }); window.addEventListener("solar:previewed", () => wizard.show(2));
    $("solar-file").addEventListener("change", () => { filename.value = $("solar-file").files[0]?.name || ""; });
    filename.addEventListener("change", () => { const original = $("solar-file").files[0]; if (!original || !filename.value.trim()) return; const transfer = new DataTransfer(); transfer.items.add(new File([original], filename.value.trim(), { type: original.type, lastModified: original.lastModified })); $("solar-file").files = transfer.files; Research.acceptFilename?.(); });
    const drop = $("solar-file").closest("label"); drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover"); }); drop.addEventListener("dragleave", () => drop.classList.remove("dragover")); drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("dragover"); if (e.dataTransfer.files.length) { $("solar-file").files = e.dataTransfer.files; $("solar-file").dispatchEvent(new Event("change", { bubbles: true })); wizard.show(0); } });
    function markColumns() { const chosen = ["time-column", "time-part-column", "production-column", "consumption-column", "export-column"].map(id => $(id).value).filter(v => v !== "").map(Number); $("file-preview").querySelectorAll("tr").forEach(row => [...row.children].forEach((cell, i) => cell.classList.toggle("mapped-column", chosen.includes(i)))); }
    panels[1].addEventListener("change", markColumns);
    form.addEventListener("change", event => { if (event.target !== filename && !panels[0].contains(event.target) && event.target !== $("solar-file")) return; if (event.target !== filename) wizard.show(0); });
    form.noValidate = true;
    form.addEventListener("submit", event => { if (wizard.current !== 1 || !UI.validate(panels[1])) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    save.addEventListener("click", event => { if (!UI.validate(panels[3])) { event.stopImmediatePropagation(); } }, true);
  }
  let scenarioFlow;
  async function startNew(profileId) {
    await Analysis.ready; await Analysis.refreshData();
    $("analysis-form").reset(); Analysis.restore({ version: 1, fields: {}, candidates: [], site: null, fixedAnnual: 0 });
    window.Settings?.applyDefaults();
    if (profileId != null) $("analysis-profile").value = String(profileId);
    UI.write("thuisaccu-draft", Analysis.capture()); window.dispatchEvent(new Event("analysis:loaded")); location.hash = "/scenarios/nieuw";
  }
  function settingsScreen() {
    const out = screen("instellingen"), form = el("form", null, "panel"), grid = el("div", null, "field-grid"), defaults = {};
    const ids = [...Object.values(Analysis.parameterFields), ...Object.values(Analysis.tariffFields)].filter(id => !["analysis-budget", "analysis-objective"].includes(id));
    const stored = UI.read("thuisaccu-defaults", {});
    for (const id of ids) {
      const original = $(id); defaults[id] = original.defaultValue;
      const label = el("label", original.closest("label").firstChild.textContent), field = original.cloneNode(false); field.id = `setting-${id}`; field.value = typeof stored[id] === "string" ? stored[id] : defaults[id]; if (!field.checkValidity()) field.value = defaults[id]; label.append(field); grid.append(label);
    }
    const applyDefaults = () => { const values = UI.read("thuisaccu-defaults", {}); for (const id of ids) { $(id).value = typeof values[id] === "string" ? values[id] : defaults[id]; if (!$(id).checkValidity()) $(id).value = defaults[id]; } };
    form.append(el("h2", "Standaardaannames voor nieuwe scenario’s"), el("p", "Dit wordt alleen in deze browser bewaard. Elke analyse legt haar eigen invoer vast; bewaarde analyses veranderen nooit door deze instellingen.", "muted"), grid);
    const save = el("button", "Bewaar standaardaannames"); save.type = "submit"; form.append(save);
    form.addEventListener("submit", event => { event.preventDefault(); if (!UI.validate(form)) return; const values = Object.fromEntries(ids.map(id => [id, $(`setting-${id}`).value])); if (UI.write("thuisaccu-defaults", values)) UI.toast("Standaardaannames bewaard voor nieuwe scenario’s."); else UI.toast("Bewaren in deze browser is niet beschikbaar.", true); });
    out.append(form);
    const appearance = el("div", null, "panel settings-panel"); appearance.append(el("h2", "Weergave"));
    for (const [key, labelText, options] of [["theme", "Thema", [["system", "Systeem"], ["light", "Licht"], ["dark", "Donker"]]], ["density", "Dichtheid", [["comfortable", "Ruim"], ["compact", "Compact"]]]]) {
      const label = el("label", labelText), select = el("select"); select.id = `setting-${key}`; options.forEach(([value, text]) => { const option = el("option", text); option.value = value; select.append(option); });
      const value = UI.read(`thuisaccu-${key}`, options[0][0]); select.value = options.some(([v]) => v === value) ? value : options[0][0]; document.documentElement.dataset[key] = select.value;
      select.addEventListener("change", () => { document.documentElement.dataset[key] = select.value; if (!UI.write(`thuisaccu-${key}`, select.value)) UI.toast("Deze voorkeur kan niet worden bewaard.", true); }); label.append(select); appearance.append(label);
    }
    const privacy = el("div", null, "panel settings-panel"); privacy.append(el("h2", "Gegevens & privacy"), el("p", "Alles wat je bewaart, staat in een databasebestand op deze computer (standaard data/research.sqlite3). Wil je een back-up, stop dan de app en kopieer dat bestand."), el("p", "Er gaat niets naar internet, behalve een adres dat je zelf opzoekt met ‘Zoek adres via PDOK’. Concepten van de keuzehulp en de scenariotool staan alleen in deze browser en kunnen je adres bevatten."), actionBar(link("Servicestatus", "/api/v1/health")));
    const model = el("div", null, "panel settings-panel"); model.append(el("h2", "Over het model"), el("p", "De rekenkern bewaart eigen zonnestroom voor later huishoudelijk gebruik, met vaste all-in contracttarieven. Dynamische handel, netladen en onbalansinkomsten zijn niet opgenomen."), el("p", "Vanaf 2027 wordt zonder salderen gerekend. Voor 2026 gebruikt het model vereenvoudigde jaarlijkse saldering. Gebruik één volledig aaneengesloten jaar met AC-zonneproductie en bruto huishoudelijk verbruik op uur- of fijnere basis."), el("p", "Een aanbeveling geldt alleen voor de doorgerekende opties en vastgelegde aannames. Geen accu is een volwaardige uitkomst. De tool beoordeelt geen installatiegeschiktheid of elektrische veiligheid."));
    out.append(appearance, privacy, model); window.Settings = { applyDefaults };
    Analysis.ready.then(() => { if (!UI.read("thuisaccu-draft", null)) applyDefaults(); });
    document.addEventListener("click", event => { const a = event.target.closest('a[href="#/scenarios/nieuw"]'); if (a) { event.preventDefault(); startNew().catch(error => UI.toast(error.message, true)); } });
  }
  function scenarioWizard() {
    const form = $("analysis-form"), panels = [...form.querySelectorAll(":scope > .wizard-step")];
    const confirmations = $("scenario-confirmations"), review = $("scenario-review"), summary = $("scenario-summary"), sources = $("sources-dialog");
    $("open-sources").addEventListener("click", () => sources.showModal()); $("close-sources").addEventListener("click", () => sources.close());
    const fieldStep = field => panels.findIndex(panel => panel.contains(field));
    const reveal = field => {
      const step = fieldStep(field); if (step >= 0) scenarioFlow.show(step);
      const card = field.closest(".analysis-candidate"); if (card) { const index = [...Analysis.candidateCards.values()].indexOf(card); optionsTabs?.activate(index); card._tabs?.activate(field.closest(".cost-details") ? 1 : 0); card.querySelectorAll(".cost-filter").forEach(check => check.checked = false); card.querySelectorAll(".cost-row").forEach(row => row.hidden = false); }
      let parent = field.parentElement; while (parent && parent !== form) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
      UI.invalid(field, field.validationMessage || "Beoordeel deze invoer."); field.focus(); field.scrollIntoView({ block: "center" });
    };
    function problems(includeConfirmations = true) {
      const result = [...form.querySelectorAll("input,select,textarea")].filter(f => !f.checkValidity() && (includeConfirmations || !confirmations.contains(f))).map(field => ({ field, message: `${field.closest("label")?.firstChild?.textContent?.trim() || "Invoer"}: ${field.validationMessage}` }));
      if ($("analysis-profile").selectedOptions[0]?.disabled) result.push({ field: $("analysis-profile"), message: "Het gekozen profiel is niet geschikt voor ROI. Kies een volledig jaar met bruto verbruik en uur- of fijnere waarden." });
      for (const [key, card] of Analysis.candidateCards) {
        for (const row of card.querySelectorAll(".cost-row")) { const status = row.querySelector('[data-cost="status"]'), amount = row.querySelector('[data-cost="amount"]'), year = row.querySelector('[data-cost="year"]'); if (status.value === "unknown") result.push({ field: status, message: `${card.querySelector('[data-field="name"]').value}: ${row.querySelector("strong").textContent} is nog onbekend.` }); else if (status.value === "priced") { if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount.value.trim())) result.push({ field: amount, message: "Geprijsde kosten: vul een bedrag in met maximaal twee decimalen." }); if (year && (!year.value || Number(year.value) > Number($("analysis-years").value))) result.push({ field: year, message: "Vul een gebeurtenisjaar binnen de horizon in." }); } }
        try { Analysis.collectCandidate(key, card); } catch (error) { if (!result.some(p => card.contains(p.field))) result.push({ field: card.querySelector("input"), message: error.message }); }
      }
      if (!Analysis.candidateCards.size) result.push({ field: $("analysis-add"), message: "Voeg minimaal één accu-optie toe." });
      try { Analysis.parameters(); } catch (error) { result.push({ field: $("export-fee-bands"), message: error.message }); }
      return result;
    }
    function updateReview() {
      review.replaceChildren(el("h2", "Controleer je scenario"));
      const chosen = data.imports.find(i => String(i.id) === $("analysis-profile").value);
      review.append(el("p", `${$("analysis-name").value} · ${$("analysis-address").value}`), el("p", `${chosen?.options.is_demo ? "FICTIEF · " : ""}${chosen?.filename || "Geen profiel"} · ${objectives[$("analysis-objective").value]} · ${$("analysis-years").value} jaar vanaf ${$("analysis-start").value}`), el("p", `Inkoop ${$("tariff-import").value || "Onbekend"} €/kWh · terugleververgoeding ${$("tariff-export").value || "Onbekend"} €/kWh · ${Analysis.candidateCards.size} accu-opties`));
      const errors = problems(), list = el("ul", null, "validation-list");
      for (const problem of errors) { const li = el("li"); li.append(button(problem.message, () => reveal(problem.field), "text-button")); list.append(li); }
      const assumptions = el("details"); assumptions.append(el("summary", "Alle tarieven en projectie-aannames"), table(["Invoer", "Waarde"], [...Object.values(Analysis.parameterFields), ...Object.values(Analysis.tariffFields), "export-fee-bands"].map(id => { const field = $(id); return [field.closest("label").firstChild.textContent, field.tagName === "SELECT" ? field.selectedOptions[0].textContent : field.value || "Niet opgegeven"]; }))); review.append(assumptions);
      review.append(el("p", errors.length ? `${errors.length} punten vereisen nog aandacht. Klik op een punt om de invoer te openen.` : "De invoer en bevestigingen zijn compleet. Je kunt de vergelijking berekenen."), list);
      for (const card of Analysis.candidateCards.values()) { const detail = el("details"); detail.append(el("summary", card.querySelector('[data-field="name"]').value), table(["Techniek", "Waarde"], [...card.querySelectorAll('[data-field]')].map(f => [f.closest("label")?.firstChild.textContent, f.value || "Onbekend"])), table(["Kostenpost", "Status", "Bedrag", "Bron"], [...card.querySelectorAll(".cost-row")].map(row => [row.querySelector("strong").textContent, row.querySelector('[data-cost="status"]').selectedOptions[0].textContent, row.querySelector('[data-cost="amount"]').value || "Niet geprijsd", row.querySelector('[data-cost="source"]').value]))); review.append(detail); }
    }
    scenarioFlow = UI.wizard(form, panels.map((panel, i) => ({ label: ["Locatie & profiel", "Tarieven & horizon", "Accu-opties", "Controle & bevestigen"][i], panel })), { validateStep: (panel, index) => {
      if (index === 2) { const problem = problems(false).find(p => fieldStep(p.field) === 2); if (problem) { UI.toast(problem.message, true); reveal(problem.field); return false; } }
      return UI.validate(panel);
    }, onChange: index => { if (index === 3 && window.Analysis) updateReview(); } });
    const removeDraft = button("Concept verwijderen", () => { UI.write("thuisaccu-draft", null); form.reset(); Analysis.candidateCards.clear(); $("analysis-candidates").replaceChildren(); Analysis.restore({ version: 1, fields: {}, candidates: [], site: null, fixedAnnual: 0 }); window.Settings?.applyDefaults(); scenarioFlow.show(0); update(); UI.toast("Concept verwijderd."); }, "text-button"); scenarioFlow.footer.append(removeDraft);
    let optionsTabs, activeOption = 0;
    function enhanceOptions() {
      for (const card of Analysis.candidateCards.values()) if (!card.dataset.enhanced) {
        card.dataset.enhanced = "true";
        const tech = el("div"), costs = card.querySelector(".cost-details"), finance = card.lastElementChild;
        tech.append(card.querySelector(".field-grid"), card.querySelector('textarea[data-field="assumptions"]').closest("label"), finance); costs.open = true;
        card._tabs = UI.tabs(card, [{ label: "Techniek", panel: tech }, { label: "Kosten", panel: costs }]);
        const progress = el("p", null, "cost-progress"); costs.querySelector("summary").after(progress); progress.after(button("Ga naar eerste onbekende post", () => { const unknown = [...card.querySelectorAll(".cost-row")].find(row => row.querySelector('[data-cost="status"]').value === "unknown"); if (unknown) reveal(unknown.querySelector('[data-cost="status"]')); else UI.toast("Alle kostenposten zijn beoordeeld."); }, "text-button"));
        const filterLabel = el("label", null, "inline"), filter = el("input"); filter.type = "checkbox"; filter.className = "cost-filter"; filterLabel.append(filter, "Toon alleen nog onbekend"); progress.after(filterLabel);
        const rows = costs.querySelector(".cost-rows"), groups = new Map();
        for (const row of [...rows.children]) { const category = row.dataset.category, group = ["grant", "vat_refund", "residual_value"].includes(category) ? "Aftrekposten" : row.dataset.timing === "annual" ? "Jaarlijkse kosten" : row.dataset.timing === "event" ? "Gebeurtenissen en vervanging" : ["meter_cabinet", "grid_connection"].includes(category) ? "Netaansluiting & meter" : "Aanschaf & installatie";
          if (!groups.has(group)) { const detail = el("details", null, "cost-group"); detail.open = true; detail.append(el("summary", group)); rows.append(detail); groups.set(group, detail); } groups.get(group).append(row);
        }
        const updateProgress = () => { const all = [...card.querySelectorAll(".cost-row")], unknown = all.filter(row => row.querySelector('[data-cost="status"]').value === "unknown"); progress.textContent = `${all.length - unknown.length}/${all.length} kostenposten beoordeeld${unknown.length ? " · onbekende posten blokkeren de berekening" : " · compleet"}`; all.forEach(row => { row.hidden = filter.checked && !unknown.includes(row); const status = row.querySelector('[data-cost="status"]'); if (status.value !== "unknown" && status.getAttribute("aria-invalid") === "true") UI.invalid(status, ""); }); };
        card.addEventListener("input", updateProgress); card.addEventListener("change", updateProgress); card.addEventListener("click", () => queueMicrotask(updateProgress)); card._updateProgress = updateProgress; updateProgress();
        card.querySelector('[data-field="name"]').addEventListener("input", event => { const index = [...Analysis.candidateCards.values()].indexOf(card); if (optionsTabs?.list.children[index]) optionsTabs.list.children[index].textContent = event.target.value; });
      }
      optionsTabs?.list.remove();
      const cards = [...Analysis.candidateCards.values()]; $("analysis-candidates").replaceChildren(...cards);
      if (cards.length) { const desiredOption = activeOption; optionsTabs = UI.tabs($("analysis-candidates"), cards.map(card => ({ label: card.querySelector('[data-field="name"]').value, panel: card })), index => activeOption = index); optionsTabs.activate(Math.min(desiredOption, cards.length - 1)); }
    }
    function update() {
      const profile = data.imports.find(i => String(i.id) === $("analysis-profile").value), rows = [...form.querySelectorAll(".cost-row")], unknown = rows.filter(row => row.querySelector('[data-cost="status"]').value === "unknown").length;
      summary.replaceChildren(el("p", "JOUW SCENARIO", "eyebrow"), el("h3", $("analysis-name").value), el("p", `${profile?.options.is_demo ? "FICTIEF · " : ""}${profile?.filename || "Kies een profiel"}`), el("p", objectives[$("analysis-objective").value]), el("p", `Inkoop: ${$("tariff-import").value || "Onbekend"} €/kWh`), el("p", `Teruglevering: ${$("tariff-export").value || "Onbekend"} €/kWh`), el("p", `${Analysis.candidateCards.size} opties · ${rows.length - unknown}/${rows.length} kostenposten beoordeeld`), !rows.length ? badge("Nog geen accu-opties", "warning") : badge(unknown ? `${unknown} onbekend` : "Kosten beoordeeld", unknown ? "warning" : "success"), el("small", "Concepten staan alleen in deze browser. Een geslaagde analyse legt haar eigen volledige invoer vast."));
      if (scenarioFlow.current === 3) updateReview();
    }
    let draftTimer;
    window.addEventListener("analysis:saved", () => { clearTimeout(draftTimer); UI.write("thuisaccu-draft", null); });
    const saveDraft = () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => { if (!UI.write("thuisaccu-draft", Analysis.capture())) UI.toast("Dit concept kan niet in deze browser worden bewaard.", true); }, 400); };
    form.addEventListener("input", event => { if (event.target.matches("input,select,textarea")) UI.invalid(event.target, ""); update(); saveDraft(); }); form.addEventListener("change", () => { update(); saveDraft(); });
    form.addEventListener("click", event => { if (event.target.closest("button") && event.target.id !== "analysis-run" && event.target !== removeDraft) queueMicrotask(() => { update(); saveDraft(); }); });
    form.addEventListener("submit", event => { if (scenarioFlow.current !== 3) { event.preventDefault(); event.stopImmediatePropagation(); scenarioFlow.next.click(); return; } const errors = problems(); if (errors.length) { event.preventDefault(); event.stopImmediatePropagation(); if (errors.length) { scenarioFlow.show(3); updateReview(); UI.toast("Controleer de gemarkeerde invoer voordat je rekent.", true); } else scenarioFlow.show(3); } }, true);
    window.addEventListener("analysis:candidates", () => { enhanceOptions(); update(); });
    window.addEventListener("analysis:loaded", () => { enhanceOptions(); for (const card of Analysis.candidateCards.values()) card._updateProgress?.(); scenarioFlow.show(0); update(); });
    Analysis.ready.then(() => { const draft = UI.read("thuisaccu-draft", null); if (draft) { try { Analysis.restore(draft); UI.toast("Je concept is hersteld. Bevestigingen moet je opnieuw controleren."); } catch { UI.toast("Het concept kon niet worden hersteld.", true); } } update(); });
    window.addEventListener("app:route", () => update()); window.addEventListener("app:refreshed", () => update());
  }
  let routeSequence = 0;
  async function onRoute({ detail: { key, id } }) {
    const generation = ++routeSequence;
    try {
      await refresh();
      if (generation !== routeSequence) return;
      if (location.hash.slice(2) !== (id ? `${key.split("/")[0]}/${id}` : key)) return;
      if (key === "dashboard") dashboard();
      lists(key);
      if (key === "accus") $("page-actions").append(button("+ Eigen accu of offerte", () => Research.openCandidate(), ""));
      if (key === "scenarios/detail") { const run = data.runs.find(r => String(r.id) === id); const out = screen(key); out.replaceChildren(); if (run) { Results.render(run, out); } else out.append(empty("Analyse niet gevonden", "De API toont maximaal de laatste 100 analyses.", link("Terug naar scenario’s", "#/scenarios"))); }
      if (key === "opwek/detail") { const item = data.imports.find(i => String(i.id) === id); const out = screen(key); out.replaceChildren(); if (item) { const result = el("div"), fit = suitability(item); out.append(profileName(item), badge(fit.reason, fit.ok ? "success" : "warning"), result); Research.renderSolar(item.summary, item.filename, item.options.timezone, result); $("page-actions").append(button("Start scenario met dit profiel", () => startNew(item.id).catch(error => UI.toast(error.message, true)))); } else out.append(empty("Import niet gevonden", "Kies een bewaard energieprofiel.", link("Terug naar imports", "#/opwek"))); }
    } catch (error) { UI.toast(error.message, true); }
  }
  UI.ready.then(() => { researchScreens(); importWizard(); scenarioWizard(); settingsScreen(); window.addEventListener("analysis:data", ({ detail }) => { data = { ...data, ...detail }; window.dispatchEvent(new Event("app:refreshed")); }); window.addEventListener("app:route", onRoute); window.addEventListener("app:data", () => { if (["#/dashboard", "#/opwek", "#/scenarios"].includes(location.hash)) UI.route(); }); UI.route(); });
  return { get data() { return data; }, screen, refresh, duplicate, startNew, objectives, kpi, empty, resolution, profileName, actionBar };
})();
