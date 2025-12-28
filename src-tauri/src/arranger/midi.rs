// MIDI Export - Convert arrangements to MIDI files using midly crate
// Produces DAW-friendly MIDI files with proper timing and metadata

use serde::{Deserialize, Serialize};
use midly::{Smf, Header, Track, TrackEvent, TrackEventKind, MetaMessage, MidiMessage, Timing};
use crate::groove::grid::Grid;
use super::drum_lanes::{Arrangement, DrumLane};

/// MIDI export options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MidiExportOptions {
    /// Pulses per quarter note (PPQ) - typically 480 or 960
    /// Higher values = better timing resolution
    pub ppq: u16,

    /// Include tempo metadata
    pub include_tempo: bool,

    /// Include time signature metadata
    pub include_time_signature: bool,

    /// Include track names
    pub track_names: bool,
}

impl Default for MidiExportOptions {
    fn default() -> Self {
        MidiExportOptions {
            ppq: 480,
            include_tempo: true,
            include_time_signature: true,
            track_names: true,
        }
    }
}

/// Export an arrangement to MIDI file bytes
///
/// Returns the MIDI file as a Vec<u8> that can be written to disk or sent over IPC.
///
/// # Arguments
/// * `arrangement` - The arrangement to export
/// * `grid` - The musical grid (for tempo and timing)
/// * `options` - Export options
///
/// # Returns
/// MIDI file bytes ready to be written to disk
pub fn export_midi(
    arrangement: &Arrangement,
    grid: &Grid,
    options: &MidiExportOptions,
) -> Result<Vec<u8>, String> {
    // Create MIDI header
    let timing = Timing::Metrical(options.ppq.into());
    let header = Header {
        format: midly::Format::Parallel,
        timing,
    };

    // Calculate ticks per millisecond
    let ticks_per_ms = calculate_ticks_per_ms(grid.bpm, options.ppq);

    // Create tracks
    let mut tracks = Vec::new();

    // Track 0: Tempo and time signature metadata
    let mut meta_track = Track::new();

    // Add track name
    if options.track_names {
        add_track_name(&mut meta_track, 0, "META");
    }

    // Add tempo
    if options.include_tempo {
        add_tempo(&mut meta_track, 0, grid.bpm);
    }

    // Add time signature
    if options.include_time_signature {
        add_time_signature(&mut meta_track, 0, &grid);
    }

    // End of track
    add_end_of_track(&mut meta_track, 0);
    tracks.push(meta_track);

    // Create a track for each lane
    for lane in arrangement.all_lanes() {
        let track = create_lane_track(lane, ticks_per_ms, options)?;
        tracks.push(track);
    }

    // Create SMF
    let smf = Smf {
        header,
        tracks,
    };

    // Write to bytes
    let mut bytes = Vec::new();
    smf.write(&mut bytes)
        .map_err(|e| format!("Failed to write MIDI: {}", e))?;

    Ok(bytes)
}

/// Create a MIDI track for a drum lane
fn create_lane_track<'a>(
    lane: &'a DrumLane,
    ticks_per_ms: f64,
    options: &'a MidiExportOptions,
) -> Result<Track<'a>, String> {
    let mut track = Track::new();
    let mut events: Vec<(u32, TrackEventKind)> = Vec::new();

    // Add track name
    if options.track_names {
        events.push((0, TrackEventKind::Meta(MetaMessage::TrackName(
            lane.name.as_bytes()
        ))));
    }

    // Add note events
    for note in &lane.events {
        let tick_on = (note.timestamp_ms * ticks_per_ms) as u32;
        let tick_off = ((note.timestamp_ms + note.duration_ms) * ticks_per_ms) as u32;

        // Note On
        events.push((
            tick_on,
            TrackEventKind::Midi {
                channel: 9.into(), // Channel 10 (0-indexed = 9) is drums
                message: MidiMessage::NoteOn {
                    key: lane.midi_note.into(),
                    vel: note.velocity.into(),
                },
            },
        ));

        // Note Off
        events.push((
            tick_off,
            TrackEventKind::Midi {
                channel: 9.into(),
                message: MidiMessage::NoteOff {
                    key: lane.midi_note.into(),
                    vel: 0.into(),
                },
            },
        ));
    }

    // Sort events by tick (absolute time)
    events.sort_by_key(|(tick, _)| *tick);

    // Convert to delta times and add to track
    let mut last_tick = 0;
    for (tick, kind) in events {
        let delta = tick.saturating_sub(last_tick);
        track.push(TrackEvent {
            delta: delta.into(),
            kind,
        });
        last_tick = tick;
    }

    // End of track
    let end_tick = calculate_end_tick(lane, ticks_per_ms);
    let delta = end_tick.saturating_sub(last_tick);
    track.push(TrackEvent {
        delta: delta.into(),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });

    Ok(track)
}

