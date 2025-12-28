// Phrase Structure - Musical phrase detection and structuring
// Divides arrangements into musical sections (intro, verse, buildup, etc.)

use serde::{Deserialize, Serialize};

/// A musical phrase - a section of the arrangement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phrase {
    /// Starting bar number (0-indexed)
    pub start_bar: u32,

    /// Ending bar number (exclusive, 0-indexed)
    pub end_bar: u32,

    /// Type of phrase (intro, verse, etc.)
    pub phrase_type: PhraseType,
}

impl Phrase {
    /// Create a new phrase
    pub fn new(start_bar: u32, end_bar: u32, phrase_type: PhraseType) -> Self {
        Phrase {
            start_bar,
            end_bar,
            phrase_type,
        }
    }

    /// Get the length of this phrase in bars
    pub fn length_bars(&self) -> u32 {
        self.end_bar.saturating_sub(self.start_bar)
    }

    /// Check if a bar number falls within this phrase
    pub fn contains_bar(&self, bar: u32) -> bool {
        bar >= self.start_bar && bar < self.end_bar
    }
}

/// Type of musical phrase
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhraseType {
    /// Introduction section
    Intro,

    /// Main verse section
    Verse,

    /// Buildup/tension section
    Buildup,

    /// Drop/climax section
    Drop,

    /// Outro/ending section
    Outro,
}

impl PhraseType {
    /// Convert from string representation
    pub fn from_string(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "intro" => PhraseType::Intro,
            "verse" => PhraseType::Verse,
            "buildup" => PhraseType::Buildup,
            "drop" => PhraseType::Drop,
            "outro" => PhraseType::Outro,
            _ => PhraseType::Verse, // Default
        }
    }

    /// Convert to string representation
    pub fn to_string(&self) -> &'static str {
        match self {
            PhraseType::Intro => "intro",
            PhraseType::Verse => "verse",
            PhraseType::Buildup => "buildup",
            PhraseType::Drop => "drop",
            PhraseType::Outro => "outro",
        }
    }
}

/// Complete phrase structure for an arrangement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhraseStructure {
    /// All phrases in the arrangement
    pub phrases: Vec<Phrase>,

    /// Total number of bars in the arrangement
    pub total_bars: u32,
}

impl PhraseStructure {
    /// Create a new phrase structure
    pub fn new(total_bars: u32) -> Self {
        PhraseStructure {
            phrases: Vec::new(),
            total_bars,
        }
    }

    /// Add a phrase to the structure
    pub fn add_phrase(&mut self, phrase: Phrase) {
        self.phrases.push(phrase);
    }

    /// Get the phrase type for a given bar number
    pub fn get_phrase_at_bar(&self, bar: u32) -> Option<&Phrase> {
        self.phrases.iter().find(|p| p.contains_bar(bar))
    }

    /// Create a simple default structure based on bar count
    pub fn default_structure(total_bars: u32) -> Self {
        let mut structure = PhraseStructure::new(total_bars);

        match total_bars {
            0..=4 => {
                // Very short - just a verse
                structure.add_phrase(Phrase::new(0, total_bars, PhraseType::Verse));
            }
            5..=8 => {
                // Short - intro + verse
                structure.add_phrase(Phrase::new(0, 2, PhraseType::Intro));
                structure.add_phrase(Phrase::new(2, total_bars, PhraseType::Verse));
            }
            9..=16 => {
                // Medium - intro + verse + verse
                structure.add_phrase(Phrase::new(0, 2, PhraseType::Intro));
                structure.add_phrase(Phrase::new(2, 8, PhraseType::Verse));
                structure.add_phrase(Phrase::new(8, total_bars, PhraseType::Verse));
            }
            _ => {
                // Long - full structure with buildup and drop
                let intro_end = 4;
                let verse1_end = 12;
                let buildup_end = 16;
                let drop_end = (total_bars - 4).min(24);
                let outro_start = total_bars.saturating_sub(4);

                structure.add_phrase(Phrase::new(0, intro_end, PhraseType::Intro));
                structure.add_phrase(Phrase::new(intro_end, verse1_end, PhraseType::Verse));

                if total_bars > 16 {
                    structure.add_phrase(Phrase::new(verse1_end, buildup_end, PhraseType::Buildup));
                    structure.add_phrase(Phrase::new(buildup_end, drop_end, PhraseType::Drop));

                    // Add verse if there's room
                    if outro_start > drop_end {
                        structure.add_phrase(Phrase::new(drop_end, outro_start, PhraseType::Verse));
                    }
                }

                structure.add_phrase(Phrase::new(outro_start, total_bars, PhraseType::Outro));
            }
        }

        structure
    }

