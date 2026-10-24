//! SQLite-opslag met ingebouwde migraties en brongebonden onderzoeksclaims.

use std::{path::Path, time::Duration};

use sqlx::{
    Row, SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};
use thuisaccu_core::products::*;

static MIGRATOR: Migrator = sqlx::migrate!();

pub mod analysis;
pub mod comparison;
pub mod solar;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    UnknownCode(#[from] UnknownCode),
    #[error("Numeric observations must contain finite values")]
    NonFiniteNumber,
    #[error("Database path must not be empty")]
    EmptyPath,
    #[error("Invalid research input: {0}")]
    InvalidInput(String),
}

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Clone)]
pub struct Catalog {
    pool: SqlitePool,
}

impl Catalog {
    /// Maakt zo nodig de map en het bestand aan en past migraties toe.
    pub async fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if path.as_os_str().is_empty() {
            return Err(StorageError::EmptyPath);
        }
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            tokio::fs::create_dir_all(parent).await?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full);
        Self::connect(options, 5).await
    }

    /// Eigen database per aanroep, met één verbinding voor geïsoleerde tests.
    pub async fn in_memory() -> Result<Self> {
        Self::connect(SqliteConnectOptions::new().in_memory(true), 1).await
    }

    async fn connect(options: SqliteConnectOptions, max_connections: u32) -> Result<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(
                options
                    .foreign_keys(true)
                    .busy_timeout(Duration::from_secs(5)),
            )
            .await?;
        if let Err(error) = MIGRATOR.run(&pool).await {
            pool.close().await;
            return Err(error.into());
        }
        Ok(Self { pool })
    }

    /// Voor onderzoeksqueries en transacties met meerdere samenhangende writes.
    /// Houd daarbij de bron- en eenheidsafspraken uit `docs/data-model.md` aan.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }

    pub async fn add_manufacturer(&self, data: &Manufacturer) -> Result<i64> {
        Ok(sqlx::query_scalar(
            "INSERT INTO manufacturers (name, website) VALUES (?, ?) RETURNING id",
        )
        .bind(&data.name)
        .bind(&data.website)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn add_product(&self, data: &Product) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO products (manufacturer_id, name, model_code, kind) VALUES (?, ?, ?, ?) RETURNING id")
            .bind(data.manufacturer_id).bind(&data.name).bind(&data.model_code).bind(data.kind.as_str())
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_configuration(&self, data: &Configuration) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO configurations (product_id, name, variant_code, hardware_revision) VALUES (?, ?, ?, ?) RETURNING id")
            .bind(data.product_id).bind(&data.name).bind(&data.variant_code).bind(&data.hardware_revision)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_component(&self, data: &Component) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO configuration_components (entry_id, product_id, quantity, role) VALUES (?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(data.product_id).bind(data.quantity).bind(&data.role)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_source(&self, data: &Source) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO sources (kind, title, url, document_revision, published_on, retrieved_at_unix_s, sha256, archived_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.kind.as_str()).bind(&data.title).bind(&data.url).bind(&data.document_revision)
            .bind(&data.published_on).bind(data.retrieved_at_unix_s).bind(&data.sha256).bind(&data.archived_path)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_entry(&self, data: &ResearchEntry) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO research_entries (configuration_id, source_id, locator, observed_at_unix_s, market, firmware_revision, review_status, reviewed_by, reviewed_at_unix_s, conditions, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.configuration_id).bind(data.source_id).bind(&data.locator).bind(data.observed_at_unix_s)
            .bind(&data.market).bind(&data.firmware_revision).bind(data.review_status.as_str())
            .bind(&data.reviewed_by).bind(data.reviewed_at_unix_s).bind(&data.conditions).bind(&data.notes)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_numeric_observation(&self, data: &NumericObservation) -> Result<i64> {
        if !data.value.is_finite()
            || [
                data.upper_value,
                data.test_temperature_c,
                data.test_power_w,
                data.test_soc_pct,
                data.test_depth_of_discharge_pct,
                data.test_c_rate,
            ]
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite())
        {
            return Err(StorageError::NonFiniteNumber);
        }
        Ok(sqlx::query_scalar("INSERT INTO numeric_observations (entry_id, metric_key, qualifier, value, upper_value, boundary, reported_value, test_temperature_c, test_power_w, test_soc_pct, test_depth_of_discharge_pct, test_c_rate, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(data.metric.as_str()).bind(data.qualifier.as_str()).bind(data.value)
            .bind(data.upper_value).bind(data.boundary.as_str()).bind(&data.reported_value)
            .bind(data.test_temperature_c).bind(data.test_power_w).bind(data.test_soc_pct)
            .bind(data.test_depth_of_discharge_pct).bind(data.test_c_rate).bind(&data.conditions)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_feature_observation(&self, data: &FeatureObservation) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO feature_observations (entry_id, metric_key, status, conditions) VALUES (?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(data.metric.as_str()).bind(data.status.as_str()).bind(&data.conditions)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_text_observation(&self, data: &TextObservation) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO text_observations (entry_id, metric_key, value, conditions) VALUES (?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(data.metric.as_str()).bind(&data.value).bind(&data.conditions)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_warranty(&self, data: &WarrantyTerms) -> Result<i64> {
        if data
            .retained_capacity_pct
            .is_some_and(|value| !value.is_finite())
        {
            return Err(StorageError::NonFiniteNumber);
        }
        Ok(sqlx::query_scalar("INSERT INTO warranty_terms (entry_id, product_months, performance_months, retained_capacity_pct, cycle_limit, throughput_wh, limit_rule, application, activation_required, internet_required, labour_included, transferable, exclusions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(data.product_months).bind(data.performance_months)
            .bind(data.retained_capacity_pct).bind(data.cycle_limit).bind(data.throughput_wh)
            .bind(data.limit_rule.as_str()).bind(&data.application).bind(data.activation_required)
            .bind(data.internet_required).bind(data.labour_included).bind(data.transferable).bind(&data.exclusions)
            .fetch_one(&self.pool).await?)
    }

    pub async fn add_compatibility_claim(&self, data: &CompatibilityClaim) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO compatibility_claims (entry_id, counterpart_product_id, status, counterpart_firmware, battery_firmware, min_modules, max_modules, min_parallel_units, max_parallel_units, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(data.counterpart_product_id).bind(data.status.as_str())
            .bind(&data.counterpart_firmware).bind(&data.battery_firmware)
            .bind(data.min_modules).bind(data.max_modules).bind(data.min_parallel_units).bind(data.max_parallel_units)
            .bind(&data.conditions).fetch_one(&self.pool).await?)
    }

    pub async fn add_conformity_claim(&self, data: &ConformityClaim) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO conformity_claims (entry_id, standard, edition, status, certificate_reference, conditions) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(&data.standard).bind(&data.edition).bind(data.status.as_str())
            .bind(&data.certificate_reference).bind(&data.conditions).fetch_one(&self.pool).await?)
    }

    pub async fn add_offer(&self, data: &Offer) -> Result<i64> {
        Ok(sqlx::query_scalar("INSERT INTO offers (entry_id, seller, currency, minor_unit_exponent, upfront_amount_minor, recurring_amount_minor, recurring_period, tax_basis, tax_rate_bps, includes_battery, includes_inverter, includes_gateway, includes_installation, includes_delivery, valid_until_unix_s, availability, additional_costs_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
            .bind(data.entry_id).bind(&data.seller).bind(&data.currency).bind(data.minor_unit_exponent)
            .bind(data.upfront_amount_minor).bind(data.recurring_amount_minor)
            .bind(data.recurring_period.map(BillingPeriod::as_str)).bind(data.tax_basis.as_str()).bind(data.tax_rate_bps)
            .bind(data.includes_battery).bind(data.includes_inverter).bind(data.includes_gateway)
            .bind(data.includes_installation).bind(data.includes_delivery).bind(data.valid_until_unix_s)
            .bind(data.availability.as_str()).bind(&data.additional_costs_notes)
            .fetch_one(&self.pool).await?)
    }

    pub async fn list_products(&self) -> Result<Vec<Record<Product>>> {
        let rows = sqlx::query(
            "SELECT id, manufacturer_id, name, model_code, kind FROM products ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(Record {
                    id: row.try_get("id")?,
                    data: Product {
                        manufacturer_id: row.try_get("manufacturer_id")?,
                        name: row.try_get("name")?,
                        model_code: row.try_get("model_code")?,
                        kind: row.try_get::<&str, _>("kind")?.parse()?,
                    },
                })
            })
            .collect()
    }

    /// Alle bronclaims voor deze uitvoering, zonder automatisch een winnaar te kiezen.
    pub async fn list_numeric_observations(
        &self,
        configuration_id: i64,
    ) -> Result<Vec<Record<NumericObservation>>> {
        let rows = sqlx::query("SELECT n.* FROM numeric_observations n JOIN research_entries e ON e.id = n.entry_id WHERE e.configuration_id = ? ORDER BY n.id")
            .bind(configuration_id).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(Record {
                    id: row.try_get("id")?,
                    data: NumericObservation {
                        entry_id: row.try_get("entry_id")?,
                        metric: row.try_get::<&str, _>("metric_key")?.parse()?,
                        qualifier: row.try_get::<&str, _>("qualifier")?.parse()?,
                        value: row.try_get("value")?,
                        upper_value: row.try_get("upper_value")?,
                        boundary: row.try_get::<&str, _>("boundary")?.parse()?,
                        reported_value: row.try_get("reported_value")?,
                        test_temperature_c: row.try_get("test_temperature_c")?,
                        test_power_w: row.try_get("test_power_w")?,
                        test_soc_pct: row.try_get("test_soc_pct")?,
                        test_depth_of_discharge_pct: row.try_get("test_depth_of_discharge_pct")?,
                        test_c_rate: row.try_get("test_c_rate")?,
                        conditions: row.try_get("conditions")?,
                    },
                })
            })
            .collect()
    }
}
