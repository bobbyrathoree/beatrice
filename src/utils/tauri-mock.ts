/**
 * Tauri API Mock for Browser Development
 *
 * This file provides mock implementations of Tauri commands for browser-only development mode.
 * When running with './run.sh browser', the frontend can still load without the Tauri backend,
 * allowing for UI development and testing.
 *
 * NOTE: These are mock implementations that return dummy data or throw not-implemented errors.
 */

export const isTauriAvailable = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

export const invoke = async <T = any>(command: string, args?: any): Promise<T> => {
  console.warn(`[Tauri Mock] Command '${command}' called in browser mode. Returning mock data.`, args);

  switch (command) {
    case 'greet':
      return `Hello ${args?.name || 'World'}!` as T;

    case 'list_projects':
      return [] as T;

    case 'get_project':
      return {
        id: args?.id || 'mock-1',
        name: 'Sample Project',
        created_at: new Date().toISOString(),
        input_path: '/mock/path/to/audio.wav',
        input_sha256: 'mock-sha256-hash',
        duration_ms: 5000,
      } as T;

    case 'create_project':
      return {
        id: 'mock-new',
        name: args?.name || 'New Project',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as T;

    case 'list_themes':
      return [
        {
          name: 'Blade Runner',
          description: 'Dark, moody synth theme inspired by the cyberpunk classic',
          instruments: ['Bass', 'Lead', 'Pad'],
        },
        {
          name: 'Stranger Things',
          description: 'Retro 80s synth theme',
          instruments: ['Bass', 'Lead', 'Arp'],
        },
      ] as T;

    case 'list_theme_names':
      return ['Blade Runner', 'Stranger Things'] as T;

    case 'get_theme':
      return {
        name: args?.name || 'Blade Runner',
        description: 'Mock theme description',
        instruments: ['Bass', 'Lead', 'Pad'],
      } as T;

    case 'list_calibration_profiles':
      return [
        { id: 'mock-cal-1', name: 'Default', threshold: 0.5 },
      ] as T;

    case 'get_calibration_profile':
      return {
        id: args?.id || 'mock-cal-1',
        name: 'Default',
        threshold: 0.5,
        min_interval_ms: 100,
      } as T;

    case 'start_recording':
      console.log('[Tauri Mock] Recording started (simulated)');
      return { success: true } as T;

    case 'stop_recording':
      console.log('[Tauri Mock] Recording stopped (simulated)');
      return {
        audio_data: new Array(44100).fill(0),
        sample_rate: 44100,
      } as T;

    case 'is_recording':
      return false as T;

    case 'get_recording_level':
      return (Math.random() * 0.5) as T;

    case 'detect_onsets':
      return [0.5, 1.0, 1.5, 2.0, 2.5] as T;

    case 'detect_events':
      return [
        { time: 0.5, type: 'kick', confidence: 0.8 },
        { time: 1.0, type: 'snare', confidence: 0.7 },
        { time: 1.5, type: 'kick', confidence: 0.9 },
      ] as T;

    case 'estimate_tempo':
      return { tempo: 120.0, confidence: 0.85 } as T;

    case 'quantize_events_command':
      return {
        events: args?.events || [],
        tempo: 120.0,
      } as T;

    case 'arrange_events_command':
      return {
        arrangement: {
          measures: 4,
          events: [],
        },
      } as T;

    case 'export_midi_command':
      console.log('[Tauri Mock] MIDI export (simulated)');
      return { path: '/mock/path/export.mid' } as T;

    case 'render_preview':
      console.log('[Tauri Mock] Audio preview render (simulated)');
      return { audio_data: new Array(44100 * 2).fill(0) } as T;

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
