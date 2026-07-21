// Blade Runner Theme
// Vangelis-inspired: melancholic, atmospheric, Dm scale

use super::types::*;
use crate::arranger::templates::ArrangementTemplate;

/// Create the Blade Runner theme
///
/// Characteristics:
/// - D minor (62 = D) scale
/// - Layered synthwave kit, gated reverb
/// - Long sustained pads (the envelope holds, not pulses)
/// - Halftime groove, root-fifth bass
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
        default_template: ArrangementTemplate::SynthwaveHalftime,
        sound: ThemeSound {
            drum_palette: DrumPalette::SynthwaveDrums,
            fx_profile: FxProfile::GatedReverb,
            pad_sustain: true,
        },
        bass_stab_max_velocity: 100,
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
        assert_eq!(theme.default_template, ArrangementTemplate::SynthwaveHalftime);
        assert_eq!(theme.sound.drum_palette, DrumPalette::SynthwaveDrums);
        assert_eq!(theme.sound.fx_profile, FxProfile::GatedReverb);
        assert!(theme.sound.pad_sustain);
        assert_eq!(theme.bass_stab_max_velocity, 100);

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
