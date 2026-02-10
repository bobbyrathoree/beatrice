// Drum Lanes - Maps detected events to instrument lanes based on template rules
// Converts classified events into arranged musical notes

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::events::{Event, EventClass};
use crate::groove::quantize::QuantizedEvent;
use crate::groove::grid::{Grid, GridPosition};
use super::templates::{ArrangementTemplate, TemplateRules, HihatDensity};

/// General Music MIDI note numbers for drums
pub const MIDI_KICK: u8 = 36;       // C1
pub const MIDI_SNARE: u8 = 38;      // D1
pub const MIDI_CLAP: u8 = 39;       // D#1
pub const MIDI_CLOSED_HIHAT: u8 = 42; // F#1
pub const MIDI_OPEN_HIHAT: u8 = 46;  // A#1

/// A drum/instrument lane containing arranged notes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrumLane {
    /// Lane name (e.g., "KICK", "SNARE", "HIHAT")
    pub name: String,

    /// MIDI note number for this lane
    pub midi_note: u8,

    /// All notes in this lane
    pub events: Vec<ArrangedNote>,
}

impl DrumLane {
    /// Create a new empty drum lane
    pub fn new(name: impl Into<String>, midi_note: u8) -> Self {
        DrumLane {
            name: name.into(),
            midi_note,
            events: Vec::new(),
        }
    }

    /// Add a note to this lane
    pub fn add_note(&mut self, note: ArrangedNote) {
        self.events.push(note);
    }

    /// Sort notes by timestamp
    pub fn sort_by_time(&mut self) {
        self.events.sort_by(|a, b| {
            a.timestamp_ms
                .partial_cmp(&b.timestamp_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }
}

/// An arranged note with timing and MIDI parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArrangedNote {
    /// Timestamp in milliseconds
    pub timestamp_ms: f64,

    /// Duration in milliseconds
    pub duration_ms: f64,

    /// MIDI velocity (0-127)
    pub velocity: u8,

    /// Link back to original event (if applicable)
    pub source_event_id: Option<Uuid>,
}

impl ArrangedNote {
    /// Create a new arranged note
    pub fn new(
        timestamp_ms: f64,
        duration_ms: f64,
        velocity: u8,
        source_event_id: Option<Uuid>,
    ) -> Self {
        ArrangedNote {
            timestamp_ms,
            duration_ms,
            velocity: velocity.clamp(1, 127),
            source_event_id,
        }
    }

    /// Create from a quantized event with default duration
    pub fn from_quantized_event(event: &QuantizedEvent, velocity: u8) -> Self {
        ArrangedNote::new(
            event.quantized_timestamp_ms,
            event.original_event.duration_ms.min(100.0), // Cap at 100ms for drum hits
            velocity,
            Some(event.original_event.id),
        )
    }
}

/// Complete arrangement with all lanes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arrangement {
    /// Drum lanes (kick, snare, hihat, etc.)
    pub drum_lanes: Vec<DrumLane>,

    /// Bass lane (for bass synth notes)
    pub bass_lane: Option<DrumLane>,

    /// Pad lane (for sustained synth pads)
    pub pad_lane: Option<DrumLane>,

    /// Arpeggiator lane
    pub arp_lane: Option<DrumLane>,

    /// Arrangement metadata
    pub template: ArrangementTemplate,
    pub total_duration_ms: f64,
    pub bar_count: u32,
}

impl Arrangement {
    /// Create a new empty arrangement
    pub fn new(template: ArrangementTemplate, total_duration_ms: f64, bar_count: u32) -> Self {
        Arrangement {
            drum_lanes: Vec::new(),
            bass_lane: None,
            pad_lane: None,
            arp_lane: None,
            template,
            total_duration_ms,
            bar_count,
        }
    }

    /// Add a drum lane
    pub fn add_drum_lane(&mut self, lane: DrumLane) {
        self.drum_lanes.push(lane);
    }

