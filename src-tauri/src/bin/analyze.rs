/// CLI tool to analyze a WAV file through the Beatrice pipeline.
/// Usage: cargo run --bin analyze -- <path-to-wav>

use std::env;
use std::fs;

use beatrice_lib::audio::{self, OnsetConfig};
use beatrice_lib::events::{self, HeuristicClassifier};
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

    let classifier = HeuristicClassifier::new();
    let mut events = Vec::new();
    println!("\n=== EVENTS ===");
    for (i, onset) in onsets.iter().enumerate() {
        let dur = if i + 1 < onsets.len() { onsets[i+1].timestamp_ms - onset.timestamp_ms } else { audio.duration_ms as f64 - onset.timestamp_ms };
        let win = dur.clamp(50.0, 500.0);
        let f = audio::extract_features_for_window(&audio, onset.timestamp_ms, win);
        let r = classifier.classify(&f);
        println!("  [{:2}] {:8.1}ms {:20} {:.0}%  c={:.0} z={:.3} lo={:.2} mi={:.2} hi={:.2} pk={:.2} cr={:.1}",
            i, onset.timestamp_ms, format!("{:?}", r.class), r.confidence*100.0,
            f.spectral_centroid, f.zcr, f.low_band_energy, f.mid_band_energy, f.high_band_energy, f.peak_amplitude, f.crest_factor);
        events.push(events::Event::new(onset.timestamp_ms, dur, r.class, r.confidence, f));
    }

    let tempo = groove::estimate_tempo(&onsets, audio.sample_rate);
    println!("\n=== TEMPO: {:.1} BPM (conf={:.0}%) ===", tempo.bpm, tempo.confidence*100.0);

    let grid = Grid::new_with_feel(tempo.bpm, TimeSignature::FourFour, GridDivision::Sixteenth, GrooveFeel::Straight, 0.0, 4);
    let settings = QuantizeSettings { strength: 0.8, swing_amount: 0.0, lookahead_ms: 100.0 };
    let quantized = groove::quantize_events(&events, &grid, &settings);

    println!("\n=== QUANTIZED ===");
    for qe in &quantized {
        println!("  {:20} {:.1}ms → {:.1}ms ({:+.1}ms)",
            format!("{:?}", qe.original_event.class), qe.original_event.timestamp_ms, qe.quantized_timestamp_ms, qe.snap_delta_ms);
    }

    let arr = arranger::arrange_events(&quantized, &ArrangementTemplate::SynthwaveStraight, &grid, 0.6);
    let total: usize = arr.all_lanes().iter().map(|l| l.events.len()).sum();
    println!("\n=== ARRANGEMENT ({} notes) ===", total);
    for lane in arr.all_lanes() {
        if !lane.events.is_empty() {
            println!("  {} ({} notes)", lane.name, lane.events.len());
        }
    }
    println!("\nDone.");
}
