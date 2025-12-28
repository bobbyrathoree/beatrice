// Soft Quantization - Preserves human feel while aligning to musical grid
// Implements strength-based quantization with swing support

use serde::{Deserialize, Serialize};
use crate::events::Event;
use super::grid::{Grid, GridPosition};

/// Settings for quantization behavior
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantizeSettings {
    /// Quantization strength [0.0, 1.0]
    /// 0.0 = no quantization (preserve original timing)
    /// 1.0 = full snap to grid
    /// 0.5 = halfway between original and grid
    pub strength: f32,

    /// Swing amount [0.0, 1.0] - delays off-beats
    /// 0.0 = straight timing
    /// 0.5 = typical swing feel
    /// 1.0 = maximum swing
    pub swing_amount: f32,

    /// Lookahead window in milliseconds
    /// How far ahead to search for matching grid position
    pub lookahead_ms: f64,
}

impl Default for QuantizeSettings {
    fn default() -> Self {
        QuantizeSettings {
            strength: 0.8,
            swing_amount: 0.0,
            lookahead_ms: 100.0,
        }
    }
}

/// A quantized event with both original and quantized timing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantizedEvent {
    /// The original event data
    pub original_event: Event,

    /// Original timestamp before quantization
    pub original_timestamp_ms: f64,

    /// Quantized timestamp after grid alignment
    pub quantized_timestamp_ms: f64,

    /// How much the event moved (positive = later, negative = earlier)
    pub snap_delta_ms: f64,

    /// Position on the musical grid
    pub grid_position: GridPosition,
}

