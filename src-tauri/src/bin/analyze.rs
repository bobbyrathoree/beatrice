//! CLI tool to analyze a WAV file through the Beatrice pipeline.
//! Usage: cargo run --bin analyze -- <path-to-wav>

use std::env;
use std::fs;

use beatrice_lib::audio::{self, OnsetConfig};
use beatrice_lib::groove::{self, Grid, GridDivision, GrooveFeel, QuantizeSettings, TimeSignature};
use beatrice_lib::arranger::{self, ArrangementTemplate};

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <path-to-wav>", args[0]);
        std::process::exit(1);
    }

    let path = &args[1];
    let bytes = fs::read(path).unwrap_or_else(|e| {
        eprintln!("Error reading '{}': {}", path, e);
        std::process::exit(1);
    });

    let audio = audio::ingest_wav(&bytes).unwrap_or_else(|e| {
        eprintln!("Error parsing WAV: {}", e);
        std::process::exit(1);
    });

    println!("=== AUDIO ===");
    println!("  {}Hz {}ch {}bit {:.2}s", audio.sample_rate, audio.channels, audio.bit_depth, audio.duration_ms as f64 / 1000.0);

    let config = OnsetConfig::default();
    let onsets = audio::detect_onsets(&audio, &config);
    println!("\n=== {} ONSETS ===", onsets.len());

    if onsets.is_empty() {
        println!("No onsets detected.");
        return;
    }

    // Shared offline detect→feature→classify loop (single home in beatrice-dsp),
    // through the shipping hybrid classifier (AVP Gaussian + hum gate).
    let hybrid = beatrice_dsp::HybridClassifier::factory();
    let events = beatrice_dsp::analyze_offline_hybrid(&audio, &config, &hybrid);
    println!("\n=== EVENTS ===");
    for (i, e) in events.iter().enumerate() {
        let f = &e.features;
        println!("  [{:2}] {:8.1}ms {:20} {:.0}%  c={:.0} z={:.3} lo={:.2} mi={:.2} hi={:.2} pk={:.2} cr={:.1}",
            i, e.timestamp_ms, format!("{:?}", e.class), e.confidence*100.0,
            f.spectral_centroid, f.zcr, f.low_band_energy, f.mid_band_energy, f.high_band_energy, f.peak_amplitude, f.crest_factor);
    }

    let tempo = groove::estimate_tempo(&onsets, audio.sample_rate);
    println!("\n=== TEMPO: {:.1} BPM (conf={:.0}%) ===", tempo.bpm, tempo.confidence*100.0);

    let grid = Grid::with_phase(tempo.bpm, TimeSignature::FourFour, GridDivision::Sixteenth, GrooveFeel::Straight, 0.0, 4, tempo.phase_offset_ms);
    let settings = QuantizeSettings { strength: 0.8, swing_amount: 0.0, lookahead_ms: 100.0 };
    let quantized = groove::quantize_events(&events, &grid, &settings);

    println!("\n=== QUANTIZED ===");
    for qe in &quantized {
        println!("  {:20} {:.1}ms → {:.1}ms ({:+.1}ms)",
            format!("{:?}", qe.original_event.class), qe.original_event.timestamp_ms, qe.quantized_timestamp_ms, qe.snap_delta_ms);
    }

    let theme = beatrice_lib::themes::get_theme("BLADE RUNNER").expect("Theme not found");
    // Default fidelity 0.8 matches the ArrangeEventsInput serde default.
    let arr = arranger::arrange_events(&quantized, &ArrangementTemplate::SynthwaveStraight, &grid, &theme, 0.6, 0.8);
    let total: usize = arr.all_lanes().iter().map(|l| l.events.len()).sum();
    println!("\n=== ARRANGEMENT ({} notes) ===", total);
    let note_names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    for lane in arr.all_lanes() {
        if !lane.events.is_empty() {
            println!("  {} ({} notes)", lane.name, lane.events.len());
            for note in &lane.events {
                let midi = note.midi_note.unwrap_or(lane.midi_note);
                let name = note_names[(midi % 12) as usize];
                let octave = (midi / 12) as i8 - 1;
                println!("      t={:.0}ms  vel={}  note={}{} (MIDI {})",
                    note.timestamp_ms, note.velocity, name, octave, midi);
            }
        }
    }
    println!("\nDone.");
}
