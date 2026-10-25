"use strict";

// Resultaat van één bewaarde analyse. Gebruikt uitsluitend de vastgelegde invoer en uitkomst,
// zodat oudere runs altijd met hun oorspronkelijke aannames worden getoond.
window.Results = (() => {
  const { h, badge, button, field, table, stats, chart, tabs, money, kwh, pct, years, number: n, finite, palette } = UI;
  const eur0 = value => money(value, { decimals: 0 });

  const TECHNICAL = [
    ["usable_capacity_kwh", "Bruikbare capaciteit", "kWh"], ["charge_power_kw", "Laden (AC)", "kW"],
    ["discharge_power_kw", "Ontladen (AC)", "kW"], ["ac_round_trip_efficiency_pct", "Rendement AC → AC", "%"],
    ["standby_w", "Sluimerverbruik", "W"], ["annual_capacity_loss_pct", "Capaciteitsverlies per jaar", "%"],
    ["operating_life_years", "Levensduur", "jaar"]
  ];
  const PARAMETERS = [
    ["start_year", "Startjaar", 0], ["horizon_years", "Looptijd (jaren)", 0], ["discount_pct", "Discontovoet (%)", 1],
    ["annual_cost_escalation_pct", "Stijging extra jaarkosten (%)", 1],
      ["annual_pv_loss_pct", "Afname PV-opwek per jaar (%)", 1],
    ["annual_load_growth_pct", "Verandering verbruik per jaar (%)", 1],
      ["price_uncertainty_pct", "Tariefvariatie gevoeligheid (%)", 0],
    ["cost_uncertainty_pct", "Kostenvariatie gevoeligheid (%)", 0]
  ];
  const TIMING = { upfront: "Start", annual: "Per jaar", event: "Later" };

  const isFictitious = run => Data.isDemo(run.input.profile) || run.result.warnings.some(w => /FICTIEF/i.test(w));
  const isEstimated = run => run.result.warnings.some(w => /GESCHAT PROFIEL/.test(w));
  function options(run) {
    const result = run.result;
    const baseline = { key: "no_battery", name: "Geen accu", initial_investment_eur: 0, npv_eur: 0, net_profit_eur: 0, roi_pct: null, payback_years: null, first_year: result.baseline_first_year, years: [], pessimistic: { npv_eur: 0, net_profit_eur: 0, roi_pct: null }, optimistic: { npv_eur: 0, net_profit_eur: 0, roi_pct: null }, within_budget: true, color: "#7d847f",
      export_variant: result.export_variant_recommended_key == null ? undefined : { npv_eur: 0, net_profit_eur: 0, roi_pct: null, payback_years: null } };
    // Op volgorde van het gekozen doel, de aanbevolen optie voorop; kleuren volgen die volgorde.
    const score = SCORE[run.input.request.parameters.objective] || SCORE.net_present_value;
    const ranked = [...result.candidates].sort((a, b) => Number(b.key === result.recommended_key) -
      Number(a.key === result.recommended_key) || score(b) - score(a));
    return [baseline, ...ranked.map((c, i) => ({ ...c, color: palette[i % palette.length] }))];
  }
  const SCORE = {
    net_present_value: c => c.npv_eur, roi: c => c.roi_pct ?? -Infinity,
    payback: c => c.payback_years == null ? -Infinity : -c.payback_years,
    self_consumption: c => c.first_year?.self_consumption_pct ?? -Infinity
  };
  // Grafieken en kaarten tonen geen accu en de beste vijf; tabellen tonen alles.
  const TOP = 5;
  const shown = all => all.slice(0, TOP + 1);
  const more = all => all.length > TOP + 1;

  function summary(run) {
    const result = run.result, p = run.input.request.parameters, list = h("ul");
    const rec = result.candidates.find(c => c.key === result.recommended_key), base = result.baseline_first_year;
    const best = [...result.candidates].sort((a, b) => b.npv_eur - a.npv_eur)[0];
    const saving = c => c.years?.[0]?.energy_saving_eur;
    if (!rec) {
      list.append(h("li", {}, `Met deze aannames is géén accu de beste keuze over ${p.horizon_years} jaar.`));
      if (best) list.append(h("li", {},
        `Het dichtst in de buurt komt ${best.name}: die kost ${eur0(best.initial_investment_eur)} en bespaart in het eerste jaar ongeveer ${eur0(saving(best))}. Over de looptijd is dat netto ${eur0(best.npv_eur)} in geld van nu.`));
    } else {
      list.append(h("li", {},
        `${rec.name} komt het beste uit. Je betaalt ongeveer ${eur0(rec.initial_investment_eur)} en bespaart in het eerste jaar ongeveer ${eur0(saving(rec))} op je energierekening.`));
      list.append(h("li", {},
        rec.payback_years == null ? `Binnen ${p.horizon_years} jaar verdien je dat bedrag niet terug.` : `Je hebt de investering na ongeveer ${rec.payback_years} jaar terugverdiend. Over ${p.horizon_years} jaar is het netto voordeel ${eur0(rec.npv_eur)} in geld van nu.`));
      list.append(h("li", {},
        `Je gebruikt dan ${pct(rec.first_year.self_consumption_pct)} van je zonnestroom zelf; zonder accu is dat ${pct(base.self_consumption_pct)}.`));
      if (rec.npv_eur < 0) list.append(h("li", {},
        "Let op: financieel kost deze keuze je over de looptijd geld. Hij wint omdat je eigen gebruik belangrijker vond."));
      list.append(h("li", {},
        `Bij ongunstiger prijzen en kosten wordt het netto voordeel ${eur0(rec.pessimistic.npv_eur)}, bij gunstiger ${eur0(rec.optimistic.npv_eur)}.`));
    }
    const variant = p.export_variant, variantKey = result.export_variant_recommended_key;
    if (variant && variantKey != null) {
      const alt = result.candidates.find(c => c.key === variantKey);
      const same = variantKey === result.recommended_key;
      list.append(h("li", {}, `Als teruglevering vanaf ${variant.from_calendar_year} niets meer oplevert ` +
        `(variant ‘${variant.label}’): ` + (alt
          ? `${same ? "dan blijft" : "dan wordt"} ${alt.name} de beste keuze, met een netto voordeel van ${eur0(alt.export_variant.npv_eur)}.`
          : "dan blijft géén accu de beste keuze.")));
    }
    if (isEstimated(run)) list.append(h("li", {},
      "Je verbruik en opwek zijn geschat uit jaartotalen. Met gemeten uur- of kwartierwaarden (bijvoorbeeld van je slimme meter) wordt de uitkomst nauwkeuriger."));
    list.append(h("li", {},
      "Vraag voor een vaste accu altijd een offerte; die laat zien of je meterkast, aansluiting en omvormer geschikt zijn."));
    return h("section", { class: "panel plain" }, h("h2", {}, "Wat betekent dit voor jou?"), list);
  }

  function overview(run, all) {
    const result = run.result, out = h("div");
    for (const warning of result.warnings.filter(w => /FICTIEF|gemodelleerd|GESCHAT/i.test(w))) out.append(h("p",
      { class: "callout" }, warning));
    out.append(h("div", { class: "option-grid" }, shown(all).map(c => h("article", { class: "panel option", style: `border-top-color:${c.color}` },
      h("h3", {}, c.name),
      c.key === result.recommended_key ? badge("Aanbevolen", "accent") : null,
      c.within_budget === false ? badge("Boven budget", "warning") : null,
      stats([
        ["Startinvestering", eur0(c.initial_investment_eur)], ["Netto voordeel (NPV)", eur0(c.npv_eur)],
        ["Nettowinst over looptijd", eur0(c.net_profit_eur)],
          ["ROI over looptijd", c.key === "no_battery" ? "—" : pct(c.roi_pct)],
        ["Terugverdiend na", c.key === "no_battery" ? "—" : years(c.payback_years)],
          ["Eigen gebruik jaar 1", pct(c.first_year?.self_consumption_pct)],
        c.export_variant && run.input.request.parameters.export_variant
          ? [`NPV zonder vergoeding vanaf ${run.input.request.parameters.export_variant.from_calendar_year}`,
            eur0(c.export_variant.npv_eur)] : null
      ].filter(Boolean)),
      c.key === result.export_variant_recommended_key && c.key !== result.recommended_key ? badge("Beste in de terugleveringsvariant", "") : null))));
    if (more(all)) out.append(h("p", { class: "help" },
      `Hierboven geen accu en de beste ${TOP} van ${all.length - 1} doorgerekende accu’s; de tabel hieronder toont ze allemaal.`));
    out.append(chart("range", {
      title: `Netto voordeel (NPV) per optie, met gevoeligheidsvarianten${more(all) ? ` (beste ${TOP} en geen accu)` : ""}`, unit: "EUR",
      rows: shown(all).map(c => ({ label: c.name, color: c.color,
        values: [c.pessimistic?.npv_eur, c.npv_eur, c.optimistic?.npv_eur] })),
      series: [{ label: "Ongunstig" }, { label: "Basis" }, { label: "Gunstig" }]
    }));
    if (more(all)) {
      const variant = run.input.request.parameters.export_variant && result.export_variant_recommended_key != null;
      out.append(table(["Optie", "Startinvestering", "NPV", "ROI over looptijd", "Terugverdiend na", "Eigen gebruik jaar 1",
        ...(variant ? ["NPV terugleveringsvariant"] : [])], all.map(c => [
        c.key === result.recommended_key ? h("span", {}, c.name, " ", badge("Aanbevolen", "accent")) : c.name,
        eur0(c.initial_investment_eur), eur0(c.npv_eur), c.key === "no_battery" ? "—" : pct(c.roi_pct),
        c.key === "no_battery" ? "—" : years(c.payback_years), pct(c.first_year?.self_consumption_pct),
        ...(variant ? [eur0(c.export_variant?.npv_eur)] : [])]),
      { caption: `Alle ${all.length} opties, op volgorde van je doel` }));
    }
    out.append(h("p", { class: "help" },
      "NPV is het netto voordeel tegenover geen accu, omgerekend naar geld van nu. ROI is de nettowinst over de hele looptijd gedeeld door de startinvestering, geen jaarlijks rendement. De terugverdientijd blijft ook na latere vervangingskosten positief."));
    return out;
  }

  function cashflows(run, all) {
    const request = run.input.request, p = request.parameters, out = h("div");
    const horizon = run.result.candidates[0]?.years || [];
    const top = shown(all);
    const rows = [{ label: "Start", values: top.map(c => -c.initial_investment_eur) },
      ...horizon.map((year, i) => ({ label: String(year.calendar_year), values: top.map(c => c.key === "no_battery" ? 0 : c.years[i]?.cumulative_eur) }))];
    const marks = [];
    for (const c of top.slice(1)) {
      if (c.payback_years != null) marks.push({ at: String(p.start_year + c.payback_years - 1), symbol: "✓",
        label: `${c.name}: blijvend terugverdiend na jaar ${c.payback_years}` });
      for (const cost of request.candidates.find(v => v.key === c.key)?.costs || []) {
        if (cost.status === "priced" && ["battery_replacement",
          "inverter_replacement"].includes(cost.category)) marks.push({ at: String(p.start_year + cost.year - 1),
          symbol: "↧", label: `${c.name}: vervanging einde jaar ${cost.year}` });
      }
    }
    out.append(chart("line", { title: `Cumulatief resultaat ten opzichte van geen accu${more(all) ? ` (beste ${TOP})` : ""}`, unit: "EUR", rows, series: top.map(c => ({ label: c.name, color: c.color })), marks }),
      h("p", { class: "help" }, "✓ markeert het jaar waarin een optie blijvend is terugverdiend; ↧ een ingevoerde vervanging."));
    const pick = UI.select(all.map(c => [c.key, c.name]), run.result.recommended_key), target = h("div");
    const render = () => {
      const c = all.find(o => o.key === pick.value);
      const yearRows = c.key === "no_battery"
        ? horizon.map(y => [String(y.calendar_year), money(y.baseline_bill_eur), money(y.baseline_bill_eur),
          money(0), money(0), money(0), money(0), "—"])
        : c.years.map(y => [String(y.calendar_year), money(y.baseline_bill_eur), money(y.battery_bill_eur),
          money(y.extra_costs_eur), money(y.financing_interest_eur), money(y.net_cashflow_eur), money(y.cumulative_eur),
          pct(y.energy.self_sufficiency_pct)]);
      target.replaceChildren(
        table(["Jaar", "Rekening zonder accu", "Rekening met accu", "Extra kosten", "Leningrente",
          "Netto voordeel", "Cumulatief", "Zelfvoorziening"],
          yearRows),
        c.key === "no_battery" ? null : stats([
          ["Extra kosten over de looptijd", money(c.lifetime_extra_costs_eur)],
            ["Bespaarde energiekosten", money(c.lifetime_energy_saving_eur)],
          ["Gedisconteerd terugverdiend na", years(c.discounted_payback_years)]
        ]));
    };
    pick.addEventListener("change", render); render();
    out.append(UI.field("Jaartabel van", pick), target);
    return out;
  }

  function energy(all) {
    const out = h("div"), top = shown(all), suffix = more(all) ? `, beste ${TOP} en geen accu` : "";
    const demand = top.map(c => {
      const e = c.first_year || {},
        known = [e.consumption_kwh, e.direct_solar_kwh, e.battery_to_load_kwh].every(finite);
      return { label: c.name,
        values: [e.direct_solar_kwh, e.battery_to_load_kwh,
          known ? Math.max(0, e.consumption_kwh - e.direct_solar_kwh - e.battery_to_load_kwh) : null] };
    });
    out.append(chart("stacked", { title: `Waar komt je verbruik vandaan? (jaar 1${suffix})`, unit: "kWh", rows: demand, series: [{ label: "Direct van de panelen" }, { label: "Uit de accu" }, { label: "Van het net (afgeleid)" }] }),
      h("p", { class: "help" }, "Het netdeel is bruto verbruik min direct gebruikte zonnestroom en accustroom. De totale netafname bevat daarnaast het sluimerverbruik van de accu."));
    const destination = top.map(c => {
      const e = c.first_year || {},
        known = [e.production_kwh, e.direct_solar_kwh, e.battery_charge_kwh, e.grid_export_kwh].every(finite);
      return { label: c.name,
        values: [e.direct_solar_kwh, e.battery_charge_kwh, e.grid_export_kwh,
          known ? Math.max(0,
            e.production_kwh - e.direct_solar_kwh - e.battery_charge_kwh - e.grid_export_kwh) : null] };
    });
    out.append(chart("stacked",
      { title: `Waar gaat je zonnestroom heen? (jaar 1${suffix})`, unit: "kWh", rows: destination,
        series: [{ label: "Direct gebruikt" }, { label: "Naar de accu (incl. laadverlies)" },
          { label: "Teruggeleverd" }, { label: "Overig (o.a. sluimerverbruik)" }] }));
    const pick = UI.select(all.map(c => [c.key, c.name]), all[1]?.key), target = h("div");
    const render = () => {
      const e = all.find(o => o.key === pick.value)?.first_year || {};
      target.replaceChildren(stats([
        ["Opwek", kwh(e.production_kwh)], ["Bruto verbruik", kwh(e.consumption_kwh)],
          ["Netafname", kwh(e.grid_import_kwh)],
        ["Teruglevering", kwh(e.grid_export_kwh)], ["Uit de accu", kwh(e.battery_to_load_kwh)],
          ["Verliezen", kwh(e.conversion_and_fade_loss_kwh)],
        ["Sluimerverbruik", kwh(e.standby_kwh)], ["Volledige laadcycli", n(e.equivalent_cycles, 0)],
          ["Eigen gebruik", pct(e.self_consumption_pct)],
        ["Zelfvoorziening", pct(e.self_sufficiency_pct)],
          ["Hoogste netafname per meetperiode",
            finite(e.max_grid_import_kw) ? `${n(e.max_grid_import_kw)} kW` : "Onbekend"]
      ]));
    };
    pick.addEventListener("change", render); render();
    out.append(UI.field("Energiecijfers van", pick), target);
    return out;
  }

  function sensitivity(run, all) {
    const p = run.input.request.parameters, out = h("div");
    out.append(h("p", {},
      `Tarieven ±${n(p.price_uncertainty_pct, 0)}%, kosten ±${n(p.cost_uncertainty_pct, 0)}%. De gunstige variant verhoogt de stroomprijs, verlaagt de terugleververgoeding en verlaagt de kosten; de ongunstige doet het omgekeerde. Bevestigde aftrekposten blijven gelijk. Dit zijn gevoeligheidstests, geen betrouwbaarheidsintervallen.`));
    const variants = c => [c.pessimistic, c, c.optimistic];
    out.append(table(["Optie", "NPV ongunstig", "NPV basis", "NPV gunstig", "Nettowinst ongunstig", "Nettowinst basis",
      "Nettowinst gunstig", "ROI ongunstig", "ROI basis", "ROI gunstig"], all.map(c => [c.name,
      ...variants(c).map(v => eur0(v?.npv_eur)), ...variants(c).map(v => eur0(v?.net_profit_eur)),
      ...variants(c).map(v => c.key === "no_battery" ? "—" : pct(v?.roi_pct))])));
    const variant = p.export_variant;
    if (variant && run.result.export_variant_recommended_key != null) {
      out.append(h("h3", {}, `Terugleveringsvariant: ${variant.label}`),
        h("p", {}, `Vanaf ${variant.from_calendar_year} ${n(variant.export_eur_per_kwh, 4)} €/kWh vergoeding en ` +
          `${n(variant.export_fee_eur_per_kwh, 4)} €/kWh terugleverkosten; verder de basisaannames. Een aanname, geen voorspelling.`),
        table(["Optie", "NPV basis", "NPV variant", "Nettowinst variant", "ROI variant", "Terugverdiend na"], all.map(c => [
          c.name, money(c.npv_eur), money(c.export_variant?.npv_eur), money(c.export_variant?.net_profit_eur),
          c.key === "no_battery" ? "—" : pct(c.export_variant?.roi_pct), c.key === "no_battery" ? "—" : years(c.export_variant?.payback_years)])));
    }
    for (const [key, title, unit] of [["net_profit_eur", "Nettowinst over de looptijd", "EUR"], ["roi_pct", "ROI over de looptijd", "%"]]) {
      out.append(chart("range",
        { title: `${title}${more(all) ? ` (beste ${TOP})` : ""}`, unit,
          rows: shown(all).filter(c => key !== "roi_pct" || c.key !== "no_battery").map(c => ({ label: c.name, color: c.color,
            values: [c.pessimistic?.[key], c[key], c.optimistic?.[key]] })),
          series: [{ label: "Ongunstig" }, { label: "Basis" }, { label: "Gunstig" }] }));
    }
    return out;
  }

  function inputs(run, categories) {
    const input = run.input, request = input.request, p = request.parameters, tariff = p.tariff, out = h("div");
    const label = key => categories.find(c => c.key === key)?.label || key;
    out.append(h("p", {}, `${request.site.address} · ${input.profile?.filename || `Profiel ${request.solar_import_id}`}`),
      h("p", { class: "help" }, `Profiel-SHA-256: ${input.profile_sha256 || "Onbekend"} · kostenonderzoek ${input.cost_sources_researched_on || "onbekend"}`));
    out.append(table(["Aanname", "Waarde"], [
      ["Doel", Data.objectives[p.objective]], ["Budget", p.budget_eur == null ? "Geen maximum" : money(p.budget_eur)],
      ...PARAMETERS.map(([key, text, decimals]) => [text, key === "start_year" ? String(p[key]) : n(p[key], decimals)]),
      ["Stroomprijs (€/kWh)", n(tariff.import_eur_per_kwh, 4)],
        ["Terugleververgoeding (€/kWh)", n(tariff.export_eur_per_kwh, 4)],
      ["Terugleverkosten (€/kWh)", n(tariff.export_fee_eur_per_kwh, 4)],
        ["Prijsverandering per jaar (%)", n(tariff.annual_price_change_pct, 1)],
      ["Ongewijzigde vaste contractkosten", `${money(tariff.fixed_annual_eur)} per jaar`],
      p.export_variant ? ["Terugleveringsvariant", `${p.export_variant.label}: vanaf ${p.export_variant.from_calendar_year} ` +
        `${n(p.export_variant.export_eur_per_kwh, 4)} / ${n(p.export_variant.export_fee_eur_per_kwh, 4)} €/kWh (vergoeding / kosten)`] : null
    ].filter(Boolean), { caption: "Tarieven en projectie" }));
    if (tariff.export_fee_bands.length) out.append(table(["Teruglevering t/m", "Jaarkosten"],
      tariff.export_fee_bands.map(b => [b.up_to_kwh == null ? "Onbegrensd" : kwh(b.up_to_kwh), money(b.annual_eur)]),
      { caption: "Terugleverstaffel" }));
    for (const c of request.candidates) {
      out.append(h("details", { class: "panel" }, h("summary", {}, c.name), h("p", {}, c.assumptions),
        table(["Techniek", "Waarde"],
          TECHNICAL.map(([key, text, unit]) => [text,
            finite(c.battery[key]) ? `${n(c.battery[key])} ${unit}` : "Onbekend"])),
        table(["Kostenpost", "Status", "Bedrag", "Moment", "Bron", "Toelichting"], c.costs.map(cost => [
          label(cost.category), Data.costStatus[cost.status],
            cost.status === "priced" ? money(cost.amount_minor / 100) : "—",
          `${TIMING[cost.timing]}${cost.year != null ? ` · einde jaar ${cost.year}` : ""}`,
          /^https:\/\//.test(cost.source) ? UI.external("bron", cost.source) : cost.source, cost.notes])),
        h("p", {}, `Financiering: ${money(c.financing.loan_amount_eur)} tegen ${pct(c.financing.annual_interest_pct)} rente, ${years(c.financing.years)}.`)));
    }
    out.append(h("p", { class: "help" }, "Meetgrenzen, technische aannames en kosten zijn vóór deze berekening bevestigd."),
      h("details", {}, h("summary", {}, "Vastgelegde invoer als JSON"), h("pre", {}, JSON.stringify(input, null, 2))));
    return out;
  }

  function exportCsv(run) {
    const result = run.result, rows = [["Berekening", run.title], ["Model", result.model_version], ["Profiel", run.input.profile?.filename], ["FICTIEF", isFictitious(run) ? "Ja" : "Nee"], ["Aanbeveling", result.recommendation], [],
      ["Optie", "Startinvestering EUR", "NPV EUR", "Nettowinst EUR", "ROI %", "Terugverdiend na (jaar)",
        "NPV terugleveringsvariant EUR"],
      ["Geen accu", 0, 0, 0, "—", "—", result.export_variant_recommended_key == null ? "" : 0]];
    for (const c of result.candidates) {
      rows.push([c.name, n(c.initial_investment_eur), n(c.npv_eur), n(c.net_profit_eur), c.roi_pct == null ? "Niet bepaald" : n(c.roi_pct),
        c.payback_years ?? "Niet binnen looptijd", c.export_variant ? n(c.export_variant.npv_eur) : ""]);
    }
    for (const c of result.candidates) {
      rows.push([], [c.name, "Jaar", "Netto voordeel EUR", "Cumulatief EUR"]);
      c.years.forEach(y => rows.push([c.name, y.calendar_year, n(y.net_cashflow_eur), n(y.cumulative_eur)]));
    }
    rows.push([], ...result.warnings.map(w => ["Waarschuwing", w]));
    UI.downloadCsv(`thuisaccu-berekening-${run.id ?? "gedeeld"}.csv`, rows);
  }

  // Delen via de adresbalk: de uitkomst en aannames, ingepakt (deflate) en base64url-gecodeerd achter #/gedeeld/.
  // Het deel na # gaat niet naar een server. Adres, coördinaten, BAG-id en bestandsnaam gaan niet mee.
  const SHARE_VERSION = 1, SHARE_MAX_CHARS = 1_500_000, SHARE_MAX_BYTES = 8_000_000;
  const toBase64Url = bytes => {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  };
  const fromBase64Url = data => Uint8Array.from(atob(data.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  // Om de link kort te houden gaan alleen de opties mee die de uitkomst bepalen: de aanbevolen accu, de beste
  // vijf op het gekozen doel en de beste op netto contante waarde en in de terugleveringsvariant.
  function shareable(run) {
    const input = run.input, request = input.request, result = run.result, source = input.profile?.options || {};
    const score = SCORE[request.parameters.objective] || SCORE.net_present_value;
    const byScore = [...result.candidates].sort((a, b) => score(b) - score(a));
    const best = [...result.candidates].sort((a, b) => b.npv_eur - a.npv_eur)[0];
    const keep = new Set([result.recommended_key, result.export_variant_recommended_key, best?.key,
      ...byScore.slice(0, TOP).map(c => c.key)]);
    const candidates = result.candidates.filter(c => keep.has(c.key));
    // Alleen wat de weergave nodig heeft; importinstellingen kunnen ook de naam van een meterbestand bevatten.
    const kind = { is_demo: source.is_demo, generator: source.generator, data_kind: source.data_kind };
    // Een geschat of fictief profiel heeft een beschrijvende naam; een eigen bestandsnaam kan persoonlijk zijn.
    const filename = kind.generator || Data.isDemo(input.profile) ? input.profile.filename : "bestandsnaam niet gedeeld";
    return { v: SHARE_VERSION, title: run.title, created_at_unix_s: run.created_at_unix_s,
      shared_of: result.candidates.length, result: { ...result, candidates },
      input: { ...input, profile: input.profile ? { filename, options: kind } : null,
        request: { ...request, candidates: request.candidates.filter(c => keep.has(c.key)),
          site: { address: "Adres niet gedeeld", latitude: null, longitude: null, bag_id: null } } } };
  }
  async function shareData(run) {
    const stream = new Blob([JSON.stringify(shareable(run))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  // Leest een gedeelde link terug; begrensd, zodat een kwaadaardige link de browser niet vol laat lopen.
  async function fromShare(data) {
    if (data.length > SHARE_MAX_CHARS) throw new Error("Deze link is te lang.");
    let bytes;
    try { bytes = fromBase64Url(data); } catch { throw new Error("Deze link is beschadigd of onvolledig."); }
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks = [];
    let total = 0, run;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > SHARE_MAX_BYTES) { await reader.cancel(); throw new Error("Deze link is te groot."); }
        chunks.push(value);
      }
      run = JSON.parse(await new Blob(chunks).text());
    } catch (error) {
      throw new Error(/te groot/.test(error.message) ? error.message : "Deze link is beschadigd of onvolledig.");
    }
    const valid = run?.v === SHARE_VERSION && typeof run.title === "string" && Array.isArray(run.result?.candidates) &&
      Array.isArray(run.result?.warnings) && run.input?.request?.parameters?.tariff && Array.isArray(run.input.request.candidates);
    if (!valid) throw new Error("Deze link bevat geen berekening die deze versie kan tonen.");
    return run;
  }
  async function share(run) {
    const url = `${location.href.split("#")[0]}#/gedeeld/${await shareData(run)}`;
    const box = h("input", { type: "text", readonly: true, value: url, onfocus: event => event.target.select() });
    const status = h("p", { class: "help", "aria-live": "polite" });
    const copy = button("Kopieer link", async () => {
      try { await navigator.clipboard.writeText(url); status.textContent = "Link gekopieerd."; }
      catch { box.focus(); status.textContent = "Kopiëren lukt hier niet automatisch; de link is geselecteerd, kopieer hem met Ctrl+C."; }
    });
    UI.dialog("Deel deze berekening",
      h("p", {}, "Iedereen met deze link ziet de uitkomst, de aannames, de accu’s met hun kosten en de energiecijfers per jaar. " +
        "Je adres, de bestandsnaam en je meetgegevens per uur gaan niet mee. Alles staat in de link zelf; er wordt niets geüpload."),
      run.result.candidates.length > TOP + 1 ? h("p", { class: "help" }, "Om de link kort te houden gaan de aanbevolen accu en de " +
        `beste opties mee, niet alle ${run.result.candidates.length} doorgerekende accu’s.`) : null,
      Local.enabled ? null : h("p", { class: "help" },
        "De link wijst naar deze lokale app. Iemand anders opent hem in een eigen Thuisaccu: vervang dan het begin tot #/gedeeld/ door dat adres."),
      field("Link naar deze berekening", box), h("p", { class: "help" }, `${n(url.length, 0)} tekens.`), h("div", { class: "actions" }, copy), status);
  }

  async function render(run, view, actions, onDuplicate, { shared = false } = {}) {
    const result = run.result, request = run.input.request, p = request.parameters, all = options(run);
    const categories = (await Data.costs()).categories;
    UI.append(actions, [shared ? null : button("Pas aan en reken opnieuw", () => onDuplicate(run), "secondary"),
      shared ? null : button("Deel als link", event => UI.busy(event.target, () => share(run)), "secondary"),
      button("Exporteer CSV", () => exportCsv(run), "secondary"), button("Afdrukken", () => window.print(), "ghost")]);
    if (shared) view.append(h("p", { class: "callout", role: "note" },
      "Gedeelde berekening: geopend uit een link en niet bewaard in je eigen berekeningen. Deze app heeft de uitkomst niet " +
      "opnieuw berekend, dus controleer de aannames en vertrouw alleen links van iemand die je kent." +
      (run.shared_of > result.candidates.length ? ` De link bevat ${result.candidates.length} van de ${run.shared_of} ` +
        "doorgerekende accu’s: de aanbevolen accu en de beste opties." : "")));
    view.append(h("p", { class: "help" },
      `${request.site.address} · ${run.input.profile?.filename || `Profiel ${request.solar_import_id}`} · ${Data.objectives[p.objective]} · ${p.horizon_years} jaar vanaf ${p.start_year} · model ${result.model_version} · ${UI.dateTime(run.created_at_unix_s)}`));
    if (isFictitious(run)) view.append(h("p", { class: "banner" },
      "FICTIEVE GEGEVENS: deze berekening gebruikt fictieve invoer en zegt niets over een echte woning."));
    const recommended = all.find(c => c.key === result.recommended_key);
    view.append(h("section", { class: "panel verdict" }, h("p", { class: "eyebrow" }, "Binnen deze aannames"),
      h("h2", {}, result.recommendation), badge(recommended?.name || "Onbekende optie", "accent")));
    view.append(summary(run), tabs([
      { label: "Overzicht", content: overview(run, all) }, { label: "Kasstromen", content: cashflows(run, all) },
      { label: "Energie", content: energy(all) }, { label: "Gevoeligheid", content: sensitivity(run, all) },
      { label: "Invoer en aannames", content: inputs(run, categories) },
      { label: `Waarschuwingen (${result.warnings.length})`,
        content: h("ul", { class: "warnings" }, result.warnings.map(w => h("li", {}, w))) }
    ]));
  }

  return { render, isFictitious, fromShare };
})();
