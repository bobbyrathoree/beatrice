// Render Engine - Audio synthesis and rendering using fundsp
// Provides optional audio preview generation for arrangements

pub mod synth;
pub mod effects;
pub mod mixer;

// Re-export main types
pub use mixer::{MixerSettings, render_arrangement};
