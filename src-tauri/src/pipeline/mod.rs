// Pipeline execution and monitoring module
// Orchestrates the full beatbox-to-synth pipeline

pub mod trace;

pub use trace::{TraceBuilder, TraceEntry, TraceError, TraceWriter, read_trace_file};
