/**
 * Tauri API Mock for Browser Development
 *
 * Provides mock implementations of Tauri commands for browser-only mode.
 * In browser/demo builds, `vite.config.ts` aliases `@tauri-apps/api/core` to this
 * file, so this module's `invoke`/`Channel`/`Resource` stand in for the real ones.
 *
 * IMPORTANT — return convention:
 *   The generated `src/bindings.ts` calls the RAW `TAURI_INVOKE` (this `invoke`)
 *   and wraps its result: `{ status: "ok", data: await TAURI_INVOKE(...) }`.
 *   Therefore each handler here returns the BARE value (the `data` payload), NOT a
 *   `{status:"ok"}` object — the bindings layer adds that wrapper. A real backend
 *   error is a promise REJECTION, so handlers THROW to signal errors. Contract drift
 *   (missing camelCase arg key, or an unknown command) also throws, exactly like the
 *   real `TAURI_INVOKE` would reject — this is what surfaces snake_case/camelCase bugs.
 */

import type {
  Theme,
  ThemeSummary,
  ChordType,
  ScaleFamily,
  BassPattern,
  ArpPattern,
} from '../bindings';

// Type-only import (erased at runtime, so no circular dependency with the
// generated bindings that resolve `invoke` through this very module).

// Stub classes required by @tauri-apps/plugin-fs when aliased through this mock
export class Resource {
  readonly rid: number;
  constructor() { this.rid = 0; }
  close(): Promise<void> { return Promise.resolve(); }
}

export class Channel<T = unknown> {
  private callback: ((response: T) => void) | null = null;
  id = 0;
  set onmessage(fn: (response: T) => void) { this.callback = fn; }
  get onmessage() { return this.callback as (response: T) => void; }
  toJSON(): string { return `channel:${this.id}`; }
}

// In-memory store for demo audio data so loadAudioData can retrieve it
let lastProjectAudioData: Uint8Array | null = null;

/** Retrieve mock audio data stored by the last create_project call */
export const getMockAudioData = (): Uint8Array | null => lastProjectAudioData;

export const isTauriAvailable = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * Deterministic PRNG (mulberry32). The fabricated-events generator is seeded
 * with a fixed constant so browser demo arrangements are identical run-to-run
 * (a moving arrangement would make the Pages demo flaky and un-screenshotable).
 * `get_recording_level`'s Math.random stays live — it's cosmetic UI only.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate mock event data that matches the Rust EventData struct
function generateMockEvents(audioBytes: number[]): any[] {
  const events = [];
  const classes = ['BilabialPlosive', 'HihatNoise', 'Click', 'HumVoiced'];
  const rand = mulberry32(0xbea717ce);

  // Simple peak detection on audio to create realistic-looking events
  const sampleRate = 44100;
  const bytesPerSample = 2;
  const headerSize = 44;
  const numSamples = Math.floor((audioBytes.length - headerSize) / bytesPerSample);
  const durationMs = (numSamples / sampleRate) * 1000;

  // Place events at regular intervals with some variety
  const numEvents = Math.max(4, Math.floor(durationMs / 300));
  const interval = durationMs / numEvents;

  for (let i = 0; i < numEvents; i++) {
    const timestamp = i * interval + (rand() * 20 - 10);
    const classIdx = i % classes.length;
    const winnerClass = classes[classIdx];
    const confidence = 0.7 + rand() * 0.25;

    // Plausible per-class scores: the classified winner gets `confidence`, the
    // rest get lower decaying scores. Mirrors the Rust `ClassScore[]` shape so
    // the DecisionCard bars + runner-up reasoning render in browser demo mode.
    const others = classes.filter((c) => c !== winnerClass);
    const all_scores = [
      { class: winnerClass, score: confidence },
      { class: others[0], score: Math.max(0.05, confidence - 0.18) },
      { class: others[1], score: Math.max(0.03, confidence - 0.4) },
      { class: others[2], score: Math.max(0.02, confidence - 0.55) },
    ];

    events.push({
      id: `mock-event-${i}`,
      timestamp_ms: Math.max(0, timestamp),
      duration_ms: 50 + rand() * 30,
      class: winnerClass,
      confidence,
      features: {
        spectral_centroid: classIdx === 0 ? 400 : classIdx === 1 ? 4200 : classIdx === 2 ? 1800 : 600,
        zcr: classIdx === 0 ? 0.08 : classIdx === 1 ? 0.45 : classIdx === 2 ? 0.3 : 0.05,
        low_band_energy: classIdx === 0 ? 0.6 : classIdx === 1 ? 0.05 : classIdx === 2 ? 0.2 : 0.3,
        mid_band_energy: classIdx === 0 ? 0.3 : classIdx === 1 ? 0.25 : classIdx === 2 ? 0.6 : 0.45,
        high_band_energy: classIdx === 0 ? 0.1 : classIdx === 1 ? 0.7 : classIdx === 2 ? 0.2 : 0.25,
        peak_amplitude: 0.5 + rand() * 0.4,
      },
      all_scores,
    });
  }

  return events;
}

