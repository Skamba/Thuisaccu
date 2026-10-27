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
  // Minteken, euroteken en bedrag blijven op één regel.
  const money = (value, { decimals = 2 } = {}) => finite(value)
    ? `${Number(value) < 0 ? "−\u2060" : ""}€\u00a0${number(Math.abs(value), decimals)}`
    : "Onbekend";
  const kwh = (value, decimals = 0) => finite(value) ? `${number(value, decimals)} kWh` : "Onbekend";
  // Een echt minteken, zoals bij bedragen; de CSV-export gebruikt number() en houdt het streepje.
  const pct = (value, decimals = 1) => finite(value) ? `${number(value, decimals).replace(/^-/, "−")}%` : "Niet bepaald";
  const years = value => value == null ? "Niet binnen de looptijd" : `${number(value, 0)} jaar`;
  const dateTime = seconds => seconds == null ? "Onbekend" : new Date(seconds * 1000).toLocaleString("nl-NL");
  // Datums van meetgegevens in Nederlandse tijd, zoals het profieloverzicht, ook in een browser in een andere tijdzone.
  const dateOnly = seconds => seconds == null ? "Onbekend"
    : new Date(seconds * 1000).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam" });
  // Getal uit een invoerveld in Nederlandse notatie: komma (of punt) als decimaalteken, punten in groepen
  // van drie als duizendtallen (6.500,00 en 1.250.000). Leeg of geen getal geeft null.
  // ‘3.500’ kan 3500 of 3,5 zijn: dat is dubbelzinnig, geeft null, en `validate` vraagt het na. Bij een
  // bedrag in euro (`money`) is het 3500, want centen hebben twee decimalen. ‘6500,-’ is 6500; ‘0x10’ en
  // ‘1e3’ zijn geen getal.
  const tidy = raw => String(raw ?? "").trim().replace(/^€/, "").replace(/\s/g, "").replace(/,-{1,2}$/, "");
  const ambiguous = raw => /^[+-]?[1-9]\d{0,2}\.\d{3}$/.test(tidy(raw));
  const parse = (raw, { money = false } = {}) => {
    let text = tidy(raw);
    if (/^[+-]?\d{1,3}(\.\d{3})+,\d*$/.test(text) || /^[+-]?\d{1,3}(\.\d{3}){2,}$/.test(text)) text = text.replace(/\./g, "");
    else if (ambiguous(text)) { if (!money) return null; text = text.replace(".", ""); }
    text = text.replace(",", ".");
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  // Wat er mis is met een getal als tekst, of "" als het een getal is (of leeg).
  const parseProblem = (raw, options) => {
    const text = tidy(raw);
    if (text === "" || parse(text, options) != null) return "";
    if (ambiguous(text)) return `Bedoel je ${text.replace(".", "")} of ${text.replace(".", ",")}? Schrijf duizendtallen zonder punt en decimalen met een komma.`;
    return "Vul een getal in, bijvoorbeeld 3500 of 0,25.";
  };
  // Een getal als beginwaarde van een invoerveld, met een decimale komma zoals de velden vragen.
  const plain = value => value == null || value === "" ? ""
    : typeof value === "number" ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 }).replace(".", ",")
    : String(value).replace(/^([+-]?\d+)\.(\d+)$/, "$1,$2");

  async function api(url, { method = "GET", json, body } = {}) {
    const options = { method };
    if (json !== undefined) { options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(json); }
    else if (body !== undefined) options.body = body;
    // In de browserversie (local.js) beantwoordt een webworker de API in plaats van de server.
    const response = await (Local.enabled ? Local.fetch : fetch)(url, options);
    const data = await response.json().catch(() => ({}));
    // De foutcode van de API (`error`) gaat mee, zodat een scherm een bekende fout bij het juiste veld kan tonen.
    if (!response.ok) throw Object.assign(new Error(data.message || `Verzoek mislukt (${response.status}).`),
      { code: data.error ?? null, status: response.status });
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

  // De meldingenhouder staat vast in index.html (aria-live), zodat een schermlezer elke nieuwe melding voorleest.
  function toast(text, error = false) {
    let host = $("toasts");
    if (!host) { host = h("div", { id: "toasts", class: "toasts", "aria-live": "polite" }); document.body.append(host); }
    const item = h("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : null },
      h("span", {}, text),
      h("button", { type: "button", class: "ghost", "aria-label": "Melding sluiten", onclick: () => item.remove() }, "Sluiten"));
    // Eén melding tegelijk: een nieuwe vervangt de vorige, zodat meldingen zich niet over de inhoud stapelen.
    item.dataset.shown = String(Date.now());
    host.replaceChildren(item);
    if (error) return;
    // Lang genoeg om te lezen (minstens 6 s, ongeveer 3 woorden per seconde erbij), en niet zolang de muis of
    // focus op de melding staat.
    const wait = Math.max(6000, 2000 + item.firstChild.textContent.split(/\s+/).length * 330);
    let timer;
    const start = () => { clearTimeout(timer); timer = setTimeout(() => item.remove(), wait); };
    for (const type of ["mouseenter", "focusin"]) item.addEventListener(type, () => clearTimeout(timer));
    item.addEventListener("mouseleave", () => { if (!item.contains(document.activeElement)) start(); });
    item.addEventListener("focusout", event => { if (!item.contains(event.relatedTarget) && !item.matches(":hover")) start(); });
    start();
  }

  // Voert een actie uit met een uitgeschakelde knop; fouten worden als melding getoond.
  async function busy(button, work) {
    button.disabled = true; button.setAttribute("aria-busy", "true");
    try { return await work(); }
    catch (error) { toast(error.message, true); return undefined; }
    finally { button.disabled = false; button.removeAttribute("aria-busy"); }
  }

  const button = (text, onclick, variant = "primary", props = {}) =>
    h("button", { type: "button", class: variant, onclick, ...props }, text);
  const link = (text, href, cls) => h("a", { href, class: cls }, text);
  // Alleen http(s)-links worden klikbaar; een zelf ingevoerde bron-URL als javascript: blijft tekst.
  const external = (text, href) => /^https?:\/\//i.test(String(href ?? "").trim())
    ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text)
    : h("span", {}, text);
  const badge = (text, tone = "") => h("span", { class: `badge ${tone}` }, text);
  // Een uitklapmenu met knoppen. Na een keuze, met Escape of bij een klik ernaast klapt het weer in.
  function menu(label, items, props = {}) {
    const element = h("details", { class: "menu", ...props }, h("summary", {}, label), h("div", { class: "menu-items" }, items));
    const close = () => { element.open = false; };
    element.addEventListener("click", event => { if (event.target.closest(".menu-items button")) close(); });
    element.addEventListener("keydown", event => {
      if (event.key === "Escape" && element.open) { close(); element.querySelector("summary").focus(); }
    });
    return element;
  }
  globalThis.document?.addEventListener("click", event => {
    for (const open of document.querySelectorAll("details.menu[open]")) if (!open.contains(event.target)) open.open = false;
  });

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
  // Een tekstveld, geen type=number: dat leest ‘3.500’ in een Nederlandse browser als 3,5 of laat de komma
  // vallen. `parse` leest de tekst; `validate` controleert getal, grenzen en stappen met Nederlandse meldingen.
  // Het decimale toetsenbord op een telefoon heeft geen minteken; velden die negatief mogen krijgen er een gewoon.
  // `money`: een bedrag in euro, waarin ‘6.500’ als 6500 telt (zie parse).
  const numberInput = ({ money: euro = false, ...props } = {}) => h("input", { type: "text", step: "any", autocomplete: "off",
    spellcheck: "false", inputmode: props.min != null && Number(props.min) < 0 ? "text" : "decimal", ...props,
    dataset: euro ? { number: "", money: "" } : { number: "" } });
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
  // Meldingen in het Nederlands, ook in een anderstalige browser; een eigen melding gaat voor.
  // Wat er mis is met een getalveld, of "" als het klopt; grenzen en stappen zoals bij type=number.
  function numberProblem(control) {
    const raw = control.value.trim(), // Zonder duizendtalpunt, zoals de meldingen zelf vragen: ‘Vul 2026 of meer in.’
    num = value => Number(value).toLocaleString("nl-NL", { maximumFractionDigits: 6, useGrouping: false });
    const options = { money: "money" in control.dataset }, problem = parseProblem(raw, options);
    if (raw === "" || problem) return problem;
    const value = parse(raw, options);
    if (control.min !== "" && value < Number(control.min)) return `Vul ${num(control.min)} of meer in.`;
    if (control.max !== "" && value > Number(control.max)) return `Vul ${num(control.max)} of minder in.`;
    const step = control.getAttribute("step");
    if (step && step !== "any") {
      const steps = (value - (control.min !== "" ? Number(control.min) : 0)) / Number(step);
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        const decimals = (step.split(".")[1] || "").length;
        if (step === "1") return "Vul een heel getal in.";
        if (Number(step) === 10 ** -decimals) return `Gebruik hoogstens ${decimals} ${decimals === 1 ? "decimaal" : "decimalen"}.`;
        return `Gebruik stappen van ${num(step)}.`;
      }
    }
    return "";
  }
  // Een eigen melding van `reject` blijft staan; alleen de eigen getalmelding wordt bijgewerkt.
  function checkNumber(control) {
    if (!("number" in control.dataset) || (control.validity.customError && control.dataset.numberError !== "1")) return;
    const problem = numberProblem(control);
    control.setCustomValidity(problem);
    control.dataset.numberError = problem ? "1" : "";
  }

  function invalidMessage(control) {
    const v = control.validity, // Zonder duizendtalpunt, zoals de meldingen zelf vragen: ‘Vul 2026 of meer in.’
    num = value => Number(value).toLocaleString("nl-NL", { maximumFractionDigits: 6, useGrouping: false });
    if (v.customError) return control.validationMessage;
    if (v.badInput) return "Vul een getal in.";
    if (v.valueMissing) return control.tagName === "SELECT" || control.type === "radio" ? "Maak een keuze."
      : control.type === "file" ? "Kies een bestand." : control.type === "checkbox" ? "Vink elke bevestiging aan om verder te gaan."
      // Een veld kan zeggen wat je anders kunt doen (data-missing), bijvoorbeeld een indicatie gebruiken.
      : control.dataset.missing || "Vul dit veld in.";
    if (v.rangeUnderflow) return `Vul ${num(control.min)} of meer in.`;
    if (v.rangeOverflow) return `Vul ${num(control.max)} of minder in.`;
    if (v.stepMismatch) {
      const decimals = (control.step.split(".")[1] || "").length;
      if (control.step === "1") return "Vul een heel getal in.";
      if (Number(control.step) === 10 ** -decimals) return `Gebruik hoogstens ${decimals} ${decimals === 1 ? "decimaal" : "decimalen"}.`;
      return `Gebruik stappen van ${num(control.step)}.`;
    }
    return control.validationMessage;
  }

  // De melding staat onder het veld (of onder de groep keuzes) en wordt via aria-describedby voorgelezen.
  function validate(root) {
    let first = null;
    root.querySelectorAll(".error").forEach(error => error.remove());
    for (const control of root.querySelectorAll("input, select, textarea")) {
      checkNumber(control);
      const valid = control.checkValidity();
      control.setAttribute("aria-invalid", String(!valid));
      const described = (control.getAttribute("aria-describedby") || "").split(" ").filter(id => id && !id.startsWith("fout-"));
      if (!valid) {
        first ||= control;
        // Een bestandskeuze in een sleepvak (label.drop) krijgt de melding direct onder het vak, niet erin:
        // dan hoort de melding niet bij de naam van het veld.
        const drop = control.closest(".drop"), holder = drop || control.closest(".field, fieldset");
        let error = drop ? null : holder?.querySelector(":scope > .error");
        // Direct onder het veld, vóór de toelichting: zo staat de melding in beeld bij het veld dat focus krijgt.
        if (holder && !error) { error = h("small", { class: "error", id: uid("fout") }, invalidMessage(control));
          if (drop) drop.after(error);
          else if (control.parentElement === holder) control.after(error); else holder.append(error); }
        if (error) described.push(error.id);
      }
      if (described.length) control.setAttribute("aria-describedby", described.join(" "));
      else control.removeAttribute("aria-describedby");
    }
    // Een ongeldig veld in een ingeklapt blok klapt dat eerst open, anders krijgt het geen focus.
    for (let fold = first?.closest("details:not([open])"); fold; fold = fold.parentElement?.closest("details:not([open])")) fold.open = true;
    first?.focus();
    return !first;
  }
  // Een waarschuwing die meeloopt met de invoer: `check()` geeft een tekst of null; roep `run()` aan na elke wijziging.
  function liveCheck(check, className = "") {
    const element = h("p", { class: `warning live-check ${className}`.trim(), "aria-live": "polite" });
    const run = () => { element.textContent = check() ?? ""; };
    run();
    return { element, run };
  }
  // Een fout die meer velden betreft, bij het veld waar je hem oplost: dezelfde melding en focus als bij
  // één veld. De wizard wist zulke meldingen bij de volgende poging. Zonder veld blijft het een melding.
  function reject(control, message, root) {
    if (!control) { toast(message, true); return false; }
    control.setCustomValidity(message);
    control.addEventListener("input", () => control.setCustomValidity(""), { once: true });
    validate(root);
    return false;
  }

  // Met stack: true wordt elke rij op een smal scherm een kaartje met de kolomkop bij elke waarde (zie styles.css).
  // `numeric`: kolomnummers met bedragen of hoeveelheden; die staan rechts uitgelijnd, op één regel en met
  // even brede cijfers, zodat getallen onder elkaar te vergelijken zijn.
  function table(headers, rows, { caption, className = "", stack = false, numeric = [] } = {}) {
    const num = i => numeric.includes(i) ? "num" : null;
    return h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": caption || headers.join(", ") },
      h("table", { class: [className, stack ? "stack" : ""].filter(Boolean).join(" ") },
        caption ? h("caption", {}, caption) : null,
        h("thead", {}, h("tr", {}, headers.map((text, i) => h("th", { scope: "col", class: num(i) }, text)))),
        h("tbody", {}, rows.map(row => h("tr", {}, row.map((cell, i) =>
          h("td", { class: num(i), dataset: stack ? { label: headers[i] ?? "" } : null }, cell ?? "Onbekend")))))));
  }
  // [label, waarde, korte uitleg]; de uitleg is optioneel en staat klein onder het label.
  const stats = items => h("dl", { class: "stats" },
    items.map(([label, value, help]) => h("div", {}, h("dt", {}, label, help ? h("small", { class: "stat-help" }, help) : null),
      h("dd", {}, value))));
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
    entries.forEach(({ label, content, class: name }, index) => {
      const tab = h("button",
        { type: "button", role: "tab", id: `${id}-tab-${index}`, "aria-controls": `${id}-panel-${index}`,
          class: name, onclick: () => show(index) },
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

  // Wizard: stappen [{ label, render(body) }]; validate(index, body) mag blokkeren. Met action(knop) zet
  // een stap zijn hoofdknop (zoals ‘Bereken’) in de vaste balk onderaan, tot een andere stap verschijnt.
  function wizard(steps, { validate: check = () => true, onShow = () => {}, finish } = {}) {
    const stepper = h("ol", { class: "stepper" }), body = h("div", { class: "wizard-body" });
    // Op een smal scherm vervangt één regel met voortgang de rij stapknoppen (styles.css).
    const compact = h("p", { class: "stepper-compact" }), progress = h("progress", { max: steps.length, "aria-hidden": "true" });
    const previous = button("← Vorige", () => show(current - 1), "secondary");
    // Een stap controleren kan een verzoek zijn (zoals een bestand inlezen); zolang dat loopt, staat de wizard stil.
    // Waarom een stap niet verder kan, staat boven de knoppen in de balk en niet als melding die over Volgende
    // kan vallen; de regel verdwijnt bij een nieuwe poging of een andere stap. Een fout met `shown` staat al bij een veld.
    const problem = h("p", { class: "wizard-problem", role: "alert" });
    const next = button("Volgende →", () => { problem.replaceChildren(); return busyWith("", async () => {
      body.querySelectorAll("input, select, textarea").forEach(control => control.setCustomValidity(""));
      if (await check(current, body)) show(current + 1);
    }).catch(error => { if (!error.shown) problem.textContent = error.message; }); });
    const slot = h("span", { class: "wizard-action" });
    const status = h("p", { class: "wizard-status", role: "status" });
    const footer = h("div", { class: "wizard-footer" }, problem, previous, next, status, slot, finish ?? null);
    let current = 0, reached = 0, shown = null, working = false;
    steps.forEach((step, index) => stepper.append(h("li", {},
      h("button", { type: "button", class: "ghost", onclick: () => index <= reached && show(index) }, `${index + 1}. ${step.label}`))));
    function sync() {
      [...stepper.children].forEach((li, i) => { li.firstChild.disabled = working || i > reached; });
      previous.disabled = working || current === 0; next.disabled = working;
    }
    function show(index) {
      current = Math.max(0, Math.min(steps.length - 1, index)); reached = Math.max(reached, current);
      [...stepper.children].forEach((li, i) => {
        if (i === current) li.firstChild.setAttribute("aria-current", "step"); else li.firstChild.removeAttribute("aria-current");
      });
      compact.replaceChildren(`Stap ${current + 1} van ${steps.length} · ${steps[current].label}`, progress);
      progress.value = current + 1;
      slot.replaceChildren(); problem.replaceChildren(); body.replaceChildren(); steps[current].render(body);
      sync(); next.hidden = current === steps.length - 1;
      onShow(current, body);
      const heading = body.querySelector("h2, h3");
      heading?.setAttribute("tabindex", "-1");
      // Na Volgende of Vorige begint een schermlezer bij de kop van de nieuwe stap.
      if (shown !== null && shown !== current) heading?.focus({ preventScroll: true });
      shown = current;
    }
    // Lang werk, zoals een berekening: stappen en Vorige/Volgende staan stil en de balk onderaan zegt wat er
    // gebeurt, na 3 seconden met de verstreken tijd. Fouten gaan naar de aanroeper.
    async function busyWith(text, work) {
      const started = Date.now(), label = text || "Even geduld…";
      const tick = () => { const seconds = Math.round((Date.now() - started) / 1000);
        status.replaceChildren(label, seconds >= 3 ? h("span", { "aria-hidden": "true" }, ` (${seconds} s)`) : ""); };
      working = true; sync(); body.setAttribute("aria-busy", "true");
      // Snel werk (de meeste stapcontroles) knippert niet met een melding.
      const timer = setInterval(tick, 1000), first = setTimeout(tick, text ? 0 : 600);
      try { return await work(); }
      finally { clearInterval(timer); clearTimeout(first); status.replaceChildren(); working = false; sync(); body.removeAttribute("aria-busy"); }
    }
    const element = h("div", { class: "wizard" }, stepper, compact, body, footer);
    // Na lang werk naar de uitkomst, maar alleen als de wizard nog in beeld is: wie intussen naar een ander scherm
    // ging, krijgt een melding met een link in plaats van teruggetrokken te worden.
    const arrive = (hash, text) => { if (element.isConnected) location.hash = hash;
      else toast([`${text} `, link("Bekijk de uitkomst", hash)]); };
    return { element, show, rerender: () => show(current), action: control => slot.replaceChildren(control),
      busy: busyWith, arrive, get current() { return current; } };
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
  // Bevestiging voor iets wat niet terug te draaien is; `work` draait pas na de rode knop.
  // De focus staat op Annuleren, zodat Enter niets verwijdert.
  function confirm(title, paragraphs, label, work) {
    const cancel = button("Annuleren", () => ref.close(), "secondary");
    const ok = button(label, () => busy(ok, async () => { await work(); ref.close(); }), "danger");
    const ref = dialog(title, paragraphs.map(text => h("p", {}, text)), h("div", { class: "actions" }, ok, cancel));
    cancel.focus();
    return ref;
  }

  // Bouwt het huidige scherm opnieuw op, bijvoorbeeld na het verwijderen van een rij.
  const reload = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

  // Een cel die met =, +, -, @, tab of regeleinde begint, krijgt een apostrof zodat een spreadsheet hem niet als formule
  // leest; een getal in nl-NL-notatie (ook negatief, zoals -1.234,57) blijft een getal.
  const CSV_NUMBER = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
  const csvCell = value => {
    let text = String(value ?? "Onbekend");
    if (/^[=+@\-\t\r]/.test(text) && !CSV_NUMBER.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  function downloadCsv(filename, rows) {
    const blob = new Blob(["﻿" + rows.map(row => row.map(csvCell).join(";")).join("\r\n")],
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
  // `unit` is de eenheid van de waarden: bij liggende balken onder de waardeas rechts, anders linksboven bij de
  // verticale as. `xLabel` benoemt de liggende as van een lijn- of staafgrafiek.
  // Een te lange naam wordt in het midden ingekort: bij ‘aansluiting · product · capaciteit’ blijven het eerste en het
  // laatste deel staan, zodat aansluiting en capaciteit niet wegvallen. De volle naam staat in de tooltip en de tabel.
  function clip(name, max) {
    if (name.length <= max) return name;
    const parts = name.split(" · ");
    if (parts.length >= 3) {
      const head = parts[0], tail = parts[parts.length - 1], room = max - head.length - tail.length - 7;
      if (room >= 4) return `${head} · ${parts.slice(1, -1).join(" · ").slice(0, room).trimEnd()}… · ${tail}`;
    }
    return `${name.slice(0, max - 1)}…`;
  }
  function chart(type, { title, rows, series, unit = "", xLabel = "", format = v => number(v, 0), marks = [] }) {
    // Op een smal scherm een smallere tekening met grotere letters (styles.css), zodat de tekst na het schalen
    // leesbaar blijft; de namen van liggende balken staan dan op een eigen regel boven de balk, voluit.
    const narrow = window.matchMedia?.("(max-width: 640px)").matches === true;
    const width = narrow ? 400 : 880, horizontal = type === "range" || type === "stacked", above = narrow && horizontal;
    const height = horizontal ? Math.max(220, rows.length * (above ? 64 : 56) + 80) : 320;
    const longest = Math.max(0, ...rows.map(r => String(r.label).length));
    const left = above ? 40 : horizontal ? Math.min(380, Math.max(110, Math.min(longest, 56) * 6.6 + 24)) : narrow ? 64 : 80, right = 24,
      top = !horizontal && unit ? 32 : 20, bottom = 50, plotW = width - left - right, plotH = height - top - bottom;
    const maxLabel = above ? Math.floor(plotW / 7.7) : 56;
    const svg = document.createElementNS(SVG, "svg");
    if (narrow) svg.classList.add("narrow");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${title}. De waarden staan ook in de tabel onder de grafiek.`);
    const draw = (tag, attrs, label) => {
      const node = document.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (label) {
        // Alleen een tooltip voor de muis: geen tabstop per punt. De grafiek is één afbeelding (role="img")
        // en de tabel eronder geeft dezelfde waarden voor toetsenbord en schermlezer.
        const tip = document.createElementNS(SVG, "title"); tip.textContent = label; node.append(tip);
      }
      svg.append(node); return node;
    };
    const text = (x, y, value, anchor = "start", tip) => {
      const node = draw("text", { x, y, "text-anchor": anchor, class: "chart-text" }, tip);
      node.insertBefore(document.createTextNode(value), node.firstChild);
    };
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
        const step = Math.max(1, Math.ceil(rows.length / (narrow ? 5 : 10)));
        rows.forEach((r,
          i) => { if (i % step === 0 || i === rows.length - 1) text(px(i), height - 28, r.label, "middle"); });
      }
      // Een markering met een getal `x` staat op de getallenas, ook tussen twee punten.
      for (const mark of marks) {
        const index = rows.findIndex(r => r.label === mark.at);
        const at = numeric && finite(mark.x) ? left + (mark.x - first) / (last - first || 1) * plotW
          : index < 0 ? null : px(index);
        if (at == null) continue;
        draw("line", { x1: at, x2: at, y1: top, y2: height - bottom, class: "chart-mark" }, mark.label);
        text(at, top + 12, mark.symbol, "middle");
      }
    } else {
      rows.forEach((r, ri) => {
        if (horizontal) {
          const cy = top + (ri + 0.5) / rows.length * plotH;
          const name = String(r.label), short = clip(name, maxLabel), tip = short === name ? undefined : name;
          if (above) text(left, cy - 18, short, "start", tip); else text(left - 12, cy + 4, short, "end", tip);
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
              // Ongunstig en gunstig hebben elk een eigen vorm: bij terugverdientijd ligt ongunstig rechts.
              else if (i === 0) draw("rect", { x: x(v) - 5, y: cy - 5, width: 10, height: 10, class: "chart-low" },
                `${r.label}, ${series[i].label}: ${format(v)} ${unit}`);
              else draw("polygon", { points: `${x(v)},${cy - 8} ${x(v) + 7},${cy + 5} ${x(v) - 7},${cy + 5}`, class: "chart-high" },
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
          // Alleen elke zoveelste naam als ze elkaar anders raken (ongeveer 0,6 × de lettergrootte per teken).
          const every = Math.max(1, Math.ceil((longest * (narrow ? 8.4 : 7.2) + 6) / groupW));
          if (ri % every === 0) text(left + (ri + 0.5) * groupW, height - 28, r.label, "middle");
        }
      });
    }
    if (horizontal) text(width - right, height - 6, unit, "end");
    else { text(8, 14, unit); if (xLabel) text(left + plotW / 2, height - 6, xLabel, "middle"); }
    const legend = h("ul", { class: "legend" }, series.map((s, i) => h("li", {},
      type === "range" ? h("span", { class: `swatch ${["swatch-low", "swatch-base", "swatch-high"][i]}` })
        : h("span", { class: "swatch", style: `background:${colour(i, s)}` }), s.label)));
    const data = h("details", {}, h("summary", {}, "Toon als tabel"),
      table(["", ...series.map(s => `${s.label}${unit ? ` (${unit})` : ""}`)], rows.map(r => [r.label, ...r.values.map(v => finite(v) ? format(v) : "Onbekend")]),
        { numeric: series.map((_, i) => i + 1) }));
    return h("figure", { class: "chart" }, h("figcaption", {}, title), svg, legend, data);
  }

  // Schermregistratie; app.js verzorgt navigatie en routering.
  const pages = new Map();
  const page = (key, definition) => pages.set(key, definition);

  return {
    h, append, $, uid, liveCheck, finite, number, money, kwh, pct, years, dateTime, dateOnly, parse, parseProblem, plain, api, store, toast, busy,
    csvCell, clip, button, link, external, badge, menu, field, input, numberInput, select, choice, checkbox, validate, reject, table, stats, empty,
    tabs, wizard, dialog, confirm, reload, downloadCsv, downloadBlob, chart, palette, pages, page
  };
})();
