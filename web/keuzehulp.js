"use strict";

// Keuzehulp: vijf stappen in gewone taal en daarna een doorrekening met zichtbare aannames.
// Antwoorden staan alleen als concept in deze browser; er gaat niets naar externe diensten.
(() => {
  const { h, field, numberInput, select, choice, checkbox, button, link, external, table, chart, money, kwh,
    number: n, parse, store } = UI;
  const STORE = "thuisaccu-keuzehulp";

  const INDICATION = Data.INDICATION;
  const RULES = Data.RULES;
  // Zinvol bereik op de capaciteitscurve: aandeel van wat een accu van 20 kWh zou opleveren.
  const SIZING = {
    value: { low: 0.75, high: 0.9, label: "Veel opbrengst per kWh accu",
      detail: "Het bereik waarin je 75 tot 90% haalt van wat een accu van 20 kWh zou opleveren. Dit gaat over energie, niet over geld; wat financieel het beste uitkomt, laat de berekening zien." },
    max: { low: 0.9, high: 0.97, label: "Zo veel mogelijk eigen zonnestroom",
      detail: "90 tot 97%: groter en duurder; de laatste kWh’s worden maar op weinig dagen helemaal gebruikt." }
  };
  const BLANK = {
    panels: "yes", data: "totals", importId: "", usage: "grid", consumption: "", gridImport: "", gridExport: "", production: "", kwp: "",
      orientation: "south",
    heatPump: "", ev: "", evCharging: "evening",
    install: "any", phases: "unknown", place: "any", backup: "no",
    contract: "unknown", tariffImport: "", feedin: "indication", tariffExport: "", exportFee: "", variant: "yes",
    objective: "net_present_value", budget: "", horizon: "", sizing: "value", rangeLow: null, rangeHigh: null
  };
  // Zonder eigen keuze geldt de looptijd uit Instellingen.
  const horizon = () => answers.horizon || String(Data.defaults().horizon_years);
  let answers = null, yields = null, flow = null;
  // Bij elk bezoek opnieuw uit de opslag: andere schermen (zoals een energieprofiel) vullen het concept aan.
  function load() {
    const stored = store.get(STORE, {}) || {};
    answers = { ...BLANK, ...stored };
    // Concepten van vóór de terugleververgoedingsvraag: een ingevulde vergoeding blijft leidend.
    if (!("feedin" in stored) && answers.tariffExport) answers.feedin = "known";
  }
  const save = () => store.set(STORE, answers);
  Data.typicalSources().then(s => { yields = s.pv.annual_kwh_per_kwp; }).catch(() => {});

  // Bruto verbruik: rechtstreeks opgegeven, of netafname + opwek − teruglevering (klopt alleen zonder bestaande accu).
  function gross() {
    if (total()) return parse(answers.consumption);
    const imported = parse(answers.gridImport);
    if (imported == null) return null;
    if (answers.panels === "no") return imported;
    const exported = parse(answers.gridExport), produced = production();
    return exported == null || produced == null ? null : imported + produced - exported;
  }
  const total = () => answers.panels === "yes" && answers.usage === "total";
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
    const control = numberInput({ value: answers[key], name: `kh-${key}`, ...props,
      oninput: event => { answers[key] = event.target.value; save(); onInput?.(); } });
    return field(label, control, help);
  }
  const sourceList = sources => h("details", { class: "sources" }, h("summary", {}, "Bronnen"),
    h("ul", {}, sources.map(([title, url]) => h("li", {}, external(title, url)))), h("p", { class: "help" }, `Geraadpleegd op ${Data.RESEARCHED_ON}.`));

  function stepEnergy(body) {
    body.append(h("h2", {}, "Je energie"),
      h("p", { class: "lead" },
        "Een accu slaat zonnestroom op die je overdag over hebt, zodat je die ’s avonds zelf gebruikt. Daarvoor kijken we naar je verbruik en je zonnepanelen."),
      h("p", { class: "help" }, "Handig om erbij te pakken: je laatste jaarafrekening (verbruik en teruglevering in kWh) en de app of website van je omvormer (opwek per jaar)."),
      pick("panels", "Heb je zonnepanelen?", [["yes", "Ja"], ["no", "Nee"]]),
      // Meteen zeggen wat dat betekent, niet pas na vier stappen bij de uitkomst.
      ...(answers.panels === "no" ? [h("p", { class: "callout", role: "note" },
        "Zonder zonnepanelen levert een accu in deze berekening niets op: hij slaat alleen je eigen zonnestroom op, en we " +
        "rekenen met vaste stroomprijzen. Goedkoop laden van het net met een dynamisch contract rekenen we nog niet. Je kunt " +
        "doorgaan om dat met je eigen cijfers te zien. Komen er panelen? Kies dan ‘Ja’ en vul het verwachte vermogen (kWp) in.")] : []),
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
          "Je hebt nog geen bruikbaar bestand bewaard. Importeer eerst één volledig jaar met opwek en verbruik, of opwek samen met P1-afname en -teruglevering, en kom daarna terug."));
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
        : `Je huis gebruikt in totaal ongeveer ${kwh(value)} per jaar${answers.panels === "yes" && !total() ? " (afname + opwek − teruglevering)" : ""}${estimated ? "; de opwek is geschat uit kWp" : ""}.`;
    };
    if (answers.panels === "yes") body.append(pick("usage", "Wat weet je van je verbruik?", [
      ["grid", "Afname en teruglevering", "Van je jaarafrekening. We rekenen je totale verbruik zelf uit."],
      ["total", "Het totale verbruik van het huis",
        "Alles wat het huis gebruikt, ook de zonnestroom die je direct zelf gebruikt. Bijvoorbeeld uit een energiemonitor."]
    ]));
    const grid = h("div", { class: "grid" }, total()
      ? amount("Totaal verbruik per jaar (kWh)", "consumption", { min: "1", max: "100000", required: true },
        "Van het net én direct van je panelen, inclusief warmtepomp en auto.", update)
      : amount("Stroom van het net per jaar (kWh)", "gridImport", { min: "0", max: "100000", required: true },
        "Op je jaarafrekening: ‘levering’ (normaal plus dal bij een dag/nacht-meter), niet het verbruik na aftrek van teruglevering.", update));
    if (answers.panels === "yes") {
      if (!total()) grid.append(amount("Teruggeleverd aan het net per jaar (kWh)", "gridExport",
        { min: "0", max: "100000", required: true }, "Op je jaarafrekening: ‘teruglevering’. Bij een dag/nacht-meter tel je normaal en dal op.", update));
      grid.append(
        amount("Opwek van je panelen per jaar (kWh)", "production", { min: "0", max: "100000" },
          "In de app van je omvormer. Weet je het niet? Vul dan het vermogen in.", update),
        amount("Of: vermogen van je panelen (kWp)", "kwp", { min: "0.1", max: "100" },
          "Aantal panelen × wattpiek per paneel ÷ 1000, bijvoorbeeld 10 × 400 Wp = 4 kWp.", update),
        field("Ligging van de panelen", select([["south", "Zuid"], ["south_east", "Zuidoost"], ["south_west", "Zuidwest"], ["east_west", "Oost en west"], ["east", "Oost"], ["west", "West"]],
          answers.orientation, { onchange: event => { answers.orientation = event.target.value; save(); update(); } })));
    }
    const electric = h("fieldset", {}, h("legend", {}, "Warmtepomp of elektrische auto? (optioneel)"),
      h("p", { class: "help" }, "Deze verbruiken op andere momenten dan de rest van het huis: een warmtepomp vooral in de winter, " +
        "een auto als hij thuis laadt. Dit verbruik telt al mee in de getallen hierboven; we verdelen het alleen anders over het jaar. " +
        `Plan je er een? Tel het verwachte verbruik dan op bij je ${total() ? "totale verbruik" : "afname"}. ` +
        "Komt hij pas over een paar jaar? Tel hem dan hier niet op, maar kies na de uitkomst ‘Pas aan en reken opnieuw’ en vul bij ‘Verandering in verbruik’ in vanaf welk jaar."),
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
          "Een installateur sluit de accu vast aan in de meterkast: een vaste thuisaccu, of een stekkerbatterij op een eigen groep. " +
          "Meer vermogen en capaciteit, hogere kosten."],
        ["any", "Weet ik nog niet", "We laten alle soorten zien: stekker, vast en stekker op een eigen groep."]]),
      answers.install === "fixed" ? null : h("div", { class: "callout" }, h("p", {}, RULES.plug)),
      pick("phases", "Hoeveel fasen heeft je meterkast?", [
        ["1", "1-fase", "Eén hoofdschakelaar in de meterkast, vaak 1×35 A of 1×40 A."],
        ["3", "3-fase", "Drie hoofdschakelaars of een brede driepolige schakelaar, vaak 3×25 A."],
        ["unknown", "Weet ik niet"]], "Een paar accu’s werken alleen op 3-fase. Stekkerbatterijen werken op beide."),
      pick("place", "Waar kan de accu staan?",
        [["inside", "Binnen", "Bijvoorbeeld een berging, zolder of bijkeuken: vorstvrij en goed geventileerd, niet in een kast of de meterkast."],
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
    const useImport = () => { answers.tariffImport = UI.plain(INDICATION.import); save(); rerender(); };
    const { element: priceCheck, run: checkPrice } = UI.liveCheck(() => Data.importPriceCheck(parse(answers.tariffImport)));
    // De indicatie staat direct onder het veld: wie de prijs niet weet, ziet de uitweg naast de melding. De uitleg
    // over wat meetelt staat ingeklapt.
    body.append(
      h("div", { class: "grid" }, amount("Prijs voor stroom van het net (€ per kWh, alles inbegrepen)", "tariffImport",
        { min: "-1", max: "2", step: "0.0001", required: true, dataset: { missing: "Vul je prijs in, of kies ‘Gebruik de indicatie’." } },
        "Leveringstarief plus energiebelasting, inclusief btw, zonder vaste kosten per maand.", checkPrice)),
      h("p", { class: "actions" }, button(`Gebruik de indicatie (${money(INDICATION.import, { decimals: 4 })} per kWh)`, useImport, "secondary")),
      priceCheck,
      h("details", { class: "fold" }, h("summary", {}, "Wat telt mee in deze prijs?"),
        h("p", {}, INDICATION.importHelp), h("p", {}, INDICATION.importText)),
      sourceList(INDICATION.importSources),
      pick("feedin", "Wat krijg je vanaf 2027 voor teruggeleverde stroom?", [
        ["known", "Ik weet mijn vergoeding en terugleverkosten", "Staan in je contract of tariefoverzicht, per kWh."],
        ["indication", "Weet ik niet: reken met een indicatie",
          "€ 0,0615 vergoeding en € 0,0515 terugleverkosten per kWh."]
      ]));
    if (answers.feedin === "known") {
      const { element: feeCheck, run: checkFee } = UI.liveCheck(() => Data.exportCheck(parse(answers.tariffExport), parse(answers.exportFee)));
      body.append(h("div", { class: "grid" },
        amount("Terugleververgoeding vanaf 2027 (€ per kWh)", "tariffExport", { min: "-1", max: "2", step: "0.0001", required: true },
          "Bij een vast contract dat doorloopt na 2027: de vergoeding die in je contract staat.", checkFee),
        amount("Terugleverkosten vanaf 2027 (€ per kWh)", "exportFee", { min: "0", max: "2", step: "0.0001", required: true },
          "Per kWh die je teruglevert. Een vast bedrag per jaar is geen 0: vraag wat het vanaf 2027 per kWh kost, of kies de " +
          "indicatie. Alleen zonder terugleverkosten vul je 0 in. Hogere terugleverkosten maken een accu gunstiger.", checkFee)), feeCheck);
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
        amount("Maximaal budget (€, optioneel)", "budget", { min: "0", max: "100000", step: "1", money: true },
          "Alle startkosten samen: accu, installatie en eventuele extra’s."),
        field("Hoe ver wil je vooruitkijken?", select([...new Set(["10", "15", "20", horizon()])].sort((a, b) => a - b)
          .map(years => [years, `${years} jaar`]), horizon(), { onchange: event => { answers.horizon = event.target.value; save(); } }),
          "Kies hoe lang je verwacht in dit huis te blijven. Jaren daarna tellen niet mee en de accu heeft dan geen restwaarde; een kortere looptijd valt dus ongunstiger uit. " +
          "Een stekkerbatterij neem je mee als je verhuist; kijk voor die accu’s eerder naar de langere looptijd.")));
  }

  // Past een uitvoering bij de antwoorden? Harde bezwaren blokkeren, opmerkingen informeren.
  function fit(p) {
    const no = [], notes = [];
    if (answers.install === "plug" && p.kind === "fixed") no.push("Moet door een installateur worden aangesloten.");
    if (answers.install === "fixed" && p.kind === "plug") no.push(p.hasCircuit ? "Als stekker in een stopcontact geen vaste " +
      "installatie; dezelfde accu op een eigen groep door een elektricien doet wel mee (afgeleid)." : "Dit is een stekkerbatterij, geen vaste installatie.");
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
    if (!(consumption > 0)) throw new Error(`Vul in stap 1 je ${total() ? "totale verbruik" : "afname, teruglevering"} en opwek (of kWp) in.`);
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

  // Past het geschatte profiel bij de opgegeven afname en teruglevering? Jaartotalen bepalen geen
  // uurprofiel; een afwijking wordt daarom getoond en bij de berekening vastgelegd, niet weggewerkt.
  function profileCheck(points) {
    if (answers.data !== "totals" || answers.panels !== "yes" || total()) return null;
    const produced = production(), imported = parse(answers.gridImport), exported = parse(answers.gridExport);
    if (!(produced > 0) || imported == null || exported == null) return null;
    const reported = (produced - exported) / produced * 100, modelled = points[0].self_consumption_pct;
    // Zonder bestaande accu kan een accu hooguit vervangen wat je terugleverde én wat je afnam.
    const ceiling = Math.min(imported, exported), curveMax = points[points.length - 1].battery_to_load_kwh;
    const parts = [`Volgens je jaarafrekening gebruik je ${n(reported, 0)}% van je zonnestroom direct zelf ` +
      `(opwek ${n(produced, 0)} kWh − teruglevering ${n(exported, 0)} kWh); het geschatte profiel gaat uit van ${n(modelled, 0)}%. ` +
      "De berekening rekent met dat geschatte profiel, want een jaarafrekening zegt niet op welk uur je stroom gebruikt."];
    const gap = reported - modelled;
    if (gap >= 10) parts.push("Je gebruikt overdag dus meer zelf dan het standaardprofiel. Er blijft minder over om op te slaan, " +
      "dus de besparing met een accu valt waarschijnlijk lager uit dan berekend.");
    else if (gap <= -10) parts.push("Je levert dus meer terug dan het standaardprofiel. De besparing met een accu kan hoger uitvallen dan berekend.");
    if (curveMax > ceiling) parts.push(`Met jouw jaartotalen kan een accu hooguit ${n(ceiling, 0)} kWh per jaar van het net vervangen ` +
      `(het kleinste van afname en teruglevering, zonder verliezen); de grafiek gaat tot ${n(curveMax, 0)} kWh.`);
    return { warn: Math.abs(gap) >= 10 || curveMax > ceiling, text: parts.join(" ") };
  }

  // Waarom een accu niet meedoet in de berekening; null als hij wel meedoet.
  function exclusion(p, labels) {
    if (!p.fit.ok) return `Past niet: ${p.fit.no.join("; ")}`;
    if (p.missing.length) return `Gegevens ontbreken: ${p.missing.join(" en ")}`;
    if (!p.offer) return p.otherOffer ? "Alleen een prijs zonder btw gepubliceerd" : "Geen gepubliceerde prijs";
    const open = p.lines.filter(l => l.status === "unknown" && l.category !== "battery");
    if (open.length) return `Kosten onbekend: ${open.map(l => labels[l.category]).join(", ")}`;
    // Boven het budget kan een accu nooit de aanbeveling worden; hij zou alleen een plek in de berekening innemen.
    const budget = parse(answers.budget, { money: true }), upfront = startCosts(p.lines);
    return budget != null && upfront > budget
      ? `Boven je budget van ${money(budget, { decimals: 0 })}: startkosten ongeveer ${money(upfront, { decimals: 0 })}` : null;
  }
  const plugLimit = Data.plugLimit;
  // Som van de startposten zoals de rekenkern die telt; teruggaven verlagen de kosten.
  const startCosts = lines => Data.upfrontCosts(lines);

  // `range`: het bereik van bruikbare capaciteit uit stap 1 van deze pagina, of null; het rekent niet mee.
  function buildRequest(importId, chosen, check, range = null) {
    const d = Data.defaults(), tariffImport = parse(answers.tariffImport), feed = feedIn();
    if (tariffImport == null) throw new Error("Vul in stap 3 je stroomprijs in, of kies ‘Gebruik de indicatie’.");
    if (feed.export == null || feed.fee == null) {
      throw new Error("Vul in stap 3 je terugleververgoeding en terugleverkosten in, of kies de indicatie.");
    }
    // Een later startjaar of een korte looptijd uit Instellingen schuift de stresstest mee; het model eist dat hij
    // binnen de looptijd begint.
    const variantYear = Math.min(Math.max(INDICATION.variantYear, d.start_year), d.start_year + Number(horizon()) - 1);
    const variant = answers.variant === "yes" ? {
      label: `Geen terugleververgoeding vanaf ${variantYear}`, from_calendar_year: variantYear,
      // De terugleverkosten van de indicatie bestaan alleen om op 1 cent netto uit te komen; zonder vergoeding zou dat
      // −5 cent per kWh worden, een getal dat geen leverancier noemt. Met de indicatie levert teruglevering dan niets op.
      export_eur_per_kwh: 0, export_fee_eur_per_kwh: answers.feedin === "indication" ? 0 : feed.fee
    } : undefined;
    const candidates = chosen.map(p => ({ key: `${p.derived ? "g" : "c"}${p.config.id}`, name: p.name, configuration_id: p.config.id,
      battery: p.battery, costs: p.lines, financing: { loan_amount_eur: 0, annual_interest_pct: 0, years: 0 },
      warranty_stress: p.warrantyStress ?? undefined, connection: Data.connectionOf(p) ?? undefined,
      assumptions: [Data.KEUZEHULP_PREFIX, check?.text, ...p.notes].filter(Boolean).join(" ") }));
    // De titel zegt waarmee is gerekend; de datum staat al bij elke berekening.
    const usage = answers.data === "file" ? null : gross(), solar = answers.panels === "yes" ? production() : null;
    const about = answers.data === "file" ? ["eigen meetbestand"] : [usage == null ? null : `${n(usage, 0)} kWh verbruik`,
      answers.panels === "no" ? "geen zonnepanelen" : solar == null ? null : `${n(solar, 0)} kWh opwek`];
    // De gekozen aansluiting onderscheidt anders gelijke berekeningen in Mijn berekeningen.
    about.push({ plug: "stekker", fixed: "met installateur", any: "alle aansluitingen" }[answers.install]);
    return {
      title: ["Keuzehulp", about.filter(Boolean).join(", ")].filter(Boolean).join(": "), solar_import_id: importId,
      site: { address: "Nederland (keuzehulp, geen adres opgegeven)", latitude: null, longitude: null, bag_id: null },
      parameters: {
        start_year: d.start_year, horizon_years: Number(horizon()), discount_pct: d.discount_pct,
          annual_cost_escalation_pct: d.annual_cost_escalation_pct,
        annual_pv_loss_pct: d.annual_pv_loss_pct, annual_load_growth_pct: d.annual_load_growth_pct,
          objective: answers.objective, budget_eur: parse(answers.budget, { money: true }),
        tariff: {
          import_eur_per_kwh: tariffImport, export_eur_per_kwh: feed.export, export_fee_eur_per_kwh: feed.fee,
          export_fee_bands: [], fixed_annual_eur: 0, annual_price_change_pct: d.annual_price_change_pct
        },
        price_uncertainty_pct: d.price_uncertainty_pct, cost_uncertainty_pct: d.cost_uncertainty_pct,
        export_variant: variant, load_variation: "households"
      },
      candidates, costs_confirmed: true, technical_assumptions_confirmed: true, consumption_is_gross: true,
        production_is_ac: true,
      ...(range ? { sizing_range: { label: SIZING[answers.sizing]
        ? `het zinvolle bereik voor ‘${SIZING[answers.sizing].label.replace(/^./, c => c.toLowerCase())}’` : "je eigen bereik",
      low_kwh: range.low, high_kwh: range.high } } : {})
    };
  }

  // Je antwoorden per stap, zodat je ze vóór het berekenen nakijkt; ‘Wijzig’ gaat terug naar die stap.
  function recap() {
    const price = v => v == null ? "Onbekend" : `${money(v, { decimals: 4 }).replace(/0{1,2}$/, "")} per kWh`;
    const words = { install: { plug: "zelf, met de stekker", fixed: "laten installeren", any: "nog niet gekozen" },
      phases: { 1: "1-fase", 3: "3-fase", unknown: "onbekend" }, place: { inside: "binnen", outside: "buiten", any: "maakt niet uit" },
      contract: { fixed: "vast", variable: "variabel", dynamic: "dynamisch", unknown: "onbekend" },
      objective: { net_present_value: "het meeste over de looptijd", payback: "snel terugverdienen", self_consumption: "zo veel mogelijk eigen zonnestroom" } };
    const fileName = answers.data === "file" ? "een bewaard energieprofiel" : null, made = production(), use = gross();
    const extra = [parse(answers.heatPump) > 0 ? `warmtepomp ${kwh(parse(answers.heatPump))}` : null,
      parse(answers.ev) > 0 ? `auto ${kwh(parse(answers.ev))}` : null].filter(Boolean);
    const { export: paid, fee } = feedIn();
    const groups = [
      ["Je energie", fileName ? [`Uit ${fileName}`] : [
        `Verbruik ${use == null ? "onbekend" : `${kwh(use)} per jaar`}`,
        answers.panels === "no" ? "Geen zonnepanelen" : `Opwek ${made == null ? "onbekend" : `${kwh(made)} per jaar`}` +
          (parse(answers.production) == null && made != null ? " (geschat uit kWp)" : ""),
        extra.length ? `Waarvan ${extra.join(" en ")}` : null]],
      ["Je woning", [`Aansluiten: ${words.install[answers.install]}`, `Meterkast ${words.phases[answers.phases]}`,
        `Plek: ${words.place[answers.place]}`, answers.backup === "yes" ? "Noodstroom gewenst" : "Noodstroom niet nodig"]],
      ["Je contract", [`Contract ${words.contract[answers.contract]}`, `Stroom ${price(parse(answers.tariffImport))}`,
        `Vanaf 2027: vergoeding ${price(paid)}, terugleverkosten ${price(fee)}${answers.feedin === "indication" ? " (indicatie)" : ""}`]],
      ["Wat je belangrijk vindt", [`Doel: ${words.objective[answers.objective]}`,
        parse(answers.budget, { money: true }) != null ? `Budget ${money(parse(answers.budget, { money: true }), { decimals: 0 })}` : "Geen budget",
        `Looptijd ${horizon()} jaar`]]
    ];
    return h("details", { class: "panel recap", open: true }, h("summary", {}, "Je antwoorden"),
      h("dl", {}, groups.map(([title, lines], i) => h("div", {}, h("dt", {}, title,
        button("Wijzig", () => flow.show(i), "ghost", { "aria-label": `Wijzig ${title.toLowerCase()}` })),
        h("dd", {}, lines.filter(Boolean).join(" · "))))));
  }

  function stepAdvice(body) {
    body.append(h("h2", {}, "Controleren en berekenen"),
      h("p", { class: "help", "aria-live": "polite" }, "De berekening wordt voorbereid…"));
    advice(body, flow.current).catch(error => body.replaceChildren(h("h2", {}, "Controleren en berekenen"),
      h("p", { class: "warning" }, error.message), button("← Terug naar de vragen", () => flow.show(0), "secondary")));
  }
  // `step` is de stap waarvoor dit begon; is de gebruiker intussen verder, dan komt de knop niet in de balk.
  async function advice(body, step) {
    const [importId, cmp, costCatalog] = await Promise.all([ensureProfile(), Data.catalog(true), Data.costs()]);
    const curve = await UI.api(`/api/v1/solar/imports/${importId}/capacity`);
    const points = curve.points, max = points[points.length - 1].battery_to_load_kwh;
    const largest = points[points.length - 1].usable_capacity_kwh;
    // Capaciteit waarbij een aandeel van de opbrengst gehaald wordt, lineair tussen twee punten van de curve
    // en afgerond op de stap van de schuifregelaars; het eerste punt erboven zou bij een grof raster ver doorschieten.
    const at = share => {
      const target = share * max, i = points.findIndex(p => p.battery_to_load_kwh >= target);
      if (i <= 0) return points[Math.max(0, i)].usable_capacity_kwh;
      const [a, b] = [points[i - 1], points[i]];
      const x = a.usable_capacity_kwh + (b.usable_capacity_kwh - a.usable_capacity_kwh) *
        (target - a.battery_to_load_kwh) / (b.battery_to_load_kwh - a.battery_to_load_kwh);
      return Math.round(x * 2) / 2;
    };
    const rangeFor = key => {
      if (!(max > 0)) return null;
      const low = at(SIZING[key].low);
      return { low, high: Math.min(largest, Math.max(low + 0.5, at(SIZING[key].high))) };
    };
    // Aandeel van de opbrengst bij de grootste accu, lineair tussen twee punten van de curve; alleen voor de weergave.
    const shareAt = capacity => {
      const i = points.findIndex(p => p.usable_capacity_kwh >= capacity);
      if (i <= 0) return (i < 0 ? max : points[0].battery_to_load_kwh) / max;
      const [a, b] = [points[i - 1], points[i]];
      return (a.battery_to_load_kwh + (b.battery_to_load_kwh - a.battery_to_load_kwh) *
        (capacity - a.usable_capacity_kwh) / (b.usable_capacity_kwh - a.usable_capacity_kwh)) / max;
    };
    const clamp = v => Math.min(largest, Math.max(0, v));
    const own = answers.sizing === "custom" && Number.isFinite(answers.rangeLow) && Number.isFinite(answers.rangeHigh)
      ? { low: clamp(Math.min(answers.rangeLow, answers.rangeHigh)), high: clamp(Math.max(answers.rangeLow, answers.rangeHigh)) } : null;
    if (!SIZING[answers.sizing] && !own) answers.sizing = "value";
    // De rekenkern vergelijkt maximaal vijftig accu's tegelijk. Zonder zinvol bereik levert een accu weinig of niets
    // op; dan rekenen we ter controle alleen de goedkoopste door, zodat de berekening niet onnodig lang duurt.
    const MAX_CANDIDATES = 50, FEW_CANDIDATES = 5;
    let range = max > 0 && own ? own : rangeFor(answers.sizing), included = [], renderPick = () => {};
    const size1 = v => n(v, v % 1 ? 1 : 0), kwhText = v => `${size1(v)} kWh`;
    body.replaceChildren(h("h2", {}, "Controleren en berekenen"), recap());

    const check = profileCheck(points);
    const size = h("section", { class: "panel" }, h("h3", {}, "1. Hoe groot moet een accu zijn?"),
      check ? h("p", { class: check.warn ? "callout" : "help", role: "note" }, check.text) : null);
    const sizeBody = h("div", { "aria-live": "polite" });
    const renderSize = () => {
      sizeBody.replaceChildren(
        h("p", { class: "lead" }, `${answers.data === "totals" ? "Volgens het geschatte profiel gebruik je zonder accu" : "Zonder accu gebruik je"} ` +
          `ongeveer ${n(points[0].self_consumption_pct, 0)}% van je zonnestroom zelf. ` +
          "Met een accu loopt dat op, maar elke extra kWh wordt minder vaak gevuld. " +
          (SIZING[answers.sizing] ? `Voor ‘${SIZING[answers.sizing].label.replace(/^./, c => c.toLowerCase())}’ past een bruikbare capaciteit van ongeveer `
            : "Je eigen bereik is een bruikbare capaciteit van ") +
          `${size1(range.low)} tot ${kwhText(range.high)}: ongeveer ${n(shareAt(range.low) * 100, 0)} tot ` +
          `${n(shareAt(range.high) * 100, 0)}% van wat een accu van ${kwhText(largest)} zou opleveren.`),
        chart("line", {
          title: "Zonnestroom die je via de accu zelf gebruikt, per accugrootte",
          rows: points.map(p => ({ label: `${n(p.usable_capacity_kwh, 0)} kWh`, x: p.usable_capacity_kwh,
            values: [p.battery_to_load_kwh] })),
          series: [{ label: "Uit de accu zelf gebruikt (kWh per jaar)" }], unit: "kWh per jaar", xLabel: "Bruikbare capaciteit van de accu",
          marks: [["low", "begin"], ["high", "einde"]].map(([key, word]) => ({
            at: kwhText(range[key]), x: range[key], symbol: "│",
            label: `${word} van ${SIZING[answers.sizing] ? "het zinvolle" : "je eigen"} bereik: ${kwhText(range[key])}`
          }))
        }));
    };
    // Twee schuifregelaars voor het bereik; de doelen hierboven zetten ze, schuiven maakt er een eigen bereik van.
    let goal = null;
    const sliders = {};
    const sliderText = v => `${kwhText(v)}, ongeveer ${n(shareAt(v) * 100, 0)}% van de opbrengst bij ${kwhText(largest)}`;
    const syncSliders = () => {
      for (const [key, s] of Object.entries(sliders)) {
        s.input.value = String(range[key]); s.input.setAttribute("aria-valuetext", sliderText(range[key]));
        s.output.textContent = sliderText(range[key]);
      }
      for (const radio of goal?.querySelectorAll("input") || []) radio.checked = radio.value === answers.sizing;
    };
    const slide = (key, value) => {
      range = { ...range, [key]: value };
      if (range.low > range.high) range = key === "low" ? { ...range, high: value } : { ...range, low: value };
      Object.assign(answers, { sizing: "custom", rangeLow: range.low, rangeHigh: range.high }); save();
      syncSliders(); renderSize(); renderPick();
    };
    const slider = (key, labelText) => {
      const input = h("input", { type: "range", id: UI.uid("bereik"), class: "range", min: "0", max: String(largest),
        step: "0.5", oninput: event => slide(key, Number(event.target.value)) });
      const output = h("output", { for: input.id });
      sliders[key] = { input, output };
      return h("div", { class: "field" }, h("label", { for: input.id }, labelText), input, output);
    };
    if (!range) {
      size.append(h("p", {}, answers.panels === "no"
        ? "Zonder zonnepanelen is er geen zonnestroom om op te slaan. In deze berekening levert een accu dan niets op. " +
          "Met een dynamisch contract kan dat anders zijn; dat rekenen we nog niet."
        : "Je hebt vrijwel geen zonnestroom over om op te slaan. Een accu levert in deze berekening weinig op."));
    } else {
      const options = Object.entries(SIZING).map(([key, s]) => [key, s.label, s.detail]);
      goal = UI.choice("Wat wil je met de accu bereiken?", "kh-sizing", options, answers.sizing, value => {
        answers.sizing = value; save(); range = rangeFor(value); syncSliders(); renderSize();
        renderPick();
      });
      size.append(goal,
        h("fieldset", { class: "range-pair" }, h("legend", {}, "Bereik zelf instellen"),
          slider("low", "Kleinste accu (bruikbaar)"), slider("high", "Grootste accu (bruikbaar)"),
          h("p", { class: "help" }, "Een doel hierboven zet beide schuiven; verschuif ze om met je eigen bereik verder te rekenen.")),
        sizeBody, h("p", { class: "help" }, curve.assumptions));
      syncSliders(); renderSize();
    }

    const labels = Object.fromEntries(costCatalog.categories.map(c => [c.key, c.label]));
    // Een stekkeraccu die meer dan 800 W kan, doet ook mee als afgeleide uitvoering op een eigen groep.
    const products = cmp.configurations.filter(c => c.product_kind === "battery_system").map(c => Data.describe(cmp, c))
      .flatMap(p => { const variant = Data.circuitVariant(cmp, p); return [{ ...plugLimit(p), hasCircuit: variant != null }, variant].filter(Boolean); }).map(p => ({ ...p, fit: fit(p) })).map(p => ({ ...p, lines: p.offer ? Data.costLinesFor(costCatalog, p, answers) : null }))
      .map(p => ({ ...p, reason: exclusion(p, labels) }));
    const pickSection = h("section", { class: "panel" }, h("h3", {}, "2. Welke accu’s rekenen we door?"));
    if (!products.length) {
      pickSection.append(h("p", {}, "Er staan nog geen accu’s in je catalogus."),
        button("Laad onderzochte accu’s", event => UI.busy(event.target, async () => { await UI.api("/api/v1/references", { method: "POST" }); Data.invalidateCatalog(); flow.rerender(); })));
      body.append(size, pickSection); return;
    }
    // Iedere passende accu met een prijs en bekende kosten doet mee; de gebruiker hoeft niet te kiezen. Het zinvolle bereik
    // van een doel is een richtlijn: het gaat over energie, terwijl het doel ook terugverdientijd kan zijn. Boven de grens
    // van de rekenkern gaan de accu's voor die er het dichtst bij liggen. Een eigen bereik filtert wel; valt er niets
    // binnen, dan gaan de dichtstbijzijnde kleinere en grotere accu mee.
    const distance = p => !range ? 0 : Math.max(0, range.low - p.capacity, p.capacity - range.high);
    const position = p => !range ? "—" : p.capacity < range.low ? "Kleiner" : p.capacity > range.high ? "Groter" : "Binnen";
    const rangeName = () => SIZING[answers.sizing] ? "het zinvolle bereik" : "je eigen bereik";
    const rangeText = () => `${rangeName()} (${size1(range.low)} tot ${kwhText(range.high)})`;
    const opened = { included: false, excluded: false }, pickBody = h("div");
    const group = (key, text, content) => {
      const box = h("details", { class: "product-group", open: opened[key] }, h("summary", {}, text), content);
      box.addEventListener("toggle", () => { opened[key] = box.open; });
      return box;
    };
    renderPick = () => {
      const eligible = products.filter(p => !p.reason);
      const filter = range != null && !SIZING[answers.sizing];
      const inside = eligible.filter(p => distance(p) === 0);
      const nearest = side => eligible.filter(side).sort((a, b) => distance(a) - distance(b))[0];
      const fallback = filter && !inside.length;
      const chosen = !filter ? eligible : fallback
        ? [nearest(p => p.capacity < range.low), nearest(p => p.capacity > range.high)].filter(Boolean) : inside;
      const price = p => p.offer.upfront_amount_minor;
      included = chosen.slice().sort((a, b) => distance(a) - distance(b) || (range ? a.capacity - b.capacity : price(a) - price(b)))
        .slice(0, range ? MAX_CANDIDATES : FEW_CANDIDATES).sort((a, b) => a.capacity - b.capacity);
      const outside = eligible.filter(p => !included.includes(p)).map(p => ({ ...p, reason: filter && distance(p) > 0
        ? `${position(p)} dan ${rangeText()}.`
        : range ? `De berekening vergelijkt hoogstens ${MAX_CANDIDATES} accu’s tegelijk; deze ligt verder van ${rangeName()}.`
          : `Een accu levert hier weinig of niets op; ter controle rekenen we alleen de ${FEW_CANDIDATES} goedkoopste door.` }));
      const excluded = [...products.filter(p => p.reason), ...outside].sort((a, b) => a.name.localeCompare(b.name, "nl"));
      const age = Data.priceAge(), soort = { plug: "Stekker", fixed: "Vast", circuit: "Stekker, eigen groep" };
      const where = filter ? `, binnen ${rangeText()} vallen` : "";
      pickBody.replaceChildren(...[
        h("p", {}, !included.length
          ? "Geen enkele accu past bij je antwoorden en heeft tegelijk een gepubliceerde prijs en volledige gegevens."
          : fallback
            ? `Geen accu met een prijs en volledige gegevens valt binnen ${rangeText()}. We rekenen de dichtstbijzijnde ` +
              `${included.length === 1 ? "accu" : "kleinere en grotere accu"} door en vergelijken met geen accu. ` +
              "Verschuif het bereik om andere accu’s mee te nemen."
            : `We rekenen ${chosen.length > included.length ? `de ${included.length}${range ? "" : " goedkoopste"} van de ${chosen.length}` : `alle ${included.length}`} ` +
              `accu’s door die bij je antwoorden passen${where}${parse(answers.budget, { money: true }) != null ? " en binnen je budget blijven" : ""} ` +
              "en waarvan prijs, capaciteit en vermogen bekend zijn" +
              `${chosen.length > included.length && range ? `, die het dichtst bij ${rangeName()} liggen` : ""}, ` +
              "en vergelijken ze met geen accu. Je hoeft zelf niets te kiezen: de uitkomst laat zien welke optie het beste past bij je doel."),
        age.stale ? h("p", { class: "callout", role: "note" }, age.text) : null,
        h("p", { class: "help" }, `Gegevens en prijzen zijn bronmomentopnamen van ${Data.RESEARCHED_SPAN}; controleer de actuele prijs bij de verkoper. ` +
          "Heb je een offerte, of wil je een accu zonder gepubliceerde prijs meenemen? Gebruik ", link("Zelf doorrekenen", "#/zelf"), "."),
        included.length ? group("included", `Bekijk de ${included.length} accu’s die we doorrekenen`,
          table(["Accu", "Soort", "Bruikbaar", "Ontladen (AC)", "Prijs incl. btw", "Zinvol bereik"], included.map(p => [
            p.name, soort[p.circuit ? "circuit" : p.kind] || "Onbekend", `${n(p.capacity, 1)} kWh`, `${n(p.dischargeKw, 1)} kW`,
            h("span", {}, external(money(p.offer.upfront_amount_minor / 100, { decimals: 0 }), p.offer.source_url),
              p.offer.includes_installation === false ? " excl. installatie" : ""),
            position(p)]), { caption: "Accu’s in de berekening", className: "product-table", stack: true })) : null,
        excluded.length ? group("excluded", `${excluded.length} ${excluded.length === 1 ? "accu" : "accu’s"} niet meegerekend, met de reden`,
          table(["Accu", "Waarom niet"], excluded.map(p => [p.name, p.reason]),
            { caption: "Accu’s buiten de berekening", className: "product-table", stack: true })) : null].filter(Boolean));
    };
    renderPick();
    pickSection.append(pickBody);
    const confirmations = [
      answers.data === "file" ? "Mijn bestand bevat de opwek van mijn omvormer en het totale verbruik van het huis (of P1-afname en -teruglevering waaruit dat is afgeleid), zonder bestaande accu." : "Ik begrijp dat mijn verbruik en opwek zijn geschat uit jaartotalen met standaardprofielen.",
      "Ik begrijp dat de accugegevens uit de bronnen komen, aangevuld met de genoemde aannames, en dat de keuzehulp niet controleert of een accu in mijn meterkast past.",
      "Ik begrijp dat de kostenindicaties zijn uit de genoemde bronnen en aannames, en dat een offerte voor mijn woning daarvoor in de plaats komt."
    ].map(text => checkbox(text, { required: true }));
    const go = button("Bereken mijn advies", () => UI.busy(go, async () => {
      if (!UI.validate(run)) return;
      if (!included.length) throw new Error("Er is geen accu om door te rekenen; reken een offerte door met Zelf doorrekenen.");
      const response = await flow.busy(`Bezig met rekenen aan ${included.length} ${included.length === 1 ? "accu" : "accu’s"}…`,
        () => UI.api("/api/v1/analysis/runs", { method: "POST", json: buildRequest(importId, included, check, range) }));
      flow.arrive(`#/berekeningen/${response.id}`, "Je advies is klaar.");
    }));
    // De knop staat in de vaste balk onderaan; de bevestigingen staan er vlak boven.
    const run = h("section", { class: "panel" }, h("h3", {}, "3. Controleer en reken het door"),
      h("p", {},
        "Elke kostenpost heeft een indicatie met bron of aanname. Niet meegeteld: meerwerk dat pas bij de schouw blijkt (zoals hak- en breekwerk of een verouderde groepenkast), lokale subsidies en handel met een dynamisch contract. Laadverliezen, sluimerverbruik en capaciteitsverlies zitten al in de besparing."),
      h("fieldset", {}, h("legend", {}, "Bevestig"), confirmations.map(c => c.element)));
    // Het stekkeradvies staat al bij de woningvragen en komt terug op de uitkomst; hier ingeklapt.
    const rules = h("details", { class: "fold" }, h("summary", {}, "Voordat je koopt: aanmeldplicht, veiligheid en verzekering"),
      h("p", {}, RULES.placement), h("p", {}, RULES.register), h("p", {}, RULES.insurance), answers.install === "fixed" ? null : h("p", {}, RULES.plug),
      // Tot 2027 geldt de salderingsregeling nog; de berekening begint daarom op 1 januari 2027.
      new Date() < new Date(2027, 0, 1) ? h("p", {}, "Tot en met 31 december 2026 geldt de salderingsregeling nog. Een accu " +
        "levert dan niets op en kost alleen laadverlies en sluimerverbruik; de berekening begint daarom in 2027. Eerder kopen " +
        "is alleen zinvol voor een betere prijs.") : null,
      h("p", { class: "help" },
        "Dit is een samenvatting van openbare informatie, geen juridisch of installatieadvies."),
      sourceList(RULES.sources));
    body.append(size, pickSection, rules, run);
    if (flow.current === step) flow.action(go);
  }

  function check(index, body) {
    if (!UI.validate(body)) return false;
    const reject = (key, message) => UI.reject(body.querySelector(`[name="kh-${key}"]`), message, body);
    if (index === 0 && answers.data === "file" && !answers.importId) { UI.toast("Kies een bewaard energieprofiel of kies ‘Jaartotalen’.",
      true);
      return false; }
    if (index === 0 && answers.data === "totals") {
      if (answers.panels === "yes" && parse(answers.production) == null && parse(answers.kwp) == null) {
        return reject("production", "Vul de opwek van je panelen in, of hieronder het vermogen in kWp.");
      }
      const value = gross();
      if (value != null && !(value > 0)) {
        return reject("gridExport", "Deze getallen kloppen niet: teruglevering is groter dan opwek plus afname.");
      }
      const extra = (parse(answers.heatPump) || 0) + (parse(answers.ev) || 0);
      if (value != null && extra > 0 && value - extra < 100) {
        return reject(parse(answers.heatPump) ? "heatPump" : "ev",
          "Warmtepomp en auto zijn een deel van je totale verbruik en kunnen daar niet boven uitkomen.");
      }
    }
    return true;
  }

  UI.page("keuzehulp", {
    nav: "Keuzehulp", icon: "help", title: "Welke thuisaccu past bij jou?",
      subtitle: "Vijf stappen in gewone taal. Duurt ongeveer vijf minuten.",
    render(view, actions) {
      load();
      // Wissen is niet terug te draaien; bewaarde berekeningen blijven wel staan.
      // Alleen als er iets te wissen is; een eerste bezoek begint niet met een wisknop.
      if (store.get(STORE, null)) actions.append(button("Begin opnieuw", () => UI.confirm("Opnieuw beginnen?",
        ["Al je antwoorden in de keuzehulp worden gewist. Bewaarde berekeningen onder Mijn berekeningen blijven staan."],
        "Wis mijn antwoorden", () => { answers = { ...BLANK }; store.set(STORE, null); flow.show(0); }), "ghost"));
      flow = UI.wizard([
        { label: "Je energie", render: stepEnergy }, { label: "Je woning", render: stepHome },
          { label: "Je contract", render: stepContract },
        { label: "Wat je belangrijk vindt", render: stepGoal }, { label: "Controleren en berekenen", render: stepAdvice }
      ], { validate: check, onShow: () => window.scrollTo(0, 0) });
      view.append(flow.element); flow.show(0);
    }
  });
})();
