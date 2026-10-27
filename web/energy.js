"use strict";

// Energieprofielen: overzicht, detail en de importwizard voor omvormer- en meterbestanden.
// Bestanden worden alleen door de eigen lokale server verwerkt, of in de browserversie in deze browser.
(() => {
  const { h, button, link, external, badge, table, stats, chart, field, input, numberInput, select, kwh, number: n,
    toast } = UI;
  // Tijdzones voor een bestand zonder UTC-offset. Veel omvormer- en spreadsheetexports houden het hele jaar
  // wintertijd aan; in Nederlandse tijd bestaat dan het uur na 2:00 op de zomertijddag niet.
  const ZONES = [["Europe/Amsterdam", "Nederlandse tijd, met zomertijd"], ["Etc/GMT-1", "Het hele jaar wintertijd (UTC+1)"],
    ["UTC", "UTC"]];
  const zoneLabel = zone => ZONES.find(([key]) => key === zone)?.[1] ?? zone;
  const PERIODS = { "5min": "5 min", "10min": "10 min", "15min": "15 min", "30min": "30 min", hour: "1 uur",
    day: "Dag", week: "Week", month: "Maand", year: "Jaar" };
  // Decimaalteken uit de voorbeeldrijen: alleen een eenduidig patroon telt, anders blijft de keuze staan.
  function guessDecimal(preview, columns, current) {
    const cells = preview.flatMap(row => columns.filter(c => c != null).map(c => String(row[c] ?? "").trim()));
    const comma = cells.some(v => /^-?\d+,\d+$/.test(v)), dot = cells.some(v => /^-?\d+\.\d+$/.test(v));
    return comma && !dot ? "comma" : dot && !comma ? "dot" : current;
  }
  // Een meetwaarde die de meter per tarief telt (T1 en T2, normaal en dal): de eerste kolom plus de kolom die erbij
  // optelt. Een totaalkolom gaat voor, zodat niets dubbel telt; zonder tariefnaam alleen de eerste kolom.
  function tariffColumns(headers, pattern, not = /$^/) {
    const all = headers.flatMap((name, i) => pattern.test(name) && !not.test(name) ? [i] : []);
    const total = all.find(i => /tota/i.test(headers[i]));
    if (total != null) return [total];
    const tariffs = all.filter(i => /\bt[12]\b|tarief|tariff|normaal|\bdal\b|\blaag\b|\bhoog\b|peak|\bhigh\b|\blow\b/i.test(headers[i]));
    return tariffs.length >= 2 ? tariffs.slice(0, 2) : all.slice(0, 1);
  }
  // Meterstanden in plaats van energie per periode: in de voorbeeldrijen lopen alle gekozen kolommen alleen op, en
  // minstens één staat ver boven de stappen (een teller op 12.345 kWh die per kwartier 0,1 kWh oploopt).
  function looksCumulative(preview, columns, decimal) {
    const series = columns.filter(c => c != null).map(c => preview.map(row => {
      const raw = String(row[c] ?? "").trim();
      return raw === "" ? NaN : Number(decimal === "comma" ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""));
    }));
    if (preview.length < 3 || !series.length ||
      series.some(values => values.some((v, i) => !Number.isFinite(v) || (i > 0 && v < values[i - 1])))) return false;
    return series.some(values => {
      const step = (values.at(-1) - values[0]) / (values.length - 1);
      return step > 0 && values[0] >= 100 * step;
    });
  }
  const CUMULATIVE_NOTE = "De waarden in de eerste rijen lopen steeds verder op: dit lijken meterstanden. Daarom staat " +
    "‘Soort waarden’ op ‘Cumulatieve meterstanden’. Zijn het toch waarden per meetperiode, kies dan ‘Per meetperiode’.";
  // ‘2025-01’ wordt ‘jan’; loopt de reeks over twee kalenderjaren, dan met het jaar erbij (‘jul ’25’).
  function monthLabel(label, months) {
    if (!/^\d{4}-\d{2}$/.test(label)) return label;
    const month = new Date(`${label}-01T12:00:00`).toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
    return new Set(months.map(m => m.label.slice(0, 4))).size > 1 ? `${month} ’${label.slice(2, 4)}` : month;
  }
  // Meetperiode uit de tijdstippen van de voorbeeldrijen (ISO of dag-maand-jaar met tijd). Alleen als alle
  // stappen gelijk zijn en een bekende periode vormen; de server controleert het bestand daarna volledig.
  function guessPeriod(preview, timeColumn, partColumn) {
    const minutes = preview.map(row => {
      const raw = `${row[timeColumn] ?? ""} ${partColumn == null ? "" : row[partColumn] ?? ""}`;
      const date = raw.match(/(\d{4})-(\d{2})-(\d{2})/) || raw.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
      const time = raw.match(/(\d{1,2}):(\d{2})/);
      if (!date || !time) return null;
      const [y, m, d] = date[1].length === 4 ? [date[1], date[2], date[3]] : [date[3], date[2], date[1]];
      return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(time[1]), Number(time[2])) / 60000;
    });
    if (minutes.length < 3 || minutes.some(v => v == null)) return null;
    const steps = new Set(minutes.slice(1).map((v, i) => v - minutes[i]));
    const step = steps.size === 1 ? [...steps][0] : null;
    return { 5: "5min", 10: "10min", 15: "15min", 30: "30min", 60: "hour" }[step] ?? null;
  }
  const fitBadge = item => { const fit = Data.suitability(item);
    return badge(fit.reason, fit.ok === true ? "success" : fit.ok === false ? "warning" : ""); };
  // De les van de capaciteitscurve in één zin: waar een grotere accu weinig meer oplevert (energie, geen geld).
  function takeaway(points) {
    const largest = points.at(-1), most = largest?.battery_to_load_kwh ?? 0;
    if (most < 1) return h("p", {}, "Er is vrijwel geen zonnestroom over om op te slaan; een accu heeft hier weinig om mee te werken.");
    const enough = points.find(p => p.battery_to_load_kwh >= 0.9 * most);
    return h("p", {}, `Een accu van ongeveer ${n(enough.usable_capacity_kwh, 1)} kWh haalt al 90% van wat een accu van ` +
      `${n(largest.usable_capacity_kwh, 0)} kWh zou opleveren (${kwh(most)} per jaar). Daarboven levert elke extra kWh accu weinig ` +
      "meer eigen zonnestroom op. Dit gaat over energie; wat financieel uitkomt, laat een berekening zien.");
  }
  const title = item => h("span", {}, item.filename, Data.isDemo(item) ? [" ", badge("FICTIEF", "demo")] : null);
  // Tijdstippen in Nederlandse tijd met de zone erbij (CET/CEST), ook als het bestand in UTC stond.
  const when = seconds => new Date(seconds * 1000).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam",
    day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  // De eerste rijen zoals ze in het bestand staan; kolommen met alleen getallen rechts uitgelijnd.
  const previewTable = (headers, rows) => table(headers, rows, { caption: "Eerste rijen uit het bestand",
    numeric: headers.map((_, i) => i).filter(i => rows.length > 0 && rows.every(row => /^[+-]?[\d.,]+$/.test(String(row[i] ?? "").trim()))) });
  // fileZone: de tijdzone waarin het bestand is gelezen; null voor een geschat profiel.
  function summaryView(summary, fileZone = null) {
    const hasUse = summary.consumption_kwh != null;
    return h("div", {},
      stats([["Zonne-opwek", kwh(summary.production_kwh)],
        ["Verbruik", hasUse ? kwh(summary.consumption_kwh) : "Niet in bestand"], ["Meetperioden", n(summary.rows, 0)],
        ["Dekking", `${n(summary.coverage_hours, 0)} uur`], ["Ontbrekende perioden", n(summary.gaps, 0)]]),
      h("p", { class: "help" },
        `Van ${when(summary.from_unix_s)} tot ${when(summary.to_unix_s)}${fileZone ? ` · tijden in het bestand: ${zoneLabel(fileZone)}` : ""}`),
      summary.grid_import_kwh != null ? h("p", {}, `Gemeten netafname: ${kwh(summary.grid_import_kwh)}. Teruglevering: ` +
        `${kwh(summary.grid_export_kwh)}. Vergelijk dit met je jaarafrekening over dezelfde periode; een groot verschil wijst ` +
        "meestal op een verkeerde kolom, eenheid of soort waarden.") : null,
      summary.interval_surplus_kwh != null ? h("p", {},
        `Opwek boven verbruik per meetperiode: ${kwh(summary.interval_surplus_kwh)}. Verbruik boven opwek: ${kwh(summary.interval_deficit_kwh)}. Dit zijn optellingen per meetperiode, geen accubesparing.`) : null,
      chart("bar",
        { title: "Maandtotalen", unit: "kWh",
          series: [{ label: "Zonne-opwek" }, ...(hasUse ? [{ label: "Verbruik" }] : [])],
          rows: summary.months.map(m => ({ label: monthLabel(m.label, summary.months),
            values: [m.production_kwh, ...(hasUse ? [m.consumption_kwh] : [])] })) }),
      summary.warnings.length ? h("ul", { class: "warnings" }, summary.warnings.map(w => h("li", {}, w))) : null);
  }

  UI.page("energie", {
    nav: "Energiegegevens", icon: "sun", title: "Energiegegevens",
      subtitle: `Bewaarde profielen met opwek en verbruik, ${Local.where}.`,
    async render(view, actions) {
      actions.append(link("+ Importeer een bestand", "#/energie/import", "button"));
      const items = await Data.imports();
      if (!items.length) {
        view.append(UI.empty("Nog geen energieprofielen", "Importeer een export van je omvormer of slimme meter, of laat de keuzehulp een geschat profiel maken uit je jaartotalen.",
          link("Importeer een bestand", "#/energie/import", "button"), link("Naar de keuzehulp", "#/keuzehulp", "button secondary")));
        return;
      }
      view.append(table(["Profiel", "Periode", "Resolutie", "Opwek", "Verbruik", "Bruikbaar voor een berekening", ""], items.map(item => [
        link(title(item), `#/energie/${item.id}`),
          // Het einde is het eind van de laatste meetperiode; toon de laatste dag die erin valt.
          `${UI.dateOnly(item.summary.from_unix_s)} – ${UI.dateOnly(item.summary.to_unix_s - 1)}`,
        PERIODS[item.options.combined_period || item.options.period] || (Data.isDemo(item) ? "1 uur" : "Onbekend"),
          kwh(item.summary.production_kwh),
        item.summary.consumption_kwh == null ? "Nee" : kwh(item.summary.consumption_kwh), fitBadge(item),
        button("Verwijder", () => remove(item), "ghost remove", { "aria-label": `Verwijder ${item.filename}` })]),
        { caption: "Bewaarde energieprofielen", stack: true }));
    }
  });

  // Een profiel gaat samen met de berekeningen erop; de vraag noemt hoeveel dat er zijn.
  function remove(item) {
    const runs = item.analysis_runs || 0;
    UI.confirm("Energieprofiel verwijderen?", [
      `‘${item.filename}’ wordt met alle meetperioden verwijderd. Dit kan niet ongedaan worden gemaakt.`,
      runs ? `Ook ${runs === 1 ? "de berekening" : `de ${runs} berekeningen`} op dit profiel ${runs === 1 ? "wordt" : "worden"} verwijderd. ` +
        "Gedeelde links naar een berekening blijven werken; die bevatten de uitkomst zelf."
        : "Er zijn geen berekeningen op dit profiel."
    ], "Verwijder profiel", async () => {
      const result = await UI.api(`/api/v1/solar/imports/${item.id}`, { method: "DELETE" });
      forget(String(item.id));
      toast(result.deleted_analysis_runs ? `Profiel en ${result.deleted_analysis_runs} berekening(en) verwijderd.` : "Profiel verwijderd.");
      UI.reload();
    });
  }

  // Concepten in de browser die naar het verwijderde profiel wezen, kiezen opnieuw.
  function forget(id) {
    const wizard = UI.store.get("thuisaccu-keuzehulp", null);
    if (wizard?.importId === id) UI.store.set("thuisaccu-keuzehulp", { ...wizard, importId: "" });
    const own = UI.store.get("thuisaccu-scenario", null);
    if (own?.profile === id) UI.store.set("thuisaccu-scenario", { ...own, profile: "" });
  }

  UI.page("energie/:id", {
    title: "Energieprofiel", subtitle: "Opwek, verbruik en datakwaliteit.", parent: "energie",
    async render(view, actions, { id }, page) {
      const item = (await Data.imports()).find(i => String(i.id) === id);
      if (!item) { view.append(UI.empty("Profiel niet gevonden", "Kies een bewaard energieprofiel.",
        link("Terug naar energiegegevens", "#/energie", "button")));
        return; }
      page.setTitle(item.filename);
      const fit = Data.suitability(item);
      if (fit.ok === true) {
        actions.append(
          button("Gebruik in de keuzehulp",
            () => { UI.store.set("thuisaccu-keuzehulp",
              { ...UI.store.get("thuisaccu-keuzehulp", {}), data: "file", importId: String(item.id) });
              location.hash = "#/keuzehulp"; }),
          // Alleen het profiel wisselt; opties en kostenposten in een bestaand concept blijven staan.
          button("Zelf doorrekenen", () => { UI.store.set("thuisaccu-scenario",
            { ...UI.store.get("thuisaccu-scenario", {}), profile: String(item.id) }); location.hash = "#/zelf"; }, "secondary"));
      }
      const problem = fit.ok === false ? Data.unusableText(item.summary) : null;
      // De bestandsnaam staat al in de paginatitel; hier alleen de status (en FICTIEF bij demogegevens).
      UI.append(view, [h("p", {}, fitBadge(item), Data.isDemo(item) ? [" ", badge("FICTIEF", "demo")] : null),
        problem ? h("div", { class: "callout", role: "note" }, h("p", {}, problem),
          h("p", {}, link("Naar de keuzehulp", "#/keuzehulp", "button secondary"))) : null,
        summaryView(item.summary, item.options.generator ? null : item.options.timezone || "UTC")]);
      if (fit.ok === true) {
        const curve = await UI.api(`/api/v1/solar/imports/${item.id}/capacity`).catch(() => null);
        if (curve) view.append(chart("line",
          { title: "Zonnestroom die je via een accu zelf kunt gebruiken, per accugrootte", unit: "kWh per jaar",
            xLabel: "Bruikbare capaciteit van de accu",
            rows: curve.points.map(p => ({ label: `${n(p.usable_capacity_kwh, 0)} kWh`, x: p.usable_capacity_kwh,
              values: [p.battery_to_load_kwh] })),
            series: [{ label: "Uit de accu zelf gebruikt" }] }),
          takeaway(curve.points), h("p", { class: "help" }, curve.assumptions));
        // Imports van vóór modelversie 3 bewaarden de meterwaarden per periode nog niet.
        if (curve && curve.measured_periods === 0 && (item.options.consumption_source === "net_meter" || item.options.meter))
          view.append(h("p", { class: "callout", role: "note" }, "Importeer dit bestand opnieuw met dezelfde instellingen. " +
            "Je krijgt dan een nieuw profiel met de gemeten netafname en teruglevering per periode, zodat de grafiek en nieuwe " +
            "berekeningen de werkelijke gelijktijdigheid van opwek en verbruik gebruiken in plaats van een geschatte verdeling. " +
            "Dit profiel en de berekeningen erop blijven ongewijzigd; verwijder het daarna als je het niet meer nodig hebt."));
      }
    }
  });

  // Exporthulp per platform; kolommen, eenheid en periode blijven altijd zelf te controleren.
  const PROFILES = {
    generic: ["Algemeen: eigen kolommen",
      "Kies de tijd-, opwek- en eventuele verbruikskolommen van je eigen export. Controleer eenheid en meetperiode.",
      null],
    solaredge: ["SolarEdge Monitoring",
      "Gebruik installatieproductie uit Monitoring (CSV/Excel) of een bewaarde Site Energy JSON-export. Kies bij JSON date/value; eenheid en periode komen uit de metadata. Ontbrekende waarden zijn geen nul.",
      "https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf"],
    enphase: ["Enphase Enlighten",
      "Exporteer in Reports de Site Energy Production, eventueel met Site Energy Consumption. Gebruik het installatietotaal. Recent Power bevat vermogen, geen periode-energie.",
      "https://enphase.com/sites/default/files/2025-08/Enphase-solar-troubleshooting-guide-ING-00061-2.0-EN-INT-2025-08-14.pdf"],
    sma: ["SMA Sunny Portal",
      "Configuration → Data Export voor de energiebalans; kies productie, niet netexport. Analysis Pro kan 5-minutengemiddelden exporteren; kies dan gemiddeld W/kW en 5 minuten.",
      "https://www.sma.de/en/products/energy-management/sunny-portal"],
    fronius: ["Fronius Solar.web",
      "Exporteer een productie- of energiebalansrapport als CSV/Excel. Kies de totale PV-productie. Selecteer bij aparte datum en tijd beide kolommen.",
      "https://www.fronius.com/~/downloads/Solar%20Energy/Whitepaper/SE_WP_Fronius_RGM_Guide_GEN24_Customer_EN.pdf"],
    pvgis: ["PVGIS uurdata (CSV / 5.x JSON)",
      "Kies time en P. P is vermogen in W: uurperiode, UTC en gemodelleerde opwek.",
      "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en"]
  };

  UI.page("energie/import", {
    title: "Bestand importeren", subtitle: "Van export naar gecontroleerd energieprofiel in vijf stappen.",
      parent: "energie",
    render(view) {
      // Opties volgen ImportOptions in crates/server/src/solar_import.rs.
      const options = { profile: "generic", sheet: null, header_row: 0, delimiter: "auto", decimal: "dot",
        time_column: 0, time_part_column: null, production_column: 1, consumption_column: null,
        consumption_extra_columns: [], consumption_source: "gross", export_column: null, export_extra_columns: [], unit: "kwh", mode: "interval", period: "hour",
        timezone: "Europe/Amsterdam", timestamp_position: "start", data_kind: "measured", date_order: "day_first",
        missing_rows: "reject" };
      // `clock`: een tijdstip dat door de klokwisseling niet bestaat, bij de stap waar je de tijdzone kiest.
      // `cumulative`: de kolommen lijken meterstanden; dat staat er bij de keuze.
      const state = { file: null, name: "", inspected: null, sheets: [], summary: null, previewed: null, noProduction: false,
        clock: null, cumulative: false };
      // Optioneel meterbestand; opties volgen MeterOptions in solar_import.rs.
      const meter = {
        use: false, file: null, inspected: null, cumulative: false,
        options: {
          sheet: null, header_row: 0, delimiter: "auto", decimal: "dot", time_column: 0, time_part_column: null,
          import_column: 1, import_extra_columns: [], export_column: 2, export_extra_columns: [], unit: "kwh", mode: "interval", period: "15min",
          timezone: "Europe/Amsterdam", timestamp_position: "start", date_order: "day_first", missing_rows: "reject"
        }
      };
      const fileKey = file => [file?.name, file?.size, file?.lastModified];
      const signature = () => JSON.stringify([fileKey(state.file), options,
        meter.use && [fileKey(meter.file), meter.options]]);
      const multipart = (withMeter = true) => {
        const body = new FormData();
        // De bestandsnaam bepaalt het formaat (de extensie); een eigen naam gaat apart mee, alleen bij bewaren.
        body.append("file", state.file, state.file.name);
        body.append("options", JSON.stringify(options));
        if (withMeter && meter.use) {
          body.append("meter_file", meter.file, meter.file.name);
          body.append("meter_options", JSON.stringify(meter.options));
        }
        return body;
      };
      // Zonder eigen naam heet een profiel naar het bestand, of naar beide bestanden (zoals de server dat doet).
      const defaultName = () => meter.use && meter.file ? `${state.file.name} + ${meter.file.name}` : state.file.name;
      const bindTo = target => (control, key, cast = v => v) => {
        control.addEventListener("change", () => { target[key] = cast(control.value); state.previewed = null; });
        return control;
      };
      const bind = bindTo(options), bindMeter = bindTo(meter.options);
      // Tijdzone als keuze, met een eigen IANA-naam als uitweg. Na een klokfout erbij: wat er mis is en
      // met één klik de waarschijnlijke oplossing.
      function zoneFields(target, which, help) {
        const known = ZONES.some(([key]) => key === target.timezone);
        const other = input({ value: known ? "" : target.timezone, placeholder: "Europe/Brussels", required: !known });
        const otherField = field("Andere tijdzone (IANA-naam)", other);
        otherField.hidden = known;
        const pick = select([...ZONES, ["other", "Andere tijdzone…"]], known ? target.timezone : "other");
        const changed = zone => { target.timezone = zone; state.previewed = null; };
        pick.addEventListener("change", () => {
          const own = pick.value === "other";
          otherField.hidden = !own; other.required = own;
          changed(own ? other.value.trim() : pick.value);
          if (own) other.focus();
        });
        other.addEventListener("change", () => changed(other.value.trim()));
        const fields = [field("Tijdzone", pick, help), otherField];
        if (state.clock?.which !== which) return fields;
        const use = (zone, text, kind) => button(text, () => {
          state.clock = null; changed(zone); flow.rerender();
          toast(`Tijdzone: ${zoneLabel(zone)}. Klik op Volgende om opnieuw te controleren.`);
        }, kind);
        return [...fields, h("div", { class: "callout wide problem", role: "alert" },
          h("h3", { tabindex: "-1" }, "Je bestand loopt niet mee met de zomertijd"),
          h("p", { class: "small" }, state.clock.message),
          h("p", {}, "Zo’n tijdstip komt voor als je export het hele jaar dezelfde kloktijd gebruikt, zonder zomertijd. " +
            "Meestal is dat wintertijd; sommige apparaten gebruiken UTC. Piekt de opwek op een zonnige zomerdag rond " +
            "12:40, dan is het wintertijd; rond 11:40 is het UTC (bij panelen op het zuiden)."),
          h("p", { class: "actions" }, use("Etc/GMT-1", "Lees als wintertijd (UTC+1)"), use("UTC", "Lees als UTC", "secondary")))];
      }
      const headerOptions = (headers, optional) => [
        ...(optional ? [["", "Niet beschikbaar"]] : []),
        ...headers.map((name, i) => [String(i), `${i + 1}. ${name || "(leeg)"}`])
      ];
      const toColumn = v => v === "" ? null : Number(v);
      const column = (key,
        optional) => bind(select(headerOptions(state.inspected.headers, optional), options[key] ?? ""), key, toColumn);
      const meterColumn = (key, optional) =>
        bindMeter(select(headerOptions(meter.inspected.headers, optional), meter.options[key] ?? ""), key, toColumn);
      // Eén kolom die bij een meetwaarde optelt (tarief 2); de opties bewaren een lijst.
      const toExtra = v => v === "" ? [] : [Number(v)];
      const extraColumn = key => bind(select(headerOptions(state.inspected.headers, true), options[key][0] ?? ""), key, toExtra);
      const meterExtra = key =>
        bindMeter(select(headerOptions(meter.inspected.headers, true), meter.options[key][0] ?? ""), key, toExtra);

      function stepFile(body) {
        const profile = PROFILES[options.profile];
        const fileInput = h("input", { type: "file", accept: ".csv,.tsv,.txt,.xlsx,.xls,.ods,.json", required: !state.file,
          onchange: event => { state.file = event.target.files[0] || null; state.inspected = null; state.previewed = null; } });
        const drop = h("label", { class: "drop" },
          h("strong", {}, state.file ? `Gekozen: ${state.file.name}` : "Kies of sleep een bestand hierheen"),
          h("small", {}, "CSV, Excel of JSON; maximaal 10 MB en 250.000 rijen."), fileInput);
        drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("over"));
        drop.addEventListener("drop",
          event => { event.preventDefault(); drop.classList.remove("over"); const file = event.dataTransfer.files[0];
            if (file) { state.file = file; state.inspected = null; flow.rerender(); } });
        const platform = select(Object.entries(PROFILES).map(([key, [label]]) => [key, label]), options.profile, { onchange: event => {
          options.profile = event.target.value; state.inspected = null;
          if (options.profile === "pvgis") Object.assign(options,
            { unit: "w", period: "hour", mode: "interval", timezone: "UTC", data_kind: "modelled" });
          flow.rerender();
        } });
        body.append(h("h2", {}, "Bestand"), h("div", { class: "split" },
          h("div", {}, field("Exportprofiel", platform), drop,
            h("div", { class: "grid" }, field("Regels vóór de kopregel", bind(numberInput({ min: "0", max: "1000", step: "1", value: String(options.header_row) }), "header_row", v => UI.parse(v) ?? 0)),
              field("CSV-scheiding",
                bind(select([["auto", "Automatisch"], ["semicolon", "Puntkomma ;"], ["comma", "Komma ,"],
                  ["tab", "Tab"]],
                  options.delimiter),
                  "delimiter")),
              state.sheets.length ? field("Werkblad", bind(select(state.sheets.map(s => [s, s]), options.sheet ?? state.sheets[0]), "sheet")) : null)),
          h("aside", { class: "panel" }, h("h3", {}, "Hulp bij je export"), h("p", {}, profile[1]), profile[2] ? external("Exportuitleg van de aanbieder ↗", profile[2]) : null,
            h("p", { class: "help" }, "Slimme meter (P1): kies in de volgende stap ‘Netafname uit de slimme meter’ en daarnaast de terugleverkolom. Het totale verbruik wordt dan opwek + afname − teruglevering."))));
      }
      async function inspect() {
        if (!state.file) throw new Error("Kies eerst een bestand.");
        const sent = signature(), result = await UI.api("/api/v1/solar/inspect", { method: "POST", body: multipart() });
        if (sent !== signature()) throw new Error("De instellingen zijn veranderd. Lees het bestand opnieuw.");
        state.inspected = result; state.sheets = result.sheets;
        const guess = (pattern, not = /$^/) => result.headers.findIndex(name => pattern.test(name) && !not.test(name));
        // ‘Energie (Wh)’ of ‘Opbrengst’ is opwek, behalve als de naam ook verbruik of het net noemt.
        const time = guess(/timestamp|datum|date|tijd|time/i),
          production = guess(/production|produced|opwek|opbrengst|generation|erzeugung|ertrag|^P$|^value$|^energ|yield/i,
            /verbruik|consum|afname|import|export|teruglever|levering|grid/i);
        const consumption = guess(/consumption|consumed|verbruik|verbrauch/i),
          exports = tariffColumns(result.headers, /teruglever|export|feed.?in|injectie|returned/i),
          imports = tariffColumns(result.headers, /netafname|afname|import|delivered|from.?grid|bezogen/i, /teruglever|export|returned/i),
          exported = exports[0] ?? -1, imported = imports[0] ?? -1;
        const separate = guess(/^(time|tijd|uhrzeit)(\s|$)/i);
        // Zonder herkenbare opwekkolom de eerste kolom die nergens anders voor dient; een P1-export heeft er geen.
        const spare = result.headers.findIndex((_, i) => ![time, separate, consumption, ...exports, ...imports].includes(i));
        state.noProduction = production < 0;
        Object.assign(options,
          { time_column: Math.max(0, time),
            production_column: production >= 0 ? production : Math.max(0, spare),
            time_part_column: separate >= 0 && separate !== time ? separate : null });
        // P1-exports noemen afname en teruglevering apart; dan is de verbruikskolom geen bruto verbruik.
        if (exported >= 0 && exported !== production) Object.assign(options,
          { consumption_source: "net_meter", export_column: exported, export_extra_columns: exports.slice(1),
            consumption_column: consumption >= 0 ? consumption : imported >= 0 ? imported : null,
            consumption_extra_columns: consumption < 0 ? imports.slice(1) : [] });
        else Object.assign(options,
          { consumption_source: "gross", export_column: null, export_extra_columns: [], consumption_extra_columns: [],
            consumption_column: consumption >= 0 ? consumption : null });
        const unit = (result.headers[options.production_column] || "").match(/(?:^|[^a-z])(kwh|wh|kw|w)(?:[^a-z]|$)/i);
        if (["kwh", "wh", "kw", "w"].includes(result.detected_unit)) options.unit = result.detected_unit;
          else if (unit) options.unit = unit[1].toLowerCase();
        const period = guessPeriod(result.preview, options.time_column, options.time_part_column);
        if (PERIODS[result.detected_period]) Object.assign(options,
          { period: result.detected_period, mode: "interval" });
        else if (period) options.period = period;
        const values = [options.production_column, options.consumption_column, ...options.consumption_extra_columns,
          options.export_column, ...options.export_extra_columns];
        options.decimal = guessDecimal(result.preview, values, options.decimal);
        state.cumulative = !result.detected_unit && looksCumulative(result.preview, values, options.decimal);
        if (state.cumulative) options.mode = "cumulative";
      }
      function stepColumns(body) {
        const r = state.inspected, opts = (pairs, key) => bind(select(pairs, options[key]), key);
        const source = bind(select([["gross", "Totaal verbruik van het huis (bruto)"],
          ["net_meter", "Netafname uit de slimme meter (P1)"]],
          options.consumption_source),
          "consumption_source");
        // Alleen bij P1-data: de terugleverkolom en per meetwaarde een kolom voor tarief 2 die erbij optelt.
        const p1Fields = [
          field("Teruglevering naar het net (P1)", column("export_column", true)),
          field("Netafname, tarief 2", extraColumn("consumption_extra_columns"), "Telt op bij de netafname, als je meter normaal en dal apart telt."),
          field("Teruglevering, tarief 2", extraColumn("export_extra_columns"), "Telt op bij de teruglevering.")];
        const showP1 = () => p1Fields.forEach(f => { f.hidden = options.consumption_source !== "net_meter"; });
        showP1();
        source.addEventListener("change", () => {
          if (source.value !== "net_meter") Object.assign(options,
            { export_column: null, consumption_extra_columns: [], export_extra_columns: [] });
          showP1();
        });
        const noProduction = state.noProduction ? h("p", { class: "callout", role: "note" },
          "We vinden geen kolom met zonne-opwek. Alleen netafname en teruglevering van de slimme meter is niet genoeg: " +
          "zonder opwek is niet te zien hoeveel zonnestroom je direct zelf gebruikt. Importeer eerst de export van je " +
          "omvormer en voeg dit bestand in de volgende stap toe als meterbestand. Geen omvormerdata? Gebruik dan in de " +
          "keuzehulp je jaartotalen.") : null;
        // Kies je zelf een opwekkolom, dan is de melding dat er geen is niet meer van toepassing.
        const production = column("production_column");
        production.addEventListener("change", () => { state.noProduction = false; noProduction?.remove(); });
        UI.append(body, [h("h2", {}, "Kolommen en eenheden"),
          h("p", { class: "lead", role: "status" }, `${n(r.row_count, 0)} rijen ingelezen. Controleer kolommen, eenheid, ` +
            "periode en tijdzone."), noProduction,
          state.cumulative ? h("p", { class: "callout", role: "note" }, CUMULATIVE_NOTE) : null,
          // Drie groepen in de volgorde waarin je het bestand naloopt: welke kolom wat is, hoe de tijd erin staat,
          // en hoe de getallen te lezen zijn.
          h("fieldset", {}, h("legend", {}, "Welke kolom is wat"), h("div", { class: "grid" },
            field("Datum of tijdstip", column("time_column")),
            field("Aparte tijdkolom", column("time_part_column", true)),
            field("Zonne-opwek", production),
            field("Verbruik of netafname", column("consumption_column", true)),
            field("Wat staat in die kolom?", source), ...p1Fields)),
          h("fieldset", {}, h("legend", {}, "Tijd"), h("div", { class: "grid" },
            field("Meetperiode", opts(Object.entries(PERIODS), "period")),
            field("Tijdstempel markeert",
              opts([["start", "Begin van de periode"], ["end", "Einde van de periode"]], "timestamp_position")),
            field("Datumnotatie",
              opts([["day_first", "Dag / maand / jaar"], ["month_first", "Maand / dag / jaar (VS)"]], "date_order")),
            ...zoneFields(options, "file", "Voor tijdstippen zonder UTC-offset; een offset in het bestand blijft leidend."))),
          h("fieldset", {}, h("legend", {}, "Getallen"), h("div", { class: "grid" },
            field("Eenheid",
              opts([["kwh", "kWh (energie)"], ["wh", "Wh (energie)"], ["kw", "kW (gemiddeld vermogen)"],
                ["w", "W (gemiddeld vermogen)"]],
                "unit")),
            field("Soort waarden",
              opts([["interval", "Per meetperiode"], ["cumulative", "Cumulatieve meterstanden"]], "mode")),
            field("Decimaalteken", opts([["dot", "Punt (1.25)"], ["comma", "Komma (1,25)"]], "decimal")),
            field("Herkomst", opts([["measured", "Gemeten"], ["modelled", "Gemodelleerd"]], "data_kind")),
            field("Ontbrekende waarden", opts([["reject", "Stop en meld de fout"], ["skip", "Sla de rij over en vermeld dit"]], "missing_rows")))),
          previewTable(r.headers, r.preview)]);
      }
      // Stap 3: een apart bestand van de slimme meter naast de opwek van de omvormer.
      function stepMeter(body) {
        body.append(h("h2", {}, "Meterbestand (optioneel)"),
          h("p", { class: "lead" }, "Bevat je omvormerbestand alleen opwek? Voeg dan een export van je slimme meter (P1) toe " +
            "met netafname en teruglevering. Het totale verbruik wordt opwek + afname − teruglevering, per gezamenlijke meetperiode."),
          UI.choice("Wil je een meterbestand toevoegen?", "meter-use", [
            ["no", "Nee", "Het omvormerbestand bevat al verbruik, of je importeert alleen opwek."],
            ["yes", "Ja, ik heb een P1- of meterexport",
              "Bijvoorbeeld van je energieleverancier, HomeWizard of een P1-logger."]
          ], meter.use ? "yes" : "no", value => { meter.use = value === "yes"; state.previewed = null; flow.rerender(); }));
        if (!meter.use) return;
        if (options.consumption_column != null) {
          body.append(h("p", { class: "callout" }, "Met een meterbestand volgt het verbruik uit de meter. De verbruikskolom " +
            "van het omvormerbestand wordt daarom niet gebruikt."));
          Object.assign(options, { consumption_column: null, consumption_source: "gross", export_column: null });
        }
        const fileInput = h("input", { type: "file", accept: ".csv,.tsv,.txt,.xlsx,.xls,.ods,.json", required: !meter.file,
          onchange: event => { meter.file = event.target.files[0] || null; meter.inspected = null; state.previewed = null; } });
        const read = button("Lees meterbestand", () => UI.busy(read, async () => {
          if (!meter.file) throw new Error("Kies eerst een meterbestand.");
          const body = new FormData(), m = meter.options;
          body.append("file", meter.file, meter.file.name);
          body.append("options", JSON.stringify({ header_row: m.header_row, delimiter: m.delimiter, sheet: m.sheet }));
          const result = await UI.api("/api/v1/solar/inspect", { method: "POST", body });
          const guess = (pattern, not = /$^/) => result.headers.findIndex(name => pattern.test(name) && !not.test(name));
          // ‘Levering’ is afname vanuit de leverancier gezien; ‘Teruglevering’ bevat hetzelfde woord.
          // Telt de meter per tarief, dan tellen beide kolommen op.
          const imported = tariffColumns(result.headers, /netafname|afname|import|delivered|from.?grid|bezogen|levering/i,
            /teruglever|export|returned/i);
          const exported = tariffColumns(result.headers, /teruglever|export|feed.?in|injectie|returned/i);
          Object.assign(m, {
            time_column: Math.max(0, guess(/timestamp|datum|date|tijd|time/i)),
            import_column: imported[0] ?? 1, import_extra_columns: imported.slice(1),
            export_column: exported[0] ?? 2, export_extra_columns: exported.slice(1)
          });
          const values = [m.import_column, ...m.import_extra_columns, m.export_column, ...m.export_extra_columns];
          m.decimal = guessDecimal(result.preview, values, m.decimal);
          m.period = guessPeriod(result.preview, m.time_column, m.time_part_column) ?? m.period;
          meter.cumulative = looksCumulative(result.preview, values, m.decimal);
          if (meter.cumulative) m.mode = "cumulative";
          meter.inspected = result; flow.rerender();
        }), "secondary");
        body.append(field("Meterbestand", fileInput, meter.file ? `Gekozen: ${meter.file.name}` : "CSV, Excel of JSON; maximaal 10 MB."),
          h("div", { class: "grid" },
            field("Regels vóór de kopregel",
              bindMeter(numberInput({ min: "0", max: "1000", step: "1", value: String(meter.options.header_row) }),
                "header_row", v => UI.parse(v) ?? 0)),
            field("CSV-scheiding", bindMeter(select([["auto", "Automatisch"], ["semicolon", "Puntkomma ;"], ["comma", "Komma ,"], ["tab", "Tab"]], meter.options.delimiter), "delimiter"))),
          h("p", { class: "actions" }, read));
        if (!meter.inspected) return;
        const opts = (pairs, key) => bindMeter(select(pairs, meter.options[key]), key);
        body.append(meter.cumulative ? h("p", { class: "callout", role: "note" }, CUMULATIVE_NOTE) : "", h("div", { class: "grid" },
          field("Datum of tijdstip", meterColumn("time_column")),
            field("Aparte tijdkolom", meterColumn("time_part_column", true)),
          field("Netafname", meterColumn("import_column")),
            field("Netafname, tarief 2", meterExtra("import_extra_columns"), "Telt op bij de netafname."),
          field("Teruglevering", meterColumn("export_column")),
            field("Teruglevering, tarief 2", meterExtra("export_extra_columns"), "Telt op bij de teruglevering."),
          field("Eenheid",
            opts([["kwh", "kWh (energie)"], ["wh", "Wh (energie)"], ["kw", "kW (gemiddeld vermogen)"],
              ["w", "W (gemiddeld vermogen)"]],
              "unit")),
          field("Soort waarden",
            opts([["interval", "Per meetperiode"], ["cumulative", "Cumulatieve meterstanden"]], "mode")),
          field("Meetperiode", opts(Object.entries(PERIODS).filter(([key]) => /min|hour/.test(key)), "period")),
          field("Tijdstempel markeert",
            opts([["start", "Begin van de periode"], ["end", "Einde van de periode"]], "timestamp_position")),
          field("Decimaalteken", opts([["dot", "Punt (1.25)"], ["comma", "Komma (1,25)"]], "decimal")),
          ...zoneFields(meter.options, "meter", "Voor tijdstippen zonder UTC-offset."),
          field("Datumnotatie",
            opts([["day_first", "Dag / maand / jaar"], ["month_first", "Maand / dag / jaar (VS)"]], "date_order")),
          field("Ontbrekende waarden", opts([["reject", "Stop en meld de fout"], ["skip", "Sla de rij over en vermeld dit"]], "missing_rows"))),
          h("p", { class: "help" }, "Telt je meter per tarief (normaal en dal, T1 en T2)? Kies dan bij ‘tarief 2’ de tweede kolom; " +
            "die wordt per meetperiode opgeteld. Cumulatieve P1-meterstanden kunnen direct; de eerste stand is dan alleen het beginpunt."),
          previewTable(meter.inspected.headers, meter.inspected.preview));
      }
      // Al na de kolommen een controle van het omvormerbestand, zodat een fout in tijd of getallen bij de
      // stap komt waar je hem oplost; na de meterstap opnieuw met het meterbestand, als er iets veranderde.
      async function preview(withMeter = true) {
        const combined = withMeter && meter.use;
        if (combined && !meter.inspected) throw new Error("Kies en lees eerst het meterbestand, of kies ‘Nee’.");
        const sent = signature();
        if (state.previewed === sent) return;
        let summary;
        try { summary = await UI.api("/api/v1/solar/preview", { method: "POST", body: multipart(combined) }); }
        catch (error) {
          const which = { clock_change: "file", meter_clock_change: "meter" }[error.code];
          if (!which) throw error;
          state.clock = { which, message: error.message }; flow.rerender();
          // De melding staat bij het tijdzoneveld, met de knoppen om het op te lossen; een foutmelding onderin
          // zou die op een telefoon bedekken.
          // Een eerdere melding onderin zou de knoppen bedekken.
          document.getElementById("toasts")?.replaceChildren();
          const callout = flow.element.querySelector(".wizard-body .callout[role=alert]");
          callout?.scrollIntoView({ block: "center" });
          callout?.querySelector("h3")?.focus({ preventScroll: true });
          throw Object.assign(new Error("Een tijdstip in het bestand past niet bij de tijdzone; zie de melding bij Tijdzone."),
            { shown: true });
        }
        if (sent !== signature()) throw new Error("De instellingen zijn veranderd. Controleer opnieuw.");
        state.clock = null;
        // Zonder meter is dit al de volledige controle; anders volgt die na de meterstap.
        if (combined === meter.use) { state.summary = summary; state.previewed = sent; }
      }
      // Totalen ver boven een huishouden zijn een leesfout; zo’n profiel wordt niet bewaard.
      async function plausible() {
        if (!Data.implausible(state.summary)) return;
        flow.element.querySelector(".wizard-body .callout")?.scrollIntoView({ block: "center" });
        throw new Error("Pas eerst bij Kolommen of Meter de soort waarden of de eenheid aan.");
      }
      function stepCheck(body) {
        const problem = Data.unusableText(state.summary);
        UI.append(body, [h("h2", {}, "Controle"),
          problem ? h("div", { class: Data.implausible(state.summary) ? "callout problem" : "callout", role: "note" },
            h("p", {}, problem)) : null,
          summaryView(state.summary, options.timezone)]);
      }
      function stepSave(body) {
        const name = input({ value: state.name || defaultName(), required: true, maxlength: "240",
          oninput: event => { state.name = event.target.value; } });
        const save = button("Bewaar energieprofiel", () => UI.busy(save, async () => {
          if (!UI.validate(body)) return;
          if (state.previewed !== signature()) throw new Error("De instellingen zijn veranderd; controleer het overzicht opnieuw.");
          const form = multipart(), own = state.name.trim();
          if (own && own !== defaultName()) form.append("name", own);
          const result = await UI.api("/api/v1/solar/imports", { method: "POST", body: form });
          toast(result.existing
            ? `Dit bestand met deze instellingen stond al bewaard als ‘${result.filename}’; dat profiel wordt geopend.`
            : "Energieprofiel bewaard.");
          location.hash = `#/energie/${result.id}`;
        }));
        body.append(h("h2", {}, "Bewaren"),
          h("p", {}, "Het originele bestand wordt niet bewaard; de gecontroleerde meetperioden en instellingen wel."),
          field("Naam van het profiel", name), save);
      }
      const flow = UI.wizard([
        { label: "Bestand", render: stepFile }, { label: "Kolommen", render: stepColumns },
        { label: "Meter", render: stepMeter }, { label: "Controle", render: stepCheck },
          { label: "Bewaren", render: stepSave }
      ], {
        async validate(index, body) {
          if (!UI.validate(body)) return false;
          // De volgende stap opent pas na een geslaagde controle door de server.
          const work = { 0: inspect, 1: () => preview(false), 2: preview, 3: plausible }[index];
          if (!work) return true;
          await work();
          return true;
        }
      });
      view.append(flow.element); flow.show(0);
    }
  });
})();
