// State management module
// Handles SQLite persistence and file system operations

pub mod db;
pub mod models;
pub mod queries;
pub mod storage;

pub use db::{init_db, DbConnection};
pub use models::{
    Artifact, ArtifactKind, CalibrationProfile, Project, ProjectSummary, Run, RunStatus,
    RunWithArtifacts,
};
pub use queries::{
    create_artifact, create_calibration_profile, create_project, create_run,
    delete_calibration_profile, get_calibration_profile, get_project,
    get_run, list_calibration_profiles, list_projects, list_runs_for_project,
    update_calibration_profile, update_run_status,
};
