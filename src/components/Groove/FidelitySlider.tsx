import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface FidelitySliderProps {
  value: number; // 0.0 to 1.0
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * FidelitySlider - Controls placement fidelity (spec §4.3)
 *
 * The single "who's driving" control for the arranger:
 *   1.0  FOLLOW ME     — play every hit exactly where the performer put it
 *   0.0  PRODUCE FOR ME — snap off-template hits to the nearest template slot
 *
 * Never deletes events. Mirrors the BEmphasisSlider visual pattern (header,
 * % readout, retro range input, description chips, intensity bars) so it feels
 * native to the rest of the results screen. Changes flow through the same
 * debounced re-arrange path as B-Emphasis via App.tsx.
 */
export function FidelitySlider({ value, onChange, disabled = false }: FidelitySliderProps) {
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

  // Color leans cyan (PRODUCE, machine) → magenta (mid) → green (FOLLOW, human)
  const getColor = (val: number) => {
    if (val < 0.33) return '#00FFFF'; // Cyan - produce / template-driven
    if (val < 0.67) return '#FF00FF'; // Magenta - balanced
    return '#00FF00'; // Green - follow / performer-driven
  };

  const getLabel = (val: number) => {
    if (val < 0.33) return 'PRODUCE FOR ME';
    if (val < 0.67) return 'BALANCED';
    return 'FOLLOW ME';
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
            FIDELITY
          </h4>
          <span
            style={{
              fontSize: '11px',
              color: '#666',
              fontFamily: 'monospace',
            }}
          >
            WHO&apos;S DRIVING THE GROOVE
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
          aria-label="FIDELITY"
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
        {/* Endpoint labels: 0% = PRODUCE FOR ME, 100% = FOLLOW ME */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '6px',
            fontSize: '10px',
            fontWeight: 'bold',
            fontFamily: 'monospace',
            color: '#666',
          }}
        >
          <span>PRODUCE FOR ME</span>
          <span>FOLLOW ME</span>
        </div>
      </div>

      {/* Info cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
          marginTop: '8px',
        }}
      >
        {[
          { icon: '🎛', label: 'PRODUCE', desc: 'Template groove' },
          { icon: '⚡', label: 'FOLLOW', desc: 'Your hits verbatim' },
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
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
          const isActive = i / 10 <= localValue;
          return (
            <motion.div
              key={i}
              animate={{
                backgroundColor: isActive ? color : '#E0E0E0',
                opacity: isActive ? 1 : 0.3,
                scaleY: isActive && isDragging ? [1, 1.4, 1] : 1,
                boxShadow: isActive ? `0 0 10px ${color}66` : 'none',
              }}
              transition={{
                scaleY: { repeat: Infinity, duration: 0.4, delay: i * 0.05 },
                backgroundColor: { duration: 0.2 },
              }}
              style={{
                flex: 1,
                height: '100%',
                border: '1px solid #000',
                borderRadius: '2px',
              }}
            />
          );
        })}
      </div>
    </motion.div>
  );
}
