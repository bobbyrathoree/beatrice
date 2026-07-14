// Explainability module
// Aggregates pipeline data to provide transparency into AI decision making

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::arranger::Arrangement;
use crate::events::{ClassScore, Event, EventClass, EventFeatures};
use crate::groove::quantize::QuantizedEvent;

/// A simplified representation of a note assigned to an instrument lane
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
    /// Per-class classifier scores, sorted descending (winner first). Empty for
    /// older persisted decisions that predate score threading (`serde(default)`).
    #[serde(default)]
    pub all_scores: Vec<ClassScore>,

    pub reasoning: String,
}

/// Describe how a hit's timing was adjusted during quantization.
///
/// `snap_delta_ms = quantized_timestamp - original_timestamp`. A positive delta
/// means the note was pulled *later* to reach the grid, which means the user
/// actually hit *early*. A negative delta means the note was pulled *earlier*,
/// so the user hit *late*.
pub fn timing_description(snap_delta_ms: f64) -> String {
    if snap_delta_ms.abs() < 1.0 {
        "perfect timing".to_string()
    } else if snap_delta_ms > 0.0 {
        // Note was pulled later to reach the grid => the user hit early.
        format!("early by {:.1}ms", snap_delta_ms)
    } else {
        // Note was pulled earlier to reach the grid => the user hit late.
        format!("late by {:.1}ms", snap_delta_ms.abs())
    }
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

        // 1. Detection — use the real per-class scores when present so we can
        // name the actual runner-up ("chose X over Y"). Sorted descending so
        // the UI can render winner-first score bars from the same vector.
        let mut sorted_scores = event.all_scores.clone();
        sorted_scores.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        if sorted_scores.len() >= 2 {
            reason_parts.push(format!(
                "Classified as {} ({:.0}%), over runner-up {} ({:.0}%).",
                sorted_scores[0].class.display_name(),
                sorted_scores[0].score * 100.0,
                sorted_scores[1].class.display_name(),
                sorted_scores[1].score * 100.0,
            ));
        } else {
            // No score vector (e.g. legacy rows / KNN path) — fall back to the
            // single confidence value.
            reason_parts.push(format!(
                "Classified as {} ({}% confidence) based on features.",
                event.class.display_name(),
                (event.confidence * 100.0) as u32
            ));
        }

        // 2. Quantization
        let (q_ts, delta, grid_pos) = if let Some(q) = quantized {
            let pos = format!("{}.{}.{}", q.grid_position.bar + 1, q.grid_position.beat + 1, q.grid_position.subdivision + 1);
            
            let timing_desc = timing_description(q.snap_delta_ms);

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
                                midi_note: note.midi_note.unwrap_or(lane.midi_note),
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
            all_scores: sorted_scores,
            reasoning: reason_parts.join(" "),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_event_with_class(class: EventClass) -> Event {
        Event::new(1000.0, 50.0, class, 0.71, EventFeatures::zero())
    }

    #[test]
    fn decision_carries_real_scores_and_names_runner_up() {
        let mut event = test_event_with_class(EventClass::Click);
        event.all_scores = vec![
            ClassScore { class: EventClass::Click, score: 0.71 },
            ClassScore { class: EventClass::HihatNoise, score: 0.55 },
            ClassScore { class: EventClass::BilabialPlosive, score: 0.10 },
            ClassScore { class: EventClass::HumVoiced, score: 0.05 },
        ];
        let d = EventDecision::from_pipeline_data(&event, None, None);
        assert_eq!(d.all_scores.len(), 4);
        // Runner-up is HihatNoise, whose display_name is "S/TS (Hi-hat)".
        // (Deviation from brief: assert on "Hi-hat" — the actual display_name —
        // rather than "Hihat", since display_name() is what the reasoning uses.)
        assert!(
            d.reasoning.contains("Hi-hat"),
            "reasoning must name the actual runner-up: {}",
            d.reasoning
        );
        // The chosen class must be named first (highest score).
        assert!(d.reasoning.contains("T/K (Snare)"));
    }

    #[test]
    fn decision_all_scores_sorted_descending() {
        let mut event = test_event_with_class(EventClass::Click);
        event.all_scores = vec![
            ClassScore { class: EventClass::BilabialPlosive, score: 0.10 },
            ClassScore { class: EventClass::Click, score: 0.71 },
            ClassScore { class: EventClass::HihatNoise, score: 0.55 },
            ClassScore { class: EventClass::HumVoiced, score: 0.05 },
        ];
        let d = EventDecision::from_pipeline_data(&event, None, None);
        let scores: Vec<f32> = d.all_scores.iter().map(|s| s.score).collect();
        let mut sorted = scores.clone();
        sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
        assert_eq!(scores, sorted, "all_scores must be sorted descending");
        assert_eq!(d.all_scores[0].class, EventClass::Click);
    }

    #[test]
    fn timing_label_matches_delta_sign() {
        // snap_delta_ms = quantized - original; a positive delta means the note
        // was pulled later, which means the user hit EARLY.
        assert!(timing_description(25.0).contains("early")); // moved +25ms later => user was early
        assert!(timing_description(-25.0).contains("late")); // moved -25ms earlier => user was late
    }

    #[test]
    fn timing_label_near_zero_is_perfect() {
        assert_eq!(timing_description(0.0), "perfect timing");
        assert_eq!(timing_description(0.5), "perfect timing");
    }
}