/// Quantize a list of events to a musical grid
///
/// Algorithm:
/// 1. For each event, find nearest grid position
/// 2. Apply strength factor to blend original and grid timing
/// 3. Preserve relative timing within small groups (grace notes)
/// 4. Handle swing timing for off-beats
pub fn quantize_events(
    events: &[Event],
    grid: &Grid,
    settings: &QuantizeSettings,
) -> Vec<QuantizedEvent> {
    if events.is_empty() {
        return Vec::new();
    }

    let mut quantized = Vec::new();

    // Identify groups of closely-spaced events (grace notes, flams, etc.)
    let groups = identify_event_groups(events, 30.0); // 30ms threshold for grouping

    for group in groups {
        let group_events: Vec<&Event> = group.iter().map(|&idx| &events[idx]).collect();

        // Quantize the first event in the group to the grid
        let first_event = group_events[0];
        let first_quantized = quantize_single_event(first_event, grid, settings);

        quantized.push(first_quantized.clone());

        // For remaining events in group, preserve their relative timing
        if group_events.len() > 1 {
            let time_delta = first_quantized.quantized_timestamp_ms - first_event.timestamp_ms;

            for &event in &group_events[1..] {
                let quantized_timestamp = event.timestamp_ms + time_delta;
                let grid_position = grid.get_grid_position(quantized_timestamp);

                quantized.push(QuantizedEvent {
                    original_event: event.clone(),
                    original_timestamp_ms: event.timestamp_ms,
                    quantized_timestamp_ms: quantized_timestamp,
                    snap_delta_ms: time_delta,
                    grid_position,
                });
            }
        }
    }

    // Sort by quantized timestamp
    quantized.sort_by(|a, b| {
        a.quantized_timestamp_ms
            .partial_cmp(&b.quantized_timestamp_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    quantized
}

/// Quantize a single event to the grid
fn quantize_single_event(
    event: &Event,
    grid: &Grid,
    settings: &QuantizeSettings,
) -> QuantizedEvent {
    let original_timestamp = event.timestamp_ms;

    // Find nearest grid position
    let (grid_timestamp, _) = grid.get_nearest_beat(original_timestamp);

    // Apply quantization strength
    // strength = 0.0 -> use original timestamp
    // strength = 1.0 -> use grid timestamp
    let strength = settings.strength.clamp(0.0, 1.0);
    let quantized_timestamp = original_timestamp + (grid_timestamp - original_timestamp) * strength as f64;

    // Calculate snap delta
    let snap_delta = quantized_timestamp - original_timestamp;

    // Get grid position
    let grid_position = grid.get_grid_position(quantized_timestamp);

    QuantizedEvent {
        original_event: event.clone(),
        original_timestamp_ms: original_timestamp,
        quantized_timestamp_ms: quantized_timestamp,
        snap_delta_ms: snap_delta,
        grid_position,
    }
}

/// Identify groups of closely-spaced events
/// Returns groups as vectors of event indices
fn identify_event_groups(events: &[Event], threshold_ms: f64) -> Vec<Vec<usize>> {
    if events.is_empty() {
        return Vec::new();
    }

    let mut groups = Vec::new();
    let mut current_group = vec![0];

    for i in 1..events.len() {
        let time_gap = events[i].timestamp_ms - events[i - 1].timestamp_ms;

        if time_gap <= threshold_ms {
            // Add to current group
            current_group.push(i);
        } else {
            // Start new group
            groups.push(current_group);
            current_group = vec![i];
        }
    }

    // Add final group
    if !current_group.is_empty() {
        groups.push(current_group);
    }

    groups
}

/// Apply swing timing to quantized events
/// Delays off-beat events based on swing amount
pub fn apply_swing(
    quantized_events: &mut [QuantizedEvent],
    grid: &Grid,
    swing_amount: f32,
) {
    if swing_amount <= 0.0 {
        return;
    }

    let ms_per_beat = 60000.0 / grid.bpm;
    let swing_amount = swing_amount.clamp(0.0, 1.0);

    for event in quantized_events.iter_mut() {
        // Check if this is an off-beat (subdivision 1, 3, 5, etc.)
        if event.grid_position.subdivision % 2 == 1 {
            // Calculate swing delay
            // Typical swing delays the off-beat by up to 33% of the subdivision duration
            let subdivision_duration = ms_per_beat / grid.division.subdivisions_per_beat() as f64;
            let max_swing_delay = subdivision_duration * 0.33;
            let swing_delay = max_swing_delay * swing_amount as f64;

            // Apply swing delay
            event.quantized_timestamp_ms += swing_delay;
            event.snap_delta_ms += swing_delay;
        }
    }
}

/// Create humanized timing variations
/// Adds subtle random variations to prevent robotic feel
pub fn humanize_timing(
    quantized_events: &mut [QuantizedEvent],
    amount: f32,
    rng_seed: u64,
) {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hash, Hasher};

    let amount = amount.clamp(0.0, 1.0);
    if amount <= 0.0 {
        return;
    }

    let max_variation_ms = 5.0 * amount as f64; // Up to 5ms variation

    for (i, event) in quantized_events.iter_mut().enumerate() {
        // Generate pseudo-random value based on event index and seed
        let hasher = RandomState::new().build_hasher();
        let mut hasher = hasher;
        rng_seed.hash(&mut hasher);
        i.hash(&mut hasher);
        let hash = hasher.finish();

        // Convert hash to [-1.0, 1.0] range
        let normalized = ((hash % 10000) as f64 / 10000.0) * 2.0 - 1.0;

        // Apply variation
        let variation = normalized * max_variation_ms;
        event.quantized_timestamp_ms += variation;
        event.snap_delta_ms += variation;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{EventClass, EventFeatures};
    use crate::groove::grid::{TimeSignature, GridDivision, GrooveFeel};

    fn create_test_event(timestamp_ms: f64) -> Event {
        Event::new(
            timestamp_ms,
            50.0,
            EventClass::Click,
            0.9,
            EventFeatures::zero(),
        )
    }

    #[test]
    fn test_quantize_single_event() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);
        let settings = QuantizeSettings {
            strength: 1.0, // Full quantization
            swing_amount: 0.0,
            lookahead_ms: 100.0,
        };

        let event = create_test_event(520.0); // Slightly after second beat (500ms)
        let quantized = quantize_single_event(&event, &grid, &settings);

        // Should snap to 500ms (second beat)
        assert!((quantized.quantized_timestamp_ms - 500.0).abs() < 1.0);
        assert!(quantized.snap_delta_ms < 0.0); // Moved earlier
    }

    #[test]
    fn test_quantize_with_partial_strength() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);
        let settings = QuantizeSettings {
            strength: 0.5, // 50% quantization
            swing_amount: 0.0,
            lookahead_ms: 100.0,
        };

        let event = create_test_event(520.0); // 20ms after grid position (500ms)
        let quantized = quantize_single_event(&event, &grid, &settings);

        // Should move halfway: 520 - (520-500)*0.5 = 510
        assert!((quantized.quantized_timestamp_ms - 510.0).abs() < 1.0);
    }

    #[test]
    fn test_identify_event_groups() {
        let events = vec![
            create_test_event(0.0),
            create_test_event(10.0),  // Close to previous (group 1)
            create_test_event(500.0), // Far from previous (group 2)
            create_test_event(505.0), // Close to previous (group 2)
        ];

        let groups = identify_event_groups(&events, 30.0);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0], vec![0, 1]);
        assert_eq!(groups[1], vec![2, 3]);
    }

    #[test]
    fn test_quantize_events_preserves_groups() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);
        let settings = QuantizeSettings {
            strength: 1.0,
            swing_amount: 0.0,
            lookahead_ms: 100.0,
        };

        let events = vec![
            create_test_event(490.0),
            create_test_event(495.0), // Grace note, 5ms after first
        ];

        let quantized = quantize_events(&events, &grid, &settings);

        // Both events should be quantized, but maintain ~5ms spacing
        let spacing = quantized[1].quantized_timestamp_ms - quantized[0].quantized_timestamp_ms;
        assert!((spacing - 5.0).abs() < 1.0);
    }

    #[test]
    fn test_apply_swing() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Eighth, 1);
        let settings = QuantizeSettings::default();

        let events = vec![
            create_test_event(0.0),   // On-beat
            create_test_event(250.0), // Off-beat
            create_test_event(500.0), // On-beat
        ];

        let mut quantized = quantize_events(&events, &grid, &settings);
        let off_beat_before = quantized[1].quantized_timestamp_ms;

        apply_swing(&mut quantized, &grid, 0.5);

        // Off-beat should be delayed
        assert!(quantized[1].quantized_timestamp_ms > off_beat_before);

        // On-beats should remain unchanged
        assert!((quantized[0].quantized_timestamp_ms - 0.0).abs() < 1.0);
    }

    #[test]
    fn test_zero_strength_preserves_timing() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);
        let settings = QuantizeSettings {
            strength: 0.0, // No quantization
            swing_amount: 0.0,
            lookahead_ms: 100.0,
        };

        let event = create_test_event(520.0);
        let quantized = quantize_single_event(&event, &grid, &settings);

        // Should preserve original timestamp
        assert!((quantized.quantized_timestamp_ms - 520.0).abs() < 0.01);
        assert!(quantized.snap_delta_ms.abs() < 0.01);
    }
}
