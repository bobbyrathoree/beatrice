// Tauri IPC Commands
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::arranger::{self, ArrangementTemplate, Arrangement, MidiExportOptions};
use crate::audio::{self, AudioData, OnsetConfig};
use crate::events::{self, Event, EventClass, EventFeatures};
use crate::groove::{self, TempoEstimate, Grid, GridDivision, GrooveFeel, TimeSignature, QuantizeSettings, QuantizedEvent};
use crate::pipeline::{TraceBuilder, TraceWriter};
use crate::state::{
    self, ArtifactKind, CalibrationProfile, DbConnection, Project, ProjectSummary, Run,
    RunStatus, RunWithArtifacts,
};

#[derive(Debug, Serialize)]
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
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Beatrice.", name)
}

// ==================== PROJECT COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub input_data: Vec<u8>,
}

#[tauri::command]
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
            .map_err(|e| CommandError::from(e))?;

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
        input.name,
        input_path.to_string_lossy().to_string(),
        input_sha256,
        duration_ms,
    )
    .map_err(|e| CommandError::from(e))?;

    Ok(project)
}

#[tauri::command]
pub fn get_project(db: State<'_, DbConnection>, id: String) -> CommandResult<Option<Project>> {
    let uuid = Uuid::parse_str(&id).map_err(|e| CommandError::from(e))?;
    state::get_project(&db, &uuid).map_err(|e| CommandError::from(e))
}

#[tauri::command]
pub fn list_projects(db: State<'_, DbConnection>) -> CommandResult<Vec<ProjectSummary>> {
    state::list_projects(&db).map_err(|e| CommandError::from(e))
}

// ==================== RUN COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct CreateRunInput {
    pub project_id: String,
    pub pipeline_version: String,
    pub theme: String,
    pub bpm: f64,
    pub swing: f64,
    pub quantize_strength: f64,
    pub b_emphasis: f64,
}

#[tauri::command]
pub fn create_run(db: State<'_, DbConnection>, input: CreateRunInput) -> CommandResult<Run> {
    let project_id = Uuid::parse_str(&input.project_id).map_err(|e| CommandError::from(e))?;

    let run = state::create_run(
        &db,
        project_id,
        input.pipeline_version,
        input.theme,
        input.bpm,
        input.swing,
        input.quantize_strength,
        input.b_emphasis,
    )
    .map_err(|e| CommandError::from(e))?;

    Ok(run)
}

#[tauri::command]
pub fn get_run(db: State<'_, DbConnection>, id: String) -> CommandResult<Option<Run>> {
    let uuid = Uuid::parse_str(&id).map_err(|e| CommandError::from(e))?;
    state::get_run(&db, &uuid).map_err(|e| CommandError::from(e))
}

#[tauri::command]
pub fn list_runs_for_project(
    db: State<'_, DbConnection>,
    project_id: String,
) -> CommandResult<Vec<Run>> {
    let uuid = Uuid::parse_str(&project_id).map_err(|e| CommandError::from(e))?;
    state::list_runs_for_project(&db, &uuid).map_err(|e| CommandError::from(e))
}

#[tauri::command]
pub fn get_run_with_artifacts(
    db: State<'_, DbConnection>,
    run_id: String,
) -> CommandResult<Option<RunWithArtifacts>> {
    let uuid = Uuid::parse_str(&run_id).map_err(|e| CommandError::from(e))?;
    state::queries::get_run_with_artifacts(&db, &uuid).map_err(|e| CommandError::from(e))
}

#[derive(Debug, Deserialize)]
pub struct UpdateRunStatusInput {
    pub run_id: String,
    pub status: String,
}

#[tauri::command]
pub fn update_run_status(
    db: State<'_, DbConnection>,
    input: UpdateRunStatusInput,
) -> CommandResult<()> {
    let uuid = Uuid::parse_str(&input.run_id).map_err(|e| CommandError::from(e))?;
    let status = RunStatus::from_string(&input.status);
    state::update_run_status(&db, &uuid, status).map_err(|e| CommandError::from(e))
}

// ==================== ARTIFACT COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct CreateArtifactInput {
    pub run_id: String,
    pub kind: String,
    pub filename: String,
    pub data: Vec<u8>,
}

