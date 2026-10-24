"use strict";

const $ = id => document.getElementById(id);
const selected = new Set();
let dataset = null;
let history = [];
let previewSignature = null;
const fmt = (value, digits = 2) => UI.formatNumber(value, digits);
const date = (seconds, timeZone = "UTC") => new Date(seconds * 1000).toLocaleString("nl-NL", { timeZone, timeZoneName: "short" });
function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
function notice(message, error = false) { UI.toast(message, error); }
async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Verzoek mislukt (${response.status}).`);
  return body;
}
async function busy(button, work) {
  button.disabled = true;
  try { return await work(); } catch (error) { notice(error.message, true); if ($("candidate-dialog").open) $("candidate-error").textContent = error.message; return null; }
  finally { button.disabled = button.id === "save-file" && (!previewSignature || previewSignature !== signature()); }
}
function sourceDetails(claim) {
  const details = node("details", null, "source-details");
  details.append(node("summary", "Bron en context"));
  const content = node("div", null, "source-content");
  content.append(node("p", claim.source_title || "Bron"));
  try {
    const url = new URL(claim.source_url);
    if (["https:", "http:"].includes(url.protocol)) {
      const a = node("a", "Open bron ↗"); a.href = url.href; a.target = "_blank"; a.rel = "noopener noreferrer"; content.append(a);
    } else content.append(node("p", "Handmatig opgegeven gegevens"));
  } catch { content.append(node("p", "Geen openbare bronlink")); }
  for (const text of [claim.document_revision && `Revisie: ${claim.document_revision}`, claim.locator, claim.market,
    claim.conditions, claim.entry_conditions, claim.additional_costs_notes,
    claim.observed_at_unix_s && `Vastgelegd: ${date(claim.observed_at_unix_s)}`]) {
    if (text) content.append(node("p", text));
  }
  for (const [key, label, unit] of [["test_temperature_c", "Testtemperatuur", "°C"], ["test_power_w", "Testvermogen", "W"], ["test_soc_pct", "SoC", "%"], ["test_depth_of_discharge_pct", "DoD", "%"], ["test_c_rate", "C-rate", "C"]]) {
    if (claim[key] !== undefined && claim[key] !== null) content.append(node("p", `${label}: ${fmt(claim[key])} ${unit}`));
  }
  content.append(node("p", ({ unreviewed: "Nog niet gecontroleerd", reviewed: "Transcriptie gecontroleerd", disputed: "Betwist", superseded: "Vervangen" })[claim.review_status] || "Controle-status onbekend"));
  details.append(content);
  return details;
}
const boundaries = { unspecified: "meetgrens onbekend", battery_dc: "accu DC", system_ac: "systeem AC", dc_dc: "DC → DC", ac_ac: "AC → AC", pv_ac: "PV → opslag → AC" };
const qualifiers = { exact: "", approximate: "≈ ", at_least: "≥ ", at_most: "≤ ", less_than: "< ", greater_than: "> ", range: "" };
function numberCell(config, metric, scale, unit) {
  const wrap = node("div");
  const claims = dataset.numbers.filter(n => n.configuration_id === config.id && n.metric_key === metric);
  if (!claims.length) return node("span", "Onbekend", "unknown");
  for (const claim of claims) {
    const block = node("div", null, "claim");
    const value = claim.qualifier === "range" ? `${fmt(claim.value / scale)} – ${fmt(claim.upper_value / scale)}` : `${qualifiers[claim.qualifier] || ""}${fmt(claim.value / scale)}`;
    block.append(node("strong", `${value} ${unit}`), node("small", boundaries[claim.boundary] || claim.boundary), sourceDetails(claim));
    wrap.append(block);
  }
  return wrap;
}
function textCell(config, metric) {
  const wrap = node("div");
  const claims = dataset.texts.filter(t => t.configuration_id === config.id && t.metric_key === metric);
  if (!claims.length) return node("span", "Onbekend", "unknown");
  for (const claim of claims) { const block = node("div", null, "claim"); block.append(node("strong", claim.value), sourceDetails(claim)); wrap.append(block); }
  return wrap;
}
function featureCell(config, metric) {
  const wrap = node("div");
  const claims = dataset.features.filter(t => t.configuration_id === config.id && t.metric_key === metric);
  if (!claims.length) return node("span", "Onbekend", "unknown");
  for (const claim of claims) {
    const block = node("div", null, "claim");
    block.append(node("strong", ({ supported: "Ja", unsupported: "Nee", conditional: "Onder voorwaarden", unknown: "Onbekend" })[claim.status]), sourceDetails(claim)); wrap.append(block);
  }
  return wrap;
}
function warrantyCell(config) {
  const claims = dataset.warranties.filter(w => w.configuration_id === config.id);
  if (!claims.length) return node("span", "Onbekend", "unknown");
  const wrap = node("div");
  for (const c of claims) {
    const block = node("div", null, "claim");
    block.append(node("strong", c.product_months ? `${fmt(c.product_months / 12)} jaar productgarantie` : "Productduur onbekend"));
    if (c.performance_months) block.append(node("small", `Prestatie: ${fmt(c.performance_months / 12)} jaar`));
    if (c.retained_capacity_pct !== null) block.append(node("small", `Capaciteitbehoud: ${fmt(c.retained_capacity_pct)}%`));
    if (c.throughput_wh !== null) block.append(node("small", `Doorzetgrens: ${fmt(c.throughput_wh / 1000)} kWh`));
    if (c.cycle_limit !== null) block.append(node("small", `Cyclusgrens: ${fmt(c.cycle_limit)}`));
    block.append(node("small", c.limit_rule === "first_reached" ? "Eerst bereikte grens geldt" : "Controleer de prestatievoorwaarden"));
    block.append(sourceDetails({ ...c, conditions: `${c.application}. ${c.exclusions}` })); wrap.append(block);
  }
  return wrap;
}
function priceCell(config, perKwh = false) {
  const claims = dataset.offers.filter(o => o.configuration_id === config.id);
  if (!claims.length) return node("span", "Geen prijs vastgelegd", "unknown");
  const capacities = dataset.numbers.filter(n => n.configuration_id === config.id && n.metric_key === "usable_energy_wh" && n.qualifier === "exact");
  const wrap = node("div");
  for (const c of claims) {
    const block = node("div", null, "claim");
    if (perKwh && capacities.length !== 1) { block.append(node("span", "Niet bepaald: bruikbare capaciteit ontbreekt of heeft meerdere claims", "unknown")); wrap.append(block); continue; }
    let amount = c.upfront_amount_minor / 10 ** c.minor_unit_exponent;
    if (perKwh) amount /= capacities[0].value / 1000;
    block.append(node("strong", `${c.currency} ${fmt(amount)}${perKwh ? " / kWh" : ""}`));
    block.append(node("small", `${({ included: "Incl. belasting", excluded: "Excl. belasting", unknown: "Belastingbasis onbekend" })[c.tax_basis]}; installatie ${c.includes_installation === null ? "onbekend" : c.includes_installation ? "inbegrepen" : "niet inbegrepen"}`));
    if (c.valid_until_unix_s && c.valid_until_unix_s < Date.now() / 1000) block.append(node("small", "Aanbieding verlopen", "warning"));
    if (c.recurring_amount_minor !== null) block.append(node("small", `Plus ${c.currency} ${fmt(c.recurring_amount_minor / 10 ** c.minor_unit_exponent)} per ${c.recurring_period === "month" ? "maand" : "jaar"}`));
    block.append(sourceDetails(c));
    if (perKwh) { const evidence = node("div"); evidence.append(node("small", "Capaciteitsbron voor dit kengetal:"), sourceDetails(capacities[0])); block.append(evidence); }
    wrap.append(block);
  }
  return wrap;
}
function renderComparison() {
  const table = $("comparison-table"); table.replaceChildren();
  const configs = dataset.configurations.filter(c => selected.has(c.id));
  if (!configs.length) { table.append(node("caption", "Selecteer uitvoeringen om ze te vergelijken.")); return; }
  table.append(node("caption", "Geselecteerde uitvoeringen — bronclaims zonder automatische rangschikking"));
  const head = node("thead"), tr = node("tr"), first = node("th", "Eigenschap"); first.scope = "col"; tr.append(first);
  for (const c of configs) { const th = node("th"); th.scope = "col"; th.append(node("small", c.manufacturer_name), node("strong", c.product_name), node("small", c.name)); tr.append(th); }
  head.append(tr); table.append(head);
  const body = node("tbody");
  const row = (label, factory, group) => {
    if (group && !document.querySelector(`[data-group="${group}"]`).checked) return;
    const tr = node("tr"), th = node("th", label); th.scope = "row"; tr.append(th);
    for (const config of configs) { const td = node("td"); td.append(factory(config)); tr.append(td); }
    body.append(tr);
  };
  row("Bruikbare energie", c => numberCell(c, "usable_energy_wh", 1000, "kWh"));
  row("Opgegeven / nominale energie", c => numberCell(c, "nominal_energy_wh", 1000, "kWh"));
  row("Continu laadvermogen", c => numberCell(c, "continuous_charge_power_w", 1000, "kW"), "performance");
  row("Continu ontlaadvermogen", c => numberCell(c, "continuous_discharge_power_w", 1000, "kW"), "performance");
  row("Schijnbaar vermogen", c => numberCell(c, "apparent_power_va", 1000, "kVA"), "performance");
  row("Piekontlaadvermogen", c => numberCell(c, "peak_discharge_power_w", 1000, "kW"), "performance");
  row("Piekduur", c => numberCell(c, "peak_duration_s", 1, "s"), "performance");
  row("Round-trip-rendement", c => numberCell(c, "round_trip_efficiency_pct", 1, "%"), "performance");
  row("Standbyverbruik", c => numberCell(c, "standby_power_w", 1, "W"), "performance");
  row("Chemie", c => textCell(c, "chemistry"), "installation");
  row("Koppeling", c => textCell(c, "coupling"), "installation");
  row("Omvormer inbegrepen", c => featureCell(c, "inverter_included"), "installation");
  row("Aantal fasen", c => numberCell(c, "phase_count", 1, ""), "installation");
  row("Back-upfunctie", c => featureCell(c, "backup"), "installation");
  row("Back-upvermogen", c => numberCell(c, "backup_power_w", 1000, "kW"), "installation");
  row("Gewicht", c => numberCell(c, "weight_kg", 1, "kg"), "installation");
  row("Product- en prestatiegarantie", warrantyCell, "conditions");
  row("Cloud vereist", c => featureCell(c, "cloud_required"), "conditions");
  row("Abonnement vereist", c => featureCell(c, "subscription_required"), "conditions");
  row("Aanschafaanbiedingen", c => priceCell(c), "conditions");
  row("Prijs / opgegeven bruikbare kWh", c => priceCell(c, true), "conditions");
  table.append(body);
}
function renderCatalog() {
  const catalog = $("catalog"); catalog.replaceChildren();
  const query = $("search").value.toLocaleLowerCase();
  const configs = dataset.configurations.filter(c => `${c.manufacturer_name} ${c.product_name} ${c.name}`.toLocaleLowerCase().includes(query));
  if (!configs.length) { catalog.append(node("p", dataset.configurations.length ? "Geen uitvoeringen bij deze zoekopdracht." : "Je catalogus is nog leeg. Laad de onderzochte voorbeelden of voeg een eigen accu toe.", "empty")); return; }
  for (const c of configs) {
    const card = node("article", null, "product-card"); card.classList.toggle("selected", selected.has(c.id));
    const label = node("label", null, "select-card"), checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(c.id); checkbox.setAttribute("aria-label", `Vergelijk ${c.manufacturer_name} ${c.product_name} ${c.name}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && selected.size >= 4) { checkbox.checked = false; notice("Je kunt maximaal vier uitvoeringen tegelijk vergelijken."); return; }
      if (checkbox.checked) selected.add(c.id); else selected.delete(c.id);
      card.classList.toggle("selected", checkbox.checked); renderComparison();
    });
    label.append(checkbox, node("span", c.manufacturer_name, "eyebrow")); card.append(label, node("h3", c.product_name), node("p", c.name), node("small", c.product_kind === "battery_module" ? "Accumodule" : "Accusysteem"));
    const markets = [...new Set(dataset.numbers.filter(n => n.configuration_id === c.id).map(n => n.market))];
    if (markets.length) card.append(node("small", markets.join(" · ")));
    catalog.append(card);
  }
}
async function reloadCatalog() {
  dataset = await api("/api/v1/comparison");
  if (!selected.size) dataset.configurations.slice(0, 3).forEach(c => selected.add(c.id));
  renderCatalog(); renderComparison();
  window.dispatchEvent(new Event("app:data"));
}
$("search").addEventListener("input", () => dataset && renderCatalog());
document.querySelectorAll("[data-group]").forEach(e => e.addEventListener("change", () => dataset && renderComparison()));
$("references").addEventListener("click", () => busy($("references"), async () => {
  const result = await api("/api/v1/references", { method: "POST" }); await reloadCatalog(); notice(result.imported ? "Drie onderzochte uitvoeringen toegevoegd. Controleer bron, regio en installatieomvang." : "Deze referentiemomentopname is al geladen.");
}));
$("add-open").addEventListener("click", () => { $("candidate-error").textContent = ""; $("candidate-dialog").showModal(); });
$("add-close").addEventListener("click", () => $("candidate-dialog").close());
function exactMoney(raw, exponent) {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Gebruik een positief prijsbedrag zonder duizendtalscheiding.");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > exponent) throw new Error("Het prijsbedrag heeft meer decimalen dan de gekozen valuta.");
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("Het prijsbedrag is te groot.");
  return minor;
}
$("candidate-form").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]');
  await busy(submit, async () => {
    const f = new FormData(form), get = key => String(f.get(key) || "").trim();
    const numbers = [];
    for (const [field, metric, scale, unit, boundary] of [
      ["usable_kwh", "usable_energy_wh", 1000, "kWh", "energy_boundary"], ["charge_kw", "continuous_charge_power_w", 1000, "kW", "power_boundary"],
      ["discharge_kw", "continuous_discharge_power_w", 1000, "kW", "power_boundary"], ["efficiency_pct", "round_trip_efficiency_pct", 1, "%", "efficiency_boundary"]]) {
      if (get(field)) numbers.push({ metric, qualifier: "exact", value: Number(get(field)) * scale, boundary: get(boundary), reported_value: `${get(field)} ${unit}` });
    }
    const features = ["backup", "cloud_required"].filter(key => get(key) !== "unknown").map(metric => ({ metric, status: get(metric), conditions: get("conditions") }));
    if (features.some(v => v.status === "conditional" && !v.conditions)) throw new Error("Beschrijf de voorwaarden voor een voorwaardelijke functie.");
    let price = null;
    if (get("price")) {
      if (!get("seller")) throw new Error("Vul bij een prijsaanbieding ook de verkoper in.");
      price = { seller: get("seller"), currency: get("currency"), minor_unit_exponent: Number(get("exponent")), amount_minor: exactMoney(get("price"), Number(get("exponent"))), tax_basis: get("tax_basis"), includes_installation: get("includes_installation") === "" ? null : get("includes_installation") === "true" };
    }
    const payload = { manufacturer: get("manufacturer"), product: get("product"), model_code: get("model_code"), product_kind: get("product_kind"), configuration: get("configuration"), market: get("market"), source_url: get("source_url"), source_title: get("source_title"), locator: get("locator"), document_revision: get("document_revision") || null, published_on: null, conditions: get("conditions"), numbers, features, texts: [], product_warranty_months: get("warranty_years") ? Number(get("warranty_years")) * 12 : null, price };
    const result = await api("/api/v1/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (selected.size < 4) selected.add(result.configuration_id);
    form.reset(); $("candidate-dialog").close(); await reloadCatalog(); notice("Onderzoeksgegevens opgeslagen. Nieuwe bronclaims blijven apart zichtbaar.");
  });
});
$("export-comparison").addEventListener("click", () => {
  if (!selected.size) { notice("Selecteer eerst een uitvoering."); return; }
  const rows = [...$("comparison-table").querySelectorAll("tr")].map(row => [...row.children].map(cell => {
    let text = cell.innerText.replace(/\s+/g, " ").trim();
    const sources = [...new Set([...cell.querySelectorAll("a[href]")].map(a => a.href))];
    if (sources.length) text += " Bronnen: " + sources.join(" | ");
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(";"));
  const link = node("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" })); link.download = "thuisaccu-vergelijking.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

function importOptions() {
  return { profile: $("import-profile").value, sheet: $("sheet").value || null, header_row: Number($("header-row").value), delimiter: $("delimiter").value, decimal: $("decimal").value,
    time_column: Number($("time-column").value || 0), production_column: Number($("production-column").value || 1), consumption_column: $("consumption-column").value === "" ? null : Number($("consumption-column").value),
    time_part_column: $("time-part-column").value === "" ? null : Number($("time-part-column").value), date_order: $("date-order").value, missing_rows: $("missing-rows").value,
    unit: $("unit").value, mode: $("mode").value, period: $("period").value, timezone: $("timezone").value.trim(), timestamp_position: $("timestamp-position").value, data_kind: $("data-kind").value };
}
function signature() { const f = $("solar-file").files[0]; return JSON.stringify([f && f.name, f && f.size, f && f.lastModified, importOptions()]); }
function multipart() {
  const file = $("solar-file").files[0]; if (!file) throw new Error("Kies eerst een zonne-opwekbestand.");
  const body = new FormData(); body.append("file", file); body.append("options", JSON.stringify(importOptions())); return body;
}
function invalidatePreview() { previewSignature = null; $("save-file").disabled = true; }
$("solar-form").addEventListener("change", invalidatePreview);
const profiles = {
  solaredge: ["Gebruik installatieproductie uit Monitoring (CSV/Excel) of een bewaarde Site Energy JSON-export. Kies bij JSON date/value; eenheid en periode komen uit de metadata. Kies de tijdzone van de installatie. Ontbrekende waarden zijn geen nul.", "https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf"],
  enphase: ["Open Reports in Enlighten en exporteer Site Energy Production, eventueel met Site Energy Consumption. Gebruik het installatietotaal; tel een totaal en de losse panelen niet samen. Recent Power bevat vermogen, geen periode-energie. Controleer Wh/kWh en de datumnotatie.", "https://enphase.com/sites/default/files/2025-08/Enphase-solar-troubleshooting-guide-ING-00061-2.0-EN-INT-2025-08-14.pdf"],
  sma: ["Sunny Portal: Configuration → Data Export voor energiebalans; kies productie in plaats van netexport. Dag-/maandenergie en intraday-vermogen zijn aparte bestanden. Analysis Pro kan 5-minutengemiddelden exporteren; kies dan gemiddeld W/kW en 5 minuten. Kopregels en lokale getalnotatie kunnen verschillen.", "https://www.sma.de/en/products/energy-management/sunny-portal"],
  fronius: ["Solar.web: exporteer een productie- of energiebalansrapport als CSV/Excel. Kies de totale PV-productie, niet afname of netteruglevering. Selecteer bij gescheiden datum en tijd beide kolommen. Beschikbare rapporten hangen van toegang en abonnement af.", "https://www.fronius.com/~/downloads/Solar%20Energy/Whitepaper/SE_WP_Fronius_RGM_Guide_GEN24_Customer_EN.pdf"],
  pvgis: ["Voor PVGIS 5 uur-JSON kies time en P. P is vermogen in W: uurperiode, UTC en gemodelleerde opwek. CSV kan via kolomkeuze. PVGIS 6 heeft andere uitvoervormen; alleen een vlakke tabel of objectarray wordt daarvoor ondersteund.", "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en"]
};
$("import-profile").addEventListener("change", () => {
  const profile = profiles[$("import-profile").value];
  $("profile-help").textContent = profile ? profile[0] : "Kies de tijd-, opwek- en eventuele verbruikskolommen van je eigen export. Controleer de eenheid en meetperiode.";
  $("profile-source").hidden = !profile;
  if (profile) $("profile-source").href = profile[1];
  if ($("import-profile").value === "pvgis") { $("unit").value = "w"; $("period").value = "hour"; $("mode").value = "interval"; $("timezone").value = "UTC"; $("data-kind").value = "modelled"; }
  $("mapping").hidden = true; invalidatePreview();
});
["header-row", "delimiter", "sheet"].forEach(id => $(id).addEventListener("change", () => { $("mapping").hidden = true; invalidatePreview(); }));
$("solar-file").addEventListener("change", () => { $("mapping").hidden = true; $("sheet").replaceChildren(); $("sheet-label").hidden = true; });
$("inspect-file").addEventListener("click", () => busy($("inspect-file"), async () => {
  invalidatePreview(); const result = await api("/api/v1/solar/inspect", { method: "POST", body: multipart() });
  const currentSheet = $("sheet").value; $("sheet").replaceChildren();
  for (const sheet of result.sheets) { const option = node("option", sheet); option.value = sheet; $("sheet").append(option); }
  if (result.sheets.includes(currentSheet)) $("sheet").value = currentSheet;
  $("sheet-label").hidden = !result.sheets.length;
  for (const id of ["time-column", "time-part-column", "production-column", "consumption-column"]) {
    $(id).replaceChildren();
    if (["consumption-column", "time-part-column"].includes(id)) { const option = node("option", "Niet beschikbaar / niet nodig"); option.value = ""; $(id).append(option); }
    result.headers.forEach((header, index) => { const option = node("option", `${index + 1}. ${header || "(leeg)"}`); option.value = String(index); $(id).append(option); });
  }
  const guess = regex => result.headers.findIndex(h => regex.test(h));
  const time = guess(/timestamp|datum|date|tijd|time/i), production = guess(/production|produced|opwek|generation|erzeugung|ertrag|^P$|^value$|^energy|yield/i), consumption = guess(/consumption|consumed|verbruik|verbrauch/i);
  $("time-column").value = String(time >= 0 ? time : 0); $("production-column").value = String(production >= 0 ? production : Math.min(1, result.headers.length - 1));
  $("consumption-column").value = consumption >= 0 ? String(consumption) : "";
  const separateTime = guess(/^(time|tijd|uhrzeit)(\s|$)/i);
  $("time-part-column").value = separateTime >= 0 && separateTime !== time ? String(separateTime) : "";
  const productionHeader = result.headers[Number($("production-column").value)] || "";
  const unitMatch = productionHeader.match(/(?:^|[^a-z])(kwh|wh|kw|w)(?:[^a-z]|$)/i);
  if (result.detected_unit && ["kwh", "wh", "kw", "w"].includes(result.detected_unit)) $("unit").value = result.detected_unit;
  else if (unitMatch) $("unit").value = unitMatch[1].toLowerCase();
  if (result.detected_period && [...$("period").options].some(o => o.value === result.detected_period)) { $("period").value = result.detected_period; $("mode").value = "interval"; }
  const table = node("table"), head = node("tr"); result.headers.forEach(h => head.append(node("th", h))); table.append(head);
  result.preview.forEach(row => { const tr = node("tr"); row.forEach(cell => tr.append(node("td", cell))); table.append(tr); });
  $("file-preview").replaceChildren(table); $("mapping").hidden = false;
  notice(`${fmt(result.row_count, 0)} gegevensrijen ingelezen. Controleer kolommen, eenheden, periode en tijdzone.`);
}));
function renderSolar(summary, title = "Gecontroleerde preview", timeZone = importOptions().timezone) {
  const result = $("solar-result"); result.replaceChildren(node("p", title, "eyebrow"));
  const stats = node("div", null, "stats");
  const addStat = (label, value) => { const item = node("div"); item.append(node("small", label), node("strong", value)); stats.append(item); };
  addStat("Zonne-opwek", `${fmt(summary.production_kwh)} kWh`); addStat("Meetperioden", fmt(summary.rows, 0));
  if (summary.consumption_kwh !== null) addStat("Verbruik", `${fmt(summary.consumption_kwh)} kWh`);
  addStat("Dekking", `${fmt(summary.coverage_hours)} uur`); result.append(stats, node("p", `${date(summary.from_unix_s, timeZone)} t/m ${date(summary.to_unix_s, timeZone)}`, "muted"));
  if (summary.interval_surplus_kwh !== null) result.append(node("p", `Opwek boven verbruik per meetperiode: ${fmt(summary.interval_surplus_kwh)} kWh. Verbruik boven opwek: ${fmt(summary.interval_deficit_kwh)} kWh. Dit zijn geaggregeerde verschillen, geen accubesparing.`));
  const chart = node("div", null, "bar-chart"); chart.setAttribute("aria-label", "Zonne-opwek per maand");
  const max = Math.max(1, ...summary.months.map(m => m.production_kwh));
  for (const month of summary.months) {
    const row = node("div", null, "bar-row"), track = node("div", null, "bar-track"), bar = node("div", null, "bar");
    bar.style.width = `${100 * month.production_kwh / max}%`; track.append(bar); row.append(node("span", month.label), track, node("strong", `${fmt(month.production_kwh)} kWh`)); chart.append(row);
  }
  result.append(chart);
  const warnings = node("ul", null, "warnings"); summary.warnings.forEach(w => warnings.append(node("li", w))); result.append(warnings);
}
$("solar-form").addEventListener("submit", event => {
  event.preventDefault();
  busy($("preview-file"), async () => {
    invalidatePreview(); const sentSignature = signature();
    const result = await api("/api/v1/solar/preview", { method: "POST", body: multipart() });
    if (sentSignature !== signature()) throw new Error("De instellingen zijn veranderd. Controleer de preview opnieuw.");
    renderSolar(result); previewSignature = sentSignature; $("save-file").disabled = false; notice("Preview gecontroleerd. Bewaar het overzicht als de interpretatie klopt.");
  });
});
async function reloadHistory() {
  const result = await api("/api/v1/solar/imports"); history = result.imports;
  $("solar-history").replaceChildren(); const empty = node("option", "Kies een bewaard overzicht…"); empty.value = ""; $("solar-history").append(empty);
  for (const item of history) { const option = node("option", `${item.filename} · ${fmt(item.summary.production_kwh)} kWh`); option.value = String(item.id); $("solar-history").append(option); }
}
$("save-file").addEventListener("click", () => busy($("save-file"), async () => {
  if (!previewSignature || previewSignature !== signature()) throw new Error("Controleer eerst opnieuw de preview.");
  const result = await api("/api/v1/solar/imports", { method: "POST", body: multipart() }); renderSolar(result.summary, "Opgeslagen in SQLite"); await reloadHistory(); $("solar-history").value = String(result.id); notice("Zonne-opwek opgeslagen. Hetzelfde bestand met dezelfde instellingen wordt niet dubbel bewaard.");
}));
$("solar-history").addEventListener("change", () => { const item = history.find(i => String(i.id) === $("solar-history").value); if (item) renderSolar(item.summary, `Bewaard: ${item.filename} · ${item.options.timezone}`, item.options.timezone); });
window.Research = { renderSolar, reloadCatalog, reloadHistory, get dataset() { return dataset; }, selected };
Research.ready = Promise.all([reloadCatalog(), reloadHistory()]).catch(error => notice(error.message, true));