// ── Theme registry (single source of truth for the browser mock) ─────────────
//
// Full `Theme` objects, typed `satisfies Theme[]` against the generated binding
// so any drift from the Rust source of truth (themes/*.rs) fails `tsc`. Every
// mock theme accessor (get_theme/list_themes/list_theme_names) and all harmony
// derivation reads from here — adding a theme is a one-entry append (theme #3
// needs NO mock harmony edits).
const MOCK_THEMES = [
  {
    name: 'BLADE RUNNER',
    bpm_range: [80, 100],
    root_note: 62, // D
    scale_family: 'NaturalMinor',
    chord_progression: { chords: ['Im', 'VI', 'III', 'VII'], bars_per_chord: 2 },
    bass_pattern: 'RootFifth',
    arp_pattern: 'Up158',
    arp_octave_range: [-1, 1],
    default_template: 'synthwave_halftime',
    sound: { drum_palette: 'SynthwaveDrums', fx_profile: 'GatedReverb', pad_sustain: true },
    bass_stab_max_velocity: 100,
  },
  {
    name: 'STRANGER THINGS',
    bpm_range: [100, 120],
    root_note: 60, // C
    scale_family: 'NaturalMinor',
    chord_progression: { chords: ['Im', 'VII', 'VI', 'VII'], bars_per_chord: 2 },
    bass_pattern: 'OffbeatEighths',
    arp_pattern: 'Up158',
    arp_octave_range: [0, 2],
    default_template: 'arp_drive',
    sound: { drum_palette: 'TR808', fx_profile: 'DarkDelay', pad_sustain: false },
    bass_stab_max_velocity: 90,
  },
] satisfies Theme[];

// Descriptions copied verbatim from the Rust THEME_REGISTRY (themes/mod.rs). Kept
// beside the themes (ThemeSummary carries them) rather than on Theme itself.
// Keyed by the MOCK_THEMES names so a future theme added without a description
// fails tsc instead of silently rendering an empty string.
const THEME_DESCRIPTIONS: Record<(typeof MOCK_THEMES)[number]['name'], string> = {
  'BLADE RUNNER':
    'D minor, i–VI–III–VII (Dm–Bb–F–C). Root-fifth bass, halftime groove. Layered synthwave kit, gated reverb, long sustained pads.',
  'STRANGER THINGS':
    'C minor, i–VII–VI–VII (Cm–Bb–Ab–Bb). Driving offbeat bass, arp-led groove. TR808-style kit, dark filtered delay, short rhythmic pads.',
};

/** Resolve a theme by name (case-insensitive), BLADE RUNNER fallback like Rust. */
function resolveMockTheme(themeName?: string): Theme {
  const target = (themeName || 'BLADE RUNNER').toUpperCase();
  return MOCK_THEMES.find((t) => t.name.toUpperCase() === target) ?? MOCK_THEMES[0];
}

