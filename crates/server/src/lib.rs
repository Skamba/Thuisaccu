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
    Router::new()
        .route("/", get(index))
        .route("/styles.css", get(styles))
        .route("/app.js", get(script))
        .route("/ui.js", get(ui_script))
        .route("/workspace.js", get(workspace_script))
        .route("/results.js", get(results_script))
        .route("/analysis.js", get(analysis_script))
        .route("/keuzehulp.js", get(keuzehulp_script))
        .route("/api/v1/analysis/costs", get(scenario_api::costs))
        .route(
            "/api/v1/analysis/runs",
            get(scenario_api::history).post(scenario_api::run),
        )
        .route("/api/v1/analysis/demo", post(scenario_api::demo))
        .route("/api/v1/locations/search", post(scenario_api::address))
        .route("/samples/solar.csv", get(sample_csv))
        .route("/samples/solar.json", get(sample_json))
        .route("/samples/solar.xlsx", get(sample_xlsx))
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

async fn index() -> Html<&'static str> {
    Html(include_str!("../../../web/index.html"))
}

async fn styles() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../../../web/styles.css"),
    )
}

async fn script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../web/app.js"),
    )
}

async fn ui_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../web/ui.js"),
    )
}

async fn workspace_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../web/workspace.js"),
    )
}

async fn results_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../web/results.js"),
    )
}

async fn analysis_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../web/analysis.js"),
    )
}

async fn keuzehulp_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../web/keuzehulp.js"),
    )
}

async fn sample_csv() -> ([(header::HeaderName, &'static str); 2], &'static str) {
    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=solar-example.csv",
            ),
        ],
        include_str!("../resources/solar-example.csv"),
    )
}

async fn sample_xlsx() -> ([(header::HeaderName, &'static str); 2], &'static [u8]) {
    (
        [
            (
                header::CONTENT_TYPE,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=solar-example.xlsx",
            ),
        ],
        include_bytes!("../resources/solar-example.xlsx"),
    )
}

async fn sample_json() -> ([(header::HeaderName, &'static str); 2], &'static str) {
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=solar-example.json",
            ),
        ],
        include_str!("../resources/solar-example.json"),
    )
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
