"use strict";

// Schermen en werkstromen boven op de bestaande, expliciete API-invoer.
window.Workspace = (() => {
  const { $, el, button, link, badge, api, table, formatNumber: n, formatMoney: money, formatKwh: kwh, date, suitability } = UI;
  const objectives = { net_present_value: "Netto voordeel (NPV)", roi: "ROI", payback: "Terugverdientijd", self_consumption: "Eigen gebruik" };
  let data = { configurations: [], imports: [], runs: [] };
  const screen = key => UI.screens.get(key);
  const actionBar = (...items) => { const a = el("div", null, "actions"); a.append(...items); return a; };
  const demo = () => { location.hash = "/scenarios/nieuw"; $("analysis-demo").click(); };
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
      return compact ? [title, objectives[request.parameters.objective], r?.name || "Geen accu", money(r ? r.npv_eur : 0), date(run.created_at_unix_s)] : [title, request.site.address, run.input.profile?.filename || `Profiel ${request.solar_import_id}`, objectives[request.parameters.objective], UI.formatYears(request.parameters.horizon_years), r?.name || "Geen accu", money(r ? r.npv_eur : 0), date(run.created_at_unix_s), actions];
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
    const last = data.runs[0], rec = last && recommended(last), tiles = el("div", null, "kpis"); tiles.append(kpi("Accu-uitvoeringen", n(data.configurations.length, 0)), kpi("Opwekimports", n(data.imports.length, 0), `${data.imports.filter(i => suitability(i).ok === true).length} geschikt voor ROI`), kpi("Bewaarde analyses", n(data.runs.length, 0), data.runs.length === 100 ? "API toont de laatste 100" : "Oorspronkelijke invoer bewaard"), kpi("Laatste aanbeveling", last ? rec?.name || "Geen accu" : "Nog geen analyse", last ? date(last.created_at_unix_s) : "Begin met een energieprofiel")); out.append(tiles);
    const next = el("div", null, "panel next-step"); next.append(el("p", "JE VOLGENDE STAP", "eyebrow"));
    if (!data.configurations.length) next.append(el("h2", "Begin je onderzoek"), el("p", "Laad brongebonden voorbeelden of leg een eigen offerte vast."), actionBar(button("Laad onderzochte voorbeelden", () => $("references").click(), ""), button("+ Eigen accu", () => $("add-open").click())));
    if (!data.imports.some(i => suitability(i).ok === true)) next.append(el("h2", "Breng opwek en verbruik samen"), el("p", "Voor ROI heb je één volledig aaneengesloten jaar nodig."), actionBar(link("Importeer opwek + verbruik", "#/opwek/import", "button"), button("Probeer fictief demojaar", demo)));
    else next.append(el("h2", data.runs.length ? "Vergelijk een nieuwe aanname" : "Je profiel is klaar voor een scenario"), actionBar(link("Start scenario", "#/scenarios/nieuw", "button")));
    out.append(next, el("h2", "Recente analyses"));
    out.append(data.runs.length ? table(["Scenario", "Doel", "Aanbevolen optie", "NPV", "Datum"], runRows(data.runs.slice(0, 5), true)) : empty("Nog geen analyses", "Een berekende vergelijking wordt hier bewaard.", link("Nieuw scenario", "#/scenarios/nieuw", "button secondary")));
    out.append(el("h2", "Recente imports")); out.append(data.imports.length ? table(["Profiel", "Periode", "Opwek", "Resolutie", "Verbruik"], importRows(data.imports.slice(0, 5), true)) : empty("Je energieprofielen komen hier", "Importeer een bestand of verken het fictieve demojaar.", link("Importeer bestand", "#/opwek/import", "button secondary")));
  }
  function lists(key) {
    if (key === "opwek") { const out = screen(key); out.replaceChildren(); $("page-actions").append(link("+ Importeer bestand", "#/opwek/import", "button")); out.append(data.imports.length ? table(["Bestand", "Periode", "Intervallen", "Resolutie", "Opwek", "Verbruik", "ROI-geschiktheid"], importRows(data.imports)) : empty("Nog geen energieprofielen", "Controleer je bestand stap voor stap voordat je het bewaart.", link("Importeer bestand", "#/opwek/import", "button"), button("Probeer fictief demojaar", demo))); }
    if (key === "scenarios") { const out = screen(key); out.replaceChildren(); $("page-actions").append(button("Probeer fictief demojaar", demo), link("+ Nieuw scenario", "#/scenarios/nieuw", "button")); out.append(data.runs.length ? table(["Scenario", "Adres", "Profiel", "Doel", "Horizon", "Aanbevolen", "NPV", "Datum", "Acties"], runRows(data.runs)) : empty("Nog geen bewaarde analyses", "Vergelijk accu-opties met geen accu, met expliciete aannames.", link("Nieuw scenario", "#/scenarios/nieuw", "button"), button("Probeer fictief demojaar", demo))); }
  }
  async function refresh() {
    const [comparison, profiles, runs] = await Promise.all([api("/api/v1/comparison"), api("/api/v1/solar/imports"), api("/api/v1/analysis/runs")]);
    data = { ...comparison, imports: profiles.imports, runs: runs.runs }; return data;
  }
  async function duplicate(run) {
    if (window.Analysis?.load) { await Analysis.load(run.input.request); location.hash = "/scenarios/nieuw"; UI.toast("Kopie geladen als nieuw scenario. Controleer en bevestig de invoer opnieuw."); }
    else UI.toast("Dupliceren wordt voorbereid.");
  }
  function researchScreens() {
    const compare = screen("accus/vergelijk"), controls = document.querySelector(".comparison-controls");
    let item = controls;
    while (item) { const next = item.nextElementSibling; compare.append(item); item = next; }
    controls.querySelector("fieldset").remove();
    for (const [id, text] of [["differences-only", "Alleen verschillen"], ["known-only", "Verberg rijen zonder bekende waarde"]]) { const label = el("label", null, "inline"), check = el("input"); check.type = "checkbox"; check.id = id; check.addEventListener("change", () => Research.renderComparison()); label.append(check, text); controls.prepend(label); }
    const toolbar = screen("accus").querySelector(".toolbar");
    for (const [id, labelText, options] of [["kind-filter", "Type", [["", "Alle typen"], ["battery_system", "Accusysteem"], ["battery_module", "Accumodule"]]], ["maker-filter", "Fabrikant", [["", "Alle fabrikanten"]]]]) {
      const label = el("label", labelText), select = el("select"); select.id = id;
      for (const [value, text] of options) { const option = el("option", text); option.value = value; select.append(option); }
      select.addEventListener("change", () => Research.renderCatalog()); label.append(select); toolbar.append(label);
    }
    const menu = el("details", null, "catalog-menu"); menu.append(el("summary", "⋯ Meer"), $("references")); toolbar.append(menu);
    const tray = el("div", null, "compare-tray"); tray.id = "compare-tray"; screen("accus").append(tray);
    const updateMakers = () => { const select = $("maker-filter"), selected = select.value; select.replaceChildren(); for (const name of ["", ...new Set(Research.dataset?.configurations.map(c => c.manufacturer_name))]) { const option = el("option", name || "Alle fabrikanten"); option.value = name; select.append(option); } select.value = selected; };
    Research.ready.then(() => { updateMakers(); Research.renderCatalog(); Research.renderComparison(); }); window.addEventListener("app:data", updateMakers);
    const form = $("candidate-form"), fields = [...form.querySelectorAll(":scope > fieldset")], submit = form.querySelector('[type="submit"]').parentElement;
    const steps = fields.map((panel, i) => ({ label: ["Uitvoering & bron", "Technische gegevens", "Prijsaanbieding"][i], panel })); steps[2].panel.append(submit);
    const wizard = UI.wizard(form, steps);
    form.noValidate = true;
    form.addEventListener("submit", event => { for (let i = 0; i < steps.length; i++) { const invalid = [...steps[i].panel.querySelectorAll("input,select,textarea")].find(f => !f.checkValidity()); if (invalid) { event.preventDefault(); event.stopImmediatePropagation(); wizard.show(i); UI.validate(steps[i].panel); return; } } }, true);
    $("add-open").addEventListener("click", () => wizard.show(0));
    form.addEventListener("input", event => { if (event.target.matches("input,select,textarea")) UI.invalid(event.target, ""); });
  }
  function importWizard() {
    const form = $("solar-form"), mapping = $("mapping"), section = screen("opwek/import"), panels = Array.from({ length: 4 }, () => el("div", null, "wizard-step"));
    for (const child of [...form.children]) if (child !== mapping) panels[0].append(child);
    panels[1].append(mapping); const examples = $("file-preview").parentElement; examples.before($("file-preview")); examples.remove();
    const preview = $("preview-file"), save = $("save-file"), results = $("solar-result"); preview.textContent = "Controleer overzicht →"; save.textContent = "Bewaar energieprofiel";
    panels[1].append(preview); panels[2].append(results); panels[3].append(el("h2", "Bewaren in de lokale database"), el("p", "De bestandsnaam wordt de titel. Het originele bestand wordt niet bewaard; de gecontroleerde intervallen en importinstellingen wel."));
    const filename = el("input"); filename.id = "import-filename"; filename.required = true; filename.maxLength = 240; const label = el("label", "Naam van het bestand / profiel"); label.append(filename); panels[3].append(label, save);
    const helper = el("aside", null, "panel import-help"); helper.append(el("h3", "Hulp bij je export"), $("profile-help"), $("profile-source")); panels[0].append(helper);
    section.querySelector(".solar-layout").before(form); section.querySelector(".solar-layout").remove(); form.classList.remove("panel"); form.append(...panels);
    const wizard = UI.wizard(form, panels.map((panel, i) => ({ label: ["Bestand", "Kolommen & eenheden", "Controle", "Bewaren"][i], panel })), { validateStep: (panel, index) => {
      if (index === 0) { $("inspect-file").click(); return false; }
      if (index === 1) { preview.click(); return false; }
      return UI.validate(panel);
    }, onChange: index => { wizardState(index); } });
    function wizardState(index) { if (index === 0) { /* De expliciete inspectie bepaalt stap 2. */ } }
    window.addEventListener("solar:inspected", () => { wizard.show(1); markColumns(); }); window.addEventListener("solar:previewed", () => wizard.show(2));
    $("solar-history").parentElement.hidden = true; section.append($("solar-history").parentElement);
    $("solar-file").addEventListener("change", () => { filename.value = $("solar-file").files[0]?.name || ""; });
    filename.addEventListener("change", () => { const original = $("solar-file").files[0]; if (!original || !filename.value.trim()) return; const transfer = new DataTransfer(); transfer.items.add(new File([original], filename.value.trim(), { type: original.type, lastModified: original.lastModified })); $("solar-file").files = transfer.files; Research.acceptFilename?.(); });
    const drop = $("solar-file").closest("label"); drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover"); }); drop.addEventListener("dragleave", () => drop.classList.remove("dragover")); drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("dragover"); if (e.dataTransfer.files.length) { $("solar-file").files = e.dataTransfer.files; $("solar-file").dispatchEvent(new Event("change", { bubbles: true })); wizard.show(0); } });
    function markColumns() { const chosen = ["time-column", "time-part-column", "production-column", "consumption-column"].map(id => $(id).value).filter(v => v !== "").map(Number); $("file-preview").querySelectorAll("tr").forEach(row => [...row.children].forEach((cell, i) => cell.classList.toggle("mapped-column", chosen.includes(i)))); }
    panels[1].addEventListener("change", markColumns);
    form.addEventListener("change", event => { if (event.target !== filename && !panels[0].contains(event.target) && event.target !== $("solar-file")) return; if (event.target !== filename) wizard.show(0); });
    form.noValidate = true;
    form.addEventListener("submit", event => { if (wizard.current !== 1 || !UI.validate(panels[1])) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    save.addEventListener("click", event => { if (!UI.validate(panels[3])) { event.stopImmediatePropagation(); } }, true);
  }
  async function onRoute({ detail: { key, id } }) {
    try {
      await refresh();
      if (location.hash.slice(2) !== (id ? `${key.split("/")[0]}/${id}` : key)) return;
      if (key === "dashboard") dashboard();
      lists(key);
      if (key === "scenarios/detail") { const run = data.runs.find(r => String(r.id) === id); const out = screen(key); out.replaceChildren(); if (run) { out.append($("analysis-result")); Analysis.renderResult(run.result, run.input.request); } else out.append(empty("Analyse niet gevonden", "De API toont maximaal de laatste 100 analyses.", link("Terug naar scenario’s", "#/scenarios"))); }
      if (key === "opwek/detail") { const item = data.imports.find(i => String(i.id) === id); const out = screen(key); out.replaceChildren(); if (item) { const result = el("div"); out.append(profileName(item), result); Research.renderSolar(item.summary, item.filename, item.options.timezone, result); $("page-actions").append(button("Start scenario met dit profiel", () => { location.hash = "/scenarios/nieuw"; $("analysis-profile").value = String(item.id); })); } else out.append(empty("Import niet gevonden", "Kies een bewaard energieprofiel.", link("Terug naar imports", "#/opwek"))); }
    } catch (error) { UI.toast(error.message, true); }
  }
  UI.ready.then(() => { researchScreens(); importWizard(); window.addEventListener("app:route", onRoute); window.addEventListener("app:data", () => { if (["#/dashboard", "#/opwek", "#/scenarios"].includes(location.hash)) UI.route(); }); UI.route(); });
  return { get data() { return data; }, screen, refresh, duplicate, objectives, kpi, empty, demo, resolution, profileName, actionBar };
})();
