// Themes Module
// Harmonic systems for beat generation

pub mod types;
mod blade_runner;
mod stranger_things;
mod twin_peaks;

/// A single entry in the theme registry: a constructor plus the user-facing
/// description. Every public theme accessor derives from `THEME_REGISTRY`, so
/// adding a theme is a one-line append here — no parallel tables to update.
struct ThemeEntry {
    constructor: fn() -> types::Theme,
    description: &'static str,
}

const THEME_REGISTRY: &[ThemeEntry] = &[
    ThemeEntry {
        constructor: blade_runner::blade_runner_theme,
        description: "D minor, i\u{2013}VI\u{2013}III\u{2013}VII (Dm\u{2013}Bb\u{2013}F\u{2013}C). Root-fifth bass, halftime groove. Layered synthwave kit, gated reverb, long sustained pads.",
    },
    ThemeEntry {
        constructor: stranger_things::stranger_things_theme,
        description: "C minor, i\u{2013}VII\u{2013}VI\u{2013}VII (Cm\u{2013}Bb\u{2013}Ab\u{2013}Bb). Driving offbeat bass, arp-led groove. TR808-style kit, dark filtered delay, short rhythmic pads.",
    },
    ThemeEntry {
        constructor: twin_peaks::twin_peaks_theme,
        description: "E Dorian, i\u{2013}IV\u{2013}i\u{2013}VII (Em\u{2013}A\u{2013}Em\u{2013}D). Walking bass, descending arp, slowest tempo. Layered kit, wide stereo chorus, long sustained pads.",
    },
];

/// Construct every registered theme.
pub fn all_themes() -> Vec<types::Theme> {
    THEME_REGISTRY.iter().map(|e| (e.constructor)()).collect()
}

/// Get a theme by name (case-insensitive) over the registry.
pub fn get_theme(name: &str) -> Option<types::Theme> {
    let target = name.to_uppercase();
    THEME_REGISTRY
        .iter()
        .map(|e| (e.constructor)())
        .find(|t| t.name.to_uppercase() == target)
}

/// List all available themes with summaries (description from the registry).
pub fn list_themes() -> Vec<types::ThemeSummary> {
    THEME_REGISTRY
        .iter()
        .map(|e| (e.constructor)().summary(e.description))
        .collect()
}

/// Get all theme names.
pub fn list_theme_names() -> Vec<String> {
    THEME_REGISTRY
        .iter()
        .map(|e| (e.constructor)().name)
        .collect()
}