// Scale intervals by family — mirrors themes/types.rs `scale_notes`. All five
// families present so a theme #3 in any mode derives correct harmony unchanged.
const SCALE_INTERVALS: Record<ScaleFamily, number[]> = {
  MinorPentatonic: [0, 3, 5, 7, 10],
  NaturalMinor: [0, 2, 3, 5, 7, 8, 10],
  HarmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
};

// Chord degree (0-indexed scale degree) per chord type — mirrors `chord_notes`.
const CHORD_DEGREE: Record<ChordType, number> = {
  I: 0, Im: 0, II: 1, IIm: 1, III: 2, IIIm: 2, IV: 3, IVm: 3,
  V: 4, Vm: 4, VI: 5, VIm: 5, VII: 6, VIIm: 6,
};

interface Chord { root: number; third: number; fifth: number }

// Derive the chord voicings for a theme from its own root_note / scale_family /
// chord_progression (mirrors themes/types.rs scale_notes + chord_notes), voiced
// one octave below the theme root (the -12 the pad register has always used) so
// BLADE RUNNER stays byte-identical to the previous hardcoded Dm–Bb–F–C.
function themeChords(theme: Theme): Chord[] {
  const scale = SCALE_INTERVALS[theme.scale_family].map((i) => theme.root_note + i);
  return theme.chord_progression.chords.map((chord) => {
    const degree = CHORD_DEGREE[chord] ?? 0;
    const chordRoot = scale[degree] ?? theme.root_note;
    const thirdOffset = chord.endsWith('m') ? 3 : 4; // minor vs major triad
    return { root: chordRoot - 12, third: chordRoot + thirdOffset - 12, fifth: chordRoot + 7 - 12 };
  });
}

// Bass note selection per pattern — mirrors themes/types.rs `bass_notes`
// (chord.root === chordRoot-12; fifth === root+7; seventh === root+10). Indexed
// by the mock's simplified per-beat slot. RootFifth reproduces the previous
// hardcoded root/fifth alternation exactly, so BLADE RUNNER bass is unchanged.
const BASS_PATTERN_NOTES: Record<BassPattern, (chord: Chord, slot: number) => number> = {
  Root: (c) => c.root,
  RootFifth: (c, slot) => (slot % 2 === 0 ? c.root : c.root + 7),
  OffbeatEighths: (c) => c.root,
  Walking: (c, slot) => [c.root, c.root + 3, c.root + 7, c.root + 10][slot % 4],
};

// Arpeggio sequence per pattern — mirrors themes/types.rs `arp_notes`: expand the
// chord across the octave range, then order by pattern. The chord tones are
// lifted back to the theme-root register (+12 undoes the pad-register voicing).
const ARP_PATTERN_ORDER: Record<ArpPattern, (notes: number[]) => number[]> = {
  Up158: (notes) => notes,
  Down851: (notes) => [...notes].reverse(),
  Alternating: (notes) => {
    const out: number[] = [];
    const len = notes.length;
    for (let i = 0; i < len; i++) out.push(i % 2 === 0 ? notes[i] : notes[len - 1 - i]);
    return out;
  },
  Random: (notes) => notes, // deterministic mock: sorted, like the Rust stub
};

function arpSequence(chord: Chord, pattern: ArpPattern, [lo, hi]: [number, number]): number[] {
  const triad = [chord.root + 12, chord.third + 12, chord.fifth + 12]; // theme-root register
  const notes: number[] = [];
  for (let oct = lo; oct <= hi; oct++) {
    for (const n of triad) {
      const shifted = n + oct * 12;
      if (shifted >= 0 && shifted < 128) notes.push(shifted);
    }
  }
  return ARP_PATTERN_ORDER[pattern](notes);
}

