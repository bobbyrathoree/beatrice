import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store/useStore";
import { DropZone } from "./components/AudioInput/DropZone";
import { Recorder } from "./components/AudioInput/Recorder";
import { AudioScene } from "./components/Visualization/AudioScene";
import { ThemeSelector, type Theme } from "./components/Theme/ThemeSelector";
import { GrooveControls, type GridSettings, type QuantizeSettings } from "./components/Groove/GrooveControls";
import { DemoButton } from "./components/DemoButton";
import { BEmphasisSlider } from "./components/BEmphasisSlider";
import { ExportControls } from "./components/ExportControls";
import { Timeline } from "./components/Explainability/Timeline";
import { DecisionCard } from "./components/Explainability/DecisionCard";
import { Waveform } from "./components/Waveform";
import { BeatMarkers } from "./components/BeatMarkers";
import { PlaybackControls } from "./components/PlaybackControls";
import { SessionSidebar } from "./components/SessionSidebar";
import { useAudioPlayback } from "./hooks/useAudioPlayback";
import type { Project, Run } from "./store/useStore";
import type { ProjectSummary } from "./hooks/useProjects";
import type { EventDecision } from "./types/explainability";
import "./styles/brutalist.css";

type AppState = "input" | "recording" | "processing" | "results";

// Map a selected theme to an arrangement template name
function mapThemeToTemplate(theme: Theme | null): string {
  if (!theme) return "synthwave_straight";
  const name = theme.name?.toUpperCase() || "";
  if (name.includes("BLADE RUNNER")) return "synthwave_halftime";
  if (name.includes("STRANGER")) return "arp_drive";
  return "synthwave_straight";
}

// Matches Rust EventData structure from commands.rs
interface EventData {
  id: string;
  timestamp_ms: number;
  duration_ms: number;
  class: string;
  confidence: number;
  features: {
    spectral_centroid: number;
    zcr: number;
    low_band_energy: number;
    mid_band_energy: number;
    high_band_energy: number;
    peak_amplitude: number;
  };
}

// Matches Rust QuantizedEvent structure
interface QuantizedEvent {
  event_id: string;
  original_timestamp_ms: number;
  quantized_timestamp_ms: number;
  snap_delta_ms: number;
  event: EventData;
}

// Matches Rust Arrangement structure
interface Arrangement {
  tracks: Array<{
    name: string;
    events: QuantizedEvent[];
  }>;
}

interface PipelineResult {
  events: EventData[];
  arrangement: Arrangement;
  quantized_events: QuantizedEvent[];
  duration_ms?: number;
  bpm?: number;
}

