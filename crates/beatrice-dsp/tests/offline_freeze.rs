//! Golden freeze test for the extracted offline pipeline.
//!
//! The golden JSON files in `tests/golden/` were generated from the CURRENT
//! master (pre-extraction) offline heuristic pipeline. This test re-runs
//! `beatrice_dsp::analyze_offline` over the same deterministic fixtures and
//! asserts the output is field-for-field identical (to 1e-6 on floats).
//!
//! Random UUIDs (`Event.id`) are NEVER compared — they differ every run — so the
//! golden snapshots omit them entirely. Everything the pipeline *computes*
//! (timestamp, duration, class, confidence, all features, all per-class scores)
//! is frozen. A green run proves the crate extraction changed NOTHING.

use std::fs;
use std::path::PathBuf;

use beatrice_dsp::{analyze_offline, AudioData, Event, EventClass, EventFeatures, OnsetConfig};
use serde::Deserialize;

/// Fixtures are 16-bit mono PCM WAVs generated deterministically by
/// `scripts/generate-test-audio.mjs`. We decode them here with a tiny inline
/// reader so the DSP crate stays free of a `hound` dependency (WAV decoding
/// lives in the native crate).
const FIXTURES: [&str; 7] = [
    "test-pattern",
    "test-offgrid",
    "test-kick",
    "test-hihat",
    "test-snare",
    "test-hum",
    "test-8bar-progression",
];

/// Absolute float tolerance for the freeze comparison.
const EPS: f64 = 1e-6;

#[derive(Deserialize)]
struct GoldenScore {
    class: String,
    score: f32,
}

/// The id-free golden snapshot shape (mirrors `Event` minus the random UUID).
#[derive(Deserialize)]
struct GoldenEvent {
    timestamp_ms: f64,
    duration_ms: f64,
    class: String,
    confidence: f32,
    features: EventFeatures,
    all_scores: Vec<GoldenScore>,
}

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/crates/beatrice-dsp
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden")
}

/// Minimal 16-bit PCM WAV loader for the fixtures (avoids a `hound` dep here).
/// Matches `ingest_wav`'s normalization: i16 / 32768.0.
fn load_fixture(name: &str) -> AudioData {
    let path = repo_root().join("test-audio").join(format!("{name}.wav"));
    let bytes = fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read fixture {} ({e}). Run `node scripts/generate-test-audio.mjs`.",
            path.display()
        )
    });

    // Locate the "fmt " and "data" chunks (RIFF).
    assert_eq!(&bytes[0..4], b"RIFF", "not a RIFF file: {name}");
    assert_eq!(&bytes[8..12], b"WAVE", "not a WAVE file: {name}");

    let mut pos = 12;
    let mut channels = 1u16;
    let mut sample_rate = 44100u32;
    let mut bits = 16u16;
    let mut data: &[u8] = &[];

    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
        if id == b"fmt " {
            channels = u16::from_le_bytes([body[2], body[3]]);
            sample_rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" {
            data = body;
        }
        // Chunks are word-aligned (pad byte if odd size).
        pos += 8 + size + (size & 1);
    }

    assert_eq!(bits, 16, "fixture {name} is not 16-bit PCM");
    let samples: Vec<f32> = data
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();

    let frame_count = samples.len() / channels as usize;
    let duration_ms = ((frame_count as f64 / sample_rate as f64) * 1000.0) as i64;

    AudioData {
        samples,
        sample_rate,
        channels,
        bit_depth: bits,
        duration_ms,
        frame_count,
    }
}

fn assert_events_match_golden(events: &[Event], name: &str) {
    let golden_path = golden_dir().join(format!("{name}.json"));
    let json = fs::read_to_string(&golden_path)
        .unwrap_or_else(|e| panic!("cannot read golden {} ({e})", golden_path.display()));
    let golden: Vec<GoldenEvent> = serde_json::from_str(&json)
        .unwrap_or_else(|e| panic!("cannot parse golden {} ({e})", golden_path.display()));

    assert_eq!(
        events.len(),
        golden.len(),
        "[{name}] event count changed: got {}, golden {}",
        events.len(),
        golden.len()
    );

    for (i, (ev, g)) in events.iter().zip(golden.iter()).enumerate() {
        let close = |a: f64, b: f64, field: &str| {
            assert!(
                (a - b).abs() <= EPS,
                "[{name}][{i}] {field} drifted: got {a}, golden {b}"
            );
        };
        close(ev.timestamp_ms, g.timestamp_ms, "timestamp_ms");
        close(ev.duration_ms, g.duration_ms, "duration_ms");
        assert_eq!(
            ev.class.to_string(),
            g.class,
            "[{name}][{i}] class drifted: got {:?}, golden {}",
            ev.class,
            g.class
        );
        close(ev.confidence as f64, g.confidence as f64, "confidence");

        let f = &ev.features;
        let gf = &g.features;
        close(f.spectral_centroid as f64, gf.spectral_centroid as f64, "spectral_centroid");
        close(f.zcr as f64, gf.zcr as f64, "zcr");
        close(f.low_band_energy as f64, gf.low_band_energy as f64, "low_band_energy");
        close(f.mid_band_energy as f64, gf.mid_band_energy as f64, "mid_band_energy");
        close(f.high_band_energy as f64, gf.high_band_energy as f64, "high_band_energy");
        close(f.peak_amplitude as f64, gf.peak_amplitude as f64, "peak_amplitude");
        close(f.crest_factor as f64, gf.crest_factor as f64, "crest_factor");

        assert_eq!(
            ev.all_scores.len(),
            g.all_scores.len(),
            "[{name}][{i}] all_scores length changed"
        );
        for (j, (s, gs)) in ev.all_scores.iter().zip(g.all_scores.iter()).enumerate() {
            assert_eq!(
                s.class.to_string(),
                gs.class,
                "[{name}][{i}] all_scores[{j}] class drifted"
            );
            close(s.score as f64, gs.score as f64, "all_scores.score");
        }

        // Sanity: the class must be one of the four known variants (guards against
        // a broken from-string round-trip masking a drift).
        assert!(matches!(
            ev.class,
            EventClass::BilabialPlosive
                | EventClass::HihatNoise
                | EventClass::Click
                | EventClass::HumVoiced
        ));
    }
}

#[test]
fn offline_pipeline_frozen_against_golden() {
    let cfg = OnsetConfig::default();
    for name in FIXTURES {
        let audio = load_fixture(name);
        let events = analyze_offline(&audio, &cfg);
        assert_events_match_golden(&events, name);
    }
}
