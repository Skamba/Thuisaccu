use std::{env, error::Error, net::SocketAddr, path::PathBuf};
use thuisaccu_storage::Catalog;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let filter = match env::var("RUST_LOG") {
        Ok(value) => EnvFilter::try_new(value)?,
        Err(env::VarError::NotPresent) => EnvFilter::new("info"),
        Err(error) => return Err(error.into()),
    };
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let address: SocketAddr = match env::var("LISTEN_ADDR") {
        Ok(value) => value.parse()?,
        Err(env::VarError::NotPresent) => "127.0.0.1:3000".parse()?,
        Err(error) => return Err(error.into()),
    };

    let database_path = env::var_os("DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("data/research.sqlite3"));
    let catalog = Catalog::open(&database_path).await?;
    tracing::info!(path = %database_path.display(), "SQLite-onderzoekscatalogus gereed");

    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(address = %listener.local_addr()?, "Thuisaccu webserver gestart");

    let result = axum::serve(listener, thuisaccu_server::app(catalog.clone()))
        .with_graceful_shutdown(shutdown_signal())
        .await;
    catalog.close().await;
    result?;
    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "Kon het afsluitsignaal niet registreren");
    }
}