/// Calculate ticks per millisecond
fn calculate_ticks_per_ms(bpm: f64, ppq: u16) -> f64 {
    // Microseconds per quarter note
    let us_per_quarter = 60_000_000.0 / bpm;

    // Milliseconds per quarter note
    let ms_per_quarter = us_per_quarter / 1000.0;

    // Ticks per millisecond
    ppq as f64 / ms_per_quarter
}

/// Add track name to track
fn add_track_name<'a>(track: &mut Track<'a>, delta: u32, name: &'a str) {
    track.push(TrackEvent {
        delta: delta.into(),
        kind: TrackEventKind::Meta(MetaMessage::TrackName(name.as_bytes())),
    });
}

/// Add tempo meta message
fn add_tempo<'a>(track: &mut Track<'a>, delta: u32, bpm: f64) {
    // Convert BPM to microseconds per quarter note
    let us_per_quarter = (60_000_000.0 / bpm) as u32;

    // Create 24-bit tempo value (big-endian)
    let tempo_bytes = [
        ((us_per_quarter >> 16) & 0xFF) as u8,
        ((us_per_quarter >> 8) & 0xFF) as u8,
        (us_per_quarter & 0xFF) as u8,
    ];

    track.push(TrackEvent {
        delta: delta.into(),
        kind: TrackEventKind::Meta(MetaMessage::Tempo(
            u32::from_be_bytes([0, tempo_bytes[0], tempo_bytes[1], tempo_bytes[2]]).into()
        )),
    });
}

/// Add time signature meta message
fn add_time_signature<'a>(track: &mut Track<'a>, delta: u32, grid: &Grid) {
    let numerator = grid.time_signature.beats_per_bar() as u8;
    let denominator = 2u8; // 2^2 = 4 (quarter note)

    // MIDI clocks per metronome click (24 for quarter note)
    let clocks_per_click = 24u8;

    // 32nd notes per quarter note (8)
    let thirty_seconds_per_quarter = 8u8;

    track.push(TrackEvent {
        delta: delta.into(),
        kind: TrackEventKind::Meta(MetaMessage::TimeSignature(
            numerator,
            denominator,
            clocks_per_click,
            thirty_seconds_per_quarter,
        )),
    });
}

/// Add end of track message
fn add_end_of_track<'a>(track: &mut Track<'a>, delta: u32) {
    track.push(TrackEvent {
        delta: delta.into(),
        kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
    });
}

