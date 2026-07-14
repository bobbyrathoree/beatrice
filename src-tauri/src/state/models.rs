// Data models for Beatrice state management
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Project {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub name: String,
    pub input_path: String,
    pub input_sha256: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Run {
    pub id: Uuid,
    pub project_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub pipeline_version: String,
    pub theme: String,
    pub bpm: f64,
    pub swing: f64,
    pub quantize_strength: f64,
    pub b_emphasis: f64,
    pub status: RunStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Pending,
    Processing,
    Complete,
    Failed,
}

impl fmt::Display for RunStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            RunStatus::Pending => "pending",
            RunStatus::Processing => "processing",
            RunStatus::Complete => "complete",
            RunStatus::Failed => "failed",
        };
        write!(f, "{}", s)
    }
}

impl RunStatus {
    pub fn from_string(s: &str) -> Self {
        match s {
            "pending" => RunStatus::Pending,
            "processing" => RunStatus::Processing,
            "complete" => RunStatus::Complete,
            "failed" => RunStatus::Failed,
            _ => RunStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Artifact {
    pub id: Uuid,
    pub run_id: Uuid,
    pub kind: ArtifactKind,
    pub path: String,
    pub sha256: String,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Midi,
    Audio,
    Visualization,
    Metadata,
}

impl fmt::Display for ArtifactKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ArtifactKind::Midi => "midi",
            ArtifactKind::Audio => "audio",
            ArtifactKind::Visualization => "visualization",
            ArtifactKind::Metadata => "metadata",
        };
        write!(f, "{}", s)
    }
}

impl ArtifactKind {
    pub fn from_string(s: &str) -> Self {
        match s {
            "midi" => ArtifactKind::Midi,
            "audio" => ArtifactKind::Audio,
            "visualization" => ArtifactKind::Visualization,
            "metadata" => ArtifactKind::Metadata,
            _ => ArtifactKind::Metadata,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CalibrationProfile {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub profile_json_path: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub run_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RunWithArtifacts {
    pub run: Run,
    pub artifacts: Vec<Artifact>,
}
