import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

export interface GridSettings {
  bpm: number;
  time_signature: 'four_four' | 'three_four';
  division: 'quarter' | 'eighth' | 'sixteenth' | 'triplet';
  feel: 'straight' | 'swing' | 'halftime';
  swing_amount: number;
  bar_count: number;
}

export interface QuantizeSettings {
  strength: number;
  swing_amount: number;
  lookahead_ms: number;
}

interface GrooveControlsProps {
  // `audioData` is accepted for API compatibility with App.tsx but no longer used
  // here: automatic tempo estimation was removed (the previous `estimate_tempo`
  // invoke passed `audio_data` while the backend expects a `file_path`). Task 6
  // restores honest tempo estimation. BPM is driven by the manual control below.
  audioData?: Uint8Array;
  onGridChange: (settings: GridSettings) => void;
  onQuantizeChange: (settings: QuantizeSettings) => void;
}

export function GrooveControls({
  onGridChange,
  onQuantizeChange,
}: GrooveControlsProps) {
  // Tempo state
  const [manualBpm, setManualBpm] = useState<number>(120);
  const [useManualBpm, setUseManualBpm] = useState(false);

  // Grid settings
  const [timeSignature, setTimeSignature] = useState<'four_four' | 'three_four'>('four_four');
  const [division, setDivision] = useState<'quarter' | 'eighth' | 'sixteenth' | 'triplet'>('sixteenth');
  const [feel, setFeel] = useState<'straight' | 'swing' | 'halftime'>('straight');
  const [swingAmount, setSwingAmount] = useState<number>(0);
  const [barCount, setBarCount] = useState<number>(4);

  // Quantize settings
  const [quantizeStrength, setQuantizeStrength] = useState<number>(0.8);

  const currentBpm = useManualBpm ? manualBpm : 120;

  // Update grid settings
  useEffect(() => {
    onGridChange({
      bpm: currentBpm,
      time_signature: timeSignature,
      division,
      feel,
      swing_amount: swingAmount / 100,
      bar_count: barCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useManualBpm, manualBpm, timeSignature, division, feel, swingAmount, barCount]);

  // Update quantize settings
  useEffect(() => {
    onQuantizeChange({
      strength: quantizeStrength,
      swing_amount: swingAmount / 100,
      lookahead_ms: 100,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantizeStrength, swingAmount]);

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
        gap: '24px',
      }}
    >
      {/* Tempo Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', textTransform: 'uppercase' }}>
          TEMPO
        </h3>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* BPM Display */}
          <div
            style={{
              border: '3px solid #000',
              borderRadius: '4px',
              padding: '12px 24px',
              backgroundColor: '#00FF00',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '120px',
            }}
          >
            <div style={{ fontSize: '32px', fontWeight: 'bold', lineHeight: 1 }}>
              {Math.round(currentBpm)}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>BPM</div>
          </div>

          {/* Manual Override Toggle */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setUseManualBpm(!useManualBpm)}
            style={{
              border: '3px solid #000',
              borderRadius: '4px',
              padding: '12px 20px',
              backgroundColor: useManualBpm ? '#FF00FF' : '#FFFFFF',
              color: useManualBpm ? '#FFFFFF' : '#000',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '2px 2px 0 0 #000',
            }}
          >
            {useManualBpm ? 'MANUAL' : 'AUTO'}
          </motion.button>
        </div>

        {/* Manual BPM Input */}
        {useManualBpm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>MANUAL BPM</label>
            <input
              type="number"
              min="40"
              max="240"
              value={manualBpm}
              onChange={(e) => setManualBpm(Number(e.target.value))}
              style={{
                border: '3px solid #000',
                borderRadius: '4px',
                padding: '8px 12px',
                fontSize: '18px',
                fontWeight: 'bold',
                width: '120px',
              }}
            />
          </motion.div>
        )}
      </div>

      {/* Grid Settings Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', textTransform: 'uppercase' }}>
          GRID
        </h3>

        {/* Time Signature */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>TIME SIGNATURE</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['four_four', 'three_four'] as const).map((sig) => (
              <motion.button
                key={sig}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setTimeSignature(sig)}
                style={{
                  border: '3px solid #000',
                  borderRadius: '4px',
                  padding: '12px 20px',
                  backgroundColor: timeSignature === sig ? '#00FFFF' : '#FFFFFF',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: timeSignature === sig ? '2px 2px 0 0 #000' : 'none',
                }}
              >
                {sig === 'four_four' ? '4/4' : '3/4'}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Division */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>DIVISION</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {([
              { value: 'quarter', label: '1/4' },
              { value: 'eighth', label: '1/8' },
              { value: 'sixteenth', label: '1/16' },
              { value: 'triplet', label: '3' },
            ] as const).map((div) => (
              <motion.button
                key={div.value}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setDivision(div.value)}
                style={{
                  border: '3px solid #000',
                  borderRadius: '4px',
                  padding: '12px 16px',
                  backgroundColor: division === div.value ? '#00FFFF' : '#FFFFFF',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: division === div.value ? '2px 2px 0 0 #000' : 'none',
                }}
              >
                {div.label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Feel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>FEEL</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(['straight', 'swing', 'halftime'] as const).map((f) => (
              <motion.button
                key={f}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setFeel(f)}
                style={{
                  border: '3px solid #000',
                  borderRadius: '4px',
                  padding: '12px 16px',
                  backgroundColor: feel === f ? '#00FFFF' : '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  boxShadow: feel === f ? '2px 2px 0 0 #000' : 'none',
                }}
              >
                {f}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Bar Count */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>BARS</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[4, 8, 16].map((bars) => (
              <motion.button
                key={bars}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setBarCount(bars)}
                style={{
                  border: '3px solid #000',
                  borderRadius: '4px',
                  padding: '12px 20px',
                  backgroundColor: barCount === bars ? '#00FFFF' : '#FFFFFF',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  boxShadow: barCount === bars ? '2px 2px 0 0 #000' : 'none',
                }}
              >
                {bars}
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Quantize & Swing Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', textTransform: 'uppercase' }}>
          QUANTIZE
        </h3>

        {/* Swing Amount */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>SWING</label>
            <span style={{ fontSize: '18px', fontWeight: 'bold' }}>{swingAmount}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={swingAmount}
            onChange={(e) => setSwingAmount(Number(e.target.value))}
            style={{
              width: '100%',
              height: '8px',
              borderRadius: '4px',
              border: '2px solid #000',
              background: `linear-gradient(to right, #FF00FF 0%, #FF00FF ${swingAmount}%, #E0E0E0 ${swingAmount}%, #E0E0E0 100%)`,
              outline: 'none',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Quantize Strength */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>STRENGTH</label>
            <span style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {Math.round(quantizeStrength * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={quantizeStrength * 100}
            onChange={(e) => setQuantizeStrength(Number(e.target.value) / 100)}
            style={{
              width: '100%',
              height: '8px',
              borderRadius: '4px',
              border: '2px solid #000',
              background: `linear-gradient(to right, #00FF00 0%, #00FF00 ${quantizeStrength * 100}%, #E0E0E0 ${quantizeStrength * 100}%, #E0E0E0 100%)`,
              outline: 'none',
              cursor: 'pointer',
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}
