import { motion } from 'framer-motion';
import { EventDecision, EVENT_CLASS_COLORS } from '../../types/explainability';

interface TimelineProps {
  events: EventDecision[];
  onEventClick: (eventId: string) => void;
  maxDuration?: number; // Duration in ms for timeline width
}

export function Timeline({ events, onEventClick, maxDuration }: TimelineProps) {
  // Calculate max duration if not provided
  const duration = maxDuration || Math.max(...events.map(e => e.quantized_timestamp_ms), 1000);

  // Format time as MM:SS.sss
  const formatTime = (ms: number): string => {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(2);
    return `${minutes.toString().padStart(2, '0')}:${seconds.padStart(5, '0')}`;
  };

  // Generate time markers (every 1 second)
  const timeMarkers = [];
  const markerInterval = 1000; // 1 second
  for (let i = 0; i <= duration; i += markerInterval) {
    timeMarkers.push(i);
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
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '20px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
        }}>
          EVENT TIMELINE
        </h3>
        <div style={{
          fontSize: '14px',
          fontWeight: 'bold',
          padding: '6px 12px',
          border: '2px solid #000',
          borderRadius: '4px',
          backgroundColor: '#F0F0F0',
        }}>
          {events.length} EVENTS
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        fontSize: '12px',
        fontWeight: 'bold',
      }}>
        {Object.entries(EVENT_CLASS_COLORS).map(([className, color]) => (
          <div key={className} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              backgroundColor: color,
              border: '2px solid #000',
              borderRadius: '2px',
            }} />
            <span>{className.replace(/([A-Z])/g, ' $1').trim()}</span>
          </div>
        ))}
      </div>

      {/* Timeline Container */}
      <div style={{
        position: 'relative',
        width: '100%',
        minHeight: '120px',
        border: '3px solid #000',
        borderRadius: '4px',
        backgroundColor: '#F8F8F8',
        padding: '20px 16px',
      }}>
        {/* Timeline Bar */}
        <div style={{
          position: 'relative',
          height: '40px',
          backgroundColor: '#000',
          borderRadius: '2px',
        }}>
          {/* Event Markers */}
          {events.map((event, index) => {
            const position = (event.quantized_timestamp_ms / duration) * 100;
            const color = EVENT_CLASS_COLORS[event.class];
            const size = 8 + (event.confidence * 16); // Size based on confidence (8-24px)
            const opacity = 0.3 + (event.confidence * 0.7); // Opacity based on confidence (0.3-1.0)

            return (
              <motion.div
                key={event.event_id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: index * 0.02 }}
                whileHover={{
                  scale: 1.5,
                  zIndex: 10,
                }}
                onClick={() => onEventClick(event.event_id)}
                style={{
                  position: 'absolute',
                  left: `${position}%`,
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: color,
                  border: '2px solid #000',
                  borderRadius: '50%',
                  opacity,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                }}
              >
                {/* Quantization adjustment arrow */}
                {Math.abs(event.snap_delta_ms) > 10 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: event.snap_delta_ms > 0 ? 'auto' : '50%',
                      right: event.snap_delta_ms > 0 ? '50%' : 'auto',
                      transform: 'translateY(-50%)',
                      width: `${Math.abs((event.snap_delta_ms / duration) * 100) * 10}px`,
                      height: '2px',
                      backgroundColor: color,
                      pointerEvents: 'none',
                    }}
                  >
                    {/* Arrow head */}
                    <div style={{
                      position: 'absolute',
                      right: event.snap_delta_ms > 0 ? 0 : 'auto',
                      left: event.snap_delta_ms > 0 ? 'auto' : 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 0,
                      height: 0,
                      borderTop: '3px solid transparent',
                      borderBottom: '3px solid transparent',
                      borderLeft: event.snap_delta_ms > 0 ? 'none' : `4px solid ${color}`,
                      borderRight: event.snap_delta_ms > 0 ? `4px solid ${color}` : 'none',
                    }} />
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Time Labels */}
        <div style={{
          position: 'relative',
          marginTop: '12px',
          height: '20px',
        }}>
          {timeMarkers.map((time) => {
            const position = (time / duration) * 100;
            // Only show every 2nd marker if there are too many
            if (timeMarkers.length > 20 && time % 2000 !== 0) {
              return null;
            }

            return (
              <div
                key={time}
                style={{
                  position: 'absolute',
                  left: `${position}%`,
                  transform: 'translateX(-50%)',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#666',
                }}
              >
                {formatTime(time)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info text */}
      <div style={{
        fontSize: '12px',
        color: '#666',
        fontWeight: 'normal',
      }}>
        Click on any event marker to see detailed decision information.
        Marker size and opacity indicate confidence level.
        {events.some(e => Math.abs(e.snap_delta_ms) > 10) &&
          ' Arrows show quantization adjustments.'}
      </div>
    </motion.div>
  );
}
