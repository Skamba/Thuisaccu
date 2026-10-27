"use strict";

// Twee tot vier bewaarde berekeningen naast elkaar: uitkomst, kosten, besparing en wat er aan de
// invoer anders is, met de begrippen in gewone taal eronder. Leest alleen de vastgelegde invoer en
// uitkomst, net als Results; er wordt niets opnieuw berekend.
window.Compare = (() => {
  const { h, link, badge, button, money, kwh, pct, years } = UI;
  const eur0 = value => money(value, { decimals: 0 });
  const MAX = 4;
  const age = run => Data.monthsBetween(new Date(run.created_at_unix_s * 1000), new Date());

  // De invoer in woorden, als [label, tekst]. ‘Wat is anders’ toont per berekening wat bij een andere
  // berekening onder hetzelfde label anders is; een accu vergelijk je zo met de accu met dezelfde naam.
  const ASSUMPTIONS = [["annual_cost_escalation_pct", "stijging extra jaarkosten"], ["annual_pv_loss_pct", "afname zonnestroom per jaar"],
    ["annual_load_growth_pct", "verandering verbruik per jaar"], ["price_uncertainty_pct", "tariefvariatie in de gevoeligheid"],
    ["cost_uncertainty_pct", "kostenvariatie in de gevoeligheid"]];
  function candidate(c) {
    const field = key => Data.quoteUnit(key, Data.quoteValue(c, key)), loan = c.financing || {};
    const yearly = c.costs.filter(l => l.timing === "annual" && l.status === "priced").reduce((sum, l) => sum + l.amount_minor, 0) / 100;
    const later = c.costs.filter(l => l.timing === "event" && l.status === "priced").map(l => `${eur0(l.amount_minor / 100)} in jaar ${l.year}`);
    return [`${field("usable_capacity_kwh")} bruikbaar, laden ${field("charge_power_kw")}, ontladen ${field("discharge_power_kw")}`,
      `rendement ${field("ac_round_trip_efficiency_pct")}, sluimer ${field("standby_w")}, verlies ${field("annual_capacity_loss_pct")} per jaar, levensduur ${field("operating_life_years")}`,
      `startkosten ${field("upfront_eur")} vóór teruggaven, jaarlijks ${eur0(yearly)}` + (later.length ? `, later ${later.join(" en ")}` : ""),
      loan.loan_amount_eur > 0 ? `lening ${eur0(loan.loan_amount_eur)} tegen ${pct(loan.annual_interest_pct)} in ${loan.years} jaar` : "geen lening"
    ].join("; ");
  }
  function facts(run) {
    const request = run.input.request, p = request.parameters, t = p.tariff, price = v => money(v, { decimals: 4 });
    const variant = p.export_variant;
    return [
      ["profiel", run.input.profile?.filename || `profiel ${request.solar_import_id}`],
      ["doel", Data.objectives[p.objective]],
      ["looptijd", `${p.horizon_years} jaar vanaf ${p.start_year}`],
      ["stroomprijs", `${price(t.import_eur_per_kwh)} per kWh`],
      ["teruglevering", `vergoeding ${price(t.export_eur_per_kwh)}, kosten ${price(t.export_fee_eur_per_kwh)} per kWh` +
        ((t.export_fee_bands || []).length ? ", met staffel naar hoeveelheid" : "")],
      ["vaste kosten per jaar", eur0(t.fixed_annual_eur ?? 0)],
      ["prijsverandering", `${pct(t.annual_price_change_pct)} per jaar`],
      ["discontovoet", pct(p.discount_pct)],
      ...ASSUMPTIONS.map(([key, label]) => [label, pct(p[key])]),
      ["budget", p.budget_eur == null ? "geen" : eur0(p.budget_eur)],
      ["terugleveringsvariant", variant ? `${variant.label} (vanaf ${variant.from_calendar_year}: vergoeding ${price(variant.export_eur_per_kwh)}, ` +
        `kosten ${price(variant.export_fee_eur_per_kwh)} per kWh)` : "geen"],
      ["extra verbruik", (request.load_changes || []).map(c => `${c.kind === "ev" ? "elektrische auto" : "warmtepomp"} vanaf ` +
        `${c.from_calendar_year} (${kwh(c.annual_kwh)} per jaar)`).join(", ") || "geen"],
      ...request.candidates.map(c => [c.name, candidate(c)])
    ];
  }
  // De accu's als aantal per aansluiting, met de namen die niet in elke andere berekening staan. Een volledige
  // lijst van tientallen uitvoeringen maakt de cel onleesbaar; meer dan drie namen staan ingeklapt.
  const CONNECTION = { plug: "stekker", fixed: "vast", circuit: "stekker op eigen groep" };
  function batteries(run, all) {
    const names = r => new Set(r.input.request.candidates.map(c => c.name));
    const mine = names(run), others = all.filter(r => r !== run).map(names);
    if (others.every(set => set.size === mine.size && [...mine].every(name => set.has(name)))) return null;
    const candidates = run.input.request.candidates, counts = new Map();
    for (const c of candidates) if (CONNECTION[c.connection]) counts.set(CONNECTION[c.connection], (counts.get(CONNECTION[c.connection]) ?? 0) + 1);
    const only = [...mine].filter(name => others.some(set => !set.has(name)));
    const head = `accu’s: ${candidates.length}` + (counts.size ? ` (${[...counts].map(([label, count]) => `${count} ${label}`).join(", ")})` : "");
    if (!only.length) return `${head}; een andere berekening heeft er meer`;
    const label = `${head}; niet in elke andere berekening: `;
    return only.length <= 3 ? label + only.join(", ")
      : [label, h("details", { class: "fold" }, h("summary", {}, `${only.length} accu’s`), h("ul", { class: "compact" }, only.map(name => h("li", {}, name))))];
  }
  function differences(run, all) {
    const others = all.filter(r => r !== run).map(r => new Map(facts(r)));
    const lines = facts(run).filter(([label, text]) => others.some(o => o.has(label) && o.get(label) !== text))
      .map(([label, text]) => `${label}: ${text}`);
    // Een geschat profiel met dezelfde naam kan toch anders zijn (bij oudere runs stond het laadmoment er niet in).
    const sha = run.input.profile_sha256, name = run.input.profile?.filename;
    if (sha && !lines.some(line => line.startsWith("profiel: ")) &&
      all.some(r => r !== run && r.input.profile?.filename === name && r.input.profile_sha256 && r.input.profile_sha256 !== sha))
      lines.unshift("ander energieprofiel met dezelfde naam");
    const battery = batteries(run, all);
    if (battery) lines.push(battery);
    const quote = run.input.request.quote_basis;
    if (quote) lines.unshift(`offerte: ${quote.changes.map(Data.quoteChange).join("; ")}` + (quote.price
      ? `; ${{ fixed: "vaste prijs", subject_to_survey: "onder voorbehoud van schouw", unknown: "niet bekend of de prijs vast is" }[quote.price.terms]}`
      : ""));
    return lines.length ? h("ul", { class: "compact" }, lines.map(line => h("li", {}, line))) : "Dezelfde invoer als de andere";
  }
  // Verschillen die de uitkomsten zelf onvergelijkbaar maken; die staan boven de tabel.
  function caveats(runs) {
    const distinct = pick => new Set(runs.map(pick)).size > 1, p = run => run.input.request.parameters;
    return [
      distinct(run => `${p(run).horizon_years}/${p(run).start_year}`) &&
        "De looptijd of het startjaar verschilt. Netto voordeel en ‘Lonend tot’ tellen dan over een andere periode.",
      distinct(run => p(run).discount_pct) && "De discontovoet verschilt. Het netto voordeel weegt latere jaren dan anders mee.",
      distinct(run => run.input.profile_sha256 || run.input.request.solar_import_id) &&
        "Niet elke berekening gebruikt hetzelfde energieprofiel."
    ].filter(Boolean);
  }

  // [rij, toelichting, waarde per berekening]
  const ROWS = [
    ["Uitkomst", null, (run, rec) => rec ? `Advies: ${rec.name}` : "Geen accu komt het beste uit"],
    ["Besproken accu", "Uit je offerte als de berekening daaruit komt, anders de aanbevolen", (run, rec, c) => c
      ? `${c.name}${c === Results.quoted(run) ? " (je offerte)" : rec ? "" : " (komt het dichtst in de buurt)"}` : "Geen doorgerekend"],
    ["Startinvestering", "Na teruggaven en subsidie", (run, rec, c) => c && eur0(c.initial_investment_eur)],
    ["Besparing in jaar 1", "Op de energierekening", (run, rec, c) => c?.years?.[0] && eur0(c.years[0].energy_saving_eur)],
    ["Lonend tot", "Hoogste startinvestering die nog uit kan", (run, rec, c) => c && (Results.breakEven(c.break_even_investment_eur) ?? "Niet berekend")],
    ["Netto voordeel (NPV)", "Wat de accu over de looptijd oplevert min wat hij kost, in geld van nu",
      (run, rec, c) => c && eur0(c.npv_eur)],
    ["Terugverdiend na", null, (run, rec, c) => c && years(c.payback_years)],
    // Alleen als minstens één berekening een terugleveringsvariant heeft; zie render. Een accu wordt daarin meestal meer
    // waard, dus het woord ‘stresstest’ (een slechter geval) staat er niet.
    ["Netto voordeel als teruglevering minder oplevert", "In de terugleveringsvariant van de berekening; zelf opslaan wordt dan meer waard", (run, rec, c) =>
      !run.input.request.parameters.export_variant ? "Geen variant" : c?.export_variant && eur0(c.export_variant.npv_eur)],
    // Alleen als minstens één besproken accu een garantiestresstest heeft.
    ["Lonend tot als hij stopt na de garantie", "Kortere levensduur en sneller capaciteitsverlies", (run, rec, c) => {
      const w = Results.warranty(run, c);
      return !c ? null : w ? `${Results.breakEven(w.result.break_even_investment_eur) ?? "Niet berekend"} (${w.operating_life_years} jaar)`
        : "Niet doorgerekend";
    }]
  ];

  function render(view, runs) {
    const columns = runs.map(run => {
      const rec = run.result.candidates.find(c => c.key === run.result.recommended_key);
      return { run, rec, option: Results.quoted(run) ?? Results.judged(run) };
    });
    const head = h("tr", {}, h("td", {}), columns.map(({ run }) => h("th", { scope: "col" },
      link(run.title, `#/berekeningen/${run.id}`), h("br"), h("small", {}, UI.dateTime(run.created_at_unix_s),
        age(run) >= 3 ? ` · ${age(run)} maanden oud, prijzen van toen` : ""),
      Results.isFictitious(run) ? [" ", badge("FICTIEF", "demo")] : null,
      Results.outdated(run) ? h("div", { class: "callout" },
        h("p", {}, "Gemaakt met een ouder rekenmodel. Reken opnieuw om eerlijk te vergelijken" +
          (Data.unaffectedByModel(run)
            ? "; de verbeteringen sindsdien raken deze berekening niet." : ".")),
        // De nieuwe berekening neemt de plaats van de oude in; de andere kolommen blijven staan.
        Results.recalculation(run, id => { location.hash = `#/vergelijk/${runs.map(r => r === run ? id : r.id).join("-")}`; }))
        : null)));
    const stress = runs.some(run => run.input.request.parameters.export_variant);
    const guarantee = columns.some(({ run, option }) => Results.warranty(run, option));
    const body = ROWS.filter(([label]) => (stress || label !== "Netto voordeel als teruglevering minder oplevert") &&
      (guarantee || label !== "Lonend tot als hij stopt na de garantie")).map(([label, hint, value]) => {
      const cells = columns.map(({ run, rec, option }) => value(run, rec, option) ?? "—");
      const same = cells.length > 1 && cells.every(cell => typeof cell === "string" && cell === cells[0]);
      return h("tr", { class: same ? "same" : null },
        h("th", { scope: "row" }, label, hint ? [h("br"), h("small", {}, hint)] : null,
          same ? [h("br"), h("small", {}, "Gelijk in alle berekeningen")] : null),
        cells.map(cell => h("td", {}, cell)));
    });
    body.push(h("tr", {}, h("th", { scope: "row" }, "Wat is anders"),
      columns.map(({ run }) => h("td", {}, differences(run, runs)))));
    const warnings = caveats(runs);
    if (warnings.length) view.append(h("div", { class: "callout", role: "note" }, h("p", {}, h("strong", {}, "Let op bij vergelijken")),
      h("ul", { class: "compact" }, warnings.map(text => h("li", {}, text)))));
    UI.append(view, [
      runs.length > 2 ? h("p", { class: "compare-hint" }, "Schuif de tabel opzij voor de andere berekeningen.") : null,
      h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Berekeningen naast elkaar" },
        h("table", { class: "compare", style: `--cols:${runs.length}` }, h("caption", {}, `${runs.length} berekeningen naast elkaar`),
          h("thead", {}, head), h("tbody", {}, body))),
      h("p", { class: "help" }, "Elke kolom gebruikt de invoer en het rekenmodel van die berekening. Bij geen aanbevolen accu staat " +
        "de accu met het hoogste netto voordeel erbij."),
      // Ingeklapt, zoals op de uitkomstpagina: de vergelijking zelf staat voorop.
      h("details", { class: "fold" }, h("summary", {}, "Wat betekenen deze woorden?"),
        h("dl", { class: "glossary" }, Data.GLOSSARY.map(([term, text]) => [h("dt", {}, term), h("dd", {}, text)])))]);
  }

  UI.page("vergelijk/:data", {
    title: "Berekeningen vergelijken", subtitle: "Bewaarde uitkomsten naast elkaar, elk met de eigen invoer.", parent: "berekeningen",
    async render(view, actions, { data }) {
      const ids = [...new Set(data.split("-").map(Number).filter(Number.isInteger))].slice(0, MAX);
      const runs = (await Promise.all(ids.map(id => Data.run(id).catch(() => null)))).filter(Boolean);
      if (runs.length < 2) {
        view.append(UI.empty("Te weinig berekeningen", "Kies onder Mijn berekeningen 2 tot 4 bewaarde berekeningen om te vergelijken.",
          link("Naar mijn berekeningen", "#/berekeningen", "button")));
        return;
      }
      actions.append(button("Afdrukken", () => window.print(), "secondary"));
      render(view, runs);
    }
  });

  return { MAX };
})();
