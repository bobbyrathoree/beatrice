//! Native audio recording using cpal
//! Bypasses browser API limitations in Tauri WebView

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum RecordingError {
    #[error("No input device available")]
    NoInputDevice,
    #[error("Failed to get default input config: {0}")]
    ConfigError(String),
    #[error("Failed to build input stream: {0}")]
    StreamError(String),
    #[error("Recording not started")]
    NotStarted,
    #[error("Recording already in progress")]
    AlreadyRecording,
}

/// Thread-safe recording state that can be shared across Tauri
/// The actual stream runs in a separate thread to avoid Send/Sync issues
pub struct RecordingState {
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<Mutex<u32>>,
    channels: Arc<Mutex<u16>>,
    is_recording: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            sample_rate: Arc::new(Mutex::new(44100)),
            channels: Arc::new(Mutex::new(1)),
            is_recording: Arc::new(AtomicBool::new(false)),
            stop_signal: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start recording from the default input device
    pub fn start(&self) -> Result<(), RecordingError> {
        // Force reset any stale recording state from previous attempts
        // This handles cases where stop() didn't cleanly finish
        if self.is_recording.load(Ordering::SeqCst) {
            // Give it a moment to stop
            self.stop_signal.store(true, Ordering::SeqCst);
            thread::sleep(std::time::Duration::from_millis(200));
            // Force reset
            self.is_recording.store(false, Ordering::SeqCst);
        }

        // Clear previous samples and reset stop signal
        self.samples.lock().unwrap().clear();
        self.stop_signal.store(false, Ordering::SeqCst);

        let samples = Arc::clone(&self.samples);
        let sample_rate = Arc::clone(&self.sample_rate);
        let channels = Arc::clone(&self.channels);
        let is_recording = Arc::clone(&self.is_recording);
        let stop_signal = Arc::clone(&self.stop_signal);

        // Spawn recording thread
        thread::spawn(move || {
            if let Err(e) = run_recording(samples, sample_rate, channels, is_recording.clone(), stop_signal) {
                eprintln!("Recording error: {}", e);
                is_recording.store(false, Ordering::SeqCst);
            }
        });

        // Wait a bit for the thread to start
        thread::sleep(std::time::Duration::from_millis(100));

        Ok(())
    }

    /// Stop recording and return the recorded samples
    pub fn stop(&self) -> Result<RecordingData, RecordingError> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Err(RecordingError::NotStarted);
        }

        // Signal the recording thread to stop
        self.stop_signal.store(true, Ordering::SeqCst);

        // Wait for recording to actually stop
        for _ in 0..50 {
            if !self.is_recording.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(20));
        }

        let samples = self.samples.lock().unwrap().clone();
        let sample_rate = *self.sample_rate.lock().unwrap();
        let channels = *self.channels.lock().unwrap();

        Ok(RecordingData {
            samples,
            sample_rate,
            channels,
        })
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Get the current audio level (0.0 - 1.0)
    pub fn get_level(&self) -> f32 {
        let samples = self.samples.lock().unwrap();
        if samples.is_empty() {
            return 0.0;
        }

        // Get RMS of last ~1000 samples
        let start = samples.len().saturating_sub(1000);
        let recent: &[f32] = &samples[start..];

        if recent.is_empty() {
            return 0.0;
        }

        let sum_squares: f32 = recent.iter().map(|s| s * s).sum();
        let rms = (sum_squares / recent.len() as f32).sqrt();

        // Normalize to 0-1 range (assuming max RMS is ~0.5 for typical audio)
        (rms * 2.0).min(1.0)
    }
}

impl Default for RecordingState {
    fn default() -> Self {
        Self::new()
    }
}

// Unsafe impl required because we manage thread safety ourselves
unsafe impl Send for RecordingState {}
unsafe impl Sync for RecordingState {}