function App() {
  // State management
  const [state, setState] = useState<AppState>("input");
  const [error, setError] = useState<string | null>(null);
  const {
    setCurrentProject,
    setCurrentRun,
    setCurrentScreen,
    processingProgress,
    setProcessingProgress,
    pipelineParams,
    setPipelineParam,
    setPipelineParams,
  } = useStore();

  // Sidebar refresh trigger — increment to force sidebar to re-fetch
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

  // Processing data
  const [audioData, setAudioData] = useState<Uint8Array | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isPipelineRunning, setIsPipelineRunning] = useState(false);

  // UI state
  const [audioLevel, setAudioLevel] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [gridSettings, setGridSettings] = useState<GridSettings>({
    bpm: 120,
    time_signature: 'four_four',
    division: 'sixteenth',
    feel: 'straight',
    swing_amount: 0,
    bar_count: 4,
  });
  const [quantizeSettings, setQuantizeSettings] = useState<QuantizeSettings>({
    strength: 0.8,
    swing_amount: 0,
    lookahead_ms: 100,
  });
  const [isReArranging, setIsReArranging] = useState(false);
  const reArrangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasEnteredResultsRef = useRef(false);

  // Audio playback
  const { isPlaying, currentTime, duration, play: playAudio, stop: stopAudio } = useAudioPlayback();

  // Stop playback when arrangement changes (after re-arrange)
  useEffect(() => {
    if (isPlaying) {
      stopAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineResult?.arrangement]);

  // Simulate audio level changes during processing
  useEffect(() => {
    if (state === "processing") {
      const interval = setInterval(() => {
        setAudioLevel(Math.random() * 0.8);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [state]);

  // Handle project created from recording or upload
  const handleProjectCreated = async (project: Project) => {
    if (isPipelineRunning || isAudioLoading) {
      console.warn("Pipeline already running, ignoring duplicate request");
      return;
    }

    try {
      setCurrentProject(project);
      setCurrentScreen("processing");
      setState("processing");
      setError(null);
      setIsAudioLoading(true);
      setAudioData(null);

      const audioBytes = await loadAudioData(project.input_path);
      setAudioData(audioBytes);
      setIsAudioLoading(false);

      await runPipeline(project, audioBytes);
    } catch (err) {
      setIsAudioLoading(false);
      setIsPipelineRunning(false);
      handleError(err instanceof Error ? err.message : "Failed to process audio");
      setState("input");
    }
  };

  // Load audio data from file path using Tauri fs plugin
  const loadAudioData = async (path: string): Promise<Uint8Array> => {
    if (!path?.trim()) {
      throw new Error("Invalid file path: path is empty or undefined");
    }

    try {
      const { readFile, exists } = await import("@tauri-apps/plugin-fs");

      const fileExists = await exists(path);
      if (!fileExists) {
        throw new Error(`File not found: ${path}`);
      }

      const data = await readFile(path);
      if (!data?.length) {
        throw new Error(`File is empty or could not be read: ${path}`);
      }

      return new Uint8Array(data);
    } catch (err) {
      if (err instanceof Error) {
        const isCustomError = err.message.includes("File not found") ||
                             err.message.includes("Invalid file path") ||
                             err.message.includes("File is empty");
        if (isCustomError) throw err;
        throw new Error(`Failed to read audio file: ${err.message}`);
      }
      throw new Error(`Failed to read audio file: ${String(err)}`);
    }
  };

  // Run the full pipeline
  const runPipeline = async (_project: Project, audioBytes: Uint8Array) => {
    if (isPipelineRunning) {
      console.warn("Pipeline already running, ignoring duplicate request");
      return;
    }

    setIsPipelineRunning(true);
    setProcessingProgress(0);

    try {
      // Validate audio data (WAV header is 44 bytes minimum)
      if (!audioBytes?.length) {
        throw new Error("No audio data to process");
      }

      if (audioBytes.length <= 44) {
        throw new Error("Audio file too short to process");
      }

      // Step 1: Detect events
      setProcessingProgress(0.1);
      const eventResult = await invoke<{ events: EventData[] }>("detect_events", {
        input: {
          audio_data: Array.from(audioBytes),
          run_id: null,
          use_calibration: false,
          calibration_profile_id: null,
        },
      }).catch(err => {
        throw new Error(`Event detection failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      if (!eventResult?.events?.length) {
        throw new Error("No events detected in audio. Try recording a longer or louder sample.");
      }

      setProcessingProgress(0.4);

      // Step 2: Estimate tempo
      const tempoResult = await invoke<{ bpm: number }>("estimate_tempo", {
        input: {
          audio_data: Array.from(audioBytes),
        },
      }).catch(err => {
        throw new Error(`Tempo estimation failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      setProcessingProgress(0.6);

      // Update grid settings with detected BPM
      setGridSettings((prev) => ({
        ...prev,
        bpm: tempoResult.bpm,
      }));

      // Step 3: Quantize events
      const quantizedResult = await invoke<QuantizedEvent[]>("quantize_events_command", {
        input: {
          events: eventResult.events,
          bpm: tempoResult.bpm,
          time_signature: gridSettings.time_signature,
          division: gridSettings.division,
          feel: gridSettings.feel,
          swing_amount: gridSettings.swing_amount,
          bar_count: gridSettings.bar_count,
          quantize_strength: quantizeSettings.strength,
          lookahead_ms: quantizeSettings.lookahead_ms,
        },
      }).catch(err => {
        throw new Error(`Event quantization failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      setProcessingProgress(0.8);

      // Step 4: Arrange events
      const arrangement = await invoke<Arrangement>("arrange_events_command", {
        input: {
          events: quantizedResult,
          template: mapThemeToTemplate(selectedTheme),
          bpm: tempoResult.bpm,
          time_signature: gridSettings.time_signature,
          division: gridSettings.division,
          feel: gridSettings.feel,
          swing_amount: gridSettings.swing_amount,
          bar_count: gridSettings.bar_count,
          b_emphasis: pipelineParams.bEmphasis,
        },
      }).catch(err => {
        throw new Error(`Event arrangement failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      setProcessingProgress(1.0);

      // Store results with BPM from tempo estimation
      setPipelineResult({
        events: eventResult.events,
        quantized_events: quantizedResult,
        arrangement,
        bpm: tempoResult.bpm,
      });

      // Transition to results
      setState("results");
      setCurrentScreen("results");
      setIsPipelineRunning(false);

      // Persist run to database (non-blocking — failures don't break the pipeline)
      try {
        const projectId = _project.id;
        if (projectId) {
          // Step 5: Create run record
          const run = await invoke<Run>("create_run", {
            input: {
              project_id: projectId,
              pipeline_version: "0.1.0",
              theme: selectedTheme?.name || "default",
              bpm: tempoResult.bpm,
              swing: gridSettings.swing_amount,
              quantize_strength: quantizeSettings.strength,
              b_emphasis: pipelineParams.bEmphasis,
            },
          });

          // Step 6: Mark run as complete
          await invoke("update_run_status", {
            input: { run_id: run.id, status: "complete" },
          });

          // Step 7: Save event decisions for explainability
          await invoke("save_event_decisions", {
            input: {
              run_id: run.id,
              events: eventResult.events,
              quantized_events: quantizedResult,
              arrangement,
            },
          });

          // Store current run in Zustand
          setCurrentRun({ ...run, status: "complete" });

          // Refresh sidebar to show the new run
          setSidebarRefreshKey((prev) => prev + 1);
        }
      } catch (saveErr) {
        console.warn("Failed to persist run (pipeline results are still available):", saveErr);
      }
    } catch (err) {
      console.error("Pipeline failed:", err);
      setIsPipelineRunning(false);
      handleError(err instanceof Error ? err.message : "Pipeline processing failed");
      setState("input");
      setAudioData(null);
    }
  };

  // Re-arrange events when grid/quantize/theme/b-emphasis settings change
  // Does NOT re-detect events or re-estimate tempo (those are expensive)
  const reArrange = useCallback(async () => {
    if (!pipelineResult?.events?.length || isPipelineRunning || isReArranging) {
      return;
    }

    setIsReArranging(true);
    try {
      const currentBpm = gridSettings.bpm;

      // Re-quantize with current settings
      const quantizedResult = await invoke<QuantizedEvent[]>("quantize_events_command", {
        input: {
          events: pipelineResult.events,
          bpm: currentBpm,
          time_signature: gridSettings.time_signature,
          division: gridSettings.division,
          feel: gridSettings.feel,
          swing_amount: gridSettings.swing_amount,
          bar_count: gridSettings.bar_count,
          quantize_strength: quantizeSettings.strength,
          lookahead_ms: quantizeSettings.lookahead_ms,
        },
      });

      // Re-arrange with current template and settings
      const arrangement = await invoke<Arrangement>("arrange_events_command", {
        input: {
          events: quantizedResult,
          template: mapThemeToTemplate(selectedTheme),
          bpm: currentBpm,
          time_signature: gridSettings.time_signature,
          division: gridSettings.division,
          feel: gridSettings.feel,
          swing_amount: gridSettings.swing_amount,
          bar_count: gridSettings.bar_count,
          b_emphasis: pipelineParams.bEmphasis,
        },
      });

      setPipelineResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          quantized_events: quantizedResult,
          arrangement,
        };
      });
    } catch (err) {
      console.error("Re-arrange failed:", err);
    } finally {
      setIsReArranging(false);
    }
  }, [pipelineResult?.events, isPipelineRunning, isReArranging, gridSettings, quantizeSettings, selectedTheme, pipelineParams.bEmphasis]);

  // Debounced re-arrange: fires 300ms after any control change on the results screen
  // Skips the initial trigger when first entering results (pipeline just ran)
  useEffect(() => {
    if (state !== "results" || !pipelineResult?.events?.length || isPipelineRunning) {
      // Reset the flag when leaving results so next entry is treated as initial
      if (state !== "results") {
        hasEnteredResultsRef.current = false;
      }
      return;
    }

    // Skip the first trigger after entering results — the pipeline just produced fresh data
    if (!hasEnteredResultsRef.current) {
      hasEnteredResultsRef.current = true;
      return;
    }

    if (reArrangeTimerRef.current) {
      clearTimeout(reArrangeTimerRef.current);
    }

    reArrangeTimerRef.current = setTimeout(() => {
      reArrange();
    }, 300);

    return () => {
      if (reArrangeTimerRef.current) {
        clearTimeout(reArrangeTimerRef.current);
      }
    };
  }, [gridSettings, quantizeSettings, selectedTheme, pipelineParams.bEmphasis, state, pipelineResult?.events, isPipelineRunning, reArrange]);

  // Event handlers
  const handleError = useCallback((errorMessage: string) => {
    setError(errorMessage);
    setTimeout(() => setError(null), 5000);
  }, []);

  const handleCancelRecording = useCallback(() => {
    setState("input");
  }, []);

  const handleThemeChange = useCallback((theme: Theme | null) => {
    setSelectedTheme(theme);
    if (theme) {
      setPipelineParam("theme", theme.name);
    }
  }, [setPipelineParam]);

  const handleGridChange = useCallback((settings: GridSettings) => {
    setGridSettings(settings);
    setPipelineParam("bpm", settings.bpm);
    setPipelineParam("swing", settings.swing_amount);
  }, [setPipelineParam]);

  const handleQuantizeChange = useCallback((settings: QuantizeSettings) => {
    setQuantizeSettings(settings);
    setPipelineParam("quantize", settings.strength);
  }, [setPipelineParam]);

  const handleBEmphasisChange = useCallback((value: number) => {
    setPipelineParam("bEmphasis", value);
  }, [setPipelineParam]);

  const handleNewRecording = useCallback(() => {
    setState("input");
    setCurrentScreen("input");
    setPipelineResult(null);
    setAudioData(null);
    setIsAudioLoading(false);
    setIsPipelineRunning(false);
    setError(null);
    setCurrentRun(null);
  }, [setCurrentScreen, setCurrentRun]);

  const handleSessionSelect = useCallback(async (projectSummary: ProjectSummary) => {
    try {
      const { getTauriAPI } = await import("./utils/tauri-mock");
      const tauri = getTauriAPI();
      const fullProject = await tauri.invoke("get_project", { id: projectSummary.id });

      if (fullProject) {
        await handleProjectCreated(fullProject as Project);
      }
    } catch (err) {
      handleError(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [handleError]);

  // Handle clicking a specific run in the sidebar
  const handleRunSelect = useCallback(async (run: Run, projectId: string) => {
    try {
      // Load the project
      const fullProject = await invoke<Project | null>("get_project", { id: projectId });
      if (!fullProject) {
        handleError("Project not found");
        return;
      }

      // Set project and run in store
      setCurrentProject(fullProject);
      setCurrentRun(run);

      // Set pipeline params from the run's stored params
      setPipelineParams({
        theme: run.theme,
        bpm: run.bpm,
        swing: run.swing,
        quantize: run.quantize_strength,
        bEmphasis: run.b_emphasis,
      });

      // Update grid settings from run
      setGridSettings((prev) => ({
        ...prev,
        bpm: run.bpm,
        swing_amount: run.swing,
      }));

      setQuantizeSettings((prev) => ({
        ...prev,
        strength: run.quantize_strength,
      }));

      // Try to load cached event decisions
      try {
        const decisions = await invoke<EventDecision[]>("get_event_decisions", {
          run_id: run.id,
        });

        if (decisions && decisions.length > 0) {
          // Reconstruct pipeline result from cached decisions
          const events: EventData[] = decisions.map((d) => ({
            id: d.event_id,
            timestamp_ms: d.original_timestamp_ms,
            duration_ms: 50, // Default duration for reconstructed events
            class: d.class,
            confidence: d.confidence,
            features: d.features,
          }));

          const quantized: QuantizedEvent[] = decisions.map((d) => ({
            event_id: d.event_id,
            original_timestamp_ms: d.original_timestamp_ms,
            quantized_timestamp_ms: d.quantized_timestamp_ms,
            snap_delta_ms: d.snap_delta_ms,
            event: {
              id: d.event_id,
              timestamp_ms: d.original_timestamp_ms,
              duration_ms: 50,
              class: d.class,
              confidence: d.confidence,
              features: d.features,
            },
          }));

          setPipelineResult({
            events,
            quantized_events: quantized,
            arrangement: { tracks: [] } as unknown as Arrangement,
            bpm: run.bpm,
          });

          // Load audio for waveform display
          try {
            const audioBytes = await loadAudioData(fullProject.input_path);
            setAudioData(audioBytes);
          } catch {
            // Audio may not be available, that's OK for viewing decisions
            console.warn("Could not load audio for run replay");
          }

          setState("results");
          setCurrentScreen("results");
          return;
        }
      } catch {
        console.warn("No cached event decisions found, running full pipeline");
      }

      // No cached decisions — run the full pipeline with stored params
      setState("processing");
      setCurrentScreen("processing");
      setError(null);
      setIsAudioLoading(true);
      setAudioData(null);

      const audioBytes = await loadAudioData(fullProject.input_path);
      setAudioData(audioBytes);
      setIsAudioLoading(false);

      await runPipeline(fullProject, audioBytes);
    } catch (err) {
      handleError(`Failed to load run: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [handleError, setCurrentProject, setCurrentRun, setPipelineParams, setCurrentScreen]);

  // Convert pipeline events to EventDecision format for explainability
  const eventDecisions = useMemo<EventDecision[]>(() => {
    if (!pipelineResult?.events?.length) return [];

    return pipelineResult.events.map((event: EventData, index: number) => {
      const quantizedEvent = pipelineResult.quantized_events?.[index];
      const quantizedTimestamp = quantizedEvent?.quantized_timestamp_ms ?? event.timestamp_ms;
      const originalTimestamp = quantizedEvent?.original_timestamp_ms ?? event.timestamp_ms;

      const features = {
        spectral_centroid: event.features?.spectral_centroid ?? 0,
        zcr: event.features?.zcr ?? 0,
        low_band_energy: event.features?.low_band_energy ?? 0,
        mid_band_energy: event.features?.mid_band_energy ?? 0,
        high_band_energy: event.features?.high_band_energy ?? 0,
        peak_amplitude: event.features?.peak_amplitude ?? 0,
      };

      const confidence = event.confidence ?? 0.85;
      const className = event.class || 'BilabialPlosive';

      return {
        event_id: event.id || `event_${index}`,
        original_timestamp_ms: originalTimestamp,
        quantized_timestamp_ms: quantizedTimestamp,
        snap_delta_ms: quantizedTimestamp - originalTimestamp,
        class: className as EventDecision['class'],
        confidence,
        mapped_to: ['SYNTH'],
        reasoning: `Classified as ${className} based on audio features. Confidence: ${(confidence * 100).toFixed(1)}%.`,
        features,
      };
    });
  }, [pipelineResult]);

  const handleEventClick = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
  }, []);

  const handleCloseDecisionCard = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  // Get selected event for DecisionCard
  const selectedEvent = useMemo<EventDecision | null>(() => {
    if (!selectedEventId) return null;
    return eventDecisions.find(e => e.event_id === selectedEventId) || null;
  }, [selectedEventId, eventDecisions]);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1
          className="logo logo-home-button"
          onClick={handleNewRecording}
          title="Return to home"
        >
          BEATRICE
        </h1>
        {state === "recording" && <span className="rec-indicator">● REC</span>}
      </header>

      {/* Error Notification */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="notification"
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* App Body - Contains Sidebar and Main Content */}
      <div className="app-body">
        {/* Session Sidebar */}
        <SessionSidebar
          onSessionSelect={handleSessionSelect}
          onRunSelect={handleRunSelect}
          refreshKey={sidebarRefreshKey}
        />

        {/* Main Content */}
        <main className="main">
        <AnimatePresence mode="wait">
          {/* INPUT STATE */}
          {state === "input" && (
            <motion.div
              key="input"
              className="input-container-redesign"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
            >
              {/* Main Action Cards */}
              <div className="action-cards-container">
                {/* Record Card */}
                <motion.div
                  className="action-card"
                  initial={{ opacity: 0, x: -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="card-icon">●</div>
                  <h2 className="card-title">RECORD</h2>
                  <p className="card-description">
                    Capture your beatbox performance live with your microphone
                  </p>
                  <div className="card-spacer"></div>
                  <motion.button
                    className="btn btn-primary btn-large"
                    onClick={() => setState("recording")}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    START RECORDING
                  </motion.button>
                </motion.div>

                {/* Upload Card */}
                <motion.div
                  className="action-card"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="card-icon">↑</div>
                  <h2 className="card-title">UPLOAD</h2>
                  <p className="card-description">
                    Drop an existing WAV file to analyze and transform
                  </p>
                  <div className="card-dropzone-wrapper">
                    <DropZone
                      onProjectCreated={handleProjectCreated}
                      onError={handleError}
                    />
                  </div>
                </motion.div>
              </div>

              {/* Demo Button */}
              <motion.div
                className="demo-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <DemoButton
                  onProjectCreated={handleProjectCreated}
                  onError={handleError}
                />
              </motion.div>
            </motion.div>
          )}

          {/* RECORDING STATE */}
          {state === "recording" && (
            <motion.div
              key="recording"
              className="recording-container"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
            >
              <Recorder
                onProjectCreated={handleProjectCreated}
                onError={handleError}
                onCancel={handleCancelRecording}
              />
            </motion.div>
          )}

          {/* PROCESSING STATE */}
          {state === "processing" && (
            <motion.div
              key="processing"
              className="processing-container"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
            >
              <div className="viz-container">
                <AudioScene
                  audioLevel={audioLevel}
                  events={[]}
                  theme={pipelineParams.theme}
                  isProcessing={true}
                  progress={processingProgress}
                />
              </div>
            </motion.div>
          )}

          {/* RESULTS STATE */}
          {state === "results" && (
            <motion.div
              key="results"
              className="results-container"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Waveform Display */}
              <Waveform
                audioData={audioData || undefined}
                duration={pipelineResult?.duration_ms || 10000}
                events={eventDecisions}
              />

              {/* B-Sound Markers */}
              <BeatMarkers
                events={eventDecisions}
                duration={pipelineResult?.duration_ms || 10000}
                onMarkerClick={(event) => setSelectedEventId(event.event_id)}
              />

              {/* Playback Controls */}
              {pipelineResult?.arrangement && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 }}
                >
                  <PlaybackControls
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    duration={duration}
                    onPlay={() => playAudio(pipelineResult.arrangement, gridSettings.bpm)}
                    onStop={stopAudio}
                  />
                </motion.div>
              )}

              {/* Event Timeline */}
              {pipelineResult && pipelineResult.events.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <Timeline
                    events={eventDecisions}
                    onEventClick={handleEventClick}
                  />
                </motion.div>
              )}

              {/* Theme Selector */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <ThemeSelector
                  onThemeChange={handleThemeChange}
                  disabled={false}
                />
              </motion.div>

              {/* Groove Controls */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <GrooveControls
                  audioData={audioData || undefined}
                  onGridChange={handleGridChange}
                  onQuantizeChange={handleQuantizeChange}
                />
              </motion.div>

              {/* B-Emphasis Slider */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <BEmphasisSlider
                  value={pipelineParams.bEmphasis}
                  onChange={handleBEmphasisChange}
                  disabled={false}
                />
              </motion.div>

              {/* Export Controls */}
              {pipelineResult && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <ExportControls
                    arrangement={pipelineResult.arrangement}
                    gridSettings={gridSettings}
                    themeName={selectedTheme?.name || pipelineParams.theme}
                    disabled={false}
                  />
                </motion.div>
              )}

              {/* New Recording Button */}
              <motion.button
                className="btn btn-large"
                onClick={handleNewRecording}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                style={{ width: "100%" }}
              >
                ↺ NEW RECORDING
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
        </main>
      </div>

      {/* Decision Card Popup */}
      <DecisionCard
        event={selectedEvent}
        onClose={handleCloseDecisionCard}
      />
    </div>
  );
}

export default App;
