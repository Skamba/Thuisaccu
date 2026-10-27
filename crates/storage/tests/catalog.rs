use thuisaccu_core::products::*;
use thuisaccu_storage::{Catalog, StorageError};

fn scalar<T: rusqlite::types::FromSql>(catalog: &Catalog, sql: &str) -> T {
    catalog
        .connection()
        .query_row(sql, [], |row| row.get(0))
        .unwrap()
}

fn execute(catalog: &Catalog, sql: &str, params: impl rusqlite::Params) -> rusqlite::Result<usize> {
    catalog.connection().execute(sql, params)
}

// Alle producten en waarden in deze tests zijn fictieve fixtures.
async fn setup(catalog: &Catalog) -> (i64, i64, i64) {
    let manufacturer_id = catalog
        .add_manufacturer(&Manufacturer {
            name: "Fixture Energy".into(),
            website: None,
        })
        .await
        .unwrap();
    let product_id = catalog
        .add_product(&Product {
            manufacturer_id,
            name: "Test Battery".into(),
            model_code: "TEST-1".into(),
            kind: ProductKind::BatterySystem,
        })
        .await
        .unwrap();
    let configuration_id = catalog
        .add_configuration(&Configuration {
            product_id,
            name: "Two modules".into(),
            variant_code: "2M".into(),
            hardware_revision: "A".into(),
        })
        .await
        .unwrap();
    let source_id = catalog.add_source(&source("1")).await.unwrap();
    let entry_id = catalog
        .add_entry(&entry(configuration_id, source_id))
        .await
        .unwrap();
    (product_id, configuration_id, entry_id)
}

fn source(revision: &str) -> Source {
    Source {
        kind: SourceKind::Datasheet,
        title: "Fictitious datasheet".into(),
        url: "https://example.invalid/battery.pdf".into(),
        document_revision: Some(revision.into()),
        published_on: Some("2026-10-01".into()),
        retrieved_at_unix_s: 1_790_000_000,
        sha256: None,
        archived_path: None,
    }
}

fn entry(configuration_id: i64, source_id: i64) -> ResearchEntry {
    ResearchEntry {
        configuration_id,
        source_id,
        locator: "page 2, table 1".into(),
        observed_at_unix_s: 1_790_000_000,
        market: "unspecified".into(),
        firmware_revision: None,
        review_status: ReviewStatus::Unreviewed,
        reviewed_by: None,
        reviewed_at_unix_s: None,
        conditions: "Laboratory conditions".into(),
        notes: "Fictitious test data".into(),
    }
}

fn number(entry_id: i64) -> NumericObservation {
    NumericObservation {
        entry_id,
        metric: NumericMetric::UsableEnergy,
        qualifier: NumberQualifier::Exact,
        value: 5120.0,
        upper_value: None,
        boundary: MeasurementBoundary::BatteryDc,
        reported_value: "5.12 kWh".into(),
        test_temperature_c: Some(25.0),
        test_power_w: None,
        test_soc_pct: None,
        test_depth_of_discharge_pct: Some(100.0),
        test_c_rate: Some(0.2),
        conditions: "At start of life".into(),
    }
}

#[tokio::test]
async fn file_database_survives_reopening_and_migrations_are_not_reapplied() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested/research.sqlite3");
    let catalog = Catalog::open(&path).await.unwrap();
    let (_, configuration_id, entry_id) = setup(&catalog).await;
    let observation = number(entry_id);
    let id = catalog.add_numeric_observation(&observation).await.unwrap();
    catalog.close().await;

    let reopened = Catalog::open(&path).await.unwrap();
    assert_eq!(reopened.list_products().await.unwrap().len(), 1);
    assert_eq!(
        reopened
            .list_numeric_observations(configuration_id)
            .await
            .unwrap(),
        vec![Record {
            id,
            data: observation
        }]
    );
    let applied: i64 = scalar(
        &reopened,
        "SELECT count(*) FROM _sqlx_migrations WHERE success = 1",
    );
    assert_eq!(applied, 5);
    let journal: String = scalar(&reopened, "PRAGMA journal_mode");
    assert_eq!(journal, "wal");
    reopened.close().await;
}

