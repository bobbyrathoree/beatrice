// Stranger Things Theme
// Synthwave horror: dark, pulsing, retro, Cm scale

use super::types::*;

/// Create the Stranger Things theme
///
/// Characteristics:
/// - C minor (60 = C) scale
/// - Arpeggios and pulsing bass
/// - 80s drums
/// - BPM: 100-120
/// - Dark, pulsing, retro
/// - Chord progression: i - VII - VI - VII (Cm - Bb - Ab - Bb)
pub fn stranger_things_theme() -> Theme {
    Theme {
        name: "STRANGER THINGS".to_string(),
        bpm_range: (100, 120),
        root_note: 60, // C
        scale_family: ScaleFamily::NaturalMinor,
        chord_progression: ChordProgression {
            chords: vec![ChordType::Im, ChordType::VII, ChordType::VI, ChordType::VII],
            bars_per_chord: 2,
        },
        bass_pattern: BassPattern::OffbeatEighths,
        arp_pattern: ArpPattern::Up158,
        arp_octave_range: (0, 2),
        drum_palette: DrumPalette::SynthwaveDrums,
        fx_profile: FxProfile::DarkDelay,
        synth_stab_velocity: 90,
        pad_sustain: false, // More pulsing than sustained
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stranger_things_theme() {
        let theme = stranger_things_theme();

        assert_eq!(theme.name, "STRANGER THINGS");
        assert_eq!(theme.root_note, 60); // C
        assert_eq!(theme.bpm_range, (100, 120));
        assert_eq!(theme.scale_family, ScaleFamily::NaturalMinor);
        assert_eq!(theme.bass_pattern, BassPattern::OffbeatEighths);
        assert_eq!(theme.arp_pattern, ArpPattern::Up158);
        assert_eq!(theme.arp_octave_range, (0, 2));
        assert_eq!(theme.drum_palette, DrumPalette::SynthwaveDrums);
        assert_eq!(theme.fx_profile, FxProfile::DarkDelay);
        assert_eq!(theme.synth_stab_velocity, 90);
        assert_eq!(theme.pad_sustain, false);

        // Check chord progression
        assert_eq!(theme.chord_progression.chords.len(), 4);
        assert_eq!(theme.chord_progression.bars_per_chord, 2);
    }

    #[test]
    fn test_stranger_things_scale() {
        let theme = stranger_things_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // C natural minor: C, D, Eb, F, G, Ab, Bb
        // MIDI: 60, 62, 63, 65, 67, 68, 70
        assert_eq!(scale, vec![60, 62, 63, 65, 67, 68, 70]);
    }

    #[test]
    fn test_stranger_things_chords() {
        let theme = stranger_things_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // First chord: Cm (i)
        let chord = chord_notes(theme.root_note, &theme.chord_progression.chords[0], &scale);
        assert_eq!(chord[0], 60); // C
        assert_eq!(chord[1], 63); // Eb
        assert_eq!(chord[2], 67); // G
    }

    #[test]
    fn test_stranger_things_bass() {
        let theme = stranger_things_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);
        let chord_root = scale[0]; // C

        let bass = bass_notes(chord_root, &theme.bass_pattern);

        // Offbeat eighths pattern: repeated root
        assert_eq!(bass.len(), 4);
        assert!(bass.iter().all(|&n| n == 60)); // All C
    }

    #[test]
    fn test_stranger_things_arp() {
        let theme = stranger_things_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // First chord: Cm
        let chord = chord_notes(theme.root_note, &theme.chord_progression.chords[0], &scale);
        let arp = arp_notes(&chord, &theme.arp_pattern, theme.arp_octave_range);

        // Should have notes across 3 octaves (0, 1, 2)
        assert!(arp.len() >= 9); // 3 notes * 3 octaves
        assert!(arp.contains(&chord[0])); // Contains root

        // Check octave range (0-2 means notes from C4 upward across 3 octaves)
        let min_note = *arp.iter().min().unwrap();
        let max_note = *arp.iter().max().unwrap();
        assert!(min_note >= 60); // At least C4
        assert!(max_note <= 96); // Within reasonable MIDI range (up to C7)
    }

    #[test]
    fn test_stranger_things_vs_blade_runner() {
        let st = stranger_things_theme();
        let br = blade_runner_theme();

        // Stranger Things has higher BPM range
        assert!(st.bpm_range.0 > br.bpm_range.0);
        assert!(st.bpm_range.1 > br.bpm_range.1);

        // Different root notes
        assert_ne!(st.root_note, br.root_note);

        // Different bass patterns
        assert_ne!(st.bass_pattern, br.bass_pattern);

        // Different FX profiles
        assert_ne!(st.fx_profile, br.fx_profile);

        // Different pad sustain
        assert_ne!(st.pad_sustain, br.pad_sustain);
    }
}

// Import blade_runner for the comparison test
use super::blade_runner::blade_runner_theme;