    /// Validate that the phrase structure is consistent
    /// - No gaps between phrases
    /// - No overlapping phrases
    /// - Covers all bars from 0 to total_bars
    pub fn validate(&self) -> Result<(), String> {
        if self.phrases.is_empty() {
            return Err("Phrase structure has no phrases".to_string());
        }

        // Sort phrases by start bar
        let mut sorted_phrases = self.phrases.clone();
        sorted_phrases.sort_by_key(|p| p.start_bar);

        // Check first phrase starts at 0
        if sorted_phrases[0].start_bar != 0 {
            return Err(format!(
                "First phrase must start at bar 0, but starts at {}",
                sorted_phrases[0].start_bar
            ));
        }

        // Check for gaps and overlaps
        for i in 0..sorted_phrases.len() - 1 {
            let current = &sorted_phrases[i];
            let next = &sorted_phrases[i + 1];

            if current.end_bar != next.start_bar {
                return Err(format!(
                    "Gap or overlap between phrases: phrase {} ends at bar {}, phrase {} starts at bar {}",
                    i, current.end_bar, i + 1, next.start_bar
                ));
            }
        }

        // Check last phrase ends at total_bars
        let last = sorted_phrases.last().unwrap();
        if last.end_bar != self.total_bars {
            return Err(format!(
                "Last phrase must end at total_bars ({}), but ends at {}",
                self.total_bars, last.end_bar
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phrase_creation() {
        let phrase = Phrase::new(0, 4, PhraseType::Intro);
        assert_eq!(phrase.start_bar, 0);
        assert_eq!(phrase.end_bar, 4);
        assert_eq!(phrase.length_bars(), 4);
        assert_eq!(phrase.phrase_type, PhraseType::Intro);
    }

    #[test]
    fn test_phrase_contains_bar() {
        let phrase = Phrase::new(4, 8, PhraseType::Verse);

        assert!(!phrase.contains_bar(3));
        assert!(phrase.contains_bar(4));
        assert!(phrase.contains_bar(6));
        assert!(phrase.contains_bar(7));
        assert!(!phrase.contains_bar(8));
    }

    #[test]
    fn test_phrase_type_conversion() {
        assert_eq!(PhraseType::from_string("intro"), PhraseType::Intro);
        assert_eq!(PhraseType::Verse.to_string(), "verse");
    }

    #[test]
    fn test_default_structure_short() {
        let structure = PhraseStructure::default_structure(4);
        assert_eq!(structure.total_bars, 4);
        assert_eq!(structure.phrases.len(), 1);
        assert_eq!(structure.phrases[0].phrase_type, PhraseType::Verse);
    }

    #[test]
    fn test_default_structure_medium() {
        let structure = PhraseStructure::default_structure(8);
        assert_eq!(structure.total_bars, 8);
        assert_eq!(structure.phrases.len(), 2);
        assert_eq!(structure.phrases[0].phrase_type, PhraseType::Intro);
        assert_eq!(structure.phrases[1].phrase_type, PhraseType::Verse);
    }

    #[test]
    fn test_default_structure_long() {
        let structure = PhraseStructure::default_structure(32);
        assert_eq!(structure.total_bars, 32);
        assert!(structure.phrases.len() >= 4);

        // Should have intro
        assert!(structure.phrases.iter().any(|p| p.phrase_type == PhraseType::Intro));
        // Should have outro
        assert!(structure.phrases.iter().any(|p| p.phrase_type == PhraseType::Outro));
    }

    #[test]
    fn test_get_phrase_at_bar() {
        let mut structure = PhraseStructure::new(8);
        structure.add_phrase(Phrase::new(0, 4, PhraseType::Intro));
        structure.add_phrase(Phrase::new(4, 8, PhraseType::Verse));

        let phrase_at_2 = structure.get_phrase_at_bar(2);
        assert!(phrase_at_2.is_some());
        assert_eq!(phrase_at_2.unwrap().phrase_type, PhraseType::Intro);

        let phrase_at_6 = structure.get_phrase_at_bar(6);
        assert!(phrase_at_6.is_some());
        assert_eq!(phrase_at_6.unwrap().phrase_type, PhraseType::Verse);
    }

    #[test]
    fn test_validate_valid_structure() {
        let mut structure = PhraseStructure::new(8);
        structure.add_phrase(Phrase::new(0, 4, PhraseType::Intro));
        structure.add_phrase(Phrase::new(4, 8, PhraseType::Verse));

        assert!(structure.validate().is_ok());
    }

    #[test]
    fn test_validate_gap() {
        let mut structure = PhraseStructure::new(8);
        structure.add_phrase(Phrase::new(0, 3, PhraseType::Intro));
        structure.add_phrase(Phrase::new(4, 8, PhraseType::Verse)); // Gap at bar 3

        assert!(structure.validate().is_err());
    }

    #[test]
    fn test_validate_doesnt_start_at_zero() {
        let mut structure = PhraseStructure::new(8);
        structure.add_phrase(Phrase::new(2, 8, PhraseType::Verse)); // Doesn't start at 0

        assert!(structure.validate().is_err());
    }

    #[test]
    fn test_validate_doesnt_end_at_total() {
        let mut structure = PhraseStructure::new(8);
        structure.add_phrase(Phrase::new(0, 6, PhraseType::Verse)); // Ends at 6, not 8

        assert!(structure.validate().is_err());
    }

    #[test]
    fn test_default_structures_are_valid() {
        // Test various bar counts
        for bar_count in [4, 8, 12, 16, 24, 32] {
            let structure = PhraseStructure::default_structure(bar_count);
            assert!(
                structure.validate().is_ok(),
                "Default structure for {} bars should be valid",
                bar_count
            );
        }
    }
}
