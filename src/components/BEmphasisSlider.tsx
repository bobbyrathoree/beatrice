import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface BEmphasisSliderProps {
  value: number; // 0.0 to 1.0
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * BEmphasisSlider - Controls three aspects of B-sound emphasis
 *
 * This slider controls:
 * 1. How strongly BA hits become downbeat anchors (arrangement)
 * 2. Synth note velocity/brightness (rendering)
 * 3. Sidechain intensity/ducking amount (mixing)
 *
 * The unified control provides intuitive, immediate feedback across
 * all three dimensions of the B-emphasis feature.
 */
export function BEmphasisSlider({ value, onChange, disabled = false }: BEmphasisSliderProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setLocalValue(newValue);
    onChange(newValue);
  };

  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);

  const percentage = Math.round(localValue * 100);

  // Get color based on intensity
  const getColor = (val: number) => {
    if (val < 0.33) return '#00FF00'; // Green - subtle
    if (val < 0.67) return '#FF00FF'; // Magenta - moderate
    return '#FF0000'; // Red - intense
  };

  const getLabel = (val: number) => {
    if (val < 0.33) return 'SUBTLE';
    if (val < 0.67) return 'MODERATE';
    return 'INTENSE';
  };

  const color = getColor(localValue);
  const label = getLabel(localValue);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        border: '4px solid #000',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h4
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              fontFamily: 'monospace',
            }}
          >
            B-EMPHASIS
          </h4>
          <span
            style={{
              fontSize: '11px',
              color: '#666',
              fontFamily: 'monospace',
            }}
          >
            ANCHOR • VELOCITY • SIDECHAIN
          </span>
        </div>

        <motion.div
          animate={{
            scale: isDragging ? 1.1 : 1,
            color: color,
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '4px',
          }}
        >
          <span
            style={{
              fontSize: '28px',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              lineHeight: 1,
            }}
          >
            {percentage}%
          </span>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              color: color,
            }}
          >
            {label}
          </span>
        </motion.div>
      </div>

      {/* Slider */}
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={localValue}
          onChange={handleChange}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          disabled={disabled}
          style={{
            width: '100%',
            height: '12px',
            borderRadius: '6px',
            border: '3px solid #000',
            background: `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, #E0E0E0 ${percentage}%, #E0E0E0 100%)`,
            outline: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            WebkitAppearance: 'none',
            appearance: 'none',
          }}
        />
      </div>

      {/* Info cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          marginTop: '8px',
        }}
      >
        {[
          { icon: '⚓', label: 'ANCHOR', desc: 'Downbeat pull' },
          { icon: '💥', label: 'VELOCITY', desc: 'Note power' },
          { icon: '🎚️', label: 'SIDECHAIN', desc: 'Duck amount' },
        ].map((item, idx) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            style={{
              border: '2px solid #000',
              borderRadius: '4px',
              padding: '8px',
              backgroundColor: '#F5F5F5',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '20px' }}>{item.icon}</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 'bold',
                fontFamily: 'monospace',
                textAlign: 'center',
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                fontSize: '9px',
                color: '#666',
                textAlign: 'center',
                fontFamily: 'monospace',
              }}
            >
              {item.desc}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Visual intensity indicator */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          height: '8px',
          marginTop: '4px',
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <motion.div
            key={i}
            animate={{
              backgroundColor: i / 10 <= localValue ? color : '#E0E0E0',
              opacity: i / 10 <= localValue ? 1 : 0.3,
            }}
            style={{
              flex: 1,
              height: '100%',
              border: '1px solid #000',
              borderRadius: '2px',
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
