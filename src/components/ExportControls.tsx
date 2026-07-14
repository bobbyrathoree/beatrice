import { useState } from 'react';
import { motion } from 'framer-motion';
import { commands, unwrap, formatIpcError } from '../types/ipc';
import type { Arrangement } from '../types/ipc';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { renderArrangementToWav } from '../audio/renderWav';
import { isTauriAvailable } from '../utils/tauri-mock';

interface ExportControlsProps {
  arrangement: Arrangement;
  gridSettings: {
    bpm: number;
    time_signature: string;
    division: string;
    feel: string;
    swing_amount: number;
    bar_count: number;
  };
  themeName: string;
  /** Grid phase offset (ms) from tempo estimation; anchors the exported grid. */
  phaseOffsetMs?: number;
  disabled?: boolean;
}

type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

/**
 * ExportControls - Handles MIDI and WAV export functionality
 *
 * Provides user-friendly buttons to export:
 * - MIDI file (for DAW import)
 * - WAV preview (rendered audio)
 *
 * Files are saved to user's chosen location using Tauri's save dialog.
 */
export function ExportControls({
  arrangement,
  gridSettings,
  themeName,
  phaseOffsetMs = 0,
  disabled = false,
}: ExportControlsProps) {
  const [midiStatus, setMidiStatus] = useState<ExportStatus>('idle');
  const [wavStatus, setWavStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleExportMidi = async () => {
    try {
      setMidiStatus('exporting');
      setError(null);

      // Call backend to generate MIDI bytes
      const midiBytes = unwrap(
        await commands.exportMidiCommand({
          arrangement,
          bpm: gridSettings.bpm,
          time_signature: gridSettings.time_signature,
          division: gridSettings.division,
          feel: gridSettings.feel,
          swing_amount: gridSettings.swing_amount,
          bar_count: gridSettings.bar_count,
          ppq: 480,
          include_tempo: true,
          include_time_signature: true,
          track_names: true,
          phase_offset_ms: phaseOffsetMs,
        })
      );

      // Prompt user for save location
      const filePath = await save({
        defaultPath: `beatrice_${themeName}_${Date.now()}.mid`,
        filters: [{
          name: 'MIDI File',
          extensions: ['mid', 'midi'],
        }],
      });

      if (!filePath) {
        setMidiStatus('idle');
        return;
      }

      // Write file
      await writeFile(filePath, new Uint8Array(midiBytes));

      setMidiStatus('success');
      setTimeout(() => setMidiStatus('idle'), 3000);
    } catch (err) {
      console.error('MIDI export failed:', err);
      setError(formatIpcError(err));
      setMidiStatus('error');
      setTimeout(() => setMidiStatus('idle'), 5000);
    }
  };

  const handleExportWav = async () => {
    try {
      setWavStatus('exporting');
      setError(null);

      // Render audio in the frontend via OfflineAudioContext, using the SAME
      // synthesis code the user hears on PLAY. Length comes from the arrangement
      // itself (song structure is baked into total_duration_ms), not a bar/bpm guess.
      const wavBytes = await renderArrangementToWav(arrangement);

      if (isTauriAvailable()) {
        // Native: prompt for a save location and write the file to disk.
        const filePath = await save({
          defaultPath: `beatrice_${themeName}_${Date.now()}.wav`,
          filters: [{
            name: 'WAV Audio',
            extensions: ['wav'],
          }],
        });

        if (!filePath) {
          setWavStatus('idle');
          return;
        }

        await writeFile(filePath, wavBytes);
      } else {
        // Browser/demo: trigger a Blob download.
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(blob),
          download: `beatrice_${themeName}.wav`,
        });
        a.click();
        URL.revokeObjectURL(a.href);
      }

      setWavStatus('success');
      setTimeout(() => setWavStatus('idle'), 3000);
    } catch (err) {
      console.error('WAV export failed:', err);
      setError(formatIpcError(err));
      setWavStatus('error');
      setTimeout(() => setWavStatus('idle'), 5000);
    }
  };

  const getButtonState = (status: ExportStatus) => {
    switch (status) {
      case 'exporting':
        return { text: 'EXPORTING...', disabled: true, color: '#FFFF00' };
      case 'success':
        return { text: 'EXPORTED!', disabled: true, color: '#00FF00' };
      case 'error':
        return { text: 'FAILED', disabled: true, color: '#FF0000' };
      default:
        return { text: '', disabled: false, color: '#FFFFFF' };
    }
  };

  const midiState = getButtonState(midiStatus);
  const wavState = getButtonState(wavStatus);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* Error notification */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            padding: '12px 16px',
            backgroundColor: '#FF0000',
            color: '#FFFFFF',
            border: '3px solid #000',
            borderRadius: '4px',
            fontWeight: 'bold',
            fontSize: '14px',
            fontFamily: 'monospace',
          }}
        >
          {error}
        </motion.div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        {/* MIDI Export Button */}
        <motion.button
          className="btn btn-secondary"
          onClick={handleExportMidi}
          disabled={disabled || midiState.disabled}
          whileHover={!disabled && !midiState.disabled ? { scale: 1.02, y: -2 } : {}}
          whileTap={!disabled && !midiState.disabled ? { scale: 0.98 } : {}}
          style={{
            flex: 1,
            minWidth: '200px',
            backgroundColor: midiStatus !== 'idle' ? midiState.color : undefined,
            color: midiStatus === 'success' || midiStatus === 'exporting' ? '#000' : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {midiStatus === 'exporting' && (
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              ⚙️
            </motion.span>
          )}
          {midiStatus === 'success' && '✓'}
          {midiStatus === 'error' && '✗'}
          {midiStatus === 'idle' ? '📥 EXPORT MIDI' : midiState.text}
        </motion.button>

        {/* WAV Export Button */}
        <motion.button
          className="btn btn-secondary"
          onClick={handleExportWav}
          disabled={disabled || wavState.disabled}
          whileHover={!disabled && !wavState.disabled ? { scale: 1.02, y: -2 } : {}}
          whileTap={!disabled && !wavState.disabled ? { scale: 0.98 } : {}}
          style={{
            flex: 1,
            minWidth: '200px',
            backgroundColor: wavStatus !== 'idle' ? wavState.color : undefined,
            color: wavStatus === 'success' || wavStatus === 'exporting' ? '#000' : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {wavStatus === 'exporting' && (
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              ⚙️
            </motion.span>
          )}
          {wavStatus === 'success' && '✓'}
          {wavStatus === 'error' && '✗'}
          {wavStatus === 'idle' ? '🎵 EXPORT WAV' : wavState.text}
        </motion.button>
      </div>

      {/* Export info */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        style={{
          border: '2px dashed #000',
          borderRadius: '4px',
          padding: '12px',
          backgroundColor: '#F5F5F5',
          fontSize: '12px',
          fontFamily: 'monospace',
          color: '#666',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>EXPORT INFO</div>
        <div>• MIDI: Import into any DAW (Ableton, FL Studio, Logic, etc.)</div>
        <div>• WAV: Preview audio with current theme and settings</div>
        <div>• Files include tempo, time signature, and track names</div>
      </motion.div>
    </motion.div>
  );
}
