// Arrangement Templates - Template-driven arrangements for consistent musicality
// Defines different arrangement styles and their rules

use serde::{Deserialize, Serialize};
use crate::groove::grid::GridPosition;

/// Arrangement template defines the overall musical style
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrangementTemplate {
    /// Synthwave Straight - kick on 1/3, snare on 2/4, 8th hats
    /// Classic synthwave beat with straight timing
    SynthwaveStraight,

    /// Synthwave Halftime - kick sparse, snare on 3, slower hats
    /// More spacious, relaxed feel
    SynthwaveHalftime,

    /// Arp Drive - minimal drums, heavy arpeggiation
    /// Focus on melodic elements with minimal rhythm
    ArpDrive,
}

impl ArrangementTemplate {
    /// Convert from string representation
    pub fn from_string(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "synthwave_straight" => ArrangementTemplate::SynthwaveStraight,
            "synthwave_halftime" => ArrangementTemplate::SynthwaveHalftime,
            "arp_drive" => ArrangementTemplate::ArpDrive,
            _ => ArrangementTemplate::SynthwaveStraight, // Default
        }
    }

    /// Convert to string representation
    pub fn to_string(&self) -> &'static str {
        match self {
            ArrangementTemplate::SynthwaveStraight => "synthwave_straight",
            ArrangementTemplate::SynthwaveHalftime => "synthwave_halftime",
            ArrangementTemplate::ArpDrive => "arp_drive",
        }
    }

    /// Get the template rules for this arrangement
    pub fn rules(&self) -> TemplateRules {
        match self {
            ArrangementTemplate::SynthwaveStraight => TemplateRules {
                kick_positions: vec![
                    GridPosition { bar: 0, beat: 0, subdivision: 0 }, // Beat 1
                    GridPosition { bar: 0, beat: 2, subdivision: 0 }, // Beat 3
                ],
                snare_positions: vec![
                    GridPosition { bar: 0, beat: 1, subdivision: 0 }, // Beat 2
                    GridPosition { bar: 0, beat: 3, subdivision: 0 }, // Beat 4
                ],
                hihat_density: HihatDensity::Eighth,
                bass_rhythm: BassRhythm::OffbeatEighths,
                arp_enabled: false,
            },

            ArrangementTemplate::SynthwaveHalftime => TemplateRules {
                kick_positions: vec![
                    GridPosition { bar: 0, beat: 0, subdivision: 0 }, // Beat 1
                ],
                snare_positions: vec![
                    GridPosition { bar: 0, beat: 2, subdivision: 0 }, // Beat 3 (halftime)
                ],
                hihat_density: HihatDensity::Sparse,
                bass_rhythm: BassRhythm::HalfNotes,
                arp_enabled: false,
            },

            ArrangementTemplate::ArpDrive => TemplateRules {
                kick_positions: vec![
                    GridPosition { bar: 0, beat: 0, subdivision: 0 }, // Beat 1 only
                ],
                snare_positions: vec![], // Minimal snare
                hihat_density: HihatDensity::Sparse,
                bass_rhythm: BassRhythm::WholeNotes,
                arp_enabled: true,
            },
        }
    }
}

/// Template rules define specific arrangement parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateRules {
    /// Where kick drum hits should occur (positions within a bar pattern)
    pub kick_positions: Vec<GridPosition>,

    /// Where snare hits should occur (positions within a bar pattern)
    pub snare_positions: Vec<GridPosition>,

    /// Hi-hat density level
    pub hihat_density: HihatDensity,

    /// Bass note rhythm pattern
    pub bass_rhythm: BassRhythm,

    /// Whether arpeggiation is enabled
    pub arp_enabled: bool,
}

/// Hi-hat density levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HihatDensity {
    /// Sparse - occasional hi-hats
    Sparse,

    /// Eighth notes - standard beat
    Eighth,

    /// Sixteenth notes - dense, driving rhythm
    Sixteenth,
}

impl HihatDensity {
    /// Get the subdivisions per beat for this density
    pub fn subdivisions_per_beat(&self) -> u32 {
        match self {
            HihatDensity::Sparse => 1,      // Quarter notes
            HihatDensity::Eighth => 2,      // Eighth notes
            HihatDensity::Sixteenth => 4,   // Sixteenth notes
        }
    }
}

