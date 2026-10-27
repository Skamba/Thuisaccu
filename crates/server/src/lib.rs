//! HTTP-laag en ingebouwde webinterface, los van het serverproces testbaar.

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    routing::{delete, get, post},
};
#[cfg(not(target_family = "wasm"))]
use axum::{http::header, response::Html};
use serde::Serialize;
use thuisaccu_storage::Catalog;

mod api;
mod extract;
pub mod scenario_api;
pub mod solar_import;
pub mod typical_profile;

/// Bouwt de routes zonder een netwerkpoort te openen. In de browser (crates/browser) draait
/// dezelfde router als WebAssembly; de statische site levert daar de webbestanden.
pub fn app(catalog: Catalog) -> Router {
    let router = Router::new()
        .route("/api/v1/analysis/costs", get(scenario_api::costs))
        .route(
            "/api/v1/analysis/runs",
            get(scenario_api::history).post(scenario_api::run),
        )
        .route(
            "/api/v1/analysis/runs/{id}",
            get(scenario_api::saved_run).delete(scenario_api::delete_run),
        )
        .route(
            "/api/v1/analysis/runs/{id}/recalculate",
            post(scenario_api::recalculate),
        )
        .route("/api/v1/locations/search", post(scenario_api::address))
        .route("/api/v1/health", get(health))
        .route("/api/v1/backup", get(api::backup))
        .route("/api/v1/products", get(products))
        .route("/api/v1/comparison", get(api::comparison))
        .route("/api/v1/candidates", post(api::add_candidate))
        .route(
            "/api/v1/references",
            get(api::reference_status).post(api::references),
        )
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
        .route("/api/v1/solar/imports/{id}", delete(api::delete_solar))
        .route(
            "/api/v1/solar/imports/{id}/capacity",
            get(scenario_api::capacity_curve),
        )
        // Een omvormer- en een meterbestand van elk hoogstens 10 MB, plus de instellingen.
        .layer(DefaultBodyLimit::max(21 * 1024 * 1024));
    #[cfg(not(target_family = "wasm"))]
    let router = with_assets(router).layer(axum::middleware::from_fn(same_site));
    router
        .method_not_allowed_fallback(method_not_allowed)
        .fallback(not_found)
        .with_state(catalog)
}

/// Alleen verzoeken van deze app zelf. Een andere website kan zijn domeinnaam naar 127.0.0.1 laten
/// wijzen (DNS-rebinding) of formulieren naar de server sturen; daarom moet `Host` een IP-adres of
/// `localhost` zijn (een IP-adres houdt `LISTEN_ADDR=0.0.0.0:…` in het eigen netwerk bruikbaar), en
/// moet een wijziging met `Origin` van dezelfde host komen. In de browserversie is er geen netwerk.
#[cfg(not(target_family = "wasm"))]
async fn same_site(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::{http::Method, response::IntoResponse};
    let headers = request.headers();
    let text = |name| headers.get(name).and_then(|v| v.to_str().ok());
    let host = text(header::HOST);
    let host_ok = host.is_none_or(|host| {
        let name = host
            .rsplit_once(':')
            .filter(|(name, port)| !name.ends_with(':') && port.parse::<u16>().is_ok())
            .map_or(host, |(name, _)| name);
        name.eq_ignore_ascii_case("localhost")
            || name
                .trim_start_matches('[')
                .trim_end_matches(']')
                .parse::<std::net::IpAddr>()
                .is_ok()
    });
    let safe = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    let origin_ok = safe
        || text(header::ORIGIN).is_none_or(|origin| {
            host.is_some_and(|host| {
                origin
                    .split_once("://")
                    .is_some_and(|(_, rest)| rest.eq_ignore_ascii_case(host))
            })
        });
    if host_ok && origin_ok {
        return next.run(request).await;
    }
    tracing::warn!(
        ?host,
        origin = text(header::ORIGIN),
        "Verzoek van een andere website geweigerd"
    );
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({"error":"forbidden",
            "message":"Dit verzoek komt niet van Thuisaccu zelf en is geweigerd."})),
    )
        .into_response()
}

/// Rekenwerk en bestandsparsing buiten de async-runtime. In de browser is er geen thread-pool;
/// daar draait het werk direct (in een webworker, dus zonder de pagina te blokkeren).
/// Een paniek in het werk is een fout in Thuisaccu, geen invoerfout: HTTP 500 zonder details.
/// In de browser breekt een paniek de module af; `web/worker.js` start dan opnieuw.
pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, api::ApiError> {
    #[cfg(not(target_family = "wasm"))]
    return tokio::task::spawn_blocking(work).await.map_err(|error| {
        tracing::error!(%error, "Background work failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error":"internal_error",
                "message":"Er ging iets mis in Thuisaccu zelf; probeer het opnieuw."})),
        )
    });
    #[cfg(target_family = "wasm")]
    return Ok(work());
}

#[cfg(not(target_family = "wasm"))]
fn with_assets(router: Router<Catalog>) -> Router<Catalog> {
    ASSETS.iter().fold(
        router.route("/", get(index)),
        |router, &(path, body, kind)| {
            router.route(
                path,
                // De bestanden zitten in de binary; na een nieuwe versie moet de browser ze opnieuw ophalen.
                get(move || async move {
                    (
                        [
                            (header::CONTENT_TYPE, kind),
                            (header::CACHE_CONTROL, "no-cache"),
                        ],
                        body,
                    )
                }),
            )
        },
    )
}

#[cfg(not(target_family = "wasm"))]
const JS: &str = "text/javascript; charset=utf-8";

/// Ingebakken webbestanden: pad, inhoud en content-type. Een nieuw bestand in `web/` komt hier,
/// behalve `worker.js`: dat hoort alleen bij de browserversie (tools/build-site.sh).
#[cfg(not(target_family = "wasm"))]
const ASSETS: &[(&str, &str, &str)] = &[
    (
        "/styles.css",
        include_str!("../../../web/styles.css"),
        "text/css; charset=utf-8",
    ),
    ("/local.js", include_str!("../../../web/local.js"), JS),
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
    ("/compare.js", include_str!("../../../web/compare.js"), JS),
    ("/app.js", include_str!("../../../web/app.js"), JS),
];

#[cfg(not(target_family = "wasm"))]
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

/// Een bestaand adres met een andere methode; axum zet de `Allow`-header er zelf bij.
async fn method_not_allowed() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::METHOD_NOT_ALLOWED,
        Json(serde_json::json!({
            "error": "method_not_allowed",
            "message": "Deze methode wordt op dit adres niet ondersteund.",
        })),
    )
}

async fn not_found() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse { error: "not_found" }),
    )
}
