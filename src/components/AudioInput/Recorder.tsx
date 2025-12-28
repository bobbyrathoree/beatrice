import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import type { Project } from '../../store/useStore';

interface RecorderProps {
  onProjectCreated: (project: Project) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

export function Recorder({ onProjectCreated, onError, onCancel }: RecorderProps) {
  const {
    isRecording,
    duration,
    audioData,
    error,
    startRecording,
    stopRecording,
    getAudioLevel,
  } = useAudioRecorder();

  const [waveformData, setWaveformData] = useState<number[]>(
    Array(32).fill(0.1)
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Update waveform visualization
  useEffect(() => {
    if (!isRecording) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const updateWaveform = () => {
      const level = getAudioLevel();

      // Shift array and add new value
      setWaveformData((prev) => {
        const newData = [...prev.slice(1), level];
        return newData;
      });

      animationFrameRef.current = requestAnimationFrame(updateWaveform);
    };

    updateWaveform();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording, getAudioLevel]);

  // Process audio data when recording stops
  useEffect(() => {
    const processAudio = async () => {
      if (!audioData || isProcessing) return;

      setIsProcessing(true);

      try {
        // Convert WebM/Opus to WAV
        const wavBlob = await convertToWav(audioData);
        const arrayBuffer = await wavBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Create project via Tauri command
        const project = await invoke<Project>('create_project', {
          input: {
            name: `Recording ${new Date().toISOString().split('T')[0]}`,
            input_data: Array.from(uint8Array),
          },
        });

        onProjectCreated(project);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to process recording';
        onError(errorMessage);
      } finally {
        setIsProcessing(false);
      }
    };

    processAudio();
  }, [audioData, isProcessing, onProjectCreated, onError]);

  // Display recording errors
  useEffect(() => {
    if (error) {
      onError(error);
    }
  }, [error, onError]);

  // Auto-start recording on mount
  useEffect(() => {
    startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = () => {
    stopRecording();
  };

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const deciseconds = Math.floor((ms % 1000) / 100);
    return `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}.${deciseconds}`;
  };

  const maxDuration = 30000; // 30 seconds
  const progress = (duration / maxDuration) * 100;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '32px',
        width: '100%',
        maxWidth: '800px',
        padding: '32px',
      }}
    >
      {/* Waveform Display */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{
          width: '100%',
          height: '200px',
          border: '4px solid #000',
          borderRadius: '8px',
          backgroundColor: '#FFFFFF',
          padding: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Progress bar background */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${progress}%`,
            height: '100%',
            backgroundColor: duration >= maxDuration ? '#FF0000' : '#FFFF00',
            opacity: 0.2,
            transition: 'width 0.05s linear',
          }}
        />

        {/* Waveform bars */}
        {waveformData.map((value, i) => (
          <motion.div
            key={i}
            animate={{
              height: `${Math.max(10, value * 100)}%`,
            }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 20,
            }}
            style={{
              flex: 1,
              backgroundColor: '#000',
              borderRadius: '2px',
              minHeight: '10%',
            }}
          />
        ))}
      </motion.div>

      {/* Timer and Status */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {isProcessing ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: '#000',
            }}
          >
            PROCESSING...
          </motion.div>
        ) : (
          <>
            <motion.div
              animate={{
                scale: isRecording ? [1, 1.1, 1] : 1,
              }}
              transition={{
                duration: 1,
                repeat: isRecording ? Infinity : 0,
              }}
              style={{
                fontSize: '48px',
                fontWeight: 'bold',
                fontFamily: 'monospace',
                color: duration >= maxDuration ? '#FF0000' : '#000',
              }}
            >
              {formatTime(duration)}
            </motion.div>

            {duration >= maxDuration && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#FF0000',
                }}
              >
                MAX DURATION REACHED
              </motion.div>
            )}

            <div
              style={{
                fontSize: '16px',
                color: '#666',
              }}
            >
              {isRecording ? '● RECORDING...' : 'READY'}
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
        }}
      >
        {isRecording && !isProcessing && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleStop}
            style={{
              padding: '16px 48px',
              fontSize: '24px',
              fontWeight: 'bold',
              border: '4px solid #000',
              borderRadius: '8px',
              backgroundColor: '#FF0000',
              color: '#FFFFFF',
              cursor: 'pointer',
              boxShadow: '4px 4px 0 0 #000',
              transition: 'all 0.1s ease',
            }}
          >
            ■ STOP RECORDING
          </motion.button>
        )}

        {!isRecording && !isProcessing && !audioData && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onCancel}
            style={{
              padding: '16px 48px',
              fontSize: '24px',
              fontWeight: 'bold',
              border: '4px solid #000',
              borderRadius: '8px',
              backgroundColor: '#FFFFFF',
              color: '#000',
              cursor: 'pointer',
              boxShadow: '4px 4px 0 0 #000',
              transition: 'all 0.1s ease',
            }}
          >
            CANCEL
          </motion.button>
        )}
      </div>
    </div>
  );
}

// Helper function to convert WebM/Opus to WAV
async function convertToWav(webmBlob: Blob): Promise<Blob> {
  const audioContext = new AudioContext();
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Convert AudioBuffer to WAV
  const wavBuffer = audioBufferToWav(audioBuffer);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const length = buffer.length * buffer.numberOfChannels * 2;
  const wavBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(wavBuffer);

  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;

  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  // Write interleaved audio data
  const offset = 44;
  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i++) {
    channelData.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset + (i * channels + channel) * 2, int16, true);
    }
  }

  return wavBuffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
