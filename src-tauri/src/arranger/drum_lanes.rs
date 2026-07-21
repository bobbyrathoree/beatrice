// Drum Lanes - Maps detected events to instrument lanes based on template rules
// Converts classified events into arranged musical notes

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::events::EventClass;
use crate::groove::quantize::QuantizedEvent;
use crate::groove::grid::{Grid, GridPosition};
use super::templates::{ArrangementTemplate, HihatDensity};

/// General Music MIDI note numbers for drums
pub const MIDI_KICK: u8 = 36;       // C1
pub const MIDI_SNARE: u8 = 38;      // D1
pub const MIDI_CLAP: u8 = 39;       // D#1
pub const MIDI_CLOSED_HIHAT: u8 = 42; // F#1
pub const MIDI_OPEN_HIHAT: u8 = 46;  // A#1

/// A drum/instrument lane containing arranged notes
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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

    /// Canonical resolved theme name (post-fallback), exact bpm, and the
    /// theme's render-time sound snapshot — makes an Arrangement self-contained
    /// for playback/export.
    pub theme_name: String,
    pub bpm: f64,
    pub sound: crate::themes::ThemeSound,
}

impl Arrangement {
    /// Create a new empty arrangement
    pub fn new(
        template: ArrangementTemplate,
        total_duration_ms: f64,
        bar_count: u32,
        theme_name: String,
        bpm: f64,
        sound: crate::themes::ThemeSound,
    ) -> Self {
        Arrangement {
            drum_lanes: Vec::new(),
            bass_lane: None,
            pad_lane: None,
            arp_lane: None,
            template,
            total_duration_ms,
            bar_count,
            theme_name,
            bpm,
            sound,
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

        let mut song = Arrangement::new(
            self.template,
            song_duration,
            song_bars,
            self.theme_name.clone(),
            self.bpm,
            self.sound,
        );

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
///
/// # Fidelity (spec §4.3 — deterministic placement, replaces template gating)
///
/// `fidelity` in `[0.0, 1.0]` trades performer-faithfulness against template
/// tidiness. It NEVER deletes a detected event:
/// - `1.0` ("Follow me"): every event plays at its quantized position; templates
///   only shape velocity/duration.
/// - `0.0` ("Produce for me"): off-template hits MOVE to the nearest template
///   slot (same-slot collisions merge, louder wins) — still never dropped.
/// - between: position lerps toward the template slot by `(1 - fidelity)`, and
///   off-template velocity is attenuated proportional to distance.
///
/// SINGLE-PLACEMENT RULE: each source event is placed exactly once; every note it
/// spawns (kick + its bass note, hi-hat + its arp note, …) shares that one placed
/// time so nothing desyncs. There is no randomness anywhere — output is a pure
/// function of the inputs.
pub fn arrange_events(
    events: &[QuantizedEvent],
    template: &ArrangementTemplate,
    grid: &Grid,
    theme: &Theme,
    b_emphasis: f32,
    fidelity: f32,
) -> Arrangement {
    let rules = template.rules();
    let fidelity = fidelity.clamp(0.0, 1.0);
    let total_duration = grid.total_duration_ms();

    let mut arrangement = Arrangement::new(
        *template,
        total_duration,
        grid.bar_count,
        theme.name.clone(),
        grid.bpm,
        theme.sound,
    );

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

        match event.original_event.class {
            EventClass::BilabialPlosive => {
                // B/P sounds -> Kick + Bass Synth
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                // SINGLE PLACEMENT: compute once against the kick template, reuse
                // for both the kick note and the bass note it spawns.
                let (placed_time, vscale) =
                    place_event(timestamp, &rules.kick_positions, grid, fidelity);

                // Kick always survives; the template only shapes its velocity.
                kick_lane.add_note(ArrangedNote::new(
                    placed_time,
                    event.original_event.duration_ms.min(100.0),
                    (velocity as f32 * vscale) as u8,
                    None,
                    Some(event.original_event.id),
                ));

                // Add bass synth note if b_emphasis is high enough. It schedules at
                // the SAME placed_time so it can't desync from a moved kick, and its
                // pattern index derives from the placed position, not the raw one.
                if b_emphasis > 0.3 {
                    // Themed ceiling: source velocity scaled by b_emphasis (clamped
                    // to [0,1] here) against the theme's bass stab max velocity.
                    let bass_velocity = ((velocity as f32 / 127.0)
                        * b_emphasis.clamp(0.0, 1.0)
                        * theme.bass_stab_max_velocity as f32)
                        .round()
                        .clamp(1.0, 127.0) as u8;

                    // Harmonic context resolved at the note's actual sounding time.
                    let chord_type = theme.get_chord_at_time(placed_time, grid);
                    let current_chord = chord_notes(theme.root_note, &chord_type, &scale);
                    let chord_root = current_chord[0];
                    let placed_pos = grid.get_grid_position(placed_time);

                    let pattern_notes = bass_notes(chord_root, &theme.bass_pattern);
                    let note_index = (placed_pos.beat as usize
                        + placed_pos.subdivision as usize)
                        % pattern_notes.len();
                    let bass_note = pattern_notes[note_index] - 12; // Shift down an octave for bass

                    bass_lane.add_note(ArrangedNote::new(
                        placed_time,
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

                let (placed_time, vscale) =
                    place_event(timestamp, &rules.snare_positions, grid, fidelity);

                snare_lane.add_note(ArrangedNote::new(
                    placed_time,
                    event.original_event.duration_ms.min(100.0),
                    (velocity as f32 * vscale) as u8,
                    None,
                    Some(event.original_event.id),
                ));
            }

            EventClass::HihatNoise => {
                // S/TS sounds -> Hi-hats or Arpeggio triggers
                let velocity = calculate_velocity(
                    event.original_event.confidence,
                    event.original_event.features.peak_amplitude,
                );

                // Hi-hats have no fixed template slots — they place at their
                // quantized time (identity). Density is a VELOCITY SHAPER, never a
                // gate: hats that fall outside the template density are ghosted
                // (scaled by 0.35 + 0.65*fidelity) rather than deleted.
                let (placed_time, _) = place_event(timestamp, &[], grid, fidelity);
                let hat_velocity = if should_place_hihat(&event.grid_position, &rules.hihat_density)
                {
                    velocity
                } else {
                    (velocity as f32 * (0.35 + 0.65 * fidelity)) as u8
                };

                hihat_lane.add_note(ArrangedNote::new(
                    placed_time,
                    event.original_event.duration_ms.min(100.0),
                    hat_velocity,
                    None,
                    Some(event.original_event.id),
                ));

                // Rhythmic Puppeteering (Arpeggios): if template is ArpDrive, every
                // hi-hat advances the arpeggiator and spawns a note at placed_time.
                if *template == ArrangementTemplate::ArpDrive {
                    let chord_type = theme.get_chord_at_time(placed_time, grid);
                    let current_chord = chord_notes(theme.root_note, &chord_type, &scale);
                    let arp_sequence =
                        arp_notes(&current_chord, &theme.arp_pattern, theme.arp_octave_range);
                    if !arp_sequence.is_empty() {
                        let note_index = arp_counter % arp_sequence.len();
                        let arp_note = arp_sequence[note_index];

                        arp_lane.add_note(ArrangedNote::new(
                            placed_time,
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

                // Pads have no template slots -> identity placement (they move only
                // via quantization). Single placement drives the whole triad.
                let (placed_time, _) = place_event(timestamp, &[], grid, fidelity);
                let duration = event.original_event.duration_ms.max(400.0);

                let chord_type = theme.get_chord_at_time(placed_time, grid);
                let current_chord = chord_notes(theme.root_note, &chord_type, &scale);

                // Add each note of the chord to the pad lane
                for &note in &current_chord {
                    pad_lane.add_note(ArrangedNote::new(
                        placed_time,
                        duration,
                        (velocity as f32 * 0.8) as u8, // Slightly softer pads
                        Some(note),
                        Some(event.original_event.id),
                    ));
                }
            }
        }
    }

    // Merge same-slot collisions per lane (louder wins) and sort by time. This is
    // what makes fidelity 0.0 collapse two off-template hits landing on one slot
    // into a single note instead of stacking duplicates.
    merge_same_slot(&mut kick_lane);
    merge_same_slot(&mut snare_lane);
    merge_same_slot(&mut hihat_lane);
    merge_same_slot(&mut bass_lane);
    merge_same_slot(&mut pad_lane);
    merge_same_slot(&mut arp_lane);

    // Add lanes to arrangement
    arrangement.add_drum_lane(kick_lane);
    arrangement.add_drum_lane(snare_lane);
    arrangement.add_drum_lane(hihat_lane);
    arrangement.bass_lane = Some(bass_lane);
    arrangement.pad_lane = Some(pad_lane);
    arrangement.arp_lane = Some(arp_lane);

    arrangement
}

/// Expand a template's per-bar positions into every absolute grid-slot time and
/// return the one closest to `quantized_ms`. Returns `None` when the template has
/// no positions or none map onto the grid.
///
/// Template positions store bar-relative (beat, subdivision); we replicate them
/// across all `grid.bar_count` bars and index into the (phase-anchored)
/// `beat_positions_ms`, so the returned slot already includes any phase offset.
fn nearest_template_slot_ms(
    quantized_ms: f64,
    template_positions: &[GridPosition],
    grid: &Grid,
) -> Option<f64> {
    let beats_per_bar = grid.time_signature.beats_per_bar();
    let subs = grid.division.subdivisions_per_beat();
    let mut best: Option<f64> = None;
    for bar in 0..grid.bar_count {
        for tp in template_positions {
            let idx = ((bar * beats_per_bar + tp.beat) * subs + tp.subdivision) as usize;
            if let Some(&t) = grid.beat_positions_ms.get(idx) {
                if best.map_or(true, |b| (t - quantized_ms).abs() < (b - quantized_ms).abs()) {
                    best = Some(t);
                }
            }
        }
    }
    best
}

/// Deterministic fidelity placement (spec §4.3). Returns `(final_time_ms,
/// velocity_scale)`.
///
/// - Empty template (`hi-hats`, `pads`) or no reachable slot -> identity: play at
///   `quantized_ms`, full velocity.
/// - On-template hit -> play at `quantized_ms`, full velocity.
/// - Off-template hit -> lerp toward the nearest slot by `(1 - fidelity)` and
///   attenuate velocity by `1 - (1 - fidelity) * 0.4 * normalized_distance`, where
///   distance is normalized against one subdivision (capped at 1).
///
/// Merging of same-slot collisions is a per-lane post-pass (`merge_same_slot`),
/// not this function's job.
fn place_event(
    quantized_ms: f64,
    template_positions: &[GridPosition],
    grid: &Grid,
    fidelity: f32,
) -> (f64, f32) {
    if template_positions.is_empty() {
        return (quantized_ms, 1.0);
    }
    let Some(slot) = nearest_template_slot_ms(quantized_ms, template_positions, grid) else {
        return (quantized_ms, 1.0);
    };
    if (slot - quantized_ms).abs() < 1e-6 {
        return (quantized_ms, 1.0); // on-template
    }
    let f = fidelity.clamp(0.0, 1.0) as f64;
    let final_ms = slot + (quantized_ms - slot) * f;
    let subdivision_ms = if grid.bpm > 0.0 {
        60000.0 / grid.bpm / grid.division.subdivisions_per_beat() as f64
    } else {
        1.0
    };
    let norm_dist = ((quantized_ms - slot).abs() / subdivision_ms).min(1.0) as f32;
    (final_ms, 1.0 - (1.0 - fidelity) * 0.4 * norm_dist)
}

/// Merge notes that land on the same slot (same time within 1e-6) AND same pitch,
/// keeping the louder one. Deterministic tie-break: the note whose source event id
/// is lexicographically smaller wins. Different pitches at the same time (e.g. a
/// pad triad) are preserved. Leaves the lane sorted by time.
fn merge_same_slot(lane: &mut DrumLane) {
    lane.sort_by_time();
    let mut merged: Vec<ArrangedNote> = Vec::with_capacity(lane.events.len());
    for note in lane.events.drain(..) {
        if let Some(existing) = merged.iter_mut().find(|e| {
            (e.timestamp_ms - note.timestamp_ms).abs() < 1e-6 && e.midi_note == note.midi_note
        }) {
            let takes_priority = note.velocity > existing.velocity
                || (note.velocity == existing.velocity
                    && source_id_precedes(note.source_event_id, existing.source_event_id));
            if takes_priority {
                *existing = note;
            }
        } else {
            merged.push(note);
        }
    }
    lane.events = merged;
}

/// Deterministic tie-break: is `a` a "smaller" source id than `b`? `Some` before
/// `None`; among `Some`s, the smaller `Uuid` (lexicographic on its 128-bit value).
fn source_id_precedes(a: Option<Uuid>, b: Option<Uuid>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => x < y,
        (Some(_), None) => true,
        (None, _) => false,
    }
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

/// Check whether a hi-hat falls within the template's density pattern. This is no
/// longer a gate — off-density hats still play (ghosted); it only decides which
/// hats get full velocity vs. attenuated velocity in `arrange_events`.
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
    use crate::events::{Event, EventFeatures, EventClass};
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

    /// Expand a template's kick positions into absolute slot times across all bars.
    /// Mirrors `nearest_template_slot_ms`'s indexing so tests can assert notes land
    /// on real template slots.
    fn template_slot_times(grid: &Grid, template: &ArrangementTemplate) -> Vec<f64> {
        let positions = template.rules().kick_positions;
        let beats_per_bar = grid.time_signature.beats_per_bar();
        let subs = grid.division.subdivisions_per_beat();
        let mut out = Vec::new();
        for bar in 0..grid.bar_count {
            for tp in &positions {
                let idx = ((bar * beats_per_bar + tp.beat) * subs + tp.subdivision) as usize;
                if let Some(&t) = grid.beat_positions_ms.get(idx) {
                    out.push(t);
                }
            }
        }
        out
    }

    /// Four kick events placed OFF every template kick position (which for
    /// SynthwaveStraight live on beat 1 and beat 3, subdivision 0). Each sits on a
    /// real grid subdivision so it is already "quantized". Returns (events, grid, theme).
    fn off_template_kicks_fixture() -> (Vec<QuantizedEvent>, Grid, crate::themes::Theme) {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Sixteenth, 2);
        let theme = crate::themes::get_theme("BLADE RUNNER").unwrap();

        // 120 BPM sixteenths => 125ms per subdivision, 500ms per beat.
        // Template kick slots: t = 0, 1000, 2000, 3000. All four below avoid them.
        let times = [125.0, 750.0, 1125.0, 1875.0];
        let events = times
            .iter()
            .map(|&t| {
                let gp = grid.get_grid_position(t);
                create_quantized_event(create_test_event(t, EventClass::BilabialPlosive), gp)
            })
            .collect();

        (events, grid, theme)
    }

    #[test]
    fn fidelity_one_keeps_every_event() {
        let (events, grid, theme) = off_template_kicks_fixture();
        let arr = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveStraight,
            &grid,
            &theme,
            0.6,
            1.0,
        );
        let kick = arr.drum_lanes.iter().find(|l| l.name == "DRUMS_KICK").unwrap();
        assert_eq!(kick.events.len(), 4, "today: 0 — all gated away");
        for (n, e) in kick.events.iter().zip(&events) {
            assert!((n.timestamp_ms - e.quantized_timestamp_ms).abs() < 1e-6);
        }
    }

    #[test]
    fn fidelity_zero_moves_and_merges_never_deletes() {
        let (events, grid, theme) = off_template_kicks_fixture();
        let arr = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveStraight,
            &grid,
            &theme,
            0.6,
            0.0,
        );
        let kick = arr.drum_lanes.iter().find(|l| l.name == "DRUMS_KICK").unwrap();
        assert!(!kick.events.is_empty());
        let slots = template_slot_times(&grid, &ArrangementTemplate::SynthwaveStraight);
        for n in &kick.events {
            assert!(
                slots.iter().any(|s| (s - n.timestamp_ms).abs() < 1e-6),
                "note at {} not on a template slot",
                n.timestamp_ms
            );
        }
    }

    #[test]
    fn arrangement_is_deterministic() {
        let (events, grid, theme) = off_template_kicks_fixture();
        let a = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveStraight,
            &grid,
            &theme,
            0.6,
            0.5,
        );
        let b = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveStraight,
            &grid,
            &theme,
            0.6,
            0.5,
        );
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn hihat_density_shapes_velocity_never_deletes() {
        // Sparse density (SynthwaveHalftime) would previously drop off-beat hats.
        // Now every hat survives; off-density hats are ghosted at low fidelity.
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Sixteenth, 1);
        let theme = crate::themes::get_theme("BLADE RUNNER").unwrap();
        // Hats on off-beats (subdivision != 0) — fail the Sparse density check.
        let events: Vec<QuantizedEvent> = [125.0, 375.0, 625.0]
            .iter()
            .map(|&t| {
                let gp = grid.get_grid_position(t);
                create_quantized_event(create_test_event(t, EventClass::HihatNoise), gp)
            })
            .collect();

        let full = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveHalftime,
            &grid,
            &theme,
            0.6,
            1.0,
        );
        let hats_full = full.drum_lanes.iter().find(|l| l.name == "DRUMS_HIHAT").unwrap();
        assert_eq!(hats_full.events.len(), 3, "hats must never be deleted");

        let ghost = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveHalftime,
            &grid,
            &theme,
            0.6,
            0.0,
        );
        let hats_ghost = ghost.drum_lanes.iter().find(|l| l.name == "DRUMS_HIHAT").unwrap();
        assert_eq!(hats_ghost.events.len(), 3, "hats must never be deleted");
        // At fidelity 0.0 off-density hats are ghosted (0.35x) vs full (1.0x).
        for (g, f) in hats_ghost.events.iter().zip(&hats_full.events) {
            assert!(g.velocity < f.velocity, "ghosted hat should be quieter");
        }
    }

    #[test]
    fn bass_follows_moved_kick() {
        // Single-placement rule: the bass note spawned by a kick must sit at the
        // SAME placed time as the kick, not the raw quantized time.
        let (events, grid, theme) = off_template_kicks_fixture();
        let arr = arrange_events(
            &events,
            &ArrangementTemplate::SynthwaveStraight,
            &grid,
            &theme,
            0.8, // b_emphasis high => bass fires
            0.0, // fidelity 0 => kicks move to template slots
        );
        let kick = arr.drum_lanes.iter().find(|l| l.name == "DRUMS_KICK").unwrap();
        let bass = arr.bass_lane.as_ref().unwrap();
        assert!(!bass.events.is_empty());
        // Every bass note time must coincide with a kick note time (same placement).
        let kick_times: Vec<f64> = kick.events.iter().map(|n| n.timestamp_ms).collect();
        for b in &bass.events {
            assert!(
                kick_times.iter().any(|k| (k - b.timestamp_ms).abs() < 1e-6),
                "bass at {} desynced from kick placement",
                b.timestamp_ms
            );
        }
    }

    #[test]
    fn arrangement_snapshots_theme_metadata() {
        // ST @ bpm 112.5 → theme_name "STRANGER THINGS", bpm 112.5, sound == ST.sound.
        let grid = Grid::new(112.5, TimeSignature::FourFour, GridDivision::Sixteenth, 2);
        let theme = crate::themes::get_theme("STRANGER THINGS").unwrap();
        let events: Vec<QuantizedEvent> = vec![create_quantized_event(
            create_test_event(0.0, EventClass::BilabialPlosive),
            GridPosition { bar: 0, beat: 0, subdivision: 0 },
        )];

        let arr = arrange_events(
            &events,
            &ArrangementTemplate::ArpDrive,
            &grid,
            &theme,
            0.6,
            0.8,
        );

        assert_eq!(arr.theme_name, "STRANGER THINGS");
        assert_eq!(arr.bpm, 112.5);
        assert_eq!(arr.sound, theme.sound);
    }

    #[test]
    fn expand_to_song_preserves_metadata() {
        let grid = Grid::new(112.5, TimeSignature::FourFour, GridDivision::Sixteenth, 2);
        let theme = crate::themes::get_theme("STRANGER THINGS").unwrap();
        let events: Vec<QuantizedEvent> = vec![create_quantized_event(
            create_test_event(0.0, EventClass::BilabialPlosive),
            GridPosition { bar: 0, beat: 0, subdivision: 0 },
        )];

        let base = arrange_events(
            &events,
            &ArrangementTemplate::ArpDrive,
            &grid,
            &theme,
            0.6,
            0.8,
        );
        let song = base.expand_to_song();

        assert_eq!(song.theme_name, base.theme_name);
        assert_eq!(song.bpm, base.bpm);
        assert_eq!(song.sound, base.sound);
    }

    #[test]
    fn bass_stab_velocity_respects_theme_ceiling() {
        // vel 127 × b_emphasis 1.0 hits the theme ceiling exactly: BR→100, ST→90.
        // A single loud B event on beat 1.
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Sixteenth, 1);

        // Build one max-velocity B event (confidence 1.0, peak 1.0 → velocity 127).
        let loud = |ts: f64| {
            let mut feats = EventFeatures::zero();
            feats.peak_amplitude = 1.0;
            let ev = Event::new(ts, 50.0, EventClass::BilabialPlosive, 1.0, feats);
            create_quantized_event(ev, GridPosition { bar: 0, beat: 0, subdivision: 0 })
        };

        for (name, ceiling) in [("BLADE RUNNER", 100u8), ("STRANGER THINGS", 90u8)] {
            let theme = crate::themes::get_theme(name).unwrap();
            let arr = arrange_events(&[loud(0.0)], &ArrangementTemplate::SynthwaveStraight, &grid, &theme, 1.0, 1.0);
            let bass = arr.bass_lane.as_ref().unwrap();
            assert_eq!(bass.events.len(), 1, "{name}: one bass note expected");
            assert_eq!(
                bass.events[0].velocity, ceiling,
                "{name}: vel 127 × 1.0 × ceiling/127 should equal {ceiling}"
            );
        }

        // vel 64 × b_emphasis 0.8, BR → round(64/127*0.8*100) = round(40.31) = 40.
        // confidence 0.0, peak amp mapped so calculate_velocity == 64:
        //   64 = 60 + factor*67 → factor = 4/67 ≈ 0.0597; amp*0.7 = factor → amp ≈ 0.0853.
        let theme_br = crate::themes::get_theme("BLADE RUNNER").unwrap();
        let mut feats = EventFeatures::zero();
        feats.peak_amplitude = 4.0 / 67.0 / 0.7;
        let ev = Event::new(0.0, 50.0, EventClass::BilabialPlosive, 0.0, feats);
        let qe = create_quantized_event(ev, GridPosition { bar: 0, beat: 0, subdivision: 0 });
        let arr = arrange_events(&[qe], &ArrangementTemplate::SynthwaveStraight, &grid, &theme_br, 0.8, 1.0);
        let bass = arr.bass_lane.as_ref().unwrap();
        assert_eq!(bass.events.len(), 1);
        assert_eq!(bass.events[0].velocity, 40, "round(64/127*0.8*100) = 40");
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

        let arrangement = arrange_events(&events, &template, &grid, &theme, 0.5, 0.8);

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
        let arrangement_high = arrange_events(&events, &template, &grid, &theme, 0.8, 0.8);
        assert!(arrangement_high.bass_lane.is_some());
        assert!(!arrangement_high.bass_lane.as_ref().unwrap().events.is_empty());

        // Low b_emphasis should not trigger bass
        let arrangement_low = arrange_events(&events, &template, &grid, &theme, 0.2, 0.8);
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

        let arrangement = arrange_events(&events, &template, &grid, &theme, 0.5, 0.8);

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
