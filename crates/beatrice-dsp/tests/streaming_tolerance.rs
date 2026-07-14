//! THE SPEC BAR (§5.1): the causal [`StreamingDetector`] must reproduce the
//! offline detector's onsets within ±20ms AND the same class on ≥95% of onsets,
//! across the fixture corpus. Offline stays the source of truth; this test only
//! asserts streaming does not drift away from it.
//!
//! The brief's sketch named a `test-beatbox-realistic` fixture that does not
//! exist in this repo. We instead run the ACTUAL generated corpus
//! (`scripts/generate-test-audio.mjs`): the multi-event patterns plus the
//! single-hit class fixtures. Per-fixture rates are printed on every run so a
//! regression names the offending fixture.

use std::fs;
use std::path::PathBuf;

use beatrice_dsp::{analyze_offline, AudioData, LiveEvent, OnsetConfig, StreamingDetector};

/// The corpus. Multi-event patterns are the meaningful tolerance surface; the
/// single-hit fixtures pin per-class alignment at t≈0.
const FIXTURES: [&str; 7] = [
    "test-pattern",
    "test-offgrid",
    "test-8bar-progression",
    "test-kick",
    "test-hihat",
    "test-snare",
    "test-hum",
];

/// ±ms window for a streaming event to count as matching an offline onset.
const TOLERANCE_MS: f64 = 20.0;
/// Corpus-wide pass bar.
const BAR: f64 = 0.95;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

/// Minimal 16-bit PCM WAV loader (mirrors `offline_freeze.rs`; keeps the DSP
/// crate free of a `hound` dependency).
fn load_fixture(name: &str) -> AudioData {
    let path = repo_root().join("test-audio").join(format!("{name}.wav"));
    let bytes = fs::read(&path).unwrap_or_else(|e| {
        panic!("cannot read fixture {} ({e}). Run `node scripts/generate-test-audio.mjs`.", path.display())
    });
    assert_eq!(&bytes[0..4], b"RIFF", "not a RIFF file: {name}");
    assert_eq!(&bytes[8..12], b"WAVE", "not a WAVE file: {name}");

    let mut pos = 12;
    let mut channels = 1u16;
    let mut sample_rate = 44_100u32;
    let mut bits = 16u16;
    let mut data: &[u8] = &[];
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size =
            u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]])
                as usize;
        let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
        if id == b"fmt " {
            channels = u16::from_le_bytes([body[2], body[3]]);
            sample_rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" {
            data = body;
        }
        pos += 8 + size + (size & 1);
    }
    assert_eq!(bits, 16, "fixture {name} is not 16-bit PCM");
    let samples: Vec<f32> = data
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect();
    let frame_count = samples.len() / channels as usize;
    let duration_ms = ((frame_count as f64 / sample_rate as f64) * 1000.0) as i64;
    AudioData { samples, sample_rate, channels, bit_depth: bits, duration_ms, frame_count }
}

/// Run streaming over the fixture in 128-sample render quanta (the worklet's
/// real chunk size).
fn run_streaming(audio: &AudioData) -> Vec<LiveEvent> {
    let mono = audio.to_mono();
    let mut det = StreamingDetector::new(audio.sample_rate);
    let mut live = Vec::new();
    for chunk in mono.chunks(128) {
        live.extend(det.push(chunk));
    }
    live
}

#[test]
fn streaming_matches_offline_within_tolerance() {
    let cfg = OnsetConfig::default();
    let mut total_offline = 0usize;
    let mut total_matched = 0usize;

    println!("\n=== streaming vs offline tolerance (±{TOLERANCE_MS}ms, same class) ===");
    for name in FIXTURES {
        let audio = load_fixture(name);
        let offline = analyze_offline(&audio, &cfg);
        let live = run_streaming(&audio);

        let mut matched = 0usize;
        // Greedy 1:1 matching so one streaming event can't cover two offline
        // onsets (nearest unused streaming event within tolerance + same class).
        let mut used = vec![false; live.len()];
        for ev in &offline {
            let mut best: Option<(usize, f64)> = None;
            for (i, l) in live.iter().enumerate() {
                if used[i] || l.class != ev.class {
                    continue;
                }
                let d = (l.t_ms - ev.timestamp_ms).abs();
                if d <= TOLERANCE_MS && best.map(|(_, bd)| d < bd).unwrap_or(true) {
                    best = Some((i, d));
                }
            }
            if let Some((i, _)) = best {
                used[i] = true;
                matched += 1;
            }
        }

        total_offline += offline.len();
        total_matched += matched;
        let rate = if offline.is_empty() { 1.0 } else { matched as f64 / offline.len() as f64 };
        println!(
            "  {name:<24} offline={:<3} streaming={:<3} matched={:<3} rate={:.0}%",
            offline.len(),
            live.len(),
            matched,
            rate * 100.0
        );
    }

    let rate = if total_offline == 0 { 1.0 } else { total_matched as f64 / total_offline as f64 };
    println!("  {:-<24} corpus matched={total_matched}/{total_offline} rate={:.1}%\n", "", rate * 100.0);
    assert!(
        rate >= BAR,
        "streaming found {:.1}% of offline onsets within ±{TOLERANCE_MS}ms/same-class (bar: {:.0}%)",
        rate * 100.0,
        BAR * 100.0
    );
}