#[tauri::command]
pub async fn create_artifact(
    db: State<'_, DbConnection>,
    input: CreateArtifactInput,
) -> CommandResult<crate::state::Artifact> {
    let run_id = Uuid::parse_str(&input.run_id).map_err(|e| CommandError::from(e))?;

    // Get the run to find project_id
    let run = state::get_run(&db, &run_id)
        .map_err(|e| CommandError::from(e))?
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
    .map_err(|e| CommandError::from(e))?;

    let artifact = state::create_artifact(
        &db,
        run_id,
        ArtifactKind::from_string(&input.kind),
        path.to_string_lossy().to_string(),
        sha256,
        input.data.len() as i64,
    )
    .map_err(|e| CommandError::from(e))?;

    Ok(artifact)
}

// ==================== CALIBRATION PROFILE COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct CreateCalibrationProfileInput {
    pub name: String,
    pub profile_data: Vec<u8>,
    pub notes: Option<String>,
}

#[tauri::command]
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
    .map_err(|e| CommandError::from(e))?;

    let profile = state::create_calibration_profile(
        &db,
        input.name,
        path.to_string_lossy().to_string(),
        input.notes,
    )
    .map_err(|e| CommandError::from(e))?;

    Ok(profile)
}

#[tauri::command]
pub fn get_calibration_profile(
    db: State<'_, DbConnection>,
    id: String,
) -> CommandResult<Option<CalibrationProfile>> {
    let uuid = Uuid::parse_str(&id).map_err(|e| CommandError::from(e))?;
    state::get_calibration_profile(&db, &uuid).map_err(|e| CommandError::from(e))
}

#[tauri::command]
pub fn list_calibration_profiles(
    db: State<'_, DbConnection>,
) -> CommandResult<Vec<CalibrationProfile>> {
    state::list_calibration_profiles(&db).map_err(|e| CommandError::from(e))
}

#[derive(Debug, Deserialize)]
pub struct UpdateCalibrationProfileInput {
    pub id: String,
    pub name: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn update_calibration_profile(
    db: State<'_, DbConnection>,
    input: UpdateCalibrationProfileInput,
) -> CommandResult<()> {
    let uuid = Uuid::parse_str(&input.id).map_err(|e| CommandError::from(e))?;
    state::update_calibration_profile(&db, &uuid, input.name, input.notes)
        .map_err(|e| CommandError::from(e))
}

#[tauri::command]
pub fn delete_calibration_profile(
    db: State<'_, DbConnection>,
    id: String,
) -> CommandResult<()> {
    let uuid = Uuid::parse_str(&id).map_err(|e| CommandError::from(e))?;
    state::delete_calibration_profile(&db, &uuid).map_err(|e| CommandError::from(e))
}

// ==================== EVENT DETECTION COMMANDS ====================

#[derive(Debug, Serialize)]
pub struct OnsetDetectionResult {
    pub onsets: Vec<OnsetData>,
    pub total_count: usize,
}

#[derive(Debug, Serialize)]
pub struct OnsetData {
    pub timestamp_ms: f64,
    pub strength: f32,
}

#[derive(Debug, Deserialize)]
pub struct DetectOnsetsInput {
    pub audio_data: Vec<u8>,
    pub window_size: Option<usize>,
    pub hop_size: Option<usize>,
    pub threshold_factor: Option<f32>,
}

/// Detect onsets in audio data
#[tauri::command]
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

#[derive(Debug, Serialize)]
pub struct EventDetectionResult {
    pub events: Vec<EventData>,
    pub total_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventData {
    pub id: String,
    pub timestamp_ms: f64,
    pub duration_ms: f64,
    pub class: String,
    pub confidence: f32,
    pub features: EventFeatures,
}

#[derive(Debug, Deserialize)]
pub struct DetectEventsInput {
    pub audio_data: Vec<u8>,
    pub run_id: Option<String>,
    pub use_calibration: bool,
    pub calibration_profile_id: Option<String>,
}

/// Detect and classify events in audio data
#[tauri::command]
pub async fn detect_events(
    db: State<'_, DbConnection>,
    input: DetectEventsInput,
) -> CommandResult<EventDetectionResult> {
    // Ingest audio
    let audio = audio::ingest_wav(&input.audio_data).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    // Initialize trace writer if run_id is provided
    let trace_writer = if let Some(ref run_id_str) = input.run_id {
        let run_id = Uuid::parse_str(run_id_str).map_err(|e| CommandError::from(e))?;
        let run = state::get_run(&db, &run_id)
            .map_err(|e| CommandError::from(e))?
            .ok_or_else(|| CommandError {
                message: "Run not found".to_string(),
            })?;

        // Create trace file path
        let trace_path = state::storage::get_run_dir(&run.project_id, &run_id)
            .map_err(|e| CommandError::from(e))?
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
                Uuid::parse_str(profile_id_str).map_err(|e| CommandError::from(e))?;

            // Load calibration profile
            let db_profile = state::get_calibration_profile(&db, &profile_id)
                .map_err(|e| CommandError::from(e))?
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

            // Use KNN classifier with calibration
            Some(events::KnnClassifier::new(calibration_profile, 5))
        } else {
            return Err(CommandError {
                message: "Calibration profile ID required when use_calibration is true"
                    .to_string(),
            });
        }
    } else {
        None
    };

