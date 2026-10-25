//! Ingebakken migraties, compatibel met de tabel `_sqlx_migrations` die eerdere versies (SQLx)
//! hebben aangelegd: dezelfde versies, omschrijvingen en SHA-384-controlegetallen van de SQL.

use rusqlite::{Connection, params};
use sha2::{Digest, Sha384};

use crate::{Result, StorageError};

/// Versie, omschrijving en SQL. Wijzig nooit een bestaande migratie; voeg een nieuwe toe.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "research catalog",
        include_str!("../migrations/0001_research_catalog.sql"),
    ),
    (
        2,
        "solar imports",
        include_str!("../migrations/0002_solar_imports.sql"),
    ),
    (
        3,
        "analysis runs",
        include_str!("../migrations/0003_analysis_runs.sql"),
    ),
];

fn checksum(sql: &str) -> Vec<u8> {
    Sha384::digest(sql.as_bytes()).to_vec()
}

pub(crate) fn run(connection: &mut Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
);",
    )?;
    let applied: Vec<(i64, bool, Vec<u8>)> = connection
        .prepare("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (version, success, stored) in &applied {
        let Some((_, _, sql)) = MIGRATIONS.iter().find(|(v, _, _)| v == version) else {
            return Err(StorageError::Migration(format!(
                "database bevat onbekende migratie {version}; gebruik een nieuwere versie van Thuisaccu"
            )));
        };
        if !success {
            return Err(StorageError::Migration(format!(
                "migratie {version} is eerder half uitgevoerd"
            )));
        }
        if *stored != checksum(sql) {
            return Err(StorageError::Migration(format!(
                "migratie {version} is gewijzigd nadat hij is toegepast"
            )));
        }
    }
    for (version, description, sql) in MIGRATIONS {
        if applied.iter().any(|(v, _, _)| v == version) {
            continue;
        }
        // De uitvoeringstijd wordt niet gemeten: in de browser heeft `std` geen klok.
        let tx = connection.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?, ?, TRUE, ?, 0)",
            params![version, description, checksum(sql)],
        )?;
        tx.commit()?;
    }
    Ok(())
}
