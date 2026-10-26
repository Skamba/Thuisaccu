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
  // Hoogste netto startinvestering met een NPV van nul (rekenkern); ontbreekt in oudere runs.
  // Naar beneden afgerond op € 10: de grens is een schatting, geen bedrag op de euro.
  const roundedLimit = value => eur0(Math.floor(value / 10) * 10);
  const breakEven = value => !finite(value) ? null : value <= 0 ? "Zelfs gratis niet" : `Tot ${roundedLimit(value)}`;
  const { CREDITS, QUOTE_FIELDS, quoteChange: changeText } = Data;

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

  // Veiligheidsadvies boven de som als een doorgerekende accu een stekkerbatterij is. `plugs`: optie → uitvoering
  // (Data.described), `circuit`: de richtprijs van een extra groep uit het kostenonderzoek.
  const PLUG_ADVICE = "stekkeradvies";
  function plugAdvice(run, judged, plugs, circuit) {
    const candidates = run.input.request.candidates;
    const plugged = candidates.filter(c => plugs.get(c.key)?.kind === "plug");
    if (!plugged.length) return null;
    const about = plugged.find(c => c.key === judged?.key) || plugged[0];
    const kw = about.battery.discharge_power_kw, grouped = candidates.find(c => plugs.get(c.key)?.circuit);
    const [, , mc, mcPlug] = Data.RULES.sources, [nbnl] = Data.RULES.sources;
    return h("li", { id: PLUG_ADVICE, tabindex: "-1", class: "plug-advice" },
      h("strong", {}, `${about.name} is een stekkerbatterij. `),
      "Milieu Centraal raadt stekkerbatterijen op dit moment af, onder meer vanwege brandrisico: in één groep kan stroom van twee " +
        "kanten komen, van het net en van de accu. Kies je er toch voor, gebruik dan een vaste wandcontactdoos op een groep met " +
        "weinig andere apparaten, geen verlengsnoer of stekkerdoos, en lever ten hoogste 800 W terug (dat advies geeft Milieu Centraal " +
        `voor stekkerzonnepanelen). Hier is gerekend met ${n(kw, 2)} kW ontladen${kw <= 0.8 ? ", dus binnen die 800 W" : ": meer dan 800 W, " +
        "dus stel de accu lager in of kies een vaste aansluiting"}. Veiliger is een eigen groep in de meterkast door een installateur` +
        (circuit ? `, volgens een richtprijs ongeveer ${eur0(circuit.amount_eur)}` : "") +
        (grouped ? `; die variant zit ook in deze berekening als ‘${grouped.name}’` : "") +
        ". Meld de accu aan op energieleveren.nl, zoals Netbeheer Nederland voorschrijft. Twijfel je of je woonverzekering een " +
        "stekkerbatterij dekt, vraag het dan na bij je verzekeraar. Bronnen: ",
      UI.external(mc[0], mc[1]), ", ", UI.external(mcPlug[0], mcPlug[1]), ", ", UI.external(nbnl[0], nbnl[1]),
      ...(circuit ? [", ", UI.external("Homedeal: richtprijs extra groep", circuit.url)] : []), ".");
  }
  // Knop op de kaart van een stekkerbatterij: springt naar het advies; een hash-link zou de router laten navigeren.
  const toAdvice = () => button("Milieu Centraal raadt stekkerbatterijen af: lees waarom", () => {
    const advice = document.getElementById(PLUG_ADVICE);
    advice.scrollIntoView({ block: "center" }); advice.focus({ preventScroll: true });
  }, "ghost");

  function summary(run, plugs, circuit) {
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
      // Vanaf modelversie 4 kan dit alleen bij het doel eigen gebruik; oudere runs met het doel ROI konden het ook.
      if (rec.npv_eur < 0) list.append(h("li", {}, p.objective === "self_consumption"
        ? "Let op: financieel kost deze keuze je over de looptijd geld. Hij wint omdat je eigen gebruik belangrijker vond."
        : "Let op: in geld van nu kost deze keuze je over de looptijd geld. Hij wint op ROI, die toekomstige bedragen niet omrekent naar nu."));
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
    const judged = rec || best;
    const advice = plugAdvice(run, judged, plugs, circuit);
    if (advice) list.append(advice);
    const first = judged?.years?.[0], tariff = p.tariff, price = v => money(v, { decimals: 4 });
    // Na te rekenen besparing in een jaar: vanaf 2027 zonder saldering en zonder staffel is dat precies
    // minder netafname × stroomprijs min minder teruglevering × netto vergoeding (de vaste kosten vallen weg).
    // Alle prijzen veranderen per jaar met dezelfde factor, zoals in `finance::energy_bill`.
    const receipt = (fewerImport, fewerExport, factor) => {
      const gain = fewerImport * tariff.import_eur_per_kwh * factor;
      // Minder teruglevering kost de netto vergoeding; zijn de terugleverkosten hoger, dan levert het juist op.
      const exported = (compensation, fee) => {
        const net = (compensation - fee) * factor, value = -fewerExport * net;
        return { value, text: `${value > 0 ? "+" : "−"} ${kwh(Math.abs(fewerExport))} ${fewerExport < 0 ? "meer" : "minder"} teruggeleverd × ${price(Math.abs(net))} ` +
          `(vergoeding ${price(compensation * factor)} − terugleverkosten ${price(fee * factor)}${net < 0 ? ": terugleveren kost je geld" : ""}) = ${eur0(Math.abs(value))}` };
      };
      // Met veel sluimerverbruik kan de accu de netafname zelfs verhogen; dan is de regel een min.
      return { gain, exported, line: `${gain < 0 ? "−" : "+"} ${kwh(Math.abs(fewerImport))} ${fewerImport < 0 ? "meer" : "minder"} van het net × ` +
        `${price(tariff.import_eur_per_kwh * factor)} = ${eur0(Math.abs(gain))}` };
    };
    const lines = (r, second) => h("ul", { class: "receipt" }, h("li", {}, r.line), h("li", {}, second.text),
      h("li", {}, `= ${eur0(r.gain + second.value)} per jaar`));
    const receipts = first && p.start_year >= 2027 && !tariff.export_fee_bands?.length;
    if (receipts) {
      const r = receipt(base.grid_import_kwh - first.energy.grid_import_kwh, base.grid_export_kwh - first.energy.grid_export_kwh, 1);
      const now = r.exported(tariff.export_eur_per_kwh, tariff.export_fee_eur_per_kwh), v = p.export_variant;
      const later = v ? r.exported(v.export_eur_per_kwh, v.export_fee_eur_per_kwh) : null;
      list.append(h("li", {}, `Zo reken je de besparing van ${judged.name} in het eerste jaar na:`, lines(r, now),
        `Dat de teruglevering meer daalt dan de netafname, komt door ${kwh(first.energy.conversion_and_fade_loss_kwh)} laad- en ` +
          `omzetverlies en ${kwh(first.energy.standby_kwh)} sluimerverbruik van de accu.` +
          (later ? ` In de variant ‘${v.label}’ wordt de tweede regel vanaf ${v.from_calendar_year}: ${later.text}, samen ${eur0(r.gain + later.value)} per jaar ` +
            "(met de hoeveelheden en prijzen van jaar 1)." : "")));
    }
    // Dezelfde som voor het eerste jaar met een warmtepomp of auto erbij; runs van vóór 26 oktober 2026 missen
    // netafname en teruglevering zonder accu per jaar.
    const changeYear = Math.min(...(run.input.request.load_changes || []).map(c => c.from_calendar_year));
    const changed = judged?.years?.find(y => y.calendar_year === changeYear);
    if (receipts && changed && finite(changed.baseline_grid_import_kwh)) {
      // De jaartabel en deze som rekenen met de gewone terugleverprijzen, ook als er een variant is.
      const r = receipt(changed.baseline_grid_import_kwh - changed.energy.grid_import_kwh,
        changed.baseline_grid_export_kwh - changed.energy.grid_export_kwh, (1 + tariff.annual_price_change_pct / 100) ** (changed.year - 1));
      const second = r.exported(tariff.export_eur_per_kwh, tariff.export_fee_eur_per_kwh);
      const total = r.gain + second.value, diff = total - first.energy_saving_eur;
      const what = (run.input.request.load_changes || []).filter(c => c.from_calendar_year === changeYear)
        .map(c => c.kind === "ev" ? "de elektrische auto" : "de warmtepomp").join(" en ");
      list.append(h("li", {}, `In ${changeYear}, het eerste jaar met ${what}, gebruikt het huis ${kwh(changed.energy.consumption_kwh)} in plaats van ` +
        `${kwh(first.energy.consumption_kwh)}. De besparing van ${judged.name} wordt dan:`, lines(r, second),
        `Dat is ${eur0(Math.abs(diff))} ${diff >= 0 ? "meer" : "minder"} dan in het eerste jaar` +
          (tariff.annual_price_change_pct ? `, deels doordat de prijzen ${pct(tariff.annual_price_change_pct)} per jaar veranderen` : "") +
          ". Extra verbruik ’s avonds en ’s nachts laat de accu vaker helemaal leeg lopen en levert dus meer op; extra verbruik overdag " +
          "laat minder zonnestroom over om op te slaan. Ook het capaciteitsverlies van de accu telt mee."));
    }
    if (judged && finite(judged.break_even_investment_eur)) {
      const limit = judged.break_even_investment_eur, variantLimit = judged.export_variant?.break_even_investment_eur;
      const meaning = p.discount_pct > 0
        ? ` ‘Lonend’ betekent hier: de besparing verdient de investering binnen ${p.horizon_years} jaar terug en levert daarbovenop ${pct(p.discount_pct)} per jaar op, wat je geld anders zou kunnen opbrengen (de discontovoet).`
        : ` ‘Lonend’ betekent hier: binnen ${p.horizon_years} jaar verdien je de investering terug.`;
      list.append(h("li", {}, (limit > 0
        ? `${judged.name} is lonend zolang de startinvestering niet boven ongeveer ${roundedLimit(limit)} komt; nu is die ${eur0(judged.initial_investment_eur)} (alle startposten na teruggaven, zie Kostenopbouw). Zo kun je een offerte of aanbieding zelf beoordelen.${meaning}`
        : `${judged.name} kost je over de looptijd in geld van nu geld, ook als hij gratis zou zijn: de jaarkosten, verliezen en het sluimerverbruik wegen zwaarder dan de besparing.`) +
        (p.export_variant && finite(variantLimit)
          ? ` In de variant ‘${p.export_variant.label}’ ${variantLimit > 0 ? `ligt die grens bij ${roundedLimit(variantLimit)}` : "is hij zelfs gratis niet lonend"}` +
            (variantLimit > limit + 10 ? ": hoger, omdat zelf opslaan meer waard wordt als terugleveren niets oplevert." : ".")
          : "")));
    }
    // Herberekend vanuit de offertecheck: wat er veranderde en wat dat met de grensprijs doet.
    const quote = run.input.request.quote_basis, quotedOption = quote && result.candidates.find(c => c.key === quote.candidate_key);
    if (quotedOption) list.append(h("li", {}, `Herberekend met de antwoorden uit je offerte, op basis van `,
      UI.link(`‘${quote.title}’`, `#/berekeningen/${quote.run_id}`), `: ${quote.changes.map(changeText).join("; ")}. ` +
      (finite(quotedOption.break_even_investment_eur) && finite(quote.break_even_investment_eur)
        ? `${quotedOption.name} is nu lonend tot ongeveer ${roundedLimit(Math.max(0, quotedOption.break_even_investment_eur))}; ` +
          `met de oorspronkelijke waarden was dat ${roundedLimit(Math.max(0, quote.break_even_investment_eur))}.`
        : "") +
      (quote.changes.some(c => c.field === "upfront_eur") ? ""
        : " De startinvestering is nog de schatting uit de oorspronkelijke berekening; vergelijk de grens zelf met de prijs in je offerte.")));
    if (isEstimated(run)) list.append(h("li", {},
      "Je verbruik en opwek zijn geschat uit jaartotalen. Met gemeten uur- of kwartierwaarden (bijvoorbeeld van je slimme meter) wordt de uitkomst nauwkeuriger."));
    list.append(h("li", {},
      "Laat je een accu vast aansluiten, vraag dan altijd een offerte; die laat zien of je meterkast, aansluiting en omvormer geschikt zijn. " +
      "Het tabblad Offertecheck zet op een rij wat je in de offerte controleert, met de waarden waarmee hier is gerekend."));
    return h("section", { class: "panel plain" }, h("h2", {}, "Wat betekent dit voor jou?"), list);
  }

  function overview(run, all, plugs) {
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
        c.key === "no_battery" || !breakEven(c.break_even_investment_eur) ? null
          : ["Lonend bij een startinvestering", breakEven(c.break_even_investment_eur)],
          ["Eigen gebruik jaar 1", pct(c.first_year?.self_consumption_pct)],
        c.export_variant && run.input.request.parameters.export_variant
          ? [`NPV zonder vergoeding vanaf ${run.input.request.parameters.export_variant.from_calendar_year}`,
            eur0(c.export_variant.npv_eur)] : null
      ].filter(Boolean)),
      c.key === result.export_variant_recommended_key && c.key !== result.recommended_key ? badge("Beste in de terugleveringsvariant", "") : null,
      plugs.get(c.key)?.kind === "plug" ? h("p", { class: "help" }, toAdvice()) : null))));
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
      out.append(table(["Optie", "Startinvestering", "Lonend bij een startinvestering", "NPV", "ROI over looptijd", "Terugverdiend na", "Eigen gebruik jaar 1",
        ...(variant ? ["NPV terugleveringsvariant"] : [])], all.map(c => [
        c.key === result.recommended_key ? h("span", {}, c.name, " ", badge("Aanbevolen", "accent")) : c.name,
        eur0(c.initial_investment_eur), c.key === "no_battery" ? "—" : breakEven(c.break_even_investment_eur) ?? "Niet berekend",
        eur0(c.npv_eur), c.key === "no_battery" ? "—" : pct(c.roi_pct),
        c.key === "no_battery" ? "—" : years(c.payback_years), pct(c.first_year?.self_consumption_pct),
        ...(variant ? [eur0(c.export_variant?.npv_eur)] : [])]),
      { caption: `Alle ${all.length} opties, op volgorde van je doel` }));
    }
    out.append(h("p", { class: "help" },
      "NPV is het netto voordeel tegenover geen accu, omgerekend naar geld van nu. ‘Lonend bij een startinvestering’ is de hoogste startinvestering (na teruggaven) waarbij de NPV nog nul is, met alle andere kosten gelijk. ROI is de nettowinst over de hele looptijd gedeeld door de startinvestering, geen jaarlijks rendement. De terugverdientijd blijft ook na latere vervangingskosten positief."));
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
        ? horizon.map(y => [String(y.calendar_year), kwh(y.energy.consumption_kwh), money(y.baseline_bill_eur), money(y.baseline_bill_eur),
          money(0), money(0), money(0), money(0), money(0), "—"])
        : c.years.map(y => [String(y.calendar_year), kwh(y.energy.consumption_kwh), money(y.baseline_bill_eur), money(y.battery_bill_eur),
          // Vóór modelversie 5 stond de hele investering op tijdstip nul en was er geen aflossing per jaar.
          money(y.extra_costs_eur), money(y.financing_interest_eur),
          finite(y.financing_principal_eur) ? money(y.financing_principal_eur) : "—", money(y.net_cashflow_eur), money(y.cumulative_eur),
          pct(y.energy.self_sufficiency_pct)]);
      // Zonder accu geen totalen; replaceChildren zou null als tekst tonen.
      target.replaceChildren(...[
        table(["Jaar", "Bruto verbruik", "Rekening zonder accu", "Rekening met accu", "Extra kosten", "Leningrente", "Aflossing",
          "Netto voordeel", "Cumulatief", "Zelfvoorziening"],
          yearRows),
        c.key === "no_battery" ? null : stats([
          ["Extra kosten over de looptijd", money(c.lifetime_extra_costs_eur)],
            ["Bespaarde energiekosten", money(c.lifetime_energy_saving_eur)],
          ["Gedisconteerd terugverdiend na", years(c.discounted_payback_years)]
        ])].filter(Boolean));
    };
    pick.addEventListener("change", render); render();
    // Een warmtepomp of auto vanaf een later jaar verklaart de sprong in het verbruik.
    const changes = run.result.warnings.filter(w => /^Extra verbruik|meet de slimme meter niet meer/.test(w));
    if (run.input.request.load_changes?.length) changes.push("De aanschaf van de warmtepomp of auto en het gas of de benzine die je bespaart " +
      "tellen niet mee: het extra verbruik zit zowel in ‘geen accu’ als in iedere accu-optie, dus de uitkomst gaat alleen over de accu.");
    out.append(UI.field("Jaartabel van", pick), target, ...changes.map(w => h("p", { class: "help" }, w)));
    return out;
  }

  // Kostenopbouw uit de vastgelegde kostenposten, in het basisscenario (zonder gevoeligheidsvariatie).
  function costs(run, all, categories) {
    const request = run.input.request, out = h("div"), top = shown(all).slice(1);
    const label = key => categories.find(c => c.key === key)?.label || key;
    const order = key => { const i = categories.findIndex(c => c.key === key); return i < 0 ? Infinity : i; };
    const linesOf = c => (request.candidates.find(v => v.key === c.key)?.costs || [])
      .slice().sort((a, b) => order(a.category) - order(b.category));
    const amount = cost => (cost.status === "priced" ? cost.amount_minor / 100 : 0) * (CREDITS.includes(cost.category) ? -1 : 1);
    // Grafiek: de positieve startposten per optie; teruggaven staan in de tabel eronder.
    const keys = [...new Set(top.flatMap(c => linesOf(c)
      .filter(l => l.timing === "upfront" && amount(l) > 0).map(l => l.category)))].sort((a, b) => order(a) - order(b));
    if (keys.length) {
      out.append(chart("stacked", {
        title: `Startinvestering per kostenpost${more(all) ? ` (beste ${TOP})` : ""}`, unit: "EUR",
        rows: top.map(c => ({ label: c.name, values: keys.map(k => linesOf(c)
          .filter(l => l.timing === "upfront" && l.category === k).reduce((sum, l) => sum + amount(l), 0)) })),
        series: keys.map(k => ({ label: label(k) }))
      }));
    }
    const pick = UI.select(all.slice(1).map(c => [c.key, c.name]), run.result.recommended_key ?? all[1]?.key), target = h("div");
    const render = () => {
      const c = all.find(o => o.key === pick.value);
      if (!c) { target.replaceChildren(); return; }
      const lines = linesOf(c).filter(l => l.status !== "not_applicable");
      const source = l => /^https:\/\//.test(l.source) ? UI.external("bron", l.source) : l.source;
      const row = l => [label(l.category), `${TIMING[l.timing]}${l.year != null ? ` · einde jaar ${l.year}` : ""}`,
        l.status === "priced" ? money(amount(l)) : Data.costStatus[l.status], source(l)];
      const group = (timing, total) => {
        const part = lines.filter(l => l.timing === timing);
        return part.length ? [...part.map(row), ...(total ? [[h("strong", {}, total[0]), "", h("strong", {}, money(total[1])), ""]] : [])] : [];
      };
      const sum = key => c.years.reduce((total, y) => total + (y[key] || 0), 0);
      const annual = lines.filter(l => l.timing === "annual").reduce((total, l) => total + amount(l), 0);
      const fromBattery = c.years.reduce((total, y) => total + (y.energy?.battery_to_load_kwh || 0), 0);
      const usable = request.candidates.find(v => v.key === c.key)?.battery?.usable_capacity_kwh;
      const skipped = linesOf(c).length - lines.length;
      target.replaceChildren(
        table(["Kostenpost", "Moment", "Bedrag", "Bron"], [
          ...group("upfront", ["Startinvestering", c.initial_investment_eur]),
          ...group("annual", ["Per jaar, eerste jaar", annual]),
          ...group("event")
        ], { caption: `Kostenposten van ${c.name}` }),
        skipped ? h("p", { class: "help" }, `${skipped} ${skipped === 1 ? "kostenpost is" : "kostenposten zijn"} niet van toepassing en staan er niet bij.`) : null,
        stats([
          ["Startinvestering", money(c.initial_investment_eur)],
          ["Startinvestering per kWh bruikbaar", finite(usable) && usable > 0 ? `${money(c.initial_investment_eur / usable)} per kWh` : "Onbekend"],
          ["Jaarkosten en latere posten over de looptijd", money(sum("extra_costs_eur"))],
          ["Leningrente over de looptijd", money(sum("financing_interest_eur"))],
          ["Extra kosten over de looptijd", money(c.lifetime_extra_costs_eur)],
          ["Kosten per kWh uit de accu", fromBattery > 0 ? `${money(c.lifetime_extra_costs_eur / fromBattery)} per kWh` : "Niet bepaald"]
        ]));
    };
    pick.addEventListener("change", render); render();
    out.append(UI.field("Kostenopbouw van", pick), target,
      h("p", { class: "help" }, "Bedragen zoals vastgelegd bij de berekening; teruggaven tellen negatief. Jaarkosten stijgen met de ingevoerde kostenstijging; " +
        "de gevoeligheidsvarianten schuiven de kosten nog eens op en van de lening telt alleen de rente als kosten; de aflossingen staan in de jaartabel. " +
        "Kosten per kWh uit de accu zijn alle extra kosten gedeeld door de stroom die je over de looptijd uit de accu gebruikt, niet gedisconteerd."));
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
          c.name, eur0(c.npv_eur), eur0(c.export_variant?.npv_eur), eur0(c.export_variant?.net_profit_eur),
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

  // Vragen voor de offerte, met de waarde waarmee gerekend is. Of een waarde een aanname is, staat in de
  // aannametekst van de keuzehulp (`describe` in data.js); in Zelf doorrekenen is de techniek eigen invoer.
  const VAT_URL = "https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/thuisbatterij-btw";
  // Hoogstens twee decimalen, zonder nullen aan het eind: 9,3 en 6,03.
  const plain = value => n(value, 2).replace(/,?0+$/, "");
  const withUnit = Data.quoteUnit;
  // [vraag, velden in de offerte, waarde, aannamepatroon, wat geen antwoord is]
  const CHECK = [
    ["Bruikbare capaciteit", ["usable_capacity_kwh"], b => `${plain(b.usable_capacity_kwh)} kWh bruikbaar`, /Aanname: [\d,]+% van de opgegeven/,
      "Niet de nominale of totale capaciteit: vraag hoeveel kWh je echt kunt gebruiken."],
    ["Laadvermogen aan de AC-kant", ["charge_power_kw"], b => `${plain(b.charge_power_kw)} kW`, /Aanname: laadvermogen gelijk/,
      "Hoeveel zonnestroom de accu per uur kan opnemen. Een DC- of PV-ingang telt niet."],
    ["Ontlaadvermogen aan de AC-kant", ["discharge_power_kw"], b => `${plain(b.discharge_power_kw)} kW`, /ontladen ingesteld op 800 W/,
      "Wat de accu continu aan je huis levert. kVA is geen kW, en een piek van een paar seconden telt niet."],
    ["Rendement AC → AC, heen en terug", ["ac_round_trip_efficiency_pct"], b => `${plain(b.ac_round_trip_efficiency_pct)}%`,
      /Aanname: [\d,]+% rendement|gebruikt als AC → AC-aanname/,
      "‘Tot 95%’, een DC-rendement of het rendement van alleen de batterij is niet hetzelfde."],
    ["Sluimerverbruik van accu, omvormer en regeling samen", ["standby_w"], b => `${plain(b.standby_w)} W`, /Aanname: [\d,]+ W sluimerverbruik/,
      "Ook als de accu niets doet. ‘Zit in het rendement’ is geen antwoord."],
    ["Garantie: jaren, cycli of MWh doorvoer en gegarandeerde restcapaciteit", ["operating_life_years", "annual_capacity_loss_pct"],
      b => `${plain(b.operating_life_years)} jaar levensduur, ${plain(b.annual_capacity_loss_pct)}% capaciteitsverlies per jaar`, /Aanname: [\d,]+% capaciteitsverlies/,
      "Garantie is geen levensduur: in de berekening stopt de accu na de levensduur, en garantiejaren zijn vaak korter. Een gegarandeerde " +
        "restcapaciteit van 70% na 10 jaar is ongeveer 3,5% verlies per jaar. Vraag ook wie de garantie geeft, fabrikant of installateur, " +
        "en wat er gebeurt als de installateur stopt."]
  ];
  function quoteCheck(run, all, categories) {
    const request = run.input.request, result = run.result, out = h("div"), target = h("div");
    const own = input => !/^Keuzehulp\./.test(input.assumptions);
    // Standaard je eigen offerte als die er is, anders de aanbevolen accu of die met de hoogste NPV.
    const best = [...result.candidates].sort((a, b) => b.npv_eur - a.npv_eur)[0];
    const first = request.candidates.find(own)?.key ?? result.recommended_key ?? best?.key;
    const pick = UI.select(all.slice(1).map(c => [c.key, c.name]), first);
    const label = key => categories.find(c => c.key === key)?.label || key;
    const basis = request.quote_basis;
    // Wat je per optie uit de offerte overneemt, als tekst zoals ingetypt (9,3).
    const quoted = {};
    // Rijen voor één optie: vraag, toelichting, velden, waarde, herkomst en of het een aanname is.
    // Op papier staan bij de prijs geen bedragen: die laten zien hoeveel ruimte je jezelf geeft.
    function rows(c, paper) {
      const input = request.candidates.find(v => v.key === c.key), mine = own(input);
      const fromQuote = fields => basis?.candidate_key === c.key && basis.changes.some(ch => fields.includes(ch.field));
      const origin = (assumed, fields = []) => fromQuote(fields) ? badge("offerte", "success")
        : assumed ? badge("aanname: vraag dit eerst", "warning") : badge(mine ? "jouw invoer" : "bron");
      const line = key => input.costs.find(l => l.category === key);
      const status = l => !l || l.status === "not_applicable" ? "niet meegeteld"
        : l.status === "priced" ? (paper ? "meegeteld" : money(l.amount_minor / 100, { decimals: 0 })) : "inbegrepen";
      const assumedCost = (...keys) => keys.map(line).some(l => l && Data.isAssumption(l));
      const priced = input.costs.filter(l => l.timing === "upfront" && l.status === "priced" && !CREDITS.includes(l.category));
      const included = input.costs.filter(l => l.status === "included");
      const skipped = ["inverter", "ems_metering", "installation", "cabling_protection", "meter_cabinet", "grid_connection"]
        .map(line).filter(l => l && l.status === "not_applicable");
      const listed = (title, lines, show) => lines.length ? `${title} ${lines.map(show).join(", ")}` : null;
      const subscription = line("subscription"), vat = line("vat_refund");
      const cost = (question, hint, value, keys, fields = []) => { const assumed = assumedCost(...keys) && !fromQuote(fields);
        return { question, hint, fields, value, origin: origin(assumed, fields), assumed }; };
      const list = [
        ...CHECK.map(([question, fields, value, pattern, hint]) => {
          const assumed = !mine && pattern.test(input.assumptions) && !fromQuote(fields);
          return { question, hint, fields, value: value(input.battery), origin: origin(assumed, fields), assumed };
        }),
        cost("Wat zit er in de prijs", "Omvormer, installatie, kabels en beveiliging, meterkast, aanmelding: staat alles erin? " +
          "Vul de totaalprijs inclusief btw in; teruggaven en subsidie tellen apart.",
          [paper ? null : `${money(c.initial_investment_eur, { decimals: 0 })} startinvestering na teruggaven`,
            listed(paper ? "Gerekend met:" : "waarvan", priced, l => paper ? label(l.category) : `${label(l.category)} ${money(l.amount_minor / 100, { decimals: 0 })}`),
            listed("inbegrepen:", included, l => label(l.category)), listed("niet meegeteld:", skipped, l => label(l.category))]
            .filter(Boolean).join("; "),
          ["installation", "cabling_protection", "meter_cabinet", "grid_connection", "inverter", "ems_metering"], ["upfront_eur"]),
        cost("Aansluiting", "1- of 3-fase, past het op je huidige aansluiting, en is een eigen groep in de meterkast (NEN 1010) inbegrepen?",
          `Meterkast: ${status(line("meter_cabinet"))}; aansluiting: ${status(line("grid_connection"))}`, ["meter_cabinet", "grid_connection"]),
        cost("Noodstroom", "Kan de accu het huis van stroom voorzien als het net uitvalt, en zit dat in de prijs?", status(line("backup")), ["backup"]),
        cost("App en abonnement", "Werkt de accu zonder cloud-app of betaald abonnement, en blijft hij werken als de app van de fabrikant verdwijnt?",
          subscription?.status === "priced" && !paper ? `${money(subscription.amount_minor / 100)} per jaar` : status(subscription),
          ["subscription"], ["subscription_eur"]),
        cost("Btw", h("span", {}, "Prijs inclusief 21% btw? Zegt de installateur dat je de btw terugkrijgt: volgens de ",
          UI.external("Belastingdienst", VAT_URL), " kan dat niet als je de accu alleen voor je eigen huis gebruikt."),
          vat?.status === "priced" && !paper ? `Teruggave van ${money(vat.amount_minor / 100, { decimals: 0 })} gerekend`
            : vat?.status === "priced" ? "Teruggave gerekend" : "Geen btw-teruggave gerekend", ["vat_refund"])
      ];
      // Aannames eerst: die vraag je aan de keukentafel het eerst na.
      return [...list.filter(r => r.assumed), ...list.filter(r => !r.assumed)];
    }
    const answer = (c, field) => (quoted[c.key] ||= {})[field] ?? "";
    // Op het scherm vul je de technische antwoorden in; op papier staat wat je invulde of een lege regel.
    const cell = (c, r, paper) => {
      if (paper) return r.fields.some(f => answer(c, f).trim())
        ? h("span", { class: "write-in" }, r.fields.map(f => answer(c, f).trim() ? withUnit(f, UI.parse(answer(c, f)) ?? 0) : null).filter(Boolean).join(", "))
        : h("span", { class: "write-in" });
      return h("span", { class: "quote-inputs" }, r.fields.map(f => {
        const [, name, unit] = QUOTE_FIELDS.find(([key]) => key === f);
        const control = h("input", { type: "text", inputmode: "decimal", value: answer(c, f), placeholder: unit,
          "aria-label": `Offerte zegt: ${name} (${unit === "€" ? "euro" : unit})`, size: "6" });
        control.addEventListener("input", () => { quoted[c.key][f] = control.value; });
        return control;
      }));
    };
    const sheet = (c, paper = false) => table(["Vraag aan de installateur", "Gerekend met", "Offerte zegt", "Klopt"],
      rows(c, paper).map(r => [h("span", {}, h("strong", {}, r.question), h("br"), h("small", {}, r.hint)),
        h("span", {}, r.value, " ", r.origin), cell(c, r, paper),
        h("input", { type: "checkbox", "aria-label": `Klopt: ${r.question}` })]),
      { className: "quote-check", stack: true });
    const render = () => {
      const c = all.find(o => o.key === pick.value);
      target.replaceChildren(...(c ? [sheet(c)] : []));
    };
    pick.addEventListener("change", render); render();
    // Afdrukken: alleen het blad, zonder energiegegevens, besparing, grensprijs of kostenbedragen.
    const print = button("Druk af voor de installateur", () => {
      const c = all.find(o => o.key === pick.value);
      if (!c) return;
      document.getElementById("print-sheet")?.remove();
      document.body.append(h("section", { id: "print-sheet" },
        isFictitious(run) ? h("p", { class: "callout" }, "FICTIEF: berekend met demogegevens.") : null,
        h("h1", {}, `Offertecheck: ${c.name}`),
        h("p", {}, `Gemaakt op ${new Date().toLocaleDateString("nl-NL")}. Vul per regel in wat de offerte zegt en vink af wat klopt. ` +
          "De regels gemarkeerd ‘aanname’ staan bovenaan: die zijn niet uit een bron."),
        sheet(c, true)));
      document.body.classList.add("print-check");
      addEventListener("afterprint", () => document.body.classList.remove("print-check"), { once: true });
      window.print();
    }, "secondary");
    // Opnieuw rekenen: een kopie in Zelf doorrekenen met de waarden uit de offerte, geopend bij de controle.
    const again = button("Reken opnieuw met de offerte", () => {
      const c = all.find(o => o.key === pick.value), input = request.candidates.find(v => v.key === c?.key);
      if (!input) return;
      const changes = [], wrong = [];
      for (const [field, name] of QUOTE_FIELDS) {
        const raw = answer(c, field).trim();
        if (!raw) continue;
        // Bedragen in hele centen, zoals de kostenposten.
        const parsed = UI.parse(raw), after = parsed != null && Data.isPriceField(field) ? Math.round(parsed * 100) / 100 : parsed;
        const before = Data.quoteValue(input, field);
        if (after == null || after < 0) wrong.push(name);
        else if (after !== before) changes.push({ field, before, after });
      }
      if (wrong.length) { UI.toast(`Geen geldig getal bij ${wrong.join(", ")}.`, true); return; }
      if (!changes.length) { UI.toast("Vul eerst minstens één waarde uit de offerte in die afwijkt.", true); return; }
      const copy = structuredClone(request), candidate = copy.candidates.find(v => v.key === c.key);
      for (const ch of changes) {
        if (Data.isPriceField(ch.field)) Data.applyQuotePrice(candidate, ch.field, ch.after);
        else candidate.battery[ch.field] = ch.after;
      }
      candidate.assumptions = `${candidate.assumptions} Uit de offerte: ${changes.map(changeText).join("; ")}.`.slice(0, 2000);
      delete copy.quote_basis;
      Scenario.load(copy, { title: `${request.title} · offerte`.slice(0, 200), step: 3,
        basis: { run_id: run.id, title: request.title, candidate_key: c.key,
          break_even_investment_eur: finite(c.break_even_investment_eur) ? c.break_even_investment_eur : null, changes } });
      UI.toast("Offertewaarden overgenomen. Controleer de invoer, bevestig en reken opnieuw; de oude berekening blijft bewaard.");
      location.hash = "#/zelf";
    });
    out.append(h("p", {}, "Leg deze lijst naast je offerte. Per vraag staat de waarde waarmee is gerekend; regels gemarkeerd ‘aanname’ komen niet uit een bron " +
      "en staan bovenaan. Vul de waarden uit de offerte in (bijvoorbeeld 9,3 of de totaalprijs) en reken opnieuw; de oude berekening blijft bewaard."),
      UI.field("Offertecheck voor", pick), target, h("div", { class: "actions" }, run.id == null ? null : again, print));
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
    const costCatalog = await Data.costs(), categories = costCatalog.categories;
    // Zonder catalogus (of bij een gedeelde run met onbekende accu's) blijft het stekkeradvies weg.
    const plugs = await Data.described(request.candidates).catch(() => new Map());
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
    // De aanbeveling noemt de optie al; een extra label herhaalt alleen de (soms lange) naam.
    view.append(h("section", { class: "panel verdict" }, h("p", { class: "eyebrow" }, "Binnen deze aannames"),
      h("h2", {}, result.recommendation)));
    view.append(summary(run, plugs, costCatalog.estimates?.amounts?.dedicated_circuit), tabs([
      { label: "Overzicht", content: overview(run, all, plugs) }, { label: "Kasstromen", content: cashflows(run, all) },
      { label: "Kostenopbouw", content: costs(run, all, categories) },
      { label: "Offertecheck", content: quoteCheck(run, all, categories) },
      { label: "Energie", content: energy(all) }, { label: "Gevoeligheid", content: sensitivity(run, all) },
      { label: "Invoer en aannames", content: inputs(run, categories) },
      { label: `Waarschuwingen (${result.warnings.length})`,
        content: h("ul", { class: "warnings" }, result.warnings.map(w => h("li", {}, w))) }
    ]));
  }

  return { render, isFictitious, fromShare };
})();
