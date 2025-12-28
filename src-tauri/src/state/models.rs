// Data models for Beatrice state management
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub name: String,
    pub input_path: String,
    pub input_sha256: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Pending,
    Processing,
    Complete,
    Failed,
}

impl RunStatus {
    pub fn to_string(&self) -> String {
        match self {
            RunStatus::Pending => "pending".to_string(),
            RunStatus::Processing => "processing".to_string(),
            RunStatus::Complete => "complete".to_string(),
            RunStatus::Failed => "failed".to_string(),
        }
    }

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub id: Uuid,
    pub run_id: Uuid,
    pub kind: ArtifactKind,
    pub path: String,
    pub sha256: String,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactKind {
    Midi,
    Audio,
    Visualization,
    Metadata,
}

impl ArtifactKind {
    pub fn to_string(&self) -> String {
        match self {
            ArtifactKind::Midi => "midi".to_string(),
            ArtifactKind::Audio => "audio".to_string(),
            ArtifactKind::Visualization => "visualization".to_string(),
            ArtifactKind::Metadata => "metadata".to_string(),
        }
    }

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationProfile {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub profile_json_path: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub duration_ms: i64,
    pub run_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunWithArtifacts {
    pub run: Run,
    pub artifacts: Vec<Artifact>,
}
