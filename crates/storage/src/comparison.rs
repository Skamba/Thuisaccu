//! Leesmodel voor de vergelijking en atomische invoer van een onderzoeksdossier.

use rusqlite::{Row, Transaction, params};
use serde::{Deserialize, Serialize};
use thuisaccu_core::products::{
    FeatureMetric, FeatureStatus, MeasurementBoundary, NumberQualifier, NumericMetric, ProductKind,
    SourceKind, TextMetric,
};

use crate::{Catalog, Result, StorageError};

#[derive(Debug, Serialize)]
pub struct ConfigurationRow {
    pub id: i64,
    pub product_id: i64,
    pub manufacturer_name: String,
    pub product_name: String,
    pub model_code: String,
    pub name: String,
    pub hardware_revision: String,
    pub product_kind: String,
}

#[derive(Debug, Serialize)]
pub struct NumberRow {
    pub id: i64,
    pub configuration_id: i64,
    pub metric_key: String,
    pub qualifier: String,
    pub value: f64,
    pub upper_value: Option<f64>,
    pub unit: String,
    pub boundary: String,
    pub reported_value: String,
    pub test_temperature_c: Option<f64>,
    pub test_power_w: Option<f64>,
    pub test_soc_pct: Option<f64>,
    pub test_depth_of_discharge_pct: Option<f64>,
    pub test_c_rate: Option<f64>,
    pub conditions: String,
    pub entry_conditions: String,
    pub source_url: String,
    pub source_title: String,
    pub document_revision: Option<String>,
    pub locator: String,
    pub market: String,
    pub review_status: String,
    pub observed_at_unix_s: i64,
}

#[derive(Debug, Serialize)]
pub struct FeatureRow {
    pub configuration_id: i64,
    pub metric_key: String,
    pub status: String,
    pub conditions: String,
    pub source_url: String,
    pub source_title: String,
    pub review_status: String,
    pub market: String,
}

#[derive(Debug, Serialize)]
pub struct TextRow {
    pub configuration_id: i64,
    pub metric_key: String,
    pub value: String,
    pub conditions: String,
    pub source_url: String,
    pub source_title: String,
    pub review_status: String,
    pub market: String,
}

#[derive(Debug, Serialize)]
pub struct WarrantyRow {
    pub configuration_id: i64,
    pub product_months: Option<i64>,
    pub performance_months: Option<i64>,
    pub retained_capacity_pct: Option<f64>,
    pub cycle_limit: Option<i64>,
    pub throughput_wh: Option<i64>,
    pub limit_rule: String,
    pub application: String,
    pub exclusions: String,
    pub source_url: String,
    pub source_title: String,
    pub review_status: String,
    pub market: String,
}

#[derive(Debug, Serialize)]
pub struct OfferRow {
    pub configuration_id: i64,
    pub seller: String,
    pub currency: String,
    pub minor_unit_exponent: i64,
    pub upfront_amount_minor: i64,
    pub recurring_amount_minor: Option<i64>,
    pub recurring_period: Option<String>,
    pub tax_basis: String,
    pub includes_installation: Option<bool>,
    pub includes_battery: Option<bool>,
    pub includes_inverter: Option<bool>,
    pub includes_gateway: Option<bool>,
    pub includes_delivery: Option<bool>,
    pub valid_until_unix_s: Option<i64>,
    pub observed_at_unix_s: i64,
    pub additional_costs_notes: String,
    pub source_url: String,
    pub source_title: String,
    pub review_status: String,
    pub market: String,
}

