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
        .with_graceful_shutdown(shutdown_signal(catalog.clone()))
        .await;
    catalog.close().await;
    result?;
    Ok(())
}

/// Ctrl+C, maar ook het consolevenster sluiten, afmelden of afsluiten (Windows) en SIGTERM of SIGHUP
/// (Unix). Direct daarna gaat het WAL-bestand terug in de database: Windows beëindigt het proces na
/// een paar seconden, ook als er nog verbindingen open zijn.
async fn shutdown_signal(catalog: Catalog) {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "Kon het afsluitsignaal niet registreren");
            std::future::pending::<()>().await;
        }
    };
    tokio::select! {
        () = ctrl_c => {}
        () = terminate() => {}
    }
    tracing::info!("Thuisaccu wordt afgesloten");
    catalog.close().await;
}

#[cfg(windows)]
async fn terminate() {
    use tokio::signal::windows;
    match (
        windows::ctrl_close(),
        windows::ctrl_shutdown(),
        windows::ctrl_logoff(),
    ) {
        (Ok(mut close), Ok(mut shutdown), Ok(mut logoff)) => {
            tokio::select! {
                _ = close.recv() => {}
                _ = shutdown.recv() => {}
                _ = logoff.recv() => {}
            }
        }
        _ => std::future::pending().await,
    }
}

#[cfg(unix)]
async fn terminate() {
    use tokio::signal::unix::{SignalKind, signal};
    match (
        signal(SignalKind::terminate()),
        signal(SignalKind::hangup()),
    ) {
        (Ok(mut term), Ok(mut hangup)) => {
            tokio::select! {
                _ = term.recv() => {}
                _ = hangup.recv() => {}
            }
        }
        _ => std::future::pending().await,
    }
}

#[cfg(not(any(windows, unix)))]
async fn terminate() {
    std::future::pending().await
}
