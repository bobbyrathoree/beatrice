// Themes Module
// Harmonic systems for beat generation

pub mod types;
mod blade_runner;
mod stranger_things;

/// Get a theme by name
pub fn get_theme(name: &str) -> Option<types::Theme> {
    match name.to_uppercase().as_str() {
        "BLADE RUNNER" => Some(blade_runner::blade_runner_theme()),
        "STRANGER THINGS" => Some(stranger_things::stranger_things_theme()),
        _ => None,
    }
}

/// List all available themes with summaries
pub fn list_themes() -> Vec<types::ThemeSummary> {
    vec![
        blade_runner::blade_runner_theme().summary(
            "Vangelis-inspired pads, brass stabs, gated reverb. Melancholic and atmospheric."
        ),
        stranger_things::stranger_things_theme().summary(
            "Synthwave horror with arpeggios, pulsing bass, and dark delay. Retro and unsettling."
        ),
    ]
}

/// Get all theme names
pub fn list_theme_names() -> Vec<String> {
    vec![
        "BLADE RUNNER".to_string(),
        "STRANGER THINGS".to_string(),
    ]
}

// Re-export main types
pub use types::{
    Theme,
    ThemeSummary,
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
}
