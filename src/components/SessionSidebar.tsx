import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjects, type ProjectSummary } from "../hooks/useProjects";
import { useStore } from "../store/useStore";

interface SessionSidebarProps {
  onSessionSelect?: (project: ProjectSummary) => void;
}

export function SessionSidebar({ onSessionSelect }: SessionSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { projects, loading, error } = useProjects();
  const { currentProject } = useStore();

  const handleSessionClick = useCallback((project: ProjectSummary) => {
    onSessionSelect?.(project);
  }, [onSessionSelect]);

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
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }) + ", " + date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
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
    <>
      {/* Sidebar */}
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
                    projects.map((project) => (
                      <motion.div
                        key={project.id}
                        className={`session-item ${
                          currentProject?.id === project.id ? "active" : ""
                        }`}
                        onClick={() => handleSessionClick(project)}
                        whileHover={{ scale: 1.02, x: 4 }}
                        whileTap={{ scale: 0.98 }}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="session-header-row">
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
                    ))
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
            <span className="icon-history">📋</span>
          </motion.div>
        )}
      </motion.aside>
    </>
  );
}
