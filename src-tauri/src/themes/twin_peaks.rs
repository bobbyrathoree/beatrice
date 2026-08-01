// Twin Peaks Theme
// Dream-jazz noir: slow, hazy, unresolved. E Dorian.
//
// This theme deliberately exercises the variants the first two themes left
// unused — Dorian mode, Walking bass, Down851 (descending) arp, WideChorus FX,
// and the straight template — so every enum arm the codebase claims to support
// is actually reachable from a shipped theme.

use super::types::*;
use crate::arranger::templates::ArrangementTemplate;

/// Create the Twin Peaks theme
///
/// Characteristics:
/// - E Dorian (64 = E) — the major IV over a minor tonic is the Dorian signature,
///   which is what makes this mode sound wistful rather than simply sad
/// - Walking bass (root-third-fifth-seventh) instead of stabs
/// - Descending arpeggio (8-5-1), the falling figure
/// - Layered kit, wide stereo chorus on pads/arp, long sustained pads
/// - BPM: 60-80 (the slowest theme)
/// - Chord progression: i - IV - i - VII (Em - A - Em - D)
pub fn twin_peaks_theme() -> Theme {
    Theme {
        name: "TWIN PEAKS".to_string(),
        bpm_range: (60, 80),
        root_note: 64, // E
        scale_family: ScaleFamily::Dorian,
        chord_progression: ChordProgression {
            chords: vec![ChordType::Im, ChordType::IV, ChordType::Im, ChordType::VII],
            bars_per_chord: 2,
        },
        bass_pattern: BassPattern::Walking,
        arp_pattern: ArpPattern::Down851,
        arp_octave_range: (0, 1),
        default_template: ArrangementTemplate::SynthwaveStraight,
        sound: ThemeSound {
            drum_palette: DrumPalette::SynthwaveDrums,
            fx_profile: FxProfile::WideChorus,
            pad_sustain: true,
        },
        // Violet geometry (distinct from BR amber and ST red), amber card.
        visuals: ThemeVisuals {
            accent_hex: "#7B4BFF".to_string(),
            emissive_hex: "#B14BFF".to_string(),
            card_hex: "#FFD400".to_string(),
        },
        bass_stab_max_velocity: 80, // softest of the three — this theme breathes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{blade_runner::blade_runner_theme, stranger_things::stranger_things_theme};

    #[test]
    fn test_twin_peaks_theme() {
        let theme = twin_peaks_theme();

        assert_eq!(theme.name, "TWIN PEAKS");
        assert_eq!(theme.root_note, 64); // E
        assert_eq!(theme.bpm_range, (60, 80));
        assert_eq!(theme.scale_family, ScaleFamily::Dorian);
        assert_eq!(theme.bass_pattern, BassPattern::Walking);
        assert_eq!(theme.arp_pattern, ArpPattern::Down851);
        assert_eq!(theme.arp_octave_range, (0, 1));
        assert_eq!(theme.default_template, ArrangementTemplate::SynthwaveStraight);
        assert_eq!(theme.sound.drum_palette, DrumPalette::SynthwaveDrums);
        assert_eq!(theme.sound.fx_profile, FxProfile::WideChorus);
        assert!(theme.sound.pad_sustain);
        assert_eq!(theme.bass_stab_max_velocity, 80);

        assert_eq!(theme.chord_progression.chords.len(), 4);
        assert_eq!(theme.chord_progression.bars_per_chord, 2);
    }

    #[test]
    fn test_twin_peaks_scale_is_dorian() {
        let theme = twin_peaks_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        // E Dorian: E, F#, G, A, B, C#, D
        // MIDI:     64, 66, 67, 69, 71, 73, 74
        assert_eq!(scale, vec![64, 66, 67, 69, 71, 73, 74]);
    }

    #[test]
    fn test_twin_peaks_major_four_is_the_dorian_signature() {
        // The whole point of Dorian: a MAJOR IV over a minor tonic. If this
        // chord ever comes back minor, the theme has lost its identity.
        let theme = twin_peaks_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);

        let tonic = chord_notes(theme.root_note, &theme.chord_progression.chords[0], &scale);
        assert_eq!(tonic, vec![64, 67, 71]); // Em: E, G, B (minor third)

        let four = chord_notes(theme.root_note, &theme.chord_progression.chords[1], &scale);
        assert_eq!(four, vec![69, 73, 76]); // A major: A, C#, E (major third)

        let flat_seven = chord_notes(theme.root_note, &theme.chord_progression.chords[3], &scale);
        assert_eq!(flat_seven, vec![74, 78, 81]); // D major: D, F#, A
    }

    #[test]
    fn test_twin_peaks_walking_bass() {
        let theme = twin_peaks_theme();
        let bass = bass_notes(64, &theme.bass_pattern);

        // Walking: root, third, fifth, seventh
        assert_eq!(bass, vec![64, 67, 71, 74]);
    }

    #[test]
    fn test_twin_peaks_arp_descends() {
        let theme = twin_peaks_theme();
        let scale = scale_notes(theme.root_note, &theme.scale_family);
        let chord = chord_notes(theme.root_note, &theme.chord_progression.chords[0], &scale);
        let arp = arp_notes(&chord, &theme.arp_pattern, theme.arp_octave_range);

        // Down851 = descending: the falling figure, so first note > last note.
        assert!(arp.len() >= 6);
        assert!(arp[0] > arp[arp.len() - 1]);
    }

    #[test]
    fn test_twin_peaks_is_distinct_from_the_other_themes() {
        let tp = twin_peaks_theme();
        let br = blade_runner_theme();
        let st = stranger_things_theme();

        // Only theme in a non-minor mode, and the slowest.
        assert_ne!(tp.scale_family, br.scale_family);
        assert_ne!(tp.scale_family, st.scale_family);
        assert!(tp.bpm_range.1 <= br.bpm_range.0);

        // Distinct sound identity and template from BOTH existing themes.
        assert_ne!(tp.sound, br.sound);
        assert_ne!(tp.sound, st.sound);
        assert_ne!(tp.default_template, br.default_template);
        assert_ne!(tp.default_template, st.default_template);

        // Distinct on-screen identity (no two themes share an accent colour).
        assert_ne!(tp.visuals.accent_hex, br.visuals.accent_hex);
        assert_ne!(tp.visuals.accent_hex, st.visuals.accent_hex);
    }
}
