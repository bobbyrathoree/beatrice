// Theme Type Definitions
// Themes are harmonic systems, not just patches

use serde::{Deserialize, Serialize};

/// Musical scale families
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScaleFamily {
    MinorPentatonic,
    NaturalMinor,
    HarmonicMinor,
    Dorian,
    Phrygian,
}

/// Chord types by scale degree
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChordType {
    I,    // Major I
    II,   // Major II
    III,  // Major III
    IV,   // Major IV
    V,    // Major V
    VI,   // Major VI
    VII,  // Major VII
    Im,   // Minor i
    IIm,  // Minor ii
    IIIm, // Minor iii
    IVm,  // Minor iv
    Vm,   // Minor v
    VIm,  // Minor vi
    VIIm, // Minor vii
}

/// Chord progression structure
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChordProgression {
    pub chords: Vec<ChordType>,
    pub bars_per_chord: u32,
}

/// Arpeggiator patterns
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArpPattern {
    Up158,       // 1-5-8 ascending
    Down851,     // 8-5-1 descending
    Alternating, // Alternating pattern
    Random,      // Random pattern
}

/// Bass line patterns
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BassPattern {
    Root,           // Just root notes
    RootFifth,      // Root and fifth
    OffbeatEighths, // Offbeat eighth notes
    Walking,        // Walking bass line
}

/// Drum kit palettes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DrumPalette {
    SynthwaveDrums, // 80s electronic
    AcousticKit,    // Natural drums
    TR808,          // Classic 808
}

/// Effects profiles
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FxProfile {
    GatedReverb, // 80s gated reverb
    WideChorus,  // Lush chorus
    DarkDelay,   // Dark, ambient delay
    Dry,         // No effects
}

/// Complete theme definition
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Theme {
    pub name: String,
    pub bpm_range: (u32, u32),           // Suggested BPM range
    pub root_note: u8,                   // MIDI note (e.g., 62 = D)
    pub scale_family: ScaleFamily,
    pub chord_progression: ChordProgression,
    pub bass_pattern: BassPattern,
    pub arp_pattern: ArpPattern,
    pub arp_octave_range: (i8, i8),      // e.g., (-1, 1) for 3 octaves
    pub drum_palette: DrumPalette,
    pub fx_profile: FxProfile,
    pub synth_stab_velocity: u8,         // Velocity for B-triggered synth
    pub pad_sustain: bool,               // Long sustaining pads
}

/// Theme summary for UI display
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeSummary {
    pub name: String,
    pub description: String,
    pub bpm_range: (u32, u32),
    pub root_note: u8,
    pub scale_family: ScaleFamily,
}

impl Theme {
    /// Get a summary of this theme for UI display
    pub fn summary(&self, description: &str) -> ThemeSummary {
        ThemeSummary {
            name: self.name.clone(),
            description: description.to_string(),
            bpm_range: self.bpm_range,
            root_note: self.root_note,
            scale_family: self.scale_family,
        }
    }
}

// Helper functions for musical calculations

/// Get scale notes from root and scale family
pub fn scale_notes(root: u8, family: &ScaleFamily) -> Vec<u8> {
    let intervals = match family {
        ScaleFamily::MinorPentatonic => vec![0, 3, 5, 7, 10],
        ScaleFamily::NaturalMinor => vec![0, 2, 3, 5, 7, 8, 10],
        ScaleFamily::HarmonicMinor => vec![0, 2, 3, 5, 7, 8, 11],
        ScaleFamily::Dorian => vec![0, 2, 3, 5, 7, 9, 10],
        ScaleFamily::Phrygian => vec![0, 1, 3, 5, 7, 8, 10],
    };

    intervals.iter().map(|&i| root + i).collect()
}

