// Groove Engine - Tempo, Grid, and Quantization
// Phase 5: Musical timing and quantization system

pub mod tempo;
pub mod grid;
pub mod quantize;

pub use tempo::{TempoEstimate, estimate_tempo};
pub use grid::{TimeSignature, GridDivision, GrooveFeel, Grid, GridPosition};
pub use quantize::{QuantizeSettings, QuantizedEvent, quantize_events};
