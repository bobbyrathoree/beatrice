import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { EventDecision } from '../types/explainability';

interface BeatMarkersProps {
  events: EventDecision[];
  duration: number;
  onMarkerClick: (event: EventDecision) => void;
}

export function BeatMarkers({ events, duration, onMarkerClick }: BeatMarkersProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const bEvents = events.filter(e => e.class === 'BilabialPlosive');

  const formatTime = (ms: number): string => {
    return (ms / 1000).toFixed(2) + 's';
  };

  if (bEvents.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          border: '4px solid #000',
          borderRadius: '8px',
          padding: '24px',
          backgroundColor: '#F8F8F8',
          boxShadow: '4px 4px 0 0 #000',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontWeight: 'bold',
          color: '#666',
        }}
      >
        NO B-SOUNDS DETECTED
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
        padding: '16px 24px',
        backgroundColor: '#FFFFFF',
        boxShadow: '4px 4px 0 0 #000',
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
          color: '#FF00FF',
        }}>
          B-SOUNDS
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: 'bold',
          color: '#666',
        }}>
          {bEvents.length} DETECTED
        </span>
      </div>

      <div style={{
        position: 'relative',
        height: '80px',
        marginBottom: '8px',
      }}>
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '0',
          right: '0',
          height: '4px',
          backgroundColor: '#000',
          transform: 'translateY(-50%)',
          borderRadius: '2px',
        }} />

        {bEvents.map((event, index) => {
          const position = (event.quantized_timestamp_ms / duration) * 100;
          const isHovered = hoveredId === event.event_id;

          return (
            <motion.div
              key={event.event_id}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 20,
                delay: index * 0.08,
              }}
              whileHover={{ scale: 1.3 }}
              whileTap={{ scale: 0.95 }}
              onMouseEnter={() => setHoveredId(event.event_id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onMarkerClick(event)}
              style={{
                position: 'absolute',
                left: position + '%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '32px',
                height: '32px',
                backgroundColor: '#FF00FF',
                border: '3px solid #000',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: isHovered ? '0 4px 12px rgba(255, 0, 255, 0.5)' : '2px 2px 0 0 #000',
                zIndex: isHovered ? 10 : 1,
              }}
            >
              <span style={{
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#000',
                userSelect: 'none',
              }}>
                B
              </span>

              <div style={{
                position: 'absolute',
                width: (32 + (event.confidence * 16)) + 'px',
                height: (32 + (event.confidence * 16)) + 'px',
                border: '2px solid rgba(255, 0, 255, 0.3)',
                borderRadius: '50%',
                pointerEvents: 'none',
              }} />

              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    style={{
                      position: 'absolute',
                      bottom: '-32px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      padding: '4px 8px',
                      backgroundColor: '#000',
                      color: '#FFF',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatTime(event.quantized_timestamp_ms)}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: '#666',
      }}>
        <span>0.00s</span>
        <span>{formatTime(duration)}</span>
      </div>
    </motion.div>
  );
}