    /// Get all lanes as a flat list (for MIDI export)
    pub fn all_lanes(&self) -> Vec<&DrumLane> {
        let mut lanes = Vec::new();
        lanes.extend(self.drum_lanes.iter());
        if let Some(ref bass) = self.bass_lane {
            lanes.push(bass);
        }
        if let Some(ref pad) = self.pad_lane {
            lanes.push(pad);
        }
        if let Some(ref arp) = self.arp_lane {
            lanes.push(arp);
        }
        lanes
    }
}

/// Arrange events according to template rules
///
/// This function maps detected events to instrument lanes based on:
/// - Event classification (BilabialPlosive -> KICK, etc.)
/// - Template rules (which positions get which instruments)
/// - B-emphasis parameter (controls synth note triggering)
///
/// # Arguments
/// * `events` - Quantized events from groove engine
/// * `template` - Arrangement template defining the style
/// * `grid` - Musical grid for timing calculations
/// * `b_emphasis` - How strongly B sounds trigger synth notes [0.0, 1.0]
pub fn arrange_events(
    events: &[QuantizedEvent],
    template: &ArrangementTemplate,
    grid: &Grid,
    b_emphasis: f32,
) -> Arrangement {
    let rules = template.rules();
    let total_duration = grid.total_duration_ms();

    let mut arrangement = Arrangement::new(*template, total_duration, grid.bar_count);

    // Create drum lanes
    let mut kick_lane = DrumLane::new("DRUMS_KICK", MIDI_KICK);
    let mut snare_lane = DrumLane::new("DRUMS_SNARE", MIDI_SNARE);
    let mut hihat_lane = DrumLane::new("DRUMS_HIHAT", MIDI_CLOSED_HIHAT);
    let mut bass_lane = DrumLane::new("BASS", 36); // Bass synth (will use different MIDI note range)
    let mut pad_lane = DrumLane::new("PADS", 48);  // Pad synth

    // Process each event
    for event in events {
        match event.original_event.class {
            EventClass::BilabialPlosive => {
                // B/P sounds -> Kick + potentially bass synth
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                // Always add to kick lane if it matches template kick positions
                if should_place_on_beat(&event.grid_position, &rules.kick_positions, grid) {
                    kick_lane.add_note(ArrangedNote::from_quantized_event(event, velocity));
                }

                // Add bass synth note if b_emphasis is high enough
                if b_emphasis > 0.3 {
                    let bass_velocity = (velocity as f32 * b_emphasis) as u8;
                    bass_lane.add_note(ArrangedNote::new(
                        event.quantized_timestamp_ms,
                        200.0, // Longer duration for bass
                        bass_velocity,
                        Some(event.original_event.id),
                    ));
                }
            }

            EventClass::Click => {
                // T/K sounds -> Snare/Clap
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                if should_place_on_beat(&event.grid_position, &rules.snare_positions, grid) {
                    snare_lane.add_note(ArrangedNote::from_quantized_event(event, velocity));
                }
            }

            EventClass::HihatNoise => {
                // S/TS sounds -> Hi-hats
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                // Hi-hats follow density pattern
                if should_place_hihat(&event.grid_position, &rules.hihat_density) {
                    hihat_lane.add_note(ArrangedNote::from_quantized_event(event, velocity));
                }
            }

            EventClass::HumVoiced => {
                // Voiced sounds -> Pads
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                pad_lane.add_note(ArrangedNote::new(
                    event.quantized_timestamp_ms,
                    event.original_event.duration_ms.max(300.0), // Sustained pad notes
                    velocity,
                    Some(event.original_event.id),
                ));
            }
        }
    }

    // Sort all lanes by time
    kick_lane.sort_by_time();
    snare_lane.sort_by_time();
    hihat_lane.sort_by_time();
    bass_lane.sort_by_time();
    pad_lane.sort_by_time();

    // Add lanes to arrangement
    arrangement.add_drum_lane(kick_lane);
    arrangement.add_drum_lane(snare_lane);
    arrangement.add_drum_lane(hihat_lane);
    arrangement.bass_lane = Some(bass_lane);
    arrangement.pad_lane = Some(pad_lane);

    arrangement
}

/// Calculate MIDI velocity based on confidence and peak amplitude
///
/// Blends confidence (30%) with peak amplitude (70%) so that louder
/// beatbox sounds produce louder MIDI notes while still rewarding
/// confident classifications. The result is mapped to a configurable
/// MIDI velocity range (default 60-127 for dynamic but always-audible output).
fn calculate_velocity(confidence: f32, peak_amplitude: f32) -> u8 {
    let conf = confidence.clamp(0.0, 1.0);
    let amp = peak_amplitude.clamp(0.0, 1.0);
    let factor = (conf * 0.3 + amp * 0.7).clamp(0.0, 1.0);

    // Map to MIDI velocity range 60-127
    let min_velocity: f32 = 60.0;
    let max_velocity: f32 = 127.0;
    let velocity = min_velocity + factor * (max_velocity - min_velocity);
    (velocity as u8).clamp(1, 127)
}

/// Check if an event should be placed on a specific beat based on template positions
fn should_place_on_beat(
    position: &GridPosition,
    template_positions: &[GridPosition],
    grid: &Grid,
) -> bool {
    if template_positions.is_empty() {
        return true; // If no template positions, allow all
    }

    // Check if this position matches any template position (modulo bar)
    let beats_per_bar = grid.time_signature.beats_per_bar();

    for template_pos in template_positions {
        // Check if beat and subdivision match (ignore bar number for pattern repetition)
        if position.beat % beats_per_bar == template_pos.beat % beats_per_bar
            && position.subdivision == template_pos.subdivision
        {
            return true;
        }
    }

    false
}

/// Check if a hi-hat should be placed based on density rules
fn should_place_hihat(position: &GridPosition, density: &HihatDensity) -> bool {
    match density {
        HihatDensity::Sparse => {
            // Only on downbeats (subdivision 0)
            position.subdivision == 0
        }
        HihatDensity::Eighth => {
            // All eighth notes (even subdivisions if sixteenth grid)
            position.subdivision % 2 == 0
        }
        HihatDensity::Sixteenth => {
            // All sixteenth notes
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{EventFeatures, EventClass};
    use crate::groove::grid::{Grid, TimeSignature, GridDivision};

    fn create_test_event(timestamp_ms: f64, class: EventClass) -> Event {
        Event::new(
            timestamp_ms,
            50.0,
            class,
            0.9,
            EventFeatures::zero(),
        )
    }

    fn create_quantized_event(event: Event, grid_position: GridPosition) -> QuantizedEvent {
        QuantizedEvent {
            original_timestamp_ms: event.timestamp_ms,
            quantized_timestamp_ms: event.timestamp_ms,
            snap_delta_ms: 0.0,
            grid_position,
            original_event: event,
        }
    }

    #[test]
    fn test_drum_lane_creation() {
        let mut lane = DrumLane::new("TEST_KICK", MIDI_KICK);
        assert_eq!(lane.name, "TEST_KICK");
        assert_eq!(lane.midi_note, MIDI_KICK);
        assert_eq!(lane.events.len(), 0);

        let note = ArrangedNote::new(100.0, 50.0, 100, None);
        lane.add_note(note);
        assert_eq!(lane.events.len(), 1);
    }

    #[test]
    fn test_calculate_velocity() {
        // Zero confidence and zero amplitude -> minimum velocity (60)
        assert_eq!(calculate_velocity(0.0, 0.0), 60);
        // Max confidence and max amplitude -> maximum velocity (127)
        assert_eq!(calculate_velocity(1.0, 1.0), 127);
        // Loud hit with moderate confidence:
        //   factor = 0.5 * 0.3 + 0.8 * 0.7 = 0.15 + 0.56 = 0.71
        //   velocity = 60 + 0.71 * 67 = 60 + 47.57 = 107
        assert_eq!(calculate_velocity(0.5, 0.8), 107);
        // Quiet hit with high confidence:
        //   factor = 0.9 * 0.3 + 0.2 * 0.7 = 0.27 + 0.14 = 0.41
        //   velocity = 60 + 0.41 * 67 = 60 + 27.47 = 87
        assert_eq!(calculate_velocity(0.9, 0.2), 87);
    }

    #[test]
    fn test_should_place_on_beat() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 4);

        let template_positions = vec![
            GridPosition { bar: 0, beat: 0, subdivision: 0 }, // Beat 1
            GridPosition { bar: 0, beat: 2, subdivision: 0 }, // Beat 3
        ];

        // Should match beat 0 (beat 1)
        let pos1 = GridPosition { bar: 0, beat: 0, subdivision: 0 };
        assert!(should_place_on_beat(&pos1, &template_positions, &grid));

        // Should match beat 2 (beat 3)
        let pos2 = GridPosition { bar: 0, beat: 2, subdivision: 0 };
        assert!(should_place_on_beat(&pos2, &template_positions, &grid));

        // Should NOT match beat 1 (beat 2)
        let pos3 = GridPosition { bar: 0, beat: 1, subdivision: 0 };
        assert!(!should_place_on_beat(&pos3, &template_positions, &grid));

        // Should match in next bar (pattern repeats)
        let pos4 = GridPosition { bar: 1, beat: 0, subdivision: 0 };
        assert!(should_place_on_beat(&pos4, &template_positions, &grid));
    }

    #[test]
    fn test_should_place_hihat() {
        // Sparse - only downbeats
        let pos_downbeat = GridPosition { bar: 0, beat: 0, subdivision: 0 };
        let pos_offbeat = GridPosition { bar: 0, beat: 0, subdivision: 1 };

        assert!(should_place_hihat(&pos_downbeat, &HihatDensity::Sparse));
        assert!(!should_place_hihat(&pos_offbeat, &HihatDensity::Sparse));

        // Eighth - even subdivisions
        assert!(should_place_hihat(&pos_downbeat, &HihatDensity::Eighth));
        assert!(!should_place_hihat(&pos_offbeat, &HihatDensity::Eighth));

        // Sixteenth - all
        assert!(should_place_hihat(&pos_downbeat, &HihatDensity::Sixteenth));
        assert!(should_place_hihat(&pos_offbeat, &HihatDensity::Sixteenth));
    }

    #[test]
    fn test_arrange_events_basic() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);
        let template = ArrangementTemplate::SynthwaveStraight;

