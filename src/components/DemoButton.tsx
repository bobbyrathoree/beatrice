import { useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../store/useStore';

interface DemoButtonProps {
  onProjectCreated: (project: Project) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}

/**
 * DemoButton - One-click demo with built-in beatbox sample
 *
 * This component provides a quick way for users to experience Beatrice
 * without needing to record or upload their own audio. It uses an
 * embedded short beatbox sample to demonstrate the full pipeline.
 */
export function DemoButton({ onProjectCreated, onError, disabled = false }: DemoButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDemo = async () => {
    setIsLoading(true);

    try {
      // Generate a simple demo beatbox sample
      // In a real implementation, you'd have a pre-recorded sample embedded
      // For now, we'll create a simple placeholder that the backend can process
      const demoSample = generateDemoSample();

      // Create project with demo data
      const project = await invoke<Project>('create_project', {
        input: {
          name: 'Demo Beatbox',
          input_data: Array.from(demoSample),
        },
      });

      onProjectCreated(project);
    } catch (err) {
      console.error('Demo failed:', err);
      onError(err instanceof Error ? err.message : 'Failed to load demo');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.button
      className="btn btn-demo btn-large"
      onClick={handleDemo}
      disabled={disabled || isLoading}
      whileHover={!disabled && !isLoading ? { scale: 1.02, y: -2 } : {}}
      whileTap={!disabled && !isLoading ? { scale: 0.98 } : {}}
      style={{
        width: '100%',
        position: 'relative',
      }}
    >
      {isLoading ? (
        <>
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          >
            ⚡
          </motion.span>
          LOADING DEMO...
        </>
      ) : (
        <>
          ⚡ TRY DEMO
        </>
      )}
    </motion.button>
  );
}

/**
 * Generate a simple demo WAV file
 * This creates a minimal valid WAV file with some sample data
 * In production, you'd embed a real beatbox recording
 */
function generateDemoSample(): Uint8Array {
  // WAV file format:
  // - RIFF header (12 bytes)
  // - fmt chunk (24 bytes)
  // - data chunk (8 bytes + actual audio data)

  const sampleRate = 44100;
  const duration = 2; // 2 seconds
  const numSamples = sampleRate * duration;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = 44 + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Generate simple beatbox-like pattern
  // This creates a pattern with some percussive sounds
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const time = i / sampleRate;
    let sample = 0;

    // Kick-like hits at 0.5, 1.0, 1.5 seconds
    if (Math.abs(time - 0.5) < 0.05 || Math.abs(time - 1.0) < 0.05 || Math.abs(time - 1.5) < 0.05) {
      const decay = Math.exp(-20 * (time % 0.5));
      sample = Math.sin(2 * Math.PI * 100 * time) * decay * 0.8;
    }

    // Hi-hat-like noise every 0.25 seconds
    if (time % 0.25 < 0.02) {
      sample += (Math.random() * 2 - 1) * 0.3;
    }

    // Snare-like hits at 0.75, 1.75 seconds
    if (Math.abs(time - 0.75) < 0.03 || Math.abs(time - 1.75) < 0.03) {
      const decay = Math.exp(-30 * Math.abs(time - Math.floor(time * 4) / 4));
      sample += (Math.random() * 2 - 1) * decay * 0.6;
    }

    // Convert to 16-bit PCM
    const sampleInt = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    view.setInt16(offset, sampleInt, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Helper to write ASCII string to DataView
 */
function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
