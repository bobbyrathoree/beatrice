// PlaybackControls - Brutalist-styled playback control bar
//
// Provides PLAY/STOP toggle, time display, and progress bar for
// in-app audio playback of synthesized arrangements.

import { motion } from 'framer-motion';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;  // seconds
  duration: number;     // seconds
  onPlay: () => void;
  onStop: () => void;
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
}: PlaybackControlsProps) {
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <motion.div
      className="playback-controls"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Top row: button + time */}
      <div className="playback-row">
        <motion.button
          className={`btn playback-btn ${isPlaying ? 'btn-stop' : 'btn-primary'}`}
          onClick={isPlaying ? onStop : onPlay}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.96 }}
        >
          {isPlaying ? '■ STOP' : '▶ PLAY'}
        </motion.button>

        <div className="playback-time">
          <span className="playback-time-current">{formatTime(currentTime)}</span>
          <span className="playback-time-separator">/</span>
          <span className="playback-time-total">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="playback-progress-track">
        <motion.div
          className="playback-progress-fill"
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.1, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
