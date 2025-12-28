// File system operations for storing artifacts and data
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to get app data directory")]
    NoAppDataDir,
}

pub type StorageResult<T> = Result<T, StorageError>;

/// Get the app data directory for Beatrice
pub fn get_app_data_dir() -> StorageResult<PathBuf> {
    let data_dir = dirs::data_dir().ok_or(StorageError::NoAppDataDir)?;
    let beatrice_dir = data_dir.join("com.beatrice.app");
    fs::create_dir_all(&beatrice_dir)?;
    Ok(beatrice_dir)
}

/// Get the directory for a specific project
pub fn get_project_dir(project_id: &Uuid) -> StorageResult<PathBuf> {
    let app_dir = get_app_data_dir()?;
    let project_dir = app_dir.join("projects").join(project_id.to_string());
    fs::create_dir_all(&project_dir)?;
    Ok(project_dir)
}

/// Get the directory for a specific run within a project
pub fn get_run_dir(project_id: &Uuid, run_id: &Uuid) -> StorageResult<PathBuf> {
    let project_dir = get_project_dir(project_id)?;
    let run_dir = project_dir.join("runs").join(run_id.to_string());
    fs::create_dir_all(&run_dir)?;
    Ok(run_dir)
}

/// Get the calibration profiles directory
pub fn get_calibration_dir() -> StorageResult<PathBuf> {
    let app_dir = get_app_data_dir()?;
    let calibration_dir = app_dir.join("calibration");
    fs::create_dir_all(&calibration_dir)?;
    Ok(calibration_dir)
}

/// Store a file in the appropriate location and return its path and SHA256 hash
pub fn store_file(
    project_id: &Uuid,
    run_id: Option<&Uuid>,
    filename: &str,
    data: &[u8],
) -> StorageResult<(PathBuf, String)> {
    let dir = if let Some(run_id) = run_id {
        get_run_dir(project_id, run_id)?
    } else {
        get_project_dir(project_id)?
    };

    let file_path = dir.join(filename);
    let mut file = fs::File::create(&file_path)?;
    file.write_all(data)?;

    // Calculate SHA256
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = hex::encode(hasher.finalize());

    Ok((file_path, hash))
}

/// Store a calibration profile and return its path and SHA256 hash
pub fn store_calibration_profile(
    profile_id: &Uuid,
    filename: &str,
    data: &[u8],
) -> StorageResult<(PathBuf, String)> {
    let dir = get_calibration_dir()?;
    let file_path = dir.join(format!("{}_{}", profile_id, filename));

    let mut file = fs::File::create(&file_path)?;
    file.write_all(data)?;

    // Calculate SHA256
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = hex::encode(hasher.finalize());

    Ok((file_path, hash))
}

/// Read a file from disk
pub fn read_file(path: &str) -> StorageResult<Vec<u8>> {
    Ok(fs::read(path)?)
}

/// Calculate SHA256 hash of data
pub fn calculate_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_sha256() {
        let data = b"hello world";
        let hash = calculate_sha256(data);
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }
}
