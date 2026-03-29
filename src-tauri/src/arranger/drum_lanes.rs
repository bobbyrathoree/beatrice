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

    /// MIDI note override (if None, use lane's default)
    pub midi_note: Option<u8>,

    /// Link back to original event (if applicable)
    pub source_event_id: Option<Uuid>,
}

impl ArrangedNote {
    /// Create a new arranged note
    pub fn new(
        timestamp_ms: f64,
        duration_ms: f64,
        velocity: u8,
        midi_note: Option<u8>,
        source_event_id: Option<Uuid>,
    ) -> Self {
        ArrangedNote {
            timestamp_ms,
            duration_ms,
            velocity: velocity.clamp(1, 127),
            midi_note,
            source_event_id,
        }
    }

    /// Create from a quantized event with default duration
    pub fn from_quantized_event(event: &QuantizedEvent, velocity: u8) -> Self {
        ArrangedNote::new(
            event.quantized_timestamp_ms,
            event.original_event.duration_ms.min(100.0), // Cap at 100ms for drum hits
            velocity,
            None, // Use lane's default MIDI note
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

    /// Expand a base pattern into a full song with 4 sections:
    /// - Intro:  Kick + Hihat only
    /// - Build:  Kick + Hihat + Snare + Bass
    /// - Drop:   Everything (all lanes)
    /// - Outro:  Bass only, velocity fading out
    ///
    /// The base pattern is repeated 4 times. Each section applies a mute mask
    /// that filters which lanes are active. The result is a complete arrangement
    /// that matches what users hear during playback.
    pub fn expand_to_song(&self) -> Arrangement {
        let base_duration = self.total_duration_ms;
        let base_bars = self.bar_count;
        let song_bars = base_bars * 4;
        let song_duration = base_duration * 4.0;

        let mut song = Arrangement::new(self.template, song_duration, song_bars);

        // Helper: clone a lane's events into a section, offset by section start time
        let clone_lane_to_section = |lane: &DrumLane, section: usize, fade: bool| -> Vec<ArrangedNote> {
            let offset = section as f64 * base_duration;
            lane.events.iter().map(|note| {
                let mut cloned = note.clone();
                cloned.timestamp_ms += offset;
                if fade {
                    // Outro fade: velocity decreases linearly across the section
                    let progress = (note.timestamp_ms / base_duration) as f32;
                    let fade_factor = (1.0f32 - progress).max(0.2);
                    cloned.velocity = ((cloned.velocity as f32 * fade_factor) as u8).max(1);
                }
                cloned
            }).collect()
        };

        // Determine which lane name matches which instrument group
        let is_kick = |name: &str| name.to_uppercase().contains("KICK");
        let is_hihat = |name: &str| {
            let n = name.to_uppercase();
            n.contains("HIHAT") || n.contains("HAT")
        };
        let is_snare = |name: &str| {
            let n = name.to_uppercase();
            n.contains("SNARE") || n.contains("CLAP")
        };

        // Expand drum lanes
        for base_lane in &self.drum_lanes {
            let mut expanded = DrumLane::new(&base_lane.name, base_lane.midi_note);

            for section in 0..4 {
                let should_include = match section {
                    0 => is_kick(&base_lane.name) || is_hihat(&base_lane.name), // Intro
                    1 => is_kick(&base_lane.name) || is_hihat(&base_lane.name) || is_snare(&base_lane.name), // Build
                    2 => true, // Drop: all drums
                    3 => false, // Outro: no drums
                    _ => false,
                };

                if should_include {
                    expanded.events.extend(clone_lane_to_section(base_lane, section, false));
                }
            }

            expanded.sort_by_time();
            song.add_drum_lane(expanded);
        }

        // Expand bass lane
        if let Some(ref base_bass) = self.bass_lane {
            let mut expanded = DrumLane::new(&base_bass.name, base_bass.midi_note);
            for section in 0..4 {
                let should_include = match section {
                    0 => false,  // Intro: no bass
                    1 => true,   // Build: bass enters
                    2 => true,   // Drop: bass
                    3 => true,   // Outro: bass with fade
                    _ => false,
                };
                if should_include {
                    let fade = section == 3;
                    expanded.events.extend(clone_lane_to_section(base_bass, section, fade));
                }
            }
            expanded.sort_by_time();
            song.bass_lane = Some(expanded);
        }

        // Expand pad lane
        if let Some(ref base_pad) = self.pad_lane {
            let mut expanded = DrumLane::new(&base_pad.name, base_pad.midi_note);
            for section in 0..4 {
                // Pads only in Drop
                if section == 2 {
                    expanded.events.extend(clone_lane_to_section(base_pad, section, false));
                }
            }
            expanded.sort_by_time();
            song.pad_lane = Some(expanded);
        }

        // Expand arp lane
        if let Some(ref base_arp) = self.arp_lane {
            let mut expanded = DrumLane::new(&base_arp.name, base_arp.midi_note);
            for section in 0..4 {
                // Arp only in Drop
                if section == 2 {
                    expanded.events.extend(clone_lane_to_section(base_arp, section, false));
                }
            }
            expanded.sort_by_time();
            song.arp_lane = Some(expanded);
        }

        song
    }
}

use crate::themes::{Theme, scale_notes, chord_notes, bass_notes, arp_notes};

/// Arrange events according to template rules and harmonic context
///
/// This function maps detected events to instrument lanes based on:
/// - Event classification (BilabialPlosive -> KICK, etc.)
/// - Template rules (which positions get which instruments)
/// - Theme's harmonic context (Scale, Chord Progression)
/// - B-emphasis parameter (controls synth note triggering)
pub fn arrange_events(
    events: &[QuantizedEvent],
    template: &ArrangementTemplate,
    grid: &Grid,
    theme: &Theme,
    b_emphasis: f32,
) -> Arrangement {
    let rules = template.rules();
    let total_duration = grid.total_duration_ms();

    let mut arrangement = Arrangement::new(*template, total_duration, grid.bar_count);

    // Create drum lanes (Standard GM MIDI notes)
    let mut kick_lane = DrumLane::new("DRUMS_KICK", MIDI_KICK);
    let mut snare_lane = DrumLane::new("DRUMS_SNARE", MIDI_SNARE);
    let mut hihat_lane = DrumLane::new("DRUMS_HIHAT", MIDI_CLOSED_HIHAT);

    // Instrument lanes - notes will be resolved per-event from theme
    let mut bass_lane = DrumLane::new("BASS", 36); // Default C2
    let mut pad_lane = DrumLane::new("PADS", 48);  // Default C3
    let mut arp_lane = DrumLane::new("ARP", 60);   // Default C4

    // Pre-calculate scale notes for the theme
    let scale = scale_notes(theme.root_note, &theme.scale_family);

    // Track arpeggio position for "Rhythmic Puppeteering"
    let mut arp_counter = 0;

    // Process each event
    for event in events {
        let timestamp = event.quantized_timestamp_ms;

        // Resolve harmonic context for this specific moment
        let chord_type = theme.get_chord_at_time(timestamp, grid);
        let current_chord = chord_notes(theme.root_note, &chord_type, &scale);
        let chord_root = current_chord[0];

        match event.original_event.class {
            EventClass::BilabialPlosive => {
                // B/P sounds -> Kick + Bass Synth
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

                    // Resolve bass note based on theme pattern and beat position
                    let pattern_notes = bass_notes(chord_root, &theme.bass_pattern);
                    let note_index = (event.grid_position.beat as usize + event.grid_position.subdivision as usize) % pattern_notes.len();
                    let bass_note = pattern_notes[note_index] - 12; // Shift down an octave for bass

                    bass_lane.add_note(ArrangedNote::new(
                        timestamp,
                        200.0, // Standard bass duration
                        bass_velocity,
                        Some(bass_note),
                        Some(event.original_event.id),
                    ));
                }
            }

            EventClass::Click => {
                // T/K sounds -> Snare
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                if should_place_on_beat(&event.grid_position, &rules.snare_positions, grid) {
                    snare_lane.add_note(ArrangedNote::from_quantized_event(event, velocity));
                }
            }

            EventClass::HihatNoise => {
                // S/TS sounds -> Hi-hats or Arpeggio triggers
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                // 1. Classic hi-hat placement
                if should_place_hihat(&event.grid_position, &rules.hihat_density) {
                    hihat_lane.add_note(ArrangedNote::from_quantized_event(event, velocity));
                }

                // 2. Rhythmic Puppeteering (Arpeggios)
                // If template is ArpDrive, hi-hats advance the arpeggiator
                if *template == ArrangementTemplate::ArpDrive {
                    let arp_sequence = arp_notes(&current_chord, &theme.arp_pattern, theme.arp_octave_range);
                    if !arp_sequence.is_empty() {
                        let note_index = arp_counter % arp_sequence.len();
                        let arp_note = arp_sequence[note_index];
                        
                        arp_lane.add_note(ArrangedNote::new(
                            timestamp,
                            150.0, // Short, plucky arpeggio duration
                            (velocity as f32 * 0.9) as u8,
                            Some(arp_note),
                            Some(event.original_event.id),
                        ));
                        
                        arp_counter += 1;
                    }
                }
            }

            EventClass::HumVoiced => {
                // Voiced sounds -> Pads (Layered triad)
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                let duration = event.original_event.duration_ms.max(400.0);

                // Add each note of the chord to the pad lane
                for &note in &current_chord {
                    pad_lane.add_note(ArrangedNote::new(
                        timestamp,
                        duration,
                        (velocity as f32 * 0.8) as u8, // Slightly softer pads
                        Some(note),
                        Some(event.original_event.id),
                    ));
                }
            }
        }
    }

    // Sort all lanes by time
    kick_lane.sort_by_time();
    snare_lane.sort_by_time();
    hihat_lane.sort_by_time();
    bass_lane.sort_by_time();
    pad_lane.sort_by_time();
    arp_lane.sort_by_time();

    // Add lanes to arrangement
    arrangement.add_drum_lane(kick_lane);
    arrangement.add_drum_lane(snare_lane);
    arrangement.add_drum_lane(hihat_lane);
    arrangement.bass_lane = Some(bass_lane);
    arrangement.pad_lane = Some(pad_lane);
    arrangement.arp_lane = Some(arp_lane);

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

        let note = ArrangedNote::new(100.0, 50.0, 100, None, None);
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
        let theme = crate::themes::get_theme("BLADE RUNNER").unwrap();

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

        let arrangement = arrange_events(&events, &template, &grid, &theme, 0.5);

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
        let theme = crate::themes::get_theme("BLADE RUNNER").unwrap();

        let events = vec![
            create_quantized_event(
                create_test_event(0.0, EventClass::BilabialPlosive),
                GridPosition { bar: 0, beat: 0, subdivision: 0 },
            ),
        ];

        // High b_emphasis should trigger bass
        let arrangement_high = arrange_events(&events, &template, &grid, &theme, 0.8);
        assert!(arrangement_high.bass_lane.is_some());
        assert!(arrangement_high.bass_lane.as_ref().unwrap().events.len() > 0);

        // Low b_emphasis should not trigger bass
        let arrangement_low = arrange_events(&events, &template, &grid, &theme, 0.2);
        assert!(arrangement_low.bass_lane.is_some());
        assert_eq!(arrangement_low.bass_lane.as_ref().unwrap().events.len(), 0);
    }

