// SQLite database setup and migrations
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use thiserror::Error;

use super::storage::{get_app_data_dir, StorageError};

#[derive(Debug, Error)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("Database initialization failed: {0}")]
    InitFailed(String),
}

pub type DbResult<T> = Result<T, DbError>;

// Thread-safe database connection wrapper
pub struct DbConnection {
    conn: Arc<Mutex<Connection>>,
}

impl DbConnection {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }
}

impl Clone for DbConnection {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
        }
    }
}

/// Initialize the database at the app data directory
pub fn init_db() -> DbResult<DbConnection> {
    let app_data_dir = get_app_data_dir()?;
    let db_path = app_data_dir.join("beatrice.db");

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&db_path)?;

    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON", [])?;

    // Run migrations
    run_migrations(&conn)?;

    Ok(DbConnection::new(conn))
}

fn run_migrations(conn: &Connection) -> DbResult<()> {
    // Create migrations table if it doesn't exist
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Get current version
    let current_version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Apply migrations
    if current_version < 1 {
        migration_v1(conn)?;
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            [1],
        )?;
    }

    Ok(())
}

fn migration_v1(conn: &Connection) -> DbResult<()> {
    // Projects table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            name TEXT NOT NULL,
            input_path TEXT NOT NULL,
            input_sha256 TEXT NOT NULL,
            duration_ms INTEGER NOT NULL
        )",
        [],
    )?;

    // Create index on created_at for efficient sorting
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC)",
        [],
    )?;

    // Runs table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            pipeline_version TEXT NOT NULL,
            theme TEXT NOT NULL,
            bpm REAL NOT NULL,
            swing REAL NOT NULL,
            quantize_strength REAL NOT NULL,
            b_emphasis REAL NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create indexes for runs
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC)",
        [],
    )?;

    // Artifacts table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            path TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create index on run_id for efficient artifact lookup
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id)",
        [],
    )?;

    // Calibration profiles table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS calibration_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            profile_json_path TEXT NOT NULL,
            notes TEXT
        )",
        [],
    )?;

    // Create index on created_at
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_calibration_profiles_created_at ON calibration_profiles(created_at DESC)",
        [],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_init() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Verify tables exist
        let table_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('projects', 'runs', 'artifacts', 'calibration_profiles')",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(table_count, 4);
    }
}
