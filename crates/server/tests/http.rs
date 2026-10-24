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
    assert!(html.contains("/styles.css"));
    assert!(html.contains(r#"id="solar-file""#));
    assert!(html.contains("/app.js"));
    assert!(!html.contains("analysis-demo"));
    assert!(!html.contains("/samples/"));

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
        !to_bytes(response.into_body(), 32 * 1024)
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
async fn health_rejects_unsupported_methods() {
    let response = test_app()
        .await
        .oneshot(Request::post("/api/v1/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
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
    catalog.close().await;
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

#[tokio::test]
async fn shared_browser_helpers_are_embedded() {
    let response = test_app()
        .await
        .oneshot(Request::get("/ui.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    assert!(std::str::from_utf8(&body).unwrap().contains("formatMoney"));
}

#[tokio::test]
async fn workspace_screens_are_embedded() {
    let response = test_app()
        .await
        .oneshot(Request::get("/workspace.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    assert!(
        std::str::from_utf8(&body)
            .unwrap()
            .contains("Recente analyses")
    );
}

#[tokio::test]
async fn result_dashboard_is_embedded() {
    let response = test_app()
        .await
        .oneshot(Request::get("/results.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    assert!(
        std::str::from_utf8(&body)
            .unwrap()
            .contains("Cumulatieve kasstroom")
    );
}

#[tokio::test]
async fn guided_flow_is_embedded_and_linked() {
    let app = test_app().await;
    let response = app
        .clone()
        .oneshot(Request::get("/keuzehulp.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
    assert!(
        std::str::from_utf8(&body)
            .unwrap()
            .contains("Bereken mijn advies")
    );
    let home = app
        .oneshot(Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = to_bytes(home.into_body(), 32 * 1024).await.unwrap();
    assert!(
        std::str::from_utf8(&body)
            .unwrap()
            .contains("/keuzehulp.js")
    );
}
