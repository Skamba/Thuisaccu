use thuisaccu_server::solar_import::{ImportOptions, normalize, read_table};

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