#[derive(Debug, Serialize)]
pub struct Comparison {
    pub configurations: Vec<ConfigurationRow>,
    pub numbers: Vec<NumberRow>,
    pub features: Vec<FeatureRow>,
    pub texts: Vec<TextRow>,
    pub warranties: Vec<WarrantyRow>,
    pub offers: Vec<OfferRow>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftNumber {
    pub metric: String,
    pub qualifier: String,
    pub value: f64,
    pub upper_value: Option<f64>,
    pub boundary: String,
    pub reported_value: String,
    #[serde(default)]
    pub conditions: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftFeature {
    pub metric: String,
    pub status: String,
    #[serde(default)]
    pub conditions: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftText {
    pub metric: String,
    pub value: String,
    #[serde(default)]
    pub conditions: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftPrice {
    pub seller: String,
    pub currency: String,
    pub minor_unit_exponent: i64,
    pub amount_minor: i64,
    pub tax_basis: String,
    pub includes_installation: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateDraft {
    pub manufacturer: String,
    pub product: String,
    pub model_code: String,
    pub product_kind: String,
    pub configuration: String,
    pub market: String,
    pub source_url: String,
    pub source_title: String,
    pub locator: String,
    pub source_kind: Option<String>,
    pub document_revision: Option<String>,
    pub published_on: Option<String>,
    #[serde(default)]
    pub conditions: String,
    #[serde(default)]
    pub numbers: Vec<DraftNumber>,
    #[serde(default)]
    pub features: Vec<DraftFeature>,
    #[serde(default)]
    pub texts: Vec<DraftText>,
    pub product_warranty_months: Option<i64>,
    pub price: Option<DraftPrice>,
}

/// Leest een rij op kolomnaam; extra kolommen in de query worden genegeerd.
macro_rules! from_row {
    ($name:ident { $($field:ident),+ $(,)? }) => {
        impl $name {
            fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
                Ok(Self { $($field: row.get(stringify!($field))?),+ })
            }
        }
    };
}

from_row!(ConfigurationRow {
    id,
    product_id,
    manufacturer_name,
    product_name,
    model_code,
    name,
    hardware_revision,
    product_kind,
});
from_row!(NumberRow {
    id,
    configuration_id,
    metric_key,
    qualifier,
    value,
    upper_value,
    unit,
    boundary,
    reported_value,
    test_temperature_c,
    test_power_w,
    test_soc_pct,
    test_depth_of_discharge_pct,
    test_c_rate,
    conditions,
    entry_conditions,
    source_url,
    source_title,
    document_revision,
    locator,
    market,
    review_status,
    observed_at_unix_s,
});
from_row!(FeatureRow {
    configuration_id,
    metric_key,
    status,
    conditions,
    source_url,
    source_title,
    review_status,
    market,
});
from_row!(TextRow {
    configuration_id,
    metric_key,
    value,
    conditions,
    source_url,
    source_title,
    review_status,
    market,
});
from_row!(WarrantyRow {
    configuration_id,
    product_months,
    performance_months,
    retained_capacity_pct,
    cycle_limit,
    throughput_wh,
    limit_rule,
    application,
    exclusions,
    source_url,
    source_title,
    review_status,
    market,
});
from_row!(OfferRow {
    configuration_id,
    seller,
    currency,
    minor_unit_exponent,
    upfront_amount_minor,
    recurring_amount_minor,
    recurring_period,
    tax_basis,
    includes_installation,
    includes_battery,
    includes_inverter,
    includes_gateway,
    includes_delivery,
    valid_until_unix_s,
    observed_at_unix_s,
    additional_costs_notes,
    source_url,
    source_title,
    review_status,
    market,
});

fn all<T>(
    tx: &Transaction<'_>,
    sql: &str,
    read: fn(&Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Vec<T>> {
    tx.prepare(sql)?.query_map([], read)?.collect()
}

impl Catalog {
    pub async fn comparison(&self) -> Result<Comparison> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let configurations = all(
            &tx,
            "SELECT c.id, c.product_id, c.name, c.hardware_revision, p.name AS product_name, p.model_code, p.kind AS product_kind, m.name AS manufacturer_name FROM configurations c JOIN products p ON p.id = c.product_id JOIN manufacturers m ON m.id = p.manufacturer_id ORDER BY m.name, p.name, c.id",
            ConfigurationRow::from_row,
        )?;
        let numbers = all(
            &tx,
            "SELECT * FROM numeric_research ORDER BY id",
            NumberRow::from_row,
        )?;
        let features = all(
            &tx,
            "SELECT e.configuration_id, f.metric_key, f.status, f.conditions, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM feature_observations f JOIN research_entries e ON e.id = f.entry_id JOIN sources s ON s.id = e.source_id ORDER BY f.id",
            FeatureRow::from_row,
        )?;
        let texts = all(
            &tx,
            "SELECT e.configuration_id, t.metric_key, t.value, t.conditions, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM text_observations t JOIN research_entries e ON e.id = t.entry_id JOIN sources s ON s.id = e.source_id ORDER BY t.id",
            TextRow::from_row,
        )?;
        let warranties = all(
            &tx,
            "SELECT e.configuration_id, w.*, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM warranty_terms w JOIN research_entries e ON e.id = w.entry_id JOIN sources s ON s.id = e.source_id ORDER BY w.id",
            WarrantyRow::from_row,
        )?;
        let offers = all(
            &tx,
            "SELECT e.configuration_id, o.*, e.observed_at_unix_s, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM offers o JOIN research_entries e ON e.id = o.entry_id JOIN sources s ON s.id = e.source_id ORDER BY o.id",
            OfferRow::from_row,
        )?;
        tx.commit()?;
        Ok(Comparison {
            configurations,
            numbers,
            features,
            texts,
            warranties,
            offers,
        })
    }

    /// Eén dossier, inclusief de claims, wordt volledig opgeslagen of teruggerold.
    pub async fn add_candidate(&self, draft: &CandidateDraft, now: i64) -> Result<i64> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let id = insert_candidate(&tx, draft, now)?;
        tx.commit()?;
        Ok(id)
    }

    /// Sleutels van de referentiesets die al in deze database zijn geladen.
    pub async fn reference_import_keys(&self) -> Result<Vec<String>> {
        let connection = self.connection();
        let mut statement = connection.prepare("SELECT key FROM reference_imports ORDER BY key")?;
        let keys = statement
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(keys)
    }

    /// Ingebouwde referenties laden; per sleutel idempotent.
    pub async fn import_references(
        &self,
        key: &str,
        drafts: &[CandidateDraft],
        now: i64,
    ) -> Result<bool> {
        let mut connection = self.connection();
        let tx = connection.transaction()?;
        let inserted = tx.execute(
            "INSERT INTO reference_imports (key, imported_at_unix_s) VALUES (?, ?) ON CONFLICT DO NOTHING",
            params![key, now],
        )?;
        if inserted == 0 {
            return Ok(false);
        }
        for draft in drafts {
            insert_candidate(&tx, draft, now)?;
        }
        tx.commit()?;
        Ok(true)
    }
}

fn insert_candidate(tx: &Transaction<'_>, d: &CandidateDraft, now: i64) -> Result<i64> {
    d.product_kind.parse::<ProductKind>()?;
    for text in [
        &d.manufacturer,
        &d.product,
        &d.configuration,
        &d.market,
        &d.source_title,
        &d.locator,
    ] {
        if text.trim().is_empty() || text.len() > 2000 {
            return Err(StorageError::InvalidInput(
                "Een verplicht tekstveld is leeg of langer dan 2000 tekens.".into(),
            ));
        }
    }
    if d.numbers.len() > 100 || d.features.len() > 50 || d.texts.len() > 50 {
        return Err(StorageError::InvalidInput(
            "Te veel claims in één dossier (maximaal 100 getallen, 50 kenmerken en 50 teksten)."
                .into(),
        ));
    }
    let id = |sql: &str, values: &[&dyn rusqlite::ToSql]| -> rusqlite::Result<i64> {
        tx.query_row(sql, values, |row| row.get(0))
    };
    let manufacturer_id = id(
        "INSERT INTO manufacturers (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = manufacturers.name RETURNING id",
        params![d.manufacturer.trim()],
    )?;
    let product_id = id(
        "INSERT INTO products (manufacturer_id, name, model_code, kind) VALUES (?, ?, ?, ?) ON CONFLICT(manufacturer_id, name, model_code) DO UPDATE SET name = products.name RETURNING id",
        params![
            manufacturer_id,
            d.product.trim(),
            d.model_code.trim(),
            d.product_kind
        ],
    )?;
    let existing_kind: String = tx.query_row(
        "SELECT kind FROM products WHERE id = ?",
        [product_id],
        |row| row.get(0),
    )?;
    if existing_kind != d.product_kind {
        return Err(StorageError::InvalidInput(
            "Dit product bestaat al met een ander producttype.".into(),
        ));
    }
    let config_id = id(
        "INSERT INTO configurations (product_id, name) VALUES (?, ?) ON CONFLICT(product_id, name, variant_code, hardware_revision) DO UPDATE SET name = configurations.name RETURNING id",
        params![product_id, d.configuration.trim()],
    )?;
    let url = if d.source_url.trim().is_empty() {
        format!("urn:thuisaccu:manual:{now}")
    } else {
        d.source_url.trim().to_owned()
    };
    let source_kind = d
        .source_kind
        .as_deref()
        .unwrap_or("other")
        .parse::<SourceKind>()?;
    let source_id = id(
        "INSERT INTO sources (kind, title, url, document_revision, published_on, retrieved_at_unix_s) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        params![
            source_kind.as_str(),
            d.source_title,
            url,
            d.document_revision,
            d.published_on,
            now
        ],
    )?;
    let entry_id = id(
        "INSERT INTO research_entries (configuration_id, source_id, locator, observed_at_unix_s, market, conditions) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        params![config_id, source_id, d.locator, now, d.market, d.conditions],
    )?;
    for n in &d.numbers {
        n.metric.parse::<NumericMetric>()?;
        n.qualifier.parse::<NumberQualifier>()?;
        n.boundary.parse::<MeasurementBoundary>()?;
        if !n.value.is_finite() || n.upper_value.is_some_and(|v| !v.is_finite()) {
            return Err(StorageError::NonFiniteNumber);
        }
        tx.execute("INSERT INTO numeric_observations (entry_id, metric_key, qualifier, value, upper_value, boundary, reported_value, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![entry_id, n.metric, n.qualifier, n.value, n.upper_value, n.boundary, n.reported_value, n.conditions])?;
    }
    for f in &d.features {
        f.metric.parse::<FeatureMetric>()?;
        f.status.parse::<FeatureStatus>()?;
        tx.execute("INSERT INTO feature_observations (entry_id, metric_key, status, conditions) VALUES (?, ?, ?, ?)",
            params![entry_id, f.metric, f.status, f.conditions])?;
    }
    for t in &d.texts {
        t.metric.parse::<TextMetric>()?;
        tx.execute("INSERT INTO text_observations (entry_id, metric_key, value, conditions) VALUES (?, ?, ?, ?)",
            params![entry_id, t.metric, t.value, t.conditions])?;
    }
    if let Some(months) = d.product_warranty_months {
        tx.execute("INSERT INTO warranty_terms (entry_id, product_months, limit_rule, application, exclusions) VALUES (?, ?, 'not_stated', 'Zie bron', 'Samenvatting; controleer de volledige garantievoorwaarden')",
            params![entry_id, months])?;
    }
    if let Some(p) = &d.price {
        tx.execute("INSERT INTO offers (entry_id, seller, currency, minor_unit_exponent, upfront_amount_minor, tax_basis, includes_installation, availability) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown')",
            params![entry_id, p.seller, p.currency, p.minor_unit_exponent, p.amount_minor, p.tax_basis, p.includes_installation])?;
    }
    Ok(config_id)
}
