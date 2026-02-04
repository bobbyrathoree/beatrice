// Explainability module
// Aggregates pipeline data to provide transparency into AI decision making

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::arranger::Arrangement;
use crate::events::{Event, EventClass, EventFeatures};
use crate::groove::quantize::QuantizedEvent;

/// A simplified representation of a note assigned to an instrument lane
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignedNote {
    /// Name of the lane (e.g., "KICK", "SNARE")
    pub lane_name: String,

    /// MIDI note number
    pub midi_note: u8,

    /// MIDI velocity
    pub velocity: u8,

    /// Duration in milliseconds
    pub duration_ms: f64,
}

/// Complete decision information for a single event
/// showing how it moved through the pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDecision {
    /// Original event ID
    pub event_id: Uuid,

    // --- Detection ---
    pub timestamp_ms: f64,
    pub duration_ms: f64,
    pub class: EventClass,
    pub confidence: f32,
    pub features: EventFeatures,

    // --- Quantization ---
    pub quantized_timestamp_ms: Option<f64>,
    pub snap_delta_ms: Option<f64>,
    pub grid_position: Option<String>,

    // --- Arrangement ---
    pub assigned_notes: Vec<AssignedNote>,

    // --- Explainability ---
    pub reasoning: String,
}

impl EventDecision {
    /// Create a decision object from pipeline data
    pub fn from_pipeline_data(
        event: &Event,
        quantized: Option<&QuantizedEvent>,
        arrangement: Option<&Arrangement>,
    ) -> Self {
        let mut notes = Vec::new();
        let mut reason_parts = Vec::new();

        // 1. Detection
        reason_parts.push(format!(
            "Classified as {} ({}% confidence) based on features.",
            event.class.display_name(),
            (event.confidence * 100.0) as u32
        ));

        // 2. Quantization
        let (q_ts, delta, grid_pos) = if let Some(q) = quantized {
            let pos = format!("{}.{}.{}", q.grid_position.bar + 1, q.grid_position.beat + 1, q.grid_position.subdivision + 1);
            
            let timing_desc = if q.snap_delta_ms.abs() < 1.0 {
                "perfect timing".to_string()
            } else if q.snap_delta_ms > 0.0 {
                format!("late by {:.1}ms", q.snap_delta_ms)
            } else {
                format!("early by {:.1}ms", q.snap_delta_ms.abs())
            };

            reason_parts.push(format!(
                "Quantized to grid position {} ({}, adjusted {:.1}ms).",
                pos, timing_desc, q.snap_delta_ms
            ));

            (Some(q.quantized_timestamp_ms), Some(q.snap_delta_ms), Some(pos))
        } else {
            (None, None, None)
        };

        // 3. Arrangement
        if let Some(arr) = arrangement {
            // Find notes triggered by this event
            for lane in arr.all_lanes() {
                for note in &lane.events {
                    if let Some(source_id) = note.source_event_id {
                        if source_id == event.id {
                            notes.push(AssignedNote {
                                lane_name: lane.name.clone(),
                                midi_note: lane.midi_note,
                                velocity: note.velocity,
                                duration_ms: note.duration_ms,
                            });
                        }
                    }
                }
            }

            if notes.is_empty() {
                reason_parts.push("Did not trigger any instruments (filtered by arrangement rules).".to_string());
            } else {
                let instruments: Vec<String> = notes.iter().map(|n| n.lane_name.clone()).collect();
                reason_parts.push(format!(
                    "Triggered instruments: {}.",
                    instruments.join(", ")
                ));
            }
        }

        EventDecision {
            event_id: event.id,
            timestamp_ms: event.timestamp_ms,
            duration_ms: event.duration_ms,
            class: event.class,
            confidence: event.confidence,
            features: event.features.clone(),
            quantized_timestamp_ms: q_ts,
            snap_delta_ms: delta,
            grid_position: grid_pos,
            assigned_notes: notes,
            reasoning: reason_parts.join(" "),
        }
    }
}
