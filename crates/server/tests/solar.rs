use thuisaccu_server::solar_import::{
    ImportOptions, MeterOptions, combine_with_meter, normalize, read_table,
};

fn analyze(
    text: &str,
    options: &ImportOptions,
) -> Result<thuisaccu_storage::solar::SolarSummary, String> {
    let table = read_table("test.csv", text.as_bytes(), options)?;
    normalize(&table, options).map(|(_, summary)| summary)
}

#[test]
fn semicolon_decimal_comma_and_bom_preserve_energy_and_consumption() {
    let options = ImportOptions {
        decimal: "comma".into(),
        consumption_column: Some(2),
        period: "15min".into(),
        ..Default::default()
    };
    let summary = analyze("\u{feff}time;production;consumption\n2026-06-01T10:00:00Z;0,5;0,2\n2026-06-01T10:15:00Z;1,5;0,6\n", &options).unwrap();
    assert_eq!(summary.rows, 2);
    assert_eq!(summary.production_kwh, 2.0);
    assert_eq!(summary.consumption_kwh, Some(0.8));
    assert!((summary.interval_surplus_kwh.unwrap() - 1.2).abs() < 1e-9);
    assert_eq!(summary.coverage_hours, 0.5);
}

#[test]
fn average_power_uses_interval_duration_and_end_timestamps() {
    let options = ImportOptions {
        unit: "w".into(),
        period: "15min".into(),
        timestamp_position: "end".into(),
        ..Default::default()
    };
    let summary = analyze(
        "time,power\n2026-06-01T10:15:00Z,1000\n2026-06-01T10:30:00Z,2000\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.production_kwh, 0.75);
    assert_eq!(summary.to_unix_s - summary.from_unix_s, 1800);
    assert_eq!(summary.coverage_hours, 0.5);
}

#[test]
fn cumulative_counters_use_a_baseline_and_reject_resets() {
    let options = ImportOptions {
        mode: "cumulative".into(),
        ..Default::default()
    };
    let summary = analyze("time,counter\n2026-06-01T10:00:00Z,100\n2026-06-01T11:00:00Z,101.5\n2026-06-01T13:00:00Z,104\n", &options).unwrap();
    assert_eq!(summary.production_kwh, 4.0);
    assert_eq!(summary.rows, 2);
    assert_eq!(summary.coverage_hours, 3.0);
    assert!(
        analyze(
            "time,counter\n2026-06-01T10:00:00Z,100\n2026-06-01T11:00:00Z,1\n",
            &options
        )
        .unwrap_err()
        .contains("Meterreset")
    );
}

#[test]
fn gaps_are_visible_but_duplicates_overlaps_missing_and_negative_values_fail() {
    let options = ImportOptions::default();
    let summary = analyze(
        "time,energy\n2026-06-01T10:00:00Z,1\n2026-06-01T12:00:00Z,2\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.gaps, 1);
    assert_eq!(summary.coverage_hours, 2.0);
    for text in [
        "time,energy\n2026-06-01T10:00:00Z,1\n2026-06-01T10:00:00Z,2\n",
        "time,energy\n2026-06-01T10:00:00Z,1\n2026-06-01T10:30:00Z,2\n",
        "time,energy\n2026-06-01T10:00:00Z,-1\n",
        "time,energy\n2026-06-01T10:00:00Z,NaN\n",
        "time,energy\n2026-06-01T10:00:00Z,\n",
    ] {
        assert!(analyze(text, &options).is_err(), "Should fail: {text}");
    }
}

#[test]
fn daylight_saving_ambiguities_require_offsets_and_calendar_days_keep_actual_duration() {
    let options = ImportOptions {
        timezone: "Europe/Amsterdam".into(),
        ..Default::default()
    };
    assert!(
        analyze("time,energy\n2026-10-25 02:00,1\n", &options)
            .unwrap_err()
            .contains("dubbelzinnig")
    );
    assert!(
        analyze("time,energy\n2026-03-29 02:00,1\n", &options)
            .unwrap_err()
            .contains("bestaat niet")
    );
    let summary = analyze(
        "time,energy\n2026-10-25T02:00:00+02:00,1\n2026-10-25T02:00:00+01:00,2\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.rows, 2);
    assert_eq!(summary.production_kwh, 3.0);
    // Een export in lokale tijd noemt het dubbele uur twee keer: eerst zomertijd, dan wintertijd.
    let local = analyze(
        "time,energy\n2026-10-25 01:00,1\n2026-10-25 02:00,2\n2026-10-25 02:00,3\n2026-10-25 03:00,4\n",
        &options,
    )
    .unwrap();
    assert_eq!(local.rows, 4);
    assert_eq!(local.gaps, 0);
    assert_eq!(local.coverage_hours, 4.0);
    assert!(local.warnings.iter().any(|w| w.contains("wintertijd")));
    assert!(
        analyze(
            "time,energy\n2026-10-25 02:00,1\n2026-10-25 02:00,2\n2026-10-25 02:00,3\n",
            &options
        )
        .unwrap_err()
        .contains("vaker dan twee keer")
    );
    // Met de nieuwste meting bovenaan staat het dubbele uur eerst in wintertijd; cumulatieve
    // standen lopen dan in de tijd gezien gewoon op.
    let cumulative = ImportOptions {
        mode: "cumulative".into(),
        ..options.clone()
    };
    let newest_first = analyze(
        "time,energy
2026-10-25 03:00,10
2026-10-25 02:00,7
2026-10-25 02:00,5
2026-10-25 01:00,2
",
        &cumulative,
    )
    .unwrap();
    assert_eq!(newest_first.production_kwh, 8.0);
    assert_eq!(newest_first.gaps, 0);
    assert!(
        newest_first
            .warnings
            .iter()
            .any(|w| w.contains("terug in de tijd"))
    );
    let daily = ImportOptions {
        period: "day".into(),
        ..options
    };
    assert_eq!(
        analyze("time,energy\n2026-03-29,3\n", &daily)
            .unwrap()
            .coverage_hours,
        23.0
    );
    assert_eq!(
        analyze("time,energy\n2026-10-25,3\n", &daily)
            .unwrap()
            .coverage_hours,
        25.0
    );
}

#[test]
fn monthly_aggregates_remain_months_and_are_not_turned_into_hourly_profiles() {
    let options = ImportOptions {
        period: "month".into(),
        ..Default::default()
    };
    let summary = analyze("month,energy\n2026-01,100\n2026-02,200\n", &options).unwrap();
    assert_eq!(summary.production_kwh, 300.0);
    assert_eq!(summary.rows, 2);
    assert_eq!(summary.months[0].label, "2026-01");
    assert_eq!(summary.coverage_hours, (31.0 + 28.0) * 24.0);
    assert!(
        summary
            .warnings
            .iter()
            .any(|w| w.contains("onvoldoende voor accudimensionering"))
    );
}

#[test]
fn xlsx_numeric_cells_and_excel_datetimes_are_read_with_a_real_workbook() {
    let options = ImportOptions {
        time_column: 0,
        production_column: 1,
        consumption_column: Some(2),
        ..Default::default()
    };
    let bytes = include_bytes!("../resources/solar-example.xlsx");
    let table = read_table("solar.xlsx", bytes, &options).unwrap();
    assert_eq!(table.sheets, vec!["Solar"]);
    assert!(table.rows[0][0].starts_with("2026-06-01 10:00:"));
    let (_, summary) = normalize(&table, &options).unwrap();
    assert_eq!(summary.production_kwh, 2.0);
    assert_eq!(summary.consumption_kwh, Some(0.8));
    let comma = ImportOptions {
        decimal: "comma".into(),
        ..options
    };
    let table = read_table("solar.xlsx", bytes, &comma).unwrap();
    assert_eq!(normalize(&table, &comma).unwrap().1.production_kwh, 2.0);
}

#[test]
fn json_column_mapping_and_pvgis_hourly_envelope_are_supported() {
    let bytes = br#"{"outputs":{"hourly":[{"time":"20260601:1000","P":1000},{"time":"20260601:1100","P":2000}]}}"#;
    let mut options = ImportOptions {
        unit: "w".into(),
        data_kind: "modelled".into(),
        ..Default::default()
    };
    let table = read_table("pvgis.json", bytes, &options).unwrap();
    options.time_column = table.headers.iter().position(|h| h == "time").unwrap();
    options.production_column = table.headers.iter().position(|h| h == "P").unwrap();
    let (_, summary) = normalize(&table, &options).unwrap();
    assert_eq!(summary.production_kwh, 3.0);
    assert!(
        summary
            .warnings
            .iter()
            .any(|w| w.contains("gemodelleerde opwek"))
    );
    let incomplete = read_table("bad.json", br#"[{"a":1},{"b":2}]"#, &options).unwrap();
    assert!(normalize(&incomplete, &options).is_err());
    assert!(read_table("bad.pdf", b"not a supported format", &options).is_err());
}

#[test]
fn csv_headers_can_follow_a_preamble_and_quoted_decimal_values_are_handled() {
    let options = ImportOptions {
        header_row: 2,
        delimiter: "comma".into(),
        decimal: "comma".into(),
        ..Default::default()
    };
    let summary = analyze(
        "System export\nUnit information\ntime,energy\n2026-06-01T10:00:00Z,\"1,25\"\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.production_kwh, 1.25);
}

#[test]
fn solaredge_energy_json_uses_declared_metadata_and_handles_missing_values_explicitly() {
    let bytes = br#"{"energy":{"unit":"Wh","timeUnit":"DAY","values":[{"date":"2026-06-01 00:00:00","value":1200},{"date":"2026-06-02 00:00:00","value":null},{"date":"2026-06-03 00:00:00","value":800}]}}"#;
    let mut options = ImportOptions {
        profile: "solaredge".into(),
        unit: "wh".into(),
        period: "day".into(),
        ..Default::default()
    };
    let table = read_table("solaredge.json", bytes, &options).unwrap();
    assert_eq!(table.inspection().detected_unit.as_deref(), Some("wh"));
    assert_eq!(table.inspection().detected_period.as_deref(), Some("day"));
    assert!(normalize(&table, &options).is_err());
    options.missing_rows = "skip".into();
    let (_, summary) = normalize(&table, &options).unwrap();
    assert_eq!(summary.production_kwh, 2.0);
    assert_eq!(summary.gaps, 1);
    assert!(summary.warnings.iter().any(|w| w.contains("1 rij(en)")));
    options.unit = "kwh".into();
    assert!(
        normalize(&table, &options)
            .unwrap_err()
            .contains("metadata")
    );
}

#[test]
fn sma_five_minute_power_and_fronius_separate_date_time_columns_are_supported() {
    let options = ImportOptions {
        profile: "sma".into(),
        unit: "w".into(),
        period: "5min".into(),
        ..Default::default()
    };
    let summary = analyze(
        "Date;PV generation [W]\n2026-06-01 10:00;1200\n2026-06-01 10:05;2400\n",
        &options,
    )
    .unwrap();
    assert!((summary.production_kwh - 0.3).abs() < 1e-9);
    let options = ImportOptions {
        profile: "fronius".into(),
        production_column: 2,
        time_part_column: Some(1),
        unit: "wh".into(),
        ..Default::default()
    };
    let summary = analyze(
        "Date;Time;Production [Wh]\n01/06/2026;10:00;1200\n01/06/2026;11:00;800\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.production_kwh, 2.0);
    assert_eq!(summary.months[0].label, "2026-06");
}

#[test]
fn enphase_report_style_us_dates_do_not_silently_use_european_date_order() {
    let options = ImportOptions {
        profile: "enphase".into(),
        date_order: "month_first".into(),
        unit: "wh".into(),
        ..Default::default()
    };
    let summary = analyze(
        "Date/Time,Energy Produced (Wh)\n06/01/2026 10:00 AM,1000\n06/01/2026 11:00 AM,2000\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.production_kwh, 3.0);
    assert_eq!(summary.months[0].label, "2026-06");
}

#[test]
fn p1_import_and_export_derive_gross_consumption_from_the_energy_balance() {
    let options = ImportOptions {
        consumption_column: Some(2),
        consumption_source: "net_meter".into(),
        export_column: Some(3),
        ..Default::default()
    };
    // Uur 1: 2 kWh opwek, 1,5 kWh terug → 0,5 kWh zelf gebruikt. Uur 2: 1 kWh van het net.
    let summary = analyze(
        "time,production,import,export\n2026-06-01T10:00:00Z,2,0,1.5\n2026-06-01T11:00:00Z,0,1,0\n",
        &options,
    )
    .unwrap();
    assert_eq!(summary.consumption_kwh, Some(1.5));
    assert!((summary.interval_surplus_kwh.unwrap() - 1.5).abs() < 1e-9);
    assert!(summary.warnings.iter().any(|w| w.contains("afgeleid")));
    // Teruglevering groter dan opwek plus afname wijst op een tijd- of eenheidsfout.
    let error = analyze(
        "time,production,import,export\n2026-06-01T10:00:00Z,0,0,2\n2026-06-01T11:00:00Z,0,1,0\n",
        &options,
    )
    .unwrap_err();
    assert!(error.contains("teruglevering"));
    let missing_export = ImportOptions {
        export_column: None,
        ..options
    };
    assert!(analyze("time,p,i\n2026-06-01T10:00:00Z,1,1\n", &missing_export).is_err());
}

#[test]
fn p1_import_and_export_are_kept_per_interval_next_to_gross_consumption() {
    let options = ImportOptions {
        consumption_column: Some(2),
        consumption_source: "net_meter".into(),
        export_column: Some(3),
        ..Default::default()
    };
    let text = "time,production,import,export
2026-06-01T10:00:00Z,2,0.25,1.5
";
    let table = read_table("test.csv", text.as_bytes(), &options).unwrap();
    let (intervals, _) = normalize(&table, &options).unwrap();
    assert_eq!(intervals[0].consumption_wh, Some(750.0));
    assert_eq!(intervals[0].measured_import_wh, Some(250.0));
    assert_eq!(intervals[0].measured_export_wh, Some(1500.0));
    // Een bruto verbruikskolom zegt niets over netafname binnen het interval.
    let gross = ImportOptions {
        consumption_column: Some(2),
        ..Default::default()
    };
    let table = read_table("test.csv", text.as_bytes(), &gross).unwrap();
    let (intervals, _) = normalize(&table, &gross).unwrap();
    assert_eq!(intervals[0].measured_import_wh, None);
    assert_eq!(intervals[0].measured_export_wh, None);
}

/// Honderd uren met 0,5 kWh afname; één uur met de opgegeven opwek, afname en teruglevering.
fn hundred_hours_with(production: f64, import: f64, export: f64) -> String {
    let mut text = String::from("time,production,import,export\n");
    for hour in 0..100 {
        let (p, i, e) = if hour == 50 {
            (production, import, export)
        } else {
            (0.0, 0.5, 0.0)
        };
        text.push_str(&format!(
            "2026-06-{:02}T{:02}:00:00Z,{p},{i},{e}\n",
            1 + hour / 24,
            hour % 24
        ));
    }
    text
}

#[test]
fn a_large_negative_balance_fails_even_in_a_single_period_and_small_ones_keep_their_size() {
    let options = ImportOptions {
        consumption_column: Some(2),
        consumption_source: "net_meter".into(),
        export_column: Some(3),
        ..Default::default()
    };
    // Eén uur van honderd met −1000 kWh is geen meetafwijking maar een tijd- of eenheidsfout.
    let error = analyze(&hundred_hours_with(0.0, 0.0, 1000.0), &options).unwrap_err();
    assert!(error.contains("meer dan een meetafwijking"), "{error}");
    assert!(error.contains("1000,000 kWh"), "{error}");
    // 2 kWh opwek en 2,08 kWh teruglevering: −80 Wh valt binnen 100 Wh + 5% van 2 kWh.
    let summary = analyze(&hundred_hours_with(2.0, 0.0, 2.08), &options).unwrap();
    assert!((summary.clipped_consumption_kwh.unwrap() - 0.08).abs() < 1e-9);
    assert!(
        summary
            .warnings
            .iter()
            .any(|w| w.contains("licht negatief") && w.contains("0,080 kWh"))
    );
    // −250 Wh ligt boven die grens (100 + 100 Wh) en stopt de import.
    assert!(analyze(&hundred_hours_with(2.0, 0.0, 2.25), &options).is_err());
    // Zonder afleiding blijft het veld leeg.
    let gross = analyze(
        "time,production\n2026-06-01T10:00:00Z,1\n",
        &ImportOptions::default(),
    )
    .unwrap();
    assert_eq!(gross.clipped_consumption_kwh, None);
}

/// Synthetische reeksen: omvormer per 15 minuten, meter per uur.
fn combine(
    inverter: &str,
    meter: &str,
    meter_period: &str,
) -> Result<thuisaccu_storage::solar::SolarSummary, String> {
    let inverter_options = ImportOptions {
        period: "15min".into(),
        ..Default::default()
    };
    let table = read_table("omvormer.csv", inverter.as_bytes(), &inverter_options)?;
    let (production, summary) = normalize(&table, &inverter_options)?;
    let meter_options = MeterOptions {
        period: meter_period.into(),
        timezone: "UTC".into(),
        ..Default::default()
    }
    .as_import_options();
    let table = read_table("meter.csv", meter.as_bytes(), &meter_options)?;
    let (grid, _) = normalize(&table, &meter_options)?;
    combine_with_meter(&production, &summary, &grid, "UTC").map(|(_, summary)| summary)
}

#[test]
fn inverter_and_meter_files_combine_on_complete_common_hours_without_filling_gaps() {
    // Uur 10 en 12 staan volledig in beide bestanden; in uur 11 ontbreekt één kwartier opwek.
    let mut inverter = String::from("time,production\n");
    for hour in [10, 11, 12] {
        for minute in [0, 15, 30, 45] {
            if hour == 11 && minute == 30 {
                continue;
            }
            inverter.push_str(&format!("2026-06-01T{hour}:{minute:02}:00Z,0.25\n"));
        }
    }
    let meter = "time,import,export\n2026-06-01T10:00:00Z,0.5,0.75\n2026-06-01T11:00:00Z,0.5,0.25\n2026-06-01T12:00:00Z,1,0\n";
    let summary = combine(&inverter, meter, "hour").unwrap();
    assert_eq!(summary.rows, 2);
    assert_eq!(summary.gaps, 1);
    assert_eq!(summary.production_kwh, 2.0);
    // Bruto = opwek + netafname − teruglevering: (1 + 0,5 − 0,75) + (1 + 1 − 0) = 2,75 kWh.
    assert!((summary.consumption_kwh.unwrap() - 2.75).abs() < 1e-9);
    assert!(
        summary
            .warnings
            .iter()
            .any(|w| w.contains("niet volledig in beide bestanden"))
    );
    assert!(
        summary
            .warnings
            .iter()
            .any(|w| w.contains("gecombineerd per uur"))
    );
}

#[test]
fn incompatible_resolutions_and_impossible_balances_are_rejected() {
    let inverter = "time,production\n2026-06-01T10:00:00Z,0.25\n2026-06-01T10:15:00Z,0.25\n";
    let ten_minutes =
        "time,import,export\n2026-06-01T10:00:00Z,0.1,0\n2026-06-01T10:10:00Z,0.1,0\n";
    assert!(
        combine(inverter, ten_minutes, "10min")
            .unwrap_err()
            .contains("passen niet op elkaar")
    );
    let too_much_export =
        "time,import,export\n2026-06-01T10:00:00Z,0,2\n2026-06-01T10:15:00Z,0,2\n";
    assert!(
        combine(inverter, too_much_export, "15min")
            .unwrap_err()
            .contains("teruglevering groter")
    );
    let elsewhere = "time,import,export\n2026-07-01T10:00:00Z,0,0\n";
    assert!(
        combine(inverter, elsewhere, "15min")
            .unwrap_err()
            .contains("geen gemeenschappelijke")
    );
}

#[test]
fn combined_meter_files_keep_measured_import_and_export_per_period() {
    let inverter_options = ImportOptions {
        period: "15min".into(),
        ..Default::default()
    };
    let inverter = "time,production\n2026-06-01T10:00:00Z,0.25\n2026-06-01T10:15:00Z,0.25\n2026-06-01T10:30:00Z,0.25\n2026-06-01T10:45:00Z,0.25\n";
    let table = read_table("omvormer.csv", inverter.as_bytes(), &inverter_options).unwrap();
    let (production, summary) = normalize(&table, &inverter_options).unwrap();
    let meter_options = MeterOptions {
        period: "hour".into(),
        timezone: "UTC".into(),
        ..Default::default()
    }
    .as_import_options();
    let meter = "time,import,export\n2026-06-01T10:00:00Z,0.5,0.75\n";
    let table = read_table("meter.csv", meter.as_bytes(), &meter_options).unwrap();
    let (grid, _) = normalize(&table, &meter_options).unwrap();
    let (intervals, _) = combine_with_meter(&production, &summary, &grid, "UTC").unwrap();
    // 1 kWh opwek, 0,5 kWh afname, 0,75 kWh teruglevering → 0,75 kWh bruto verbruik.
    assert_eq!(intervals.len(), 1);
    assert!((intervals[0].consumption_wh.unwrap() - 750.0).abs() < 1e-9);
    assert_eq!(intervals[0].measured_import_wh, Some(500.0));
    assert_eq!(intervals[0].measured_export_wh, Some(750.0));
}
