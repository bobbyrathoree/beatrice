// renderWav - Offline WAV export.
//
// Renders an Arrangement through an OfflineAudioContext using the SAME synthesis
// code the user hears live (scheduleArrangement), then encodes the result as a
// 16-bit stereo PCM WAV. This replaces the old Rust `render_preview` command,
// which rendered silence.

import { createFxBus, scheduleArrangement } from "./scheduleArrangement";
import { deriveTimbre, renderMetaFromArrangement } from "./timbre";
import type { Arrangement } from "../types/ipc";

/**
 * Render an arrangement to a 16-bit stereo PCM WAV file.
 *
 * Self-contained: the theme's sound + bpm are read off the arrangement metadata
 * (with legacy/fallback normalization) and turned into a full TimbreParams
 * snapshot — the same one live playback uses — so what the user exports matches
 * what they hear. The render length includes the derived FX/voice tail so the
 * reverb and delay ring out fully instead of being truncated.
 *
 * @param arrangement the arrangement to render (uses `total_duration_ms` + tail for length)
 * @param sampleRate  output sample rate in Hz (default 44100)
 * @returns the WAV file bytes (RIFF/WAVE)
 */
export async function renderArrangementToWav(
  arrangement: Arrangement,
  sampleRate = 44100,
): Promise<Uint8Array<ArrayBuffer>> {
  const { sound, bpm } = renderMetaFromArrangement(arrangement);
  const timbre = deriveTimbre(sound, bpm);
  const durationSec = arrangement.total_duration_ms / 1000 + timbre.fx.renderTailSec;
  const frames = Math.max(1, Math.ceil(durationSec * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  scheduleArrangement(ctx, createFxBus(ctx, ctx.destination, timbre), arrangement, 0, timbre);
  const buf = await ctx.startRendering();
  return encodeWav16(buf);
}

/** Encode an AudioBuffer as 16-bit stereo little-endian PCM WAV bytes. */
export function encodeWav16(buf: AudioBuffer): Uint8Array<ArrayBuffer> {
  const ch = [
    buf.getChannelData(0),
    buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0),
  ];
  const frames = buf.length;
  const out = new DataView(new ArrayBuffer(44 + frames * 4));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); out.setUint32(4, 36 + frames * 4, true); w(8, "WAVE");
  w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, frames * 4, true);
  for (let i = 0, o = 44; i < frames; i++, o += 4) {
    out.setInt16(o, Math.max(-1, Math.min(1, ch[0][i])) * 0x7fff, true);
    out.setInt16(o + 2, Math.max(-1, Math.min(1, ch[1][i])) * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
