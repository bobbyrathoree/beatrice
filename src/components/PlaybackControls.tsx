import { motion } from 'framer-motion';
import { type Theme } from './Theme/ThemeSelector';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;  // seconds
  duration: number;     // seconds
  onPlay: () => void;
  onStop: () => void;
  theme: Theme | null;
}

interface SectionInfo {
  name: string;
  color: string;
  chord?: string;
  lanes: string[];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Map a Roman-numeral scale degree (theme chord progression) to a concrete chord
// label, given the theme's root MIDI note. Covers the degrees used by the shipped
// themes; unknown degrees fall back to the bare root note name.
const CHORD_LABELS: Record<string, (root: number) => string> = {
  Im: (r) => NOTE_NAMES[r % 12] + "m",
  III: (r) => NOTE_NAMES[(r + 3) % 12],
  VI: (r) => NOTE_NAMES[(r + 8) % 12],
  VII: (r) => NOTE_NAMES[(r + 10) % 12],
  IV: (r) => NOTE_NAMES[(r + 5) % 12] + "m",
  V: (r) => NOTE_NAMES[(r + 7) % 12] + "m",
};

/** Resolve the chord label active at a given bar for a theme, "" if no theme. */
function chordLabelAtBar(theme: Theme | null, bar: number): string {
  if (!theme) return '';
  const { chords, bars_per_chord } = theme.chord_progression;
  if (!chords.length) return '';
  const degree = chords[Math.floor(bar / Math.max(1, bars_per_chord)) % chords.length];
  const label = CHORD_LABELS[degree];
  return label ? label(theme.root_note) : NOTE_NAMES[theme.root_note % 12];
}

/** Format seconds as "MM:SS.d" */
function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const whole = Math.floor(secs);
  const tenths = Math.floor((secs - whole) * 10);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

export function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  onPlay,
  onStop,
  theme,
}: PlaybackControlsProps) {
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  // Arrangement HUD Logic
  const getSectionInfo = (): SectionInfo => {
    if (!isPlaying || duration === 0) return { name: 'READY', color: '#666', lanes: [] };

    const loopIdx = Math.floor((currentTime / duration) * 4);
    const loopDuration = duration / 4;
    const timeInLoop = currentTime % loopDuration;

    // Determine the active chord from the theme's progression.
    // Each loop covers 4 bars for HUD purposes.
    const msPerBar = (loopDuration * 1000) / 4;
    const bar = msPerBar > 0 ? Math.floor((timeInLoop * 1000) / msPerBar) : 0;
    const chordName = chordLabelAtBar(theme, bar);

    switch (loopIdx) {
      case 0: return { name: 'INTRO', color: '#00FFFF', chord: '', lanes: ['KICK', 'HIHAT'] };
      case 1: return { name: 'BUILD', color: '#00FF00', chord: chordName, lanes: ['KICK', 'HIHAT', 'SNARE', 'BASS'] };
      case 2: return { name: 'DROP', color: '#FF00FF', chord: chordName, lanes: ['KICK', 'HIHAT', 'SNARE', 'BASS', 'PAD', 'ARP'] };
      case 3: return { name: 'OUTRO', color: '#FF0000', chord: chordName, lanes: ['BASS'] };
      default: return { name: 'DONE', color: '#666', lanes: [] };
    }
  };

  const section = getSectionInfo();

  return (
    <motion.div
      className="playback-controls"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        backgroundColor: '#FFF',
        border: '4px solid #000',
        borderRadius: '8px',
        padding: '16px',
        boxShadow: '4px 4px 0 0 #000',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Play Button */}
        <motion.button
          onClick={isPlaying ? onStop : onPlay}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          style={{
            padding: '12px 24px',
            backgroundColor: isPlaying ? '#FF0000' : '#000',
            color: '#FFF',
            border: '3px solid #000',
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '16px',
            cursor: 'pointer',
            minWidth: '120px',
            boxShadow: '3px 3px 0 0 #000',
          }}
        >
          {isPlaying ? '■ STOP' : '▶ PLAY'}
        </motion.button>

        {/* Time Display */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontWeight: 'bold' }}>
            <span>{formatTime(currentTime)}</span>
            <span style={{ color: '#666' }}>{formatTime(duration)}</span>
          </div>
          <div style={{ height: '12px', backgroundColor: '#EEE', border: '2px solid #000', borderRadius: '6px', overflow: 'hidden' }}>
            <motion.div 
              animate={{ width: `${progress * 100}%` }}
              transition={{ ease: 'linear', duration: 0.1 }}
              style={{ height: '100%', backgroundColor: '#000' }}
            />
          </div>
        </div>

        {/* HUD Section */}
        <div style={{ 
          minWidth: '180px', 
          border: '3px solid #000', 
          borderRadius: '4px', 
          padding: '8px', 
          backgroundColor: '#000',
          color: '#FFF',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px'
        }}>
          <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#666' }}>SONG MODE HUD</div>
          <div style={{ 
            fontSize: '18px', 
            fontWeight: 'bold', 
            color: section.color,
            textShadow: `0 0 8px ${section.color}44`
          }}>
            {section.name} {section.chord && `• ${section.chord}`}
          </div>
          <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
            {['K', 'H', 'S', 'B', 'P', 'A'].map((l, i) => {
              const fullNames = ['KICK', 'HIHAT', 'SNARE', 'BASS', 'PAD', 'ARP'];
              const isActive = section.lanes.includes(fullNames[i]);
              return (
                <div key={l} style={{ 
                  width: '14px', 
                  height: '14px', 
                  border: '1px solid #FFF',
                  borderRadius: '2px',
                  fontSize: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isActive ? section.color : 'transparent',
                  color: isActive ? '#000' : '#FFF',
                  fontWeight: 'bold',
                  opacity: isActive ? 1 : 0.2
                }}>
                  {l}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