// Re-export main types
pub use types::{
    Theme,
    ThemeSummary,
    ThemeSound,
    ThemeVisuals,
    ScaleFamily,
    ChordType,
    ChordProgression,
    ArpPattern,
    BassPattern,
    DrumPalette,
    FxProfile,
    scale_notes,
    chord_notes,
    arp_notes,
    bass_notes,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_theme() {
        let theme = get_theme("BLADE RUNNER");
        assert!(theme.is_some());
        assert_eq!(theme.unwrap().name, "BLADE RUNNER");

        let theme2 = get_theme("STRANGER THINGS");
        assert!(theme2.is_some());
        assert_eq!(theme2.unwrap().name, "STRANGER THINGS");

        let theme3 = get_theme("TWIN PEAKS");
        assert!(theme3.is_some());
        assert_eq!(theme3.unwrap().name, "TWIN PEAKS");

        let missing = get_theme("NON_EXISTENT");
        assert!(missing.is_none());

        // Lookup is case-insensitive (the UI and persisted runs both round-trip
        // names through here).
        assert!(get_theme("twin peaks").is_some());
    }

    #[test]
    fn test_list_themes() {
        let themes = list_themes();
        // Count is asserted against the registry rather than a literal, so
        // adding a theme doesn't require editing this test.
        assert_eq!(themes.len(), THEME_REGISTRY.len());
        assert!(themes.iter().any(|t| t.name == "BLADE RUNNER"));
        assert!(themes.iter().any(|t| t.name == "STRANGER THINGS"));
        assert!(themes.iter().any(|t| t.name == "TWIN PEAKS"));
        // Every summary carries a real description and visuals for the UI.
        assert!(themes.iter().all(|t| !t.description.is_empty()));
        assert!(themes.iter().all(|t| !t.visuals.accent_hex.is_empty()));
    }

    #[test]
    fn test_list_theme_names() {
        let names = list_theme_names();
        assert_eq!(names.len(), THEME_REGISTRY.len());
        assert!(names.contains(&"BLADE RUNNER".to_string()));
        assert!(names.contains(&"STRANGER THINGS".to_string()));
        assert!(names.contains(&"TWIN PEAKS".to_string()));
    }

    #[test]
    fn registry_themes_are_valid() {
        let themes = all_themes();
        assert!(!themes.is_empty(), "registry must not be empty");

        let mut seen = std::collections::HashSet::new();
        for theme in &themes {
            assert!(!theme.name.is_empty(), "theme name must be non-empty");
            assert!(
                seen.insert(theme.name.to_uppercase()),
                "duplicate theme name (case-insensitive): {}",
                theme.name
            );

            let (lo, hi) = theme.bpm_range;
            assert!(lo < hi, "bpm_range must be ascending for {}", theme.name);
            assert!(
                (40..=220).contains(&lo) && (40..=220).contains(&hi),
                "bpm_range out of 40..=220 for {}",
                theme.name
            );

            assert!(
                (21..=96).contains(&theme.root_note),
                "root_note out of 21..=96 for {}",
                theme.name
            );

            assert!(
                !theme.chord_progression.chords.is_empty(),
                "chords must be non-empty for {}",
                theme.name
            );
            assert!(
                theme.chord_progression.bars_per_chord >= 1,
                "bars_per_chord must be >= 1 for {}",
                theme.name
            );

            assert!(
                theme.arp_octave_range.0 <= theme.arp_octave_range.1,
                "arp_octave_range must be ordered for {}",
                theme.name
            );

            assert!(
                (1..=127).contains(&theme.bass_stab_max_velocity),
                "bass_stab_max_velocity must be in 1..=127 for {}",
                theme.name
            );

            // Visuals must be real #RRGGBB values: the UI colours itself from
            // these, so a malformed string degrades silently in CSS/three.js.
            for (field, hex) in [
                ("accent_hex", &theme.visuals.accent_hex),
                ("emissive_hex", &theme.visuals.emissive_hex),
                ("card_hex", &theme.visuals.card_hex),
            ] {
                assert!(
                    hex.len() == 7
                        && hex.starts_with('#')
                        && hex[1..].chars().all(|c| c.is_ascii_hexdigit()),
                    "{} must be #RRGGBB for {} (got {:?})",
                    field,
                    theme.name,
                    hex
                );
            }
        }
    }

    #[test]
    fn themes_have_distinct_sound_identities() {
        // Every PAIR of themes must be distinguishable — both to the ear
        // (sound + template) and to the eye (accent colour). Written over the
        // whole registry so a new theme is checked automatically.
        let themes = all_themes();
        for (i, a) in themes.iter().enumerate() {
            for b in themes.iter().skip(i + 1) {
                assert_ne!(
                    a.sound, b.sound,
                    "{} and {} share a render-time sound identity",
                    a.name, b.name
                );
                assert_ne!(
                    a.visuals.accent_hex, b.visuals.accent_hex,
                    "{} and {} share an accent colour",
                    a.name, b.name
                );
            }
        }

        // Templates: not all-distinct (there are only three templates), but no
        // theme may sit on the default-fallback template alone by accident —
        // each template in use must be a deliberate choice, so assert at least
        // two distinct templates are represented.
        // (ArrangementTemplate is Copy + PartialEq but not Hash, so count
        // distinct values by scan rather than deriving Hash just for a test.)
        let mut distinct_templates: Vec<_> = Vec::new();
        for t in &themes {
            if !distinct_templates.contains(&t.default_template) {
                distinct_templates.push(t.default_template);
            }
        }
        assert!(
            distinct_templates.len() >= 2,
            "themes must not all share one default template"
        );
    }
}