    #[test]
    fn test_arp_drive_rhythmic_puppeteering() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Sixteenth, 1);
        let template = ArrangementTemplate::ArpDrive;
        let theme = crate::themes::get_theme("STRANGER THINGS").unwrap();

        // 3 hi-hat events in a row
        let events = vec![
            create_quantized_event(
                create_test_event(0.0, EventClass::HihatNoise),
                GridPosition { bar: 0, beat: 0, subdivision: 0 },
            ),
            create_quantized_event(
                create_test_event(125.0, EventClass::HihatNoise),
                GridPosition { bar: 0, beat: 0, subdivision: 1 },
            ),
            create_quantized_event(
                create_test_event(250.0, EventClass::HihatNoise),
                GridPosition { bar: 0, beat: 0, subdivision: 2 },
            ),
        ];

        let arrangement = arrange_events(&events, &template, &grid, &theme, 0.5);

        // Arp lane should exist and have 3 notes
        assert!(arrangement.arp_lane.is_some());
        let arp_events = &arrangement.arp_lane.as_ref().unwrap().events;
        assert_eq!(arp_events.len(), 3);

        // They should have different MIDI notes (walking up the arpeggio)
        let note1 = arp_events[0].midi_note.unwrap();
        let note2 = arp_events[1].midi_note.unwrap();
        let note3 = arp_events[2].midi_note.unwrap();

        assert_ne!(note1, note2);
        assert_ne!(note2, note3);
    }
}