/// Calculate end tick for a lane (last note off time + buffer)
fn calculate_end_tick(lane: &DrumLane, ticks_per_ms: f64) -> u32 {
    let mut max_tick = 0u32;

    for note in &lane.events {
        let tick_off = ((note.timestamp_ms + note.duration_ms) * ticks_per_ms) as u32;
        max_tick = max_tick.max(tick_off);
    }

    // Add 1 bar buffer
    max_tick + (ticks_per_ms * 2000.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arranger::drum_lanes::{DrumLane, ArrangedNote, MIDI_KICK, MIDI_SNARE};
    use crate::groove::grid::{Grid, TimeSignature, GridDivision};
    use crate::arranger::templates::ArrangementTemplate;

    #[test]
    fn test_calculate_ticks_per_ms() {
        let ticks_per_ms = calculate_ticks_per_ms(120.0, 480);

        // At 120 BPM, quarter note = 500ms
        // 480 PPQ / 500ms = 0.96 ticks per ms
        assert!((ticks_per_ms - 0.96).abs() < 0.01);
    }

    #[test]
    fn test_export_empty_arrangement() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 4);
        let arrangement = Arrangement::new(
            ArrangementTemplate::SynthwaveStraight,
            grid.total_duration_ms(),
            grid.bar_count,
        );

        let options = MidiExportOptions::default();
        let result = export_midi(&arrangement, &grid, &options);

        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(bytes.len() > 0);
    }

    #[test]
    fn test_export_with_notes() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 4);
        let mut arrangement = Arrangement::new(
            ArrangementTemplate::SynthwaveStraight,
            grid.total_duration_ms(),
            grid.bar_count,
        );

        // Create a kick lane with one note
        let mut kick_lane = DrumLane::new("KICK", MIDI_KICK);
        kick_lane.add_note(ArrangedNote::new(0.0, 100.0, 100, None));
        arrangement.add_drum_lane(kick_lane);

        // Create a snare lane with one note
        let mut snare_lane = DrumLane::new("SNARE", MIDI_SNARE);
        snare_lane.add_note(ArrangedNote::new(500.0, 100.0, 90, None));
        arrangement.add_drum_lane(snare_lane);

        let options = MidiExportOptions::default();
        let result = export_midi(&arrangement, &grid, &options);

        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(bytes.len() > 0);

        // Verify it's a valid MIDI file by parsing it back
        let parsed = Smf::parse(&bytes);
        assert!(parsed.is_ok());

        let smf = parsed.unwrap();
        assert_eq!(smf.header.format, midly::Format::Parallel);

        // Should have 3 tracks: meta + kick + snare
        assert_eq!(smf.tracks.len(), 3);
    }

    #[test]
    fn test_export_options() {
        let grid = Grid::new(140.0, TimeSignature::FourFour, GridDivision::Eighth, 8);
        let arrangement = Arrangement::new(
            ArrangementTemplate::SynthwaveStraight,
            grid.total_duration_ms(),
            grid.bar_count,
        );

        // Test with different PPQ
        let options_high_ppq = MidiExportOptions {
            ppq: 960,
            ..Default::default()
        };

        let result = export_midi(&arrangement, &grid, &options_high_ppq);
        assert!(result.is_ok());

        // Test without metadata
        let options_no_meta = MidiExportOptions {
            ppq: 480,
            include_tempo: false,
            include_time_signature: false,
            track_names: false,
        };

        let result = export_midi(&arrangement, &grid, &options_no_meta);
        assert!(result.is_ok());
    }

    #[test]
    fn test_track_name_generation() {
        let mut track = Track::new();
        add_track_name(&mut track, 0, "TEST_TRACK");

        assert_eq!(track.len(), 1);
        if let TrackEventKind::Meta(MetaMessage::TrackName(name)) = &track[0].kind {
            assert_eq!(name, b"TEST_TRACK");
        } else {
            panic!("Expected TrackName event");
        }
    }

    #[test]
    fn test_tempo_calculation() {
        let mut track = Track::new();
        add_tempo(&mut track, 0, 120.0);

        assert_eq!(track.len(), 1);

        // At 120 BPM, tempo should be 500000 microseconds per quarter note
        if let TrackEventKind::Meta(MetaMessage::Tempo(tempo)) = &track[0].kind {
            assert_eq!(u32::from(*tempo), 500000);
        } else {
            panic!("Expected Tempo event");
        }
    }

    #[test]
    fn test_note_timing() {
        let ticks_per_ms = calculate_ticks_per_ms(120.0, 480);

        let mut lane = DrumLane::new("TEST", MIDI_KICK);
        lane.add_note(ArrangedNote::new(0.0, 100.0, 100, None));
        lane.add_note(ArrangedNote::new(500.0, 100.0, 100, None));

        let options = MidiExportOptions::default();
        let track = create_lane_track(&lane, ticks_per_ms, &options);

        assert!(track.is_ok());
        let track = track.unwrap();

        // Should have: track name, 2 note-ons, 2 note-offs, end of track = 6 events
        assert!(track.len() >= 5);
    }
}
