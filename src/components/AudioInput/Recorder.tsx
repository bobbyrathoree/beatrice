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
    // Only process if we have audio data and aren't already processing
    if (!audioData || isProcessing) return;

    // Track if we've already started processing to prevent duplicate calls
    let hasStartedProcessing = false;

    const processAudio = async () => {
      // Double-check to prevent race conditions
      if (hasStartedProcessing) return;
      hasStartedProcessing = true;

      setIsProcessing(true);

      try {
        // audioData is already WAV bytes from Rust backend
        // Create project via Tauri command
        const project = await invoke<Project>('create_project', {
          input: {
            name: `Recording ${new Date().toISOString().split('T')[0]}`,
            input_data: Array.from(audioData),
          },
        });

        onProjectCreated(project);
      } catch (err) {
        const errorMessage = err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err) || 'Failed to process recording';
        onError(errorMessage);
      } finally {
        setIsProcessing(false);
      }
    };

    processAudio();
  }, [audioData]);

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