        let events = vec![
            create_quantized_event(
                create_test_event(0.0, EventClass::BilabialPlosive),
                GridPosition { bar: 0, beat: 0, subdivision: 0 },
            ),
            create_quantized_event(
                create_test_event(500.0, EventClass::Click),
                GridPosition { bar: 0, beat: 1, subdivision: 0 },
            ),
        ];

        let arrangement = arrange_events(&events, &template, &grid, 0.5);

        // Should have drum lanes
        assert!(arrangement.drum_lanes.len() >= 3);

        // Kick lane should have one event (B on beat 1)
        let kick_lane = arrangement.drum_lanes.iter().find(|l| l.name == "DRUMS_KICK").unwrap();
        assert_eq!(kick_lane.events.len(), 1);

        // Snare lane should have one event (Click on beat 2)
        let snare_lane = arrangement.drum_lanes.iter().find(|l| l.name == "DRUMS_SNARE").unwrap();
        assert_eq!(snare_lane.events.len(), 1);
    }

    #[test]
    fn test_b_emphasis_triggers_bass() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);
        let template = ArrangementTemplate::SynthwaveStraight;

        let events = vec![
            create_quantized_event(
                create_test_event(0.0, EventClass::BilabialPlosive),
                GridPosition { bar: 0, beat: 0, subdivision: 0 },
            ),
        ];

        // High b_emphasis should trigger bass
        let arrangement_high = arrange_events(&events, &template, &grid, 0.8);
        assert!(arrangement_high.bass_lane.is_some());
        assert!(arrangement_high.bass_lane.unwrap().events.len() > 0);

        // Low b_emphasis should not trigger bass
        let arrangement_low = arrange_events(&events, &template, &grid, 0.2);
        assert!(arrangement_low.bass_lane.is_some());
        assert_eq!(arrangement_low.bass_lane.unwrap().events.len(), 0);
    }
}
