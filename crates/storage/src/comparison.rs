//! Leesmodel voor de vergelijking en atomische invoer van een onderzoeksdossier.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use thuisaccu_core::products::{
    FeatureMetric, FeatureStatus, MeasurementBoundary, NumberQualifier, NumericMetric, ProductKind,
    SourceKind, TextMetric,
};

use crate::{Catalog, Result, StorageError};

#[derive(Debug, Serialize, FromRow)]
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

#[derive(Debug, Serialize, FromRow)]
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

#[derive(Debug, Serialize, FromRow)]
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

#[derive(Debug, Serialize, FromRow)]
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

#[derive(Debug, Serialize, FromRow)]
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

#[derive(Debug, Serialize, FromRow)]
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

impl Catalog {
    pub async fn comparison(&self) -> Result<Comparison> {
        let mut tx = self.pool().begin().await?;
        let configurations = sqlx::query_as("SELECT c.id, c.product_id, c.name, c.hardware_revision, p.name AS product_name, p.model_code, p.kind AS product_kind, m.name AS manufacturer_name FROM configurations c JOIN products p ON p.id = c.product_id JOIN manufacturers m ON m.id = p.manufacturer_id ORDER BY m.name, p.name, c.id").fetch_all(&mut *tx).await?;
        let numbers = sqlx::query_as("SELECT * FROM numeric_research ORDER BY id")
            .fetch_all(&mut *tx)
            .await?;
        let features = sqlx::query_as("SELECT e.configuration_id, f.metric_key, f.status, f.conditions, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM feature_observations f JOIN research_entries e ON e.id = f.entry_id JOIN sources s ON s.id = e.source_id ORDER BY f.id").fetch_all(&mut *tx).await?;
        let texts = sqlx::query_as("SELECT e.configuration_id, t.metric_key, t.value, t.conditions, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM text_observations t JOIN research_entries e ON e.id = t.entry_id JOIN sources s ON s.id = e.source_id ORDER BY t.id").fetch_all(&mut *tx).await?;
        let warranties = sqlx::query_as("SELECT e.configuration_id, w.*, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM warranty_terms w JOIN research_entries e ON e.id = w.entry_id JOIN sources s ON s.id = e.source_id ORDER BY w.id").fetch_all(&mut *tx).await?;
        let offers = sqlx::query_as("SELECT e.configuration_id, o.*, e.observed_at_unix_s, s.url AS source_url, s.title AS source_title, e.review_status, e.market FROM offers o JOIN research_entries e ON e.id = o.entry_id JOIN sources s ON s.id = e.source_id ORDER BY o.id").fetch_all(&mut *tx).await?;
        tx.commit().await?;
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
        let mut tx = self.pool().begin().await?;
        let id = insert_candidate(&mut tx, draft, now).await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Expliciet door de gebruiker geladen referenties; per sleutel idempotent.
    pub async fn import_references(
        &self,
        key: &str,
        drafts: &[CandidateDraft],
        now: i64,
    ) -> Result<bool> {
        let mut tx = self.pool().begin().await?;
        let inserted = sqlx::query("INSERT INTO reference_imports (key, imported_at_unix_s) VALUES (?, ?) ON CONFLICT DO NOTHING")
            .bind(key).bind(now).execute(&mut *tx).await?.rows_affected();
        if inserted == 0 {
            tx.rollback().await?;
            return Ok(false);
        }
        for draft in drafts {
            insert_candidate(&mut tx, draft, now).await?;
        }
        tx.commit().await?;
        Ok(true)
    }
}

async fn insert_candidate(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    d: &CandidateDraft,
    now: i64,
) -> Result<i64> {
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
                "Required text is empty or too long".into(),
            ));
        }
    }
    if d.numbers.len() > 100 || d.features.len() > 50 || d.texts.len() > 50 {
        return Err(StorageError::InvalidInput("Too many claims".into()));
    }
    let manufacturer_id: i64 = sqlx::query_scalar("INSERT INTO manufacturers (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = manufacturers.name RETURNING id")
        .bind(d.manufacturer.trim()).fetch_one(&mut **tx).await?;
    let product_id: i64 = sqlx::query_scalar("INSERT INTO products (manufacturer_id, name, model_code, kind) VALUES (?, ?, ?, ?) ON CONFLICT(manufacturer_id, name, model_code) DO UPDATE SET name = products.name RETURNING id")
        .bind(manufacturer_id).bind(d.product.trim()).bind(d.model_code.trim()).bind(&d.product_kind).fetch_one(&mut **tx).await?;
    let existing_kind: String = sqlx::query_scalar("SELECT kind FROM products WHERE id = ?")
        .bind(product_id)
        .fetch_one(&mut **tx)
        .await?;
    if existing_kind != d.product_kind {
        return Err(StorageError::InvalidInput(
            "Existing product has a different kind".into(),
        ));
    }
    let config_id: i64 = sqlx::query_scalar("INSERT INTO configurations (product_id, name) VALUES (?, ?) ON CONFLICT(product_id, name, variant_code, hardware_revision) DO UPDATE SET name = configurations.name RETURNING id")
        .bind(product_id).bind(d.configuration.trim()).fetch_one(&mut **tx).await?;
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
    let source_id: i64 = sqlx::query_scalar("INSERT INTO sources (kind, title, url, document_revision, published_on, retrieved_at_unix_s) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(source_kind.as_str()).bind(&d.source_title).bind(url).bind(&d.document_revision).bind(&d.published_on).bind(now).fetch_one(&mut **tx).await?;
    let entry_id: i64 = sqlx::query_scalar("INSERT INTO research_entries (configuration_id, source_id, locator, observed_at_unix_s, market, conditions) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(config_id).bind(source_id).bind(&d.locator).bind(now).bind(&d.market).bind(&d.conditions).fetch_one(&mut **tx).await?;
    for n in &d.numbers {
        n.metric.parse::<NumericMetric>()?;
        n.qualifier.parse::<NumberQualifier>()?;
        n.boundary.parse::<MeasurementBoundary>()?;
        if !n.value.is_finite() || n.upper_value.is_some_and(|v| !v.is_finite()) {
            return Err(StorageError::NonFiniteNumber);
        }
        sqlx::query("INSERT INTO numeric_observations (entry_id, metric_key, qualifier, value, upper_value, boundary, reported_value, conditions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(entry_id).bind(&n.metric).bind(&n.qualifier).bind(n.value).bind(n.upper_value).bind(&n.boundary).bind(&n.reported_value).bind(&n.conditions).execute(&mut **tx).await?;
    }
    for f in &d.features {
        f.metric.parse::<FeatureMetric>()?;
        f.status.parse::<FeatureStatus>()?;
        sqlx::query("INSERT INTO feature_observations (entry_id, metric_key, status, conditions) VALUES (?, ?, ?, ?)")
            .bind(entry_id).bind(&f.metric).bind(&f.status).bind(&f.conditions).execute(&mut **tx).await?;
    }
    for t in &d.texts {
        t.metric.parse::<TextMetric>()?;
        sqlx::query("INSERT INTO text_observations (entry_id, metric_key, value, conditions) VALUES (?, ?, ?, ?)")
            .bind(entry_id).bind(&t.metric).bind(&t.value).bind(&t.conditions).execute(&mut **tx).await?;
    }
    if let Some(months) = d.product_warranty_months {
        sqlx::query("INSERT INTO warranty_terms (entry_id, product_months, limit_rule, application, exclusions) VALUES (?, ?, 'not_stated', 'Zie bron', 'Samenvatting; controleer de volledige garantievoorwaarden')")
            .bind(entry_id).bind(months).execute(&mut **tx).await?;
    }
    if let Some(p) = &d.price {
        sqlx::query("INSERT INTO offers (entry_id, seller, currency, minor_unit_exponent, upfront_amount_minor, tax_basis, includes_installation, availability) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown')")
            .bind(entry_id).bind(&p.seller).bind(&p.currency).bind(p.minor_unit_exponent).bind(p.amount_minor).bind(&p.tax_basis).bind(p.includes_installation).execute(&mut **tx).await?;
    }
    Ok(config_id)
}
