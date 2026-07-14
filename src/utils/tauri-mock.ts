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

// Generate mock event data that matches the Rust EventData struct
function generateMockEvents(audioBytes: number[]): any[] {
  const events = [];
  const classes = ['BilabialPlosive', 'HihatNoise', 'Click', 'HumVoiced'];

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
    const timestamp = i * interval + (Math.random() * 20 - 10);
    const classIdx = i % classes.length;
    events.push({
      id: `mock-event-${i}`,
      timestamp_ms: Math.max(0, timestamp),
      duration_ms: 50 + Math.random() * 30,
      class: classes[classIdx],
      confidence: 0.7 + Math.random() * 0.25,
      features: {
        spectral_centroid: classIdx === 0 ? 400 : classIdx === 1 ? 4200 : classIdx === 2 ? 1800 : 600,
        zcr: classIdx === 0 ? 0.08 : classIdx === 1 ? 0.45 : classIdx === 2 ? 0.3 : 0.05,
        low_band_energy: classIdx === 0 ? 0.6 : classIdx === 1 ? 0.05 : classIdx === 2 ? 0.2 : 0.3,
        mid_band_energy: classIdx === 0 ? 0.3 : classIdx === 1 ? 0.25 : classIdx === 2 ? 0.6 : 0.45,
        high_band_energy: classIdx === 0 ? 0.1 : classIdx === 1 ? 0.7 : classIdx === 2 ? 0.2 : 0.25,
        peak_amplitude: 0.5 + Math.random() * 0.4,
      },
    });
  }

  return events;
}

// Build the mock Arrangement from quantized events (mirrors Rust arranger + expand_to_song)
function buildMockArrangement(args: Record<string, any>): unknown {
  const quantizedEvents = args?.input?.events || [];
  const bpm = args?.input?.bpm || 120;
  const barCount = args?.input?.bar_count || 4;
  const phaseOffsetMs = args?.input?.phase_offset_ms ?? 0;
  // Placement fidelity (spec §4.3, serde default 0.8 in ArrangeEventsInput). The
  // mock has never template-gated — it pushes every detected event into its lane —
  // so it already matches the Rust arranger's "never delete" contract at fidelity
  // 1.0. Off-template slot-snapping (fidelity < 1.0) is a real-backend nicety not
  // reproduced here; the browser demo simply plays events where they land.
  const _fidelity = args?.input?.fidelity ?? 0.8;
  void _fidelity;
  const totalDurationMs = (barCount * 4 * 60000) / bpm;
  const template = args?.input?.template || 'synthwave_straight';

  // Sort events into drum lanes by class
  const kickEvents: any[] = [];
  const snareEvents: any[] = [];
  const hihatEvents: any[] = [];
  const bassEvents: any[] = [];
  const padEvents: any[] = [];
  const arpEvents: any[] = [];

  const msPerBeat = 60000 / bpm;
  const msPerBar = msPerBeat * 4;

  // Mock harmonic progression: Dm -> Bb -> F -> C
  const chords = [
    { root: 50, third: 53, fifth: 57 }, // Dm (D3, F3, A3)
    { root: 58, third: 62, fifth: 65 }, // Bb (Bb3, D4, F4)
    { root: 53, third: 57, fifth: 60 }, // F (F3, A3, C4)
    { root: 60, third: 64, fifth: 67 }, // C (C4, E4, G4)
  ];

  let arpCounter = 0;

  for (const qe of quantizedEvents) {
    const event = qe.event || qe.original_event || qe;
    const cls = (event.class || '').toLowerCase();
    const timestamp = qe.quantized_timestamp_ms ?? event.timestamp_ms ?? 0;

    const note = {
      timestamp_ms: timestamp,
      duration_ms: event.duration_ms || 100,
      velocity: Math.floor((event.confidence || 0.8) * 127),
      source_event_id: event.id || null,
    };

    // Determine active chord (2 bars per chord), anchored to the grid phase so
    // chord boundaries respect the performer's downbeat (mirrors get_chord_at_time).
    const bar = Math.floor(Math.max(0, timestamp - phaseOffsetMs) / msPerBar);
    const chordIndex = Math.floor((bar % 8) / 2);
    const currentChord = chords[chordIndex];

    if (cls.includes('bilabial')) {
      kickEvents.push(note);

      // Bass pattern: Root on downbeats, Fifth on upbeats/offbeats
      const beatInBar = Math.floor((timestamp % msPerBar) / msPerBeat);
      const isOffbeat = beatInBar % 2 !== 0;
      const bassMidi = isOffbeat ? currentChord.fifth - 12 : currentChord.root - 12;

      bassEvents.push({ ...note, duration_ms: 200, midi_note: bassMidi });
    }
    else if (cls.includes('hihat')) {
      hihatEvents.push(note);

      // Rhythmic Puppeteering for Arps
      if (template === 'arp_drive') {
        const arpPattern = [currentChord.root + 12, currentChord.third + 12, currentChord.fifth + 12, currentChord.root + 24];
        const arpMidi = arpPattern[arpCounter % arpPattern.length];
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
  // Values mirror src-tauri/src/themes/{blade_runner,stranger_things}.rs exactly.
  list_themes: () => [
    { name: 'BLADE RUNNER', description: 'Vangelis-inspired pads, brass stabs, gated reverb. Melancholic and atmospheric.', bpm_range: [80, 100], root_note: 62, scale_family: 'NaturalMinor' },
    { name: 'STRANGER THINGS', description: 'Synthwave horror with arpeggios, pulsing bass, and dark delay. Retro and unsettling.', bpm_range: [100, 120], root_note: 60, scale_family: 'NaturalMinor' },
  ],

  get_theme: (a) => {
    requireKeys(a, ['name']);
    const name = (a.name || 'BLADE RUNNER').toUpperCase();
    if (name === 'STRANGER THINGS') {
      return {
        name: 'STRANGER THINGS', bpm_range: [100, 120], root_note: 60, scale_family: 'NaturalMinor',
        chord_progression: { chords: ['Im', 'VII', 'VI', 'VII'], bars_per_chord: 2 },
        bass_pattern: 'OffbeatEighths', arp_pattern: 'Up158', arp_octave_range: [0, 2],
        drum_palette: 'SynthwaveDrums', fx_profile: 'DarkDelay', synth_stab_velocity: 90, pad_sustain: false,
      };
    }
    return {
      name: 'BLADE RUNNER', bpm_range: [80, 100], root_note: 62, scale_family: 'NaturalMinor',
      chord_progression: { chords: ['Im', 'VI', 'III', 'VII'], bars_per_chord: 2 },
      bass_pattern: 'RootFifth', arp_pattern: 'Up158', arp_octave_range: [-1, 1],
      drum_palette: 'SynthwaveDrums', fx_profile: 'GatedReverb', synth_stab_velocity: 100, pad_sustain: true,
    };
  },

  list_theme_names: () => ['BLADE RUNNER', 'STRANGER THINGS'],

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
