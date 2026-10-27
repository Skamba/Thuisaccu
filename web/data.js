"use strict";

// Gegevens van de lokale API, vaste labels en de gedeelde vertaling van bronclaims naar
// rekengegevens en kostenindicaties. Elke aanname wordt met naam vastgelegd.
window.Data = (() => {
  const { api, number: n } = UI;
  let catalogCache = null, costsCache = null, typicalCache = null, referencesLoaded = null;

  // Ontbrekende ingebouwde referentiesets worden één keer per bezoek bijgeladen, zodat de catalogus
  // altijd de nieuwste set bevat. Het laden is per set idempotent: eerder geladen sets en eigen
  // claims blijven ongewijzigd. Bewust zonder voorafgaande statusvraag, zodat dit ook werkt met een
  // oudere, nog in de browsercache staande WebAssembly-module.
  const loadReferences = () => (referencesLoaded ||= api("/api/v1/references", { method: "POST" })
    .catch(error => { referencesLoaded = null; throw error; }));
  // Een onderzochte uitvoering die niet zonder eigen invoer door te rekenen is (capaciteit,
  // AC-ontlaadvermogen, prijs inclusief btw en de omvormer), voegt weinig toe en wordt niet getoond;
  // `hidden` telt ze. Zelf toegevoegde uitvoeringen blijven altijd zichtbaar. `priceless`: de verborgen
  // uitvoeringen die alleen een prijs inclusief btw missen; met een eigen prijs rekent de keuzehulp ze door.
  const catalog = async (fresh = false) => {
    await loadReferences();
    if (fresh || !catalogCache) {
      const cmp = await api("/api/v1/comparison");
      const shown = cmp.configurations.filter(c => !c.researched || complete(describe(cmp, c)));
      const priceless = cmp.configurations.filter(c => !shown.includes(c)).map(c => describe(cmp, c))
        .filter(p => p.battery != null && p.offer == null && p.inverterIncluded);
      catalogCache = { ...cmp, configurations: shown, hidden: cmp.configurations.length - shown.length, priceless };
    }
    return catalogCache;
  };
  const complete = p => p.battery != null && p.offer != null && (p.inverterIncluded || p.offer.includes_inverter === true);
  // De onderzochte uitvoering achter elke optie van een run, op nummer én naam: een gedeelde run kan uit
  // een andere database komen, waar hetzelfde nummer een andere accu is. Opties zonder overeenkomst ontbreken.
  async function described(candidates) {
    const cmp = await catalog(), out = new Map();
    for (const c of candidates) {
      const config = cmp.configurations.find(x => x.id === c.configuration_id);
      if (!config) continue;
      // Een uitvoering kan als zichzelf, begrensd op 800 W of als afgeleide uitvoering op een eigen groep (met hetzelfde
      // nummer) zijn doorgerekend. Eerst de exacte naam; anders moet de naam het product noemen en kiest de soort
      // aansluiting uit de run (een run van vóór 26 oktober 2026 heeft die niet).
      const base = describe(cmp, config), forms = [plugLimit(base), base, circuitVariant(cmp, base)].filter(Boolean);
      const p = forms.find(f => f.name === c.name) || (!c.name.includes(config.product_name) ? null
        : c.connection ? forms.find(f => connectionOf(f) === c.connection) : base);
      if (p) out.set(c.key, p);
    }
    return out;
  }
  // Soort aansluiting van een beschreven uitvoering, zoals `connection` in een berekening: `plug`, `fixed`, `circuit` of null.
  const CONNECTIONS = ["plug", "fixed", "circuit"];
  const connectionOf = p => !p ? null : p.circuit ? "circuit" : p.kind ?? null;
  // Korte namen voor grafieken en keuzelijsten van een berekening: aansluiting met ontlaadvermogen, merk en product en
  // bruikbare capaciteit. De aansluiting staat vooraan, zodat hij niet wegvalt als een lange naam wordt afgekort. Alleen
  // voor opties uit de catalogus; een eigen naam blijft staan. Zou een korte naam niet uniek zijn, dan komt het eerste
  // deel van de uitvoeringsnaam erbij, en anders blijft de volle naam. `kinds`: optie → soort aansluiting.
  function shortLabels(candidates, kinds) {
    const how = { plug: "Stekker", fixed: "Vast", circuit: "Eigen groep" }, n1 = v => n(v, Number.isInteger(v) ? 0 : 1);
    const label = (c, detail) => {
      const parts = c.name.split(" · "), b = c.battery, kind = how[kinds.get(c.key)];
      if (detail && parts.length < 3) return null;
      return [`${kind ? `${kind} ` : ""}${n1(b.discharge_power_kw)} kW${/\(afgeleid\)$/.test(c.name) ? " (afgeleid)" : ""}`,
        parts[0], ...(detail ? [parts[1]] : []), `${n1(b.usable_capacity_kwh)} kWh`].join(" · ");
    };
    const out = new Map(candidates.map(c => [c.key, c.name]));
    let open = candidates.filter(c => c.configuration_id != null && c.name.includes(" · "));
    for (const detail of [false, true]) {
      const tried = new Map(open.map(c => [c.key, label(c, detail)]));
      const taken = [...out].filter(([key]) => !tried.has(key)).map(([, text]) => text).concat([...tried.values()]);
      const fits = open.filter(c => tried.get(c.key) && taken.filter(text => text === tried.get(c.key)).length === 1);
      for (const c of fits) out.set(c.key, tried.get(c.key));
      open = open.filter(c => !fits.includes(c));
    }
    return out;
  }
  const costs = async () => (costsCache ||= await api("/api/v1/analysis/costs"));
  // Gelijk aan `analysis::MODEL_VERSION` in de rekenkern (de HTTP-test controleert dat). Runs met een
  // andere versie zijn met andere rekenregels gemaakt.
  const MODEL_VERSION = "nl-self-consumption-v6";
  // Wat elke modelversie veranderde, in gewone taal (docs/roi-model.md), met een toets of het een
  // bewaarde run raakt: true, false, of null als dat uit de run niet te zien is.
  const MODEL_CHANGES = [
    ["nl-self-consumption-v2", "Verbruik binnen een meetperiode volgt een dagpatroon in plaats van gelijk verdeeld te zijn.", () => null],
    ["nl-self-consumption-v3", "Gemeten netafname en teruglevering uit je meterbestand tellen mee.", () => null],
    ["nl-self-consumption-v4", "Bij het doel ROI wint alleen een accu die in geld van nu niet verliest.",
      run => run.input.request.parameters.objective === "roi"],
    ["nl-self-consumption-v5", "Een lening telt als rente en aflossing in het jaar dat je ze betaalt; met een lening kwam de accu eerder te duur uit.",
      run => run.input.request.candidates.some(c => c.financing?.loan_amount_eur > 0)],
    ["nl-self-consumption-v6", "Met een lening telt de terugverdientijd de hele investering; een geleende accu leek eerder ‘direct terugverdiend’. " +
      "Subsidie of teruggave maakt de investering in de gunstige variant niet meer negatief.",
      run => run.input.request.candidates.some(c => c.financing?.loan_amount_eur > 0 ||
        c.costs.some(l => ["grant", "vat_refund"].includes(l.category) && l.status === "priced" && l.amount_minor > 0))]
  ];
  // De veranderingen na `version`, als [{ text, affects }]; leeg bij een onbekende versie.
  function modelChanges(version, run) {
    const known = ["nl-self-consumption-v1", ...MODEL_CHANGES.map(([v]) => v)];
    const index = known.indexOf(version);
    if (index < 0) return [];
    return MODEL_CHANGES.slice(index).map(([, text, affects]) => ({ text, affects: affects(run) }));
  }
  // Of geen van de veranderingen sinds de run hem raakt; dan blijft de uitkomst naar verwachting gelijk.
  const unaffectedByModel = run => {
    const changes = modelChanges(run.result.model_version, run);
    return changes.length > 0 && changes.every(c => c.affects === false);
  };
  // Gedateerde indicaties uit openbare bronnen; alleen na een klik of keuze gebruikt
  // (keuzehulp en Zelf doorrekenen).
  const INDICATION = {
    import: 0.2552,
    importText: "Indicatie € 0,26: gemiddeld variabel leveringstarief september 2026 (€ 0,1487, CBS) " +
      "plus energiebelasting 2027 (8,80 cent, met btw € 0,1065), beide per kWh inclusief btw. Het model rekent vanaf 2027, " +
      "dus met de belasting van 2027. Dat tarief is voorlopig tot de Eerste Kamer het Belastingplan 2027 aanneemt (gepland " +
      "december 2026). Vaste en dynamische contracten wijken af.",
    // Energiebelasting 2027 per kWh met btw (fiscale sleuteltabel 2027, zie importSources).
    energyTax: 0.1065,
    // Boven 10.000 kWh netafname per jaar: 6,78 in plaats van 8,80 cent zonder btw (zelfde sleuteltabel), met 21% btw
    // € 0,0244 per kWh minder. Voorlopig, net als het tarief zelf.
    energyTaxBand: { above_kwh: 10000, cents: [8.80, 6.78], lower_eur_per_kwh: (0.0880 - 0.0678) * 1.21 },
    importHelp: "Leveringstarief plus energiebelasting (in 2027 € 0,1065 per kWh), inclusief btw, zonder vaste kosten " +
      "per maand. Staan ze apart op je tariefoverzicht, tel ze dan op. Heb je normaal en dal en zijn ze (bijna) gelijk, neem dan " +
      "het normaaltarief. Is dal duidelijk lager, neem dan een prijs ertussenin: een accu levert ook ’s nachts en in het " +
      "weekend, als dal geldt; met alleen het normaaltarief valt de besparing iets te hoog uit.",
    importSources: [
      ["CBS: Verdeling energietarieven 2026 (september 2026)",
        "https://www.cbs.nl/nl-nl/maatwerk/2026/42/verdeling-energietarieven-2026"],
      ["Rijksoverheid: fiscale sleuteltabel 2027 (versie september 2026, energiebelasting elektriciteit)",
        "https://www.rijksfinancien.nl/sites/default/files/bestanden/belastingplan-2027/pakket-belastingplan-2027/Fiscale-sleuteltabel-2027-incl-correctie-tarieven-energiebelasting-zelfstandigenaftrek.pdf"]
    ],
    // Netto 1 cent per kWh: de mediaan van 14 vaste contracten (salderingcheck.nl, 16 oktober 2026).
    export: 0.0615, exportFee: 0.0515,
    exportText: "Wat telt is het verschil tussen vergoeding en terugleverkosten. Voor een 1-jarig vast contract " +
      "vanaf 2027 lag dat bij 14 leveranciers tussen +0,25 en +4,4 cent per kWh, met een mediaan van 1,0 cent; " +
      "één variabel contract kost vanaf 2027 netto 4,32 cent per kWh die je teruglevert " +
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
    variantText: "Volgens de ACM krijg je een redelijke vergoeding, tot 2030 minstens 50% van het kale leveringstarief. Voor daarna " +
      "is geen minimum aangekondigd, en terugleverkosten kunnen nu al hoger zijn dan de vergoeding. Deze variant rekent vanaf 2030 " +
      "met € 0 vergoeding. Met de indicatie zijn de terugleverkosten dan ook € 0, zodat teruglevering niets meer oplevert: de " +
      "terugleverkosten van de indicatie zijn alleen gekozen om op 1 cent netto uit te komen en zeggen niets over later. Met je " +
      "eigen contract blijven je terugleverkosten staan, zodat teruglevering dan geld kost. Het is een variant om mee te " +
      "vergelijken, geen voorspelling of aangekondigde regel. Een accu wordt daarin meestal meer waard, omdat zelf opslaan dan " +
      "meer oplevert dan terugleveren."
  };
  // Wat elke aanname doet, in gewone taal (docs/roi-model.md); bij Instellingen en Zelf doorrekenen.
  const ASSUMPTION_HELP = {
    discount_pct: "Hoeveel minder geld in de toekomst waard is dan geld nu. Bij 4% telt een euro over tien jaar als ongeveer 68 cent van nu. Dit is een gewone rente, met inflatie erin; laat prijzen en kosten daarom ook meestijgen.",
    annual_cost_escalation_pct: "Hoeveel jaarlijkse kosten zoals een abonnement, onderhoud of verzekering elk jaar duurder worden.",
    annual_pv_loss_pct: "Hoeveel minder je panelen elk jaar opwekken door veroudering.",
    annual_load_growth_pct: "Hoeveel je verbruik elk jaar groeit of krimpt. Een warmtepomp of auto vanaf een later jaar vul je apart in bij ‘Verandering in verbruik’, in de eerste stap van Zelf doorrekenen.",
    annual_price_change_pct: "Hoeveel stroomprijs, terugleververgoeding en terugleverkosten elk jaar veranderen; vaste contractkosten blijven gelijk. Standaard 2%, net als de jaarkosten: de energiebelasting wordt in de wet elk jaar voor inflatie gecorrigeerd. Met 0% wordt stroom elk jaar goedkoper ten opzichte van de rest.",
    price_uncertainty_pct: "Hoeveel de tarieven afwijken in de gunstige en ongunstige variant op het tabblad Gevoeligheid.",
    cost_uncertainty_pct: "Hoeveel de kosten afwijken in de gunstige en ongunstige variant op het tabblad Gevoeligheid."
  };
  // Begrippen in gewone taal, voor wie de uitkomst samen met iemand anders leest.
  const GLOSSARY = [
    ["Netto voordeel (NPV)", "Wat de accu over de looptijd oplevert min wat hij kost, omgerekend naar geld van nu. Boven nul " +
      "verdient de accu zich terug én levert hij meer op dan je geld elders zou doen."],
    ["Discontovoet", "Wat je geld per jaar anders zou kunnen opbrengen, bijvoorbeeld op een spaarrekening of door minder te " +
      "lenen. Daardoor telt een euro over tien jaar minder dan een euro nu."],
    ["Lonend tot", "De hoogste startinvestering waarbij het netto voordeel nog nul is. Kost de accu minder, dan is hij lonend."],
    ["Terugverdiend na", "Na hoeveel jaar de besparingen de investering hebben goedgemaakt, zonder de discontovoet."],
    ["kWh en kW", "kWh is een hoeveelheid energie: wat er in de accu past of wat je per jaar verbruikt. kW is vermogen: hoe snel " +
      "de accu laadt of stroom levert. Een accu met 5 kWh die 0,8 kW levert, doet ruim zes uur over leeglopen."],
    ["Startinvestering", "Alles wat je bij aanschaf betaalt, zoals accu, installatie en aansluiting, min teruggaven en subsidie."],
    ["Eigen gebruik", "Welk deel van je zonnestroom je zelf gebruikt, direct of later via de accu. De rest lever je terug aan het net."],
    ["Zelfvoorziening", "Welk deel van je verbruik uit je eigen zonnestroom komt, direct of via de accu. De rest haal je van het net."],
    ["Bruikbare en nominale capaciteit", "Nominaal is wat er in de cellen past; bruikbaar is wat je er echt uit kunt halen en is " +
      "meestal lager. Hier wordt altijd met bruikbare capaciteit gerekend."],
    ["Sluimerverbruik", "Wat accu en omvormer zelf gebruiken zolang ze aan staan, ook als de accu niets doet. Een paar watt " +
      "is over een jaar tientallen kWh."],
    ["Volledige laadcycli", "De energie die de accu in een jaar levert, gedeeld door zijn bruikbare capaciteit: twee keer half " +
      "leeg telt als één cyclus. Garanties noemen vaak een maximum aantal cycli."],
    ["Salderen en terugleverkosten", "Tot en met 2026 mag je teruggeleverde stroom wegstrepen tegen stroom van het net " +
      "(salderen). Daarna krijg je per teruggeleverde kWh een vergoeding, en veel leveranciers rekenen terugleverkosten."]
  ];
  // Posten die de kosten verlagen, zoals `finance::is_credit` in de rekenkern.
  const CREDITS = ["grant", "vat_refund", "residual_value"];
  // Wat de offertecheck uit een offerte kan overnemen: [veld, naam, eenheid], gelijk aan QUOTE_FIELDS in
  // scenario_api.rs. De technische velden staan in `battery`; de totaalprijs is de som van alle betaalde
  // startposten vóór teruggaven (de totaalprijs plus wat je apart hield), het abonnement het bedrag per jaar (0 zonder).
  const QUOTE_FIELDS = [["usable_capacity_kwh", "bruikbare capaciteit", "kWh"], ["charge_power_kw", "laadvermogen AC", "kW"],
    ["discharge_power_kw", "ontlaadvermogen AC", "kW"], ["ac_round_trip_efficiency_pct", "rendement AC → AC", "%"],
    ["standby_w", "sluimerverbruik", "W"], ["operating_life_years", "levensduur", "jaar"],
    ["annual_capacity_loss_pct", "capaciteitsverlies per jaar", "%"],
    ["upfront_eur", "startkosten vóór teruggaven", "€"], ["subscription_eur", "abonnement per jaar", "€"]];
  const isPriceField = field => field === "upfront_eur" || field === "subscription_eur";
  // De waarde van een offerteveld bij een optie zoals die naar de rekenkern gaat (bedragen in eurocenten).
  // Som van de betaalde startposten in euro. Met `credits` tellen teruggaven en subsidie negatief en wordt het nooit
  // minder dan nul; zonder is het de prijs vóór teruggaven. Teruggaven boven de kosten weigert de rekenkern
  // (`validate` in analysis.rs); Zelf doorrekenen meldt dat in de controlestap.
  function upfrontCosts(lines, { credits = true } = {}) {
    const sum = lines.filter(l => l.timing === "upfront" && l.status === "priced" && (credits || !CREDITS.includes(l.category)))
      .reduce((total, l) => total + l.amount_minor / 100 * (CREDITS.includes(l.category) ? -1 : 1), 0);
    return Math.max(0, sum);
  }
  function quoteValue(candidate, field) {
    const priced = l => l.status === "priced" ? l.amount_minor / 100 : 0;
    if (field === "upfront_eur") return upfrontCosts(candidate.costs, { credits: false });
    if (field === "subscription_eur") return priced(candidate.costs.find(l => l.category === "subscription") || { status: "" });
    return candidate.battery[field];
  }
  const plain = value => n(value, 2).replace(/,?0+$/, "");
  const quoteUnit = (field, value) => { const unit = QUOTE_FIELDS.find(([key]) => key === field)[2];
    return unit === "€" ? UI.money(value, { decimals: Number.isInteger(value) ? 0 : 2 }) : `${plain(value)}${unit === "%" ? "%" : ` ${unit}`}`; };
  const quoteChange = c => `${QUOTE_FIELDS.find(([key]) => key === c.field)[1]} ${quoteUnit(c.field, c.before)} → ${quoteUnit(c.field, c.after)}`;
  // Zet een offerteprijs in de kostenposten: de totaalprijs op de accupost en de apart geschatte startposten
  // als inbegrepen, behalve wat je apart houdt (`separate`, categorieën). De reserve voor meerwerk vervalt
  // alleen bij een vaste prijs. Het abonnement wordt een jaarbedrag. Bedragen in hele eurocenten.
  function applyQuotePrice(candidate, field, value, { separate = [], fixedPrice = false } = {}) {
    const set = (line, status, amount, source, notes) => Object.assign(line, { status, amount_minor: amount, source, notes });
    if (field === "subscription_eur") {
      const line = candidate.costs.find(l => l.category === "subscription");
      if (value > 0) set(line, "priced", Math.round(value * 100), "Offerte", "Abonnement per jaar volgens de offerte.");
      else set(line, "not_applicable", 0, "Offerte", "Geen abonnement volgens de offerte.");
      return;
    }
    for (const line of candidate.costs.filter(l => l.timing === "upfront" && !CREDITS.includes(l.category))) {
      if (line.category === "battery") set(line, "priced", Math.round(value * 100), "Offerte (totaalprijs inclusief btw)",
        "Totaalprijs uit de offerte, inclusief btw.");
      else if (line.category === "contingency") {
        if (fixedPrice && line.status === "priced") set(line, "not_applicable", 0, "Offerte",
          "Vaste prijs volgens de offerte; geen reserve voor meerwerk.");
      } else if (line.status === "priced" && !separate.includes(line.category)) set(line, "included", 0, "In de totaalprijs van de offerte",
        "Was eerder apart geschat; nu inbegrepen in de totaalprijs van de offerte.");
    }
  }
  const typicalSources = async () => (typicalCache ||= await api("/api/v1/solar/typical"));
  const imports = async () => (await api("/api/v1/solar/imports")).imports;
  // De lijst is een samenvatting zonder jaartabellen en zonder de invoer van de opties; voor tonen,
  // vergelijken of aanpassen haal je de volledige berekening op met `run(id)`.
  const runs = async () => (await api("/api/v1/analysis/runs")).runs;
  const run = id => api(`/api/v1/analysis/runs/${id}`);
  const invalidateCatalog = () => { catalogCache = null; };

  const objectives = {
    net_present_value: "Hoogste netto voordeel (NPV)",
    roi: "Hoogste ROI over de looptijd",
    payback: "Kortste blijvende terugverdientijd",
    self_consumption: "Meeste eigen zonnestroom gebruiken"
  };
  const costStatus = { priced: "Bedrag", included: "Inbegrepen", not_applicable: "Niet van toepassing",
    unknown: "Nog onbekend" };
  const boundaries = { unspecified: "meetgrens onbekend", battery_dc: "accu DC", system_ac: "systeem AC",
    dc_dc: "DC → DC", ac_ac: "AC → AC", pv_ac: "PV → opslag → AC" };
  const qualifiers = { exact: "", approximate: "≈ ", at_least: "≥ ", at_most: "≤ ", less_than: "< ",
    greater_than: "> ", range: "" };
  const review = { unreviewed: "Nog niet nagekeken", reviewed: "Transcriptie nagekeken", disputed: "Betwist",
    superseded: "Vervangen" };
  // RESEARCHED_ON en RESEARCHED_ISO: de oudste peildatum (tarieven, regels, eerste sets); de waarschuwing telt daarvandaan.
  // RESEARCHED_SPAN: alle onderzochte productsets samen (REFERENCE_SETS in api.rs).
  const RESEARCHED_ON = "24 oktober 2026", RESEARCHED_ISO = "2026-10-24", RESEARCHED_SPAN = "24 tot en met 26 oktober 2026";
  // Prijzen en tarieven veranderen snel. Na drie maanden waarschuwt de interface dat de
  // momentopnamen verouderd kunnen zijn; de gegevens zelf blijven ongewijzigd.
  // Hele maanden tussen twee datums (kalendermaanden, zoals ‘3 maanden geleden’).
  const monthsBetween = (from, to) => (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth()
    - (to.getDate() < from.getDate() ? 1 : 0);
  function priceAge(now = new Date()) {
    const months = monthsBetween(new Date(`${RESEARCHED_ISO}T00:00:00`), now);
    return {
      months, stale: months >= 3,
      text: `Prijzen, tarieven en kostenindicaties zijn onderzocht op ${RESEARCHED_ON}, ${months} maanden geleden. ` +
        "Ze kunnen verouderd zijn; controleer de actuele prijs bij de verkoper en gebruik je eigen offerte en contract."
    };
  }

  // Geschiktheid van een bewaard profiel voor een berekening; uitsluitend op basis van importmetadata.
  // Meer dan 100.000 kWh opwek of verbruik per jaar past niet bij een huishouden: meestal zijn meterstanden als
  // energie per meetperiode gelezen, of Wh als kWh. Een controleregel van de app; korter dan een jaar telt het totaal.
  const IMPLAUSIBLE_KWH_PER_YEAR = 100000;
  const implausible = s => Math.max(s.production_kwh, s.consumption_kwh ?? 0) >
    IMPLAUSIBLE_KWH_PER_YEAR * Math.max(1, s.coverage_hours / 8760);
  function suitability(item) {
    const s = item.summary, o = item.options;
    if (implausible(s)) return { ok: false, reason: "Onwaarschijnlijk hoge totalen" };
    if (s.consumption_kwh == null) return { ok: false, reason: "Verbruik ontbreekt" };
    if (s.gaps !== 0) return { ok: false, reason: "Gaten in de meetreeks" };
    if (![8760, 8784].some(hours => Math.abs(s.coverage_hours - hours) < 0.001)) return { ok: false,
      reason: "Geen volledig jaar" };
    if (s.rows > 110000) return { ok: false, reason: "Meer dan 110.000 meetperioden" };
    if (o.is_demo === true) return { ok: true, reason: "Bruikbaar · FICTIEF" };
    // Een combinatie met een meterbestand heeft altijd vaste perioden van `combined_period`.
    if (o.mode === "cumulative" && !o.combined_period) return { ok: null,
      reason: "Onbekend: intervalduur niet vast te stellen" };
    const hours = { "5min": 1 / 12, "10min": 1 / 6, "15min": 0.25, "30min": 0.5,
      hour: 1 }[o.combined_period || o.period];
    if (!hours) return { ok: false, reason: "Uur- of fijnere waarden nodig" };
    if (Math.abs(s.rows * hours - s.coverage_hours) > 0.001) return { ok: null,
      reason: "Onbekend: dekking niet eenduidig" };
    return { ok: true, reason: o.generator === "typical-nl-v1" ? "Bruikbaar · geschat profiel" : "Bruikbaar" };
  }
  const isDemo = item => item?.options?.is_demo === true;
  // Uitleg in gewone taal als een profiel niet door te rekenen is om verbruik, gaten of dekking (de controles van
  // suitability die geen importinstellingen nodig hebben, dus ook vóór het bewaren); anders null.
  function unusableText(s) {
    const tail = " Je kunt het bewaren om te bekijken, maar niet doorrekenen. Exporteer een volledig jaar, of gebruik in de " +
      "keuzehulp je jaartotalen van de jaarafrekening.";
    if (implausible(s)) return `Dit bestand komt uit op ${n(Math.max(s.production_kwh, s.consumption_kwh ?? 0), 0)} kWh. Dat ` +
      "is ver boven wat een huishouden opwekt of gebruikt. Meestal bevat het bestand meterstanden (een teller die steeds " +
      "oploopt) terwijl ‘Per meetperiode’ is gekozen, of zijn Wh als kWh gelezen. Kies bij Kolommen of Meter ‘Cumulatieve " +
      "meterstanden’ of de juiste eenheid.";
    if (s.consumption_kwh == null) return "Dit bestand heeft alleen opwek, geen verbruik van het huis. Voor een berekening is ook " +
      "het bruto verbruik nodig; voeg bij het importeren een meterbestand toe (netafname en teruglevering)." + tail;
    if (s.gaps !== 0) return `Er ontbreken ${n(s.gaps, 0)} meetperioden. Voor een berekening is één aaneengesloten jaar nodig.` + tail;
    if (![8760, 8784].some(hours => Math.abs(s.coverage_hours - hours) < 0.001)) {
      const span = s.coverage_hours < 48 ? `${n(s.coverage_hours, 0)} uur` : `${n(s.coverage_hours / 24, 0)} dagen`;
      return `Dit bestand dekt ${span}. Voor een berekening is één volledig, aaneengesloten jaar nodig, met opwek en verbruik ` +
        "per uur of fijner." + tail;
    }
    return null;
  }

  // Regels en veiligheidsadvies rond aansluiten, voor de keuzehulp en de uitkomst; gedateerde bronnen, geen juridisch advies.
  const RULES = {
    placement: "Zet een thuisbatterij op een goed geventileerde plek; een kast is dat niet, dus ook de meterkast niet. Niet in " +
      "een loop- of vluchtroute, zoals de gang of het trappenhuis, en hang er een rook- en koolmonoxidemelder bij. Dat adviseert " +
      "Milieu Centraal, voor een vaste accu en een stekkerbatterij.",
    register: "Meld je thuisaccu aan bij je netbeheerder via energieleveren.nl. Volgens Netbeheer Nederland is dat verplicht, " +
      "net als voor zonnepanelen; dat geldt sinds een wijziging van de Netcode elektriciteit voor opslag vanaf 0,8 kW die op het " +
      "net is aangesloten. Aanmelden is gratis. Naar schatting is minder dan 40% van de thuisaccu’s aangemeld.",
    insurance: "Meld de accu bij je verzekeraar en vraag of hij gedekt is. Volgens het Verbond van Verzekeraars valt een " +
      "thuisbatterij niet automatisch onder je woonverzekering; een vaste accu valt meestal onder de opstal-, een stekkerbatterij " +
      "vaker onder de inboedelverzekering. Bij schade kijkt de verzekeraar naar de installatie (door een erkend installateur) en " +
      "naar de plek, zoals een schuur of garage.",
    plug: "Milieu Centraal raadt stekkerbatterijen op dit moment niet aan, onder meer vanwege brandrisico: in één groep kan " +
      "stroom van twee kanten komen, van het net en van de accu. Een installateur sluit een accu volgens de NEN 1010-norm aan " +
      "op een aparte groep in de meterkast, niet op een stopcontact. Kies je toch voor een stekkerbatterij, gebruik dan een " +
      "vaste wandcontactdoos op een groep met weinig andere apparaten, geen verlengsnoer of stekkerdoos, en houd het " +
      "terugleververmogen op 800 W of minder. Die laatste adviezen geeft Milieu Centraal voor stekkerzonnepanelen; " +
      "ze gelden ook logisch voor een stekkerbatterij, maar zijn daarvoor niet afzonderlijk gepubliceerd.",
    sources: [
      ["Solar Magazine: Verbond van Verzekeraars over de dekking van een thuisbatterij (21 augustus 2026)",
        "https://solarmagazine.nl/nieuws-zonne-energie/i44570/verbond-van-verzekeraars-thuisbatterij-is-lang-niet-altijd-meeverzekerd"],
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
  // Aannames voor gegevens die een bron niet noemt; altijd zichtbaar bij de accu. Rendement en
  // sluimerverbruik zijn bewust voorzichtig: gemeten stekkeraccu's halen 77–87% heen en terug en
  // gebruiken 3–14 W in rust (docs/keuzehulp.md).
  const FALLBACK = { usableShare: 90, efficiency: 77, standby: 10, degradation: 2, life: 15 };
  // Garantiestresstest: de accu stopt na de garantie en veroudert sneller. 3,5% per jaar is ongeveer
  // 70% restcapaciteit na 10 jaar, een gangbare garantiegrens (docs/roi-model.md). Langer dan de
  // aangenomen levensduur rekent de stresstest niet.
  const WARRANTY_LOSS = 3.5;
  const warrantyNote = basis => `${basis}; ${n(WARRANTY_LOSS, 1)}% capaciteitsverlies per jaar is een aanname (ongeveer 70% na 10 jaar)`;
  const warrantyStress = (years, basis) => years == null || !(years > 0) ? null : {
    // Afgerond naar beneden: een accu met 2,5 jaar garantie stopt in de stresstest na 2 jaar, niet na 3.
    operating_life_years: Math.min(FALLBACK.life, Math.max(1, Math.floor(years))), annual_capacity_loss_pct: WARRANTY_LOSS,
    basis: warrantyNote(basis)
  };
  // Herkent in de vastgelegde aannametekst van een optie welke technische waarde een aanname is; de
  // offertecheck markeert die. Hoort bij de zinnen in describe() hieronder en bij de 800 W-begrenzing in
  // keuzehulp.js: pas ze samen aan. tests/e2e/data.test.js controleert dat elke zin herkend wordt.
  const ASSUMED = {
    usable_capacity_kwh: /Aanname: [\d,]+% van de opgegeven/,
    charge_power_kw: /Aanname: laadvermogen gelijk|Aanname: laden ingesteld op 800 W|Aanname: afgeleide uitvoering op een eigen groep/,
    discharge_power_kw: /Aanname: ontladen ingesteld op 800 W|Aanname: afgeleide uitvoering op een eigen groep/,
    ac_round_trip_efficiency_pct: /Aanname: [\d,]+% rendement|gebruikt als AC → AC-aanname/,
    standby_w: /Aanname: [\d,]+ W sluimerverbruik/,
    annual_capacity_loss_pct: /Aanname: [\d,]+% capaciteitsverlies/,
    operating_life_years: /Aanname: [\d,]+% capaciteitsverlies per jaar en [\d,]+ jaar levensduur/
  };
  // De aannametekst van een optie uit de keuzehulp begint zo; een eigen offerte of accu niet.
  const KEUZEHULP_PREFIX = "Keuzehulp.";
  const isAssumed = (field, assumptions) => ASSUMED[field]?.test(assumptions) === true;
  const fromKeuzehulp = candidate => candidate.assumptions.startsWith(KEUZEHULP_PREFIX);

  // Meetgrenzen op volgorde van voorkeur. Vermogen en rendement rekenen aan de AC-kant: een
  // DC-waarde (accu DC, DC → DC) mist de omvormer en telt daar niet mee.
  const ANY_BOUNDARY = ["system_ac", "ac_ac", "unspecified", "pv_ac", "battery_dc", "dc_dc"];
  const AC_BOUNDARY = ["system_ac", "ac_ac", "unspecified", "pv_ac"];
  // Bij meerdere bruikbare claims met dezelfde meetgrens telt de voorzichtigste waarde. Voor sluimerverbruik
  // telt de hoogste waarde over alle AC-meetgrenzen en ‘niet vermeld’ samen: een lagere waarde aan het
  // stopcontact (bijvoorbeeld met het apparaat uit) maakt een hoger gemeten verbruik in bedrijf niet minder waar.
  const HIGHER_IS_CAUTIOUS = new Set(["standby_power_w"]);
  // Rendementsclaims die niet als AC → AC-rendement voor de simulatie kunnen gelden; ze worden genoemd
  // maar niet gebruikt. Een bovengrens (‘tot 90%’, piekwaarde) zegt niets over de ondergrens. Een
  // rendement inclusief het eigen verbruik in rust telt het sluimerverbruik dubbel, want de simulatie
  // rekent dat apart. En sommige claims zeggen zelf dat ze niet voor de complete AC-installatie gelden.
  const UNUSABLE_EFFICIENCY = [
    [c => c.qualifier === "at_most", "is een bovengrens, geen verwachte waarde"],
    [c => /inclusief (het )?(eigen verbruik|stand-?by|sluimerverbruik)/i.test(c.conditions),
      "bevat ook het eigen verbruik in rust; dat telt al als sluimerverbruik"],
    [c => /geen rendement van de complete AC-installatie/i.test(c.conditions), "geldt niet voor de complete AC-installatie"]
  ];
  const unusableEfficiency = c => UNUSABLE_EFFICIENCY.find(([test]) => test(c))?.[1];
  const METRIC_LABELS = { usable_energy_wh: "bruikbare capaciteit", nominal_energy_wh: "nominale capaciteit",
    depth_of_discharge_pct: "ontlaaddiepte", continuous_discharge_power_w: "ontlaadvermogen",
    continuous_charge_power_w: "laadvermogen", round_trip_efficiency_pct: "rendement", standby_power_w: "sluimerverbruik" };
  // Waarde met eenheid zoals de interface rekent: energie in kWh, vermogen in kW, sluimerverbruik in W.
  const shown = c => c.unit === "Wh" ? `${n(c.value / 1000, 1)} kWh`
    : c.unit === "W" && c.metric_key !== "standby_power_w" ? `${n(c.value / 1000, 1)} kW` : `${n(c.value, 1)}${c.unit === "%" ? "%" : ` ${c.unit}`}`;

  // Rekengegevens uit de bronclaims van één uitvoering, met een lijst van aannames en ontbrekende gegevens.
  const newestOffer = (a, b) => b.observed_at_unix_s - a.observed_at_unix_s || b.upfront_amount_minor - a.upfront_amount_minor;
  function describe(cmp, config) {
    const live = row => row.configuration_id === config.id && !["superseded", "disputed"].includes(row.review_status);
    const numbers = cmp.numbers.filter(live), features = cmp.features.filter(live), texts = cmp.texts.filter(live);
    const notes = [], missing = [], used = [];
    // Selectieregel: de meest geschikte meetgrens, daarbinnen de voorzichtigste waarde. Andere
    // waarden worden genoemd; claim-ID en bron gaan mee in de aannames van de berekening.
    const claim = (metric, order = ANY_BOUNDARY, skip = () => false) => {
      const fitting = numbers.filter(c => c.metric_key === metric && order.includes(c.boundary) && !skip(c));
      if (!fitting.length) return undefined;
      const boundary = order.find(b => fitting.some(c => c.boundary === b));
      const higher = HIGHER_IS_CAUTIOUS.has(metric);
      const ac = b => AC_BOUNDARY.includes(b);
      const same = fitting.filter(c => higher ? ac(c.boundary) === ac(boundary) : c.boundary === boundary);
      const pick = same.reduce((a, b) => (higher ? b.value > a.value : b.value < a.value) ? b : a);
      if (METRIC_LABELS[metric]) {
        used.push({ label: METRIC_LABELS[metric], claim: pick });
        const values = [...new Set(fitting.map(c => c.value))];
        if (values.length > 1) notes.push(`${fitting.length} bronclaims voor ${METRIC_LABELS[metric]} (${values.map(value => shown({ ...pick, value })).join(", ")}); ` +
          `gerekend met claim #${pick.id}: de ${higher && same.length > 1
            ? `hoogste waarde ${ac(boundary) ? "aan de AC-kant of zonder vermelde meetgrens" : "aan de DC-kant"} (${boundaries[pick.boundary] || pick.boundary})`
            : `${same.length > 1 ? "laagste waarde bij de " : ""}meest geschikte meetgrens (${boundaries[boundary] || boundary})`}.`);
      }
      return pick;
    };
    // DC-claims die niet als AC-waarde mogen gelden, voor de toelichting.
    const dcOnly = metric => numbers.find(c => c.metric_key === metric && !AC_BOUNDARY.includes(c.boundary));
    const feature = metric => features.find(f => f.metric_key === metric);

    let capacity = null;
    const usable = claim("usable_energy_wh"), nominal = claim("nominal_energy_wh"),
      dod = claim("depth_of_discharge_pct");
    if (usable) { capacity = usable.value / 1000;
      notes.push(`Bruikbaar ${n(capacity)} kWh volgens bron${usable.boundary === "unspecified" ? " (meetgrens niet vermeld)" : ""}.`); }
    else if (nominal && dod) { capacity = nominal.value / 1000 * dod.value / 100;
      notes.push(`Bruikbaar afgeleid: nominaal ${n(nominal.value / 1000)} kWh × ontlaaddiepte ${n(dod.value, 0)}%.`); }
    else if (nominal) { capacity = nominal.value / 1000 * FALLBACK.usableShare / 100;
      notes.push(`Aanname: ${FALLBACK.usableShare}% van de opgegeven ${n(nominal.value / 1000)} kWh is bruikbaar; de bron noemt geen bruikbare capaciteit.`); }
    else missing.push("bruikbare capaciteit");

    const dcNote = (metric, what) => {
      const dc = dcOnly(metric);
      return dc ? ` De bron noemt alleen ${shown(dc)} ${what} aan de DC-kant (${boundaries[dc.boundary]}); dat is geen AC-waarde en telt niet mee.` : "";
    };
    const discharge = claim("continuous_discharge_power_w", AC_BOUNDARY), charge = claim("continuous_charge_power_w", AC_BOUNDARY);
    const dischargeKw = discharge ? discharge.value / 1000 : null;
    let chargeKw = charge ? charge.value / 1000 : null;
    if (dischargeKw == null) {
      missing.push(dcOnly("continuous_discharge_power_w") ? "ontlaadvermogen aan de AC-kant (de bron noemt alleen DC)"
        : "werkelijk ontlaadvermogen in kW (kVA telt niet)");
    }
    if (chargeKw == null && dischargeKw != null) { chargeKw = dischargeKw;
      notes.push(`Aanname: laadvermogen gelijk aan ontlaadvermogen; de bron noemt geen laadvermogen aan de AC-kant.${dcNote("continuous_charge_power_w", "laadvermogen")}`); }

    const rte = claim("round_trip_efficiency_pct", AC_BOUNDARY, unusableEfficiency);
    for (const c of numbers.filter(c => c.metric_key === "round_trip_efficiency_pct" && unusableEfficiency(c))) {
      notes.push(`Rendement ${n(c.value, Number.isInteger(c.value) ? 0 : 2)}% (claim #${c.id}) ${unusableEfficiency(c)}, en telt daarom niet mee.`);
    }
    let efficiency = FALLBACK.efficiency;
    if (rte) {
      efficiency = rte.value;
      const range = rte.qualifier === "range" ? `${n(rte.value, 0)}–${n(rte.upper_value, 0)}%, gerekend met de ondergrens` : `${n(rte.value, 0)}%`;
      notes.push(`Rendement ${range}${rte.boundary === "ac_ac" || rte.boundary === "system_ac" ? " (AC → AC)" : `; meetgrens ${rte.boundary === "pv_ac" ? "PV → accu → AC" : "niet vermeld"}, gebruikt als AC → AC-aanname`}.`);
    } else notes.push(`Aanname: ${FALLBACK.efficiency}% rendement heen en terug; de bron noemt geen AC-rendement.${dcNote("round_trip_efficiency_pct", "rendement")}`);

    // Meet dezelfde bron aan de netkant minder dan uit de accu zelf (bijvoorbeeld 0 W aan het net omdat de accu
    // zichzelf voedt), dan is het verbruik uit de accu het echte rustverbruik. Een DC-claim uit een andere bron
    // telt niet naast een AC-claim. ‘Minder dan 5 W’ telt als 5 W.
    let standbyClaim = claim("standby_power_w");
    const sourceOf = c => c.source_url || c.source_title;
    // Per bron: meet dezelfde bron aan de accukant meer dan aan de netkant, dan telt de accukant. Daarna de hoogste,
    // los van de volgorde van de claims.
    const standbyOf = boundary => numbers.filter(c => c.metric_key === "standby_power_w" && boundary(c.boundary));
    const raised = standbyClaim && AC_BOUNDARY.includes(standbyClaim.boundary) ? standbyOf(b => AC_BOUNDARY.includes(b))
      .map(ac => ({ ac, dc: standbyOf(b => b === "battery_dc").filter(c => sourceOf(c) === sourceOf(ac) && c.value > ac.value)
        .reduce((a, b) => a && a.value >= b.value ? a : b, null) }))
      .filter(x => x.dc && x.dc.value > standbyClaim.value).reduce((a, b) => a && a.dc.value >= b.dc.value ? a : b, null) : null;
    if (raised) {
      const { ac, dc } = raised, w = v => n(v, Number.isInteger(v) ? 0 : 1);
      notes.push(`Sluimerverbruik ${w(dc.value)} W uit de accu (claim #${dc.id}) in plaats van ${w(ac.value)} W aan de netkant ` +
        `(claim #${ac.id}): dezelfde bron meet aan de netkant minder dan de accu zelf verbruikt` +
        `${dc.qualifier === "less_than" ? `; ‘minder dan ${w(dc.value)} W’ telt als ${w(dc.value)} W` : ""}.`);
      used.push({ label: METRIC_LABELS.standby_power_w, claim: dc });
      standbyClaim = dc;
    }
    const standby = standbyClaim ? standbyClaim.value : FALLBACK.standby;
    if (!standbyClaim) notes.push(`Aanname: ${FALLBACK.standby} W sluimerverbruik; niet opgegeven.`);
    notes.push(`Aanname: ${FALLBACK.degradation}% capaciteitsverlies per jaar en ${FALLBACK.life} jaar levensduur; geen garantie of fabrieksvoorspelling.`);

    const coupling = texts.find(t => t.metric_key === "coupling")?.value || "";
    const kind = /stekker/i.test(coupling) ? "plug" : coupling ? "fixed" : null;
    // Een stekkeraccu op een eigen groep heet in de onderzochte sets ‘… eigen groep …’ of ‘… verdeelkast …’.
    const circuit = kind === "fixed" && /eigen groep|verdeelkast/i.test(config.name);
    // Alleen aanbiedingen die niet betwist, vervangen of verlopen zijn.
    const now = Date.now() / 1000;
    const offers = cmp.offers.filter(o => live(o) && (o.valid_until_unix_s == null || o.valid_until_unix_s >= now));
    // De nieuwste prijs; bij aanbiedingen van hetzelfde moment de hoogste, zodat de volgorde in een bronbestand
    // niet bepaalt of een accu lonend lijkt. De lagere prijzen worden genoemd.
    const priced = offers.filter(o => o.currency === "EUR" && o.minor_unit_exponent === 2 && o.tax_basis === "included")
      .sort(newestOffer);
    const offer = priced[0] ?? null;
    const cheaper = priced.filter(o => o !== offer && o.observed_at_unix_s === offer.observed_at_unix_s && o.upfront_amount_minor < offer.upfront_amount_minor);
    if (cheaper.length) notes.push(`Gerekend met de hoogste gepubliceerde prijs van dat moment; ook gezien: ${cheaper.map(o =>
      `${UI.money(o.upfront_amount_minor / 100)} bij ${o.seller}`).join(", ")}.`);
    // Een prijs zonder btw of na btw-teruggave wordt niet als aanschafprijs gebruikt, wel genoemd.
    const otherOffer = offer ? null : offers[0] ?? null;
    const phases = claim("phase_count")?.value ?? null;
    const sources = new Map();
    for (const { label, claim: c } of used) {
      sources.set(c.source_title, [...(sources.get(c.source_title) || []), `${label} #${c.id}`]);
    }
    if (sources.size) notes.push(`Gebruikte bronclaims: ${[...sources].map(([title, list]) => `${title} (${list.join(", ")})`).join("; ")}.`);
    // Het hoogste AC-vermogen uit de bronnen, voor een afgeleide uitvoering op een eigen groep (circuitVariant).
    // Ook een claim ‘maximaal X kW’ (at_most) telt: zo noemen de bronnen het nominale vermogen.
    const highest = metric => numbers.filter(c => c.metric_key === metric && AC_BOUNDARY.includes(c.boundary))
      .reduce((a, b) => a && a.value >= b.value ? a : b, null);
    const fullPower = { discharge: highest("continuous_discharge_power_w"), charge: highest("continuous_charge_power_w") };
    // De kortste geldige productgarantie: voor een stresstest de voorzichtigste claim.
    const warranty = cmp.warranties.filter(w => live(w) && w.product_months != null).map(w => w.product_months);
    const warrantyYears = warranty.length ? Math.min(...warranty) / 12 : null;
    return {
      config, name: `${config.manufacturer_name} ${config.product_name} · ${config.name}`,
      capacity, chargeKw, dischargeKw, efficiency, standby, notes, missing, coupling, kind, circuit, fullPower,
      phases, backup: feature("backup"), outdoor: feature("outdoor"),
      inverterIncluded: feature("inverter_included")?.status === "supported", offer, otherOffer,
      warrantyYears,
      warrantyStress: warrantyStress(warrantyYears, `productgarantie van ${n(warrantyYears, warrantyYears % 1 ? 1 : 0)} jaar volgens de bron`),
      battery: capacity != null && dischargeKw != null ? {
        usable_capacity_kwh: capacity, charge_power_kw: chargeKw, discharge_power_kw: dischargeKw,
        ac_round_trip_efficiency_pct: efficiency, standby_w: standby,
        annual_capacity_loss_pct: FALLBACK.degradation, operating_life_years: FALLBACK.life
      } : null
    };
  }

  // Een stekkeraccu in een gewoon stopcontact rekent met hoogstens 800 W ontladen, zoals het veiligheidsadvies in de keuzehulp,
  // en hoogstens 800 W laden: de bronnen noemen bij laden het vermogen van het apparaat, niet of de stekkerstand het begrenst,
  // en sommige verkopers noemen 800 W laden op een bestaande groep. Meer vermogen kost een eigen groep; die uitvoeringen
  // houden hun volle vermogen en krijgen de kosten van die groep. Keuzehulp en Zelf doorrekenen gebruiken allebei deze functie.
  const PLUG_LIMIT_KW = 0.8;
  function plugLimit(p) {
    if (p.kind !== "plug" || !p.battery) return p;
    const discharge = p.dischargeKw > PLUG_LIMIT_KW, charge = p.chargeKw > PLUG_LIMIT_KW;
    if (!discharge && !charge) return p;
    const notes = [...p.notes];
    if (discharge) notes.push(`Aanname: ontladen ingesteld op 800 W voor een gewoon stopcontact; de bron noemt ${n(p.dischargeKw, 1)} kW. ` +
      "Of en hoe je dat instelt, staat in de handleiding of app.");
    if (charge) notes.push(`Aanname: laden ingesteld op 800 W voor een gewoon stopcontact; de bron noemt ${n(p.chargeKw, 1)} kW. ` +
      "Meer laadvermogen hoort, net als meer ontlaadvermogen, bij een eigen groep door een installateur.");
    return { ...p, name: discharge ? `${p.name} · begrensd op 800 W` : p.name,
      dischargeKw: Math.min(p.dischargeKw, PLUG_LIMIT_KW), chargeKw: Math.min(p.chargeKw, PLUG_LIMIT_KW),
      battery: { ...p.battery, discharge_power_kw: Math.min(p.battery.discharge_power_kw, PLUG_LIMIT_KW),
        charge_power_kw: Math.min(p.battery.charge_power_kw, PLUG_LIMIT_KW) }, notes };
  }

  // Een stekkeraccu die volgens de bronnen meer dan 800 W kan, doet ook mee als uitvoering op een eigen groep: met het
  // hoogste AC-vermogen uit de bronnen en de kosten van een extra groep. Alleen als de catalogus voor dit product
  // geen eigen-groepuitvoering heeft; `p` komt uit describe(), nog zonder plugLimit. Anders null.
  const CIRCUIT_NAME = /eigen groep|verdeelkast/i;
  function circuitVariant(cmp, p) {
    if (p.kind !== "plug" || !p.battery) return null;
    const { discharge, charge } = p.fullPower || {};
    const dischargeKw = discharge ? discharge.value / 1000 : p.dischargeKw;
    const chargeKw = charge ? charge.value / 1000 : dischargeKw;
    if (!(dischargeKw > PLUG_LIMIT_KW || chargeKw > PLUG_LIMIT_KW)) return null;
    const { manufacturer_name: maker, product_name: product } = p.config;
    if (cmp.configurations.some(c => c.manufacturer_name === maker && c.product_name === product && CIRCUIT_NAME.test(c.name))) return null;
    const kw = dischargeKw > PLUG_LIMIT_KW ? `eigen groep ${n(dischargeKw, 1)} kW` : `eigen groep, laden ${n(chargeKw, 1)} kW`;
    const config = /stekker(\s+[\d,]+\s*k?W)?/i.test(p.config.name)
      ? p.config.name.replace(/stekker(\s+[\d,]+\s*k?W)?/i, kw) : `${p.config.name} · ${kw}`;
    const claimText = (c, value) => c ? `${n(value, 1)} kW (claim #${c.id}, ${c.source_title})` : `${n(value, 1)} kW (gelijk aan ontladen)`;
    return { ...p, name: `${maker} ${product} · ${config} (afgeleid)`, kind: "fixed", circuit: true, derived: true,
      dischargeKw, chargeKw, battery: { ...p.battery, discharge_power_kw: dischargeKw, charge_power_kw: chargeKw },
      notes: [...p.notes, `Aanname: afgeleide uitvoering op een eigen groep. De bronnen noemen deze stekkerbatterij niet apart ` +
        `op een eigen groep; gerekend met het hoogste vermogen uit de bronnen: ${claimText(discharge, dischargeKw)} ontladen en ` +
        `${claimText(charge, chargeKw)} laden, plus een extra groep door een elektricien. Of de fabrikant dat vermogen ` +
        "vrijgeeft (bijvoorbeeld met een installateurs- of premiumstand), staat in de handleiding of app."] };
  }

  // Kostenindicatie voor alle 26 posten. `item`: { kind, circuit, manufacturer, phases, inverterIncluded };
  // `situation`: { place, backup, phases } uit de keuzehulp. Elke regel noemt een bron of aanname.
  // Een stekkeraccu op een eigen groep (`circuit`) krijgt de stekkerposten plus een extra groep,
  // geen installatiepakket.
  // Kostenopbouw voor een onderzochte uitvoering (`describe`): de gepubliceerde prijs als accupost en voor de
  // rest bronvermelde indicaties; wat de aanbieding al omvat (installatie, omvormer) telt niet nog eens.
  // De keuzehulp en Zelf doorrekenen gebruiken allebei deze functie, zodat de startkosten gelijk zijn.
  function costLinesFor(catalogData, p, situation = {}, kind = p.kind) {
    const lines = estimateCosts(catalogData, { kind, circuit: p.circuit === true, manufacturer: p.config.manufacturer_name,
      phases: p.phases ?? null, inverterIncluded: p.inverterIncluded, offer: p.offer }, situation);
    if (!p.offer) return lines;
    const installation = p.offer.includes_installation === true ? ", inclusief installatie"
      : p.offer.includes_installation === false ? ", exclusief installatie" : "";
    return lines.map(line => line.category !== "battery" ? line : {
      ...line, status: "priced", amount_minor: p.offer.upfront_amount_minor,
      source: `${p.offer.seller}: ${p.offer.source_url} (bronmomentopname ${RESEARCHED_SPAN})`,
      notes: `Gepubliceerde prijs inclusief btw${installation}.`
    });
  }
  function estimateCosts(catalogData, item, situation = {}) {
    const { amounts, meters, facts } = catalogData.estimates;
    const circuit = item.circuit === true && item.kind !== "plug", fixed = item.kind !== "plug" && !circuit;
    const byMaker = list => list.find(x => x.manufacturer === item.manufacturer);
    const lines = new Map(catalogData.categories.map(c => [c.key,
      { category: c.key, status: "not_applicable", amount_minor: 0, timing: c.timing, year: null, source: "Aanname", notes: "" }]));
    const set = (key, status, source, notes, eur = 0) =>
      Object.assign(lines.get(key),
        { status, amount_minor: status === "priced" ? Math.round(eur * 100) : 0, source, notes });
    const priced = (key, ref, eur = ref.amount_eur) => set(key, "priced", ref.url, `${ref.label}. ${ref.detail}`, eur);
    const assume = (key, notes, status = "not_applicable") => set(key, status, "Aanname", notes);
    const fact = (key, f, status = "not_applicable") => set(key, status, f.url, f.detail);
    const pack = detail => ({ url: amounts.installation_basic.url, detail });

    set("battery", "unknown", "Nog in te vullen", "Aanschafprijs van de accu.");
    if (item.inverterIncluded) set("inverter", "included", "Bronclaim van de fabrikant",
      "De omvormer zit in het product.");
    else set("inverter", "unknown", "Nog in te vullen",
      "Dit product heeft een aparte of hybride omvormer nodig; vraag de prijs na.");

    // Wat een aanbieding volgens de bron al omvat, telt niet nog eens als aparte post.
    const offer = item.offer;
    const inOffer = what => ({ url: offer.source_url, detail: `Inbegrepen in de aanbieding van ${offer.seller} (${what}).` });
    if (offer?.includes_inverter === true) fact("inverter", inOffer("omvormer"), "included");

    if (fixed) {
      const outside = situation.place === "outside", package_ = outside ? amounts.installation_extended : amounts.installation_basic;
      if (offer?.includes_installation === true) {
        fact("installation", inOffer("installatie; meerwerk na de schouw komt daar nog bij"), "included");
        for (const key of ["ems_metering", "cabling_protection", "survey_permits"]) fact(key, inOffer("installatie"), "included");
      } else {
        priced("installation", package_);
        fact("ems_metering", pack("Meting via P1 of CT-klem zit in het installatiepakket."), "included");
        fact("cabling_protection",
          pack(outside ? "Langere kabelroute, doorvoer en extra beveiliging zitten in het uitgebreide pakket." : "Aparte groep met beveiliging zit in het basispakket."),
          "included");
        fact("survey_permits", pack("Een schouw vooraf is altijd inbegrepen."), "included");
      }
      if (situation.backup === "yes") priced("backup", amounts.backup_extra);
        else assume("backup", "Geen noodstroom gevraagd.");
      if (item.phases === 3) priced("meter_cabinet", amounts.meter_cabinet_three_phase);
      else fact("meter_cabinet",
        pack("De aparte groep zit in het pakket. Een verouderde groepenkast vervangen (vanaf € 919) is niet meegeteld."),
        "included");
      if (item.phases === 3 && situation.phases === "1") priced("grid_connection", amounts.grid_one_to_three_phase);
      else assume("grid_connection",
        item.phases === 3 ? "Uitgaande van een bestaande 3-fasenaansluiting." : "Geen wijziging van de netaansluiting nodig.");
      assume("delivery",
        "Levering en voorrijkosten worden in de bron niet apart genoemd; aangenomen dat ze in pakket- of productprijs zitten.");
      // Zit de installatie in de aanbieding, dan geldt de reserve voor meerwerk over de indicatieve pakketprijs.
      const included = lines.get("installation").status === "included";
      const base = [...lines.values()].filter(l => ["installation", "backup", "meter_cabinet",
        "grid_connection"].includes(l.category)).reduce((sum, l) => sum + l.amount_minor,
        included ? Math.round(package_.amount_eur * 100) : 0);
      set("contingency", "priced", "Aanname",
        `${amounts.contingency_pct.label}. ${amounts.contingency_pct.detail}` +
          (included ? ` De installatie zit in de aanbieding; de reserve voor meerwerk rekent met de indicatieve pakketprijs van € ${n(package_.amount_eur, 0)}.` : ""),
        base / 100 * amounts.contingency_pct.amount_pct / 100);
    } else {
      assume("installation", "Stekkerbatterij: zelf aan te sluiten in een gewoon stopcontact.");
      assume("cabling_protection",
        "Aanname: geen installatiewerk. Een stopcontact op een groep waarop ook andere zware apparaten draaien kan overbelast raken; laat bij twijfel een installateur kijken of een eigen groep nodig is (dat kost extra) en controleer de voorwaarden van je verzekering.");
      assume("meter_cabinet", "Aanname: geen aanpassing van de meterkast; geldt alleen als de groep van het stopcontact het extra vermogen veilig aankan.");
      assume("survey_permits", "Geen schouw of keuring nodig voor een stekkerbatterij tot 800 W.");
      assume("backup", "Een stekkerbatterij levert geen noodstroom aan de woning.");
      assume("grid_connection", "Geen wijziging van de netaansluiting nodig.");
      assume("contingency", "Geen installatiewerk, dus geen reserve aangenomen.");
      const own = byMaker(meters), meter = own || meters.find(m => m.manufacturer === "HomeWizard");
      if (own) priced("ems_metering", own);
      else set("ems_metering", "priced", meter.url,
        `Aanname: een vergelijkbare P1-meter (${meter.label}) is nodig voor de regeling.`, meter.amount_eur);
      const delivery = byMaker(facts.delivery_free);
      if (delivery) fact("delivery", delivery, "included");
        else assume("delivery", "Verzendkosten niet vermeld; aangenomen dat ze in de prijs zitten.");
      if (circuit) {
        const group = amounts.dedicated_circuit;
        priced("installation", group);
        fact("cabling_protection", { url: group.url, detail: "De aansluiting met beveiliging zit in de richtprijs van de extra groep." },
          "included");
        assume("meter_cabinet",
          "Aanname: er is plek in de groepenkast. Een volle of verouderde kast uitbreiden of vervangen (vanaf € 919) is niet meegeteld.");
        assume("survey_permits",
          "De elektricien beoordeelt de aansluiting bij het aanleggen van de groep; een aparte keuring is niet meegeteld.");
        set("contingency", "priced", "Aanname",
          `${amounts.contingency_pct.label}, hier over de extra groep. ${amounts.contingency_pct.detail}`,
          group.amount_eur * amounts.contingency_pct.amount_pct / 100);
      }
    }
    const software = byMaker(facts.software_free);
    if (software) fact("subscription", software);
      else assume("subscription", "Geen abonnement vermeld voor de basisfuncties; aangenomen dat de app gratis is.");
    assume("maintenance",
      "Geen onderhoudskosten opgegeven; een LFP-accu met software-updates vraagt normaal geen periodiek onderhoud.");
    fact("insurance", facts.insurance);
    fact("extra_grid_fees", facts.grid_fees);
    assume("extra_contract_fees", "Een vast of variabel contract rekent geen extra kosten voor een accu.");
    for (const key of ["tax_administration", "tax_private_use", "vat_refund"]) fact(key, facts.vat);
    assume("other_upfront", "Geen overige startkosten bekend.");
    assume("other_annual", "Geen overige jaarkosten bekend.");
    if (item.inverterIncluded) assume("inverter_replacement",
      "De omvormer is onderdeel van het product; vervanging valt binnen de aangenomen levensduur van het geheel.");
    else assume("inverter_replacement", "Aanname: geen vervanging van de aparte omvormer binnen de looptijd. " +
      "Een losse omvormer kan korter meegaan dan de accu; vraag naar de garantie en tel anders een vervanging mee.");
    assume("battery_replacement", "Geen vervanging: het model stopt de accu na de aangenomen levensduur.");
    fact("removal_recycling", facts.recycling);
    fact("grant", facts.grant);
    assume("residual_value", "Geen restwaarde aangenomen (voorzichtig).");
    return [...lines.values()];
  }
  const isAssumption = line => line.source === "Aanname" || line.notes.startsWith("Aanname");

  // Een stroomprijs onder de energiebelasting plus een paar cent levering is vrijwel zeker alleen het leveringstarief;
  // dan valt de besparing van een accu veel te laag uit. Een waarschuwing, geen fout: het blijft je eigen invoer.
  // Vergoeding min terugleverkosten boven het gunstigste vaste contract uit het overzicht (exportText): vaak is dan een
  // vast bedrag per jaar als 0 ingevuld. Een vast bedrag hangt van de hoeveelheid af en is geen 0 per kWh.
  const EXPORT_NET_MAX = 0.044;
  // `own`: in Zelf doorrekenen, waar de staffels op hetzelfde scherm staan en het overzicht van contracten niet.
  const exportCheck = (vergoeding, kosten, { own = false } = {}) => vergoeding == null || kosten == null || vergoeding - kosten <= EXPORT_NET_MAX + 1e-9 ? null :
    `Vergoeding min terugleverkosten is ${n((vergoeding - kosten) * 100, 1)} cent per kWh, meer dan de 4,4 cent van het ` +
    `gunstigste vaste contract voor 2027 ${own ? "dat we vonden" : "in het overzicht hierboven"}. Rekent je leverancier nu een vast bedrag per jaar? Dat is ` +
    (own ? "geen 0: vraag wat teruglevering vanaf 2027 per kWh kost, of vul de jaarkosten in bij de staffels hieronder."
      : "geen 0: vraag wat teruglevering vanaf 2027 per kWh kost, kies de indicatie, of reken met staffels in Zelf doorrekenen.");
  // Vermeden netafname boven de grens van de tweede belastingschijf, voor het jaar waarin die het grootst is: { y, without,
  // kwh, eur } met `eur` de besparing die de ene stroomprijs dat jaar te hoog rekent, of null. `candidate` uit het
  // resultaat, `base` het eerste jaar zonder accu, `p` de parameters. Pas vanaf 2027 telt de belasting over alle netafname.
  function energyTaxBandExcess(candidate, base, p) {
    const band = INDICATION.energyTaxBand;
    if (p.start_year < 2027) return null;
    const above = (candidate.years || []).map(y => {
      const without = y.baseline_grid_import_kwh ?? (y.year === 1 ? base.grid_import_kwh : null);
      return { y, without, kwh: without == null ? 0 : Math.max(0, without - Math.max(y.energy.grid_import_kwh, band.above_kwh)) };
    }).filter(a => a.kwh > 0).sort((a, b) => b.kwh - a.kwh)[0];
    if (!above) return null;
    const factor = (1 + p.tariff.annual_price_change_pct / 100) ** (above.y.year - 1);
    return { ...above, eur: above.kwh * band.lower_eur_per_kwh * factor };
  }
  const importPriceCheck = value => value == null || value >= INDICATION.energyTax + 0.05 ? null :
    `Dat is minder dan de energiebelasting van 2027 (€ 0,1065 per kWh) plus een gangbaar leveringstarief. Is dit alleen ` +
    "het leveringstarief? Tel de energiebelasting erbij op, anders valt de besparing van een accu veel te laag uit.";

  // Standaard projectie-aannames, aanpasbaar in Instellingen; nooit voor bewaarde runs. Alles in lopende euro's:
  // de discontovoet is een gewone rente (met inflatie), dus energieprijzen en jaarkosten stijgen standaard even hard
  // mee, 2% per jaar (het inflatiedoel van de ECB). Met 0% prijsverandering zou stroom elk jaar goedkoper worden
  // ten opzichte van al het andere (docs/roi-model.md).
  const DEFAULTS = { start_year: 2027, horizon_years: 15, discount_pct: 4, annual_cost_escalation_pct: 2,
    annual_pv_loss_pct: 0, annual_load_growth_pct: 0, annual_price_change_pct: 2, price_uncertainty_pct: 20,
    cost_uncertainty_pct: 15 };
  // Oudere versies bewaarden de aannames per formulierveld-id.
  const LEGACY_IDS = { start_year: "analysis-start", horizon_years: "analysis-years",
    discount_pct: "analysis-discount", annual_cost_escalation_pct: "cost-escalation",
    annual_pv_loss_pct: "pv-degradation", annual_load_growth_pct: "load-growth",
    annual_price_change_pct: "tariff-escalation", price_uncertainty_pct: "price-uncertainty",
    cost_uncertainty_pct: "cost-uncertainty" };
  const defaults = () => {
    const legacy = UI.store.get("thuisaccu-defaults", {});
    const migrated = Object.fromEntries(Object.entries(LEGACY_IDS).map(([key, id]) => [key,
      Number(legacy[id])]).filter(([, v]) => Number.isFinite(v)));
    const saved = UI.store.get("thuisaccu-standaard", migrated), out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) if (Number.isFinite(saved[key])) out[key] = saved[key];
    return out;
  };

  return {
    RULES, described, CREDITS, modelChanges, unaffectedByModel, ASSUMED, KEUZEHULP_PREFIX, isAssumed, fromKeuzehulp, MODEL_VERSION, GLOSSARY, QUOTE_FIELDS, isPriceField, quoteValue, quoteUnit, quoteChange, applyQuotePrice,
    catalog, costs, typicalSources, imports, runs, run, invalidateCatalog, objectives, costStatus, boundaries,
      qualifiers, review,
    RESEARCHED_ON, RESEARCHED_SPAN, INDICATION, importPriceCheck, exportCheck, upfrontCosts, energyTaxBandExcess, ASSUMPTION_HELP, monthsBetween, priceAge, suitability, unusableText, implausible, isDemo, FALLBACK, describe, estimateCosts, costLinesFor, warrantyStress, warrantyNote, WARRANTY_LOSS, plugLimit, circuitVariant, CONNECTIONS, connectionOf, shortLabels, newestOffer, isAssumption, DEFAULTS, defaults
  };
})();
