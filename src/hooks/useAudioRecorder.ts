import { useState, useRef, useCallback, useEffect } from 'react';
import { commands, unwrap, formatIpcError } from '../types/ipc';

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
  // Mirror `isRecording` so callbacks/cleanup read the latest value without
  // depending on it (avoids stale closures and unstable callback identities).
  const isRecordingRef = useRef(false);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

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
      const wavBytes = unwrap(await commands.stopRecording());

      // Convert number array to Uint8Array
      const audioData = new Uint8Array(wavBytes);

      setState((prev) => ({
        ...prev,
        isRecording: false,
        isPaused: false,
        audioData,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isRecording: false,
        error: formatIpcError(err),
      }));
      console.error('Error stopping recording:', err);
    }
  }, []);

  // Keep the latest `stopRecording` in a ref so the interval body and unmount
  // cleanup always call the current implementation, not a stale closure.
  const stopRef = useRef<() => Promise<void>>(stopRecording);
  useEffect(() => {
    stopRef.current = stopRecording;
  });

  const startRecording = useCallback(async () => {
    try {
      // Call Rust backend to start recording
      unwrap(await commands.startRecording());
      isRecordingRef.current = true;

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
          void stopRef.current();
        }
      }, 50);

      // Poll audio level from Rust
      levelIntervalRef.current = window.setInterval(async () => {
        try {
          const level = unwrap(await commands.getRecordingLevel());
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
      isRecordingRef.current = false;
      setState((prev) => ({
        ...prev,
        error: formatIpcError(err),
      }));
      console.error('Error starting recording:', err);
    }
  }, []);

  // Unmount only: clear intervals and stop the recording if still active.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
      if (isRecordingRef.current) void stopRef.current();
    },
    [],
  );

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
