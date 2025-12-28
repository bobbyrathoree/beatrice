// Audio ingestion module
// Reads WAV files, extracts metadata, and normalizes audio samples

use hound::{WavReader, SampleFormat};
use std::io::Cursor;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("Failed to read WAV file: {0}")]
    WavReadError(#[from] hound::Error),

    #[error("Unsupported audio format: {0}")]
    UnsupportedFormat(String),

    #[error("Invalid audio data")]
    InvalidData,
}

#[derive(Debug, Clone)]
pub struct AudioData {
    /// Audio samples normalized to f32 in range [-1.0, 1.0]
    pub samples: Vec<f32>,

    /// Sample rate in Hz (e.g., 44100, 48000)
    pub sample_rate: u32,

    /// Number of channels (1 = mono, 2 = stereo)
    pub channels: u16,

    /// Bit depth of original audio (8, 16, 24, 32)
    pub bit_depth: u16,

    /// Duration in milliseconds
    pub duration_ms: i64,

    /// Total number of frames (samples / channels)
    pub frame_count: usize,
}

impl AudioData {
    /// Get duration in seconds as f64
    pub fn duration_secs(&self) -> f64 {
        self.duration_ms as f64 / 1000.0
    }

    /// Convert to mono by averaging channels
    pub fn to_mono(&self) -> Vec<f32> {
        if self.channels == 1 {
            return self.samples.clone();
        }

        let mut mono = Vec::with_capacity(self.frame_count);
        let channels = self.channels as usize;

        for frame_idx in 0..self.frame_count {
            let mut sum = 0.0;
            for ch in 0..channels {
                sum += self.samples[frame_idx * channels + ch];
            }
            mono.push(sum / channels as f32);
        }

        mono
    }
}

/// Ingest a WAV file from raw bytes
/// Returns AudioData with normalized samples and metadata
pub fn ingest_wav(data: &[u8]) -> Result<AudioData, AudioError> {
    let cursor = Cursor::new(data);
    let mut reader = WavReader::new(cursor)?;

    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let channels = spec.channels;
    let bit_depth = spec.bits_per_sample;
    let sample_format = spec.sample_format;

    // Read and normalize samples to f32 [-1.0, 1.0]
    let samples: Vec<f32> = match (sample_format, bit_depth) {
        (SampleFormat::Int, 8) => {
            // 8-bit PCM: unsigned, range [0, 255] -> [-1.0, 1.0]
            reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .map(|s| (s as f32 - 128.0) / 128.0)
                .collect()
        }
        (SampleFormat::Int, 16) => {
            // 16-bit PCM: signed, range [-32768, 32767] -> [-1.0, 1.0]
            reader
                .samples::<i16>()
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .map(|s| s as f32 / 32768.0)
                .collect()
        }
        (SampleFormat::Int, 24) => {
            // 24-bit PCM: signed, range [-8388608, 8388607] -> [-1.0, 1.0]
            reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .map(|s| s as f32 / 8388608.0)
                .collect()
        }
        (SampleFormat::Int, 32) => {
            // 32-bit PCM: signed, range [-2147483648, 2147483647] -> [-1.0, 1.0]
            reader
                .samples::<i32>()
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .map(|s| s as f32 / 2147483648.0)
                .collect()
        }
        (SampleFormat::Float, 32) => {
            // 32-bit float: already in [-1.0, 1.0] (typically)
            reader
                .samples::<f32>()
                .collect::<Result<Vec<_>, _>>()?
        }
        _ => {
            return Err(AudioError::UnsupportedFormat(format!(
                "{:?} bit {}-bit audio",
                sample_format, bit_depth
            )));
        }
    };

    let total_samples = samples.len();
    let frame_count = total_samples / channels as usize;

    // Calculate duration
    let duration_secs = frame_count as f64 / sample_rate as f64;
    let duration_ms = (duration_secs * 1000.0) as i64;

    Ok(AudioData {
        samples,
        sample_rate,
        channels,
        bit_depth,
        duration_ms,
        frame_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_data_to_mono() {
        // Create stereo audio: [L, R, L, R, L, R]
        let stereo = vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        let audio_data = AudioData {
            samples: stereo,
            sample_rate: 44100,
            channels: 2,
            bit_depth: 16,
            duration_ms: 1,
            frame_count: 3,
        };

        let mono = audio_data.to_mono();

        assert_eq!(mono.len(), 3);
        // Use approximate equality for floating point
        assert!((mono[0] - 0.15).abs() < 1e-6); // (0.1 + 0.2) / 2
        assert!((mono[1] - 0.35).abs() < 1e-6); // (0.3 + 0.4) / 2
        assert!((mono[2] - 0.55).abs() < 1e-6); // (0.5 + 0.6) / 2
    }

    #[test]
    fn test_audio_data_duration_secs() {
        let audio_data = AudioData {
            samples: vec![],
            sample_rate: 44100,
            channels: 1,
            bit_depth: 16,
            duration_ms: 5000,
            frame_count: 0,
        };

        assert_eq!(audio_data.duration_secs(), 5.0);
    }
}
