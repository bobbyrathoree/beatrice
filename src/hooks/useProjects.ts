// React hooks for project and run management via Tauri IPC
import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Project, Run, Artifact } from '../store/useStore';

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  duration_ms: number;
  run_count: number;
}

export interface RunWithArtifacts {
  run: Run;
  artifacts: Artifact[];
}

export interface CalibrationProfile {
  id: string;
  name: string;
  created_at: string;
  profile_json_path: string;
  notes?: string;
}

// ==================== PROJECT HOOKS ====================

/**
 * Hook to list all projects
 */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<ProjectSummary[]>('list_projects');
      setProjects(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProject = useCallback(
    async (name: string, inputData: Uint8Array): Promise<Project | null> => {
      try {
        setError(null);
        const project = await invoke<Project>('create_project', {
          input: {
            name,
            input_data: Array.from(inputData),
          },
        });
        await refresh();
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [refresh]
  );

  const getProject = useCallback(async (id: string): Promise<Project | null> => {
    try {
      setError(null);
      const project = await invoke<Project | null>('get_project', { id });
      return project;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  return {
    projects,
    loading,
    error,
    refresh,
    createProject,
    getProject,
  };
}

// ==================== RUN HOOKS ====================

/**
 * Hook to manage runs for a specific project
 */
export function useRuns(projectId: string | null) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRuns([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await invoke<Run[]>('list_runs_for_project', {
        project_id: projectId,
      });
      setRuns(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createRun = useCallback(
    async (params: {
      pipelineVersion: string;
      theme: string;
      bpm: number;
      swing: number;
      quantizeStrength: number;
      bEmphasis: number;
    }): Promise<Run | null> => {
      if (!projectId) return null;

      try {
        setError(null);
        const run = await invoke<Run>('create_run', {
          input: {
            project_id: projectId,
            pipeline_version: params.pipelineVersion,
            theme: params.theme,
            bpm: params.bpm,
            swing: params.swing,
            quantize_strength: params.quantizeStrength,
            b_emphasis: params.bEmphasis,
          },
        });
        await refresh();
        return run;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [projectId, refresh]
  );

  const getRun = useCallback(async (runId: string): Promise<Run | null> => {
    try {
      setError(null);
      const run = await invoke<Run | null>('get_run', { id: runId });
      return run;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const getRunWithArtifacts = useCallback(
    async (runId: string): Promise<RunWithArtifacts | null> => {
      try {
        setError(null);
        const result = await invoke<RunWithArtifacts | null>(
          'get_run_with_artifacts',
          { run_id: runId }
        );
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    []
  );

  const updateRunStatus = useCallback(
    async (
      runId: string,
      status: 'pending' | 'processing' | 'complete' | 'failed'
    ): Promise<boolean> => {
      try {
        setError(null);
        await invoke('update_run_status', {
          input: {
            run_id: runId,
            status,
          },
        });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [refresh]
  );

  return {
    runs,
    loading,
    error,
    refresh,
    createRun,
    getRun,
    getRunWithArtifacts,
    updateRunStatus,
  };
}

// ==================== ARTIFACT HOOKS ====================

/**
 * Hook to create artifacts
 */
export function useArtifacts() {
  const [error, setError] = useState<string | null>(null);

  const createArtifact = useCallback(
    async (params: {
      runId: string;
      kind: 'midi' | 'audio' | 'visualization' | 'metadata';
      filename: string;
      data: Uint8Array;
    }): Promise<Artifact | null> => {
      try {
        setError(null);
        const artifact = await invoke<Artifact>('create_artifact', {
          input: {
            run_id: params.runId,
            kind: params.kind,
            filename: params.filename,
            data: Array.from(params.data),
          },
        });
        return artifact;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    []
  );

  return {
    error,
    createArtifact,
  };
}

// ==================== CALIBRATION PROFILE HOOKS ====================

/**
 * Hook to manage calibration profiles
 */
export function useCalibrationProfiles() {
  const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<CalibrationProfile[]>(
        'list_calibration_profiles'
      );
      setProfiles(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createProfile = useCallback(
    async (
      name: string,
      profileData: Uint8Array,
      notes?: string
    ): Promise<CalibrationProfile | null> => {
      try {
        setError(null);
        const profile = await invoke<CalibrationProfile>(
          'create_calibration_profile',
          {
            input: {
              name,
              profile_data: Array.from(profileData),
              notes,
            },
          }
        );
        await refresh();
        return profile;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [refresh]
  );

  const getProfile = useCallback(
    async (id: string): Promise<CalibrationProfile | null> => {
      try {
        setError(null);
        const profile = await invoke<CalibrationProfile | null>(
          'get_calibration_profile',
          { id }
        );
        return profile;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    []
  );

  const updateProfile = useCallback(
    async (
      id: string,
      updates: { name?: string; notes?: string }
    ): Promise<boolean> => {
      try {
        setError(null);
        await invoke('update_calibration_profile', {
          input: {
            id,
            ...updates,
          },
        });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [refresh]
  );

  const deleteProfile = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        setError(null);
        await invoke('delete_calibration_profile', { id });
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [refresh]
  );

  return {
    profiles,
    loading,
    error,
    refresh,
    createProfile,
    getProfile,
    updateProfile,
    deleteProfile,
  };
}
