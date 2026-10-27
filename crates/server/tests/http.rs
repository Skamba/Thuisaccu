use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use thuisaccu_storage::Catalog;
use tower::ServiceExt;

async fn test_app() -> axum::Router {
    thuisaccu_server::app(Catalog::in_memory().await.unwrap())
}

#[tokio::test]
async fn health_reports_service_status_as_json() {
    let response = test_app()
        .await
        .oneshot(Request::get("/api/v1/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"status":"ok"}"#);
}

#[tokio::test]
async fn home_and_stylesheet_are_served_without_external_services() {
    let app = test_app().await;
    let response = app
        .clone()
        .oneshot(Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), 32 * 1024).await.unwrap();
    let html = std::str::from_utf8(&body).unwrap();
    // Relatieve paden: dezelfde shell werkt op de server en in een submap van een statische site.
    assert!(html.contains(r#"href="styles.css""#));
    assert!(html.contains(r#"data-backend="server""#));
    assert!(html.contains(r#"id="nav""#));
    assert!(html.contains(r#"id="view""#));
    assert!(
        !html.contains("https://"),
        "de shell laadt geen externe bronnen"
    );

    let response = app
        .oneshot(Request::get("/styles.css").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/css; charset=utf-8"
    );
    assert!(
        !to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn unknown_analysis_route_is_not_reported_as_success() {
    let response = test_app()
        .await
        .oneshot(
            Request::get("/api/v1/analysis")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"error":"not_found"}"#);
}

#[tokio::test]
async fn requests_from_other_websites_are_refused() {
    let app = test_app().await;
    let status = |method: &str, path: &str, headers: &[(&str, &str)]| {
        let mut request = Request::builder().method(method).uri(path);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let app = app.clone();
        let request = request
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Body::empty())
            .unwrap();
        async move { app.oneshot(request).await.unwrap().status() }
    };
    // DNS-rebinding: een eigen domeinnaam die naar 127.0.0.1 wijst.
    assert_eq!(
        status(
            "GET",
            "/api/v1/solar/imports",
            &[("host", "attacker.example:3000")]
        )
        .await,
        StatusCode::FORBIDDEN
    );
    for host in [
        "127.0.0.1:3000",
        "localhost:3000",
        "[::1]:3000",
        "192.168.1.20:3000",
    ] {
        assert_eq!(
            status("GET", "/api/v1/health", &[("host", host)]).await,
            StatusCode::OK,
            "{host}"
        );
    }
    // Een formulier of fetch van een andere site mag niets wijzigen; van de app zelf wel.
    let foreign = [
        ("host", "127.0.0.1:3000"),
        ("origin", "https://attacker.example"),
    ];
    assert_eq!(
        status("POST", "/api/v1/references", &foreign).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status(
            "POST",
            "/api/v1/references",
            &[("host", "127.0.0.1:3000"), ("origin", "null")]
        )
        .await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        status("DELETE", "/api/v1/solar/imports/1", &foreign).await,
        StatusCode::FORBIDDEN
    );
    let own = [
        ("host", "127.0.0.1:3000"),
        ("origin", "http://127.0.0.1:3000"),
    ];
    assert_eq!(
        status("POST", "/api/v1/references", &own).await,
        StatusCode::OK
    );
    // Alleen lezen met een vreemde Origin geeft de browser de inhoud niet (geen CORS-kop).
    assert_eq!(
        status("GET", "/api/v1/health", &foreign).await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_backup_downloads_the_database_as_a_sqlite_file() {
    let response = test_app()
        .await
        .oneshot(Request::get("/api/v1/backup").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/vnd.sqlite3"
    );
    let disposition = response.headers()[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        disposition.starts_with("attachment; filename=\"thuisaccu-")
            && disposition.ends_with(".sqlite3\""),
        "{disposition}"
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(body.starts_with(b"SQLite format 3\0"));
}

/// Afgewezen verzoeken (kapotte JSON, verkeerd type, geen JSON, ongeldig id, geen formulier)
/// krijgen dezelfde statuscode als in axum, maar een JSON-antwoord met een Nederlandse melding.
#[tokio::test]
async fn rejected_requests_are_answered_as_json() {
    let app = test_app().await;
    let json = |uri: &str, body: &'static str| {
        Request::post(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()
    };
    let cases = [
        (
            json("/api/v1/analysis/runs", "{"),
            StatusCode::BAD_REQUEST,
            "invalid_json",
        ),
        (
            json("/api/v1/locations/search", r#"{"query":12}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_json",
        ),
        (
            Request::post("/api/v1/locations/search")
                .header(header::CONTENT_TYPE, "text/plain")
                .body(Body::from("Binnenhof 1"))
                .unwrap(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
        ),
        (
            Request::get("/api/v1/analysis/runs/abc")
                .body(Body::empty())
                .unwrap(),
            StatusCode::BAD_REQUEST,
            "invalid_path",
        ),
        (
            json("/api/v1/solar/inspect", "{}"),
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
    ];
    for (request, status, error) in cases {
        let uri = request.uri().to_string();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), status, "{uri}");
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "application/json",
            "{uri}"
        );
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(body["error"], error, "{uri}");
        assert!(body["message"].as_str().is_some_and(|m| !m.is_empty()));
    }
}

#[tokio::test]
async fn health_rejects_unsupported_methods() {
    let response = test_app()
        .await
        .oneshot(Request::post("/api/v1/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(response.headers()["allow"], "GET,HEAD");
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap()).unwrap();
    assert_eq!(body["error"], "method_not_allowed");
    assert!(body["message"].as_str().is_some_and(|m| !m.is_empty()));
}

#[tokio::test]
async fn products_are_read_from_sqlite_without_seeding_real_products() {
    use thuisaccu_core::products::{Manufacturer, Product, ProductKind};

    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/products")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({"products": []})
    );

    let manufacturer_id = catalog
        .add_manufacturer(&Manufacturer {
            name: "Fixture maker".into(),
            website: None,
        })
        .await
        .unwrap();
    let id = catalog
        .add_product(&Product {
            manufacturer_id,
            name: "Fixture battery".into(),
            model_code: "TEST".into(),
            kind: ProductKind::BatterySystem,
        })
        .await
        .unwrap();
    let response = app
        .oneshot(
            Request::get("/api/v1/products")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({"products": [{
            "id": id, "manufacturer_id": manufacturer_id, "name": "Fixture battery", "model_code": "TEST", "kind": "battery_system"
        }]})
    );
}

#[tokio::test]
async fn database_failures_are_reported_without_leaking_internal_errors() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    // Een kapotte database: de tabel bestaat niet meer.
    catalog
        .connection()
        .execute_batch("ALTER TABLE products RENAME TO products_gone")
        .unwrap();
    let response = app
        .oneshot(
            Request::get("/api/v1/products")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    assert_eq!(body.as_ref(), br#"{"error":"database_error"}"#);
}

/// Elk script uit `web/` wordt met het juiste type uit de binary geserveerd en door de shell geladen.
#[tokio::test]
async fn every_browser_script_is_embedded_and_loaded_by_the_shell() {
    let app = test_app().await;
    let home = app
        .clone()
        .oneshot(Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let home = to_bytes(home.into_body(), 32 * 1024).await.unwrap();
    let home = std::str::from_utf8(&home).unwrap();
    for (path, marker) in [
        ("/local.js", "window.Local"),
        // Gegenereerd door tests/contract.rs, met de modelversie van de rekenkern.
        ("/contract.js", thuisaccu_core::analysis::MODEL_VERSION),
        ("/ui.js", "window.UI"),
        ("/data.js", "estimateCosts"),
        ("/results.js", "Wat betekent dit voor jou?"),
        ("/keuzehulp.js", "Bereken mijn advies"),
        ("/catalog.js", "Accu’s vergelijken"),
        ("/energy.js", "Bestand importeren"),
        ("/scenario.js", "Zelf doorrekenen"),
        ("/compare.js", "Berekeningen vergelijken"),
        ("/app.js", "Mijn berekeningen"),
    ] {
        assert!(
            home.contains(&format!(r#"src="{}""#, &path[1..])),
            "{path} niet geladen"
        );
        let response = app
            .clone()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/javascript; charset=utf-8"
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
        let body = to_bytes(response.into_body(), 256 * 1024).await.unwrap();
        let script = std::str::from_utf8(&body).unwrap();
        assert!(script.contains(marker), "{path} mist {marker}");
        // Gegevens gaan via tekstknopen in de DOM, nooit via innerHTML.
        assert!(!script.contains("innerHTML"), "{path} gebruikt innerHTML");
    }
    // De worker van de browserversie levert de server niet, maar hij volgt dezelfde regel.
    assert!(!include_str!("../../../web/worker.js").contains("innerHTML"));
}
