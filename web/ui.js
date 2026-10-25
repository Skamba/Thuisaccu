"use strict";

// Gedeelde bouwstenen voor alle schermen: elementen, opmaak, formulieren, wizard en grafieken.
// Gegevens komen uitsluitend via tekstknopen in de DOM, nooit via HTML-tekenreeksen.
window.UI = (() => {
  const SVG = "http://www.w3.org/2000/svg";

  // h("p", { class: "muted", onclick: fn }, "tekst", kindElement, [meer, kinderen])
  function h(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value == null || value === false) continue;
      if (key === "class") element.className = value;
      else if (key === "dataset") Object.assign(element.dataset, value);
      else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value);
      else if (key in element && typeof value !== "string") element[key] = value;
      else element.setAttribute(key, value === true ? "" : value);
    }
    append(element, children);
    return element;
  }
  function append(parent, children) {
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return parent;
  }
  const $ = id => document.getElementById(id);
  let sequence = 0;
  const uid = prefix => `${prefix}-${++sequence}`;

  // Opmaak in nl-NL. Onbekend blijft zichtbaar als ‘Onbekend’, nooit als nul.
  const finite = value => value !== null && value !== "" && Number.isFinite(Number(value));
  const number = (value, decimals = 2) => finite(value)
    ? new Intl.NumberFormat("nl-NL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
    : "Onbekend";
  const money = (value, { decimals = 2 } = {}) => finite(value)
    ? `${Number(value) < 0 ? "−" : ""}€ ${number(Math.abs(value), decimals)}`
    : "Onbekend";
  const kwh = (value, decimals = 0) => finite(value) ? `${number(value, decimals)} kWh` : "Onbekend";
  const pct = (value, decimals = 1) => finite(value) ? `${number(value, decimals)}%` : "Niet bepaald";
  const years = value => value == null ? "Niet binnen de looptijd" : `${number(value, 0)} jaar`;
  const dateTime = seconds => seconds == null ? "Onbekend" : new Date(seconds * 1000).toLocaleString("nl-NL");
  const dateOnly = seconds => seconds == null ? "Onbekend" : new Date(seconds * 1000).toLocaleDateString("nl-NL");
  // Getal uit een invoerveld; komma en punt als decimaalteken. Leeg geeft null.
  const parse = raw => {
    const text = String(raw ?? "").trim().replace(",", ".");
    return text === "" || !Number.isFinite(Number(text)) ? null : Number(text);
  };

  async function api(url, { method = "GET", json, body } = {}) {
    const options = { method };
    if (json !== undefined) { options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(json); }
    else if (body !== undefined) options.body = body;
    // In de browserversie (local.js) beantwoordt een webworker de API in plaats van de server.
    const response = await (Local.enabled ? Local.fetch : fetch)(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Verzoek mislukt (${response.status}).`);
    return data;
  }

  // Browseropslag is een gemak, geen opslag van uitkomsten; werkt ook als die ontbreekt.
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) {
      try { if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    }
  };

  function toast(text, error = false) {
    let host = $("toasts");
    if (!host) { host = h("div", { id: "toasts", class: "toasts" }); document.body.append(host); }
    const item = h("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : "status" },
      h("span", {}, text),
      h("button", { type: "button", class: "ghost", "aria-label": "Melding sluiten", onclick: () => item.remove() }, "Sluiten"));
    host.append(item);
    if (!error) setTimeout(() => item.remove(), 6000);
  }

  // Voert een actie uit met een uitgeschakelde knop; fouten worden als melding getoond.
  async function busy(button, work) {
    button.disabled = true;
    try { return await work(); }
    catch (error) { toast(error.message, true); return undefined; }
    finally { button.disabled = false; }
  }

  const button = (text, onclick, variant = "primary", props = {}) =>
    h("button", { type: "button", class: variant, onclick, ...props }, text);
  const link = (text, href, cls) => h("a", { href, class: cls }, text);
  const external = (text, href) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text);
  const badge = (text, tone = "") => h("span", { class: `badge ${tone}` }, text);

  // Formulierveld met label, optionele hulptekst en foutmelding.
  function field(labelText, control, help) {
    control.id ||= uid("veld");
    const helpId = help ? `${control.id}-hulp` : null;
    if (helpId) control.setAttribute("aria-describedby", helpId);
    return h("div", { class: "field" },
      h("label", { for: control.id }, labelText),
      control,
      help ? h("small", { id: helpId, class: "help" }, help) : null);
  }
  const input = (props = {}) => h("input", { type: "text", ...props });
  const numberInput = (props = {}) => h("input", { type: "number", step: "any", inputmode: "decimal", ...props });
  function select(options, value, props = {}) {
    const element = h("select", props, options.map(([v, text]) => h("option", { value: v }, text)));
    if (value != null) element.value = String(value);
    return element;
  }
  // Keuzerondjes als kaarten: [waarde, titel, toelichting].
  function choice(legend, name, options, value, onChange, help) {
    return h("fieldset", { class: "choice" },
      h("legend", {}, legend),
      options.map(([v, title, detail]) => h("label", { class: "choice-option" },
        h("input", { type: "radio", name, value: v, checked: value === v, onchange: () => onChange(v) }),
        h("span", {}, h("strong", {}, title), detail ? h("small", {}, detail) : null))),
      help ? h("p", { class: "help" }, help) : null);
  }
  const checkbox = (labelText, props = {}) => {
    const box = h("input", { type: "checkbox", ...props });
    return { box, element: h("label", { class: "check" }, box, h("span", {}, labelText)) };
  };
  // Markeert ongeldige velden met een zichtbare melding; geeft het eerste ongeldige veld terug.
  function validate(root) {
    let first = null;
    for (const control of root.querySelectorAll("input, select, textarea")) {
      const valid = control.checkValidity();
      control.setAttribute("aria-invalid", String(!valid));
      const holder = control.closest(".field");
      holder?.querySelector(".error")?.remove();
      if (!valid) { holder?.append(h("small", { class: "error" }, control.validationMessage)); first ||= control; }
    }
    first?.focus();
    return !first;
  }

  function table(headers, rows, { caption, className = "" } = {}) {
    return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": caption || headers.join(", ") },
      h("table", { class: className },
        caption ? h("caption", {}, caption) : null,
        h("thead", {}, h("tr", {}, headers.map(text => h("th", { scope: "col" }, text)))),
        h("tbody", {}, rows.map(row => h("tr", {}, row.map(cell => h("td", {}, cell ?? "Onbekend")))))));
  }
  const stats = items => h("dl", { class: "stats" },
    items.map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, value))));
  const empty = (title, text, ...actions) => h("div", { class: "empty" }, h("h2", {}, title), h("p", {}, text),
    h("div", { class: "actions" }, actions));

  // Tabbladen met pijltjestoetsen, Home en End.
  function tabs(entries, initial = 0) {
    const id = uid("tabs"), list = h("div", { class: "tabs", role: "tablist" }), panels = [];
    const show = index => entries.forEach((_, i) => {
      list.children[i].setAttribute("aria-selected", String(i === index));
      list.children[i].tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    entries.forEach(({ label, content }, index) => {
      const tab = h("button",
        { type: "button", role: "tab", id: `${id}-tab-${index}`, "aria-controls": `${id}-panel-${index}`,
          onclick: () => show(index) },
        label);
      tab.addEventListener("keydown", event => {
        const next = { ArrowRight: (index + 1) % entries.length,
          ArrowLeft: (index - 1 + entries.length) % entries.length, Home: 0, End: entries.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); show(next); list.children[next].focus();
      });
      list.append(tab);
      panels.push(h("div", { role: "tabpanel", id: `${id}-panel-${index}`, "aria-labelledby": tab.id }, content));
    });
    show(initial);
    return h("div", { class: "tabset" }, list, panels);
  }

  // Wizard: stappen [{ label, render(body) }]; validate(index, body) mag blokkeren.
  function wizard(steps, { validate: check = () => true, onShow = () => {}, finish } = {}) {
    const stepper = h("ol", { class: "stepper" }), body = h("div", { class: "wizard-body" });
    const previous = button("← Vorige", () => show(current - 1), "secondary");
    const next = button("Volgende →", async () => { if (await check(current, body)) show(current + 1); });
    const footer = h("div", { class: "wizard-footer" }, previous, next, finish ?? null);
    let current = 0, reached = 0;
    steps.forEach((step, index) => stepper.append(h("li", {},
      h("button", { type: "button", class: "ghost", onclick: () => index <= reached && show(index) }, `${index + 1}. ${step.label}`))));
    function show(index) {
      current = Math.max(0, Math.min(steps.length - 1, index)); reached = Math.max(reached, current);
      [...stepper.children].forEach((li, i) => {
        const control = li.firstChild; control.disabled = i > reached;
        if (i === current) control.setAttribute("aria-current", "step"); else control.removeAttribute("aria-current");
      });
      body.replaceChildren(); steps[current].render(body);
      previous.disabled = current === 0; next.hidden = current === steps.length - 1;
      onShow(current, body);
      body.querySelector("h2, h3")?.setAttribute("tabindex", "-1");
    }
    const element = h("div", { class: "wizard" }, stepper, body, footer);
    return { element, show, rerender: () => show(current), get current() { return current; } };
  }

  function dialog(title, ...content) {
    const close = () => { element.close(); element.remove(); };
    const element = h("dialog", { "aria-label": title },
      h("div", { class: "dialog-head" }, h("h2", {}, title), button("✕", close, "ghost", { "aria-label": "Sluiten" })),
      content);
    element.addEventListener("close", () => element.remove());
    document.body.append(element); element.showModal();
    return { element, close };
  }

  // CSV met puntkomma en BOM voor Excel; voorkomt formule-injectie.
  function downloadCsv(filename, rows) {
    const cell = value => {
      let text = String(value ?? "Onbekend");
      if (/^[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const blob = new Blob(["﻿" + rows.map(row => row.map(cell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" });
    downloadBlob(filename, blob);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob), a = h("a", { href: url, download: filename });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Grafieken in inline SVG, altijd met een tabel als tekstalternatief.
  const palette = ["#2b7a5f", "#3f7cc0", "#c06a1f", "#8f5aa0", "#00858b", "#8b6b23", "#5e68b8", "#b84d74", "#5f7338",
    "#7a6a5e"];
  function chart(type, { title, rows, series, unit = "", format = v => number(v, 0), marks = [] }) {
    const width = 880, horizontal = type === "range" || type === "stacked";
    const height = horizontal ? Math.max(220, rows.length * 56 + 80) : 320;
    const longest = Math.max(0, ...rows.map(r => String(r.label).length));
    const left = horizontal ? Math.min(330, Math.max(110, longest * 6.6 + 24)) : 80, right = 24, top = 20,
      bottom = 50, plotW = width - left - right, plotH = height - top - bottom;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${title}. De waarden staan ook in de tabel onder de grafiek.`);
    const draw = (tag, attrs, label) => {
      const node = document.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (label) {
        const tip = document.createElementNS(SVG, "title"); tip.textContent = label; node.append(tip);
        node.setAttribute("tabindex", "0"); node.setAttribute("aria-label", label);
      }
      svg.append(node); return node;
    };
    const text = (x, y, value,
      anchor = "start") => { draw("text", { x, y, "text-anchor": anchor, class: "chart-text" }).textContent = value; };
    const colour = (i, s) => s?.color || palette[i % palette.length];
    const values = rows.flatMap(r => type === "stacked" ? [r.values.reduce((a, b) => a + (b ?? 0),
      0)] : r.values).filter(finite);
    // Ronde aswaarden (1, 2, 2,5 of 5 × een macht van tien), ongeveer vier intervallen.
    const low = Math.min(0, ...values), high = Math.max(0, ...values), rough = (high - low || 1) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(f => f * magnitude).find(s => s >= rough);
    const min = Math.floor(low / step) * step, max = Math.ceil(high / step) * step, span = max - min || 1;
    const x = v => left + (v - min) / span * plotW, y = v => top + (max - v) / span * plotH;
    for (let i = 0; i <= Math.round(span / step); i++) {
      const value = min + i * step;
      if (horizontal) { draw("line",
        { x1: x(value), x2: x(value), y1: top, y2: height - bottom, class: "chart-grid" });
        text(x(value), height - 26, format(value), "middle"); }
      else { draw("line", { x1: left, x2: width - right, y1: y(value), y2: y(value), class: "chart-grid" });
        text(left - 10, y(value) + 4, format(value), "end"); }
    }
    if (horizontal) draw("line", { x1: x(0), x2: x(0), y1: top, y2: height - bottom, class: "chart-axis" });
    else draw("line", { x1: left, x2: width - right, y1: y(0), y2: y(0), class: "chart-axis" });

    if (type === "line") {
      // Met een getal `x` in elke rij staan de punten op een echte getallenas; anders op gelijke afstand.
      const numeric = rows.length > 1 && rows.every(r => finite(r.x));
      const first = numeric ? rows[0].x : 0, last = numeric ? rows[rows.length - 1].x : rows.length - 1;
      const px = i => left + ((numeric ? rows[i].x : i) - first) / (last - first || 1) * plotW;
      series.forEach((s, si) => {
        const points = rows.map((r,
          i) => finite(r.values[si]) ? `${px(i)},${y(r.values[si])}` : null).filter(Boolean).join(" ");
        draw("polyline",
          { points, fill: "none", stroke: colour(si, s), "stroke-width": 2.5,
            "stroke-dasharray": si > 4 ? "7 3" : "none" });
        rows.forEach((r,
          i) => { if (finite(r.values[si])) draw("circle",
            { cx: px(i), cy: y(r.values[si]), r: 4, fill: colour(si, s) },
            `${s.label}, ${r.label}: ${format(r.values[si])} ${unit}`); });
      });
      if (numeric) {
        // Alleen labels die elkaar niet raken; het laatste punt krijgt altijd een label.
        let previous = -Infinity;
        rows.forEach((r, i) => {
          const at = px(i), end = i === rows.length - 1;
          if (at - previous < 56 || (!end && px(rows.length - 1) - at < 56)) return;
          text(at, height - 28, r.label, "middle"); previous = at;
        });
      } else {
        const step = Math.max(1, Math.ceil(rows.length / 10));
        rows.forEach((r,
          i) => { if (i % step === 0 || i === rows.length - 1) text(px(i), height - 28, r.label, "middle"); });
      }
      for (const mark of marks) {
        const index = rows.findIndex(r => r.label === mark.at); if (index < 0) continue;
        draw("line", { x1: px(index), x2: px(index), y1: top, y2: height - bottom, class: "chart-mark" }, mark.label);
        text(px(index), top + 12, mark.symbol, "middle");
      }
    } else {
      rows.forEach((r, ri) => {
        if (horizontal) {
          const cy = top + (ri + 0.5) / rows.length * plotH;
          const name = String(r.label), short = name.length > 48 ? `${name.slice(0, 47)}…` : name;
          text(left - 12, cy + 4, short, "end");
          if (type === "stacked") {
            let start = 0;
            r.values.forEach((v, si) => {
              if (!finite(v)) return;
              draw("rect",
                { x: x(start), y: cy - 13, width: Math.max(0, x(start + v) - x(start)), height: 26,
                  fill: colour(si, series[si]) },
                `${r.label}, ${series[si].label}: ${format(v)} ${unit}`);
              start += v;
            });
          } else {
            const known = r.values.filter(finite); if (!known.length) return;
            draw("line", { x1: x(Math.min(...known)), x2: x(Math.max(...known)), y1: cy, y2: cy, stroke: r.color || colour(ri), "stroke-width": 8 },
              `${r.label}: ${r.values.map((v, i) => `${series[i].label} ${format(v)} ${unit}`).join(", ")}`);
            r.values.forEach((v, i) => {
              if (!finite(v)) return;
              if (i === 1) draw("circle", { cx: x(v), cy, r: 6, class: "chart-base" },
                `${r.label}, ${series[i].label}: ${format(v)} ${unit}`);
              else draw("rect", { x: x(v) - 2, y: cy - 9, width: 4, height: 18, class: "chart-tick" },
                `${r.label}, ${series[i].label}: ${format(v)} ${unit}`);
            });
          }
        } else {
          const groupW = plotW / rows.length, barW = groupW / (series.length + 1);
          r.values.forEach((v, si) => {
            if (!finite(v)) return;
            draw("rect",
              { x: left + ri * groupW + si * barW + barW / 2, y: Math.min(y(v), y(0)), width: barW * 0.86,
                height: Math.max(1, Math.abs(y(v) - y(0))), fill: colour(si, series[si]) },
              `${r.label}, ${series[si].label}: ${format(v)} ${unit}`);
          });
          text(left + (ri + 0.5) * groupW, height - 28, r.label, "middle");
        }
      });
    }
    text(width - right, height - 6, unit, "end");
    const legend = h("ul", { class: "legend" }, series.map((s, i) => h("li", {},
      type === "range" ? h("span", { class: `swatch ${i === 1 ? "swatch-base" : "swatch-tick"}` })
        : h("span", { class: "swatch", style: `background:${colour(i, s)}` }), s.label)));
    const data = h("details", {}, h("summary", {}, "Toon als tabel"),
      table(["", ...series.map(s => `${s.label}${unit ? ` (${unit})` : ""}`)], rows.map(r => [r.label, ...r.values.map(v => finite(v) ? format(v) : "Onbekend")])));
    return h("figure", { class: "chart" }, h("figcaption", {}, title), svg, legend, data);
  }

  // Schermregistratie; app.js verzorgt navigatie en routering.
  const pages = new Map();
  const page = (key, definition) => pages.set(key, definition);

  return {
    h, append, $, uid, finite, number, money, kwh, pct, years, dateTime, dateOnly, parse, api, store, toast, busy,
    button, link, external, badge, field, input, numberInput, select, choice, checkbox, validate, table, stats, empty,
    tabs, wizard, dialog, downloadCsv, downloadBlob, chart, palette, pages, page
  };
})();