#[tokio::test]
async fn conflicting_sources_and_measurement_boundaries_remain_distinct() {
    let catalog = Catalog::in_memory().await.unwrap();
    let (_, configuration_id, first_entry) = setup(&catalog).await;
    let second_source = catalog.add_source(&source("2")).await.unwrap();
    let mut second_context = entry(configuration_id, second_source);
    second_context.market = "Example market".into();
    let second_entry = catalog.add_entry(&second_context).await.unwrap();
    for (entry_id, value, boundary) in [
        (first_entry, 96.0, MeasurementBoundary::DcDc),
        (second_entry, 89.0, MeasurementBoundary::AcAc),
        (second_entry, 95.0, MeasurementBoundary::DcDc),
    ] {
        let mut observation = number(entry_id);
        observation.metric = NumericMetric::RoundTripEfficiency;
        observation.value = value;
        observation.reported_value = format!("{value}%");
        observation.boundary = boundary;
        catalog.add_numeric_observation(&observation).await.unwrap();
    }
    let records = catalog
        .list_numeric_observations(configuration_id)
        .await
        .unwrap();
    assert_eq!(records.len(), 3);
    let rows: Vec<[String; 5]> = catalog
        .connection()
        .prepare("SELECT document_revision, source_url, review_status, market, unit FROM numeric_research ORDER BY id")
        .unwrap()
        .query_map([], |row| {
            Ok([row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?])
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(rows[0][0], "1");
    assert_eq!(rows[1][0], "2");
    assert_eq!(rows[0][2], "unreviewed");
    assert_eq!(rows[1][3], "Example market");
    assert_eq!(rows[0][4], "%");
    assert_eq!(rows[0][1], "https://example.invalid/battery.pdf");
}

#[tokio::test]
async fn numeric_constraints_apply_to_inserts_updates_and_raw_sql() {
    let catalog = Catalog::in_memory().await.unwrap();
    let (_, _, entry_id) = setup(&catalog).await;
    let mut observation = number(entry_id);
    observation.value = -1.0;
    assert!(catalog.add_numeric_observation(&observation).await.is_err());
    observation = number(entry_id);
    observation.metric = NumericMetric::RoundTripEfficiency;
    observation.value = 101.0;
    assert!(catalog.add_numeric_observation(&observation).await.is_err());
    observation.metric = NumericMetric::ModuleCount;
    observation.value = 2.5;
    assert!(catalog.add_numeric_observation(&observation).await.is_err());
    observation = number(entry_id);
    observation.qualifier = NumberQualifier::Range;
    observation.upper_value = Some(100.0);
    assert!(catalog.add_numeric_observation(&observation).await.is_err());
    observation = number(entry_id);
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        observation.test_power_w = Some(value);
        assert!(matches!(
            catalog.add_numeric_observation(&observation).await,
            Err(StorageError::NonFiniteNumber)
        ));
    }
    observation = number(entry_id);
    let id = catalog.add_numeric_observation(&observation).await.unwrap();
    for sql in [
        "UPDATE numeric_observations SET metric_key = 'round_trip_efficiency_pct', value = 101 WHERE id = ?",
        "UPDATE numeric_observations SET metric_key = 'unknown_unit' WHERE id = ?",
        "UPDATE numeric_observations SET value = 'not a number' WHERE id = ?",
        "UPDATE numeric_observations SET test_soc_pct = 101 WHERE id = ?",
    ] {
        let error = StorageError::from(execute(&catalog, sql, [id]).unwrap_err());
        assert!(error.is_constraint_violation(), "{sql}: {error}");
    }
    // Een temperatuurinterval en een strikte bovengrens blijven representeerbaar.
    observation.metric = NumericMetric::ChargeTemperature;
    observation.qualifier = NumberQualifier::Range;
    observation.value = -10.0;
    observation.upper_value = Some(50.0);
    observation.reported_value = "-10 to +50 degC".into();
    catalog.add_numeric_observation(&observation).await.unwrap();
    observation.metric = NumericMetric::Noise;
    observation.qualifier = NumberQualifier::LessThan;
    observation.value = 50.0;
    observation.upper_value = None;
    observation.reported_value = "<50 dB(A)".into();
    catalog.add_numeric_observation(&observation).await.unwrap();
}

#[tokio::test]
async fn catalog_covers_every_typed_metric_without_arbitrary_keys() {
    let catalog = Catalog::in_memory().await.unwrap();
    let (_, _, entry_id) = setup(&catalog).await;
    let keys: Vec<String> = catalog
        .connection()
        .prepare("SELECT key FROM numeric_metrics ORDER BY key")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let mut rust_keys: Vec<_> = NumericMetric::ALL.iter().map(|key| key.as_str()).collect();
    rust_keys.sort_unstable();
    assert_eq!(keys, rust_keys);
    for metric in FeatureMetric::ALL {
        catalog
            .add_feature_observation(&FeatureObservation {
                entry_id,
                metric: *metric,
                status: FeatureStatus::Unknown,
                conditions: String::new(),
            })
            .await
            .unwrap();
    }
    for metric in TextMetric::ALL {
        catalog
            .add_text_observation(&TextObservation {
                entry_id,
                metric: *metric,
                value: "Fixture value".into(),
                conditions: String::new(),
            })
            .await
            .unwrap();
    }
    assert!(execute(&catalog, "INSERT INTO feature_observations (entry_id, metric_key, status) VALUES (?, 'backup', 'conditional')", [entry_id]).is_err());
}

#[tokio::test]
async fn warranty_compatibility_certification_and_offer_retain_unknowns_and_exact_money() {
    let catalog = Catalog::in_memory().await.unwrap();
    let (product_id, _, entry_id) = setup(&catalog).await;
    catalog
        .add_component(&Component {
            entry_id,
            product_id,
            quantity: 2,
            role: "module".into(),
        })
        .await
        .unwrap();
    catalog
        .add_warranty(&WarrantyTerms {
            entry_id,
            product_months: Some(120),
            performance_months: Some(120),
            retained_capacity_pct: Some(60.0),
            cycle_limit: None,
            throughput_wh: Some(15_000_000),
            limit_rule: WarrantyLimitRule::FirstReached,
            application: "Self consumption".into(),
            activation_required: None,
            internet_required: Some(false),
            labour_included: None,
            transferable: Some(true),
            exclusions: "See fixture warranty".into(),
        })
        .await
        .unwrap();
    let mut compatibility = CompatibilityClaim {
        entry_id,
        counterpart_product_id: product_id,
        status: CompatibilityStatus::Conditional,
        counterpart_firmware: Some("2.0".into()),
        battery_firmware: Some("1.0".into()),
        min_modules: Some(2),
        max_modules: Some(5),
        min_parallel_units: None,
        max_parallel_units: Some(3),
        conditions: "Requires fixture gateway".into(),
    };
    catalog
        .add_compatibility_claim(&compatibility)
        .await
        .unwrap();
    compatibility.max_modules = Some(1);
    assert!(
        catalog
            .add_compatibility_claim(&compatibility)
            .await
            .is_err()
    );
    catalog
        .add_conformity_claim(&ConformityClaim {
            entry_id,
            standard: "IEC 62619".into(),
            edition: Some("2022".into()),
            status: ConformityStatus::Claimed,
            certificate_reference: None,
            conditions: "Fixture claim only".into(),
        })
        .await
        .unwrap();
    let mut offer = Offer {
        entry_id,
        seller: "Fixture installer".into(),
        currency: "EUR".into(),
        minor_unit_exponent: 2,
        upfront_amount_minor: 999_999,
        recurring_amount_minor: Some(499),
        recurring_period: Some(BillingPeriod::Month),
        tax_basis: TaxBasis::Included,
        tax_rate_bps: Some(2100),
        includes_battery: Some(true),
        includes_inverter: None,
        includes_gateway: Some(false),
        includes_installation: Some(true),
        includes_delivery: None,
        valid_until_unix_s: None,
        availability: Availability::OnRequest,
        additional_costs_notes: "Gateway price not known".into(),
    };
    let offer_id = catalog.add_offer(&offer).await.unwrap();
    let (amount, inverter, gateway): (i64, Option<bool>, Option<bool>) = catalog
        .connection()
        .query_row(
            "SELECT upfront_amount_minor, includes_inverter, includes_gateway FROM offers WHERE id = ?",
            [offer_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(amount, 999_999);
    assert_eq!(inverter, None);
    assert_eq!(gateway, Some(false));
    let (cycles, throughput): (Option<i64>, i64) = catalog
        .connection()
        .query_row(
            "SELECT cycle_limit, throughput_wh FROM warranty_terms WHERE entry_id = ?",
            [entry_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(cycles, None);
    assert_eq!(throughput, 15_000_000);
    offer.recurring_period = None;
    assert!(catalog.add_offer(&offer).await.is_err());
    offer.recurring_period = Some(BillingPeriod::Month);
    offer.currency = "eur".into();
    assert!(catalog.add_offer(&offer).await.is_err());
}

#[tokio::test]
async fn provenance_cannot_be_orphaned_and_review_requires_an_auditable_reviewer() {
    let catalog = Catalog::in_memory().await.unwrap();
    let (_, configuration_id, _) = setup(&catalog).await;
    let mut context = entry(configuration_id, 999_999);
    assert!(catalog.add_entry(&context).await.is_err());
    context.source_id = catalog.add_source(&source("2")).await.unwrap();
    context.review_status = ReviewStatus::Reviewed;
    assert!(catalog.add_entry(&context).await.is_err());
    context.reviewed_by = Some("Fixture reviewer".into());
    context.reviewed_at_unix_s = Some(context.observed_at_unix_s - 1);
    assert!(catalog.add_entry(&context).await.is_err());
    context.reviewed_at_unix_s = Some(context.observed_at_unix_s);
    catalog.add_entry(&context).await.unwrap();
    assert!(execute(&catalog, "DELETE FROM sources", []).is_err());
    assert!(execute(&catalog, "DELETE FROM configurations", []).is_err());
    let mut invalid_source = source("3");
    invalid_source.published_on = Some("2026-02-30".into());
    assert!(catalog.add_source(&invalid_source).await.is_err());
    invalid_source.published_on = None;
    invalid_source.sha256 = Some("z".repeat(64));
    assert!(catalog.add_source(&invalid_source).await.is_err());
}

#[tokio::test]
async fn file_and_copied_databases_enforce_foreign_keys_and_transactions_can_rollback() {
    let directory = tempfile::tempdir().unwrap();
    let catalog = Catalog::open(directory.path().join("research.sqlite3"))
        .await
        .unwrap();
    let copy = Catalog::from_bytes(&catalog.to_bytes().unwrap())
        .await
        .unwrap();
    for database in [&catalog, &copy] {
        let enabled: i64 = scalar(database, "PRAGMA foreign_keys");
        assert_eq!(enabled, 1);
    }
    {
        let mut connection = catalog.connection();
        let transaction = connection.transaction().unwrap();
        transaction
            .execute(
                "INSERT INTO manufacturers (name) VALUES ('Rolled back')",
                [],
            )
            .unwrap();
        transaction.rollback().unwrap();
    }
    let count: i64 = scalar(&catalog, "SELECT count(*) FROM manufacturers");
    assert_eq!(count, 0);
    catalog.close().await;
}

#[tokio::test]
async fn a_backup_while_the_server_runs_includes_what_is_still_in_the_wal() {
    // Zo maakt `GET /api/v1/backup` een back-up zonder de app te stoppen; het bestand zelf kopiëren
    // zou wijzigingen missen die nog alleen in het WAL-bestand staan.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("research.sqlite3");
    let catalog = Catalog::open(&path).await.unwrap();
    setup(&catalog).await;
    let copy = Catalog::from_bytes(&catalog.to_bytes().unwrap())
        .await
        .unwrap();
    assert_eq!(copy.list_products().await.unwrap().len(), 1);
    catalog.close().await;
}

#[tokio::test]
async fn a_copy_of_a_wal_database_file_opens_in_memory_and_stays_writable() {
    // Zo leest de browserversie een back-up of het databasebestand van de lokale server.
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("research.sqlite3");
    let catalog = Catalog::open(&path).await.unwrap();
    setup(&catalog).await;
    catalog.close().await;
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(bytes[18..20], [2, 2], "het bestand staat in WAL-modus");

    let copy = Catalog::from_bytes(&bytes).await.unwrap();
    assert_eq!(copy.list_products().await.unwrap().len(), 1);
    copy.add_manufacturer(&Manufacturer {
        name: "Added in the browser".into(),
        website: None,
    })
    .await
    .unwrap();
    let again = Catalog::from_bytes(&copy.to_bytes().unwrap())
        .await
        .unwrap();
    let manufacturers: i64 = scalar(&again, "SELECT count(*) FROM manufacturers");
    assert_eq!(manufacturers, 2);
    let applied: i64 = scalar(&again, "SELECT count(*) FROM _sqlx_migrations");
    assert_eq!(applied, 5);
    assert!(Catalog::from_bytes(b"not a database").await.is_err());
}

#[tokio::test]
async fn a_backup_must_be_a_thuisaccu_database() {
    // Terugzetten vervangt alles; een ander SQLite-bestand zou anders een lege database worden.
    let catalog = Catalog::in_memory().await.unwrap();
    setup(&catalog).await;
    let restored = Catalog::from_backup(&catalog.to_bytes().unwrap())
        .await
        .unwrap();
    assert_eq!(restored.list_products().await.unwrap().len(), 1);

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("other.db");
    let other = rusqlite::Connection::open(&path).unwrap();
    other
        .execute_batch(
            "CREATE TABLE notes (text TEXT); INSERT INTO notes VALUES ('niet van Thuisaccu');",
        )
        .unwrap();
    drop(other);
    let foreign = std::fs::read(&path).unwrap();
    let refused = Catalog::from_backup(&foreign).await.err().unwrap();
    assert!(
        matches!(&refused, StorageError::InvalidInput(message) if message.contains("geen back-up van Thuisaccu"))
    );
    // Bij gewoon openen (de eigen opslag van de browser) blijven migraties zoals ze waren.
    assert!(Catalog::from_bytes(&foreign).await.is_ok());
    assert!(Catalog::from_backup(b"not a database").await.is_err());
}

#[tokio::test]
async fn migration_checksums_match_sqlx_and_changed_or_unknown_migrations_are_refused() {
    use sha2::{Digest, Sha384};

    let catalog = Catalog::in_memory().await.unwrap();
    // Eerdere versies (SQLx) legden SHA-384 van het migratiebestand vast; bestaande databases
    // moeten zonder herhaling of foutmelding blijven openen.
    let stored: Vec<u8> = scalar(
        &catalog,
        "SELECT checksum FROM _sqlx_migrations WHERE version = 1",
    );
    let expected = Sha384::digest(include_bytes!("../migrations/0001_research_catalog.sql"));
    assert_eq!(stored, expected.to_vec());

    execute(
        &catalog,
        "UPDATE _sqlx_migrations SET checksum = x'00' WHERE version = 2",
        [],
    )
    .unwrap();
    let changed = Catalog::from_bytes(&catalog.to_bytes().unwrap()).await;
    assert!(matches!(changed, Err(StorageError::Migration(_))));

    let catalog = Catalog::in_memory().await.unwrap();
    execute(
        &catalog,
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (99, 'future', TRUE, x'00', 0)",
        [],
    )
    .unwrap();
    let newer = Catalog::from_bytes(&catalog.to_bytes().unwrap()).await;
    assert!(matches!(newer, Err(StorageError::Migration(_))));
}

#[tokio::test]
async fn databases_are_isolated_and_empty_file_paths_are_rejected() {
    let first = Catalog::in_memory().await.unwrap();
    setup(&first).await;
    let second = Catalog::in_memory().await.unwrap();
    assert!(second.list_products().await.unwrap().is_empty());
    assert!(matches!(
        Catalog::open("").await,
        Err(StorageError::EmptyPath)
    ));
}

#[tokio::test]
async fn steady_consumption_is_stored_and_never_exceeds_gross_consumption() {
    use thuisaccu_storage::solar::SolarInterval;
    let catalog = Catalog::in_memory().await.unwrap();
    let interval = |steady| SolarInterval {
        start_unix_s: 0,
        end_unix_s: 3600,
        production_wh: 0.0,
        consumption_wh: Some(1000.0),
        steady_consumption_wh: steady,
        measured_import_wh: None,
        measured_export_wh: None,
    };
    let id = catalog
        .save_solar(
            "fixture",
            &"a".repeat(64),
            "{}",
            "{}",
            &[interval(Some(400.0))],
            0,
        )
        .await
        .unwrap();
    let stored = catalog.solar_intervals(id).await.unwrap();
    assert_eq!(stored[0].steady_consumption_wh, Some(400.0));
    assert!(
        catalog
            .save_solar(
                "fixture",
                &"b".repeat(64),
                "{}",
                "{}",
                &[interval(Some(1000.5))],
                0
            )
            .await
            .is_err()
    );
    // Ook buiten de opslagmethode bewaakt het schema de grens.
    assert!(
        execute(
            &catalog,
            "UPDATE solar_intervals SET steady_consumption_wh = 2000 WHERE import_id = ?",
            [id],
        )
        .is_err()
    );
}

#[tokio::test]
async fn measured_grid_values_are_stored_in_pairs_and_a_duplicate_upload_changes_nothing() {
    use thuisaccu_storage::solar::SolarInterval;
    let catalog = Catalog::in_memory().await.unwrap();
    let interval = |measured: Option<(f64, f64)>| SolarInterval {
        start_unix_s: 0,
        end_unix_s: 3600,
        production_wh: 2000.0,
        consumption_wh: Some(2000.0),
        steady_consumption_wh: None,
        measured_import_wh: measured.map(|m| m.0),
        measured_export_wh: measured.map(|m| m.1),
    };
    let id = catalog
        .save_solar(
            "fixture",
            &"a".repeat(64),
            "{}",
            "{}",
            &[interval(Some((500.0, 500.0)))],
            0,
        )
        .await
        .unwrap();
    let stored = catalog.solar_intervals(id).await.unwrap();
    assert_eq!(stored[0].measured_import_wh, Some(500.0));
    assert_eq!(stored[0].measured_export_wh, Some(500.0));
    // Hetzelfde bestand met dezelfde instellingen geeft het bestaande profiel terug, met dezelfde
    // intervallen: bewaarde berekeningen houden zo hun profiel-hash.
    for measured in [None, Some((900.0, 900.0))] {
        let again = catalog
            .save_solar(
                "fixture",
                &"a".repeat(64),
                "{}",
                "{}",
                &[interval(measured)],
                0,
            )
            .await
            .unwrap();
        assert_eq!(again, id);
        let unchanged = catalog.solar_intervals(id).await.unwrap();
        assert_eq!(unchanged.len(), 1);
        assert_eq!(unchanged[0].measured_import_wh, Some(500.0));
        assert_eq!(unchanged[0].measured_export_wh, Some(500.0));
    }
    // Alleen samen, niet-negatief en met bruto verbruik.
    let mut single = interval(Some((500.0, 500.0)));
    single.measured_export_wh = None;
    let negative = interval(Some((-1.0, 500.0)));
    let mut no_gross = interval(Some((500.0, 500.0)));
    no_gross.consumption_wh = None;
    for (n, bad) in [single, negative, no_gross].into_iter().enumerate() {
        let sha = format!("{n}").repeat(64);
        assert!(
            catalog
                .save_solar("fixture", &sha, "{}", "{}", &[bad], 0)
                .await
                .is_err()
        );
    }
    // Ook het schema bewaakt het paar.
    assert!(
        execute(
            &catalog,
            "UPDATE solar_intervals SET measured_export_wh = NULL WHERE import_id = ?",
            [id],
        )
        .is_err()
    );
}

#[tokio::test]
async fn deleting_a_profile_removes_intervals_and_runs_and_leaves_other_profiles() {
    use thuisaccu_storage::{analysis::NewAnalysis, solar::SolarInterval};
    let catalog = Catalog::in_memory().await.unwrap();
    let interval = SolarInterval {
        start_unix_s: 0,
        end_unix_s: 3600,
        production_wh: 1000.0,
        consumption_wh: Some(500.0),
        steady_consumption_wh: None,
        measured_import_wh: None,
        measured_export_wh: None,
    };
    let mut ids = vec![];
    for sha in ["a", "b"] {
        ids.push(
            catalog
                .save_solar(
                    "fixture",
                    &sha.repeat(64),
                    "{}",
                    "{}",
                    std::slice::from_ref(&interval),
                    0,
                )
                .await
                .unwrap(),
        );
    }
    for &import_id in &ids {
        catalog
            .save_analysis(&NewAnalysis {
                import_id,
                title: "Fixture run",
                model_version: "fixture",
                profile_sha256: &"c".repeat(64),
                input_json: "{}",
                result_json: "{}",
                now: 0,
            })
            .await
            .unwrap();
    }
    assert_eq!(catalog.delete_solar(ids[0]).await.unwrap(), Some(1));
    assert_eq!(catalog.delete_solar(ids[0]).await.unwrap(), None);
    let left = catalog.list_solar().await.unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].analysis_runs, 1);
    let total: i64 = scalar(&catalog, "SELECT count(*) FROM solar_intervals");
    assert_eq!(total, 1);
    let run = catalog.list_analyses().await.unwrap()[0].id;
    assert!(catalog.delete_analysis(run).await.unwrap());
    assert!(!catalog.delete_analysis(run).await.unwrap());
    assert_eq!(catalog.list_solar().await.unwrap()[0].analysis_runs, 0);
}

#[tokio::test]
async fn a_profile_saved_with_a_name_in_its_settings_is_found_again_without_that_name() {
    use thuisaccu_storage::solar::{SolarInterval, StoredSolar};
    let catalog = Catalog::in_memory().await.unwrap();
    let interval = SolarInterval {
        start_unix_s: 0,
        end_unix_s: 3600,
        production_wh: 100.0,
        consumption_wh: Some(200.0),
        steady_consumption_wh: None,
        measured_import_wh: None,
        measured_export_wh: None,
    };
    let sha = "c".repeat(64);
    // Zo bewaarden eerdere versies een eigen naam en de naam van het meterbestand.
    let legacy = r#"{"timezone":"UTC","source_filename":"oud.csv","meter_filename":"p1.csv","meter":{"period":"hour"}}"#;
    let first = catalog
        .import_solar(
            "Ons huis",
            &sha,
            legacy,
            "{}",
            std::slice::from_ref(&interval),
            0,
        )
        .await
        .unwrap();
    assert!(!first.existing);
    let current = r#"{"timezone":"UTC","meter":{"period":"hour"}}"#;
    let again = catalog
        .import_solar(
            "Andere naam",
            &sha,
            current,
            "{}",
            std::slice::from_ref(&interval),
            1,
        )
        .await
        .unwrap();
    assert_eq!(
        again,
        StoredSolar {
            id: first.id,
            existing: true,
            filename: "Ons huis".into()
        }
    );
    // Andere instellingen zijn wel een ander profiel.
    let other = catalog
        .import_solar(
            "Ons huis",
            &sha,
            r#"{"timezone":"Europe/Amsterdam","meter":{"period":"hour"}}"#,
            "{}",
            &[interval],
            2,
        )
        .await
        .unwrap();
    assert!(!other.existing);
    assert_eq!(catalog.list_solar().await.unwrap().len(), 2);
}

#[test]
fn the_run_list_keeps_only_options_with_a_quote_total_and_only_that_line() {
    use thuisaccu_storage::analysis::{QUOTE_TOTAL_SOURCE, SummaryRequest};
    let line = |category: &str, status: &str, source: &str| serde_json::json!({"category": category, "status": status, "amount_minor": 450_000, "source": source, "timing": "upfront"});
    let request: SummaryRequest = serde_json::from_value(serde_json::json!({
        "candidates": [
            {"key": "indicatie", "costs": [line("battery", "priced", "Richtprijs")]},
            {"key": "offerte", "battery": {"usable_capacity_kwh": 5}, "costs": [
                line("installation", "priced", QUOTE_TOTAL_SOURCE),
                line("battery", "priced", QUOTE_TOTAL_SOURCE),
            ]},
            {"key": "onbekend", "costs": [line("battery", "unknown", QUOTE_TOTAL_SOURCE)]},
        ]
    }))
    .unwrap();
    assert_eq!(request.candidates.len(), 1);
    let quoted = &request.candidates[0];
    assert_eq!(quoted.key, "offerte");
    assert_eq!(quoted.costs.len(), 1);
    assert_eq!(quoted.costs[0].category, "battery");
    assert_eq!(quoted.costs[0].amount_minor, 450_000);
    // Zonder zo'n optie verdwijnt het veld uit de lijst.
    let plain: SummaryRequest = serde_json::from_value(serde_json::json!({
        "candidates": [{"key": "indicatie", "costs": [line("battery", "priced", "Richtprijs")]}]
    }))
    .unwrap();
    assert!(
        serde_json::to_value(&plain)
            .unwrap()
            .get("candidates")
            .is_none()
    );
}
