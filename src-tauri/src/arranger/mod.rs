// Arranger - Template-driven musical arrangement
// Converts detected events into structured MIDI arrangements

pub mod templates;
pub mod drum_lanes;
pub mod phrase;
pub mod midi;

// Re-export main types
pub use templates::{ArrangementTemplate, TemplateRules, HihatDensity, BassRhythm};
pub use drum_lanes::{DrumLane, ArrangedNote, Arrangement, arrange_events};
pub use phrase::{Phrase, PhraseType, PhraseStructure};
pub use midi::{MidiExportOptions, export_midi};
