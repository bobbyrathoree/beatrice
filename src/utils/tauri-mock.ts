/**
 * Tauri API Mock for Browser Development
 *
 * Provides mock implementations of Tauri commands for browser-only mode.
 * Mock return types match the actual Rust backend command signatures.
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

export const invoke = async <T = any>(command: string, args?: any): Promise<T> => {
  console.warn(`[Tauri Mock] Command '${command}' called in browser mode.`, args);

  switch (command) {
    case 'greet':
      return `Hello ${args?.name || 'World'}!` as T;

    // --- Project commands (match Rust Project struct) ---
    case 'list_projects':
      return [] as T;

    case 'get_project':
      return {
        id: args?.id || 'mock-1',
        name: 'Sample Project',
        created_at: new Date().toISOString(),
        input_path: 'mock://audio.wav',
        input_sha256: 'mock-sha256-hash',
        duration_ms: 5000,
      } as T;

    case 'create_project': {
      // Store audio data so loadAudioData can retrieve it via plugin-fs mock
      if (args?.input?.input_data) {
        lastProjectAudioData = new Uint8Array(args.input.input_data);
      }
      return {
        id: `mock-${Date.now()}`,
        name: args?.input?.name || 'New Project',
        created_at: new Date().toISOString(),
        input_path: 'mock://audio.wav',
        input_sha256: 'mock-sha256',
        duration_ms: lastProjectAudioData ? Math.floor((lastProjectAudioData.length - 44) / (44100 * 2) * 1000) : 2000,
      } as T;
    }

    // --- Run commands (match Rust Run struct) ---
    case 'create_run':
      return {
        id: `mock-run-${Date.now()}`,
        project_id: args?.input?.project_id || 'mock-1',
        created_at: new Date().toISOString(),
        pipeline_version: args?.input?.pipeline_version || '0.1.0',
        theme: args?.input?.theme || 'default',
        bpm: args?.input?.bpm || 120,
        swing: args?.input?.swing || 0,
        quantize_strength: args?.input?.quantize_strength || 0.8,
        b_emphasis: args?.input?.b_emphasis || 0.6,
        status: 'pending',
      } as T;

    case 'get_run':
      return null as T;

    case 'list_runs_for_project':
      return [] as T;

    case 'get_run_with_artifacts':
      return null as T;

    case 'update_run_status':
      return undefined as T;

    // --- Event detection (match Rust EventDetectionResult) ---
    case 'detect_events': {
      // In mock mode, generate events from stored audio data (saved by create_project)
      const storedData = lastProjectAudioData ? Array.from(lastProjectAudioData) : [];
      const events = generateMockEvents(storedData);
      return { events, total_count: events.length } as T;
    }

    case 'detect_onsets':
      return { onsets: [{ timestamp_ms: 500, strength: 0.8 }], total_count: 1 } as T;

    case 'extract_features':
      return {
        spectral_centroid: 1200,
        zcr: 0.2,
        low_band_energy: 0.3,
        mid_band_energy: 0.4,
        high_band_energy: 0.3,
        peak_amplitude: 0.7,
      } as T;

    // --- Groove engine (match Rust types) ---
    case 'estimate_tempo':
      return { bpm: 120.0, confidence: 0.85, beat_positions_ms: [] } as T;

    case 'quantize_events_command': {
      // Return QuantizedEvent[] matching the Rust struct
      const inputEvents = args?.input?.events || [];
      const bpm = args?.input?.bpm || 120;
      const beatMs = 60000 / bpm;
      const divisionMs = beatMs / 4; // sixteenth note

      return inputEvents.map((event: any) => {
        const nearestGrid = Math.round(event.timestamp_ms / divisionMs) * divisionMs;
        return {
          original_event: event,
          event_id: event.id,
          original_timestamp_ms: event.timestamp_ms,
          quantized_timestamp_ms: nearestGrid,
          snap_delta_ms: nearestGrid - event.timestamp_ms,
          event: event,
        };
      }) as T;
    }

    // --- Arranger (match Rust Arrangement struct) ---
    case 'arrange_events_command': {
      const quantizedEvents = args?.input?.events || [];
      const bpm = args?.input?.bpm || 120;
      const barCount = args?.input?.bar_count || 4;
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

        // Determine active chord (2 bars per chord)
        const bar = Math.floor(timestamp / msPerBar);
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
      } as T;
    }

    // --- Explainability ---
    case 'save_event_decisions':
      return undefined as T;

    case 'get_event_decisions':
      return [] as T;

    // --- MIDI export ---
    case 'export_midi_command':
      console.log('[Tauri Mock] MIDI export (simulated)');
      return new Array(100).fill(0) as T;

    // --- Themes (match Rust ThemeSummary / Theme structs) ---
    case 'list_themes':
      return [
        { name: 'BLADE RUNNER', description: 'Dark, moody synth theme', bpm_range: [80, 120], root_note: 60, scale_family: 'minor' },
        { name: 'STRANGER THINGS', description: 'Retro 80s synth theme', bpm_range: [100, 140], root_note: 64, scale_family: 'minor' },
      ] as T;

    case 'get_theme':
      return {
        name: args?.name || 'BLADE RUNNER', bpm_range: [80, 120], root_note: 60, scale_family: 'minor',
        chord_progression: { chords: ['Cm', 'Ab', 'Eb', 'Bb'], bars_per_chord: 2 },
        bass_pattern: 'octave_pulse', arp_pattern: 'up_down', arp_octave_range: [3, 5],
        drum_palette: 'electronic', fx_profile: 'gated_reverb', synth_stab_velocity: 100, pad_sustain: true,
      } as T;

    case 'list_theme_names':
      return ['BLADE RUNNER', 'STRANGER THINGS'] as T;

    // --- Calibration ---
    case 'list_calibration_profiles':
      return [] as T;

    case 'get_calibration_profile':
      return null as T;

    case 'create_calibration_profile':
      return { id: 'mock-cal-1', name: args?.input?.name || 'Default', created_at: new Date().toISOString(), profile_json_path: 'mock://profile.json' } as T;

    case 'update_calibration_profile':
    case 'delete_calibration_profile':
      return undefined as T;

    // --- Recording ---
    case 'start_recording':
      return undefined as T;

    case 'stop_recording':
      return new Array(44100 * 2).fill(0) as T;

    case 'is_recording':
      return false as T;

    case 'get_recording_level':
      return (Math.random() * 0.5) as T;

    // --- Render ---
    case 'render_preview':
      return new Array(44100 * 4).fill(0) as T;

    // --- Plugin-fs commands (called internally by @tauri-apps/plugin-fs) ---
    case 'plugin:fs|exists': {
      const fileExists = !!(args?.path?.startsWith?.('mock://') && lastProjectAudioData !== null);
      console.log('[Tauri Mock] plugin:fs|exists returning:', fileExists, 'path:', args?.path, 'hasData:', lastProjectAudioData !== null);
      return fileExists as T;
    }

    case 'plugin:fs|read_file': {
      console.log('[Tauri Mock] plugin:fs|read_file called, hasData:', lastProjectAudioData !== null, 'dataLen:', lastProjectAudioData?.length);
      if (lastProjectAudioData) {
        return lastProjectAudioData as T;
      }
      throw new Error('File not found in mock mode');
    }

    default:
      console.error(`[Tauri Mock] Unknown command: ${command}`);
      throw new Error(`Command '${command}' not implemented in browser mock mode`);
  }
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
