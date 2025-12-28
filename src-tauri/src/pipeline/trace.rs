// Pipeline progress tracing
// Append-only JSONL trace file for monitoring pipeline execution

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Errors that can occur during trace operations
#[derive(Debug, Error)]
pub enum TraceError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

/// A single trace entry in the pipeline execution log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEntry {
    /// ISO 8601 timestamp of when this entry was created
    pub timestamp: String,

    /// Pipeline stage name (e.g., "onset_detection", "classification", "quantization")
    pub stage: String,

    /// Progress percentage [0.0, 1.0]
    pub progress: f32,

    /// Human-readable message describing current operation
    pub message: String,

    /// Optional structured data (e.g., detected events count, timing info)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl TraceEntry {
    /// Create a new trace entry with current timestamp
    pub fn new(stage: String, progress: f32, message: String) -> Self {
        TraceEntry {
            timestamp: Utc::now().to_rfc3339(),
            stage,
            progress: progress.clamp(0.0, 1.0),
            message,
            data: None,
        }
    }

    /// Create a trace entry with structured data
    pub fn with_data(
        stage: String,
        progress: f32,
        message: String,
        data: serde_json::Value,
    ) -> Self {
        TraceEntry {
            timestamp: Utc::now().to_rfc3339(),
            stage,
            progress: progress.clamp(0.0, 1.0),
            message,
            data: Some(data),
        }
    }

    /// Serialize to JSON line (with newline)
    pub fn to_json_line(&self) -> Result<String, serde_json::Error> {
        let json = serde_json::to_string(self)?;
        Ok(format!("{}\n", json))
    }
}

/// Pipeline trace writer
/// Manages append-only JSONL trace file
pub struct TraceWriter {
    file_path: PathBuf,
}

impl TraceWriter {
    /// Create a new trace writer for a specific file
    pub fn new(file_path: PathBuf) -> Self {
        TraceWriter { file_path }
    }

    /// Append a trace entry to the file
    /// Creates file if it doesn't exist
    pub fn write(&self, entry: &TraceEntry) -> Result<(), TraceError> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)?;

        let json_line = entry.to_json_line()?;
        file.write_all(json_line.as_bytes())?;
        file.flush()?;

        Ok(())
    }

    /// Write multiple entries at once
    pub fn write_batch(&self, entries: &[TraceEntry]) -> Result<(), TraceError> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)?;

        for entry in entries {
            let json_line = entry.to_json_line()?;
            file.write_all(json_line.as_bytes())?;
        }

        file.flush()?;
        Ok(())
    }

    /// Get the trace file path
    pub fn path(&self) -> &Path {
        &self.file_path
    }
}

/// Helper builder for creating trace entries
pub struct TraceBuilder {
    stage: String,
}

impl TraceBuilder {
    /// Start building a trace entry for a stage
    pub fn stage(stage: impl Into<String>) -> Self {
        TraceBuilder {
            stage: stage.into(),
        }
    }

    /// Create a start entry (progress = 0.0)
    pub fn start(self, message: impl Into<String>) -> TraceEntry {
        TraceEntry::new(self.stage, 0.0, message.into())
    }

    /// Create a progress entry
    pub fn progress(self, progress: f32, message: impl Into<String>) -> TraceEntry {
        TraceEntry::new(self.stage, progress, message.into())
    }

    /// Create a complete entry (progress = 1.0)
    pub fn complete(self, message: impl Into<String>) -> TraceEntry {
        TraceEntry::new(self.stage, 1.0, message.into())
    }

    /// Create an entry with data
    pub fn with_data(
        self,
        progress: f32,
        message: impl Into<String>,
        data: serde_json::Value,
    ) -> TraceEntry {
        TraceEntry::with_data(self.stage, progress, message.into(), data)
    }
}

/// Read trace entries from a JSONL file
pub fn read_trace_file(path: &Path) -> Result<Vec<TraceEntry>, TraceError> {
    let contents = std::fs::read_to_string(path)?;
    let mut entries = Vec::new();

    for line in contents.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let entry: TraceEntry = serde_json::from_str(line)?;
        entries.push(entry);
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_trace_entry_creation() {
        let entry = TraceEntry::new(
            "test_stage".to_string(),
            0.5,
            "Processing".to_string(),
        );

        assert_eq!(entry.stage, "test_stage");
        assert_eq!(entry.progress, 0.5);
        assert_eq!(entry.message, "Processing");
        assert!(entry.data.is_none());
    }

    #[test]
    fn test_trace_entry_with_data() {
        let data = serde_json::json!({
            "count": 42,
            "duration_ms": 123.45
        });

        let entry = TraceEntry::with_data(
            "detection".to_string(),
            0.8,
            "Detected events".to_string(),
            data.clone(),
        );

        assert!(entry.data.is_some());
        assert_eq!(entry.data.unwrap()["count"], 42);
    }

    #[test]
    fn test_progress_clamping() {
        let entry1 = TraceEntry::new("test".to_string(), -0.5, "test".to_string());
        assert_eq!(entry1.progress, 0.0);

        let entry2 = TraceEntry::new("test".to_string(), 1.5, "test".to_string());
        assert_eq!(entry2.progress, 1.0);
    }

    #[test]
    fn test_trace_builder() {
        let entry = TraceBuilder::stage("processing")
            .progress(0.5, "Halfway done");

        assert_eq!(entry.stage, "processing");
        assert_eq!(entry.progress, 0.5);
        assert_eq!(entry.message, "Halfway done");
    }

    #[test]
    fn test_trace_builder_start_complete() {
        let start = TraceBuilder::stage("test").start("Starting");
        assert_eq!(start.progress, 0.0);

        let complete = TraceBuilder::stage("test").complete("Done");
        assert_eq!(complete.progress, 1.0);
    }

    #[test]
    fn test_trace_writer() {
        let temp_dir = TempDir::new().unwrap();
        let trace_path = temp_dir.path().join("trace.jsonl");

        let writer = TraceWriter::new(trace_path.clone());

        let entry1 = TraceEntry::new("stage1".to_string(), 0.0, "Start".to_string());
        let entry2 = TraceEntry::new("stage1".to_string(), 1.0, "Done".to_string());

        writer.write(&entry1).unwrap();
        writer.write(&entry2).unwrap();

        // Read back and verify
        let entries = read_trace_file(&trace_path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].stage, "stage1");
        assert_eq!(entries[0].progress, 0.0);
        assert_eq!(entries[1].progress, 1.0);
    }

    #[test]
    fn test_trace_writer_batch() {
        let temp_dir = TempDir::new().unwrap();
        let trace_path = temp_dir.path().join("trace.jsonl");

        let writer = TraceWriter::new(trace_path.clone());

        let entries = vec![
            TraceEntry::new("stage1".to_string(), 0.0, "Start".to_string()),
            TraceEntry::new("stage1".to_string(), 0.5, "Progress".to_string()),
            TraceEntry::new("stage1".to_string(), 1.0, "Done".to_string()),
        ];

        writer.write_batch(&entries).unwrap();

        // Read back and verify
        let read_entries = read_trace_file(&trace_path).unwrap();
        assert_eq!(read_entries.len(), 3);
    }

    #[test]
    fn test_json_line_format() {
        let entry = TraceEntry::new("test".to_string(), 0.5, "Testing".to_string());
        let json_line = entry.to_json_line().unwrap();

        // Should end with newline
        assert!(json_line.ends_with('\n'));

        // Should be valid JSON
        let trimmed = json_line.trim();
        let parsed: TraceEntry = serde_json::from_str(trimmed).unwrap();
        assert_eq!(parsed.stage, "test");
    }
}
