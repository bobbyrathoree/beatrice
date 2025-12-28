import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface AudioRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioData: Uint8Array | null;
  error: string | null;
}

export interface UseAudioRecorderReturn extends AudioRecorderState {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  getAudioLevel: () => number;
}

const MAX_DURATION = 30000; // 30 seconds in milliseconds

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    isPaused: false,
    duration: 0,
    audioData: null,
    error: null,
  });

  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const levelRef = useRef<number>(0);
  const levelIntervalRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    try {
      // Call Rust backend to start recording
      await invoke('start_recording');

      // Start timer
      startTimeRef.current = Date.now();

      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;

        setState((prev) => ({
          ...prev,
          duration: elapsed,
        }));

        // Auto-stop at max duration
        if (elapsed >= MAX_DURATION) {
          stopRecording();
        }
      }, 50);

      // Poll audio level from Rust
      levelIntervalRef.current = window.setInterval(async () => {
        try {
          const level = await invoke<number>('get_recording_level');
          levelRef.current = level;
        } catch {
          // Ignore level polling errors
        }
      }, 100);

      setState({
        isRecording: true,
        isPaused: false,
        duration: 0,
        audioData: null,
        error: null,
      });
    } catch (err) {
      // Handle various error formats from Tauri
      let errorMessage: string;
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = (err as { message: string }).message;
      } else {
        errorMessage = 'Unknown error occurred';
      }
      setState((prev) => ({
        ...prev,
        error: errorMessage,
      }));
      console.error('Error starting recording:', err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!state.isRecording) return;

    try {
      // Stop timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (levelIntervalRef.current) {
        clearInterval(levelIntervalRef.current);
        levelIntervalRef.current = null;
      }

      // Call Rust backend to stop recording and get WAV data
      const wavBytes = await invoke<number[]>('stop_recording');

      // Convert number array to Uint8Array
      const audioData = new Uint8Array(wavBytes);

      setState((prev) => ({
        ...prev,
        isRecording: false,
        isPaused: false,
        audioData,
      }));
    } catch (err) {
      // Handle various error formats from Tauri
      let errorMessage: string;
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = (err as { message: string }).message;
      } else {
        errorMessage = 'Unknown error occurred';
      }
      setState((prev) => ({
        ...prev,
        isRecording: false,
        error: errorMessage,
      }));
      console.error('Error stopping recording:', err);
    }
  }, [state.isRecording]);

  const pauseRecording = useCallback(() => {
    // Pause not implemented in Rust backend yet
    // Could be added if needed
    console.warn('Pause not implemented for native recording');
  }, []);

  const resumeRecording = useCallback(() => {
    // Resume not implemented in Rust backend yet
    console.warn('Resume not implemented for native recording');
  }, []);

  const getAudioLevel = useCallback((): number => {
    return levelRef.current;
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getAudioLevel,
  };
}