/// Get chord notes from root, chord type, and scale
pub fn chord_notes(root: u8, chord_type: &ChordType, scale: &[u8]) -> Vec<u8> {
    // Map chord type to scale degree (0-indexed)
    let degree = match chord_type {
        ChordType::I | ChordType::Im => 0,
        ChordType::II | ChordType::IIm => 1,
        ChordType::III | ChordType::IIIm => 2,
        ChordType::IV | ChordType::IVm => 3,
        ChordType::V | ChordType::Vm => 4,
        ChordType::VI | ChordType::VIm => 5,
        ChordType::VII | ChordType::VIIm => 6,
    };

    if degree >= scale.len() {
        return vec![root]; // Fallback to root if scale degree out of range
    }

    let chord_root = scale[degree];
    let is_minor = matches!(
        chord_type,
        ChordType::Im | ChordType::IIm | ChordType::IIIm |
        ChordType::IVm | ChordType::Vm | ChordType::VIm | ChordType::VIIm
    );

    // Build triad (root, third, fifth)
    let third_offset = if is_minor { 3 } else { 4 };
    let fifth_offset = 7;

    vec![
        chord_root,
        chord_root + third_offset,
        chord_root + fifth_offset,
    ]
}

/// Generate arpeggio notes from chord and pattern
pub fn arp_notes(chord: &[u8], pattern: &ArpPattern, octave_range: (i8, i8)) -> Vec<u8> {
    let mut notes = Vec::new();

    // Expand chord across octave range
    for octave in octave_range.0..=octave_range.1 {
        for &note in chord {
            let shifted = (note as i8 + (octave * 12)) as u8;
            if shifted < 128 {
                notes.push(shifted);
            }
        }
    }

    // Apply pattern
    match pattern {
        ArpPattern::Up158 => {
            // Keep ascending order (already sorted)
            notes
        }
        ArpPattern::Down851 => {
            // Reverse for descending
            notes.reverse();
            notes
        }
        ArpPattern::Alternating => {
            // Alternate up and down
            let mut result = Vec::new();
            let len = notes.len();
            for i in 0..len {
                if i % 2 == 0 {
                    result.push(notes[i]);
                } else {
                    result.push(notes[len - 1 - i]);
                }
            }
            result
        }
        ArpPattern::Random => {
            // For now, return sorted (true random would need RNG)
            notes
        }
    }
}

/// Generate bass line notes from chord and pattern
pub fn bass_notes(chord_root: u8, pattern: &BassPattern) -> Vec<u8> {
    match pattern {
        BassPattern::Root => vec![chord_root],
        BassPattern::RootFifth => vec![chord_root, chord_root + 7],
        BassPattern::OffbeatEighths => {
            // Repeated root for offbeat pattern
            vec![chord_root, chord_root, chord_root, chord_root]
        }
        BassPattern::Walking => {
            // Walking pattern: root, third, fifth, seventh
            vec![chord_root, chord_root + 3, chord_root + 7, chord_root + 10]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_natural_minor_scale() {
        // D natural minor: D, E, F, G, A, Bb, C
        let notes = scale_notes(62, &ScaleFamily::NaturalMinor);
        assert_eq!(notes, vec![62, 64, 65, 67, 69, 70, 72]);
    }

    #[test]
    fn test_minor_chord() {
        let scale = scale_notes(62, &ScaleFamily::NaturalMinor);
        let chord = chord_notes(62, &ChordType::Im, &scale);
        // Dm chord: D, F, A (62, 65, 69)
        assert_eq!(chord, vec![62, 65, 69]);
    }

    #[test]
    fn test_arp_pattern() {
        let chord = vec![60, 64, 67]; // C major triad
        let arp = arp_notes(&chord, &ArpPattern::Up158, (0, 1));
        // Should contain notes across 2 octaves
        assert!(arp.len() >= 6);
        assert!(arp.contains(&60));
        assert!(arp.contains(&72)); // C one octave up
    }

    #[test]
    fn test_bass_patterns() {
        let root = 36; // C2

        let root_only = bass_notes(root, &BassPattern::Root);
        assert_eq!(root_only, vec![36]);

        let root_fifth = bass_notes(root, &BassPattern::RootFifth);
        assert_eq!(root_fifth, vec![36, 43]);

        let walking = bass_notes(root, &BassPattern::Walking);
        assert_eq!(walking.len(), 4);
    }
}
