// Zustand store for Beatrice UI state management
import { create } from 'zustand';

export type Screen = 'input' | 'recording' | 'processing' | 'results';

export interface Project {
  id: string;
  created_at: string;
  name: string;
  input_path: string;
  input_sha256: string;
  duration_ms: number;
}

export interface Run {
  id: string;
  project_id: string;
  created_at: string;
  pipeline_version: string;
  theme: string;
  bpm: number;
  swing: number;
  quantize_strength: number;
  b_emphasis: number;
  status: 'pending' | 'processing' | 'complete' | 'failed';
}

export interface Artifact {
  id: string;
  run_id: string;
  kind: 'midi' | 'audio' | 'visualization' | 'metadata';
  path: string;
  sha256: string;
  bytes: number;
}

export interface PipelineParams {
  theme: string;
  bpm: number;
  swing: number;
  quantize: number;
  bEmphasis: number;
}

interface BeatriceState {
  // Screen navigation
  currentScreen: Screen;
  setCurrentScreen: (screen: Screen) => void;

  // Project and run state
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  currentRun: Run | null;
  setCurrentRun: (run: Run | null) => void;

  // Processing state
  processingProgress: number;
  setProcessingProgress: (progress: number) => void;

  // Pipeline parameters
  pipelineParams: PipelineParams;
  setPipelineParam: <K extends keyof PipelineParams>(
    key: K,
    value: PipelineParams[K]
  ) => void;
  setPipelineParams: (params: Partial<PipelineParams>) => void;

  // Reset state
  reset: () => void;
}

const defaultPipelineParams: PipelineParams = {
  theme: 'trap',
  bpm: 140,
  swing: 0.5,
  quantize: 0.8,
  bEmphasis: 0.6,
};

export const useStore = create<BeatriceState>((set) => ({
  // Screen navigation
  currentScreen: 'input',
  setCurrentScreen: (screen) => set({ currentScreen: screen }),

  // Project and run state
  currentProject: null,
  setCurrentProject: (project) => set({ currentProject: project }),
  currentRun: null,
  setCurrentRun: (run) => set({ currentRun: run }),

  // Processing state
  processingProgress: 0,
  setProcessingProgress: (progress) => set({ processingProgress: progress }),

  // Pipeline parameters
  pipelineParams: defaultPipelineParams,
  setPipelineParam: (key, value) =>
    set((state) => ({
      pipelineParams: {
        ...state.pipelineParams,
        [key]: value,
      },
    })),
  setPipelineParams: (params) =>
    set((state) => ({
      pipelineParams: {
        ...state.pipelineParams,
        ...params,
      },
    })),

  // Reset state
  reset: () =>
    set({
      currentScreen: 'input',
      currentProject: null,
      currentRun: null,
      processingProgress: 0,
      pipelineParams: defaultPipelineParams,
    }),
}));
