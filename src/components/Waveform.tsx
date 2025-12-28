import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { EventDecision } from '../types/explainability';

interface WaveformProps {
  audioData?: Uint8Array | Float32Array;
  duration: number; // Duration in milliseconds
  events: EventDecision[];
}

/**
 * Waveform - Display audio waveform with B-sound markers
 *
 * Renders the audio waveform using canvas with vertical markers
 * at detected B-sound (BilabialPlosive) positions.
 */
export function Waveform({ audioData, duration, events }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter for B-sound events only
  const bEvents = events.filter(e => e.class === 'BilabialPlosive');

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size based on container
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw background
    ctx.fillStyle = '#F8F8F8';
    ctx.fillRect(0, 0, width, height);

    // Draw waveform
    if (audioData && audioData.length > 0) {
      const samples = audioData;
      const step = Math.max(1, Math.floor(samples.length / width));

      ctx.beginPath();
      ctx.moveTo(0, height / 2);

      for (let i = 0; i < width; i++) {
        const sampleIndex = Math.floor(i * step);
        const sample = samples[sampleIndex] ?? 0;
        // Normalize sample value
        const normalizedSample = typeof sample === 'number' ?
          (sample > 1 ? sample / 255 : sample) : 0;
        const y = height / 2 - (normalizedSample * height * 0.4);
        ctx.lineTo(i, y);
      }

      // Complete the waveform shape
      for (let i = width - 1; i >= 0; i--) {
        const sampleIndex = Math.floor(i * step);
        const sample = samples[sampleIndex] ?? 0;
        const normalizedSample = typeof sample === 'number' ?
          (sample > 1 ? sample / 255 : sample) : 0;
        const y = height / 2 + (normalizedSample * height * 0.4);
        ctx.lineTo(i, y);
      }

      ctx.closePath();

      // Create gradient fill
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#0066FF');
      gradient.addColorStop(0.5, '#FF00FF');
      gradient.addColorStop(1, '#00FF00');
      ctx.fillStyle = gradient;
      ctx.fill();
    } else {
      // Draw placeholder waveform pattern when no audio data
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#0066FF');
      gradient.addColorStop(0.5, '#FF00FF');
      gradient.addColorStop(1, '#00FF00');

      ctx.beginPath();
      for (let i = 0; i < width; i++) {
        const amplitude = Math.sin(i * 0.05) * Math.sin(i * 0.02) * 0.5 + 0.5;
        const y1 = height / 2 - (amplitude * height * 0.35);
        const y2 = height / 2 + (amplitude * height * 0.35);
        ctx.moveTo(i, y1);
        ctx.lineTo(i, y2);
      }
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw B-sound markers
    ctx.strokeStyle = '#FF00FF';
    ctx.lineWidth = 2;

    bEvents.forEach(event => {
      const x = (event.quantized_timestamp_ms / duration) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Add glow effect
      ctx.shadowColor = '#FF00FF';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }, [audioData, duration, bEvents]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        // Trigger re-render by dispatching a custom event or using state
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <motion.div
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      style={{
        border: '4px solid #000',
        borderRadius: '8px',
        boxShadow: '4px 4px 0 0 #000',
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        transformOrigin: 'left',
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          height: '120px',
          width: '100%',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
          }}
        />
      </div>

      {/* Info bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderTop: '2px solid #000',
          backgroundColor: '#F0F0F0',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: '#FF00FF' }}>
          {bEvents.length} B-SOUNDS DETECTED
        </span>
        <span>
          {(duration / 1000).toFixed(2)}s
        </span>
      </motion.div>
    </motion.div>
  );
}
