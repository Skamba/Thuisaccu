"use strict";

// Energieprofielen: overzicht, detail en de importwizard voor omvormer- en meterbestanden.
// Bestanden worden alleen door de eigen lokale server verwerkt.
(() => {
  const { h, button, link, external, badge, table, stats, chart, field, input, numberInput, select, kwh, number: n, toast } = UI;
  const PERIODS = { "5min": "5 min", "10min": "10 min", "15min": "15 min", "30min": "30 min", hour: "1 uur", day: "Dag", week: "Week", month: "Maand", year: "Jaar" };
  const fitBadge = item => { const fit = Data.suitability(item); return badge(fit.reason, fit.ok === true ? "success" : fit.ok === false ? "warning" : ""); };
  const title = item => h("span", {}, item.filename, Data.isDemo(item) ? [" ", badge("FICTIEF", "demo")] : null);
  const when = (seconds, timeZone = "UTC") => new Date(seconds * 1000).toLocaleString("nl-NL", { timeZone, timeZoneName: "short" });

  function summaryView(summary, timeZone = "UTC") {
    const hasUse = summary.consumption_kwh != null;
    return h("div", {},
      stats([["Zonne-opwek", kwh(summary.production_kwh)], ["Verbruik", hasUse ? kwh(summary.consumption_kwh) : "Niet in bestand"], ["Meetperioden", n(summary.rows, 0)], ["Dekking", `${n(summary.coverage_hours, 0)} uur`], ["Ontbrekende perioden", n(summary.gaps, 0)]]),
      h("p", { class: "help" }, `${when(summary.from_unix_s, timeZone)} t/m ${when(summary.to_unix_s, timeZone)} · tijdzone ${timeZone}`),
      summary.interval_surplus_kwh != null ? h("p", {}, `Opwek boven verbruik per meetperiode: ${kwh(summary.interval_surplus_kwh)}. Verbruik boven opwek: ${kwh(summary.interval_deficit_kwh)}. Dit zijn optellingen per meetperiode, geen accubesparing.`) : null,
      chart("bar", { title: "Maandtotalen", unit: "kWh", series: [{ label: "Zonne-opwek" }, ...(hasUse ? [{ label: "Verbruik" }] : [])], rows: summary.months.map(m => ({ label: m.label, values: [m.production_kwh, ...(hasUse ? [m.consumption_kwh] : [])] })) }),
      summary.warnings.length ? h("ul", { class: "warnings" }, summary.warnings.map(w => h("li", {}, w))) : null);
  }

  UI.page("energie", {
    nav: "Energiegegevens", icon: "sun", title: "Energiegegevens", subtitle: "Bewaarde profielen met opwek en verbruik, op deze computer.",
    async render(view, actions) {
      actions.append(link("+ Importeer een bestand", "#/energie/import", "button"));
      const items = await Data.imports();
      if (!items.length) {
        view.append(UI.empty("Nog geen energieprofielen", "Importeer een export van je omvormer of slimme meter, of laat de keuzehulp een geschat profiel maken uit je jaartotalen.",
          link("Importeer een bestand", "#/energie/import", "button"), link("Naar de keuzehulp", "#/keuzehulp", "button secondary")));
        return;
      }
      view.append(table(["Profiel", "Periode", "Resolutie", "Opwek", "Verbruik", "Bruikbaar voor een berekening"], items.map(item => [
        link(title(item), `#/energie/${item.id}`), `${UI.dateOnly(item.summary.from_unix_s)} – ${UI.dateOnly(item.summary.to_unix_s)}`,
        PERIODS[item.options.combined_period || item.options.period] || (Data.isDemo(item) ? "1 uur" : "Onbekend"), kwh(item.summary.production_kwh),
        item.summary.consumption_kwh == null ? "Nee" : kwh(item.summary.consumption_kwh), fitBadge(item)]), { caption: "Bewaarde energieprofielen" }));
    }
  });

  UI.page("energie/:id", {
    title: "Energieprofiel", subtitle: "Opwek, verbruik en datakwaliteit.", parent: "energie",
    async render(view, actions, { id }) {
      const item = (await Data.imports()).find(i => String(i.id) === id);
      if (!item) { view.append(UI.empty("Profiel niet gevonden", "Kies een bewaard energieprofiel.", link("Terug naar energiegegevens", "#/energie", "button"))); return; }
      UI.$("page-title").textContent = item.filename;
      const fit = Data.suitability(item);
      if (fit.ok === true) {
        actions.append(
          button("Gebruik in de keuzehulp", () => { UI.store.set("thuisaccu-keuzehulp", { ...UI.store.get("thuisaccu-keuzehulp", {}), data: "file", importId: String(item.id) }); location.hash = "#/keuzehulp"; }),
          button("Zelf doorrekenen", () => { UI.store.set("thuisaccu-scenario", { profile: String(item.id) }); location.hash = "#/zelf"; }, "secondary"));
      }
      view.append(h("p", {}, title(item), " ", fitBadge(item)), summaryView(item.summary, item.options.timezone || "UTC"));
      if (fit.ok === true) {
        const curve = await UI.api(`/api/v1/solar/imports/${item.id}/capacity`).catch(() => null);
        if (curve) view.append(chart("line", { title: "Zonnestroom die je via een accu zelf kunt gebruiken, per accugrootte", unit: "kWh/jaar", rows: curve.points.map(p => ({ label: `${n(p.usable_capacity_kwh, 0)} kWh`, values: [p.battery_to_load_kwh] })), series: [{ label: "Uit de accu zelf gebruikt" }] }), h("p", { class: "help" }, curve.assumptions));
      }
    }
  });

  // Exporthulp per platform; kolommen, eenheid en periode blijven altijd zelf te controleren.
  const PROFILES = {
    generic: ["Algemeen: eigen kolommen", "Kies de tijd-, opwek- en eventuele verbruikskolommen van je eigen export. Controleer eenheid en meetperiode.", null],
    solaredge: ["SolarEdge Monitoring", "Gebruik installatieproductie uit Monitoring (CSV/Excel) of een bewaarde Site Energy JSON-export. Kies bij JSON date/value; eenheid en periode komen uit de metadata. Ontbrekende waarden zijn geen nul.", "https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf"],
    enphase: ["Enphase Enlighten", "Exporteer in Reports de Site Energy Production, eventueel met Site Energy Consumption. Gebruik het installatietotaal. Recent Power bevat vermogen, geen periode-energie.", "https://enphase.com/sites/default/files/2025-08/Enphase-solar-troubleshooting-guide-ING-00061-2.0-EN-INT-2025-08-14.pdf"],
    sma: ["SMA Sunny Portal", "Configuration → Data Export voor de energiebalans; kies productie, niet netexport. Analysis Pro kan 5-minutengemiddelden exporteren; kies dan gemiddeld W/kW en 5 minuten.", "https://www.sma.de/en/products/energy-management/sunny-portal"],
    fronius: ["Fronius Solar.web", "Exporteer een productie- of energiebalansrapport als CSV/Excel. Kies de totale PV-productie. Selecteer bij aparte datum en tijd beide kolommen.", "https://www.fronius.com/~/downloads/Solar%20Energy/Whitepaper/SE_WP_Fronius_RGM_Guide_GEN24_Customer_EN.pdf"],
    pvgis: ["PVGIS uurdata (CSV / 5.x JSON)", "Kies time en P. P is vermogen in W: uurperiode, UTC en gemodelleerde opwek.", "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en"]
  };

  UI.page("energie/import", {
    title: "Bestand importeren", subtitle: "Van export naar gecontroleerd energieprofiel in vijf stappen.", parent: "energie",
    render(view) {
      // Opties volgen ImportOptions in crates/server/src/solar_import.rs.
      const options = { profile: "generic", sheet: null, header_row: 0, delimiter: "auto", decimal: "dot", time_column: 0, time_part_column: null, production_column: 1, consumption_column: null, consumption_source: "gross", export_column: null, unit: "kwh", mode: "interval", period: "hour", timezone: "Europe/Amsterdam", timestamp_position: "start", data_kind: "measured", date_order: "day_first", missing_rows: "reject" };
      const state = { file: null, name: "", inspected: null, sheets: [], summary: null, previewed: null };
      // Optioneel meterbestand; opties volgen MeterOptions in solar_import.rs.
      const meter = {
        use: false, file: null, inspected: null,
        options: {
          sheet: null, header_row: 0, delimiter: "auto", decimal: "dot", time_column: 0, time_part_column: null,
          import_column: 1, export_column: 2, unit: "kwh", mode: "interval", period: "15min",
          timezone: "Europe/Amsterdam", timestamp_position: "start", date_order: "day_first", missing_rows: "reject"
        }
      };
      const fileKey = file => [file?.name, file?.size, file?.lastModified];
      const signature = () => JSON.stringify([fileKey(state.file), options, meter.use && [fileKey(meter.file), meter.options]]);
      const multipart = () => {
        const body = new FormData();
        body.append("file", state.file, state.name.trim() || state.file.name);
        body.append("options", JSON.stringify(options));
        if (meter.use) {
          body.append("meter_file", meter.file, meter.file.name);
          body.append("meter_options", JSON.stringify(meter.options));
        }
        return body;
      };
      const bindTo = target => (control, key, cast = v => v) => {
        control.addEventListener("change", () => { target[key] = cast(control.value); state.previewed = null; });
        return control;
      };
      const bind = bindTo(options), bindMeter = bindTo(meter.options);
      const headerOptions = (headers, optional) => [
        ...(optional ? [["", "Niet beschikbaar"]] : []),
        ...headers.map((name, i) => [String(i), `${i + 1}. ${name || "(leeg)"}`])
      ];
      const toColumn = v => v === "" ? null : Number(v);
      const column = (key, optional) => bind(select(headerOptions(state.inspected.headers, optional), options[key] ?? ""), key, toColumn);
      const meterColumn = (key, optional) =>
        bindMeter(select(headerOptions(meter.inspected.headers, optional), meter.options[key] ?? ""), key, toColumn);

      function stepFile(body) {
        const profile = PROFILES[options.profile];
        const fileInput = h("input", { type: "file", accept: ".csv,.tsv,.txt,.xlsx,.xls,.ods,.json", required: !state.file,
          onchange: event => { state.file = event.target.files[0] || null; state.name = state.file?.name || ""; state.inspected = null; state.previewed = null; } });
        const drop = h("label", { class: "drop" }, h("strong", {}, state.file ? `Gekozen: ${state.file.name}` : "Kies of sleep een bestand hierheen"), h("small", {}, "CSV, Excel of JSON; maximaal 10 MB en 250.000 rijen."), fileInput);
        drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("over"));
        drop.addEventListener("drop", event => { event.preventDefault(); drop.classList.remove("over"); const file = event.dataTransfer.files[0]; if (file) { state.file = file; state.name = file.name; state.inspected = null; flow.rerender(); } });
        const platform = select(Object.entries(PROFILES).map(([key, [label]]) => [key, label]), options.profile, { onchange: event => {
          options.profile = event.target.value; state.inspected = null;
          if (options.profile === "pvgis") Object.assign(options, { unit: "w", period: "hour", mode: "interval", timezone: "UTC", data_kind: "modelled" });
          flow.rerender();
        } });
        body.append(h("h2", {}, "Bestand"), h("div", { class: "split" },
          h("div", {}, field("Exportprofiel", platform), drop,
            h("div", { class: "grid" }, field("Regels vóór de kopregel", bind(numberInput({ min: "0", max: "1000", step: "1", value: String(options.header_row) }), "header_row", Number)),
              field("CSV-scheiding", bind(select([["auto", "Automatisch"], ["semicolon", "Puntkomma ;"], ["comma", "Komma ,"], ["tab", "Tab"]], options.delimiter), "delimiter")),
              state.sheets.length ? field("Werkblad", bind(select(state.sheets.map(s => [s, s]), options.sheet ?? state.sheets[0]), "sheet")) : null)),
          h("aside", { class: "panel" }, h("h3", {}, "Hulp bij je export"), h("p", {}, profile[1]), profile[2] ? external("Exportuitleg van de aanbieder ↗", profile[2]) : null,
            h("p", { class: "help" }, "Slimme meter (P1): kies in de volgende stap ‘Netafname uit de slimme meter’ en daarnaast de terugleverkolom. Het totale verbruik wordt dan opwek + afname − teruglevering."))));
      }
      async function inspect() {
        if (!state.file) throw new Error("Kies eerst een bestand.");
        const sent = signature(), result = await UI.api("/api/v1/solar/inspect", { method: "POST", body: multipart() });
        if (sent !== signature()) throw new Error("De instellingen zijn veranderd. Lees het bestand opnieuw.");
        state.inspected = result; state.sheets = result.sheets;
        const guess = pattern => result.headers.findIndex(name => pattern.test(name));
        const time = guess(/timestamp|datum|date|tijd|time/i), production = guess(/production|produced|opwek|generation|erzeugung|ertrag|^P$|^value$|^energy|yield/i);
        const consumption = guess(/consumption|consumed|verbruik|verbrauch/i), exported = guess(/teruglever|export|feed.?in|injectie|returned/i), imported = guess(/netafname|afname|import|delivered|from.?grid|bezogen/i);
        const separate = guess(/^(time|tijd|uhrzeit)(\s|$)/i);
        Object.assign(options, { time_column: Math.max(0, time), production_column: production >= 0 ? production : Math.min(1, result.headers.length - 1), time_part_column: separate >= 0 && separate !== time ? separate : null });
        // P1-exports noemen afname en teruglevering apart; dan is de verbruikskolom geen bruto verbruik.
        if (exported >= 0 && exported !== production) Object.assign(options, { consumption_source: "net_meter", export_column: exported, consumption_column: consumption >= 0 ? consumption : imported >= 0 ? imported : null });
        else Object.assign(options, { consumption_source: "gross", export_column: null, consumption_column: consumption >= 0 ? consumption : null });
        const unit = (result.headers[options.production_column] || "").match(/(?:^|[^a-z])(kwh|wh|kw|w)(?:[^a-z]|$)/i);
        if (["kwh", "wh", "kw", "w"].includes(result.detected_unit)) options.unit = result.detected_unit; else if (unit) options.unit = unit[1].toLowerCase();
        if (PERIODS[result.detected_period]) Object.assign(options, { period: result.detected_period, mode: "interval" });
        toast(`${n(result.row_count, 0)} rijen ingelezen. Controleer kolommen, eenheid, periode en tijdzone.`);
      }
      function stepColumns(body) {
        const r = state.inspected, opts = (pairs, key) => bind(select(pairs, options[key]), key);
        const source = bind(select([["gross", "Totaal verbruik van het huis (bruto)"], ["net_meter", "Netafname uit de slimme meter (P1)"]], options.consumption_source), "consumption_source");
        const exportField = field("Teruglevering naar het net (P1)", column("export_column", true));
        exportField.hidden = options.consumption_source !== "net_meter";
        source.addEventListener("change", () => { exportField.hidden = source.value !== "net_meter"; if (source.value !== "net_meter") options.export_column = null; });
        body.append(h("h2", {}, "Kolommen en eenheden"), h("div", { class: "grid" },
          field("Datum of tijdstip", column("time_column")), field("Aparte tijdkolom", column("time_part_column", true)), field("Zonne-opwek", column("production_column")),
          field("Verbruik of netafname", column("consumption_column", true)), field("Wat staat in die kolom?", source), exportField,
          field("Eenheid", opts([["kwh", "kWh (energie)"], ["wh", "Wh (energie)"], ["kw", "kW (gemiddeld vermogen)"], ["w", "W (gemiddeld vermogen)"]], "unit")),
          field("Soort waarden", opts([["interval", "Per meetperiode"], ["cumulative", "Cumulatieve meterstanden"]], "mode")),
          field("Meetperiode", opts(Object.entries(PERIODS), "period")),
          field("Tijdstempel markeert", opts([["start", "Begin van de periode"], ["end", "Einde van de periode"]], "timestamp_position")),
          field("Decimaalteken", opts([["dot", "Punt (1.25)"], ["comma", "Komma (1,25)"]], "decimal")),
          field("Tijdzone", bind(input({ value: options.timezone, required: true, placeholder: "Europe/Amsterdam" }), "timezone", v => v.trim()), "ISO-tijdstippen met een offset blijven leidend."),
          field("Herkomst", opts([["measured", "Gemeten"], ["modelled", "Gemodelleerd"]], "data_kind")),
          field("Datumnotatie", opts([["day_first", "Dag / maand / jaar"], ["month_first", "Maand / dag / jaar (VS)"]], "date_order")),
          field("Ontbrekende waarden", opts([["reject", "Stop en meld de fout"], ["skip", "Sla de rij over en vermeld dit"]], "missing_rows"))),
          h("h3", {}, "Eerste rijen"), table(r.headers, r.preview));
      }
      // Stap 3: een apart bestand van de slimme meter naast de opwek van de omvormer.
      function stepMeter(body) {
        body.append(h("h2", {}, "Meterbestand (optioneel)"),
          h("p", { class: "lead" }, "Bevat je omvormerbestand alleen opwek? Voeg dan een export van je slimme meter (P1) toe " +
            "met netafname en teruglevering. Het totale verbruik wordt opwek + afname − teruglevering, per gezamenlijke meetperiode."),
          UI.choice("Wil je een meterbestand toevoegen?", "meter-use", [
            ["no", "Nee", "Het omvormerbestand bevat al verbruik, of je importeert alleen opwek."],
            ["yes", "Ja, ik heb een P1- of meterexport", "Bijvoorbeeld van je energieleverancier, HomeWizard of een P1-logger."]
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
          const guess = pattern => result.headers.findIndex(name => pattern.test(name));
          const imported = guess(/netafname|afname|import|delivered|from.?grid|bezogen|levering/i);
          const exported = guess(/teruglever|export|feed.?in|injectie|returned/i);
          Object.assign(m, {
            time_column: Math.max(0, guess(/timestamp|datum|date|tijd|time/i)),
            import_column: imported >= 0 ? imported : 1, export_column: exported >= 0 ? exported : 2
          });
          meter.inspected = result; flow.rerender();
        }), "secondary");
        body.append(field("Meterbestand", fileInput, meter.file ? `Gekozen: ${meter.file.name}` : "CSV, Excel of JSON; maximaal 10 MB."),
          h("div", { class: "grid" },
            field("Regels vóór de kopregel", bindMeter(numberInput({ min: "0", max: "1000", step: "1", value: String(meter.options.header_row) }), "header_row", Number)),
            field("CSV-scheiding", bindMeter(select([["auto", "Automatisch"], ["semicolon", "Puntkomma ;"], ["comma", "Komma ,"], ["tab", "Tab"]], meter.options.delimiter), "delimiter"))),
          h("p", { class: "actions" }, read));
        if (!meter.inspected) return;
        const opts = (pairs, key) => bindMeter(select(pairs, meter.options[key]), key);
        body.append(h("div", { class: "grid" },
          field("Datum of tijdstip", meterColumn("time_column")), field("Aparte tijdkolom", meterColumn("time_part_column", true)),
          field("Netafname", meterColumn("import_column")), field("Teruglevering", meterColumn("export_column")),
          field("Eenheid", opts([["kwh", "kWh (energie)"], ["wh", "Wh (energie)"], ["kw", "kW (gemiddeld vermogen)"], ["w", "W (gemiddeld vermogen)"]], "unit")),
          field("Soort waarden", opts([["interval", "Per meetperiode"], ["cumulative", "Cumulatieve meterstanden"]], "mode")),
          field("Meetperiode", opts(Object.entries(PERIODS).filter(([key]) => /min|hour/.test(key)), "period")),
          field("Tijdstempel markeert", opts([["start", "Begin van de periode"], ["end", "Einde van de periode"]], "timestamp_position")),
          field("Decimaalteken", opts([["dot", "Punt (1.25)"], ["comma", "Komma (1,25)"]], "decimal")),
          field("Tijdzone", bindMeter(input({ value: meter.options.timezone, required: true }), "timezone", v => v.trim())),
          field("Datumnotatie", opts([["day_first", "Dag / maand / jaar"], ["month_first", "Maand / dag / jaar (VS)"]], "date_order")),
          field("Ontbrekende waarden", opts([["reject", "Stop en meld de fout"], ["skip", "Sla de rij over en vermeld dit"]], "missing_rows"))),
          h("p", { class: "help" }, "Dubbele tarieven (normaal en dal)? Tel ze vooraf op tot één kolom voor afname en één voor teruglevering. " +
            "Cumulatieve P1-meterstanden kunnen direct; de eerste stand is dan alleen het beginpunt."),
          h("h3", {}, "Eerste rijen"), table(meter.inspected.headers, meter.inspected.preview));
      }
      async function preview() {
        if (meter.use && !meter.inspected) throw new Error("Kies en lees eerst het meterbestand, of kies ‘Nee’.");
        const sent = signature(), summary = await UI.api("/api/v1/solar/preview", { method: "POST", body: multipart() });
        if (sent !== signature()) throw new Error("De instellingen zijn veranderd. Controleer opnieuw.");
        state.summary = summary; state.previewed = sent;
      }
      function stepCheck(body) { body.append(h("h2", {}, "Controle"), summaryView(state.summary, options.timezone)); }
      function stepSave(body) {
        const name = input({ value: state.name, required: true, maxlength: "240", oninput: event => { state.name = event.target.value; } });
        const save = button("Bewaar energieprofiel", () => UI.busy(save, async () => {
          if (!UI.validate(body)) return;
          if (state.previewed !== signature()) throw new Error("De instellingen zijn veranderd; controleer het overzicht opnieuw.");
          const result = await UI.api("/api/v1/solar/imports", { method: "POST", body: multipart() });
          toast("Energieprofiel bewaard. Hetzelfde bestand met dezelfde instellingen wordt niet dubbel opgeslagen.");
          location.hash = `#/energie/${result.id}`;
        }));
        body.append(h("h2", {}, "Bewaren"), h("p", {}, "Het originele bestand wordt niet bewaard; de gecontroleerde meetperioden en instellingen wel."), field("Naam van het profiel", name), save);
      }
      const flow = UI.wizard([
        { label: "Bestand", render: stepFile }, { label: "Kolommen", render: stepColumns },
        { label: "Meter", render: stepMeter }, { label: "Controle", render: stepCheck }, { label: "Bewaren", render: stepSave }
      ], {
        async validate(index, body) {
          if (!UI.validate(body)) return false;
          // De volgende stap opent pas na een geslaagde controle door de server.
          const work = { 0: inspect, 2: preview }[index];
          if (!work) return true;
          try { await work(); return true; } catch (error) { toast(error.message, true); return false; }
          return true;
        }
      });
      view.append(flow.element); flow.show(0);
    }
  });
})();
