import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

// Theme type definitions matching Rust types
export interface ThemeSummary {
  name: string;
  description: string;
  bpm_range: [number, number];
  root_note: number;
  scale_family: string;
}

export interface Theme {
  name: string;
  bpm_range: [number, number];
  root_note: number;
  scale_family: string;
  chord_progression: {
    chords: string[];
    bars_per_chord: number;
  };
  bass_pattern: string;
  arp_pattern: string;
  arp_octave_range: [number, number];
  drum_palette: string;
  fx_profile: string;
  synth_stab_velocity: number;
  pad_sustain: boolean;
}

interface ThemeSelectorProps {
  onThemeChange: (theme: Theme | null) => void;
  disabled?: boolean;
}

export function ThemeSelector({ onThemeChange, disabled = false }: ThemeSelectorProps) {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load themes on mount
  useEffect(() => {
    loadThemes();
  }, []);

  const loadThemes = async () => {
    try {
      setLoading(true);
      setError(null);
      const themesData = await invoke<ThemeSummary[]>('list_themes');
      setThemes(themesData);
    } catch (err) {
      console.error('Failed to load themes:', err);
      setError('Failed to load themes');
    } finally {
      setLoading(false);
    }
  };

  const selectTheme = async (themeName: string) => {
    try {
      // If clicking the same theme, deselect
      if (selectedTheme === themeName) {
        setSelectedTheme(null);
        onThemeChange(null);
        return;
      }

      const theme = await invoke<Theme | null>('get_theme', { name: themeName });
      if (theme) {
        setSelectedTheme(themeName);
        onThemeChange(theme);
      }
    } catch (err) {
      console.error('Failed to load theme:', err);
      setError(`Failed to load theme: ${themeName}`);
    }
  };

  // Get note name from MIDI number
  const getNoteName = (midiNote: number): string => {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return noteNames[midiNote % 12];
  };

  // Get theme card color based on theme name
  const getThemeColor = (themeName: string): string => {
    switch (themeName.toUpperCase()) {
      case 'BLADE RUNNER':
        return '#FF00FF'; // Magenta for Blade Runner
      case 'STRANGER THINGS':
        return '#00FF00'; // Green for Stranger Things
      default:
        return '#00FFFF'; // Cyan for other themes
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          border: '4px solid #000',
          borderRadius: '8px',
          padding: '24px',
          backgroundColor: '#FFFFFF',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>LOADING THEMES...</div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          border: '4px solid #000',
          borderRadius: '8px',
          padding: '24px',
          backgroundColor: '#FF0000',
          color: '#FFFFFF',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{error}</div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={loadThemes}
          style={{
            marginTop: '16px',
            border: '3px solid #000',
            borderRadius: '4px',
            padding: '12px 24px',
            backgroundColor: '#FFFFFF',
            color: '#000',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '2px 2px 0 0 #000',
          }}
        >
          RETRY
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        border: '4px solid #000',
        borderRadius: '8px',
        padding: '24px',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', textTransform: 'uppercase' }}>
        THEME
      </h3>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px',
        }}
      >
        {themes.map((theme) => {
          const isSelected = selectedTheme === theme.name;
          const themeColor = getThemeColor(theme.name);

          return (
            <motion.button
              key={theme.name}
              whileHover={disabled ? {} : { scale: 1.02, y: -4 }}
              whileTap={disabled ? {} : { scale: 0.98 }}
              onClick={() => !disabled && selectTheme(theme.name)}
              disabled={disabled}
              style={{
                border: '4px solid #000',
                borderRadius: '8px',
                padding: '20px',
                backgroundColor: isSelected ? themeColor : '#FFFFFF',
                color: isSelected ? '#FFFFFF' : '#000',
                textAlign: 'left',
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: isSelected ? '4px 4px 0 0 #000' : '2px 2px 0 0 #000',
                opacity: disabled ? 0.5 : 1,
                transition: 'background-color 0.2s, color 0.2s',
                position: 'relative',
              }}
            >
              {/* Active indicator */}
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: '#FFFFFF',
                    border: '3px solid #000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                >
                  ✓
                </motion.div>
              )}

              {/* Theme name */}
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {theme.name}
              </div>

              {/* Description */}
              <div
                style={{
                  fontSize: '14px',
                  lineHeight: '1.4',
                  opacity: isSelected ? 1 : 0.8,
                }}
              >
                {theme.description}
              </div>

              {/* Theme details */}
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  marginTop: '4px',
                }}
              >
                {/* BPM Range */}
                <div
                  style={{
                    border: isSelected ? '2px solid #FFFFFF' : '2px solid #000',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)',
                  }}
                >
                  {theme.bpm_range[0]}-{theme.bpm_range[1]} BPM
                </div>

                {/* Root Note */}
                <div
                  style={{
                    border: isSelected ? '2px solid #FFFFFF' : '2px solid #000',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)',
                  }}
                >
                  {getNoteName(theme.root_note)} {theme.scale_family.replace(/([A-Z])/g, ' $1').trim()}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Selected theme info */}
      {selectedTheme && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{
            border: '3px solid #000',
            borderRadius: '4px',
            padding: '16px',
            backgroundColor: '#F0F0F0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: getThemeColor(selectedTheme),
              border: '2px solid #000',
            }}
          />
          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
            ACTIVE THEME: {selectedTheme}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