// Build the mock Arrangement from quantized events (mirrors Rust arranger + expand_to_song)
function buildMockArrangement(args: Record<string, any>): unknown {
  const quantizedEvents = args?.input?.events || [];
  const bpm = args?.input?.bpm || 120;
  const barCount = args?.input?.bar_count || 4;
  const phaseOffsetMs = args?.input?.phase_offset_ms ?? 0;
  // Placement fidelity (spec §4.3, serde default 0.8 in ArrangeEventsInput). The
  // mock has never template-gated — it pushes every detected event into its lane —
  // so it already matches the Rust arranger's "never delete" contract. To make the
  // slider audibly/visibly meaningful in the browser demo we reproduce the real
  // backend's placement behaviour: fidelity 1.0 ("FOLLOW ME") plays every hit at its
  // quantized position; lower fidelity ("PRODUCE FOR ME") pulls each hit toward the
  // nearest template slot (a beat), clamped to [0.0, 1.0]. Event count never changes.
  const fidelity = Math.min(1, Math.max(0, args?.input?.fidelity ?? 0.8));
  const bEmphasis = args?.input?.b_emphasis ?? 0.6;
  const totalDurationMs = (barCount * 4 * 60000) / bpm;
  const template = args?.input?.template || 'synthwave_straight';

  // Resolve the theme through the mock registry (BLADE RUNNER fallback like Rust)
  // so every note-selection decision derives from the theme's own patterns.
  const theme = resolveMockTheme(args?.input?.theme_name);

  // Sort events into drum lanes by class
  const kickEvents: any[] = [];
  const snareEvents: any[] = [];
  const hihatEvents: any[] = [];
  const bassEvents: any[] = [];
  const padEvents: any[] = [];
  const arpEvents: any[] = [];

  const msPerBeat = 60000 / bpm;
  const msPerBar = msPerBeat * 4;

  // Harmonic progression derived from the selected theme, mirroring the Rust
  // arranger (themes/types.rs scale_notes + chord_notes) so switching theme in
  // the browser demo actually changes the notes — not just the label. Chords
  // are voiced one octave below the theme root (the -12 the pad register has
  // always used), so BLADE RUNNER stays byte-identical to the previous
  // hardcoded Dm–Bb–F–C.
  const chords = themeChords(theme);

  let arpCounter = 0;

  for (const qe of quantizedEvents) {
    const event = qe.event || qe.original_event || qe;
    const cls = (event.class || '').toLowerCase();
    const quantizedTs = qe.quantized_timestamp_ms ?? event.timestamp_ms ?? 0;
    // Nearest template slot = nearest beat (the coarse "producer" grid). Blend the
    // performer's quantized position toward it by (1 - fidelity): fidelity 1.0 keeps
    // the hit verbatim, fidelity 0.0 snaps it fully onto the template beat.
    const templateSlot = Math.round(quantizedTs / msPerBeat) * msPerBeat;
    const timestamp = quantizedTs * fidelity + templateSlot * (1 - fidelity);

    const note = {
      timestamp_ms: timestamp,
      duration_ms: event.duration_ms || 100,
      velocity: Math.floor((event.confidence || 0.8) * 127),
      source_event_id: event.id || null,
    };

    // Determine active chord, anchored to the grid phase so chord boundaries respect
    // the performer's downbeat (mirrors get_chord_at_time). Derived from the theme's
    // own progression (bars_per_chord × chord count) rather than a hardcoded 4×2, so a
    // theme #3 with a different-length progression works with no mock edits. No audible
    // change for the two shipped themes — both are 4 chords × 2 bars.
    const bar = Math.floor(Math.max(0, timestamp - phaseOffsetMs) / msPerBar);
    const barsPerChord = theme.chord_progression.bars_per_chord;
    const cycleBars = barsPerChord * chords.length;
    const chordIndex = Math.floor((bar % cycleBars) / barsPerChord);
    const currentChord = chords[chordIndex];

    if (cls.includes('bilabial')) {
      kickEvents.push(note);

      // Bass note SELECTION is pattern-driven (mirrors themes/types.rs bass_notes).
      // Gate + velocity mirror the Rust arranger exactly:
      //   fire only when b_emphasis > 0.3; velocity =
      //   round(source/127 * clamp(b_emphasis,0,1) * bass_stab_max_velocity).
      // Voicing chain: `themeChords()` already voices every chord −12 below the
      // natural root, so `currentChord.root` is the pre-voiced register. The bass
      // pattern note is therefore taken AT that register (no extra −12), matching
      // Rust which computes the pattern at the NATURAL register then subtracts 12
      // (drum_lanes.rs ~line 412). For BLADE RUNNER: D1→D2 (MIDI 38→50).
      if (bEmphasis > 0.3) {
        const beatInBar = Math.floor((timestamp % msPerBar) / msPerBeat);
        const bassMidi = BASS_PATTERN_NOTES[theme.bass_pattern](currentChord, beatInBar);
        const bassVelocity = Math.min(
          127,
          Math.max(1, Math.round((note.velocity / 127) * Math.min(1, Math.max(0, bEmphasis)) * theme.bass_stab_max_velocity)),
        );
        bassEvents.push({ ...note, duration_ms: 200, velocity: bassVelocity, midi_note: bassMidi });
      }
    }
    else if (cls.includes('hihat')) {
      hihatEvents.push(note);

      // Rhythmic Puppeteering for Arps — sequence derived from the theme's arp
      // pattern + octave range (mirrors themes/types.rs arp_notes).
      if (template === 'arp_drive') {
        const arpSeq = arpSequence(currentChord, theme.arp_pattern, theme.arp_octave_range);
        const arpMidi = arpSeq[arpCounter % arpSeq.length];
        arpEvents.push({ ...note, duration_ms: 150, velocity: note.velocity * 0.9, midi_note: arpMidi });
        arpCounter++;
      }
    }
    else if (cls.includes('click')) {
      snareEvents.push(note);
    }
    else {
      // Hum -> Pads (Triad)
      const padDuration = Math.max(400, event.duration_ms || 400);
      padEvents.push({ ...note, duration_ms: padDuration, velocity: note.velocity * 0.8, midi_note: currentChord.root });
      padEvents.push({ ...note, duration_ms: padDuration, velocity: note.velocity * 0.8, midi_note: currentChord.third });
      padEvents.push({ ...note, duration_ms: padDuration, velocity: note.velocity * 0.8, midi_note: currentChord.fifth });
    }
  }

  // Expand base pattern into song (Intro/Build/Drop/Outro) — mirrors Rust expand_to_song()
  const baseDurationMs = totalDurationMs;
  const cloneToSection = (events: any[], section: number, fade: boolean) =>
    events.map(e => {
      const cloned = { ...e, timestamp_ms: e.timestamp_ms + section * baseDurationMs };
      if (fade) {
        const progress = e.timestamp_ms / baseDurationMs;
        cloned.velocity = Math.max(1, Math.floor(e.velocity * Math.max(0.2, 1.0 - progress)));
      }
      return cloned;
    });

  const isKick = (n: string) => n.toUpperCase().includes('KICK');
  const isHihat = (n: string) => { const u = n.toUpperCase(); return u.includes('HIHAT') || u.includes('HAT'); };
  const isSnare = (n: string) => { const u = n.toUpperCase(); return u.includes('SNARE') || u.includes('CLAP'); };

  const expandDrum = (name: string, events: any[]) => {
    const expanded: any[] = [];
    for (let s = 0; s < 4; s++) {
      const include = s === 0 ? (isKick(name) || isHihat(name))
        : s === 1 ? (isKick(name) || isHihat(name) || isSnare(name))
        : s === 2 ? true : false;
      if (include) expanded.push(...cloneToSection(events, s, false));
    }
    return expanded;
  };

  const expandBass = (events: any[]) => {
    const expanded: any[] = [];
    for (let s = 1; s < 4; s++) expanded.push(...cloneToSection(events, s, s === 3));
    return expanded;
  };

  const expandDropOnly = (events: any[]) => cloneToSection(events, 2, false);

  return {
    drum_lanes: [
      { name: 'DRUMS_KICK', midi_note: 36, events: expandDrum('DRUMS_KICK', kickEvents) },
      { name: 'DRUMS_SNARE', midi_note: 38, events: expandDrum('DRUMS_SNARE', snareEvents) },
      { name: 'DRUMS_HIHAT', midi_note: 42, events: expandDrum('DRUMS_HIHAT', hihatEvents) },
    ],
    bass_lane: { name: 'BASS', midi_note: 36, events: expandBass(bassEvents) },
    pad_lane: { name: 'PADS', midi_note: 48, events: expandDropOnly(padEvents) },
    arp_lane: { name: 'ARP', midi_note: 60, events: expandDropOnly(arpEvents) },
    template,
    total_duration_ms: baseDurationMs * 4,
    bar_count: barCount * 4,
    // Self-contained theme metadata (mirrors Rust Arrangement): canonical resolved
    // name, exact bpm, render-time sound snapshot — no side-channel theme lookup.
    theme_name: theme.name,
    bpm,
    sound: theme.sound,
  };
}

