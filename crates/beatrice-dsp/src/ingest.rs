// Audio data container
//
// Holds decoded, normalized PCM samples plus metadata. This is the input
// contract for the offline DSP pipeline (onset detection + feature extraction).
//
// NOTE: WAV *decoding* (`ingest_wav`, via the `hound` crate) intentionally lives
// in the native `beatrice` crate, not here — the AudioWorklet path feeds raw f32
// render quanta directly and never touches `hound`. Only the data container and
// its channel/duration helpers moved into the DSP crate.

/// Decoded audio with normalized f32 samples and metadata.
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
