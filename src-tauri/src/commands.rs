// Tauri IPC Commands
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::arranger::{self, ArrangementTemplate, Arrangement, MidiExportOptions};
use crate::audio::{self, OnsetConfig};
use crate::events::{self, ClassScore, Event, EventClass, EventDecision, EventFeatures};
use crate::groove::{self, TempoEstimate, Grid, GridDivision, GrooveFeel, TimeSignature, QuantizeSettings, QuantizedEvent};
use crate::pipeline::{TraceBuilder, TraceWriter};
use crate::state::{
    self, ArtifactKind, CalibrationProfile, DbConnection, Project, ProjectSummary, Run,
    RunStatus, RunWithArtifacts,
};

#[derive(Debug, Serialize, specta::Type)]
pub struct CommandError {
    message: String,
}

impl<E: std::fmt::Display> From<E> for CommandError {
    fn from(error: E) -> Self {
        CommandError {
            message: error.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Beatrice.", name)
}

// ==================== PROJECT COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct CreateProjectInput {
    pub name: String,
    pub input_data: Vec<u8>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_project(
    db: State<'_, DbConnection>,
    input: CreateProjectInput,
) -> CommandResult<Project> {
    // Ingest audio to extract metadata and validate format
    let audio_data = crate::audio::ingest_wav(&input.input_data)
        .map_err(|e| CommandError {
            message: format!("Failed to process audio file: {}", e),
        })?;

    // Calculate hash
    let input_sha256 = state::storage::calculate_sha256(&input.input_data);

    // Store the input file
    let project_id = Uuid::new_v4();
    let (input_path, _) =
        state::storage::store_file(&project_id, None, "input.wav", &input.input_data)
            .map_err(CommandError::from)?;

    // Use audio metadata for duration
    let duration_ms = audio_data.duration_ms;

    log::info!(
        "Created project: {} Hz, {} channels, {} bit, {} ms",
        audio_data.sample_rate,
        audio_data.channels,
        audio_data.bit_depth,
        duration_ms
    );

    let project = state::create_project(
        &db,
        project_id,
        input.name,
        input_path.to_string_lossy().to_string(),
        input_sha256,
        duration_ms,
    )
    .map_err(CommandError::from)?;

    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn get_project(db: State<'_, DbConnection>, id: String) -> CommandResult<Option<Project>> {
    let uuid = Uuid::parse_str(&id).map_err(CommandError::from)?;
    state::get_project(&db, &uuid).map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn list_projects(db: State<'_, DbConnection>) -> CommandResult<Vec<ProjectSummary>> {
    state::list_projects(&db).map_err(CommandError::from)
}

// ==================== RUN COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct CreateRunInput {
    pub project_id: String,
    pub pipeline_version: String,
    pub theme: String,
    pub bpm: f64,
    pub swing: f64,
    pub quantize_strength: f64,
    pub b_emphasis: f64,
    /// Tempo phase offset (ms). Optional for backward compatibility; defaults
    /// to 0 so callers that predate phase persistence keep working.
    #[serde(default)]
    pub phase_offset_ms: Option<f64>,
}

#[tauri::command]
#[specta::specta]
pub fn create_run(db: State<'_, DbConnection>, input: CreateRunInput) -> CommandResult<Run> {
    let project_id = Uuid::parse_str(&input.project_id).map_err(CommandError::from)?;

    let run = state::create_run(
        &db,
        project_id,
        input.pipeline_version,
        input.theme,
        input.bpm,
        input.swing,
        input.quantize_strength,
        input.b_emphasis,
        input.phase_offset_ms.unwrap_or(0.0),
    )
    .map_err(CommandError::from)?;

    Ok(run)
}

#[tauri::command]
#[specta::specta]
pub fn get_run(db: State<'_, DbConnection>, id: String) -> CommandResult<Option<Run>> {
    let uuid = Uuid::parse_str(&id).map_err(CommandError::from)?;
    state::get_run(&db, &uuid).map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn list_runs_for_project(
    db: State<'_, DbConnection>,
    project_id: String,
) -> CommandResult<Vec<Run>> {
    let uuid = Uuid::parse_str(&project_id).map_err(CommandError::from)?;
    state::list_runs_for_project(&db, &uuid).map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn get_run_with_artifacts(
    db: State<'_, DbConnection>,
    run_id: String,
) -> CommandResult<Option<RunWithArtifacts>> {
    let uuid = Uuid::parse_str(&run_id).map_err(CommandError::from)?;
    state::queries::get_run_with_artifacts(&db, &uuid).map_err(CommandError::from)
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct UpdateRunStatusInput {
    pub run_id: String,
    pub status: String,
}

#[tauri::command]
#[specta::specta]
pub fn update_run_status(
    db: State<'_, DbConnection>,
    input: UpdateRunStatusInput,
) -> CommandResult<()> {
    let uuid = Uuid::parse_str(&input.run_id).map_err(CommandError::from)?;
    let status = RunStatus::from_string(&input.status);
    state::update_run_status(&db, &uuid, status).map_err(CommandError::from)
}

// ==================== ARTIFACT COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct CreateArtifactInput {
    pub run_id: String,
    pub kind: String,
    pub filename: String,
    pub data: Vec<u8>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_artifact(
    db: State<'_, DbConnection>,
    input: CreateArtifactInput,
) -> CommandResult<crate::state::Artifact> {
    let run_id = Uuid::parse_str(&input.run_id).map_err(CommandError::from)?;

    // Get the run to find project_id
    let run = state::get_run(&db, &run_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError {
            message: "Run not found".to_string(),
        })?;

    // Store the artifact file
    let (path, sha256) = state::storage::store_file(
        &run.project_id,
        Some(&run_id),
        &input.filename,
        &input.data,
    )
    .map_err(CommandError::from)?;

    let artifact = state::create_artifact(
        &db,
        run_id,
        ArtifactKind::from_string(&input.kind),
        path.to_string_lossy().to_string(),
        sha256,
        input.data.len() as i64,
    )
    .map_err(CommandError::from)?;

    Ok(artifact)
}

// ==================== CALIBRATION PROFILE COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct CreateCalibrationProfileInput {
    pub name: String,
    pub profile_data: Vec<u8>,
    pub notes: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_calibration_profile(
    db: State<'_, DbConnection>,
    input: CreateCalibrationProfileInput,
) -> CommandResult<CalibrationProfile> {
    let profile_id = Uuid::new_v4();

    // Store the profile JSON file
    let (path, _) = state::storage::store_calibration_profile(
        &profile_id,
        "profile.json",
        &input.profile_data,
    )
    .map_err(CommandError::from)?;

    let profile = state::create_calibration_profile(
        &db,
        input.name,
        path.to_string_lossy().to_string(),
        input.notes,
    )
    .map_err(CommandError::from)?;

    Ok(profile)
}

#[tauri::command]
#[specta::specta]
pub fn get_calibration_profile(
    db: State<'_, DbConnection>,
    id: String,
) -> CommandResult<Option<CalibrationProfile>> {
    let uuid = Uuid::parse_str(&id).map_err(CommandError::from)?;
    state::get_calibration_profile(&db, &uuid).map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn list_calibration_profiles(
    db: State<'_, DbConnection>,
) -> CommandResult<Vec<CalibrationProfile>> {
    state::list_calibration_profiles(&db).map_err(CommandError::from)
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct UpdateCalibrationProfileInput {
    pub id: String,
    pub name: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub fn update_calibration_profile(
    db: State<'_, DbConnection>,
    input: UpdateCalibrationProfileInput,
) -> CommandResult<()> {
    let uuid = Uuid::parse_str(&input.id).map_err(CommandError::from)?;
    state::update_calibration_profile(&db, &uuid, input.name, input.notes)
        .map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn delete_calibration_profile(
    db: State<'_, DbConnection>,
    id: String,
) -> CommandResult<()> {
    let uuid = Uuid::parse_str(&id).map_err(CommandError::from)?;
    state::delete_calibration_profile(&db, &uuid).map_err(CommandError::from)
}

// ==================== EVENT DETECTION COMMANDS ====================

#[derive(Debug, Serialize, specta::Type)]
pub struct OnsetDetectionResult {
    pub onsets: Vec<OnsetData>,
    pub total_count: usize,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct OnsetData {
    pub timestamp_ms: f64,
    pub strength: f32,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct DetectOnsetsInput {
    pub audio_data: Vec<u8>,
    pub window_size: Option<usize>,
    pub hop_size: Option<usize>,
    pub threshold_factor: Option<f32>,
}

/// Detect onsets in audio data
#[tauri::command]
#[specta::specta]
pub fn detect_onsets(input: DetectOnsetsInput) -> CommandResult<OnsetDetectionResult> {
    // Ingest audio
    let audio = audio::ingest_wav(&input.audio_data).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    // Configure onset detection
    let mut config = OnsetConfig::default();
    if let Some(ws) = input.window_size {
        config.window_size = ws;
    }
    if let Some(hs) = input.hop_size {
        config.hop_size = hs;
    }
    if let Some(tf) = input.threshold_factor {
        config.threshold_factor = tf;
    }

    // Detect onsets
    let onsets = audio::detect_onsets(&audio, &config);

    let onset_data: Vec<OnsetData> = onsets
        .iter()
        .map(|o| OnsetData {
            timestamp_ms: o.timestamp_ms,
            strength: o.strength,
        })
        .collect();

    Ok(OnsetDetectionResult {
        total_count: onset_data.len(),
        onsets: onset_data,
    })
}

#[derive(Debug, Serialize, specta::Type)]
pub struct EventDetectionResult {
    pub events: Vec<EventData>,
    pub total_count: usize,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
pub struct EventData {
    pub id: String,
    pub timestamp_ms: f64,
    pub duration_ms: f64,
    pub class: String,
    pub confidence: f32,
    pub features: EventFeatures,
    /// Per-class classifier scores. `serde(default)` so older callers/rows that
    /// predate score threading still deserialize (empty vec).
    #[serde(default)]
    pub all_scores: Vec<ClassScore>,
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct DetectEventsInput {
    pub file_path: String,
    pub run_id: Option<String>,
    pub use_calibration: bool,
    pub calibration_profile_id: Option<String>,
}

/// Detect and classify events in audio data
#[tauri::command]
#[specta::specta]
pub async fn detect_events(
    db: State<'_, DbConnection>,
    input: DetectEventsInput,
) -> CommandResult<EventDetectionResult> {
    // Read audio from disk with size limit (50MB)
    const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;
    let metadata = std::fs::metadata(&input.file_path).map_err(|e| CommandError {
        message: format!("Cannot access audio file: {}", e),
    })?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(CommandError {
            message: format!(
                "Audio file too large ({:.1}MB). Maximum is {:.0}MB.",
                metadata.len() as f64 / 1_048_576.0,
                MAX_FILE_SIZE as f64 / 1_048_576.0,
            ),
        });
    }
    let file_bytes = std::fs::read(&input.file_path).map_err(|e| CommandError {
        message: format!("Failed to read audio file: {}", e),
    })?;
    let audio = audio::ingest_wav(&file_bytes).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    // Initialize trace writer if run_id is provided
    let trace_writer = if let Some(ref run_id_str) = input.run_id {
        let run_id = Uuid::parse_str(run_id_str).map_err(CommandError::from)?;
        let run = state::get_run(&db, &run_id)
            .map_err(CommandError::from)?
            .ok_or_else(|| CommandError {
                message: "Run not found".to_string(),
            })?;

        // Create trace file path
        let trace_path = state::storage::get_run_dir(&run.project_id, &run_id)
            .map_err(CommandError::from)?
            .join("trace.jsonl");

        Some(TraceWriter::new(trace_path))
    } else {
        None
    };

    // Write start trace
    if let Some(ref writer) = trace_writer {
        let entry = TraceBuilder::stage("event_detection").start("Starting event detection");
        let _ = writer.write(&entry);
    }

    // Detect onsets
    let config = OnsetConfig::default();
    let onsets = audio::detect_onsets(&audio, &config);

    if let Some(ref writer) = trace_writer {
        let data = serde_json::json!({
            "onsets_detected": onsets.len()
        });
        let entry = TraceBuilder::stage("event_detection")
            .with_data(0.3, format!("Detected {} onsets", onsets.len()), data);
        let _ = writer.write(&entry);
    }

    // Initialize classifier
    let classifier = if input.use_calibration {
        if let Some(ref profile_id_str) = input.calibration_profile_id {
            let profile_id =
                Uuid::parse_str(profile_id_str).map_err(CommandError::from)?;

            // Load calibration profile
            let db_profile = state::get_calibration_profile(&db, &profile_id)
                .map_err(CommandError::from)?
                .ok_or_else(|| CommandError {
                    message: "Calibration profile not found".to_string(),
                })?;

            // Load profile data from file
            let profile_data = std::fs::read(&db_profile.profile_json_path).map_err(|e| {
                CommandError {
                    message: format!("Failed to read calibration profile: {}", e),
                }
            })?;

            let calibration_profile =
                events::CalibrationProfile::from_json_bytes(&profile_data).map_err(|e| {
                    CommandError {
                        message: format!("Failed to parse calibration profile: {}", e),
                    }
                })?;

            // MAP-adapt the factory Gaussian model from the user's labeled
            // calibration samples (AVP LOPO: 81.6% adapted vs 79.7% agnostic;
            // the old per-user kNN sat at 60.2% and is retired from this path).
            let samples: Vec<(EventClass, Vec<f32>)> = calibration_profile
                .samples
                .values()
                .flatten()
                .filter(|s| s.has_mfcc()) // legacy MFCC-less samples poison MAP
                .map(|s| (s.class, s.gaussian_vec()))
                .collect();
            events::HybridClassifier::with_adaptation(&samples)
        } else {
            return Err(CommandError {
                message: "Calibration profile ID required when use_calibration is true"
                    .to_string(),
            });
        }
    } else {
        events::HybridClassifier::factory()
    };

    // Classify each onset
    let mono = audio.to_mono();
    let mut events = Vec::new();

    for (i, onset) in onsets.iter().enumerate() {
        // Calculate duration (to next onset or end of audio)
        let duration_ms = if i + 1 < onsets.len() {
            onsets[i + 1].timestamp_ms - onset.timestamp_ms
        } else {
            audio.duration_ms as f64 - onset.timestamp_ms
        };

        // Scalar features over the fixed window the factory model was fitted
        // with (matches analyze_offline_hybrid and the streaming detector).
        let features = audio::extract_features_for_window(
            &audio,
            onset.timestamp_ms,
            events::hybrid::HYBRID_MFCC_WINDOW_MS,
        );

        // MFCCs over the fixed window the factory model was fitted with.
        let start = ((onset.timestamp_ms / 1000.0) * audio.sample_rate as f64) as usize;
        let mfcc_len = ((events::hybrid::HYBRID_MFCC_WINDOW_MS / 1000.0)
            * audio.sample_rate as f64) as usize;
        let end = (start + mfcc_len).min(mono.len());
        let mfcc = if start < end {
            audio::extract_mfcc(&mono[start..end], audio.sample_rate)
        } else {
            vec![0.0; audio::MFCC_COEFFS]
        };

        let result = classifier.classify(&features, &mfcc);
        let event = Event::new(
            onset.timestamp_ms,
            duration_ms,
            result.class,
            result.confidence,
            features,
        )
        .with_scores(result.class_scores());
        events.push(event);

        // Progress trace
        if let Some(ref writer) = trace_writer {
            if i % 10 == 0 {
                let progress = 0.3 + (0.6 * (i as f32 / onsets.len() as f32));
                let entry = TraceBuilder::stage("event_detection")
                    .progress(progress, format!("Classified {} / {} events", i, onsets.len()));
                let _ = writer.write(&entry);
            }
        }
    }

    // Write completion trace
    if let Some(ref writer) = trace_writer {
        let data = serde_json::json!({
            "events_detected": events.len(),
            "used_calibration": input.use_calibration
        });
        let entry = TraceBuilder::stage("event_detection")
            .with_data(1.0, format!("Detected {} events", events.len()), data);
        let _ = writer.write(&entry);
    }

    // Convert to serializable format
    let event_data: Vec<EventData> = events
        .iter()
        .map(|e| EventData {
            id: e.id.to_string(),
            timestamp_ms: e.timestamp_ms,
            duration_ms: e.duration_ms,
            class: e.class.to_string().to_string(),
            confidence: e.confidence,
            features: e.features.clone(),
            all_scores: e.all_scores.clone(),
        })
        .collect();

    Ok(EventDetectionResult {
        total_count: event_data.len(),
        events: event_data,
    })
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct ExtractFeaturesInput {
    pub audio_data: Vec<u8>,
    pub start_ms: f64,
    pub duration_ms: f64,
}

/// Extract features from a specific audio segment
#[tauri::command]
#[specta::specta]
pub fn extract_features(input: ExtractFeaturesInput) -> CommandResult<EventFeatures> {
    let audio = audio::ingest_wav(&input.audio_data).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    let features = audio::extract_features_for_window(&audio, input.start_ms, input.duration_ms);

    Ok(features)
}

// ==================== GROOVE ENGINE COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct EstimateTempoInput {
    pub file_path: String,
}

/// Estimate tempo (BPM) from audio data
#[tauri::command]
#[specta::specta]
pub fn estimate_tempo(input: EstimateTempoInput) -> CommandResult<TempoEstimate> {
    // Read audio from disk
    let file_bytes = std::fs::read(&input.file_path).map_err(|e| CommandError {
        message: format!("Failed to read audio file: {}", e),
    })?;
    let audio = audio::ingest_wav(&file_bytes).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    // Detect onsets
    let config = OnsetConfig::default();
    let onsets = audio::detect_onsets(&audio, &config);

    // Estimate tempo
    let tempo_estimate = groove::estimate_tempo(&onsets, audio.sample_rate);

    Ok(tempo_estimate)
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct QuantizeEventsInput {
    pub events: Vec<EventData>,
    pub bpm: f64,
    pub time_signature: String,
    pub division: String,
    pub feel: String,
    pub swing_amount: f32,
    pub bar_count: u32,
    pub quantize_strength: f32,
    pub lookahead_ms: f64,
    /// Grid phase offset (ms) from tempo estimation. Anchors the quantization grid
    /// to the performer's downbeat. Defaults to 0.0 (t=0 anchor) for back-compat.
    #[serde(default)]
    pub phase_offset_ms: Option<f64>,
}

/// Quantize events to a musical grid
#[tauri::command]
#[specta::specta]
pub fn quantize_events_command(input: QuantizeEventsInput) -> CommandResult<Vec<QuantizedEvent>> {
    // Parse time signature
    let time_signature = match input.time_signature.as_str() {
        "four_four" => TimeSignature::FourFour,
        "three_four" => TimeSignature::ThreeFour,
        _ => TimeSignature::FourFour,
    };

    // Parse grid division
    let division = match input.division.as_str() {
        "quarter" => GridDivision::Quarter,
        "eighth" => GridDivision::Eighth,
        "sixteenth" => GridDivision::Sixteenth,
        "triplet" => GridDivision::Triplet,
        _ => GridDivision::Sixteenth,
    };

    // Parse groove feel
    let feel = match input.feel.as_str() {
        "straight" => GrooveFeel::Straight,
        "swing" => GrooveFeel::Swing,
        "halftime" => GrooveFeel::Halftime,
        _ => GrooveFeel::Straight,
    };

    // Create grid, anchored to the estimated beat phase so a leading silence /
    // anacrusis doesn't misquantize every downbeat.
    let grid = Grid::with_phase(
        input.bpm,
        time_signature,
        division,
        feel,
        input.swing_amount,
        input.bar_count,
        input.phase_offset_ms.unwrap_or(0.0),
    );

    // Create quantize settings
    let settings = QuantizeSettings {
        strength: input.quantize_strength,
        swing_amount: input.swing_amount,
        lookahead_ms: input.lookahead_ms,
    };

    // Convert EventData back to Event objects
    let events: Vec<Event> = input
        .events
        .iter()
        .map(|e| {
            let id = Uuid::parse_str(&e.id).unwrap_or_else(|_| Uuid::new_v4());
            Event {
                id,
                timestamp_ms: e.timestamp_ms,
                duration_ms: e.duration_ms,
                class: EventClass::from_string(&e.class),
                confidence: e.confidence,
                features: e.features.clone(),
                all_scores: e.all_scores.clone(),
            }
        })
        .collect();

    // Quantize events
    let quantized = groove::quantize_events(&events, &grid, &settings);

    Ok(quantized)
}

// ==================== ARRANGER COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct ArrangeEventsInput {
    pub events: Vec<QuantizedEvent>,
    pub template: String,
    pub theme_name: String,
    pub bpm: f64,
    pub time_signature: String,
    pub division: String,
    pub feel: String,
    pub swing_amount: f32,
    pub bar_count: u32,
    pub b_emphasis: f32,
    /// Grid phase offset (ms) from tempo estimation. Anchors the arrangement grid
    /// (chord boundaries, beat placement) to the performer's downbeat. Defaults to
    /// 0.0 for back-compat.
    #[serde(default)]
    pub phase_offset_ms: Option<f64>,
    /// Placement fidelity [0.0, 1.0] (spec §4.3). 1.0 "Follow me" plays every event
    /// at its quantized position (templates only shape velocity); 0.0 "Produce for
    /// me" snaps off-template hits to the nearest template slot. Never deletes
    /// events. Defaults to 0.8 (the UI slider lands in Task 4).
    #[serde(default = "default_fidelity")]
    pub fidelity: f32,
}

/// Default placement fidelity when the frontend omits it (serde back-compat).
fn default_fidelity() -> f32 {
    0.8
}

/// Arrange quantized events into a musical arrangement
#[tauri::command]
#[specta::specta]
pub fn arrange_events_command(input: ArrangeEventsInput) -> CommandResult<Arrangement> {
    // Parse template
    let template = ArrangementTemplate::from_string(&input.template);

    // Get theme by name
    let theme = match crate::themes::get_theme(&input.theme_name) {
        Some(t) => t,
        None => {
            // Fallback to first available theme
            crate::themes::get_theme("BLADE RUNNER").expect("Theme must exist")
        }
    };

    // Parse time signature
    let time_signature = match input.time_signature.as_str() {
        "four_four" => TimeSignature::FourFour,
        "three_four" => TimeSignature::ThreeFour,
        _ => TimeSignature::FourFour,
    };

    // Parse grid division
    let division = match input.division.as_str() {
        "quarter" => GridDivision::Quarter,
        "eighth" => GridDivision::Eighth,
        "sixteenth" => GridDivision::Sixteenth,
        "triplet" => GridDivision::Triplet,
        _ => GridDivision::Sixteenth,
    };

    // Parse groove feel
    let feel = match input.feel.as_str() {
        "straight" => GrooveFeel::Straight,
        "swing" => GrooveFeel::Swing,
        "halftime" => GrooveFeel::Halftime,
        _ => GrooveFeel::Straight,
    };

    // Create grid, anchored to the estimated beat phase so chord boundaries and
    // beat placement line up with the performer's downbeat.
    let grid = Grid::with_phase(
        input.bpm,
        time_signature,
        division,
        feel,
        input.swing_amount,
        input.bar_count,
        input.phase_offset_ms.unwrap_or(0.0),
    );

    // Arrange events with harmonic context
    let base_arrangement = arranger::arrange_events(
        &input.events,
        &template,
        &grid,
        &theme,
        input.b_emphasis,
        input.fidelity,
    );

    // Expand base pattern into full song (Intro/Build/Drop/Outro)
    let arrangement = base_arrangement.expand_to_song();

    Ok(arrangement)
}

#[derive(Debug, Deserialize, specta::Type)]
pub struct ExportMidiInput {
    pub arrangement: Arrangement,
    pub bpm: f64,
    pub time_signature: String,
    pub division: String,
    pub feel: String,
    pub swing_amount: f32,
    pub bar_count: u32,
    pub ppq: Option<u16>,
    pub include_tempo: Option<bool>,
    pub include_time_signature: Option<bool>,
    pub track_names: Option<bool>,
    /// Grid phase offset (ms) from tempo estimation. Extends grid duration so a
    /// phase-shifted arrangement's tail isn't truncated on export. Defaults to 0.0.
    #[serde(default)]
    pub phase_offset_ms: Option<f64>,
}

/// Export arrangement as MIDI file bytes
#[tauri::command]
#[specta::specta]
pub fn export_midi_command(input: ExportMidiInput) -> CommandResult<Vec<u8>> {
    // Parse time signature
    let time_signature = match input.time_signature.as_str() {
        "four_four" => TimeSignature::FourFour,
        "three_four" => TimeSignature::ThreeFour,
        _ => TimeSignature::FourFour,
    };

    // Parse grid division
    let division = match input.division.as_str() {
        "quarter" => GridDivision::Quarter,
        "eighth" => GridDivision::Eighth,
        "sixteenth" => GridDivision::Sixteenth,
        "triplet" => GridDivision::Triplet,
        _ => GridDivision::Sixteenth,
    };

    // Parse groove feel
    let feel = match input.feel.as_str() {
        "straight" => GrooveFeel::Straight,
        "swing" => GrooveFeel::Swing,
        "halftime" => GrooveFeel::Halftime,
        _ => GrooveFeel::Straight,
    };

    // Create grid, anchored to the estimated beat phase so the exported grid
    // duration covers the phase-shifted tail.
    let grid = Grid::with_phase(
        input.bpm,
        time_signature,
        division,
        feel,
        input.swing_amount,
        input.bar_count,
        input.phase_offset_ms.unwrap_or(0.0),
    );

    // Create MIDI export options
    let mut options = MidiExportOptions::default();
    if let Some(ppq) = input.ppq {
        options.ppq = ppq;
    }
    if let Some(include_tempo) = input.include_tempo {
        options.include_tempo = include_tempo;
    }
    if let Some(include_time_signature) = input.include_time_signature {
        options.include_time_signature = include_time_signature;
    }
    if let Some(track_names) = input.track_names {
        options.track_names = track_names;
    }

    // Export to MIDI
    let midi_bytes = arranger::export_midi(&input.arrangement, &grid, &options)
        .map_err(|e| CommandError {
            message: format!("Failed to export MIDI: {}", e),
        })?;

    Ok(midi_bytes)
}

// ==================== EXPLAINABILITY COMMANDS ====================

#[derive(Debug, Deserialize, specta::Type)]
pub struct SaveEventDecisionsInput {
    pub run_id: String,
    pub events: Vec<EventData>,
    pub quantized_events: Option<Vec<QuantizedEvent>>,
    pub arrangement: Option<Arrangement>,
}

#[tauri::command]
#[specta::specta]
pub fn save_event_decisions(
    db: State<'_, DbConnection>,
    input: SaveEventDecisionsInput,
) -> CommandResult<()> {
    let run_id = Uuid::parse_str(&input.run_id).map_err(CommandError::from)?;

    // Get project ID from run
    let run = state::get_run(&db, &run_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError {
            message: "Run not found".to_string(),
        })?;

    // Create lookup for quantized events
    let quantized_lookup: std::collections::HashMap<Uuid, &QuantizedEvent> =
        if let Some(ref q_events) = input.quantized_events {
            q_events
                .iter()
                .map(|qe| (qe.original_event.id, qe))
                .collect()
        } else {
            std::collections::HashMap::new()
        };

    // Build decisions
    let mut decisions = Vec::new();

    for event_data in &input.events {
        // Convert EventData to Event
        let id = Uuid::parse_str(&event_data.id).unwrap_or_else(|_| Uuid::new_v4());
        let event = Event {
            id,
            timestamp_ms: event_data.timestamp_ms,
            duration_ms: event_data.duration_ms,
            class: EventClass::from_string(&event_data.class),
            confidence: event_data.confidence,
            features: event_data.features.clone(),
            all_scores: event_data.all_scores.clone(),
        };

        let quantized = quantized_lookup.get(&id).copied();
        let arrangement = input.arrangement.as_ref();

        let decision = EventDecision::from_pipeline_data(&event, quantized, arrangement);
        decisions.push(decision);
    }

    // Store analysis
    state::storage::store_analysis(&run.project_id, &run_id, &decisions)
        .map_err(CommandError::from)?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_event_decisions(
    db: State<'_, DbConnection>,
    run_id: String,
) -> CommandResult<Vec<EventDecision>> {
    let run_id = Uuid::parse_str(&run_id).map_err(CommandError::from)?;

    let run = state::get_run(&db, &run_id)
        .map_err(CommandError::from)?
        .ok_or_else(|| CommandError {
            message: "Run not found".to_string(),
        })?;

    let decisions = state::storage::read_analysis(&run.project_id, &run_id)
        .map_err(CommandError::from)?
        .unwrap_or_else(Vec::new);

    Ok(decisions)
}

// ==================== THEME COMMANDS ====================

/// List all available themes with summaries
#[tauri::command]
#[specta::specta]
pub fn list_themes() -> CommandResult<Vec<crate::themes::ThemeSummary>> {
    Ok(crate::themes::list_themes())
}

/// Get a specific theme by name
#[tauri::command]
#[specta::specta]
pub fn get_theme(name: String) -> CommandResult<Option<crate::themes::Theme>> {
    Ok(crate::themes::get_theme(&name))
}

/// Get all theme names
#[tauri::command]
#[specta::specta]
pub fn list_theme_names() -> CommandResult<Vec<String>> {
    Ok(crate::themes::list_theme_names())
}

// ==================== RECORDING COMMANDS ====================

use crate::audio::AudioRecorder;

/// Global recorder state managed by Tauri
#[derive(Default)]
pub struct RecorderState(pub AudioRecorder);

/// Start audio recording from the default input device
#[tauri::command]
#[specta::specta]
pub fn start_recording(recorder: State<'_, RecorderState>) -> CommandResult<()> {
    recorder.0.start().map_err(|e| CommandError {
        message: format!("Failed to start recording: {}", e),
    })?;

    log::info!("Recording started");
    Ok(())
}

/// Stop recording and return the audio data as WAV bytes
#[tauri::command]
#[specta::specta]
pub fn stop_recording(recorder: State<'_, RecorderState>) -> CommandResult<Vec<u8>> {
    let data = recorder.0.stop().map_err(|e| CommandError {
        message: format!("Failed to stop recording: {}", e),
    })?;

    log::info!("Recording stopped: {} samples, {} ms", data.samples.len(), data.duration_ms());

    let wav_bytes = data.to_wav().map_err(|e| CommandError {
        message: format!("Failed to convert to WAV: {}", e),
    })?;

    Ok(wav_bytes)
}

/// Check if currently recording
#[tauri::command]
#[specta::specta]
pub fn is_recording(recorder: State<'_, RecorderState>) -> CommandResult<bool> {
    Ok(recorder.0.is_recording())
}

/// Get current audio input level (0.0 - 1.0)
#[tauri::command]
#[specta::specta]
pub fn get_recording_level(recorder: State<'_, RecorderState>) -> CommandResult<f32> {
    Ok(recorder.0.get_level())
}
