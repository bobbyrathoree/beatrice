// Blade Runner Theme
// Vangelis-inspired: melancholic, atmospheric, Dm scale

use super::types::*;

/// Create the Blade Runner theme
///
/// Characteristics:
/// - D minor (62 = D) scale
/// - Vangelis pads and brass stabs
/// - Gated reverb
/// - BPM: 80-100
/// - Melancholic, atmospheric
/// - Chord progression: i - VI - III - VII (Dm - Bb - F - C)
pub fn blade_runner_theme() -> Theme {
    Theme {
        name: "BLADE RUNNER".to_string(),
        bpm_range: (80, 100),
        root_note: 62, // D
        scale_family: ScaleFamily::NaturalMinor,
        chord_progression: ChordProgression {
            chords: vec![ChordType::Im, ChordType::VI, ChordType::III, ChordType::VII],
            bars_per_chord: 2,
        },
        bass_pattern: BassPattern::RootFifth,
        arp_pattern: ArpPattern::Up158,
        arp_octave_range: (-1, 1),
        drum_palette: DrumPalette::SynthwaveDrums,
        fx_profile: FxProfile::GatedReverb,
        synth_stab_velocity: 100,
        pad_sustain: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blade_runner_theme() {
        let theme = blade_runner_theme();

        assert_eq!(theme.name, "BLADE RUNNER");
        assert_eq!(theme.root_note, 62); // D
        assert_eq!(theme.bpm_range, (80, 100));
        assert_eq!(theme.scale_family, ScaleFamily::NaturalMinor);
        assert_eq!(theme.bass_pattern, BassPattern::RootFifth);
        assert_eq!(theme.arp_pattern, ArpPattern::Up158);
        assert_eq!(theme.arp_octave_range, (-1, 1));
        assert_eq!(theme.drum_palette, DrumPalette::SynthwaveDrums);
        assert_eq!(theme.fx_profile, FxProfile::GatedReverb);
        assert_eq!(theme.synth_stab_velocity, 100);
        assert_eq!(theme.pad_sustain, true);

        // Check chord progression
        assert_eq!(theme.chord_progression.chords.len(), 4);
        assert_eq!(theme.chord_progression.bars_per_chord, 2);
    }

    #[test]
    fn test_blade_runner_scale() {
        let theme = blade_runner_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // D natural minor: D, E, F, G, A, Bb, C
        // MIDI: 62, 64, 65, 67, 69, 70, 72
        assert_eq!(scale, vec![62, 64, 65, 67, 69, 70, 72]);
    }

    #[test]
    fn test_blade_runner_chords() {
        let theme = blade_runner_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // First chord: Dm (i)
        let chord = chord_notes(theme.root_note, &theme.chord_progression.chords[0], &scale);
        assert_eq!(chord[0], 62); // D
        assert_eq!(chord[1], 65); // F
        assert_eq!(chord[2], 69); // A
    }

    #[test]
    fn test_blade_runner_bass() {
        let theme = blade_runner_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);
        let chord_root = scale[0]; // D

        let bass = bass_notes(chord_root, &theme.bass_pattern);

        // Root-Fifth pattern: D and A
        assert_eq!(bass.len(), 2);
        assert_eq!(bass[0], 62); // D
        assert_eq!(bass[1], 69); // A (perfect fifth above)
    }

    #[test]
    fn test_blade_runner_arp() {
        let theme = blade_runner_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // First chord: Dm
        let chord = chord_notes(theme.root_note, &theme.chord_progression.chords[0], &scale);
        let arp = arp_notes(&chord, &theme.arp_pattern, theme.arp_octave_range);

        // Should have notes across 3 octaves (-1, 0, 1)
        assert!(arp.len() >= 6); // 3 notes * 3 octaves
        assert!(arp.contains(&chord[0])); // Contains root
    }
}