/**
 * Assert that every required (camelCase) arg key is present, throwing on drift.
 * The generated bindings camelCase multi-word arg keys (`projectId`, `runId`, …),
 * so this both documents and enforces the contract that hid the earlier snake_case bugs.
 */
function requireKeys(args: Record<string, unknown>, keys: string[]): void {
  for (const k of keys) {
    if (!(k in args)) {
      throw new Error(`[Tauri Mock] '${k}' missing — frontend/backend contract drift`);
    }
  }
}

type Handler = (args: Record<string, any>) => unknown;

/**
 * Command registry. Each handler returns the BARE success value (bindings adds the
 * `{status:"ok"}` wrapper) or throws to simulate a backend rejection. Keys checked by
 * `requireKeys` are the camelCase invoke-payload keys emitted by the generated bindings.
 */
const HANDLERS: Record<string, Handler> = {
  greet: (a) => { requireKeys(a, ['name']); return `Hello ${a.name}!`; },

  // --- Project commands (match Rust Project struct) ---
  list_projects: () => [],

  get_project: (a) => {
    requireKeys(a, ['id']);
    return {
      id: a.id || 'mock-1',
      name: 'Sample Project',
      created_at: new Date().toISOString(),
      input_path: 'mock://audio.wav',
      input_sha256: 'mock-sha256-hash',
      duration_ms: 5000,
    };
  },

  create_project: (a) => {
    requireKeys(a, ['input']);
    // Store audio data so loadAudioData can retrieve it via plugin-fs mock
    if (a.input?.input_data) {
      lastProjectAudioData = new Uint8Array(a.input.input_data);
    }
    return {
      id: `mock-${Date.now()}`,
      name: a.input?.name || 'New Project',
      created_at: new Date().toISOString(),
      input_path: 'mock://audio.wav',
      input_sha256: 'mock-sha256',
      duration_ms: lastProjectAudioData ? Math.floor((lastProjectAudioData.length - 44) / (44100 * 2) * 1000) : 2000,
    };
  },

  // --- Run commands (match Rust Run struct) ---
  create_run: (a) => {
    requireKeys(a, ['input']);
    return {
      id: `mock-run-${Date.now()}`,
      project_id: a.input?.project_id || 'mock-1',
      created_at: new Date().toISOString(),
      pipeline_version: a.input?.pipeline_version || '0.1.0',
      theme: a.input?.theme || 'default',
      bpm: a.input?.bpm || 120,
      swing: a.input?.swing || 0,
      quantize_strength: a.input?.quantize_strength || 0.8,
      b_emphasis: a.input?.b_emphasis || 0.6,
      phase_offset_ms: a.input?.phase_offset_ms ?? 0,
      status: 'pending',
    };
  },

  get_run: (a) => { requireKeys(a, ['id']); return null; },

  list_runs_for_project: (a) => { requireKeys(a, ['projectId']); return []; },

  get_run_with_artifacts: (a) => { requireKeys(a, ['runId']); return null; },

  update_run_status: (a) => { requireKeys(a, ['input']); return null; },

  create_artifact: (a) => {
    requireKeys(a, ['input']);
    return {
      id: `mock-artifact-${Date.now()}`,
      run_id: a.input?.run_id || 'mock-run-1',
      kind: a.input?.kind || 'midi',
      path: 'mock://artifact',
      sha256: 'mock-sha256',
      bytes: Array.isArray(a.input?.data) ? a.input.data.length : 0,
    };
  },

  // --- Event detection (match Rust EventDetectionResult) ---
  detect_events: (a) => {
    requireKeys(a, ['input']);
    // Mirror the Rust contract: the flag without an id is an error. The mock
    // has no profile store, so a present id simply passes through (the mock's
    // events are fabricated either way).
    if (a.input?.use_calibration && !a.input?.calibration_profile_id) {
      // Reject like real Tauri: a serialized CommandError value (NOT an Error
      // instance), so the generated binding maps it to {status:"error"} rather
      // than rethrowing.
      throw { message: 'Calibration profile ID required when use_calibration is true' };
    }
    // In mock mode, generate events from stored audio data (saved by create_project)
    const storedData = lastProjectAudioData ? Array.from(lastProjectAudioData) : [];
    const events = generateMockEvents(storedData);
    return { events, total_count: events.length };
  },

  detect_onsets: (a) => {
    requireKeys(a, ['input']);
    return { onsets: [{ timestamp_ms: 500, strength: 0.8 }], total_count: 1 };
  },

  extract_features: (a) => {
    requireKeys(a, ['input']);
    return {
      spectral_centroid: 1200,
      zcr: 0.2,
      low_band_energy: 0.3,
      mid_band_energy: 0.4,
      high_band_energy: 0.3,
      peak_amplitude: 0.7,
      crest_factor: 3.5,
    };
  },

  // --- Groove engine (match Rust types) ---
  estimate_tempo: (a) => {
    requireKeys(a, ['input']);
    return { bpm: 120.0, confidence: 0.85, beat_positions_ms: [], phase_offset_ms: 0.0 };
  },

  quantize_events_command: (a) => {
    requireKeys(a, ['input']);
    // Return QuantizedEvent[] matching the Rust struct
    const inputEvents = a.input?.events || [];
    const bpm = a.input?.bpm || 120;
    const beatMs = 60000 / bpm;
    const divisionMs = beatMs / 4; // sixteenth note
    // Anchor the grid to the estimated beat phase (Grid::with_phase). Mirrors the
    // Rust caller sweep so mock quantization lines up with the real backend.
    const phaseOffsetMs = a.input?.phase_offset_ms ?? 0;

    return inputEvents.map((event: any) => {
      const relative = event.timestamp_ms - phaseOffsetMs;
      const nearestGrid = phaseOffsetMs + Math.max(0, Math.round(relative / divisionMs)) * divisionMs;
      return {
        original_event: event,
        original_timestamp_ms: event.timestamp_ms,
        quantized_timestamp_ms: nearestGrid,
        snap_delta_ms: nearestGrid - event.timestamp_ms,
        grid_position: { bar: 0, beat: 0, subdivision: 0 },
        // Legacy convenience fields consumed by the mock arranger:
        event_id: event.id,
        event,
      };
    });
  },

  // --- Arranger (match Rust Arrangement struct) ---
  arrange_events_command: (a) => {
    requireKeys(a, ['input']);
    return buildMockArrangement(a);
  },

  // --- MIDI export ---
  export_midi_command: (a) => {
    requireKeys(a, ['input']);
    console.log('[Tauri Mock] MIDI export (simulated)');
    return new Array(100).fill(0);
  },

  // --- Themes (match Rust ThemeSummary / Theme structs) ---
  // All derive from the single MOCK_THEMES registry (mirrors themes/mod.rs).
  list_themes: (): ThemeSummary[] =>
    MOCK_THEMES.map((t) => ({
      name: t.name,
      description: THEME_DESCRIPTIONS[t.name],
      bpm_range: t.bpm_range,
      root_note: t.root_note,
      scale_family: t.scale_family,
      default_template: t.default_template,
    })),

  // get_theme mirrors the Rust command: an exact/case-insensitive miss returns
  // null (the command is `Option<Theme>`), NOT a fallback — the fallback lives in
  // arrange_events_command. resolveMockTheme (BR fallback) is for arrangement only.
  get_theme: (a): Theme | null => {
    requireKeys(a, ['name']);
    const target = (a.name || '').toUpperCase();
    return MOCK_THEMES.find((t) => t.name.toUpperCase() === target) ?? null;
  },

  list_theme_names: (): string[] => MOCK_THEMES.map((t) => t.name),

  // --- Calibration ---
  list_calibration_profiles: () => [],

  get_calibration_profile: (a) => { requireKeys(a, ['id']); return null; },

  create_calibration_profile: (a) => {
    requireKeys(a, ['input']);
    return { id: 'mock-cal-1', name: a.input?.name || 'Default', created_at: new Date().toISOString(), profile_json_path: 'mock://profile.json', notes: a.input?.notes ?? null };
  },

  update_calibration_profile: (a) => { requireKeys(a, ['input']); return null; },

  delete_calibration_profile: (a) => { requireKeys(a, ['id']); return null; },

  // --- Recording ---
  start_recording: () => null,

  stop_recording: () => new Array(44100 * 2).fill(0),

  is_recording: () => false,

  get_recording_level: () => Math.random() * 0.5,

  // --- Explainability ---
  save_event_decisions: (a) => { requireKeys(a, ['input']); return null; },

  get_event_decisions: (a) => { requireKeys(a, ['runId']); return []; },

  // --- Plugin-fs commands (called internally by @tauri-apps/plugin-fs) ---
  'plugin:fs|exists': (a) => {
    const fileExists = !!(a?.path?.startsWith?.('mock://') && lastProjectAudioData !== null);
    console.log('[Tauri Mock] plugin:fs|exists returning:', fileExists, 'path:', a?.path, 'hasData:', lastProjectAudioData !== null);
    return fileExists;
  },

  'plugin:fs|read_file': () => {
    console.log('[Tauri Mock] plugin:fs|read_file called, hasData:', lastProjectAudioData !== null, 'dataLen:', lastProjectAudioData?.length);
    if (lastProjectAudioData) {
      return lastProjectAudioData;
    }
    throw new Error('File not found in mock mode');
  },
};

export const invoke = async <T = any>(command: string, args: Record<string, any> = {}): Promise<T> => {
  console.warn(`[Tauri Mock] Command '${command}' called in browser mode.`, args);

  const handler = HANDLERS[command];
  if (!handler) {
    // Unknown command == contract drift; mirror TAURI_INVOKE rejection.
    console.error(`[Tauri Mock] Unknown command: ${command}`);
    throw new Error(`[Tauri Mock] Unknown command '${command}'`);
  }
  return handler(args) as T;
};

export interface TauriAPI {
  invoke: typeof invoke;
  core: {
    invoke: typeof invoke;
  };
}

export const mockTauriAPI: TauriAPI = {
  invoke,
  core: {
    invoke,
  },
};

export const getTauriAPI = (): TauriAPI => {
  if (isTauriAvailable()) {
    return (window as any).__TAURI__;
  }
  return mockTauriAPI;
};

export default {
  isTauriAvailable,
  invoke,
  getTauriAPI,
  mockTauriAPI,
};
