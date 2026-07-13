// React hooks for project and run management via the generated Tauri bindings.
import { useEffect, useState, useCallback } from 'react';
import { commands, unwrap, formatIpcError } from '../types/ipc';
import type { ProjectSummary, RunWithArtifacts, CalibrationProfile } from '../types/ipc';
import { Project, Run, Artifact } from '../store/useStore';

// Re-export generated types so existing consumers (App.tsx, SessionSidebar) keep working.
export type { ProjectSummary, RunWithArtifacts, CalibrationProfile } from '../types/ipc';

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
      const result = unwrap(await commands.listProjects());
      setProjects(result);
    } catch (err) {
      setError(formatIpcError(err));
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
        const project = unwrap(
          await commands.createProject({
            name,
            input_data: Array.from(inputData),
          })
        );
        await refresh();
        return project;
      } catch (err) {
        setError(formatIpcError(err));
        return null;
      }
    },
    [refresh]
  );

  const getProject = useCallback(async (id: string): Promise<Project | null> => {
    try {
      setError(null);
      const project = unwrap(await commands.getProject(id));
      return project;
    } catch (err) {
      setError(formatIpcError(err));
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
      const result = unwrap(await commands.listRunsForProject(projectId));
      setRuns(result);
    } catch (err) {
      setError(formatIpcError(err));
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
        const run = unwrap(
          await commands.createRun({
            project_id: projectId,
            pipeline_version: params.pipelineVersion,
            theme: params.theme,
            bpm: params.bpm,
            swing: params.swing,
            quantize_strength: params.quantizeStrength,
            b_emphasis: params.bEmphasis,
          })
        );
        await refresh();
        return run;
      } catch (err) {
        setError(formatIpcError(err));
        return null;
      }
    },
    [projectId, refresh]
  );

  const getRun = useCallback(async (runId: string): Promise<Run | null> => {
    try {
      setError(null);
      const run = unwrap(await commands.getRun(runId));
      return run;
    } catch (err) {
      setError(formatIpcError(err));
      return null;
    }
  }, []);

  const getRunWithArtifacts = useCallback(
    async (runId: string): Promise<RunWithArtifacts | null> => {
      try {
        setError(null);
        const result = unwrap(await commands.getRunWithArtifacts(runId));
        return result;
      } catch (err) {
        setError(formatIpcError(err));
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
        unwrap(
          await commands.updateRunStatus({
            run_id: runId,
            status,
          })
        );
        await refresh();
        return true;
      } catch (err) {
        setError(formatIpcError(err));
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
        const artifact = unwrap(
          await commands.createArtifact({
            run_id: params.runId,
            kind: params.kind,
            filename: params.filename,
            data: Array.from(params.data),
          })
        );
        return artifact;
      } catch (err) {
        setError(formatIpcError(err));
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
      const result = unwrap(await commands.listCalibrationProfiles());
      setProfiles(result);
    } catch (err) {
      setError(formatIpcError(err));
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
        const profile = unwrap(
          await commands.createCalibrationProfile({
            name,
            profile_data: Array.from(profileData),
            notes: notes ?? null,
          })
        );
        await refresh();
        return profile;
      } catch (err) {
        setError(formatIpcError(err));
        return null;
      }
    },
    [refresh]
  );

  const getProfile = useCallback(
    async (id: string): Promise<CalibrationProfile | null> => {
      try {
        setError(null);
        const profile = unwrap(await commands.getCalibrationProfile(id));
        return profile;
      } catch (err) {
        setError(formatIpcError(err));
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
        unwrap(
          await commands.updateCalibrationProfile({
            id,
            name: updates.name ?? null,
            notes: updates.notes ?? null,
          })
        );
        await refresh();
        return true;
      } catch (err) {
        setError(formatIpcError(err));
        return false;
      }
    },
    [refresh]
  );

  const deleteProfile = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        setError(null);
        unwrap(await commands.deleteCalibrationProfile(id));
        await refresh();
        return true;
      } catch (err) {
        setError(formatIpcError(err));
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
