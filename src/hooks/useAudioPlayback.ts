// useAudioPlayback - WebAudio synthesis for in-app arrangement playback
//
// Owns the live playback lifecycle: AudioContext creation/teardown, the RAF
// progress tick, and the isPlaying/currentTime/duration state machine. The
// actual synthesis and note scheduling lives in `../audio/scheduleArrangement`,
// the same pure module the offline WAV renderer uses — so what users hear and
// what they export come from one code path.
//
// DURATION (the exposed state) is the MUSICAL duration only — the span of
// scheduled notes (calculateArrangementDuration). The UI keys off this: the
// progress bar reaches 100% at the musical end, and the Song Mode section HUD
// derives Intro/Build/Drop/Outro from duration/4, so a variable FX tail must NOT
// leak into it.
//
// The themed FX tail (timbre.fx.renderTailSec — up to ~3s for DarkDelay) is kept
// AUDIBLE but out of the exposed duration: the delay/reverb keeps ringing after
// the last note, so we hold teardown (AudioContext close + STOP button) until
// `musical duration + tail` has elapsed, while clamping the displayed time to the
// musical end. The exported WAV (renderWav.ts) still renders the identical
// total + renderTailSec — so what you hear in-app and what you export match.

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  createFxBus,
  scheduleArrangement,
  calculateArrangementDuration,
} from '../audio/scheduleArrangement';
import { deriveTimbre, renderMetaFromArrangement } from '../audio/timbre';

export function useAudioPlayback(initialArrangement?: any) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  // Audible FX tail beyond the musical end — kept out of the exposed `duration`
  // so the section HUD math stays correct, but honored before teardown.
  const tailRef = useRef<number>(0);

  // Update duration when the arrangement changes. bpm is read off the
  // arrangement metadata (self-contained), not passed in. This is the MUSICAL
  // duration (scheduled notes only) — the UI/HUD keys off it, so the FX tail
  // stays out.
  useEffect(() => {
    if (initialArrangement) {
      const { bpm } = renderMetaFromArrangement(initialArrangement);
      const dur = calculateArrangementDuration(initialArrangement, bpm);
      setDuration(dur);
      durationRef.current = dur;
    }
  }, [initialArrangement]);

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
    // End playback only after the audible FX tail has rung out, but never let the
    // displayed time run past the musical end (keeps the progress bar pinned at
    // 100% and the section HUD out of a phantom OUTRO while the tail rings).
    if (elapsed >= durationRef.current + tailRef.current) {
      setCurrentTime(durationRef.current);
      setIsPlaying(false);
      // Natural completion still owns an open AudioContext (an OS audio
      // resource) — close it here exactly like stop() does, or it leaks until
      // the next play/stop/unmount.
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      return;
    }

    setCurrentTime(Math.min(elapsed, durationRef.current));
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
    tailRef.current = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const play = useCallback((arrangement: unknown) => {
    // Stop any existing playback first
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Self-contained: derive the theme's sound + bpm from the arrangement, then
    // the full TimbreParams the synth consumes — identical to the WAV export.
    const { sound, bpm } = renderMetaFromArrangement(arrangement);
    const timbre = deriveTimbre(sound, bpm);

    // Exposed duration is MUSICAL only (scheduled notes) — the progress bar and
    // section HUD key off it. The FX tail is tracked separately so STOP stays
    // visible (and the context stays open) while the delay/reverb rings out,
    // without shifting the HUD's section boundaries.
    const songDurationSec = calculateArrangementDuration(arrangement, bpm);

    durationRef.current = songDurationSec;
    tailRef.current = timbre.fx.renderTailSec;
    setDuration(songDurationSec);

    // Create a fresh AudioContext
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Build a fresh themed master FX bus wired to this context's destination,
    // then schedule all notes directly — song structure (Intro/Build/Drop/Outro)
    // is already baked into the arrangement by the Rust arranger.
    const bus = createFxBus(ctx, ctx.destination, timbre);
    const startTime = ctx.currentTime + 0.05;
    playStartRef.current = startTime;

    scheduleArrangement(ctx, bus, arrangement, startTime, timbre);

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
