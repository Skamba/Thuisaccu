//! SQLite-opslag met ingebouwde migraties en brongebonden onderzoeksclaims.
//!
//! Eén verbinding achter een mutex. SQLite-aanroepen zijn kort en draaien direct; zo werkt
//! dezelfde opslag in de lokale server en, naar WebAssembly gecompileerd, in de browser.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use rusqlite::{Connection, MAIN_DB, params};
use thuisaccu_core::products::*;

pub mod analysis;
pub mod comparison;
mod migrations;
pub mod solar;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error("Migration failed: {0}")]
    Migration(String),
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
    /// Opgeslagen JSON die niet meer te lezen is: een serverfout, geen invoerfout.
    #[error("Stored data could not be read: {0}")]
    Corrupt(String),
}

impl StorageError {
    /// Een geschonden CHECK-, UNIQUE-, NOT NULL- of foreign-key-regel: een invoerfout, geen serverfout.
    pub fn is_constraint_violation(&self) -> bool {
        matches!(self, Self::Database(rusqlite::Error::SqliteFailure(error, _))
            if error.code == rusqlite::ErrorCode::ConstraintViolation)
    }
}

pub type Result<T> = std::result::Result<T, StorageError>;

#[derive(Debug, Clone)]
pub struct Catalog {
    connection: Arc<Mutex<Connection>>,
}

impl Catalog {
    /// Maakt zo nodig de map en het bestand aan en past migraties toe.
    #[cfg(not(target_family = "wasm"))]
    pub async fn open(path: impl AsRef<std::path::Path>) -> Result<Self> {
        let path = path.as_ref();
        if path.as_os_str().is_empty() {
            return Err(StorageError::EmptyPath);
        }
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection
            .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        Self::prepare(connection)
    }

    /// Eigen database per aanroep, voor geïsoleerde tests en een lege browseropslag.
    pub async fn in_memory() -> Result<Self> {
        Self::prepare(Connection::open_in_memory()?)
    }

