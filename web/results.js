"use strict";

// Resultaat van één bewaarde analyse. Gebruikt uitsluitend de vastgelegde invoer en uitkomst,
// zodat oudere runs altijd met hun oorspronkelijke aannames worden getoond.
window.Results = (() => {
  const { h, link, badge, button, field, table, stats, chart, tabs, money, kwh, pct, years, number: n, finite, palette } = UI;
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
      ["price_uncertainty_pct", "Onzekerheid tarieven (± %)", 0],
    ["cost_uncertainty_pct", "Onzekerheid kosten (± %)", 0]
  ];
  const TIMING = { upfront: "Start", annual: "Per jaar", event: "Later" };
  // Hoogste netto startinvestering met een NPV van nul (rekenkern); ontbreekt in oudere runs.
  // Naar beneden afgerond op € 10: de grens is een schatting, geen bedrag op de euro.
  const roundedLimit = value => eur0(Math.floor(value / 10) * 10);
  const limitText = value => value > 0 ? `ongeveer ${roundedLimit(value)}` : "niets: zelfs gratis niet";
  // Wat teruglevering in de variant netto doet: met terugleverkosten en geen vergoeding kost ze geld.
  const variantEffect = v => {
    const net = v.export_eur_per_kwh - v.export_fee_eur_per_kwh, cents = x => UI.number(Math.abs(x) * 100, 1);
    return net < 0 ? `geld kost (netto ${cents(net)} cent per kWh die je teruglevert)`
      : net === 0 ? "niets meer oplevert" : `nog maar ${cents(net)} cent per kWh oplevert`;
  };
  const breakEven = value => !finite(value) ? null : value <= 0 ? "Zelfs gratis niet" : `Tot ${roundedLimit(value)}`;
  // De garantiestresstest van een optie: jaren en verlies zoals gerekend (nooit gunstiger dan de basis, zie
  // `analysis::stressed_battery`), de herkomst en de uitkomst; ontbreekt in oudere runs en zonder bekende garantie.
  const warranty = (run, c) => {
    const input = run.input.request.candidates.find(o => o.key === c?.key), s = input?.warranty_stress;
    return s && c.warranty_stress ? { ...s, result: c.warranty_stress,
      operating_life_years: Math.min(s.operating_life_years, input.battery.operating_life_years),
      annual_capacity_loss_pct: Math.max(s.annual_capacity_loss_pct, input.battery.annual_capacity_loss_pct) } : null;
  };
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
  // Capaciteit en vermogen in labels: hele getallen zonder decimaal, anders één.
  const n1 = value => n(value, Number.isInteger(value) ? 0 : 1);
  // Soort aansluiting in woorden, voor kaarten en tabellen.
  const CONNECTION = { plug: "Stekker", fixed: "Vast", circuit: "Stekker op eigen groep" };
  const connectionText = (c, kinds) => !kinds.get(c.key) ? "Onbekend"
    : kinds.get(c.key) === "circuit" && /\(afgeleid\)$/.test(c.name) ? "Stekker op eigen groep, afgeleid" : CONNECTION[kinds.get(c.key)];
  // Korte namen voor grafieken en keuzelijsten (Data.shortLabels).
  function shortNames(run, all, kinds) {
    const labels = Data.shortLabels(run.input.request.candidates, kinds);
    for (const c of all) c.short = labels.get(c.key) ?? c.name;
  }
  const shown = all => all.slice(0, TOP + 1);
  const more = all => all.length > TOP + 1;
  // Lange lijsten tonen eerst geen accu en de beste vijf; de rest staat ingeklapt en gaat niet mee op papier.
  const rest = (title, ...content) => h("details", { class: "fold all-options" }, h("summary", {}, title), ...content);

  // Veiligheidsadvies boven de som als een doorgerekende accu een stekkerbatterij is. `kinds`: optie → soort aansluiting
  // (`plug`, `fixed`, `circuit` of onbekend; zie `render`), `circuit`: de richtprijs van een extra groep uit het kostenonderzoek.
  const PLUG_ADVICE = "stekkeradvies";
  function plugAdvice(run, judged, kinds, circuit) {
    const candidates = run.input.request.candidates;
    const plugged = candidates.filter(c => kinds.get(c.key) === "plug");
    if (!plugged.length) return null;
    const about = plugged.find(c => c.key === judged?.key) || plugged[0];
    const kw = about.battery.discharge_power_kw, charge = about.battery.charge_power_kw, grouped = candidates.find(c => kinds.get(c.key) === "circuit");
    const [, , mc, mcPlug] = Data.RULES.sources, [nbnl] = Data.RULES.sources;
    // Bij veel stekkerbatterijen een telling in plaats van een lange rij productnamen.
    const names = plugged.length <= 3 ? plugged.map(c => c.name).join(", ")
      : `${plugged.length} van de ${candidates.length} doorgerekende accu’s, waaronder ${about.name}`;
    return h("li", { id: PLUG_ADVICE, tabindex: "-1", class: "plug-advice" },
      h("strong", {}, "Milieu Centraal raadt stekkerbatterijen op dit moment af. "),
      `Dit gaat over: ${names}. ` +
      "De reden is onder meer brandrisico: in één groep kan stroom van twee kanten komen, van het net en van de accu. Kies je er " +
        "toch voor, gebruik dan een vaste wandcontactdoos op een groep met weinig andere apparaten, geen verlengsnoer of stekkerdoos, " +
        "en laat de accu ten hoogste 800 W in het stopcontact leveren (dat advies geeft Milieu Centraal voor stekkerzonnepanelen). " +
        `Voor ${about.name} is gerekend met ${n(kw, 2)} kW ontladen${kw <= 0.8 ? ", dus binnen die 800 W" : ": meer dan 800 W, " +
        "dus stel de accu lager in of kies een vaste aansluiting"}` +
        (charge <= 0.8 ? `, en met ${n(charge, 2)} kW laden; ook meer laadvermogen hoort bij een eigen groep. `
          : `, en met ${n(charge, 2)} kW laden: ook dat is meer dan 800 W, dus stel ook het laden lager in of kies een vaste aansluiting. `) +
        `Veiliger is een eigen groep in de meterkast door een installateur` +
        (circuit ? `, volgens een richtprijs ongeveer ${eur0(circuit.amount_eur)}` : "") +
        (grouped ? `; die variant zit ook in deze berekening als ‘${grouped.name}’` : "") +
        ". Meld de accu aan op energieleveren.nl, zoals Netbeheer Nederland voorschrijft. Twijfel je of je woonverzekering een " +
        "stekkerbatterij dekt, vraag het dan na bij je verzekeraar. Bronnen: ",
      UI.external(mc[0], mc[1]), ", ", UI.external(mcPlug[0], mcPlug[1]), ", ", UI.external(nbnl[0], nbnl[1]),
      ...(circuit ? [", ", UI.external("Homedeal: richtprijs extra groep", circuit.url)] : []), ".");
  }
  // Knop naar het advies (op de kaart van een stekkerbatterij en bovenaan): klapt het open en springt ernaartoe;
  // een hash-link zou de router laten navigeren.
  const toAdvice = (label = "Milieu Centraal raadt stekkerbatterijen af: lees waarom") => button(label, () => {
    const advice = document.getElementById(PLUG_ADVICE);
    advice.closest("details").open = true;
    advice.scrollIntoView({ block: "center" }); advice.focus({ preventScroll: true });
  }, "ghost");

  // De grens voor de post ‘Accu of complete pakketprijs’ alleen: de winkelprijs die je in de gaten houdt,
  // met de overige startposten (na teruggaven) gelijk. Leeg als er geen aparte overige posten zijn.
  // De startposten naast de accuprijs (na teruggaven); null zonder geprijsde accupost of als er niets naast staat.
  function otherStartCosts(run, option) {
    const input = run.input.request.candidates.find(c => c.key === option.key);
    const battery = input?.costs.find(l => l.category === "battery" && l.status === "priced");
    if (!battery) return null;
    const rest = option.initial_investment_eur - battery.amount_minor / 100;
    return Math.abs(rest) < 1 ? null : rest;
  }
  function batteryLimit(run, option, limit) {
    const rest = otherStartCosts(run, option);
    if (rest == null) return "";
    return limit - rest > 0
      ? ` Voor de accu zelf (de post ‘Accu of complete pakketprijs’) is dat een prijs onder ongeveer ${roundedLimit(limit - rest)}, ` +
        `als de overige startposten samen ${eur0(rest)} blijven.`
      : ` De overige startposten (${eur0(rest)} samen) liggen al boven die grens.`;
  }
  // De besproken optie: de aanbevolen accu, anders die met de hoogste NPV.
  function judged(run) {
    const result = run.result;
    return result.candidates.find(c => c.key === result.recommended_key) ||
      [...result.candidates].sort((a, b) => b.npv_eur - a.npv_eur)[0];
  }

  // Als geen accu wint: wat er zou moeten veranderen, uitsluitend met getallen uit deze berekening.
  function whatIf(run, best) {
    const request = run.input.request, p = request.parameters, result = run.result, lines = [];
    const limit = best.break_even_investment_eur;
    if (best.npv_eur > 0 && best.within_budget === false) lines.push(`je budget ruimer is: ${best.name} kost ` +
      `${eur0(best.initial_investment_eur)}, meer dan je budget van ${eur0(p.budget_eur)}, en levert netto ${eur0(best.npv_eur)} op in geld van nu.`);
    else if (finite(limit)) lines.push(limit > 0
      ? `${best.name} minder kost dan ongeveer ${roundedLimit(limit)} (nu ${eur0(best.initial_investment_eur)}).${batteryLimit(run, best, limit)}`
      : `de besparing groter wordt: ${best.name} is zelfs gratis niet lonend, omdat de jaarkosten, verliezen en het ` +
        "sluimerverbruik zwaarder wegen dan de besparing. Een lagere prijs alleen is dus niet genoeg.");
    const v = p.export_variant;
    if (v && result.export_variant_recommended_key != null) {
      const alt = result.candidates.find(c => c.key === result.export_variant_recommended_key);
      const variantLimit = best.export_variant?.break_even_investment_eur;
      lines.push(`teruglevering vanaf ${v.from_calendar_year} ${variantEffect(v)} (‘${v.label}’): ` + (alt
        ? `dan komt ${alt.name} wel het beste uit, met een netto voordeel van ${eur0(alt.export_variant.npv_eur)}.`
        : finite(variantLimit) && variantLimit > 0 ? `dan is ${best.name} lonend tot ongeveer ${roundedLimit(variantLimit)}.`
          : `ook dan is ${best.name} zelfs gratis niet lonend.`));
    }
    // Een warmtepomp of auto die je opgaf, zit al in deze uitkomst; die regel noemt hem alleen.
    for (const c of request.load_changes || []) lines.push(`${c.kind === "ev" ? "de elektrische auto" : "de warmtepomp"} vanaf ` +
      `${c.from_calendar_year} (${kwh(c.annual_kwh)} per jaar erbij) zit al in deze berekening; daarmee alleen verandert het dus niet.`);
    return lines;
  }

  // Het korte antwoord bovenaan: de uitkomst en vier getallen van de besproken accu, met bij een
  // stekkerbatterij één regel veiligheidsadvies en de beste vaste aansluiting uit dezelfde berekening.
  // De uitleg staat eronder in ‘Wat betekent dit voor jou?’.
  // Bij het doel netto voordeel: de nummer twee als het verschil kleiner is dan wat de aanbevolen accu in de
  // ongunstige variant verliest. Dan beslist deze berekening niet tussen die twee.
  function closeCall(run, option) {
    const result = run.result;
    if (run.input.request.parameters.objective !== "net_present_value" || option?.key !== result.recommended_key) return null;
    const spread = option.npv_eur - option.pessimistic?.npv_eur;
    const second = result.candidates.filter(c => c.key !== option.key && c.within_budget !== false)
      .sort((a, b) => b.npv_eur - a.npv_eur)[0];
    if (!second || !finite(spread) || option.npv_eur - second.npv_eur >= spread) return null;
    const price = second.initial_investment_eur - option.initial_investment_eur;
    return h("p", { class: "verdict-close" }, h("strong", {}, `Bijna even goed: ${second.name}. `),
      `Netto ${eur0(Math.abs(option.npv_eur - second.npv_eur))} ${second.npv_eur <= option.npv_eur ? "minder" : "meer"}` +
      (Math.abs(price) >= 1 ? `, ${eur0(Math.abs(price))} ${price < 0 ? "goedkoper" : "duurder"} in aanschaf` : "") + ". " +
      (finite(second.pessimistic?.npv_eur) && second.pessimistic.npv_eur > option.pessimistic.npv_eur
        ? "Bij ongunstiger prijzen en kosten komt die zelfs beter uit. " : "") +
      "Dat verschil valt binnen de onzekerheid; kies tussen die twee op prijs, veiligheid, aansluiting of garantie.");
  }

  function verdict(run, kinds) {
    const result = run.result, option = judged(run), rec = option?.key === result.recommended_key;
    const limit = option?.break_even_investment_eur, plugged = run.input.request.candidates.some(c => kinds.get(c.key) === "plug");
    const isPlug = option && kinds.get(option.key) === "plug", isCircuit = option && kinds.get(option.key) === "circuit";
    // Bij een stekkerbatterij op een eigen groep ook de beste echte vaste installatie: de eigen groep vraagt een
    // installateur die hem vast wil aansluiten.
    const installed = isCircuit ? result.candidates.filter(c => kinds.get(c.key) === "fixed").sort((a, b) => b.npv_eur - a.npv_eur)[0] : null;
    const fixed = isPlug ? result.candidates.filter(c => kinds.get(c.key) && kinds.get(c.key) !== "plug")
      .sort((a, b) => b.npv_eur - a.npv_eur)[0] : null;
    return h("section", { class: "panel verdict" }, h("p", { class: "eyebrow" }, "Binnen deze aannames"),
      h("h2", {}, result.recommendation),
      option ? [h("p", { class: "verdict-for" }, !rec ? `Het dichtst in de buurt komt ${option.name}:`
        : result.recommendation.includes(option.name) ? "Voor deze accu:" : `Voor ${option.name}:`),
        stats([
          finite(limit) ? ["Lonend tot", limit > 0 ? roundedLimit(limit) : "Zelfs gratis niet"] : null,
          ["Startinvestering nu", eur0(option.initial_investment_eur)],
          ["Besparing in jaar 1", option.years?.[0] ? eur0(option.years[0].energy_saving_eur) : "—"],
          ["Terugverdiend na", option.payback_years == null ? `Niet binnen ${run.input.request.parameters.horizon_years} jaar` : years(option.payback_years)]
        ].filter(Boolean)), closeCall(run, option)] : null,
      isCircuit ? h("p", { class: "verdict-plug" }, h("strong", {}, "Een stekkerbatterij op een eigen groep. "),
        "Vraag vooraf of een installateur hem vast wil aansluiten en of de fabrikant dat toestaat. " +
        (installed ? `De beste vaste installatie in deze berekening is ${installed.name}: netto ${eur0(installed.npv_eur)} in geld van nu.`
          : "Er zit geen vaste installatie in deze berekening.")) : null,
      // Is de besproken accu zelf geen stekkerbatterij, dan gaat het advies over de andere opties.
      plugged ? h("p", { class: "verdict-plug" }, h("strong", {}, option && !isPlug
        ? "Er zitten ook stekkerbatterijen in een gewoon stopcontact in deze berekening; Milieu Centraal raadt die af. "
        : "Milieu Centraal raadt stekkerbatterijen af. "),
        fixed ? `De beste optie met een installateur in deze berekening is ${fixed.name}: netto ${eur0(fixed.npv_eur)} in geld van nu. ` : "",
        toAdvice("Lees waarom en wat veiliger is")) : null);
  }

  // Een inklapbaar onderdeel van de uitleg; de titel zegt wat erin staat.
  const fold = (title, ...content) => h("details", { class: "fold" }, h("summary", {}, title), ...content);

  function summary(run, kinds, circuit, categories) {
    const result = run.result, p = run.input.request.parameters, list = h("ul");
    const rec = result.candidates.find(c => c.key === result.recommended_key), base = result.baseline_first_year;
    const best = judged(run);
    // Een stekkerbatterij ‘op een eigen groep’ werkt alleen als een installateur hem vast wil aansluiten: in een
    // stopcontact steekt hij de stekker volgens de NEN 1010 niet (Milieu Centraal).
    if (best && kinds.get(best.key) === "circuit") list.append(h("li", {}, `${best.name} is een stekkerbatterij die een elektricien op ` +
      "een eigen groep aansluit. Een installateur steekt de stekker volgens de NEN 1010 niet in een stopcontact (Milieu Centraal): " +
      "vraag vooraf of hij dit product vast wil aansluiten en of de fabrikant dat toestaat zonder dat de garantie vervalt." +
      (circuit ? ` De richtprijs van ${eur0(circuit.amount_eur)} is voor een extra groep met aansluiting in de meterkast; ` +
        "een volle of verouderde groepenkast komt erbij." : "")));
    // Wat de uitkomst zou veranderen: varianten, de grensprijs en bij geen accu ‘Dat verandert als’.
    const change = h("ul");
    if (!rec) {
      if (best) list.append(h("li", {}, best.npv_eur < 0
        ? `Over ${p.horizon_years} jaar kost ${best.name} je netto ${eur0(-best.npv_eur)} in geld van nu, vergeleken met geen accu.`
        : `${best.name} levert over ${p.horizon_years} jaar netto ${eur0(best.npv_eur)} op in geld van nu, maar valt buiten je budget of doel.`));
      else list.append(h("li", {}, `Met deze aannames is géén accu de beste keuze over ${p.horizon_years} jaar.`));
    } else {
      list.append(h("li", {},
        rec.payback_years == null ? `Binnen ${p.horizon_years} jaar verdien je de startinvestering niet terug.` : `Over ${p.horizon_years} jaar is het netto voordeel ${eur0(rec.npv_eur)} in geld van nu: wat de accu oplevert min wat hij kost.`));
      list.append(h("li", {},
        `Je gebruikt dan ${pct(rec.first_year.self_consumption_pct)} van je zonnestroom zelf; zonder accu is dat ${pct(base.self_consumption_pct)}.`));
      // Vanaf modelversie 4 kan dit alleen bij het doel eigen gebruik; oudere runs met het doel ROI konden het ook.
      if (rec.npv_eur < 0) list.append(h("li", {}, p.objective === "self_consumption"
        ? "Let op: financieel kost deze keuze je over de looptijd geld. Hij wint omdat je eigen gebruik belangrijker vond."
        : "Let op: in geld van nu kost deze keuze je over de looptijd geld. Hij wint op ROI, die toekomstige bedragen niet omrekent naar nu."));
      change.append(h("li", {},
        `Bij ongunstiger prijzen en kosten wordt het netto voordeel ${eur0(rec.pessimistic.npv_eur)}, bij gunstiger ${eur0(rec.optimistic.npv_eur)}.`));
    }
    if (isEstimated(run)) list.append(h("li", {},
      "Je verbruik en opwek zijn geschat uit jaartotalen. Met gemeten uur- of kwartierwaarden (bijvoorbeeld van je slimme meter) wordt de uitkomst nauwkeuriger."));
    const variant = p.export_variant, variantKey = result.export_variant_recommended_key;
    // Zonder aanbeveling staat de terugleveringsvariant in ‘Dat verandert als’.
    if (rec && variant && variantKey != null) {
      const alt = result.candidates.find(c => c.key === variantKey);
      const same = variantKey === result.recommended_key;
      change.append(h("li", {}, `Als teruglevering vanaf ${variant.from_calendar_year} ${variantEffect(variant)} ` +
        `(variant ‘${variant.label}’): ` + (alt
          ? `${same ? "dan blijft" : "dan wordt"} ${alt.name} de beste keuze, met een netto voordeel van ${eur0(alt.export_variant.npv_eur)}.`
          : "dan blijft géén accu de beste keuze.")));
    }
    const meaning = p.discount_pct > 0
      ? `‘Lonend’ betekent hier: de besparing verdient de investering binnen ${p.horizon_years} jaar terug en levert daarbovenop ${pct(p.discount_pct)} per jaar op, wat je geld anders zou kunnen opbrengen (de discontovoet).`
      : `‘Lonend’ betekent hier: binnen ${p.horizon_years} jaar verdien je de investering terug.`;
    const changes = !rec && best && p.objective !== "self_consumption" ? whatIf(run, best) : [];
    if (changes.length) change.append(h("li", {}, "Dat verandert als:", h("ul", { class: "what-if" }, changes.map(t => h("li", {}, t))),
      `Deze berekening blijft bewaard onder Mijn berekeningen; reken opnieuw als je contract, de prijs of je verbruik verandert. ${meaning}`));
    if (!changes.length && best && finite(best.break_even_investment_eur)) {
      const limit = best.break_even_investment_eur, variantLimit = best.export_variant?.break_even_investment_eur;
      change.append(h("li", {}, (limit > 0
        ? `${best.name} is lonend zolang de startinvestering niet boven ongeveer ${roundedLimit(limit)} komt; nu is die ${eur0(best.initial_investment_eur)} (alle startposten na teruggaven, zie Kostenopbouw). Zo kun je een offerte of aanbieding zelf beoordelen.${batteryLimit(run, best, limit)} ${meaning}`
        : `${best.name} kost je over de looptijd in geld van nu geld, ook als hij gratis zou zijn: de jaarkosten, verliezen en het sluimerverbruik wegen zwaarder dan de besparing.`) +
        (p.export_variant && finite(variantLimit)
          ? ` In de variant ‘${p.export_variant.label}’ ${variantLimit > 0 ? `ligt die grens bij ${roundedLimit(variantLimit)}` : "is hij zelfs gratis niet lonend"}` +
            (variantLimit > limit + 10 ? ": hoger, omdat zelf opslaan meer waard wordt als terugleveren minder oplevert of geld kost." : ".")
          : "")));
    }
    const limits = !changes.length && best && finite(best.break_even_investment_eur) ? limitTable(run, best) : null;
    const cent = perCent(run, best);
    if (cent) change.append(h("li", {}, `Ook je contract telt. Levert teruglevering netto 1 cent per kWh meer op (vergoeding min ` +
      `terugleverkosten), dan is je rekening zonder accu ongeveer ${eur0(cent.bill)} per jaar lager en is ${best.name} over de looptijd ` +
      `${eur0(Math.abs(cent.npv))} ${cent.npv <= 0 ? "minder" : "meer"} waard; 1 cent minder werkt andersom. Vergelijk dus ook de ` +
      "terugleververgoeding en terugleverkosten van leveranciers: overstappen vraagt geen investering."));
    // Het gratis alternatief: verbruik naar zonuren schuiven levert per kWh het verschil tussen stroomprijs en netto
    // terugleverwaarde op, zonder aanschaf of laadverlies. Alleen met zonnestroom over en zonder staffel (dan is de
    // waarde per kWh niet één getal).
    const shift = tariff => tariff.import_eur_per_kwh - (tariff.export_eur_per_kwh - tariff.export_fee_eur_per_kwh);
    if (best?.years?.[0] && base.grid_export_kwh > 0 && p.start_year >= 2027 && !p.tariff.export_fee_bands?.length) {
      const delivered = best.years[0].energy.battery_to_load_kwh;
      change.append(h("li", {}, `Ook zonder accu kun je besparen. Elke kWh die je naar zonuren verschuift (wasmachine, vaatwasser, ` +
        `de auto overdag laden) levert ${money(shift(p.tariff), { decimals: 2 })} op: de stroomprijs min wat teruglevering netto ` +
        `oplevert, zonder aanschaf en zonder laadverlies. Ter vergelijking: ${best.name} levert in het eerste jaar ` +
        `${kwh(delivered)} aan je huis, ongeveer ${n(delivered / 365, 1)} kWh per dag. Wat je zelf verschuift, hoeft niet meer ` +
        "via de accu; die levert dan wat minder op."));
    }
    const advice = plugAdvice(run, best, kinds, circuit);
    const first = best?.years?.[0], tariff = p.tariff, price = v => money(v, { decimals: 4 });
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
    const sums = h("ul");
    const receipts = first && p.start_year >= 2027 && !tariff.export_fee_bands?.length;
    if (receipts) {
      const r = receipt(base.grid_import_kwh - first.energy.grid_import_kwh, base.grid_export_kwh - first.energy.grid_export_kwh, 1);
      const now = r.exported(tariff.export_eur_per_kwh, tariff.export_fee_eur_per_kwh), v = p.export_variant;
      const later = v ? r.exported(v.export_eur_per_kwh, v.export_fee_eur_per_kwh) : null;
      sums.append(h("li", {}, `Zo reken je de besparing van ${best.name} in het eerste jaar na:`, lines(r, now),
        `Dat de teruglevering meer daalt dan de netafname, komt door ${kwh(first.energy.conversion_and_fade_loss_kwh)} laad- en ` +
          `omzetverlies en ${kwh(first.energy.standby_kwh)} sluimerverbruik van de accu.` +
          (later ? ` In de variant ‘${v.label}’ wordt de tweede regel vanaf ${v.from_calendar_year}: ${later.text}, samen ${eur0(r.gain + later.value)} per jaar ` +
            "(met de hoeveelheden en prijzen van jaar 1)." : "")));
    }
    // Dezelfde som voor het eerste jaar met een warmtepomp of auto erbij; runs van vóór 26 oktober 2026 missen
    // netafname en teruglevering zonder accu per jaar.
    const changeYear = Math.min(...(run.input.request.load_changes || []).map(c => c.from_calendar_year));
    const changed = best?.years?.find(y => y.calendar_year === changeYear);
    if (receipts && changed && finite(changed.baseline_grid_import_kwh)) {
      // De jaartabel en deze som rekenen met de gewone terugleverprijzen, ook als er een variant is.
      const r = receipt(changed.baseline_grid_import_kwh - changed.energy.grid_import_kwh,
        changed.baseline_grid_export_kwh - changed.energy.grid_export_kwh, (1 + tariff.annual_price_change_pct / 100) ** (changed.year - 1));
      const second = r.exported(tariff.export_eur_per_kwh, tariff.export_fee_eur_per_kwh);
      const total = r.gain + second.value, diff = total - first.energy_saving_eur;
      const what = (run.input.request.load_changes || []).filter(c => c.from_calendar_year === changeYear)
        .map(c => c.kind === "ev" ? "de elektrische auto" : "de warmtepomp").join(" en ");
      sums.append(h("li", {}, `In ${changeYear}, het eerste jaar met ${what}, gebruikt het huis ${kwh(changed.energy.consumption_kwh)} in plaats van ` +
        `${kwh(first.energy.consumption_kwh)}. De besparing van ${best.name} wordt dan:`, lines(r, second),
        `Dat is ${eur0(Math.abs(diff))} ${diff >= 0 ? "meer" : "minder"} dan in het eerste jaar` +
          (tariff.annual_price_change_pct ? `, deels doordat de prijzen ${pct(tariff.annual_price_change_pct)} per jaar veranderen` : "") +
          ". Extra verbruik ’s avonds en ’s nachts laat de accu vaker helemaal leeg lopen en levert dus meer op; extra verbruik overdag " +
          "laat minder zonnestroom over om op te slaan. Ook het capaciteitsverlies van de accu telt mee."));
    }
    // Herberekend vanuit de offertecheck: wat er veranderde en wat dat met de grensprijs doet.
    const origin = h("ul");
    const quote = run.input.request.quote_basis, quotedOption = quote && result.candidates.find(c => c.key === quote.candidate_key);
    const quotedInput = quote && run.input.request.candidates.find(c => c.key === quote.candidate_key);
    const label = key => categories.find(c => c.key === key)?.label || key;
    // Zo komt de totaalprijs uit de offerte op de startkosten: plus wat apart bleef en een eventuele reserve.
    const priceSum = () => {
      const amount = key => { const line = quotedInput.costs.find(l => l.category === key && l.status === "priced");
        return line ? line.amount_minor / 100 : null; };
      const kept = quote.price.separate.filter(key => amount(key) != null), reserve = amount("contingency");
      const terms = { fixed: "vaste prijs", subject_to_survey: "onder voorbehoud van schouw", unknown: "niet bekend of de prijs vast is" };
      const total = quote.price.total_eur + kept.reduce((sum, key) => sum + amount(key), 0) + (reserve ?? 0);
      return h("ul", { class: "receipt" }, h("li", {}, `${eur0(quote.price.total_eur)} totaalprijs uit de offerte`),
        kept.map(key => h("li", {}, `+ ${eur0(amount(key))} apart gehouden: ${label(key)} (geschat, niet in de offerte)`)),
        reserve != null ? h("li", {}, `+ ${eur0(reserve)} reserve voor meerwerk (${terms[quote.price.terms]})`) : null,
        h("li", {}, `= ${eur0(total)} startkosten vóór teruggaven`));
    };
    if (quotedOption) origin.append(h("li", {}, `Herberekend met de antwoorden uit je offerte, op basis van `,
      link(`‘${quote.title}’`, `#/berekeningen/${quote.run_id}`), `: ${quote.changes.map(changeText).join("; ")}. ` +
      (finite(quotedOption.break_even_investment_eur) && finite(quote.break_even_investment_eur)
        ? (quotedOption.break_even_investment_eur <= 0 && quote.break_even_investment_eur <= 0
          ? `${quotedOption.name} is ook met deze waarden zelfs gratis niet lonend.`
          : `${quotedOption.name} is nu lonend tot ${limitText(quotedOption.break_even_investment_eur)}; ` +
            `met de oorspronkelijke waarden was dat ${limitText(quote.break_even_investment_eur)}.`)
        : "") +
      (quote.changes.some(c => c.field === "upfront_eur") ? (quote.price && quotedInput ? " De startkosten zijn nu:" : "")
        : " De startinvestering is nog de schatting uit de oorspronkelijke berekening; vergelijk de grens zelf met de prijs in je offerte."),
      quote.price && quotedInput && quote.changes.some(c => c.field === "upfront_eur") ? priceSum() : null));
    const recalculated = recalculatedFrom(run);
    if (recalculated) origin.append(h("li", {}, recalculated));
    const toCheck = button("Naar de offertecheck", event => {
      const tab = [...event.target.closest("#view").querySelectorAll("[role=tab]")].find(t => t.textContent === "Offertecheck");
      tab?.click(); tab?.focus();
    }, "secondary");
    return h("section", { class: "panel plain summary" }, h("h2", {}, "Wat betekent dit voor jou?"), list,
      advice ? fold("Veiligheid van een stekkerbatterij", h("ul", {}, advice)) : null,
      change.children.length ? fold(changes.length ? "Wat zou de uitkomst veranderen?" : "Tot welke prijs is het lonend, en wat als het tegenzit?", limits, change) : null,
      sums.children.length ? fold("Zo is de besparing berekend", sums) : null,
      origin.children.length ? fold(quotedOption ? `Uit je offerte, op basis van ‘${quote.title}’`
        : `Herberekend uit ‘${run.input.recalculated_from.title}’ met het huidige rekenmodel`, origin) : null,
      h("p", { class: "next-step" }, "Laat je een accu vast aansluiten, vraag dan altijd een offerte; die laat zien of je meterkast, aansluiting en " +
        "omvormer geschikt zijn. De offertecheck zet op een rij wat je controleert, met de waarden waarmee hier is gerekend. ", toCheck));
  }

  // Wat 1 cent per kWh meer netto terugleverwaarde (vergoeding min kosten) doet: de rekening zonder accu in jaar 1 en
  // het netto voordeel van de accu. Vanaf 2027 en zonder staffel is dat lineair (`finance::energy_bill`), dus volgt het
  // uit de bewaarde teruglevering per jaar zonder opnieuw te rekenen. Runs van vóór 26 oktober 2026 missen die.
  function perCent(run, c) {
    const p = run.input.request.parameters, t = p.tariff;
    if (!c?.years?.length || p.start_year < 2027 || t.export_fee_bands?.length || !c.years.every(y => finite(y.baseline_grid_export_kwh))) return null;
    const weight = y => (1 + t.annual_price_change_pct / 100) ** (y.year - 1) / (1 + p.discount_pct / 100) ** y.year;
    return { bill: c.years[0].baseline_grid_export_kwh * 0.01,
      npv: -c.years.reduce((sum, y) => sum + (y.baseline_grid_export_kwh - y.energy.grid_export_kwh) * 0.01 * weight(y), 0) };
  }

  // De grensprijzen van de besproken accu onder elkaar: zoals berekend, voor alleen de accu, en in de stresstests.
  // De uitleg eronder zegt waar de stresstests van uitgaan.
  function limitTable(run, c) {
    const p = run.input.request.parameters, limit = c.break_even_investment_eur, rest = otherStartCosts(run, c);
    const cell = value => finite(value) ? (value > 0 ? roundedLimit(value) : "Zelfs gratis niet") : "—";
    const w = warranty(run, c), variant = p.export_variant && c.export_variant;
    const rows = [
      ["Zoals berekend (alle startposten)", cell(limit), eur0(c.npv_eur)],
      rest != null && limit - rest > 0 ? ["Alleen de accuprijs, overige startposten gelijk", cell(limit - rest), eur0(c.npv_eur)] : null,
      variant ? [`Geen terugleververgoeding vanaf ${p.export_variant.from_calendar_year}`, cell(c.export_variant.break_even_investment_eur),
        eur0(c.export_variant.npv_eur)] : null,
      w ? [`Stopt na de garantie (${w.operating_life_years} jaar)`, cell(w.result.break_even_investment_eur), eur0(w.result.npv_eur)] : null
    ].filter(Boolean);
    return h("div", {}, table(["Situatie", "Lonend tot", "Netto voordeel"], rows, { caption: `Grensprijs voor ${c.name}`, stack: true }),
      w ? h("p", { class: "help" }, `Stopt na de garantie: dezelfde accu werkt maar ${w.operating_life_years} jaar en verliest ` +
        `${pct(w.annual_capacity_loss_pct)} capaciteit per jaar (bij 3,5% is na 10 jaar ongeveer 70% over). Garantie is geen levensduur, ` +
        "maar een defect daarna betaal je zelf. Het advies verandert er niet door.") : null);
  }

  function overview(run, all, kinds) {
    const result = run.result, out = h("div", { class: "print-keep" });
    const inputs = new Map(run.input.request.candidates.map(o => [o.key, o]));
    // Waarmee gerekend is: aansluiting, bruikbare capaciteit en vermogen. De naam noemt vaak de nominale capaciteit.
    // Een capaciteit die de keuzehulp heeft aangenomen (bijvoorbeeld 90% van nominaal) staat er als aanname bij.
    const spec = c => {
      const input = inputs.get(c.key), b = input?.battery;
      const assumed = b && Data.isAssumed("usable_capacity_kwh", input.assumptions || "");
      return b ? h("p", { class: "help option-spec" }, [kinds.get(c.key) ? connectionText(c, kinds) : null,
        `${assumed ? "≈ " : ""}${n1(b.usable_capacity_kwh)} kWh bruikbaar${assumed ? " (aanname)" : ""}`,
        `${n1(b.discharge_power_kw)} kW ontladen, ${n1(b.charge_power_kw)} kW laden`].filter(Boolean).join(" · ")) : null;
    };
    // Dezelfde uitvoering of hetzelfde product (merk en product, het deel van de naam vóór ‘ · ’) met een andere
    // aansluiting: het verschil in één zin. Bij hetzelfde product de uitvoering met de dichtstbijzijnde capaciteit.
    const head = c => c.name.split(" · ")[0];
    const sibling = c => {
      const input = inputs.get(c.key), kind = kinds.get(c.key);
      if (!input || !kind) return null;
      const others = all.filter(o => o.key !== c.key && inputs.has(o.key) && kinds.get(o.key) && kinds.get(o.key) !== kind);
      const same = input.configuration_id == null ? null : others.find(o => inputs.get(o.key).configuration_id === input.configuration_id);
      const capacity = o => inputs.get(o.key).battery.usable_capacity_kwh;
      const other = same || (input.configuration_id == null || !c.name.includes(" · ") ? null : others
        .filter(o => inputs.get(o.key).configuration_id != null && head(o) === head(c))
        .sort((a, b) => Math.abs(capacity(a) - input.battery.usable_capacity_kwh) - Math.abs(capacity(b) - input.battery.usable_capacity_kwh))[0]);
      if (!other) return null;
      const kw = n1(inputs.get(other.key).battery.discharge_power_kw), diff = other.initial_investment_eur - c.initial_investment_eur;
      const how = { plug: "in een gewoon stopcontact", circuit: "op een eigen groep", fixed: "als vaste installatie" }[kinds.get(other.key)];
      return h("p", { class: "help" }, (same ? `Dezelfde accu ${how} (${kw} kW)` : `Hetzelfde product ${how} ` +
        `(${n1(capacity(other))} kWh bruikbaar, ${kw} kW)`) + `: netto voordeel ${eur0(other.npv_eur)}, ` +
        (Math.round(diff) === 0 ? "even duur in aanschaf." : `${eur0(Math.abs(diff))} ${diff < 0 ? "goedkoper" : "duurder"} in aanschaf.`));
    };
    for (const warning of result.warnings.filter(w => /FICTIEF|gemodelleerd|GESCHAT/i.test(w))) out.append(h("p",
      { class: "callout" }, warning));
    // Per accu dezelfde vier getallen en woorden als het korte antwoord; de rest ingeklapt. Geen accu is
    // de vergelijkingsbasis en krijgt geen kaart vol nullen.
    const card = c => c.key === "no_battery" ? [h("h3", {}, c.name),
      c.key === result.recommended_key ? badge("Aanbevolen", "accent") : null,
      h("p", { class: "help" }, "De vergelijkingsbasis: geen investering en geen besparing. Elke accu is met deze situatie vergeleken; " +
        "een positief netto voordeel betekent dat de accu beter uitkomt dan geen accu.")] : [h("h3", {}, c.name),
      c.key === result.recommended_key ? badge("Aanbevolen", "accent") : null,
      c.within_budget === false ? badge("Boven budget", "warning") : null, spec(c),
      stats([
        finite(c.break_even_investment_eur) ? ["Lonend tot", c.break_even_investment_eur > 0 ? roundedLimit(c.break_even_investment_eur) : "Zelfs gratis niet"] : null,
        ["Startinvestering nu", eur0(c.initial_investment_eur)], ["Netto voordeel (NPV)", eur0(c.npv_eur)],
        ["Terugverdiend na", years(c.payback_years)]
      ].filter(Boolean)), sibling(c),
      h("details", { class: "fold more-figures" }, h("summary", {}, "Meer cijfers"), stats([
        ["Nettowinst over looptijd", eur0(c.net_profit_eur)], ["ROI over looptijd", pct(c.roi_pct)],
        ["Eigen gebruik jaar 1", pct(c.first_year?.self_consumption_pct)],
        c.export_variant && run.input.request.parameters.export_variant
          ? [`Netto voordeel zonder terugleververgoeding vanaf ${run.input.request.parameters.export_variant.from_calendar_year}`,
            eur0(c.export_variant.npv_eur)] : null,
        warranty(run, c) ? [`Stopt na de garantie (${warranty(run, c).operating_life_years} jaar): lonend tot`,
          breakEven(warranty(run, c).result.break_even_investment_eur) ?? "—"] : null
      ].filter(Boolean)))];
    out.append(h("div", { class: "option-grid" }, shown(all).map(c => h("article", { class: `panel option${c.key === "no_battery" ? " baseline" : ""}`, style: `border-top-color:${c.color}` },
      card(c),
      c.key === result.export_variant_recommended_key && c.key !== result.recommended_key ? badge("Beste in de terugleveringsvariant", "") : null,
      kinds.get(c.key) === "plug" ? h("p", { class: "help" }, toAdvice()) : null))));
    if (more(all)) out.append(h("p", { class: "help" },
      `Hierboven geen accu en de beste ${TOP} van ${all.length - 1} doorgerekende accu’s; onder de grafiek staan ze allemaal.`));
    out.append(chart("range", {
      title: `Netto voordeel (NPV) per optie, met gevoeligheidsvarianten${more(all) ? ` (beste ${TOP} en geen accu)` : ""}`, unit: "€",
      rows: shown(all).map(c => ({ label: c.short, color: c.color,
        values: [c.pessimistic?.npv_eur, c.npv_eur, c.optimistic?.npv_eur] })),
      series: [{ label: "Ongunstig" }, { label: "Basis" }, { label: "Gunstig" }]
    }));
    if (more(all)) {
      const variant = run.input.request.parameters.export_variant && result.export_variant_recommended_key != null;
      out.append(rest(`Toon alle ${all.length} opties`, table(["Optie", "Aansluiting", "Startinvestering nu", "Lonend tot", "NPV", "ROI over looptijd", "Terugverdiend na", "Eigen gebruik jaar 1",
        ...(variant ? ["NPV terugleveringsvariant"] : [])], all.map(c => [
        c.key === result.recommended_key ? h("span", {}, c.name, " ", badge("Aanbevolen", "accent")) : c.name,
        c.key === "no_battery" ? "—" : connectionText(c, kinds), eur0(c.initial_investment_eur), c.key === "no_battery" ? "—" : breakEven(c.break_even_investment_eur) ?? "Niet berekend",
        eur0(c.npv_eur), c.key === "no_battery" ? "—" : pct(c.roi_pct),
        c.key === "no_battery" ? "—" : years(c.payback_years), pct(c.first_year?.self_consumption_pct),
        ...(variant ? [eur0(c.export_variant?.npv_eur)] : [])]),
      { caption: `Alle ${all.length} opties, op volgorde van je doel` })));
    }
    out.append(h("p", { class: "help" },
      "NPV is het netto voordeel tegenover geen accu, omgerekend naar geld van nu. ‘Lonend tot’ is de hoogste startinvestering (na teruggaven) waarbij de NPV nog nul is, met alle andere kosten gelijk. ROI is de nettowinst over de hele looptijd gedeeld door de startinvestering, geen jaarlijks rendement. De terugverdientijd blijft ook na latere vervangingskosten positief."));
    return out;
  }

  function cashflows(run, all) {
    const request = run.input.request, p = request.parameters, out = h("div");
    const horizon = run.result.candidates[0]?.years || [];
    const top = shown(all);
    // Het startpunt is wat je op tijdstip nul zelf betaalt: met een lening alleen het eigen deel. Afgeleid uit het
    // eerste jaar, zodat de lijn aansluit bij het cumulatieve verloop (ook bij oudere runs).
    const start = c => c.years[0] ? c.years[0].cumulative_eur - c.years[0].net_cashflow_eur : -c.initial_investment_eur;
    const rows = [{ label: "Start", values: top.map(start) },
      ...horizon.map((year, i) => ({ label: String(year.calendar_year), values: top.map(c => c.key === "no_battery" ? 0 : c.years[i]?.cumulative_eur) }))];
    const marks = [];
    for (const c of top.slice(1)) {
      if (c.payback_years != null) marks.push({ at: String(p.start_year + c.payback_years - 1), symbol: "✓",
        label: `${c.short}: blijvend terugverdiend na jaar ${c.payback_years}` });
      for (const cost of request.candidates.find(v => v.key === c.key)?.costs || []) {
        if (cost.status === "priced" && ["battery_replacement",
          "inverter_replacement"].includes(cost.category)) marks.push({ at: String(p.start_year + cost.year - 1),
          symbol: "↧", label: `${c.short}: vervanging einde jaar ${cost.year}` });
      }
    }
    out.append(chart("line", { title: `Cumulatief resultaat ten opzichte van geen accu${more(all) ? ` (beste ${TOP})` : ""}`, unit: "€", rows, series: top.map(c => ({ label: c.short, color: c.color })), marks }),
      h("p", { class: "help" }, "✓ markeert het jaar waarin een optie blijvend is terugverdiend; ↧ een ingevoerde vervanging."));
    const pick = UI.select(all.map(c => [c.key, c.short]), run.result.recommended_key), target = h("div");
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
        title: `Startinvestering per kostenpost${more(all) ? ` (beste ${TOP})` : ""}`, unit: "€",
        rows: top.map(c => ({ label: c.short, values: keys.map(k => linesOf(c)
          .filter(l => l.timing === "upfront" && l.category === k).reduce((sum, l) => sum + amount(l), 0)) })),
        series: keys.map(k => ({ label: label(k) }))
      }));
    }
    const pick = UI.select(all.slice(1).map(c => [c.key, c.short]), judged(run)?.key), target = h("div");
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
      return { label: c.short,
        values: [e.direct_solar_kwh, e.battery_to_load_kwh,
          known ? Math.max(0, e.consumption_kwh - e.direct_solar_kwh - e.battery_to_load_kwh) : null] };
    });
    out.append(chart("stacked", { title: `Waar komt je verbruik vandaan? (jaar 1${suffix})`, unit: "kWh", rows: demand, series: [{ label: "Direct van de panelen" }, { label: "Uit de accu" }, { label: "Van het net (afgeleid)" }] }),
      h("p", { class: "help" }, "Het netdeel is bruto verbruik min direct gebruikte zonnestroom en accustroom. De totale netafname bevat daarnaast het sluimerverbruik van de accu."));
    const destination = top.map(c => {
      const e = c.first_year || {},
        known = [e.production_kwh, e.direct_solar_kwh, e.battery_charge_kwh, e.grid_export_kwh].every(finite);
      return { label: c.short,
        values: [e.direct_solar_kwh, e.battery_charge_kwh, e.grid_export_kwh,
          known ? Math.max(0,
            e.production_kwh - e.direct_solar_kwh - e.battery_charge_kwh - e.grid_export_kwh) : null] };
    });
    out.append(chart("stacked",
      { title: `Waar gaat je zonnestroom heen? (jaar 1${suffix})`, unit: "kWh", rows: destination,
        series: [{ label: "Direct gebruikt" }, { label: "Naar de accu (incl. laadverlies)" },
          { label: "Teruggeleverd" }, { label: "Overig (o.a. sluimerverbruik)" }] }));
    const pick = UI.select(all.map(c => [c.key, c.short]), all[1]?.key), target = h("div");
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
    // Eerst de grafieken van de beste vijf, dan de tabellen; de overige opties staan ingeklapt.
    for (const [key, title, unit] of [["net_profit_eur", "Nettowinst over de looptijd", "€"], ["roi_pct", "ROI over de looptijd", "%"]]) {
      out.append(chart("range",
        { title: `${title}${more(all) ? ` (beste ${TOP})` : ""}`, unit,
          rows: shown(all).filter(c => key !== "roi_pct" || c.key !== "no_battery").map(c => ({ label: c.short, color: c.color,
            values: [c.pessimistic?.[key], c[key], c.optimistic?.[key]] })),
          series: [{ label: "Ongunstig" }, { label: "Basis" }, { label: "Gunstig" }] }));
    }
    const split = (headers, row) => [table(headers, shown(all).map(row)),
      more(all) ? rest(`Toon de overige ${all.length - TOP - 1} opties`, table(headers, all.slice(TOP + 1).map(row))) : null];
    const variants = c => [c.pessimistic, c, c.optimistic];
    out.append(...split(["Optie", "NPV ongunstig", "NPV basis", "NPV gunstig", "Nettowinst ongunstig", "Nettowinst basis",
      "Nettowinst gunstig", "ROI ongunstig", "ROI basis", "ROI gunstig"], c => [c.name,
      ...variants(c).map(v => eur0(v?.npv_eur)), ...variants(c).map(v => eur0(v?.net_profit_eur)),
      ...variants(c).map(v => c.key === "no_battery" ? "—" : pct(v?.roi_pct))]).filter(Boolean));
    const variant = p.export_variant;
    if (variant && run.result.export_variant_recommended_key != null) {
      out.append(h("h3", {}, `Terugleveringsvariant: ${variant.label}`),
        h("p", {}, `Vanaf ${variant.from_calendar_year} ${n(variant.export_eur_per_kwh, 4)} €/kWh vergoeding en ` +
          `${n(variant.export_fee_eur_per_kwh, 4)} €/kWh terugleverkosten; verder de basisaannames. Een aanname, geen voorspelling.`),
        ...split(["Optie", "NPV basis", "NPV variant", "Nettowinst variant", "ROI variant", "Terugverdiend na"], c => [
          c.name, eur0(c.npv_eur), eur0(c.export_variant?.npv_eur), eur0(c.export_variant?.net_profit_eur),
          c.key === "no_battery" ? "—" : pct(c.export_variant?.roi_pct), c.key === "no_battery" ? "—" : years(c.export_variant?.payback_years)])
          .filter(Boolean));
    }
    return out;
  }

  // Vragen voor de offerte, met de waarde waarmee gerekend is. Of een waarde een aanname is, staat in de
  // aannametekst van de keuzehulp (`describe` in data.js); in Zelf doorrekenen is de techniek eigen invoer.
  const VAT_URL = "https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/thuisbatterij-btw";
  // Hoogstens twee decimalen, zonder nullen aan het eind: 9,3 en 6,03.
  const plain = value => n(value, 2).replace(/,?0+$/, "");
  const withUnit = Data.quoteUnit;
  // Op papier: het getal met eenheid, of precies wat er stond als het geen getal is (nooit een verzonnen 0).
  const paperValue = (field, raw) => {
    const value = UI.parse(raw, { money: Data.isPriceField(field) });
    return value == null ? raw : withUnit(field, value);
  };
  // [vraag, velden in de offerte, waarde, aannamepatroon, wat geen antwoord is]
  // [vraag, velden, waarde, toelichting]; of een veld een aanname is, herkent `Data.isAssumed`.
  const CHECK = [
    ["Bruikbare capaciteit", ["usable_capacity_kwh"], b => `${plain(b.usable_capacity_kwh)} kWh bruikbaar`,
      "Niet de nominale of totale capaciteit: vraag hoeveel kWh je echt kunt gebruiken."],
    ["Laadvermogen aan de AC-kant", ["charge_power_kw"], b => `${plain(b.charge_power_kw)} kW`,
      "Hoeveel zonnestroom de accu per uur kan opnemen. Een DC- of PV-ingang telt niet."],
    ["Ontlaadvermogen aan de AC-kant", ["discharge_power_kw"], b => `${plain(b.discharge_power_kw)} kW`,
      "Wat de accu continu aan je huis levert. kVA is geen kW, en een piek van een paar seconden telt niet."],
    ["Rendement AC → AC, heen en terug", ["ac_round_trip_efficiency_pct"], b => `${plain(b.ac_round_trip_efficiency_pct)}%`,
      "‘Tot 95%’, een DC-rendement of het rendement van alleen de batterij is niet hetzelfde."],
    ["Sluimerverbruik van accu, omvormer en regeling samen", ["standby_w"], b => `${plain(b.standby_w)} W`,
      "Ook als de accu niets doet. ‘Zit in het rendement’ is geen antwoord."],
    ["Garantie: jaren, cycli of MWh doorvoer en gegarandeerde restcapaciteit", ["operating_life_years", "annual_capacity_loss_pct"],
      b => `${plain(b.operating_life_years)} jaar levensduur, ${plain(b.annual_capacity_loss_pct)}% capaciteitsverlies per jaar`,
      "Garantie is geen levensduur: in de berekening stopt de accu na de levensduur, en garantiejaren zijn vaak korter. Een gegarandeerde " +
        "restcapaciteit van 70% na 10 jaar is ongeveer 3,5% verlies per jaar. Vraag ook wie de garantie geeft, fabrikant of installateur, " +
        "en wat er gebeurt als de installateur stopt."]
  ];
  function quoteCheck(run, all, categories) {
    const request = run.input.request, result = run.result, out = h("div"), target = h("div");
    const own = input => !Data.fromKeuzehulp(input);
    // Standaard je eigen offerte als die er is, anders de besproken accu. Wint geen accu, dan is
    // `recommended_key` ‘no_battery’; die staat niet in de keuzelijst.
    const first = request.candidates.find(own)?.key ?? judged(run)?.key;
    const pick = UI.select(all.slice(1).map(c => [c.key, c.short]), first);
    const label = key => categories.find(c => c.key === key)?.label || key;
    const basis = request.quote_basis;
    // Wat je per optie uit de offerte overneemt, als tekst zoals ingetypt (9,3), en welke regels kloppen.
    // Bewaard in deze browser per berekening, zodat je de offerte in delen kunt nalopen; een gemak, geen opslag.
    const memoryKey = run.id != null ? `thuisaccu-offertecheck-${run.id}` : null;
    const quoted = Object.fromEntries(Object.entries(memoryKey ? UI.store.get(memoryKey, {}) : {})
      .map(([key, terms]) => [key, { ...terms, separate: new Set(terms.separate || []), ok: new Set(terms.ok || []) }]));
    const remember = () => { if (memoryKey) UI.store.set(memoryKey, Object.fromEntries(Object.entries(quoted)
      .map(([key, terms]) => [key, { ...terms, separate: [...(terms.separate || [])], ok: [...(terms.ok || [])] }]))); };
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
        ...CHECK.map(([question, fields, value, hint]) => {
          const assumed = !mine && fields.some(f => Data.isAssumed(f, input.assumptions)) && !fromQuote(fields);
          return { question, hint, fields, value: value(input.battery), origin: origin(assumed, fields), assumed };
        }),
        cost("Wat zit er in de prijs", "Omvormer, installatie, kabels en beveiliging, meterkast, aanmelding: staat alles erin? " +
          "Is het een vaste prijs of onder voorbehoud van een schouw? Vul de totaalprijs inclusief btw in; teruggaven en subsidie tellen apart.",
          [paper ? null : `${money(c.initial_investment_eur, { decimals: 0 })} startinvestering na teruggaven`,
            listed(paper ? "Gerekend met:" : "waarvan", priced, l => paper ? label(l.category) : `${label(l.category)} ${money(l.amount_minor / 100, { decimals: 0 })}`),
            listed("inbegrepen:", included, l => label(l.category)), listed("niet meegeteld:", skipped, l => label(l.category))]
            .filter(Boolean).join("; "),
          ["installation", "cabling_protection", "meter_cabinet", "grid_connection", "inverter", "ems_metering"], ["upfront_eur"]),
        cost("Aansluiting", "1- of 3-fase, past het op je huidige aansluiting, en is een eigen groep in de meterkast (NEN 1010) inbegrepen?",
          `Meterkast: ${status(line("meter_cabinet"))}; aansluiting: ${status(line("grid_connection"))}`, ["meter_cabinet", "grid_connection"]),
        { question: "Plaats", hint: "Waar komt de accu te staan? Telt niet als antwoord: in een kast of de meterkast, in de gang of " +
          "een andere loop- of vluchtroute. " + Data.RULES.placement, fields: [], value: "Niet meegerekend",
          origin: badge("veiligheid", "warning"), assumed: false },
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
        ? h("span", { class: "write-in" }, r.fields.map(f => answer(c, f).trim() ? paperValue(f, answer(c, f).trim()) : null).filter(Boolean).join(", "))
        : h("span", { class: "write-in" });
      const inputs = h("span", { class: "quote-inputs" }, r.fields.map(f => {
        const [, name, unit] = QUOTE_FIELDS.find(([key]) => key === f);
        const control = h("input", { type: "text", inputmode: "decimal", value: answer(c, f), placeholder: unit,
          "aria-label": `Offerte zegt: ${f === "upfront_eur" ? "totaalprijs inclusief btw" : name} (${unit === "€" ? "euro" : unit})`, size: "6" });
        control.addEventListener("input", () => { quoted[c.key][f] = control.value; remember(); });
        return control;
      }));
      return r.fields.includes("upfront_eur") ? h("div", {}, inputs, priceTerms(c)) : inputs;
    };
    // Bij een totaalprijs: welke apart geschatte posten erin zitten (standaard alle) en of het een vaste prijs is.
    const priceTerms = c => {
      const input = request.candidates.find(v => v.key === c.key), terms = (quoted[c.key] ||= {});
      terms.separate ||= new Set();
      const lines = input.costs.filter(l => l.timing === "upfront" && l.status === "priced" &&
        !CREDITS.includes(l.category) && !["battery", "contingency"].includes(l.category));
      const contingency = input.costs.find(l => l.category === "contingency" && l.status === "priced");
      const kind = UI.select([["", "Weet ik niet"], ["fixed", "Vaste prijs"], ["survey", "Onder voorbehoud van schouw"]], terms.price ?? "",
        { onchange: event => { terms.price = event.target.value; remember(); } });
      return h("div", { class: "price-terms" },
        lines.length ? h("fieldset", {}, h("legend", {}, "Telt als inbegrepen in je totaalprijs (vink uit wat de offerte niet noemt)"),
          lines.map(l => {
            const { box, element } = UI.checkbox(`${label(l.category)} (geschat ${money(l.amount_minor / 100, { decimals: 0 })})`,
              { checked: !terms.separate.has(l.category) });
            box.addEventListener("change", () => {
              if (box.checked) terms.separate.delete(l.category); else terms.separate.add(l.category);
              remember();
            });
            return element;
          })) : null,
        UI.field("Vaste prijs of onder voorbehoud van schouw?", kind, contingency
          ? `Alleen bij een vaste prijs vervalt de reserve voor meerwerk (${money(contingency.amount_minor / 100, { decimals: 0 })}); ` +
            "weet je het niet, dan blijft die reserve staan." : null));
    };
    // Op het scherm onthoudt elke ‘Klopt’ zich en telt mee; op papier is het een leeg vakje om af te vinken.
    const sheet = (c, paper = false) => {
      const list = rows(c, paper), terms = (quoted[c.key] ||= {});
      terms.ok ||= new Set();
      const count = h("p", { class: "help", "aria-live": "polite" });
      const tally = () => { count.textContent = `${list.filter(r => terms.ok.has(r.question)).length} van ${list.length} nagekeken.`; };
      const tick = r => {
        if (paper) return h("input", { type: "checkbox", "aria-label": `Klopt: ${r.question}` });
        const { box, element } = UI.checkbox("Klopt", { checked: terms.ok.has(r.question), "aria-label": `Klopt: ${r.question}` });
        box.addEventListener("change", () => { if (box.checked) terms.ok.add(r.question); else terms.ok.delete(r.question); remember(); tally(); });
        return element;
      };
      const grid = table(["Vraag aan de installateur", "Gerekend met", "Offerte zegt", "Klopt"],
        list.map(r => [h("span", {}, h("strong", {}, r.question), h("br"), h("small", {}, r.hint)),
          h("span", {}, r.value, " ", r.origin), cell(c, r, paper), tick(r)]),
        { className: "quote-check", stack: true });
      if (paper) return grid;
      tally();
      return h("div", {}, count, grid);
    };
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
      const changes = [], wrong = [], notes = [], terms = quoted[c.key] || {};
      let price = null;
      const copy = structuredClone(request), candidate = copy.candidates.find(v => v.key === c.key);
      for (const [field, name] of QUOTE_FIELDS) {
        const raw = answer(c, field).trim();
        if (!raw) continue;
        // Bedragen in hele centen, zoals de kostenposten.
        const parsed = UI.parse(raw, { money: Data.isPriceField(field) }),
          value = parsed != null && Data.isPriceField(field) ? Math.round(parsed * 100) / 100 : parsed;
        if (value == null || value < 0) { wrong.push(`${name} (${UI.parseProblem(raw, { money: Data.isPriceField(field) }) || "vul 0 of meer in"})`); continue; }
        if (field === "upfront_eur") {
          const separate = [...(terms.separate || [])];
          price = { total_eur: value, separate,
            terms: terms.price === "fixed" ? "fixed" : terms.price === "survey" ? "subject_to_survey" : "unknown" };
          Data.applyQuotePrice(candidate, field, value, { separate, fixedPrice: terms.price === "fixed" });
          notes.push(`totaalprijs ${Data.quoteUnit(field, value)}` +
            (separate.length ? `, apart gehouden: ${separate.map(label).join(", ")}` : "") +
            `, ${terms.price === "fixed" ? "vaste prijs" : terms.price === "survey" ? "onder voorbehoud van schouw" : "niet bekend of de prijs vast is"}`);
        } else if (field === "subscription_eur") Data.applyQuotePrice(candidate, field, value);
        else candidate.battery[field] = value;
        const before = Data.quoteValue(input, field), after = Data.quoteValue(candidate, field);
        if (Math.abs(after - before) > 1e-9) changes.push({ field, before, after });
      }
      if (wrong.length) { UI.toast(`Geen geldig getal bij ${wrong.join(", ")}.`, true); return; }
      if (!changes.length) { UI.toast("Vul eerst minstens één waarde uit de offerte in die afwijkt.", true); return; }
      candidate.assumptions = `${candidate.assumptions} Uit de offerte: ${[...changes.map(changeText), ...notes].join("; ")}.`.slice(0, 2000);
      delete copy.quote_basis;
      Scenario.load(copy, { title: `${request.title} · offerte`.slice(0, 200), step: 3,
        basis: { run_id: run.id, title: request.title, candidate_key: c.key,
          break_even_investment_eur: finite(c.break_even_investment_eur) ? c.break_even_investment_eur : null, changes,
          ...(price && changes.some(ch => ch.field === "upfront_eur") ? { price } : {}) } });
      UI.toast("Offertewaarden overgenomen. Controleer de invoer, bevestig en reken opnieuw; de oude berekening blijft bewaard.");
      location.hash = "#/zelf";
    });
    out.append(h("p", {}, "Leg deze lijst naast je offerte. Per vraag staat de waarde waarmee is gerekend; regels gemarkeerd ‘aanname’ komen niet uit een bron " +
      "en staan bovenaan. Vul de waarden uit de offerte in (bijvoorbeeld 9,3 of de totaalprijs) en reken opnieuw; de oude berekening blijft bewaard."),
      UI.field("Offertecheck voor", pick), target, h("div", { class: "actions" }, run.id == null ? null : again, print));
    return out;
  }

  function inputs(run, categories, all) {
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
    // De beste vijf eerst, de overige ingeklapt; de volgorde is die van de uitkomst.
    const order = new Map(all.map((c, i) => [c.key, i]));
    const candidates = [...request.candidates].sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
    const others = h("div");
    candidates.forEach((c, i) => {
      (i < TOP ? out : others).append(h("details", { class: "panel" }, h("summary", {}, c.name), h("p", {}, c.assumptions),
        table(["Techniek", "Waarde"],
          TECHNICAL.map(([key, text, unit]) => [text,
            finite(c.battery[key]) ? `${n(c.battery[key])} ${unit}` : "Onbekend"])),
        table(["Kostenpost", "Status", "Bedrag", "Moment", "Bron", "Toelichting"], c.costs.map(cost => [
          label(cost.category), Data.costStatus[cost.status],
            cost.status === "priced" ? money(cost.amount_minor / 100) : "—",
          `${TIMING[cost.timing]}${cost.year != null ? ` · einde jaar ${cost.year}` : ""}`,
          /^https:\/\//.test(cost.source) ? UI.external("bron", cost.source) : cost.source, cost.notes])),
        h("p", {}, `Financiering: ${money(c.financing.loan_amount_eur)} tegen ${pct(c.financing.annual_interest_pct)} rente, ${years(c.financing.years)}.`)));
    });
    if (others.children.length) out.append(rest(`Toon de invoer van de overige ${others.children.length} opties`, others));
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

  const outdated = run => run.result.model_version !== Data.MODEL_VERSION;
  // Rekent een run van een ouder rekenmodel met precies dezelfde invoer opnieuw en geeft het nummer van de
  // nieuwe aan `open`. Kan dat niet (profiel weg of veranderd), dan blijft de reden bij de knop staan.
  function recalculation(run, open) {
    const status = h("p", { class: "help", "aria-live": "polite" });
    const go = button("Reken opnieuw met het huidige model", () => UI.busy(go, async () => {
      status.textContent = "";
      try { open((await UI.api(`/api/v1/analysis/runs/${run.id}/recalculate`, { method: "POST" })).id); }
      catch (error) { status.textContent = error.message; }
    }), "secondary");
    return [go, status];
  }
  // Waar een herberekende run vandaan komt, met de grensprijs van de besproken accu ervoor en erna.
  function recalculatedFrom(run) {
    const from = run.input.recalculated_from, option = judged(run);
    if (!from) return null;
    const before = option && from.break_even_investment_eur?.[option.key], now = option?.break_even_investment_eur;
    const limit = value => value > 0 ? roundedLimit(value) : "zelfs gratis niet";
    const changes = Data.modelChanges(from.model_version, run);
    return h("span", {}, "Herberekend met het huidige rekenmodel op basis van ",
      link(`‘${from.title}’`, `#/berekeningen/${from.run_id}`), ". Invoer ongewijzigd, met de prijzen en tarieven van toen." +
      (finite(before) && finite(now) ? ` ${option.name}: lonend tot ${limit(before)} → ${limit(now)}.` : ""),
      changes.length ? [" Wat er sindsdien in het rekenmodel veranderde:", modelChangeList(changes)] : null);
  }
  // Wat er in het rekenmodel veranderde, met per verandering of die deze berekening raakt.
  const modelChangeList = changes => h("ul", { class: "compact" }, changes.map(({ text, affects }) => h("li", {}, text +
    (affects === false ? " Raakt deze berekening niet." : affects === true ? " Raakt deze berekening." : ""))));
  async function outdatedNote(run, shared) {
    const changes = Data.modelChanges(run.result.model_version, run);
    const unaffected = Data.unaffectedByModel(run);
    const note = h("div", { class: "callout", role: "note" }, h("p", {},
      "Sinds deze berekening is het rekenmodel verbeterd." + (unaffected ? " Geen van die verbeteringen raakt deze berekening, " +
      "dus de uitkomst blijft naar verwachting gelijk." : " De uitkomst kan daardoor afwijken van wat de app nu zou berekenen.") +
      (shared ? "" : " Opnieuw rekenen maakt een nieuwe berekening met precies dezelfde invoer en de prijzen en tarieven van toen; " +
      "deze blijft bewaard.")), changes.length ? modelChangeList(changes) : null);
    if (shared) return note;
    const newer = (await Data.runs().catch(() => [])).filter(r => r.input.recalculated_from?.run_id === run.id);
    UI.append(note, newer.length
      ? [h("p", {}, "Al opnieuw gerekend: ", newer.map((r, i) => [i ? ", " : "", link(r.title, `#/berekeningen/${r.id}`)]))]
      : recalculation(run, id => { location.hash = `#/berekeningen/${id}`; }));
    return note;
  }

  // De waarschuwingen als lijst. De garantiestresstest geeft per accu dezelfde zin; die worden één regel met een tabel
  // per accu, op de plaats van de eerste, zodat de andere waarschuwingen niet ondersneeuwen. Runs van vóór
  // 26 oktober 2026 missen ‘nooit gunstiger dan de basisaannames’.
  const STRESS_WARNING = /^Garantiestresstest bij (.+?): dezelfde berekening met (\d+) jaar levensduur en ([\d,]+)% capaciteitsverlies per jaar \((.*?)(?:; nooit gunstiger dan de basisaannames)?\)\. Het is een stresstest/;
  function warningItems(warnings) {
    const stress = warnings.map(w => w.match(STRESS_WARNING));
    const count = stress.filter(Boolean).length, first = stress.findIndex(Boolean);
    if (count < 2) return warnings.map(w => h("li", {}, w));
    const rows = stress.filter(Boolean).map(([, name, life, loss, basis]) => [name, `${life} jaar`, `${loss}% per jaar`, basis]);
    const grouped = h("li", {}, `Garantiestresstest voor ${count} accu’s: dezelfde berekening als de accu direct na zijn ` +
      "productgarantie stopt en elk jaar meer capaciteit verliest, nooit gunstiger dan de basisaannames. Het is een stresstest, " +
      "geen voorspelling; de keuze gebruikt de basisaannames.",
      fold("Per accu", table(["Accu", "Levensduur", "Capaciteitsverlies", "Herkomst"], rows,
        { caption: "Aannames in de garantiestresstest", stack: true })));
    return warnings.flatMap((w, i) => i === first ? [grouped] : stress[i] ? [] : [h("li", {}, w)]);
  }

  async function render(run, view, actions, onDuplicate, { shared = false } = {}) {
    const result = run.result, request = run.input.request, p = request.parameters, all = options(run);
    const costCatalog = await Data.costs(), categories = costCatalog.categories;
    // De soort aansluiting staat sinds 26 oktober 2026 in de run; bij oudere runs uit de catalogus. Zonder catalogus
    // (of bij een oude gedeelde run met onbekende accu's) blijft de soort onbekend en het stekkeradvies weg.
    const described = request.candidates.every(c => c.connection != null) ? new Map()
      : await Data.described(request.candidates).catch(() => new Map());
    // Een onbekende waarde (een link uit een nieuwere versie of met de hand aangepast) telt als onbekend.
    const kinds = new Map(request.candidates.map(c => [c.key, Data.CONNECTIONS.includes(c.connection) ? c.connection
      : c.connection == null ? Data.connectionOf(described.get(c.key)) : null]));
    shortNames(run, all, kinds);
    UI.append(actions, [shared ? null : button("Pas aan en reken opnieuw", () => onDuplicate(run), "secondary"),
      shared ? null : button("Deel als link", event => UI.busy(event.target, () => share(run)), "secondary"),
      button("Exporteer CSV", () => exportCsv(run), "secondary"), button("Afdrukken", () => window.print(), "secondary"),
      // Gewoon afdrukken geeft het korte antwoord, het overzicht en de waarschuwingen (styles.css); dit alle tabbladen.
      button("Alles afdrukken", () => {
        document.body.classList.add("print-all");
        addEventListener("afterprint", () => document.body.classList.remove("print-all"), { once: true });
        window.print();
      }, "ghost")]);
    if (shared) view.append(h("p", { class: "callout", role: "note" },
      "Gedeelde berekening: geopend uit een link en niet bewaard in je eigen berekeningen. Deze app heeft de uitkomst niet " +
      "opnieuw berekend, dus controleer de aannames en vertrouw alleen links van iemand die je kent." +
      (run.shared_of > result.candidates.length ? ` De link bevat ${result.candidates.length} van de ${run.shared_of} ` +
        "doorgerekende accu’s: de aanbevolen accu en de beste opties." : "")));
    const meta = h("p", { class: "help" },
      `${request.site.address} · ${run.input.profile?.filename || `Profiel ${request.solar_import_id}`} · ${Data.objectives[p.objective]} · ${p.horizon_years} jaar vanaf ${p.start_year} · ${UI.dateTime(run.created_at_unix_s)}`);
    if (isFictitious(run)) view.append(h("p", { class: "banner" },
      "FICTIEVE GEGEVENS: deze berekening gebruikt fictieve invoer en zegt niets over een echte woning."));
    if (outdated(run)) view.append(await outdatedNote(run, shared));
    // Een oude berekening rekent met de prijzen van toen; het model mag nog zo nieuw zijn.
    const age = Data.monthsBetween(new Date(run.created_at_unix_s * 1000), new Date());
    if (age >= 3) view.append(h("p", { class: "callout", role: "note" },
      `Deze berekening is ${age} maanden oud. Stroomprijs, terugleververgoeding en prijzen van accu’s en installatie zijn van toen` +
      (shared ? "." : ". Kijk ze na met ‘Pas aan en reken opnieuw’, of reken opnieuw in de keuzehulp voor de indicaties van nu.")));
    const warnings = warningItems(result.warnings);
    // Tabbladen in de volgorde waarin je ze gebruikt: na het overzicht de offertecheck en de kosten.
    // Op een telefoon komt het antwoord zo eerder in beeld; waar en waarmee gerekend is, staat eronder.
    view.append(verdict(run, kinds), meta, summary(run, kinds, costCatalog.estimates?.amounts?.dedicated_circuit, categories), tabs([
      { label: "Overzicht", content: overview(run, all, kinds) },
      { label: "Offertecheck", content: quoteCheck(run, all, categories) },
      { label: "Kostenopbouw", content: costs(run, all, categories) }, { label: "Kasstromen", content: cashflows(run, all) },
      { label: "Energie", content: energy(all) }, { label: "Gevoeligheid", content: sensitivity(run, all) },
      { label: "Invoer en aannames", content: inputs(run, categories, all) },
      { label: `Waarschuwingen (${warnings.length})`, content: h("ul", { class: "warnings print-keep" }, warnings) }
    ]));
  }

  return { render, isFictitious, fromShare, judged, breakEven, warranty, outdated, recalculation };
})();
