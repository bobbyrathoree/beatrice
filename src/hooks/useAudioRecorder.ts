import { useState, useRef, useCallback } from 'react';

export interface AudioRecorderState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioData: Blob | null;
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      // Create audio context for visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });

        setState((prev) => ({
          ...prev,
          isRecording: false,
          isPaused: false,
          audioData: blob,
        }));

        // Cleanup
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      mediaRecorderRef.current = mediaRecorder;

      // Start timer
      startTimeRef.current = Date.now();
      pausedTimeRef.current = 0;

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current - pausedTimeRef.current;

        setState((prev) => ({
          ...prev,
          duration: elapsed,
        }));

        // Auto-stop at max duration
        if (elapsed >= MAX_DURATION) {
          stopRecording();
        }
      }, 50);

      setState({
        isRecording: true,
        isPaused: false,
        duration: 0,
        audioData: null,
        error: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording';
      setState((prev) => ({
        ...prev,
        error: errorMessage,
      }));
      console.error('Error starting recording:', err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
    }
  }, [state.isRecording]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && !state.isPaused) {
      mediaRecorderRef.current.pause();
      pausedTimeRef.current = Date.now() - startTimeRef.current - pausedTimeRef.current;
      setState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [state.isRecording, state.isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && state.isPaused) {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now() - pausedTimeRef.current;
      setState((prev) => ({ ...prev, isPaused: false }));
    }
  }, [state.isRecording, state.isPaused]);

  const getAudioLevel = useCallback((): number => {
    if (!analyserRef.current) return 0;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume
    const sum = dataArray.reduce((acc, val) => acc + val, 0);
    const average = sum / dataArray.length;

    // Normalize to 0-1 range
    return average / 255;
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
