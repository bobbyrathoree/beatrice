// useAudioPlayback - WebAudio synthesis for in-app arrangement playback
//
// Owns the live playback lifecycle: AudioContext creation/teardown, the RAF
// progress tick, and the isPlaying/currentTime/duration state machine. The
// actual synthesis and note scheduling lives in `../audio/scheduleArrangement`,
// the same pure module the offline WAV renderer uses — so what users hear and
// what they export come from one code path.

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  createFxBus,
  scheduleArrangement,
  calculateArrangementDuration,
} from '../audio/scheduleArrangement';

export function useAudioPlayback(initialArrangement?: any, initialBpm?: number) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const durationRef = useRef<number>(0);

  // Update duration when arrangement or BPM changes
  useEffect(() => {
    if (initialArrangement) {
      const dur = calculateArrangementDuration(initialArrangement, initialBpm || 120);
      setDuration(dur);
      durationRef.current = dur;
    }
  }, [initialArrangement, initialBpm]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, []);

  // Tick function to update currentTime during playback
  const tick = useCallback(() => {
    if (!ctxRef.current || !isPlaying) return;

    const elapsed = ctxRef.current.currentTime - playStartRef.current;
    if (elapsed >= durationRef.current) {
      setCurrentTime(durationRef.current);
      setIsPlaying(false);
      return;
    }

    setCurrentTime(elapsed);
    rafRef.current = requestAnimationFrame(tick);
  }, [isPlaying]);

  // Start the animation frame loop when playing
  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, tick]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const play = useCallback((arrangement: unknown, bpm: number) => {
    // Stop any existing playback first
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const songDurationSec = calculateArrangementDuration(arrangement, bpm);

    durationRef.current = songDurationSec;
    setDuration(songDurationSec);

    // Create a fresh AudioContext
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Build a fresh master FX bus wired to this context's destination, then
    // schedule all notes directly — song structure (Intro/Build/Drop/Outro)
    // is already baked into the arrangement by the Rust arranger.
    const bus = createFxBus(ctx, ctx.destination);
    const startTime = ctx.currentTime + 0.05;
    playStartRef.current = startTime;

    scheduleArrangement(ctx, bus, arrangement, startTime);

    setCurrentTime(0);
    setIsPlaying(true);
  }, []);

  return {
    isPlaying,
    currentTime,
    duration,
    play,
    stop,
  };
}
