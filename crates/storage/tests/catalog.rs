use sqlx::Row;
use thuisaccu_core::products::*;
use thuisaccu_storage::{Catalog, StorageError};

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
    let applied: i64 =
        sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE success = 1")
            .fetch_one(reopened.pool())
            .await
            .unwrap();
    assert_eq!(applied, 3);
    let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(reopened.pool())
        .await
        .unwrap();
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
    let rows = sqlx::query("SELECT document_revision, source_url, review_status, market, unit FROM numeric_research ORDER BY id")
        .fetch_all(catalog.pool()).await.unwrap();
    assert_eq!(rows[0].get::<String, _>("document_revision"), "1");
    assert_eq!(rows[1].get::<String, _>("document_revision"), "2");
    assert_eq!(rows[0].get::<String, _>("review_status"), "unreviewed");
    assert_eq!(rows[1].get::<String, _>("market"), "Example market");
    assert_eq!(rows[0].get::<String, _>("unit"), "%");
    assert_eq!(
        rows[0].get::<String, _>("source_url"),
        "https://example.invalid/battery.pdf"
    );
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
    assert!(sqlx::query("UPDATE numeric_observations SET metric_key = 'round_trip_efficiency_pct', value = 101 WHERE id = ?")
        .bind(id).execute(catalog.pool()).await.is_err());
    assert!(
        sqlx::query("UPDATE numeric_observations SET metric_key = 'unknown_unit' WHERE id = ?")
            .bind(id)
            .execute(catalog.pool())
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE numeric_observations SET value = 'not a number' WHERE id = ?")
            .bind(id)
            .execute(catalog.pool())
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE numeric_observations SET test_soc_pct = 101 WHERE id = ?")
            .bind(id)
            .execute(catalog.pool())
            .await
            .is_err()
    );
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
    let keys: Vec<String> = sqlx::query_scalar("SELECT key FROM numeric_metrics ORDER BY key")
        .fetch_all(catalog.pool())
        .await
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
    assert!(sqlx::query("INSERT INTO feature_observations (entry_id, metric_key, status) VALUES (?, 'backup', 'conditional')")
        .bind(entry_id).execute(catalog.pool()).await.is_err());
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
    let row = sqlx::query("SELECT * FROM offers WHERE id = ?")
        .bind(offer_id)
        .fetch_one(catalog.pool())
        .await
        .unwrap();
    assert_eq!(row.get::<i64, _>("upfront_amount_minor"), 999_999);
    assert_eq!(row.get::<Option<bool>, _>("includes_inverter"), None);
    assert_eq!(row.get::<Option<bool>, _>("includes_gateway"), Some(false));
    let row = sqlx::query("SELECT * FROM warranty_terms WHERE entry_id = ?")
        .bind(entry_id)
        .fetch_one(catalog.pool())
        .await
        .unwrap();
    assert_eq!(row.get::<Option<i64>, _>("cycle_limit"), None);
    assert_eq!(row.get::<i64, _>("throughput_wh"), 15_000_000);
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
    assert!(
        sqlx::query("DELETE FROM sources")
            .execute(catalog.pool())
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM configurations")
            .execute(catalog.pool())
            .await
            .is_err()
    );
    let mut invalid_source = source("3");
    invalid_source.published_on = Some("2026-02-30".into());
    assert!(catalog.add_source(&invalid_source).await.is_err());
    invalid_source.published_on = None;
    invalid_source.sha256 = Some("z".repeat(64));
    assert!(catalog.add_source(&invalid_source).await.is_err());
}

#[tokio::test]
async fn every_file_connection_enforces_foreign_keys_and_transactions_can_rollback() {
    let directory = tempfile::tempdir().unwrap();
    let catalog = Catalog::open(directory.path().join("research.sqlite3"))
        .await
        .unwrap();
    let mut connections = Vec::new();
    for _ in 0..5 {
        let mut connection = catalog.pool().acquire().await.unwrap();
        let enabled: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        assert_eq!(enabled, 1);
        connections.push(connection);
    }
    drop(connections);
    let mut transaction = catalog.pool().begin().await.unwrap();
    sqlx::query("INSERT INTO manufacturers (name) VALUES ('Rolled back')")
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.rollback().await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM manufacturers")
        .fetch_one(catalog.pool())
        .await
        .unwrap();
    assert_eq!(count, 0);
    catalog.close().await;
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
