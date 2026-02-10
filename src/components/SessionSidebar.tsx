import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useProjects, type ProjectSummary } from "../hooks/useProjects";
import { useStore } from "../store/useStore";
import type { Run } from "../store/useStore";

interface SessionSidebarProps {
  onSessionSelect?: (project: ProjectSummary) => void;
  onRunSelect?: (run: Run, projectId: string) => void;
  refreshKey?: number;
}

export function SessionSidebar({ onSessionSelect, onRunSelect, refreshKey }: SessionSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { projects, loading, error, refresh } = useProjects();
  const { currentProject, currentRun } = useStore();

  // Expanded project and its loaded runs
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [projectRuns, setProjectRuns] = useState<Record<string, Run[]>>({});
  const [loadingRuns, setLoadingRuns] = useState<string | null>(null);

  // Refresh projects when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refresh();
      // Also refresh runs for the expanded project
      if (expandedProjectId) {
        loadRunsForProject(expandedProjectId);
      }
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRunsForProject = useCallback(async (projectId: string) => {
    setLoadingRuns(projectId);
    try {
      const runs = await invoke<Run[]>("list_runs_for_project", {
        project_id: projectId,
      });
      setProjectRuns((prev) => ({ ...prev, [projectId]: runs }));
    } catch (err) {
      console.error("Failed to load runs for project:", err);
      setProjectRuns((prev) => ({ ...prev, [projectId]: [] }));
    } finally {
      setLoadingRuns(null);
    }
  }, []);

  const handleProjectClick = useCallback(
    (project: ProjectSummary) => {
      if (expandedProjectId === project.id) {
        // Collapse if already expanded
        setExpandedProjectId(null);
      } else {
        // Expand and load runs
        setExpandedProjectId(project.id);
        loadRunsForProject(project.id);
      }
      // Also notify parent for project-level selection
      onSessionSelect?.(project);
    },
    [expandedProjectId, loadRunsForProject, onSessionSelect]
  );

  const handleRunClick = useCallback(
    (e: React.MouseEvent, run: Run, projectId: string) => {
      e.stopPropagation(); // Don't trigger project click
      onRunSelect?.(run, projectId);
    },
    [onRunSelect]
  );

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      // Format: "Dec 29, 10:30 AM"
      const dateStr = date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const timeStr = date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      return `${dateStr}, ${timeStr}`;
    } catch {
      return "Unknown";
    }
  };

  const formatDuration = (durationMs: number): string => {
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  return (
    <motion.aside
      className={`session-sidebar ${isCollapsed ? "collapsed" : ""}`}
      initial={false}
      animate={{
        width: isCollapsed ? "60px" : "320px",
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      {/* Toggle Button */}
      <button
        className="sidebar-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span className="toggle-icon">{isCollapsed ? "▶" : "◀"}</span>
      </button>

        {/* Sidebar Content */}
        <AnimatePresence mode="wait">
          {!isCollapsed && (
            <motion.div
              className="sidebar-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Header */}
              <div className="sidebar-header">
                <h3 className="sidebar-title">History</h3>
                <span className="session-count">
                  {projects.length}
                </span>
              </div>

              {/* Loading State */}
              {loading && (
                <div className="sidebar-loading">
                  <div className="loading-spinner"></div>
                  <p>Loading sessions...</p>
                </div>
              )}

              {/* Error State */}
              {error && !loading && (
                <div className="sidebar-error">
                  <p>Failed to load sessions</p>
                  <span className="error-message">{error}</span>
                </div>
              )}

              {/* Sessions List */}
              {!loading && !error && (
                <div className="sessions-list">
                  {projects.length === 0 ? (
                    <div className="empty-state">
                      <p>No sessions yet</p>
                      <span>Record or upload to start</span>
                    </div>
                  ) : (
                    projects.map((project) => {
                      const isExpanded = expandedProjectId === project.id;
                      const runs = projectRuns[project.id] || [];
                      const isLoadingThisProject = loadingRuns === project.id;

                      return (
                        <div key={project.id}>
                          <motion.div
                            className={`session-item session-item-expandable ${
                              currentProject?.id === project.id ? "active" : ""
                            }`}
                            onClick={() => handleProjectClick(project)}
                            whileHover={{ scale: 1.02, x: 4 }}
                            whileTap={{ scale: 0.98 }}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="session-header-row">
                              <span
                                className={`session-expand-icon ${isExpanded ? "expanded" : ""}`}
                              >
                                ▶
                              </span>
                              <h4 className="session-name">{project.name}</h4>
                              <span className="session-time">
                                {formatTimestamp(project.created_at)}
                              </span>
                            </div>

                            <div className="session-meta">
                              <span className="session-duration">
                                {formatDuration(project.duration_ms)}
                              </span>
                              <span className="session-runs">
                                {project.run_count} run{project.run_count !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </motion.div>

                          {/* Runs sub-list */}
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                className="runs-list"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                {isLoadingThisProject && (
                                  <div className="runs-loading">Loading runs...</div>
                                )}

                                {!isLoadingThisProject && runs.length === 0 && (
                                  <div className="runs-loading">No runs yet</div>
                                )}

                                {!isLoadingThisProject &&
                                  runs.map((run) => (
                                    <motion.div
                                      key={run.id}
                                      className={`run-item ${
                                        currentRun?.id === run.id ? "active" : ""
                                      }`}
                                      onClick={(e) => handleRunClick(e, run, project.id)}
                                      whileHover={{ scale: 1.02, x: 2 }}
                                      whileTap={{ scale: 0.98 }}
                                      initial={{ opacity: 0, x: -10 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ duration: 0.15 }}
                                    >
                                      <div className="run-header-row">
                                        <span className="run-theme">{run.theme}</span>
                                        <span className="run-time">
                                          {formatTimestamp(run.created_at)}
                                        </span>
                                      </div>
                                      <div className="run-meta">
                                        <span className="run-bpm">
                                          {Math.round(run.bpm)}
                                        </span>
                                        <span
                                          className={`run-status ${run.status}`}
                                        >
                                          {run.status}
                                        </span>
                                      </div>
                                    </motion.div>
                                  ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed State Icon */}
        {isCollapsed && (
          <motion.div
            className="sidebar-collapsed-icon"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <span className="icon-history">H</span>
          </motion.div>
        )}
      </motion.aside>
  );
}
