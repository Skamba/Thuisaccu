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
      ["stresstest", variant ? `${variant.label} (vanaf ${variant.from_calendar_year}: vergoeding ${price(variant.export_eur_per_kwh)}, ` +
        `kosten ${price(variant.export_fee_eur_per_kwh)} per kWh)` : "geen"],
      ["extra verbruik", (request.load_changes || []).map(c => `${c.kind === "ev" ? "elektrische auto" : "warmtepomp"} vanaf ` +
        `${c.from_calendar_year} (${kwh(c.annual_kwh)} per jaar)`).join(", ") || "geen"],
      ["accu’s", request.candidates.map(c => c.name).join(", ")],
      ...request.candidates.map(c => [c.name, candidate(c)])
    ];
  }
  function differences(run, all) {
    const others = all.filter(r => r !== run).map(r => new Map(facts(r)));
    const lines = facts(run).filter(([label, text]) => others.some(o => o.has(label) && o.get(label) !== text))
      .map(([label, text]) => `${label}: ${text}`);
    const quote = run.input.request.quote_basis;
    if (quote) lines.unshift(`offerte: ${quote.changes.map(Data.quoteChange).join("; ")}` + (quote.price
      ? `; ${{ fixed: "vaste prijs", subject_to_survey: "onder voorbehoud van schouw", unknown: "niet bekend of de prijs vast is" }[quote.price.terms]}`
      : ""));
    return lines.length ? h("ul", { class: "compact" }, lines.map(text => h("li", {}, text))) : "Dezelfde invoer als de andere";
  }
  // Verschillen die de uitkomsten zelf onvergelijkbaar maken; die staan boven de tabel.
  function caveats(runs) {
    const distinct = pick => new Set(runs.map(pick)).size > 1, p = run => run.input.request.parameters;
    return [
      distinct(run => `${p(run).horizon_years}/${p(run).start_year}`) &&
        "De looptijd of het startjaar verschilt. Netto voordeel en ‘Lonend tot’ tellen dan over een andere periode.",
      distinct(run => p(run).discount_pct) && "De discontovoet verschilt. Het netto voordeel weegt latere jaren dan anders mee.",
      distinct(run => run.input.request.solar_import_id) && "Niet elke berekening gebruikt hetzelfde energieprofiel."
    ].filter(Boolean);
  }

  // [rij, toelichting, waarde per berekening]
  const ROWS = [
    ["Uitkomst", null, (run, rec) => rec ? `Advies: ${rec.name}` : "Geen accu komt het beste uit"],
    ["Besproken accu", null, (run, rec, c) => c ? `${c.name}${rec ? "" : " (komt het dichtst in de buurt)"}` : "Geen doorgerekend"],
    ["Startinvestering", "Na teruggaven en subsidie", (run, rec, c) => c && eur0(c.initial_investment_eur)],
    ["Besparing in jaar 1", "Op de energierekening", (run, rec, c) => c?.years?.[0] && eur0(c.years[0].energy_saving_eur)],
    ["Lonend tot", "Hoogste startinvestering die nog uit kan", (run, rec, c) => c && (Results.breakEven(c.break_even_investment_eur) ?? "Niet berekend")],
    ["Netto voordeel (NPV)", "Wat de accu over de looptijd oplevert min wat hij kost, in geld van nu",
      (run, rec, c) => c && eur0(c.npv_eur)],
    ["Terugverdiend na", null, (run, rec, c) => c && years(c.payback_years)],
    // Alleen als minstens één berekening een stresstest heeft; zie render.
    ["Netto voordeel bij de stresstest", "Met de lagere terugleverprijs uit de stresstest", (run, rec, c) =>
      !run.input.request.parameters.export_variant ? "Geen stresstest" : c?.export_variant && eur0(c.export_variant.npv_eur)]
  ];

  function render(view, runs) {
    const columns = runs.map(run => {
      const rec = run.result.candidates.find(c => c.key === run.result.recommended_key);
      return { run, rec, option: Results.judged(run) };
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
    const body = ROWS.filter(([label]) => stress || label !== "Netto voordeel bij de stresstest").map(([label, hint, value]) => h("tr", {},
      h("th", { scope: "row" }, label, hint ? [h("br"), h("small", {}, hint)] : null),
      columns.map(({ run, rec, option }) => h("td", {}, value(run, rec, option) ?? "—"))));
    body.push(h("tr", {}, h("th", { scope: "row" }, "Wat is anders"),
      columns.map(({ run }) => h("td", {}, differences(run, runs)))));
    const warnings = caveats(runs);
    if (warnings.length) view.append(h("div", { class: "callout", role: "note" }, h("p", {}, h("strong", {}, "Let op bij vergelijken")),
      h("ul", { class: "compact" }, warnings.map(text => h("li", {}, text)))));
    view.append(
      h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Berekeningen naast elkaar" },
        h("table", { class: "compare" }, h("caption", {}, `${runs.length} berekeningen naast elkaar`),
          h("thead", {}, head), h("tbody", {}, body))),
      h("p", { class: "help" }, "Elke kolom gebruikt de invoer en het rekenmodel van die berekening. Bij geen aanbevolen accu staat " +
        "de accu met het hoogste netto voordeel erbij."),
      h("section", { class: "panel plain glossary" }, h("h2", {}, "Wat betekenen deze woorden?"),
        h("dl", {}, Data.GLOSSARY.map(([term, text]) => [h("dt", {}, term), h("dd", {}, text)]))));
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
