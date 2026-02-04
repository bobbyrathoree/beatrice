import { useState, useEffect, useMemo, useCallback } from "react";
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
import { SessionSidebar } from "./components/SessionSidebar";
import type { Project } from "./store/useStore";
import type { ProjectSummary } from "./hooks/useProjects";
import type { EventDecision } from "./types/explainability";
import "./styles/brutalist.css";

type AppState = "input" | "recording" | "processing" | "results";

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
    setCurrentScreen,
    processingProgress,
    pipelineParams,
    setPipelineParam,
  } = useStore();

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

    try {
      // Validate audio data (WAV header is 44 bytes minimum)
      if (!audioBytes?.length) {
        throw new Error("No audio data to process");
      }

      if (audioBytes.length <= 44) {
        throw new Error("Audio file too short to process");
      }

      // Step 1: Detect events
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

      // Step 2: Estimate tempo
      const tempoResult = await invoke<{ bpm: number }>("estimate_tempo", {
        input: {
          audio_data: Array.from(audioBytes),
        },
      }).catch(err => {
        throw new Error(`Tempo estimation failed: ${err instanceof Error ? err.message : String(err)}`);
      });

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

      // Step 4: Arrange events
      const arrangement = await invoke<Arrangement>("arrange_events_command", {
        input: {
          events: quantizedResult,
          template: "synthwave_straight",
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
    } catch (err) {
      console.error("Pipeline failed:", err);
      setIsPipelineRunning(false);
      handleError(err instanceof Error ? err.message : "Pipeline processing failed");
      setState("input");
      setAudioData(null);
    }
  };

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
  }, [setCurrentScreen]);

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
        <SessionSidebar onSessionSelect={handleSessionSelect} />

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
