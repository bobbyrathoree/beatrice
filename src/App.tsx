import { useState, useEffect } from "react";
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
import type { Project } from "./store/useStore";
import type { DetectedEvent } from "./types/visualization";
import type { EventDecision } from "./types/explainability";
import "./styles/brutalist.css";

type AppState = "input" | "recording" | "processing" | "results";

interface PipelineResult {
  events: any[];
  arrangement: any;
  quantized_events: any[];
  duration_ms?: number;
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

  // UI state
  const [audioLevel, setAudioLevel] = useState(0);
  const [events] = useState<DetectedEvent[]>([]);
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
    try {
      setCurrentProject(project);
      setCurrentScreen("processing");
      setState("processing");
      setError(null);

      // Load audio data for processing
      const audioBytes = await loadAudioData(project.input_path);
      setAudioData(audioBytes);

      // Start pipeline
      await runPipeline(project, audioBytes);
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Failed to process audio");
      setState("input");
    }
  };

  // Load audio data from file path
  const loadAudioData = async (_path: string): Promise<Uint8Array> => {
    // This would need actual file reading implementation
    // For now, return empty array as placeholder
    return new Uint8Array();
  };

  // Run the full pipeline
  const runPipeline = async (_project: Project, audioBytes: Uint8Array) => {
    try {
      // Step 1: Detect events
      const eventResult = await invoke<any>("detect_events", {
        input: {
          audio_data: Array.from(audioBytes),
          run_id: null,
          use_calibration: false,
          calibration_profile_id: null,
        },
      });

      // Step 2: Estimate tempo
      const tempoResult = await invoke<any>("estimate_tempo", {
        input: {
          audio_data: Array.from(audioBytes),
        },
      });

      // Update grid settings with detected BPM
      setGridSettings((prev) => ({
        ...prev,
        bpm: tempoResult.bpm,
      }));

      // Step 3: Quantize events
      const quantizedResult = await invoke<any>("quantize_events_command", {
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
      });

      // Step 4: Arrange events
      const arrangement = await invoke<any>("arrange_events_command", {
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
      });

      // Store results
      setPipelineResult({
        events: eventResult.events,
        quantized_events: quantizedResult,
        arrangement,
      });

      // Transition to results
      setState("results");
      setCurrentScreen("results");
    } catch (err) {
      console.error("Pipeline failed:", err);
      handleError(err instanceof Error ? err.message : "Pipeline processing failed");
      setState("input");
    }
  };

  // Error handler
  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    setTimeout(() => setError(null), 5000);
  };

  // Cancel recording
  const handleCancelRecording = () => {
    setState("input");
  };

  // Handle theme change
  const handleThemeChange = (theme: Theme | null) => {
    setSelectedTheme(theme);
    if (theme) {
      setPipelineParam("theme", theme.name);
    }
  };

  // Handle grid settings change
  const handleGridChange = (settings: GridSettings) => {
    setGridSettings(settings);
    setPipelineParam("bpm", settings.bpm);
    setPipelineParam("swing", settings.swing_amount);
  };

  // Handle quantize settings change
  const handleQuantizeChange = (settings: QuantizeSettings) => {
    setQuantizeSettings(settings);
    setPipelineParam("quantize", settings.strength);
  };

  // Handle B-emphasis change
  const handleBEmphasisChange = (value: number) => {
    setPipelineParam("bEmphasis", value);
  };

  // Start new recording
  const handleNewRecording = () => {
    setState("input");
    setCurrentScreen("input");
    setPipelineResult(null);
    setAudioData(null);
  };

  // Convert pipeline events to EventDecision format for explainability
  const convertToEventDecisions = (): EventDecision[] => {
    if (!pipelineResult) return [];

    return pipelineResult.events.map((event: any, index: number) => {
      const quantizedEvent = pipelineResult.quantized_events[index] || event;

      return {
        event_id: event.id || `event_${index}`,
        original_timestamp_ms: event.timestamp_ms || event.timestamp * 1000 || 0,
        quantized_timestamp_ms: quantizedEvent.timestamp_ms || quantizedEvent.timestamp * 1000 || 0,
        snap_delta_ms: (quantizedEvent.timestamp_ms || 0) - (event.timestamp_ms || 0),
        class: event.class || event.type || 'BilabialPlosive',
        confidence: event.confidence || 0.85,
        mapped_to: event.mapped_instruments || ['SYNTH'],
        reasoning: event.reasoning || `Classified as ${event.class || event.type} based on audio features. Confidence: ${((event.confidence || 0.85) * 100).toFixed(1)}%.`,
        features: event.features || {
          spectral_centroid: event.spectral_centroid || 0,
          zcr: event.zcr || 0,
          low_band_energy: event.low_band_energy || 0,
          mid_band_energy: event.mid_band_energy || 0,
          high_band_energy: event.high_band_energy || 0,
        },
      };
    });
  };

  // Handle event click on timeline
  const handleEventClick = (eventId: string) => {
    setSelectedEventId(eventId);
  };

  // Handle closing decision card
  const handleCloseDecisionCard = () => {
    setSelectedEventId(null);
  };

  // Get selected event for DecisionCard
  const getSelectedEvent = (): EventDecision | null => {
    if (!selectedEventId) return null;
    const eventDecisions = convertToEventDecisions();
    return eventDecisions.find(e => e.event_id === selectedEventId) || null;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1 className="logo">BEATRICE</h1>
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

      {/* Main Content */}
      <main className="main">
        <AnimatePresence mode="wait">
          {/* INPUT STATE */}
          {state === "input" && (
            <motion.div
              key="input"
              className="input-container"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
            >
              <div className="input-box">
                {/* Record Section */}
                <motion.div
                  className="record-section"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <span className="record-icon">●</span>
                  <h2 style={{ fontSize: "24px", fontWeight: "bold", margin: 0 }}>
                    RECORD YOUR BEATBOX
                  </h2>
                  <motion.button
                    className="btn btn-primary btn-large"
                    onClick={() => setState("recording")}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    START RECORDING
                  </motion.button>
                </motion.div>

                {/* Divider */}
                <motion.div
                  className="divider"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <span>or</span>
                </motion.div>

                {/* Upload Section */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <DropZone
                    onProjectCreated={handleProjectCreated}
                    onError={handleError}
                  />
                </motion.div>

                {/* Demo Button */}
                <motion.div
                  style={{ width: "100%" }}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <DemoButton
                    onProjectCreated={handleProjectCreated}
                    onError={handleError}
                  />
                </motion.div>
              </div>
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
                  events={events}
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
                events={convertToEventDecisions()}
              />

              {/* B-Sound Markers */}
              <BeatMarkers
                events={convertToEventDecisions()}
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
                    events={convertToEventDecisions()}
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

      {/* Decision Card Popup */}
      <DecisionCard
        event={getSelectedEvent()}
        onClose={handleCloseDecisionCard}
      />
    </div>
  );
}

export default App;
