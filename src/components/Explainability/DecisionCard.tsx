import { motion, AnimatePresence } from 'framer-motion';
import { EventDecision, EVENT_CLASS_NAMES, EVENT_CLASS_COLORS } from '../../types/explainability';
import { useState } from 'react';
import { ModelInspector } from './ModelInspector';

interface DecisionCardProps {
  event: EventDecision | null;
  onClose: () => void;
}

export function DecisionCard({ event, onClose }: DecisionCardProps) {
  const [showModelInspector, setShowModelInspector] = useState(false);

  if (!event) return null;

  const color = EVENT_CLASS_COLORS[event.class];

  // Format time as MM:SS.sss
  const formatTime = (ms: number): string => {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(3);
    return `${minutes.toString().padStart(2, '0')}:${seconds.padStart(6, '0')}`;
  };

  // Format delta with sign
  const formatDelta = (ms: number): string => {
    const sign = ms >= 0 ? '+' : '';
    return `${sign}${ms.toFixed(1)}ms`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            backgroundColor: '#FFFFFF',
            border: '4px solid #000',
            borderRadius: '8px',
            boxShadow: '8px 8px 0 0 #000',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '24px',
              borderBottom: '3px solid #000',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#F8F8F8',
            }}
          >
            <div>
              <h3 style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
              }}>
                EVENT DECISION
              </h3>
              <div style={{
                marginTop: '4px',
                fontSize: '14px',
                color: '#666',
                fontFamily: 'monospace',
              }}>
                ID: {event.event_id.substring(0, 8)}...
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid #000',
                borderRadius: '4px',
                backgroundColor: '#FF0000',
                color: '#FFFFFF',
                fontSize: '20px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '2px 2px 0 0 #000',
              }}
            >
              ×
            </motion.button>
          </div>

          {/* Content */}
          <div style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}>
            {/* Timing Section */}
            <section>
              <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#666',
              }}>
                Timing
              </h4>
              <div style={{
                border: '3px solid #000',
                borderRadius: '4px',
                padding: '16px',
                backgroundColor: '#F8F8F8',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold' }}>Original:</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    {formatTime(event.original_timestamp_ms)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold' }}>Quantized:</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    {formatTime(event.quantized_timestamp_ms)}
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: '8px',
                  borderTop: '2px solid #DDD',
                }}>
                  <span style={{ fontWeight: 'bold' }}>Adjustment:</span>
                  <span style={{
                    fontFamily: 'monospace',
                    fontWeight: 'bold',
                    color: event.snap_delta_ms === 0 ? '#666' : color,
                  }}>
                    {formatDelta(event.snap_delta_ms)}
                  </span>
                </div>
              </div>
            </section>

            {/* Classification Section */}
            <section>
              <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#666',
              }}>
                Classification
              </h4>
              <div style={{
                border: '3px solid #000',
                borderRadius: '4px',
                padding: '16px',
                backgroundColor: color,
                color: '#000',
              }}>
                <div style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  marginBottom: '8px',
                }}>
                  {EVENT_CLASS_NAMES[event.class]}
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{ fontWeight: 'bold' }}>Confidence:</span>
                  <div style={{
                    flex: 1,
                    height: '20px',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    border: '2px solid #000',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${event.confidence * 100}%` }}
                      transition={{ duration: 0.5 }}
                      style={{
                        height: '100%',
                        backgroundColor: '#000',
                      }}
                    />
                  </div>
                  <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {(event.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </section>

            {/* Mapping Section */}
            <section>
              <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#666',
              }}>
                Mapped To
              </h4>
              <div style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
              }}>
                {event.mapped_to.map((instrument) => (
                  <div
                    key={instrument}
                    style={{
                      border: '2px solid #000',
                      borderRadius: '4px',
                      padding: '8px 16px',
                      backgroundColor: '#F0F0F0',
                      fontWeight: 'bold',
                      fontSize: '14px',
                    }}
                  >
                    {instrument}
                  </div>
                ))}
              </div>
            </section>

            {/* Reasoning Section */}
            <section>
              <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                color: '#666',
              }}>
                Decision Reasoning
              </h4>
              <div style={{
                border: '3px solid #000',
                borderRadius: '4px',
                padding: '16px',
                backgroundColor: '#FFF8E1',
                fontSize: '14px',
                lineHeight: '1.6',
              }}>
                {event.reasoning}
              </div>
            </section>

            {/* Model Inspector Toggle */}
            <section>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowModelInspector(!showModelInspector)}
                style={{
                  width: '100%',
                  border: '3px solid #000',
                  borderRadius: '4px',
                  padding: '16px',
                  backgroundColor: showModelInspector ? '#00FF00' : '#FFFFFF',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  boxShadow: '2px 2px 0 0 #000',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Show Me The Model</span>
                <span style={{ fontSize: '20px' }}>
                  {showModelInspector ? '▼' : '▶'}
                </span>
              </motion.button>

              {/* Model Inspector Panel */}
              <AnimatePresence>
                {showModelInspector && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <ModelInspector
                      features={event.features}
                      className={event.class}
                      confidence={event.confidence}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
