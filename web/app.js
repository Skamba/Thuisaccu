"use strict";

// Navigatie, routering, ‘Mijn berekeningen’ en instellingen. Laadt als laatste script.
(() => {
  const { h, $, button, link, badge, table, field, numberInput, select, money, toast, store } = UI;
  const ICONS = {
    help: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14 M12 17.5v.5",
    list: "M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
    battery: "M7 4h10v17H7z M10 1h4 M9 12h6 M12 9v6",
    sun: "M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0",
    sliders: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    gear: "M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M12 1.5v3.5 M12 19v3.5 M1.5 12h3.5 M19 12h3.5 M4.6 4.6l2.4 2.4 M17 17l2.4 2.4 M4.6 19.4l2.4-2.4 M17 7l2.4-2.4"
  };
  // Oude adressen uit eerdere versies blijven werken.
  const LEGACY = [[/^dashboard$/, "keuzehulp"], [/^scenarios\/nieuw$/, "zelf"], [/^scenarios\/(\d+)$/, "berekeningen/$1"], [/^scenarios$/, "berekeningen"],
    [/^opwek\/import$/, "energie/import"], [/^opwek\/(\d+)$/, "energie/$1"], [/^opwek$/, "energie"]];
  const icon = name => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      path = document.createElementNS(svg.namespaceURI, "path");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
      path.setAttribute("d", ICONS[name] || ""); svg.append(path); return svg;
  };

  function duplicate(run) {
    const open = () => {
      Scenario.load(run.input.request);
      toast("Kopie geladen. Controleer de invoer en bevestig opnieuw.");
      location.hash = "#/zelf";
    };
    if (!Scenario.hasDraft()) { open(); return; }
    UI.confirm("Concept vervangen?", [
      "Bij Zelf doorrekenen staat nog een concept met accu-opties. Een kopie van deze berekening komt daarvoor in de plaats."
    ], "Vervang het concept", open);
  }

  function remove(run) {
    UI.confirm("Berekening verwijderen?", [
      `‘${run.title}’ van ${UI.dateTime(run.created_at_unix_s)} wordt met de vastgelegde invoer en uitkomst verwijderd. ` +
        "Dit kan niet ongedaan worden gemaakt. Het energieprofiel blijft staan.",
      "Gedeelde links naar deze berekening blijven werken; die bevatten de uitkomst zelf."
    ], "Verwijder berekening", async () => {
      await UI.api(`/api/v1/analysis/runs/${run.id}`, { method: "DELETE" });
      toast("Berekening verwijderd.");
      UI.reload();
    });
  }

  UI.page("berekeningen", {
    nav: "Mijn berekeningen", icon: "list", title: "Mijn berekeningen",
      subtitle: "Bewaarde uitkomsten, elk met de oorspronkelijke invoer.",
    async render(view, actions) {
      actions.append(link("Nieuwe keuzehulp", "#/keuzehulp", "button"));
      const runs = await Data.runs();
      if (!runs.length) { view.append(UI.empty("Nog geen berekeningen",
        "Doorloop de keuzehulp; je uitkomst wordt hier bewaard.", link("Start de keuzehulp", "#/keuzehulp", "button")));
        return; }
      // Twee tot vier berekeningen kiezen om naast elkaar te zetten.
      const chosen = new Set(), boxes = [], status = h("p", { class: "help", "aria-live": "polite" });
      const compare = button("Vergelijk", () => { location.hash = `#/vergelijk/${[...chosen].join("-")}`; }, "secondary");
      const refresh = () => {
        compare.disabled = chosen.size < 2;
        status.textContent = chosen.size < 2 ? `Kies 2 tot ${Compare.MAX} berekeningen om ze naast elkaar te zetten.`
          : `${chosen.size} gekozen${chosen.size === Compare.MAX ? `; meer dan ${Compare.MAX} past niet naast elkaar` : ""}.`;
        for (const box of boxes) box.disabled = !box.checked && chosen.size >= Compare.MAX;
      };
      UI.append(view, [backupHint(runs.length), h("div", { class: "toolbar" }, compare, status)]);
      view.append(table(["Vergelijk", "Berekening", "Datum", "Doel", "Beste keuze", "Netto voordeel", ""], runs.map(run => {
        const rec = run.result.candidates.find(c => c.key === run.result.recommended_key);
        const when = UI.dateTime(run.created_at_unix_s), p = run.input.request.parameters;
        // Berekeningen hebben vaak dezelfde titel; deze kenmerken maken ze uit elkaar te houden.
        const options = run.result.candidates.filter(c => c.key !== "no_battery").length;
        const facts = [`${options} ${options === 1 ? "accu" : "accu’s"}`, p.horizon_years ? `${p.horizon_years} jaar` : null,
          p.budget_eur != null ? `budget ${money(p.budget_eur, { decimals: 0 })}` : null,
          p.tariff?.import_eur_per_kwh != null ? `stroom ${UI.number(p.tariff.import_eur_per_kwh, 2)} €/kWh` : null]
          .filter(Boolean).join(" · ");
        const box = h("input", { type: "checkbox", class: "pick", "aria-label": `Vergelijk ${run.title} van ${when}`,
          onchange: () => { if (box.checked) chosen.add(run.id); else chosen.delete(run.id); refresh(); } });
        boxes.push(box);
        return [h("label", { class: "pick-label", title: "Kies om te vergelijken" }, box),
          h("span", {}, h("a", { href: `#/berekeningen/${run.id}`, "aria-label": `${run.title} van ${when}` }, run.title),
            Results.isFictitious(run) ? [" ", badge("FICTIEF", "demo")] : null, h("small", { class: "help run-facts" }, facts)), when,
          Data.objectives[run.input.request.parameters.objective],
            rec?.name || (run.result.recommended_key === "no_battery" ? "Geen accu" : "Onbekend"),
          money(rec ? rec.npv_eur : 0, { decimals: 0 }), h("span", { class: "row-buttons" }, button("Pas aan", event => UI.busy(event.currentTarget, async () => duplicate(await Data.run(run.id))), "ghost",
            { "aria-label": `Pas ${run.title} van ${when} aan` }),
            button("Verwijder", () => remove(run), "ghost remove", { "aria-label": `Verwijder ${run.title} van ${when}` }))];
      }), { caption: "Laatste 100 berekeningen", stack: true }));
      refresh();
    }
  });

  UI.page("berekeningen/:id", {
    title: "Uitkomst", subtitle: "Vergelijking met geen accu, binnen de vastgelegde aannames.", parent: "berekeningen",
    async render(view, actions, { id }) {
      let run;
      try { run = await Data.run(id); }
      catch (error) { view.append(UI.empty("Berekening niet gevonden", error.message,
        link("Naar mijn berekeningen", "#/berekeningen", "button")));
        return; }
      $("page-title").textContent = run.title;
      await Results.render(run, view, actions, duplicate);
    }
  });

  UI.page("gedeeld/:data", {
    title: "Gedeelde berekening", subtitle: "Geopend uit een link; niet bewaard in deze app.", parent: "berekeningen",
    async render(view, actions, { data }) {
      let run;
      try { run = await Results.fromShare(data); }
      catch (error) { view.append(UI.empty("Deze link werkt niet", error.message,
        link("Naar mijn berekeningen", "#/berekeningen", "button"))); return; }
      $("page-title").textContent = run.title;
      await Results.render(run, view, actions, null, { shared: true });
      // Wie een link krijgt, kan meteen de eigen situatie doorrekenen.
      actions.prepend(link("Reken je eigen situatie door", "#/keuzehulp", "button"));
    }
  });

  UI.page("instellingen", {
    nav: "Instellingen", icon: "gear", title: "Instellingen",
      subtitle: "Voorkeuren en standaardaannames voor deze browser.",
    render(view) {
      const labels = { start_year: "Startjaar", horizon_years: "Looptijd (jaren)",
        discount_pct: "Discontovoet per jaar (%)", annual_cost_escalation_pct: "Stijging extra jaarkosten (%)",
        annual_pv_loss_pct: "Afname PV-opwek per jaar (%)", annual_load_growth_pct: "Verandering verbruik per jaar (%)",
        annual_price_change_pct: "Prijsverandering energie per jaar (%)",
        price_uncertainty_pct: "Onzekerheid tarieven (± %)",
        cost_uncertainty_pct: "Onzekerheid kosten (± %)" };
      const help = Data.ASSUMPTION_HELP;
      // Dezelfde grenzen als bij Zelf doorrekenen, zodat een standaardwaarde daar altijd geldig is.
      const ranges = { annual_price_change_pct: ["-20", "30", "0.1"],
        ...Object.fromEntries(Scenario.PARAMS.map(([key, , min, max, step]) => [key, [min, max, step]])) };
      const current = Data.defaults(),
        controls = Object.fromEntries(Object.keys(labels).map(key => {
          const [min, max, step = "any"] = ranges[key];
          return [key, numberInput({ value: UI.plain(current[key]), required: true, min, max, step })];
        }));
      const form = h("form", { class: "panel", novalidate: true, onsubmit: event => {
        event.preventDefault();
        if (!UI.validate(form)) return;
        const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key,
          UI.parse(control.value)]));
        const saved = store.set("thuisaccu-standaard", values);
        toast(saved ? "Standaardaannames bewaard voor nieuwe berekeningen." : "Bewaren in deze browser is niet beschikbaar.",
          !saved);
      } }, h("h2", {}, "Standaardaannames"), h("p", { class: "help" }, "Gelden voor nieuwe berekeningen in de keuzehulp en bij Zelf doorrekenen. Bewaarde berekeningen veranderen nooit."),
        h("div", { class: "grid" }, Object.entries(labels).map(([key, label]) => field(label, controls[key], help[key]))),
        h("div", { class: "actions" }, h("button", { type: "submit", class: "primary" }, "Bewaar"),
          button("Herstel oorspronkelijke waarden", () => { store.set("thuisaccu-standaard", null); for (const [key, control] of Object.entries(controls)) control.value = UI.plain(Data.DEFAULTS[key]);
            UI.validate(form); toast("Oorspronkelijke waarden hersteld."); }, "ghost")));
      const preference = (key, label, options) => field(label,
        select(options, store.get(`thuisaccu-${key}`, options[0][0]),
          { onchange: event => { document.documentElement.dataset[key] = event.target.value;
            store.set(`thuisaccu-${key}`, event.target.value); } }));
      view.append(form,
        h("section", { class: "panel" }, h("h2", {}, "Weergave"), h("div", { class: "grid" },
          preference("theme", "Thema", [["system", "Volg het systeem"], ["light", "Licht"], ["dark", "Donker"]]),
          preference("density", "Dichtheid", [["comfortable", "Ruim"], ["compact", "Compact"]]))),
        dataPanel(),
        h("section", { class: "panel" }, h("h2", {}, "Over het model"),
          h("p", {},
            "Het model rekent per meetperiode hoeveel zonnestroom een accu opslaat en later zelf gebruikt, met vaste tarieven. Vanaf 2027 zonder salderen. Dynamische handel, netladen en onbalansinkomsten zijn niet opgenomen."),
          h("p", {}, "Een aanbeveling geldt alleen voor de doorgerekende opties en vastgelegde aannames; ‘geen accu’ is een volwaardige uitkomst. De app beoordeelt geen installatiegeschiktheid of elektrische veiligheid.")));
    }
  });

  // Waar de gegevens staan verschilt per manier van draaien (zie local.js).
  // Back-up van de browserdatabase; het moment staat in deze browser, zodat Mijn berekeningen er alleen
  // aan herinnert als er lang geen back-up is gemaakt.
  const BACKUP_KEY = "thuisaccu-laatste-backup", BACKUP_DAYS = 14;
  const backupButton = (after = () => {}) => button("Download back-up", async () => {
    try { UI.downloadBlob(`thuisaccu-${new Date().toISOString().slice(0, 10)}.sqlite3`, await Local.backup());
      store.set(BACKUP_KEY, Date.now()); after(); }
    catch (error) { toast(`Back-up maken mislukt: ${error.message}`, true); }
  }, "secondary");
  // Vanaf drie bewaarde berekeningen in de browserversie, zolang er geen recente back-up is.
  function backupHint(count) {
    if (!Local.enabled || count < 3 || Date.now() - store.get(BACKUP_KEY, 0) < BACKUP_DAYS * 864e5) return null;
    const hint = h("div", { class: "callout backup-hint", role: "note" }, h("p", {},
      `Je ${count} berekeningen staan alleen in deze browser. Ruimt de browser zijn gegevens op, dan zijn ze weg. ` +
      "Een back-up is één bestand dat je later onder Instellingen terugzet."), backupButton(() => hint.remove()));
    return hint;
  }

  function dataPanel() {
    const clear = button("Wis concepten in deze browser", () => UI.confirm("Concepten wissen?", [
      "Je antwoorden in de keuzehulp, het concept bij Zelf doorrekenen en de accu’s die je wilde vergelijken worden gewist. " +
        "Bewaarde berekeningen, energieprofielen en de catalogus blijven staan."
    ], "Wis concepten", () => {
      for (const key of ["thuisaccu-keuzehulp", "thuisaccu-scenario", "thuisaccu-vergelijking"]) store.set(key, null);
      toast("Concepten gewist.");
    }), "secondary");
    // Bij de lokale app maakt de server de kopie, ook terwijl hij draait; een gewone downloadlink.
    if (!Local.enabled) return h("section", { class: "panel" }, h("h2", {}, "Je gegevens"),
      h("p", {},
        "Alles wat je bewaart, staat in een databasebestand op deze computer (standaard data/research.sqlite3). " +
        "‘Download back-up’ maakt daar een volledige kopie van, ook terwijl de app draait. Gebruik die knop en kopieer het bestand " +
        "niet zelf: wat de app nog niet heeft weggeschreven, staat in research.sqlite3-wal. Terugzetten: stop de app, verwijder " +
        "research.sqlite3-wal en research.sqlite3-shm als die er staan (anders zet SQLite oude wijzigingen terug over de back-up heen), " +
        "en vervang research.sqlite3 door de back-up. De browserversie kan de back-up ook inlezen."),
      h("div", { class: "actions" }, h("a", { href: "api/v1/backup", download: "", class: "button secondary" }, "Download back-up")),
      h("p", {},
        "Er gaat niets naar internet, behalve een adres dat je zelf opzoekt met ‘Zoek adres via PDOK’. Concepten van de keuzehulp en Zelf doorrekenen staan alleen in deze browser."),
      clear);

    const status = h("p", { class: "help", "aria-live": "polite" }, "Opslagstatus controleren…");
    const showPersisted = granted => { status.textContent = granted
      ? "Deze browser bewaart de gegevens blijvend en ruimt ze niet vanzelf op."
      : "De browser mag deze gegevens opruimen als de schijf vol raakt. Vraag om blijvende opslag, en maak af en toe een back-up."; };
    Local.persisted().then(showPersisted, () => { status.textContent = "Opslagstatus is niet beschikbaar in deze browser."; });
    const persist = button("Vraag om blijvende opslag", async () => {
      const granted = await Local.persist().catch(() => false);
      showPersisted(granted);
      if (!granted) toast("De browser heeft blijvende opslag niet toegestaan. Een back-up blijft verstandig.", true);
    }, "secondary");

    const download = backupButton();

    // Formulierstatus in een object; de knop werkt pas met een gekozen bestand.
    const state = { file: null };
    const replace = button("Vervang de gegevens in deze browser", () => {
      if (!state.file) return;
      UI.confirm("Alle gegevens vervangen?", [
        `Alles in deze browser wordt vervangen door ‘${state.file.name}’: energieprofielen, berekeningen en zelf toegevoegde accu’s.`,
        "Twijfel je? Download dan eerst een back-up van wat er nu staat."
      ], "Vervang alles", async () => {
        try { await Local.restore(state.file); toast("Back-up teruggezet."); setTimeout(() => location.reload(), 600); }
        catch (error) { toast(`Terugzetten mislukt; je huidige gegevens zijn ongewijzigd. ${error.message}`, true); }
      });
    }, "ghost");
    replace.disabled = true;
    const chooser = h("input", { type: "file", accept: ".sqlite3,.sqlite,.db,application/vnd.sqlite3,application/x-sqlite3",
      onchange: event => { state.file = event.target.files[0] || null; replace.disabled = !state.file; } });

    return h("section", { class: "panel" }, h("h2", {}, "Gegevens in deze browser"),
      h("p", {},
        "Alles wat je bewaart, staat in deze browser op dit apparaat. Een andere browser of een ander apparaat ziet het niet, en wie de sitegegevens van deze browser wist, wist ook je berekeningen."),
      h("p", {},
        "Het rekenen gebeurt in je browser. Er gaat niets naar internet, behalve een adres dat je zelf opzoekt met ‘Zoek adres via PDOK’; dat gaat rechtstreeks van je browser naar PDOK."),
      status, h("div", { class: "actions" }, persist, download),
      h("h3", {}, "Back-up terugzetten"),
      h("p", { class: "help" },
        "Kies een back-up van deze site, of een back-up uit de lokale app (‘Download back-up’ onder Instellingen daar). Alle gegevens in deze browser worden vervangen."),
      field("Back-upbestand", chooser),
      h("div", { class: "actions" }, replace, clear));
  }

  // Router: #/pad, #/pad/:id (getal) of #/pad/:data (base64url). Onbekende adressen gaan naar de keuzehulp.
  function match(path) {
    for (const [key, page] of UI.pages) {
      const name = key.match(/:(\w+)/)?.[1];
      const pattern = new RegExp(`^${key.replace(":id", "(\\d+)").replace(":data", "([A-Za-z0-9_-]+)")}$`),
        found = path.match(pattern);
      if (found) return { key, page, params: found[1] ? { [name]: found[1] } : {} };
    }
    return null;
  }
  let generation = 0;
  async function route() {
    let path = location.hash.replace(/^#\/?/, "").replace(/\/$/, "");
    for (const [pattern,
      target] of LEGACY) if (pattern.test(path)) { location.replace(`#/${path.replace(pattern, target)}`);
      return; }
    if (!path) { location.replace("#/keuzehulp"); return; }
    const found = match(path);
    if (!found) { location.replace("#/keuzehulp"); return; }
    // Een dialoog of foutmelding hoort bij het vorige scherm, ook na Terug of een link.
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    // Een bevestiging vlak vóór het wisselen (zoals ‘Opgeslagen’) blijft staan; oudere meldingen niet.
    document.querySelectorAll("#toasts .toast").forEach(t => {
      if (t.classList.contains("error") || Date.now() - Number(t.dataset.shown) > 1500) t.remove(); });
    const run = ++generation, section = found.page.parent || found.key;
    document.querySelectorAll("#nav a").forEach(a => { if (a.dataset.page === section) a.setAttribute("aria-current",
      "page");
      else a.removeAttribute("aria-current"); });
    document.body.classList.remove("menu-open"); $("menu").setAttribute("aria-expanded", "false");
    $("page-title").textContent = found.page.title; $("page-subtitle").textContent = found.page.subtitle || "";
    document.title = `${found.page.title} · Thuisaccu`;
    // Elk scherm krijgt verse elementen: een trager vorig scherm schrijft daarna in losgekoppelde elementen.
    const [view, actions] = ["view", "page-actions"].map(id => { const old = $(id), fresh = old.cloneNode(false);
      old.replaceWith(fresh); return fresh; });
    try { await found.page.render(view, actions, found.params); }
    catch (error) { if (run === generation) view.replaceChildren(h("p", { class: "warning" },
      `Dit scherm kon niet worden geladen: ${error.message}`)); }
    if (run === generation) { $("page-title").focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }

  function start() {
    for (const key of ["theme", "density"]) document.documentElement.dataset[key] = store.get(`thuisaccu-${key}`,
      key === "theme" ? "system" : "comfortable");
    const nav = $("nav");
    for (const [key, page] of UI.pages) {
      if (!page.nav) continue;
      nav.append(h("a", { href: `#/${key}`, dataset: { page: key } }, icon(page.icon), h("span", {}, page.nav)));
    }
    $("menu").addEventListener("click",
      () => { const open = document.body.classList.toggle("menu-open");
        $("menu").setAttribute("aria-expanded", String(open)); });
    document.querySelector(".skip").addEventListener("click",
      event => { event.preventDefault(); $("page-title").focus(); });
    window.addEventListener("hashchange", route);
    // Ingeklapte uitleg (.fold) hoort op papier; een gesloten <details> toont in de print alleen de kop.
    window.addEventListener("beforeprint", () => document.querySelectorAll("details.fold:not([open])")
      .forEach(fold => { fold.open = true; fold.dataset.printOpened = ""; }));
    window.addEventListener("afterprint", () => document.querySelectorAll("details[data-print-opened]")
      .forEach(fold => { fold.open = false; delete fold.dataset.printOpened; }));
    const service = $("service");
    if (Local.enabled) $("footer").replaceChildren(
      "Thuisaccu rekent volledig in je browser; je gegevens blijven in deze browser op dit apparaat.");
    UI.api("/api/v1/health").then(() => {
      service.textContent = Local.enabled ? "Rekent in deze browser" : "Lokale service actief";
      service.classList.add("online"); })
      .catch(error => { service.textContent = Local.enabled ? "Rekenmodule niet geladen" : "Service niet bereikbaar";
        service.classList.add("offline");
        if (Local.enabled) toast(error.message, true); });
    route();
  }
  // Volgorde in de navigatie: keuzehulp eerst, daarna resultaten, gegevens en instellingen.
  const ORDER = ["keuzehulp", "berekeningen", "accus", "energie", "zelf", "instellingen"];
  const sorted = [...UI.pages].sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  UI.pages.clear(); sorted.forEach(([key, page]) => UI.pages.set(key, page));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
