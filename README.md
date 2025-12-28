# Beatrice

**Beatbox-to-Synth Beat Generator**

Transform your beatboxing into synthesized beats with emphasis on B-sounds. Beatrice detects your vocal percussion, classifies it, and generates MIDI/audio output in cinematic synthwave themes.

## Features

- **Audio Input**: Record directly in-app or drag & drop WAV files
- **Event Detection**: Spectral flux onset detection with heuristic classification
- **Sound Classes**: BilabialPlosive (B/P → kicks), HihatNoise (S/TS → hats), Click (T/K → snares), HumVoiced (vowels → pads)
- **Groove Engine**: Tempo estimation, grid quantization, swing control
- **Arrangement Templates**: Synthwave Straight, Halftime, Arp Drive
- **Themes**: Blade Runner and Stranger Things-inspired harmonic systems
- **B-Emphasis Control**: 3-way slider affecting anchor strength, velocity, and sidechain
- **Explainability**: See every AI decision with Timeline, DecisionCard, and ModelInspector
- **Export**: MIDI for DAW import, WAV preview

## Tech Stack

- **Backend**: Rust + Tauri 2.0
- **Frontend**: React + TypeScript + Framer Motion
- **Audio**: hound (WAV), fundsp (DSP), midly (MIDI)
- **3D Visualization**: React Three Fiber + drei
- **State**: SQLite (rusqlite) + Zustand
- **Styling**: Neo-brutalist CSS

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Tauri CLI

### Installation

```bash
# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
beatrice/
├── src/                    # React frontend
│   ├── components/
│   │   ├── AudioInput/     # DropZone, Recorder, Calibration
│   │   ├── Visualization/  # 3D scene, particles, event pillars
│   │   ├── Explainability/ # Timeline, DecisionCard, ModelInspector
│   │   ├── Groove/         # Grid and quantize controls
│   │   └── Theme/          # Theme selector
│   ├── hooks/              # useAudioRecorder, useProjects
│   ├── store/              # Zustand store
│   └── styles/             # Neo-brutalist CSS
├── src-tauri/              # Rust backend
│   └── src/
│       ├── audio/          # WAV ingest, onset detection
│       ├── events/         # Classification, calibration
│       ├── groove/         # Tempo, grid, quantization
│       ├── arranger/       # Templates, drum lanes, MIDI
│       ├── themes/         # Blade Runner, Stranger Things
│       ├── render/         # Synth, effects, mixer
│       ├── pipeline/       # Trace logging
│       └── state/          # SQLite, storage
```

## Usage

1. **Record or Upload**: Click "Start Recording" or drop a WAV file
2. **Processing**: Watch the 3D visualization while Beatrice analyzes your beatbox
3. **Review**: See detected events on the timeline, click for details
4. **Customize**: Select theme, adjust BPM, swing, and B-emphasis
5. **Export**: Download MIDI for your DAW or WAV preview

## License

MIT
