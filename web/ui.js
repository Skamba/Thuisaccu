"use strict";

// Gedeelde presentatie: geen domeinberekeningen of stilzwijgende defaults.
window.UI = (() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (cls) element.className = cls;
    return element;
  };
  const formatNumber = (v, decimals = 2) => v == null || !Number.isFinite(Number(v)) ? "Onbekend" : new Intl.NumberFormat("nl-NL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
  const formatMoney = (v, { decimals = 2 } = {}) => v == null || !Number.isFinite(Number(v)) ? "Onbekend" : `${Number(v) < 0 ? "−" : ""}€ ${formatNumber(Math.abs(v), decimals)}`;
  const formatKwh = v => v == null ? "Onbekend" : `${formatNumber(v)} kWh`;
  const formatPct = v => v == null ? "Niet bepaald" : `${formatNumber(v, 1)}%`;
  const formatYears = v => v == null ? "Niet binnen horizon" : `${formatNumber(v, 0)} jaar`;
  const date = v => v == null ? "Onbekend" : new Date(v * 1000).toLocaleString("nl-NL");
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const toast = (text, error = false) => {
    const host = $("toasts") || document.body.appendChild(el("div", null, "toasts")); host.id = "toasts";
    const item = el("div", null, `toast${error ? " error" : ""}`); item.setAttribute("role", error ? "alert" : "status");
    const close = button("Sluiten", () => item.remove(), "text-button"); close.setAttribute("aria-label", "Melding sluiten");
    item.append(el("span", text), close); host.append(item);
    if (!error) setTimeout(() => item.remove(), 5500);
  };
  function button(text, action, cls = "secondary") { const b = el("button", text, cls); b.type = "button"; b.addEventListener("click", action); return b; }
  function link(text, href, cls) { const a = el("a", text, cls); a.href = href; return a; }
  function badge(text, cls = "") { return el("span", text, `badge ${cls}`); }
  async function api(url, options) {
    const response = await fetch(url, options), body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `Verzoek mislukt (${response.status}).`);
    return body;
  }
  function table(headers, rows) {
    const wrap = el("div", null, "table-scroll"); wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", headers.join(", "));
    const t = el("table"), head = el("thead"), tr = el("tr"), body = el("tbody");
    headers.forEach(h => { const th = el("th", h); th.scope = "col"; tr.append(th); }); head.append(tr); t.append(head, body);
    for (const row of rows) { const tr = el("tr"); for (const value of row) { const td = el("td"); td.append(value instanceof Node ? value : document.createTextNode(String(value ?? "Onbekend"))); tr.append(td); } body.append(tr); }
    wrap.append(t); return wrap;
  }
  function csv(filename, rows) {
    const data = rows.map(row => row.map(value => { let text = String(value ?? "Onbekend"); if (/^[=+@-]/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; }).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + data], { type: "text/csv;charset=utf-8" })), a = link("", url); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // De import-API bevat geen maximale intervalduur voor cumulatieve standen.
  function suitability(item) {
    const s = item.summary, o = item.options;
    if (s.consumption_kwh == null) return { ok: false, reason: "Bruto verbruik ontbreekt" };
    if (s.gaps !== 0) return { ok: false, reason: "Gaten in de meetreeks" };
    if (![8760, 8784].some(h => Math.abs(s.coverage_hours - h) < 0.001)) return { ok: false, reason: "Geen volledig meetjaar" };
    if (s.rows > 110000) return { ok: false, reason: "Meer dan 110.000 intervallen" };
    if (o.is_demo === true) return { ok: true, reason: "Geschikt voor ROI · FICTIEF" };
    if (o.mode === "cumulative") return { ok: null, reason: "Onbekend: maximale intervalduur niet beschikbaar" };
    if (!["5min", "10min", "15min", "30min", "hour"].includes(o.period)) return { ok: false, reason: "Uur- of fijnere waarden vereist" };
    const hours = ({ "5min": 1 / 12, "10min": 1 / 6, "15min": .25, "30min": .5, hour: 1 })[o.period];
    if (Math.abs(s.rows * hours - s.coverage_hours) > .001 || Math.abs((s.to_unix_s - s.from_unix_s) / 3600 - s.coverage_hours) > .001) return { ok: null, reason: "Onbekend: intervaldekking niet eenduidig" };
    return { ok: true, reason: "Geschikt voor ROI" };
  }
  function tabs(host, entries, onChange = () => {}) {
    const list = el("div", null, "tabs"); list.setAttribute("role", "tablist"); list.setAttribute("aria-label", "Tabbladen");
    const uid = `tabs-${++tabs.sequence}`;
    const activate = index => {
      entries.forEach((entry, i) => { entry.panel.hidden = i !== index; entry.tab.tabIndex = i === index ? 0 : -1; entry.tab.setAttribute("aria-selected", String(i === index)); });
      onChange(index);
    };
    entries.forEach((entry, index) => {
      const tab = button(entry.label, () => activate(index), "tab"); tab.id = `${uid}-tab-${index}`; tab.setAttribute("role", "tab");
      entry.panel.id ||= `${uid}-panel-${index}`; tab.setAttribute("aria-controls", entry.panel.id); entry.panel.setAttribute("role", "tabpanel"); entry.panel.setAttribute("aria-labelledby", tab.id);
      tab.addEventListener("keydown", event => { let next; if (event.key === "ArrowRight") next = (index + 1) % entries.length; if (event.key === "ArrowLeft") next = (index + entries.length - 1) % entries.length; if (event.key === "Home") next = 0; if (event.key === "End") next = entries.length - 1; if (next !== undefined) { event.preventDefault(); activate(next); entries[next].tab.focus(); } });
      entry.tab = tab; list.append(tab);
    });
    host.append(list, ...entries.map(e => e.panel)); activate(0); return { activate, list };
  }
  tabs.sequence = 0;
  function invalid(field, text) {
    field.id ||= `field-${++tabs.sequence}`;
    const id = `${field.id}-error`; let message = $(id);
    if (!message) { message = el("small", null, "field-error"); message.id = id; field.after(message); }
    message.textContent = text; message.hidden = !text; field.setAttribute("aria-invalid", String(Boolean(text)));
    field.setAttribute("aria-describedby", [...new Set([...(field.getAttribute("aria-describedby") || "").split(" ").filter(Boolean), id])].join(" "));
  }
  function validate(root) {
    let first;
    root.querySelectorAll("input,select,textarea").forEach(field => { const valid = field.checkValidity(); invalid(field, valid ? "" : field.validationMessage); if (!valid && !first) first = field; });
    if (first) { first.focus(); first.reportValidity(); } return !first;
  }
  function wizard(host, entries, { validateStep = panel => validate(panel), onChange = () => {} } = {}) {
    const stepper = el("ol", null, "stepper"), footer = el("div", null, "wizard-footer"); let current = 0;
    const previous = button("← Vorige", () => show(current - 1)), next = button("Volgende →", () => { if (validateStep(entries[current].panel, current)) show(current + 1); }, "");
    footer.append(previous, next);
    const show = index => { current = Math.max(0, Math.min(entries.length - 1, index)); entries.forEach((e, i) => { e.panel.hidden = i !== current; if (i === current) e.control.setAttribute("aria-current", "step"); else e.control.removeAttribute("aria-current"); e.control.disabled = i > current; }); previous.disabled = current === 0; next.hidden = current === entries.length - 1; onChange(current); };
    entries.forEach((entry, i) => { const li = el("li"), b = button(`${i + 1}. ${entry.label}`, () => show(i), "text-button"); entry.control = b; li.append(b); stepper.append(li); });
    host.prepend(stepper); host.append(footer); show(0); return { show, next, previous, footer, get current() { return current; } };
  }
  const screens = new Map(), routes = [
    ["dashboard", "Dashboard", "Onderbouwen, niet raden. Je onderzoek op één plek."],
    ["accus", "Accu’s", "Brongebonden uitvoeringen, zonder automatische winnaar."],
    ["accus/vergelijk", "Accu’s vergelijken", "Elke claim behoudt haar bron en meetgrens."],
    ["opwek", "Opwek & verbruik", "Bewaarde energieprofielen op je eigen computer."],
    ["opwek/import", "Energieprofiel importeren", "Van bestand naar gecontroleerd overzicht."],
    ["opwek/detail", "Energieprofiel", "Opwek, verbruik en datakwaliteit."],
    ["scenarios", "Scenario’s", "Bewaarde analyses met hun oorspronkelijke invoer."],
    ["scenarios/nieuw", "Nieuw scenario", "Vier stappen naar een onderbouwde vergelijking."],
    ["scenarios/detail", "Resultaat", "Vergelijking met geen accu, binnen jouw aannames."],
    ["instellingen", "Instellingen", "Standaardaannames en voorkeuren voor deze browser."]
  ];
  function route() {
    let path = location.hash.slice(2), key = path, id = null;
    if (/^opwek\/\d+$/.test(path)) { key = "opwek/detail"; id = path.split("/")[1]; }
    if (/^scenarios\/\d+$/.test(path)) { key = "scenarios/detail"; id = path.split("/")[1]; }
    if (!screens.has(key)) { location.replace("#/dashboard"); return; }
    screens.forEach((s, name) => { s.hidden = name !== key; });
    document.querySelectorAll(".app-nav a").forEach(a => { const active = path.split("/")[0] === a.hash.slice(2); if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.body.classList.remove("menu-open"); $("menu-toggle").setAttribute("aria-expanded", "false");
    const info = routes.find(r => r[0] === key); $("page-title").textContent = info[1]; $("page-subtitle").textContent = info[2]; $("page-actions").replaceChildren();
    window.dispatchEvent(new CustomEvent("app:route", { detail: { key, id } }));
    $("page-title").focus(); window.scrollTo(0, 0);
  }
  const ready = new Promise(resolve => document.addEventListener("DOMContentLoaded", () => {
    document.querySelector(".hero")?.remove(); document.querySelector(".topbar")?.remove(); $("notice")?.remove(); $("analysis-message")?.remove();
    const sidebar = el("aside", null, "sidebar"); sidebar.append(link("▤ Thuisaccu", "#/dashboard", "brand"), el("p", "LOKAAL ONDERZOEK", "eyebrow"));
    const nav = el("nav", null, "app-nav"); nav.setAttribute("aria-label", "Hoofdnavigatie");
    const icons = ["M3 10L12 3l9 7v11H3z M9 21v-8h6v8", "M7 4h10v17H7z M10 1h4 M9 12h6 M12 9v6", "M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0", "M4 20V10h4v10 M10 20V4h4v16 M16 20v-7h4v7", "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6"];
    ["dashboard", "accus", "opwek", "scenarios", "instellingen"].forEach((name, i) => { const a = link("", `#/${name}`), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), p = document.createElementNS(svg.namespaceURI, "path"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); p.setAttribute("d", icons[i]); svg.append(p); a.append(svg, el("span", routes.find(r => r[0] === name)[1])); nav.append(a); });
    const status = el("div", null, "service"); status.id = "service"; status.append(el("p", "● Service controleren…"), el("small", "Modelversie na een berekening")); sidebar.append(nav, status); document.body.prepend(sidebar);
    const menu = button("☰ Menu", () => { const open = document.body.classList.toggle("menu-open"); menu.setAttribute("aria-expanded", String(open)); }); menu.id = "menu-toggle"; menu.setAttribute("aria-expanded", "false"); menu.setAttribute("aria-controls", "app-navigation"); nav.id = "app-navigation"; document.body.prepend(menu);
    const main = $("main"), header = el("header", null, "page-header"), titleGroup = el("div"), title = el("h1"); title.id = "page-title"; title.tabIndex = -1; const sub = el("p", null, "muted"); sub.id = "page-subtitle"; titleGroup.append(title, sub); const actions = el("div", null, "actions"); actions.id = "page-actions"; header.append(titleGroup, actions); main.prepend(header);
    const old = { accus: $("compare"), "opwek/import": $("solar"), "scenarios/nieuw": $("analysis") };
    routes.forEach(([key]) => { const section = old[key] || el("section"); section.dataset.screen = key; section.hidden = true; screens.set(key, section); main.append(section); });
    document.querySelectorAll("a[href='#analysis']").forEach(a => a.href = "#/scenarios/nieuw");
    window.addEventListener("hashchange", route); route();
    api("/api/v1/health").then(() => { status.firstChild.textContent = "● Lokale service actief"; status.classList.add("online"); }).catch(() => { status.firstChild.textContent = "● Service onbereikbaar"; status.classList.add("offline"); });
    resolve();
  }));
  return { $, el, button, link, badge, formatNumber, formatMoney, formatKwh, formatPct, formatYears, date, read, write, toast, api, table, csv, suitability, tabs, invalid, validate, wizard, screens, route, ready };
})();
