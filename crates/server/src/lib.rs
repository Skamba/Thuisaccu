//! HTTP-laag en ingebouwde webinterface, los van het serverproces testbaar.

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{StatusCode, header},
    response::Html,
    routing::{get, post},
};
use serde::Serialize;
use thuisaccu_storage::Catalog;

mod api;
pub mod scenario_api;
pub mod solar_import;
pub mod typical_profile;

/// Bouwt de routes zonder een netwerkpoort te openen.
pub fn app(catalog: Catalog) -> Router {
    let assets = ASSETS
        .iter()
        .fold(Router::new(), |router, &(path, body, kind)| {
            router.route(
                path,
                get(move || async move { ([(header::CONTENT_TYPE, kind)], body) }),
            )
        });
    assets
        .route("/", get(index))
        .route("/api/v1/analysis/costs", get(scenario_api::costs))
        .route(
            "/api/v1/analysis/runs",
            get(scenario_api::history).post(scenario_api::run),
        )
        .route("/api/v1/locations/search", post(scenario_api::address))
        .route("/api/v1/health", get(health))
        .route("/api/v1/products", get(products))
        .route("/api/v1/comparison", get(api::comparison))
        .route("/api/v1/candidates", post(api::add_candidate))
        .route("/api/v1/references", post(api::references))
        .route("/api/v1/solar/inspect", post(api::inspect))
        .route("/api/v1/solar/preview", post(api::preview))
        .route(
            "/api/v1/solar/typical",
            get(api::typical_sources).post(api::save_typical),
        )
        .route(
            "/api/v1/solar/imports",
            get(api::list_solar).post(api::save_solar),
        )
        .route(
            "/api/v1/solar/imports/{id}/capacity",
            get(scenario_api::capacity_curve),
        )
        .layer(DefaultBodyLimit::max(11 * 1024 * 1024))
        .fallback(not_found)
        .with_state(catalog)
}

const JS: &str = "text/javascript; charset=utf-8";

/// Ingebakken webbestanden: pad, inhoud en content-type. Een nieuw bestand in `web/` komt hier.
const ASSETS: &[(&str, &str, &str)] = &[
    (
        "/styles.css",
        include_str!("../../../web/styles.css"),
        "text/css; charset=utf-8",
    ),
    ("/ui.js", include_str!("../../../web/ui.js"), JS),
    ("/data.js", include_str!("../../../web/data.js"), JS),
    ("/results.js", include_str!("../../../web/results.js"), JS),
    (
        "/keuzehulp.js",
        include_str!("../../../web/keuzehulp.js"),
        JS,
    ),
    ("/catalog.js", include_str!("../../../web/catalog.js"), JS),
    ("/energy.js", include_str!("../../../web/energy.js"), JS),
    ("/scenario.js", include_str!("../../../web/scenario.js"), JS),
    ("/app.js", include_str!("../../../web/app.js"), JS),
];

async fn index() -> Html<&'static str> {
    Html(include_str!("../../../web/index.html"))
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}

#[derive(Serialize)]
struct ProductResponse {
    id: i64,
    manufacturer_id: i64,
    name: String,
    model_code: String,
    kind: &'static str,
}

#[derive(Serialize)]
struct ProductsResponse {
    products: Vec<ProductResponse>,
}

async fn products(
    State(catalog): State<Catalog>,
) -> Result<Json<ProductsResponse>, (StatusCode, Json<ErrorResponse>)> {
    let records = catalog.list_products().await.map_err(|error| {
        tracing::error!(%error, "Kon producten niet ophalen");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database_error",
            }),
        )
    })?;
    Ok(Json(ProductsResponse {
        products: records
            .into_iter()
            .map(|record| ProductResponse {
                id: record.id,
                manufacturer_id: record.data.manufacturer_id,
                name: record.data.name,
                model_code: record.data.model_code,
                kind: record.data.kind.as_str(),
            })
            .collect(),
    }))
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
}

async fn not_found() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse { error: "not_found" }),
    )
}