    // Use heuristic classifier if no calibration
    let heuristic = if classifier.is_none() {
        Some(events::HeuristicClassifier::new())
    } else {
        None
    };

    // Classify each onset
    let mut events = Vec::new();
    let window_duration_ms = 50.0; // 50ms window for feature extraction

    for (i, onset) in onsets.iter().enumerate() {
        // Extract features for this onset
        let features =
            audio::extract_features_for_window(&audio, onset.timestamp_ms, window_duration_ms);

        // Classify using appropriate classifier
        let (class, confidence) = if let Some(ref knn) = classifier {
            knn.classify(&features).unwrap_or((EventClass::Click, 0.5))
        } else if let Some(ref h) = heuristic {
            let result = h.classify(&features);
            (result.class, result.confidence)
        } else {
            (EventClass::Click, 0.5) // Fallback
        };

        // Calculate duration (to next onset or end of audio)
        let duration_ms = if i + 1 < onsets.len() {
            onsets[i + 1].timestamp_ms - onset.timestamp_ms
        } else {
            audio.duration_ms as f64 - onset.timestamp_ms
        };

        let event = Event::new(onset.timestamp_ms, duration_ms, class, confidence, features);
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
        })
        .collect();

    Ok(EventDetectionResult {
        total_count: event_data.len(),
        events: event_data,
    })
}

#[derive(Debug, Deserialize)]
pub struct ExtractFeaturesInput {
    pub audio_data: Vec<u8>,
    pub start_ms: f64,
    pub duration_ms: f64,
}

/// Extract features from a specific audio segment
#[tauri::command]
pub fn extract_features(input: ExtractFeaturesInput) -> CommandResult<EventFeatures> {
    let audio = audio::ingest_wav(&input.audio_data).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    let features = audio::extract_features_for_window(&audio, input.start_ms, input.duration_ms);

    Ok(features)
}

// ==================== GROOVE ENGINE COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct EstimateTempoInput {
    pub audio_data: Vec<u8>,
}

/// Estimate tempo (BPM) from audio data
#[tauri::command]
pub fn estimate_tempo(input: EstimateTempoInput) -> CommandResult<TempoEstimate> {
    // Ingest audio
    let audio = audio::ingest_wav(&input.audio_data).map_err(|e| CommandError {
        message: format!("Failed to ingest audio: {}", e),
    })?;

    // Detect onsets
    let config = OnsetConfig::default();
    let onsets = audio::detect_onsets(&audio, &config);

    // Estimate tempo
    let tempo_estimate = groove::estimate_tempo(&onsets, audio.sample_rate);

    Ok(tempo_estimate)
}

#[derive(Debug, Deserialize)]
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
}

/// Quantize events to a musical grid
#[tauri::command]
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

    // Create grid
    let grid = Grid::new_with_feel(
        input.bpm,
        time_signature,
        division,
        feel,
        input.swing_amount,
        input.bar_count,
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
            }
        })
        .collect();

    // Quantize events
    let quantized = groove::quantize_events(&events, &grid, &settings);

    Ok(quantized)
}

// ==================== ARRANGER COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct ArrangeEventsInput {
    pub events: Vec<QuantizedEvent>,
    pub template: String,
    pub bpm: f64,
    pub time_signature: String,
    pub division: String,
    pub feel: String,
    pub swing_amount: f32,
    pub bar_count: u32,
    pub b_emphasis: f32,
}