/// Run recording in a dedicated thread
fn run_recording(
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate_out: Arc<Mutex<u32>>,
    channels_out: Arc<Mutex<u16>>,
    is_recording: Arc<AtomicBool>,
    stop_signal: Arc<AtomicBool>,
) -> Result<(), RecordingError> {
    let host = cpal::default_host();

    let device = host
        .default_input_device()
        .ok_or(RecordingError::NoInputDevice)?;

    let config = device
        .default_input_config()
        .map_err(|e| RecordingError::ConfigError(e.to_string()))?;

    // Store audio format info
    *sample_rate_out.lock().unwrap() = config.sample_rate().0;
    *channels_out.lock().unwrap() = config.channels();

    let samples_clone = Arc::clone(&samples);
    let is_rec = Arc::clone(&is_recording);

    let err_fn = |err| eprintln!("Recording error: {}", err);

    let stream = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &_| {
                if is_rec.load(Ordering::Relaxed) {
                    samples_clone.lock().unwrap().extend_from_slice(data);
                }
            },
            err_fn,
            None,
        ),
        SampleFormat::I16 => {
            let samples_clone = Arc::clone(&samples);
            let is_rec = Arc::clone(&is_recording);
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &_| {
                    if is_rec.load(Ordering::Relaxed) {
                        let floats: Vec<f32> = data.iter().map(|&s| s.to_float_sample()).collect();
                        samples_clone.lock().unwrap().extend_from_slice(&floats);
                    }
                },
                err_fn,
                None,
            )
        },
        SampleFormat::U16 => {
            let samples_clone = Arc::clone(&samples);
            let is_rec = Arc::clone(&is_recording);
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &_| {
                    if is_rec.load(Ordering::Relaxed) {
                        let floats: Vec<f32> = data.iter().map(|&s| s.to_float_sample()).collect();
                        samples_clone.lock().unwrap().extend_from_slice(&floats);
                    }
                },
                err_fn,
                None,
            )
        },
        _ => return Err(RecordingError::ConfigError("Unsupported sample format".to_string())),
    }
    .map_err(|e| RecordingError::StreamError(e.to_string()))?;

    stream.play().map_err(|e| RecordingError::StreamError(e.to_string()))?;
    is_recording.store(true, Ordering::SeqCst);

    // Wait until stop signal
    while !stop_signal.load(Ordering::SeqCst) {
        thread::sleep(std::time::Duration::from_millis(50));
    }

    // Stream will be dropped here, stopping recording
    is_recording.store(false, Ordering::SeqCst);

    Ok(())
}

// Keep the old type alias for compatibility
pub type AudioRecorder = RecordingState;

/// Recorded audio data
#[derive(Clone)]
pub struct RecordingData {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl RecordingData {
    /// Convert to mono if stereo
    pub fn to_mono(&self) -> Vec<f32> {
        if self.channels == 1 {
            return self.samples.clone();
        }

        // Average stereo channels
        self.samples
            .chunks(self.channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / chunk.len() as f32)
            .collect()
    }

    /// Convert to WAV bytes
    pub fn to_wav(&self) -> Result<Vec<u8>, hound::Error> {
        let spec = hound::WavSpec {
            channels: 1, // Always mono for processing
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)?;

            let mono_samples = self.to_mono();
            for sample in mono_samples {
                // Convert f32 (-1.0 to 1.0) to i16
                let int_sample = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
                writer.write_sample(int_sample)?;
            }
            writer.finalize()?;
        }

        Ok(cursor.into_inner())
    }

    /// Get duration in milliseconds
    pub fn duration_ms(&self) -> u64 {
        let mono_len = self.samples.len() / self.channels as usize;
        (mono_len as u64 * 1000) / self.sample_rate as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recording_data_to_mono() {
        let data = RecordingData {
            samples: vec![0.5, 0.3, 0.4, 0.2],
            sample_rate: 44100,
            channels: 2,
        };
        let mono = data.to_mono();
        assert_eq!(mono.len(), 2);
        assert!((mono[0] - 0.4).abs() < 0.01);
        assert!((mono[1] - 0.3).abs() < 0.01);
    }
}