    /// Database in het geheugen uit een kopie van een databasebestand, zoals de browser die bewaart.
    /// Ontbrekende migraties worden toegepast; een onbekende of gewijzigde migratie wordt geweigerd.
    pub async fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if !bytes.starts_with(b"SQLite format 3\0") || bytes.len() < 100 {
            return Err(StorageError::InvalidInput(
                "Dit is geen SQLite-database".into(),
            ));
        }
        let mut copy = bytes.to_vec();
        // Een bestand in WAL-modus (zoals de lokale server het schrijft) leest SQLite in het geheugen
        // alleen als gewone database; de bytes 18 en 19 geven die modus aan.
        if copy[18] == 2 && copy[19] == 2 {
            copy[18] = 1;
            copy[19] = 1;
        }
        let mut connection = Connection::open_in_memory()?;
        connection.deserialize_read_exact(MAIN_DB, &copy[..], copy.len(), false)?;
        Self::prepare(connection)
    }

    fn prepare(mut connection: Connection) -> Result<Self> {
        connection.pragma_update(None, "foreign_keys", true)?;
        migrations::run(&mut connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    /// Volledige kopie van de database, bijvoorbeeld om in de browser te bewaren of als back-up.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(self.connection().serialize(MAIN_DB)?.to_vec())
    }

    /// Voor onderzoeksqueries en transacties met meerdere samenhangende writes.
    /// Houd daarbij de bron- en eenheidsafspraken uit `docs/data-model.md` aan.
    pub fn connection(&self) -> MutexGuard<'_, Connection> {
        // Na een paniek is de verbinding nog bruikbaar: een open transactie is bij het opruimen teruggedraaid.
        self.connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Schrijft het WAL-bestand terug in de database, zodat het databasebestand op zichzelf compleet is.
    pub async fn close(&self) {
        // Een database in het geheugen heeft geen WAL; een mislukte checkpoint laat de data intact.
        let _ = self
            .connection()
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    }

    pub async fn add_manufacturer(&self, data: &Manufacturer) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO manufacturers (name, website) VALUES (?, ?) RETURNING id",
            params![data.name, data.website],
            |row| row.get(0),
        )?)
    }

    pub async fn add_product(&self, data: &Product) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO products (manufacturer_id, name, model_code, kind) VALUES (?, ?, ?, ?) RETURNING id",
            params![data.manufacturer_id, data.name, data.model_code, data.kind.as_str()],
            |row| row.get(0),
        )?)
    }

    pub async fn add_configuration(&self, data: &Configuration) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO configurations (product_id, name, variant_code, hardware_revision) VALUES (?, ?, ?, ?) RETURNING id",
            params![data.product_id, data.name, data.variant_code, data.hardware_revision],
            |row| row.get(0),
        )?)
    }

    pub async fn add_component(&self, data: &Component) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO configuration_components (entry_id, product_id, quantity, role) VALUES (?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.product_id, data.quantity, data.role],
            |row| row.get(0),
        )?)
    }

    pub async fn add_source(&self, data: &Source) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO sources (kind, title, url, document_revision, published_on, retrieved_at_unix_s, sha256, archived_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.kind.as_str(), data.title, data.url, data.document_revision,
                data.published_on, data.retrieved_at_unix_s, data.sha256, data.archived_path],
            |row| row.get(0),
        )?)
    }

    pub async fn add_entry(&self, data: &ResearchEntry) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO research_entries (configuration_id, source_id, locator, observed_at_unix_s, market, firmware_revision, review_status, reviewed_by, reviewed_at_unix_s, conditions, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.configuration_id, data.source_id, data.locator, data.observed_at_unix_s,
                data.market, data.firmware_revision, data.review_status.as_str(),
                data.reviewed_by, data.reviewed_at_unix_s, data.conditions, data.notes],
            |row| row.get(0),
        )?)
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
        Ok(self.connection().query_row(
            "INSERT INTO numeric_observations (entry_id, metric_key, qualifier, value, upper_value, boundary, reported_value, test_temperature_c, test_power_w, test_soc_pct, test_depth_of_discharge_pct, test_c_rate, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.metric.as_str(), data.qualifier.as_str(), data.value,
                data.upper_value, data.boundary.as_str(), data.reported_value,
                data.test_temperature_c, data.test_power_w, data.test_soc_pct,
                data.test_depth_of_discharge_pct, data.test_c_rate, data.conditions],
            |row| row.get(0),
        )?)
    }

    pub async fn add_feature_observation(&self, data: &FeatureObservation) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO feature_observations (entry_id, metric_key, status, conditions) VALUES (?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.metric.as_str(), data.status.as_str(), data.conditions],
            |row| row.get(0),
        )?)
    }

    pub async fn add_text_observation(&self, data: &TextObservation) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO text_observations (entry_id, metric_key, value, conditions) VALUES (?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.metric.as_str(), data.value, data.conditions],
            |row| row.get(0),
        )?)
    }

    pub async fn add_warranty(&self, data: &WarrantyTerms) -> Result<i64> {
        if data
            .retained_capacity_pct
            .is_some_and(|value| !value.is_finite())
        {
            return Err(StorageError::NonFiniteNumber);
        }
        Ok(self.connection().query_row(
            "INSERT INTO warranty_terms (entry_id, product_months, performance_months, retained_capacity_pct, cycle_limit, throughput_wh, limit_rule, application, activation_required, internet_required, labour_included, transferable, exclusions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.product_months, data.performance_months,
                data.retained_capacity_pct, data.cycle_limit, data.throughput_wh,
                data.limit_rule.as_str(), data.application, data.activation_required,
                data.internet_required, data.labour_included, data.transferable, data.exclusions],
            |row| row.get(0),
        )?)
    }

    pub async fn add_compatibility_claim(&self, data: &CompatibilityClaim) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO compatibility_claims (entry_id, counterpart_product_id, status, counterpart_firmware, battery_firmware, min_modules, max_modules, min_parallel_units, max_parallel_units, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.counterpart_product_id, data.status.as_str(),
                data.counterpart_firmware, data.battery_firmware, data.min_modules,
                data.max_modules, data.min_parallel_units, data.max_parallel_units, data.conditions],
            |row| row.get(0),
        )?)
    }

    pub async fn add_conformity_claim(&self, data: &ConformityClaim) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO conformity_claims (entry_id, standard, edition, status, certificate_reference, conditions) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.standard, data.edition, data.status.as_str(),
                data.certificate_reference, data.conditions],
            |row| row.get(0),
        )?)
    }

    pub async fn add_offer(&self, data: &Offer) -> Result<i64> {
        Ok(self.connection().query_row(
            "INSERT INTO offers (entry_id, seller, currency, minor_unit_exponent, upfront_amount_minor, recurring_amount_minor, recurring_period, tax_basis, tax_rate_bps, includes_battery, includes_inverter, includes_gateway, includes_installation, includes_delivery, valid_until_unix_s, availability, additional_costs_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            params![data.entry_id, data.seller, data.currency, data.minor_unit_exponent,
                data.upfront_amount_minor, data.recurring_amount_minor,
                data.recurring_period.map(BillingPeriod::as_str), data.tax_basis.as_str(),
                data.tax_rate_bps, data.includes_battery, data.includes_inverter,
                data.includes_gateway, data.includes_installation, data.includes_delivery,
                data.valid_until_unix_s, data.availability.as_str(), data.additional_costs_notes],
            |row| row.get(0),
        )?)
    }

    pub async fn list_products(&self) -> Result<Vec<Record<Product>>> {
        let connection = self.connection();
        let mut statement = connection.prepare(
            "SELECT id, manufacturer_id, name, model_code, kind FROM products ORDER BY id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Record {
                id: row.get("id")?,
                data: Product {
                    manufacturer_id: row.get("manufacturer_id")?,
                    name: row.get("name")?,
                    model_code: row.get("model_code")?,
                    kind: code(row, "kind")?,
                },
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Alle bronclaims voor deze uitvoering, zonder automatisch een winnaar te kiezen.
    pub async fn list_numeric_observations(
        &self,
        configuration_id: i64,
    ) -> Result<Vec<Record<NumericObservation>>> {
        let connection = self.connection();
        let mut statement = connection.prepare("SELECT n.* FROM numeric_observations n JOIN research_entries e ON e.id = n.entry_id WHERE e.configuration_id = ? ORDER BY n.id")?;
        let rows = statement.query_map([configuration_id], |row| {
            Ok(Record {
                id: row.get("id")?,
                data: NumericObservation {
                    entry_id: row.get("entry_id")?,
                    metric: code(row, "metric_key")?,
                    qualifier: code(row, "qualifier")?,
                    value: row.get("value")?,
                    upper_value: row.get("upper_value")?,
                    boundary: code(row, "boundary")?,
                    reported_value: row.get("reported_value")?,
                    test_temperature_c: row.get("test_temperature_c")?,
                    test_power_w: row.get("test_power_w")?,
                    test_soc_pct: row.get("test_soc_pct")?,
                    test_depth_of_discharge_pct: row.get("test_depth_of_discharge_pct")?,
                    test_c_rate: row.get("test_c_rate")?,
                    conditions: row.get("conditions")?,
                },
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

/// Een gecontroleerde code uit de database; een onbekende code is een conversiefout.
fn code<T: std::str::FromStr<Err = UnknownCode>>(
    row: &rusqlite::Row<'_>,
    column: &str,
) -> rusqlite::Result<T> {
    let index = row.as_ref().column_index(column)?;
    row.get::<_, String>(index)?.parse().map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}