/// Bass rhythm patterns
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BassRhythm {
    /// Whole notes - one note per bar
    WholeNotes,

    /// Half notes - one note per half bar
    HalfNotes,

    /// Offbeat eighths - syncopated bass line
    OffbeatEighths,

    /// Root-fifth pattern - classic bass line
    RootFifth,
}

impl BassRhythm {
    /// Get positions where bass notes should occur (within a 4/4 bar)
    pub fn positions(&self) -> Vec<GridPosition> {
        match self {
            BassRhythm::WholeNotes => vec![
                GridPosition { bar: 0, beat: 0, subdivision: 0 },
            ],
            BassRhythm::HalfNotes => vec![
                GridPosition { bar: 0, beat: 0, subdivision: 0 },
                GridPosition { bar: 0, beat: 2, subdivision: 0 },
            ],
            BassRhythm::OffbeatEighths => vec![
                GridPosition { bar: 0, beat: 0, subdivision: 1 }, // Off-beat
                GridPosition { bar: 0, beat: 1, subdivision: 1 },
                GridPosition { bar: 0, beat: 2, subdivision: 1 },
                GridPosition { bar: 0, beat: 3, subdivision: 1 },
            ],
            BassRhythm::RootFifth => vec![
                GridPosition { bar: 0, beat: 0, subdivision: 0 }, // Root
                GridPosition { bar: 0, beat: 1, subdivision: 0 }, // Fifth
                GridPosition { bar: 0, beat: 2, subdivision: 0 }, // Root
                GridPosition { bar: 0, beat: 3, subdivision: 0 }, // Fifth
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_template_from_string() {
        let template = ArrangementTemplate::from_string("synthwave_straight");
        assert_eq!(template, ArrangementTemplate::SynthwaveStraight);
    }

    #[test]
    fn test_template_rules() {
        let template = ArrangementTemplate::SynthwaveStraight;
        let rules = template.rules();

        // Should have kicks on beats 1 and 3
        assert_eq!(rules.kick_positions.len(), 2);
        assert_eq!(rules.kick_positions[0].beat, 0);
        assert_eq!(rules.kick_positions[1].beat, 2);

        // Should have snares on beats 2 and 4
        assert_eq!(rules.snare_positions.len(), 2);
        assert_eq!(rules.snare_positions[0].beat, 1);
        assert_eq!(rules.snare_positions[1].beat, 3);

        // Should have eighth note hi-hats
        assert_eq!(rules.hihat_density, HihatDensity::Eighth);
    }

    #[test]
    fn test_hihat_density_subdivisions() {
        assert_eq!(HihatDensity::Sparse.subdivisions_per_beat(), 1);
        assert_eq!(HihatDensity::Eighth.subdivisions_per_beat(), 2);
        assert_eq!(HihatDensity::Sixteenth.subdivisions_per_beat(), 4);
    }

    #[test]
    fn test_bass_rhythm_positions() {
        let whole_notes = BassRhythm::WholeNotes.positions();
        assert_eq!(whole_notes.len(), 1);

        let half_notes = BassRhythm::HalfNotes.positions();
        assert_eq!(half_notes.len(), 2);

        let offbeat = BassRhythm::OffbeatEighths.positions();
        assert_eq!(offbeat.len(), 4);
        // All should be on subdivision 1 (off-beat)
        assert!(offbeat.iter().all(|p| p.subdivision == 1));
    }

    #[test]
    fn test_halftime_template() {
        let template = ArrangementTemplate::SynthwaveHalftime;
        let rules = template.rules();

        // Halftime should have kick on 1, snare on 3
        assert_eq!(rules.kick_positions.len(), 1);
        assert_eq!(rules.kick_positions[0].beat, 0);

        assert_eq!(rules.snare_positions.len(), 1);
        assert_eq!(rules.snare_positions[0].beat, 2);

        // Should have sparse hi-hats
        assert_eq!(rules.hihat_density, HihatDensity::Sparse);
    }

    #[test]
    fn test_arp_drive_template() {
        let template = ArrangementTemplate::ArpDrive;
        let rules = template.rules();

        // Minimal drums
        assert_eq!(rules.kick_positions.len(), 1);
        assert_eq!(rules.snare_positions.len(), 0);

        // Arp should be enabled
        assert!(rules.arp_enabled);
    }
}