/// Arrange quantized events into a musical arrangement
#[tauri::command]
pub fn arrange_events_command(input: ArrangeEventsInput) -> CommandResult<Arrangement> {
    // Parse template
    let template = ArrangementTemplate::from_string(&input.template);

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

    // Create grid
    let grid = Grid::new_with_feel(
        input.bpm,
        time_signature,
        division,
        feel,
        input.swing_amount,
        input.bar_count,
    );

    // Arrange events
    let arrangement = arranger::arrange_events(&input.events, &template, &grid, input.b_emphasis);

    Ok(arrangement)
}

#[derive(Debug, Deserialize)]
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
}

/// Export arrangement as MIDI file bytes
#[tauri::command]
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

    // Create grid
    let grid = Grid::new_with_feel(
        input.bpm,
        time_signature,
        division,
        feel,
        input.swing_amount,
        input.bar_count,
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

// ==================== THEME COMMANDS ====================

/// List all available themes with summaries
#[tauri::command]
pub fn list_themes() -> CommandResult<Vec<crate::themes::ThemeSummary>> {
    Ok(crate::themes::list_themes())
}

/// Get a specific theme by name
#[tauri::command]
pub fn get_theme(name: String) -> CommandResult<Option<crate::themes::Theme>> {
    Ok(crate::themes::get_theme(&name))
}

/// Get all theme names
#[tauri::command]
pub fn list_theme_names() -> CommandResult<Vec<String>> {
    Ok(crate::themes::list_theme_names())
}

// ==================== RENDER COMMANDS ====================

#[derive(Debug, Deserialize)]
pub struct RenderPreviewInput {
    pub arrangement: Arrangement,
    pub theme_name: String,
    pub duration_seconds: f64,
    pub sample_rate: Option<f64>,
    pub mixer_settings: Option<crate::render::MixerSettings>,
}

/// Render a preview of an arrangement to WAV audio
///
/// Note: This is a placeholder implementation that returns silent audio.
/// Full audio synthesis will be implemented in a future update.
#[tauri::command]
pub async fn render_preview(
    input: RenderPreviewInput,
) -> CommandResult<Vec<u8>> {
    // Get theme
    let theme = crate::themes::get_theme(&input.theme_name)
        .ok_or_else(|| CommandError {
            message: format!("Theme not found: {}", input.theme_name),
        })?;

    // Use provided settings or defaults
    let settings = input.mixer_settings.unwrap_or_default();
    let sample_rate = input.sample_rate.unwrap_or(44100.0);

    // Render audio samples
    let samples = crate::render::render_arrangement(
        &input.arrangement,
        &theme,
        &settings,
        sample_rate,
        input.duration_seconds,
    );

    // Convert samples to WAV bytes
    let wav_bytes = samples_to_wav(&samples, sample_rate as u32)
        .map_err(|e| CommandError {
            message: format!("Failed to create WAV file: {}", e),
        })?;

    Ok(wav_bytes)
}

/// Convert stereo audio samples to WAV file bytes
fn samples_to_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    use hound::{WavSpec, WavWriter};
    use std::io::Cursor;

    let spec = WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)?;

        // Convert f32 samples to i16
        for &sample in samples {
            let sample_i16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
            writer.write_sample(sample_i16)?;
        }

        writer.finalize()?;
    }

    Ok(cursor.into_inner())
}

// ==================== RECORDING COMMANDS ====================

use crate::audio::AudioRecorder;

/// Global recorder state managed by Tauri
pub struct RecorderState(pub AudioRecorder);

impl Default for RecorderState {
    fn default() -> Self {
        Self(AudioRecorder::new())
    }
}

/// Start audio recording from the default input device
#[tauri::command]
pub fn start_recording(recorder: State<'_, RecorderState>) -> CommandResult<()> {
    recorder.0.start().map_err(|e| CommandError {
        message: format!("Failed to start recording: {}", e),
    })?;

    log::info!("Recording started");
    Ok(())
}

/// Stop recording and return the audio data as WAV bytes
#[tauri::command]
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
pub fn is_recording(recorder: State<'_, RecorderState>) -> CommandResult<bool> {
    Ok(recorder.0.is_recording())
}

/// Get current audio input level (0.0 - 1.0)
#[tauri::command]
pub fn get_recording_level(recorder: State<'_, RecorderState>) -> CommandResult<f32> {
    Ok(recorder.0.get_level())
}
