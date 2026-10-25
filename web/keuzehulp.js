"use strict";

// Keuzehulp: vijf stappen in gewone taal en daarna een doorrekening met zichtbare aannames.
// Antwoorden staan alleen als concept in deze browser; er gaat niets naar externe diensten.
(() => {
  const { h, field, numberInput, select, choice, checkbox, button, link, external, table, chart, money, kwh,
    number: n, parse, store } = UI;
  const STORE = "thuisaccu-keuzehulp";

  // Gedateerde indicaties uit openbare bronnen; alleen na een klik of keuze gebruikt.
  const INDICATION = {
    import: 0.2596,
    importText: "Indicatie € 0,26: gemiddeld variabel leveringstarief september 2026 (€ 0,1487, CBS) " +
      "plus energiebelasting 2026 (€ 0,11085), beide per kWh inclusief btw. Vaste en dynamische contracten wijken af.",
    importSources: [
      ["CBS: Verdeling energietarieven 2026 (september 2026)",
        "https://www.cbs.nl/nl-nl/maatwerk/2026/42/verdeling-energietarieven-2026"],
      ["ANWB: tarieven energiebelasting 2026", "https://www.anwb.nl/huis/energie/energiebelasting"]
    ],
    // Netto 1 cent per kWh: de mediaan van 15 leveranciers (salderingcheck.nl, 16 oktober 2026).
    export: 0.0615, exportFee: 0.0515,
    exportText: "Wat telt is het verschil tussen vergoeding en terugleverkosten. Voor een 1-jarig vast contract " +
      "vanaf 2027 lag dat bij 15 leveranciers tussen −4,3 en +4,4 cent per kWh, met een mediaan van 1,0 cent " +
      "(overzicht van salderingcheck.nl, peildatum 16 oktober 2026). Eneco rekent in een eigen voorbeeld met " +
      "€ 0,0506 vergoeding en € 0,0387 kosten: 1,2 cent netto. De indicatie gebruikt € 0,0615 vergoeding " +
      "(het wettelijke minimum van 50% van het kale leveringstarief volgens de ACM, bij het CBS-gemiddelde) " +
      "en € 0,0515 terugleverkosten: 1 cent netto.",
    exportSources: [
      ["ACM: salderen en terugleveren (minimaal 50% tot 2030)",
        "https://consument.acm.nl/elektriciteit-en-gas/duurzame-energie/wat-is-salderen"],
      ["Salderingcheck.nl: terugleververgoeding 2027 per leverancier",
        "https://salderingcheck.nl/terugleverkosten-per-leverancier-2026/"],
      ["Eneco: rekenvoorbeelden met en zonder salderen (peildatum 25 februari 2026)",
        "https://www.eneco.nl/klantenservice/einde-salderen/rekenvoorbeelden/"],
      ["Vattenfall: einde salderingsregeling 2027",
        "https://www.vattenfall.nl/zonnepanelen/salderen/salderingsregeling-2027/"]
    ],
    variantYear: 2030,
    variantText: "Tot 2030 moet de vergoeding minstens 50% van het kale leveringstarief zijn. Voor daarna is geen minimum " +
      "aangekondigd, en sommige leveranciers rekenen nu al meer kosten dan ze vergoeden. Deze variant rekent vanaf 2030 met " +
      "€ 0 vergoeding en dezelfde terugleverkosten. Het is een aanname, geen voorspelling."
  };
  // Regels en veiligheidsadvies rond aansluiten; gedateerde bronnen, geen juridisch advies.
  const RULES = {
    register: "Meld je thuisaccu aan bij je netbeheerder via energieleveren.nl. Volgens Netbeheer Nederland is dat verplicht, " +
      "net als voor zonnepanelen; dat geldt sinds een wijziging van de Netcode elektriciteit voor opslag vanaf 0,8 kW die op het " +
      "net is aangesloten. Aanmelden is gratis. Naar schatting is minder dan 40% van de thuisaccu’s aangemeld.",
    plug: "Milieu Centraal raadt stekkerbatterijen op dit moment niet aan, onder meer vanwege brandrisico: in één groep kan " +
      "stroom van twee kanten komen, van het net en van de accu. Een installateur sluit een accu volgens de NEN 1010-norm aan " +
      "op een aparte groep in de meterkast, niet op een stopcontact. Kies je toch voor een stekkerbatterij, gebruik dan een " +
      "vaste wandcontactdoos op een groep met weinig andere apparaten, geen verlengsnoer of stekkerdoos, en houd het " +
      "terugleververmogen op 800 W of minder. Die laatste adviezen geeft Milieu Centraal voor stekkerzonnepanelen; " +
      "ze gelden ook logisch voor een stekkerbatterij, maar zijn daarvoor niet afzonderlijk gepubliceerd.",
    sources: [
      ["Netbeheer Nederland: netbewust gebruik thuisbatterij (december 2024)",
        "https://www.netbeheernederland.nl/sites/default/files/2024-12/nbnl_netbewust-gebruik-thuisbatterij_a4_fc_.pdf"],
      ["Solar Magazine: registratie thuisbatterij en Netcode (8 mei 2024)",
        "https://solarmagazine.nl/nieuws-zonne-energie/i37394/verplichte-registratie-thuisbatterij-website-energieleveren-nl-vernieuwd"],
      ["Milieu Centraal: thuisbatterij (gewijzigd 28 september 2026)",
        "https://www.milieucentraal.nl/energie-besparen/zonnepanelen/thuisbatterij-zonne-energie-opslaan/"],
      ["Milieu Centraal: zonnepanelen met een stekker (gewijzigd 30 juni 2026)",
        "https://www.milieucentraal.nl/energie-besparen/zonnepanelen/zonnepanelen-met-een-stekker/"]
    ]
  };
  // Zinvol bereik op de capaciteitscurve: aandeel van wat een accu van 20 kWh zou opleveren.
  const SIZING = {
    value: { low: 0.75, high: 0.9, label: "Beste verhouding tussen prijs en opbrengst",
      detail: "Het bereik waarin je 75 tot 90% haalt van wat een accu van 20 kWh zou opleveren." },
    max: { low: 0.9, high: 0.97, label: "Zo veel mogelijk eigen zonnestroom",
      detail: "90 tot 97%: groter en duurder; de laatste kWh’s worden maar op weinig dagen helemaal gebruikt." }
  };
  const BLANK = {
    panels: "yes", data: "totals", importId: "", gridImport: "", gridExport: "", production: "", kwp: "",
      orientation: "south",
    heatPump: "", ev: "", evCharging: "evening",
    install: "any", phases: "unknown", place: "any", backup: "no",
    contract: "unknown", tariffImport: "", feedin: "indication", tariffExport: "", exportFee: "", variant: "yes",
    objective: "net_present_value", budget: "", horizon: "15", sizing: "value"
  };
  let answers = { ...BLANK, ...store.get(STORE, {}) }, yields = null, flow = null;
  // Concepten van vóór de terugleververgoedingsvraag: een ingevulde vergoeding blijft leidend.
  if (!("feedin" in store.get(STORE, {})) && answers.tariffExport) answers.feedin = "known";
  const save = () => store.set(STORE, answers);
  Data.typicalSources().then(s => { yields = s.pv.annual_kwh_per_kwp; }).catch(() => {});

  // Bruto verbruik = netafname + opwek − teruglevering. Klopt alleen zonder bestaande accu.
  function gross() {
    const imported = parse(answers.gridImport);
    if (imported == null) return null;
    if (answers.panels === "no") return imported;
    const exported = parse(answers.gridExport), produced = production();
    return exported == null || produced == null ? null : imported + produced - exported;
  }
  function production() {
    const own = parse(answers.production), kwp = parse(answers.kwp);
    if (own != null) return own;
    return kwp != null && yields ? kwp * yields[answers.orientation] : null;
  }

  // Herbouwt de stap na een keuze; de focus blijft op hetzelfde keuzerondje.
  function rerender() {
    const active = document.activeElement, name = active?.name, value = active?.value;
    flow.rerender();
    if (name) document.querySelector(`.wizard-body input[name="${name}"][value="${value}"]`)?.focus();
  }
  const pick = (key, legend, options, help) => choice(legend, `kh-${key}`, options, answers[key],
    v => { answers[key] = v; save(); rerender(); }, help);
  function amount(label, key, props, help, onInput) {
    const control = numberInput({ value: answers[key], ...props,
      oninput: event => { answers[key] = event.target.value; save(); onInput?.(); } });
    return field(label, control, help);
  }
  const sourceList = sources => h("details", { class: "sources" }, h("summary", {}, "Bronnen"),
    h("ul", {}, sources.map(([title, url]) => h("li", {}, external(title, url)))), h("p", { class: "help" }, `Geraadpleegd op ${Data.RESEARCHED_ON}.`));

  function stepEnergy(body) {
    body.append(h("h2", {}, "Je energie"),
      h("p", { class: "lead" },
        "Een accu slaat zonnestroom op die je overdag over hebt, zodat je die ’s avonds zelf gebruikt. Daarvoor kijken we naar je verbruik en je zonnepanelen."),
      pick("panels", "Heb je zonnepanelen?", [["yes", "Ja"], ["no", "Nee"]]),
      pick("data", "Welke gegevens heb je?", [
        ["totals", "Jaartotalen",
          "Van je jaarafrekening en de app van je omvormer. We maken er een geschat uurprofiel van."],
        ["file", "Een bestand met uur- of kwartierwaarden",
          "Een export van je omvormer of slimme meter (P1). Nauwkeuriger."]
      ]));
    if (answers.data === "file") {
      const target = h("div");
      body.append(target,
        h("p", { class: "actions" }, link("Importeer een bestand", "#/energie/import", "button secondary")));
      Data.imports().then(list => {
        const fit = list.filter(item => Data.suitability(item).ok === true);
        if (!fit.length) { target.append(h("p", { class: "callout" },
          "Je hebt nog geen bruikbaar bestand bewaard. Importeer eerst één volledig jaar met opwek en verbruik (of P1-afname en -teruglevering) en kom daarna terug."));
          return; }
        if (!fit.some(item => String(item.id) === answers.importId)) answers.importId = "";
        const control = select([["", "Kies een bewaard profiel…"], ...fit.map(item => [String(item.id), item.filename])], answers.importId,
          { required: true, onchange: event => { answers.importId = event.target.value; save(); } });
        target.append(field("Bewaard energieprofiel", control));
      }).catch(error => UI.toast(error.message, true));
      return;
    }
    const derived = h("p", { class: "derived", "aria-live": "polite" });
    const update = () => {
      const value = gross(), estimated = answers.panels === "yes" && parse(answers.production) == null;
      derived.textContent = value == null ? "Vul de getallen in om je totale verbruik te zien."
        : value <= 0 ? "Deze getallen kloppen niet: teruglevering is groter dan opwek plus afname."
        : `Je huis gebruikt in totaal ongeveer ${kwh(value)} per jaar${answers.panels === "yes" ? " (afname + opwek − teruglevering)" : ""}${estimated ? "; de opwek is geschat uit kWp" : ""}.`;
    };
    const grid = h("div", { class: "grid" },
      amount("Stroom van het net per jaar (kWh)", "gridImport", { min: "0", max: "100000", required: true }, "Op je jaarafrekening: ‘levering’ of ‘verbruik’. Bij een dag/nacht-meter tel je beide op.", update));
    if (answers.panels === "yes") {
      grid.append(
        amount("Teruggeleverd aan het net per jaar (kWh)", "gridExport",
          { min: "0", max: "100000", required: true }, "Op je jaarafrekening: ‘teruglevering’.", update),
        amount("Opwek van je panelen per jaar (kWh)", "production", { min: "0", max: "100000" },
          "In de app van je omvormer. Weet je het niet? Vul dan het vermogen in.", update),
        amount("Of: vermogen van je panelen (kWp)", "kwp", { min: "0.1", max: "100" },
          "Aantal panelen × wattpiek per paneel ÷ 1000, bijvoorbeeld 10 × 400 Wp = 4 kWp.", update),
        field("Ligging van de panelen", select([["south", "Zuid"], ["south_east", "Zuidoost"], ["south_west", "Zuidwest"], ["east_west", "Oost en west"], ["east", "Oost"], ["west", "West"]],
          answers.orientation, { onchange: event => { answers.orientation = event.target.value; save(); update(); } })));
    }
    const electric = h("fieldset", {}, h("legend", {}, "Warmtepomp of elektrische auto? (optioneel)"),
      h("p", { class: "help" }, "Deze verbruiken op andere momenten dan de rest van het huis: een warmtepomp vooral in de winter, " +
        "een auto als hij thuis laadt. Het verbruik zit al in je afname hierboven; we verdelen het alleen anders over het jaar. " +
        "Plan je er een? Tel het verwachte verbruik dan op bij je afname."),
      h("div", { class: "grid" },
        amount("Waarvan warmtepomp (kWh per jaar)", "heatPump", { min: "0", max: "30000" },
          "Staat vaak in de app of op het display van de warmtepomp. Ter indicatie: CE Delft rekent bij label B en 2 personen " +
          "met ongeveer 1.960 kWh voor verwarming en 1.000 kWh voor warm water.", rerenderEv),
        amount("Waarvan elektrische auto, thuis geladen (kWh per jaar)", "ev", { min: "0", max: "20000" },
          "Staat vaak in de app van je laadpaal of auto.", rerenderEv)));
    const evChoice = h("div");
    function rerenderEv() {
      update();
      evChoice.replaceChildren();
      if (parse(answers.ev) > 0) {
        evChoice.append(UI.choice("Wanneer laadt de auto meestal?", "kh-evCharging", [
          ["evening", "’s Avonds na thuiskomst", "Vanaf 18.00 uur met 3,7 kW."],
          ["night", "’s Nachts", "Vanaf 01.00 uur, bijvoorbeeld met een laadtimer."],
          ["daytime", "Overdag, op zonnestroom", "Vanaf 11.00 uur; alleen als de auto overdag thuis staat."]
        ], answers.evCharging, v => { answers.evCharging = v; save(); }));
      }
    }
    electric.append(evChoice);
    body.append(grid, derived, electric,
      h("p", { class: "help" },
        `We maken hiermee een geschat uurprofiel: het standaardverbruiksprofiel voor huishoudens (E1A 2026) en zonnedata van PVGIS voor De Bilt. Echte pieken en dalen zijn groter, dus de uitkomst is een indicatie. Je gegevens blijven ${Local.where}.`));
    rerenderEv();
  }

  function stepHome(body) {
    body.append(h("h2", {}, "Je woning"), h("p", { class: "lead" }, "Deze vragen bepalen welke accu’s praktisch passen."),
      pick("install", "Hoe wil je de accu aansluiten?", [
        ["plug", "Zelf, met de stekker", "Stekkerbatterij tot 800 W in een gewoon stopcontact. Goedkoper en kleiner, " +
          "geen installateur. Lees wel het veiligheidsadvies hieronder."],
        ["fixed", "Laten installeren",
          "Vaste aansluiting in de meterkast. Meer vermogen en capaciteit, hogere kosten."],
        ["any", "Weet ik nog niet", "We laten beide soorten zien."]]),
      answers.install === "fixed" ? null : h("div", { class: "callout" }, h("p", {}, RULES.plug)),
      pick("phases", "Wat voor aansluiting heb je?", [
        ["1", "1-fase", "Eén hoofdschakelaar in de meterkast, vaak 1×35 A of 1×40 A."],
        ["3", "3-fase", "Drie hoofdschakelaars of een brede driepolige schakelaar, vaak 3×25 A."],
        ["unknown", "Weet ik niet"]], "Een paar accu’s werken alleen op 3-fase. Stekkerbatterijen werken op beide."),
      pick("place", "Waar kan de accu staan?",
        [["inside", "Binnen", "Bijvoorbeeld meterkast, berging of zolder (vorstvrij)."],
          ["outside", "Buiten", "Tegen de gevel, in een schuur of garage."], ["any", "Maakt niet uit"]]),
      pick("backup", "Wil je noodstroom bij een stroomstoring?", [["no", "Niet nodig"], ["yes", "Ja, dat is belangrijk", "Veel accu’s schakelen bij een storing uit. Noodstroom vraagt extra onderdelen."]]));
  }

  function stepContract(body) {
    body.append(h("h2", {}, "Je energiecontract"),
      h("p", { class: "lead" }, "Vanaf 1 januari 2027 stopt de salderingsregeling. Stroom die je teruglevert, " +
        "levert dan minder op dan stroom die je koopt. Dat verschil bepaalt wat een accu bespaart."),
      pick("contract", "Wat voor contract heb je?", [
        ["fixed", "Vast"], ["variable", "Variabel"], ["dynamic", "Dynamisch (prijs per uur)"], ["unknown", "Weet ik niet"]]));
    if (answers.contract === "dynamic") {
      body.append(h("p", { class: "callout" }, "Met een dynamisch contract kan een accu ook verdienen door goedkoop te laden " +
        "en duur te gebruiken. Dat rekent de keuzehulp nog niet: we rekenen met een gemiddelde prijs, dus de uitkomst kan " +
        "lager uitvallen dan in werkelijkheid."));
    }
    const useImport = () => { answers.tariffImport = String(INDICATION.import); save(); rerender(); };
    body.append(
      h("div", { class: "grid" }, amount("Prijs voor stroom van het net (€ per kWh, alles inbegrepen)", "tariffImport",
        { min: "-1", max: "2", step: "0.0001", required: true }, INDICATION.importText)),
      h("p", { class: "actions" }, button("Gebruik de indicatie", useImport, "secondary")),
      sourceList(INDICATION.importSources),
      pick("feedin", "Wat krijg je vanaf 2027 voor teruggeleverde stroom?", [
        ["known", "Ik weet mijn vergoeding en terugleverkosten", "Staan in je contract of tariefoverzicht, per kWh."],
        ["indication", "Weet ik niet: reken met een indicatie",
          "€ 0,0615 vergoeding en € 0,0515 terugleverkosten per kWh."]
      ]));
    if (answers.feedin === "known") {
      body.append(h("div", { class: "grid" },
        amount("Terugleververgoeding vanaf 2027 (€ per kWh)", "tariffExport", { min: "-1", max: "2", step: "0.0001", required: true },
          "Bij een vast contract dat doorloopt na 2027: de vergoeding die in je contract staat."),
        amount("Terugleverkosten vanaf 2027 (€ per kWh)", "exportFee", { min: "0", max: "2", step: "0.0001", required: true },
          "Rekent je leverancier geen terugleverkosten per kWh, vul dan 0 in. Hogere terugleverkosten maken een accu gunstiger.")));
    }
    body.append(h("p", { class: "help" }, INDICATION.exportText), sourceList(INDICATION.exportSources),
      pick("variant", `Ook doorrekenen: vanaf ${INDICATION.variantYear} geen terugleververgoeding meer?`, [
        ["yes", "Ja, laat ook die uitkomst zien"], ["no", "Nee"]], INDICATION.variantText));
  }

  // Terugleverprijzen volgens de gekozen bron: eigen contract of de gedateerde indicatie.
  function feedIn() {
    if (answers.feedin === "indication") return { export: INDICATION.export, fee: INDICATION.exportFee };
    return { export: parse(answers.tariffExport), fee: parse(answers.exportFee) };
  }

  function stepGoal(body) {
    body.append(h("h2", {}, "Wat vind je belangrijk?"), h("p", { class: "lead" }, "We vergelijken elke passende accu met géén accu. ‘Geen accu’ kan ook de beste keuze zijn."),
      pick("objective", "Wanneer is een accu voor jou de beste?", [
        ["net_present_value", "Als hij over de hele looptijd het meeste oplevert",
          "Rekent toekomstige besparingen om naar geld van nu (netto contante waarde)."],
        ["payback", "Als ik mijn geld zo snel mogelijk terugverdien"],
        ["self_consumption", "Als ik zo veel mogelijk eigen zonnestroom gebruik", "Ook als dat financieel niet uitkomt."]]),
      h("div", { class: "grid" },
        amount("Maximaal budget (€, optioneel)", "budget", { min: "0", max: "100000", step: "1" },
          "Alle startkosten samen: accu, installatie en eventuele extra’s."),
        field("Hoe ver wil je vooruitkijken?", select([["10", "10 jaar"], ["15", "15 jaar"], ["20", "20 jaar"]], answers.horizon, { onchange: event => { answers.horizon = event.target.value; save(); } }))));
  }

  // Past een uitvoering bij de antwoorden? Harde bezwaren blokkeren, opmerkingen informeren.
  function fit(p) {
    const no = [], notes = [];
    if (answers.install === "plug" && p.kind === "fixed") no.push("Moet door een installateur worden aangesloten.");
    if (answers.install === "fixed" && p.kind === "plug") no.push("Dit is een stekkerbatterij, geen vaste installatie.");
    if (p.kind == null) notes.push("Soort aansluiting onbekend.");
    if (p.phases === 3 && answers.phases === "1") no.push("Werkt alleen op een 3-fasenaansluiting.");
    if (p.phases === 3 && answers.phases === "unknown") notes.push("Werkt alleen op een 3-fasenaansluiting; controleer je meterkast.");
    if (answers.backup === "yes") {
      if (p.backup?.status === "unsupported") no.push("Geen noodstroom.");
      else if (p.backup?.status === "conditional") notes.push(`Noodstroom onder voorwaarden: ${p.backup.conditions}`);
      else if (!p.backup || p.backup.status === "unknown") notes.push("Onbekend of noodstroom mogelijk is.");
    }
    if (answers.place === "outside" && p.outdoor?.status === "unsupported") no.push("Niet geschikt voor buiten.");
    if (/hybride/i.test(p.coupling) && p.kind === "plug") {
      notes.push("Heeft ook eigen zonne-ingangen (MPPT); panelen daarop aansluiten mag, maar hoeft niet. De berekening rekent met laden uit je overschot via het stopcontact.");
    } else if (/hybride/i.test(p.coupling)) notes.push("Hybride systeem: combineert met of vervangt je omvormer. Laat een installateur dat beoordelen.");
    if (/micro-omvormer/i.test(p.coupling)) notes.push("Zit tussen zonnepanelen en een aparte micro-omvormer: slaat alleen stroom op van de panelen die erop zijn aangesloten, en vermogens gelden aan de DC-kant.");
    else if (/DC/.test(p.coupling) && !/hybride/i.test(p.coupling)) notes.push("Heeft een geschikte (hybride) omvormer nodig.");
    if (p.missing.length) notes.push(`Kan nog niet worden doorgerekend: ${p.missing.join(" en ")} onbekend.`);
    if (!p.offer && p.otherOffer) {
      notes.push(`${p.otherOffer.seller} publiceert alleen een prijs ${p.otherOffer.tax_basis === "excluded"
        ? "zonder btw of na btw-teruggave" : "zonder vermelding van btw"}; vul je offertebedrag inclusief btw in.`);
    } else if (!p.offer) notes.push("Geen gepubliceerde prijs gevonden; vul een offertebedrag in om mee te rekenen.");
    return { ok: !no.length, no, notes };
  }

  async function ensureProfile() {
    if (answers.data === "file") {
      if (!answers.importId) throw new Error("Kies in stap 1 een bewaard energieprofiel.");
      return Number(answers.importId);
    }
    const consumption = gross();
    if (!(consumption > 0)) throw new Error("Vul in stap 1 je afname, teruglevering en opwek (of kWp) in.");
    const own = parse(answers.production);
    const solar = answers.panels === "yes" ? { orientation: answers.orientation, annual_production_kwh: own,
      peak_power_kwp: own == null ? parse(answers.kwp) : null } : null;
    const heatPump = parse(answers.heatPump), ev = parse(answers.ev);
    const json = {
      annual_consumption_kwh: consumption, solar,
      heat_pump_kwh: heatPump > 0 ? heatPump : undefined,
      ev: ev > 0 ? { annual_kwh: ev, charging: answers.evCharging } : undefined
    };
    return (await UI.api("/api/v1/solar/typical", { method: "POST", json })).id;
  }

  // Kostenopbouw met de gepubliceerde prijs als accupost; de overige posten zijn bronvermelde indicaties.
  function costLines(p, costCatalog) {
    const installation = p.offer.includes_installation === true ? ", inclusief installatie"
      : p.offer.includes_installation === false ? ", exclusief installatie" : "";
    return Data.estimateCosts(costCatalog, { kind: p.kind, manufacturer: p.config.manufacturer_name, phases: p.phases,
      inverterIncluded: p.inverterIncluded }, answers).map(line => line.category !== "battery" ? line : {
      ...line, status: "priced", amount_minor: p.offer.upfront_amount_minor,
      source: `${p.offer.seller}: ${p.offer.source_url} (geraadpleegd ${Data.RESEARCHED_ON})`,
      notes: `Gepubliceerde prijs inclusief btw${installation}.`
    });
  }

  // Waarom een accu niet meedoet in de berekening; null als hij wel meedoet.
  function exclusion(p, labels) {
    if (!p.fit.ok) return `Past niet: ${p.fit.no.join("; ")}`;
    if (p.missing.length) return `Gegevens ontbreken: ${p.missing.join(" en ")}`;
    if (!p.offer) return p.otherOffer ? "Alleen een prijs zonder btw gepubliceerd" : "Geen gepubliceerde prijs";
    const open = p.lines.filter(l => l.status === "unknown" && l.category !== "battery");
    return open.length ? `Kosten onbekend: ${open.map(l => labels[l.category]).join(", ")}` : null;
  }

  function buildRequest(importId, chosen) {
    const d = Data.defaults(), tariffImport = parse(answers.tariffImport), feed = feedIn();
    if (tariffImport == null) throw new Error("Vul in stap 3 je stroomprijs in, of kies ‘Gebruik de indicatie’.");
    if (feed.export == null || feed.fee == null) {
      throw new Error("Vul in stap 3 je terugleververgoeding en terugleverkosten in, of kies de indicatie.");
    }
    const variant = answers.variant === "yes" ? {
      label: `Geen terugleververgoeding vanaf ${INDICATION.variantYear}`, from_calendar_year: INDICATION.variantYear,
      export_eur_per_kwh: 0, export_fee_eur_per_kwh: feed.fee
    } : undefined;
    const candidates = chosen.map(p => ({ key: `c${p.config.id}`, name: p.name, configuration_id: p.config.id,
      battery: p.battery, costs: p.lines, financing: { loan_amount_eur: 0, annual_interest_pct: 0, years: 0 },
      assumptions: `Keuzehulp. ${p.notes.join(" ")}` }));
    return {
      title: `Keuzehulp ${new Date().toLocaleDateString("nl-NL")}`, solar_import_id: importId,
      site: { address: "Nederland (keuzehulp, geen adres opgegeven)", latitude: null, longitude: null, bag_id: null },
      parameters: {
        start_year: 2027, horizon_years: Number(answers.horizon), discount_pct: d.discount_pct,
          annual_cost_escalation_pct: d.annual_cost_escalation_pct,
        annual_pv_loss_pct: d.annual_pv_loss_pct, annual_load_growth_pct: d.annual_load_growth_pct,
          objective: answers.objective, budget_eur: parse(answers.budget),
        tariff: {
          import_eur_per_kwh: tariffImport, export_eur_per_kwh: feed.export, export_fee_eur_per_kwh: feed.fee,
          export_fee_bands: [], fixed_annual_eur: 0, annual_price_change_pct: d.annual_price_change_pct
        },
        price_uncertainty_pct: d.price_uncertainty_pct, cost_uncertainty_pct: d.cost_uncertainty_pct,
        export_variant: variant
      },
      candidates, costs_confirmed: true, technical_assumptions_confirmed: true, consumption_is_gross: true,
        production_is_ac: true
    };
  }

  function stepAdvice(body) {
    body.append(h("h2", {}, "Je advies"),
      h("p", { class: "help", "aria-live": "polite" }, "Je advies wordt voorbereid…"));
    advice(body).catch(error => body.replaceChildren(h("h2", {}, "Je advies"),
      h("p", { class: "warning" }, error.message), button("← Terug naar de vragen", () => flow.show(0), "secondary")));
  }
  async function advice(body) {
    const [importId, cmp, costCatalog] = await Promise.all([ensureProfile(), Data.catalog(true), Data.costs()]);
    const curve = await UI.api(`/api/v1/solar/imports/${importId}/capacity`);
    const points = curve.points, max = points[points.length - 1].battery_to_load_kwh;
    const at = share => points.find(p => p.battery_to_load_kwh >= share * max)?.usable_capacity_kwh;
    const rangeFor = key => max > 0 ? { low: at(SIZING[key].low), high: at(SIZING[key].high) } : null;
    if (!SIZING[answers.sizing]) answers.sizing = "value";
    // De rekenkern vergelijkt maximaal vijftig accu's tegelijk.
    const MAX_CANDIDATES = 50;
    let range = rangeFor(answers.sizing), included = [], renderPick = () => {};
    body.replaceChildren(h("h2", {}, "Je advies"));

    const size = h("section", { class: "panel" }, h("h3", {}, "1. Hoe groot moet een accu zijn?"));
    const sizeBody = h("div", { "aria-live": "polite" });
    const renderSize = () => {
      sizeBody.replaceChildren(
        h("p", { class: "lead" }, `Zonder accu gebruik je ongeveer ${n(points[0].self_consumption_pct, 0)}% van je zonnestroom zelf. ` +
          "Met een accu loopt dat op, maar elke extra kWh wordt minder vaak gevuld. " +
          `Voor ‘${SIZING[answers.sizing].label.toLowerCase()}’ past een bruikbare capaciteit van ongeveer ` +
          `${n(range.low, 0)} tot ${n(range.high, 0)} kWh.`),
        chart("line", {
          title: "Zonnestroom die je via de accu zelf gebruikt, per accugrootte",
          rows: points.map(p => ({ label: `${n(p.usable_capacity_kwh, 0)} kWh`, values: [p.battery_to_load_kwh] })),
          series: [{ label: "Uit de accu zelf gebruikt (kWh per jaar)" }], unit: "kWh/jaar",
          marks: [["low", "begin"], ["high", "einde"]].map(([key, word]) => ({
            at: `${n(range[key], 0)} kWh`, symbol: "│",
              label: `${word} van het zinvolle bereik: ${n(range[key], 0)} kWh`
          }))
        }));
    };
    if (!range) {
      size.append(h("p", {}, answers.panels === "no"
        ? "Zonder zonnepanelen is er geen zonnestroom om op te slaan. In deze berekening levert een accu dan niets op. " +
          "Met een dynamisch contract kan dat anders zijn; dat rekenen we nog niet."
        : "Je hebt vrijwel geen zonnestroom over om op te slaan. Een accu levert in deze berekening weinig op."));
    } else {
      const options = Object.entries(SIZING).map(([key, s]) => [key, s.label, s.detail]);
      size.append(
        UI.choice("Wat wil je met de accu bereiken?", "kh-sizing", options, answers.sizing, value => {
          answers.sizing = value; save(); range = rangeFor(value); renderSize();
          renderPick();
        }),
        sizeBody, h("p", { class: "help" }, curve.assumptions));
      renderSize();
    }

    const labels = Object.fromEntries(costCatalog.categories.map(c => [c.key, c.label]));
    const products = cmp.configurations.filter(c => c.product_kind === "battery_system").map(c => Data.describe(cmp, c))
      .map(p => ({ ...p, fit: fit(p) })).map(p => ({ ...p, lines: p.offer ? costLines(p, costCatalog) : null }))
      .map(p => ({ ...p, reason: exclusion(p, labels) }));
    const pickSection = h("section", { class: "panel" }, h("h3", {}, "2. Welke accu’s rekenen we door?"));
    if (!products.length) {
      pickSection.append(h("p", {}, "Er staan nog geen accu’s in je catalogus."),
        button("Laad onderzochte accu’s", event => UI.busy(event.target, async () => { await UI.api("/api/v1/references", { method: "POST" }); Data.invalidateCatalog(); flow.rerender(); })));
      body.append(size, pickSection); return;
    }
    // Iedere passende accu met een prijs en bekende kosten doet mee; de gebruiker hoeft niet te kiezen.
    // Boven de grens van de rekenkern gaan de accu's voor die het dichtst bij het zinvolle bereik liggen.
    const distance = p => !range ? 0 : Math.max(0, range.low - p.capacity, p.capacity - range.high);
    const position = p => !range ? "—" : p.capacity < range.low ? "Kleiner" : p.capacity > range.high ? "Groter" : "Binnen";
    const excluded = products.filter(p => p.reason).sort((a, b) => a.name.localeCompare(b.name, "nl"));
    const opened = { included: false, excluded: false }, pickBody = h("div");
    const group = (key, text, content) => {
      const box = h("details", { class: "product-group", open: opened[key] }, h("summary", {}, text), content);
      box.addEventListener("toggle", () => { opened[key] = box.open; });
      return box;
    };
    renderPick = () => {
      const eligible = products.filter(p => !p.reason)
        .sort((a, b) => distance(a) - distance(b) || a.capacity - b.capacity);
      included = eligible.slice(0, MAX_CANDIDATES).sort((a, b) => a.capacity - b.capacity);
      const age = Data.priceAge(), soort = { plug: "Stekker", fixed: "Vast" };
      pickBody.replaceChildren(...[
        h("p", {}, included.length
          ? `We rekenen ${eligible.length > included.length ? `de ${included.length} van de ${eligible.length}` : `alle ${included.length}`} ` +
            `accu’s door die bij je antwoorden passen en waarvan prijs, capaciteit en vermogen bekend zijn` +
            `${eligible.length > included.length ? " die het dichtst bij het zinvolle bereik liggen" : ""}, ` +
            "en vergelijken ze met geen accu. Je hoeft zelf niets te kiezen: de uitkomst laat zien welke optie het beste past bij je doel."
          : "Geen enkele accu past bij je antwoorden en heeft tegelijk een gepubliceerde prijs en volledige gegevens."),
        age.stale ? h("p", { class: "callout", role: "note" }, age.text) : null,
        h("p", { class: "help" }, `Gegevens en prijzen zijn bronmomentopnamen van ${Data.RESEARCHED_ON}; controleer de actuele prijs bij de verkoper. ` +
          "Heb je een offerte, of wil je een accu zonder gepubliceerde prijs meenemen? Gebruik ", link("Zelf doorrekenen", "#/zelf"), "."),
        included.length ? group("included", `Bekijk de ${included.length} accu’s die we doorrekenen`,
          table(["Accu", "Soort", "Bruikbaar", "Ontladen (AC)", "Prijs incl. btw", "Zinvol bereik"], included.map(p => [
            p.name, soort[p.kind] || "Onbekend", `${n(p.capacity, 1)} kWh`, `${n(p.dischargeKw, 1)} kW`,
            h("span", {}, external(money(p.offer.upfront_amount_minor / 100, { decimals: 0 }), p.offer.source_url),
              p.offer.includes_installation === false ? " excl. installatie" : ""),
            position(p)]), { caption: "Accu’s in de berekening", className: "product-table" })) : null,
        excluded.length ? group("excluded", `${excluded.length} ${excluded.length === 1 ? "accu" : "accu’s"} niet meegerekend, met de reden`,
          table(["Accu", "Waarom niet"], excluded.map(p => [p.name, p.reason]),
            { caption: "Accu’s buiten de berekening", className: "product-table" })) : null].filter(Boolean));
    };
    renderPick();
    pickSection.append(pickBody);
    const confirmations = [
      answers.data === "file" ? "Mijn bestand bevat de opwek van mijn omvormer en het totale verbruik van het huis (of P1-afname en -teruglevering waaruit dat is afgeleid), zonder bestaande accu." : "Ik begrijp dat mijn verbruik en opwek zijn geschat uit jaartotalen met standaardprofielen.",
      "Ik begrijp dat de accugegevens uit de bronnen komen, aangevuld met de genoemde aannames, en dat de keuzehulp niet controleert of een accu in mijn meterkast past.",
      "Ik begrijp dat de kosten indicaties zijn uit de genoemde bronnen en aannames, en dat een offerte voor mijn woning daarvoor in de plaats komt."
    ].map(text => checkbox(text));
    const status = h("p", { class: "help", "aria-live": "polite" });
    const go = button("Bereken mijn advies", () => UI.busy(go, async () => {
      if (!confirmations.every(c => c.box.checked)) throw new Error("Vink de drie bevestigingen aan.");
      if (!included.length) throw new Error("Er is geen accu om door te rekenen; reken een offerte door met Zelf doorrekenen.");
      status.textContent = `Bezig met rekenen aan ${included.length} ${included.length === 1 ? "accu" : "accu’s"}…`;
      const response = await UI.api("/api/v1/analysis/runs", { method: "POST", json: buildRequest(importId, included) });
      location.hash = `#/berekeningen/${response.id}`;
    }).finally(() => { status.textContent = ""; }));
    const run = h("section", { class: "panel" }, h("h3", {}, "3. Reken het door"),
      h("p", {},
        "Elke kostenpost heeft een indicatie met bron of aanname. Niet meegeteld: meerwerk dat pas bij de schouw blijkt (zoals hak- en breekwerk of een verouderde groepenkast), lokale subsidies en handel met een dynamisch contract. Laadverliezen, sluimerverbruik en capaciteitsverlies zitten al in de besparing."),
      h("fieldset", {}, h("legend", {}, "Bevestig"), confirmations.map(c => c.element)), go, status);
    const rules = h("section", { class: "panel" }, h("h3", {}, "4. Voordat je koopt"),
      h("p", {}, RULES.register), answers.install === "fixed" ? null : h("p", {}, RULES.plug),
      h("p", { class: "help" },
        "Dit is een samenvatting van openbare informatie, geen juridisch of installatieadvies."),
      sourceList(RULES.sources));
    body.append(size, pickSection, run, rules);
  }

  function check(index, body) {
    if (!UI.validate(body)) return false;
    if (index === 0 && answers.data === "file" && !answers.importId) { UI.toast("Kies een bewaard energieprofiel of kies ‘Jaartotalen’.",
      true);
      return false; }
    if (index === 0 && answers.data === "totals") {
      if (answers.panels === "yes" && parse(answers.production) == null && parse(answers.kwp) == null) { UI.toast("Vul de opwek van je panelen of het vermogen in kWp in.",
        true);
        return false; }
      const value = gross();
      if (value != null && !(value > 0)) { UI.toast("Deze getallen kloppen niet: teruglevering is groter dan opwek plus afname.",
        true);
        return false; }
      const extra = (parse(answers.heatPump) || 0) + (parse(answers.ev) || 0);
      if (value != null && extra > 0 && value - extra < 100) {
        UI.toast("Warmtepomp en auto zijn een deel van je totale verbruik en kunnen daar niet boven uitkomen.", true);
        return false;
      }
    }
    return true;
  }

  UI.page("keuzehulp", {
    nav: "Keuzehulp", icon: "help", title: "Welke thuisaccu past bij jou?",
      subtitle: "Vijf stappen in gewone taal. Duurt ongeveer vijf minuten.",
    render(view, actions) {
      actions.append(button("Begin opnieuw",
        () => { answers = { ...BLANK }; store.set(STORE, null); flow.show(0); }, "ghost"));
      flow = UI.wizard([
        { label: "Je energie", render: stepEnergy }, { label: "Je woning", render: stepHome },
          { label: "Je contract", render: stepContract },
        { label: "Wat je belangrijk vindt", render: stepGoal }, { label: "Advies", render: stepAdvice }
      ], { validate: check, onShow: () => window.scrollTo(0, 0) });
      view.append(flow.element); flow.show(0);
    }
  });
})();
