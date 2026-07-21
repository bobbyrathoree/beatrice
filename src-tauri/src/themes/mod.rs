// Themes Module
// Harmonic systems for beat generation

pub mod types;
mod blade_runner;
mod stranger_things;

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

        let theme3 = get_theme("NON_EXISTENT");
        assert!(theme3.is_none());
    }

    #[test]
    fn test_list_themes() {
        let themes = list_themes();
        assert_eq!(themes.len(), 2);
        assert!(themes.iter().any(|t| t.name == "BLADE RUNNER"));
        assert!(themes.iter().any(|t| t.name == "STRANGER THINGS"));
    }

    #[test]
    fn test_list_theme_names() {
        let names = list_theme_names();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"BLADE RUNNER".to_string()));
        assert!(names.contains(&"STRANGER THINGS".to_string()));
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
        }
    }

    #[test]
    fn themes_have_distinct_sound_identities() {
        let br = get_theme("BLADE RUNNER").unwrap();
        let st = get_theme("STRANGER THINGS").unwrap();
        assert_ne!(
            br.sound, st.sound,
            "themes must have distinct render-time sound identities"
        );
        assert_ne!(
            br.default_template, st.default_template,
            "themes must have distinct default templates"
        );
    }
}
