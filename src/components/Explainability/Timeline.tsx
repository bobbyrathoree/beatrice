import { motion } from 'framer-motion';
import { EventDecision, EVENT_CLASS_COLORS } from '../../types/explainability';
import type { EventClass } from '../../bindings';

/**
 * A single arranged note projected onto the timeline. `source_event_id` links it
 * back to the detected input event that produced it, so the two lanes can be
 * visually connected (same colour + a connector line) — the "it follows YOU" story.
 */
export interface ArrangedTimelineNote {
  timestamp_ms: number;
  source_event_id: string | null;
  /** Resolved from the source event, used for colouring. */
  class: EventClass | null;
  lane_name: string;
}

interface TimelineProps {
  events: EventDecision[];
  onEventClick: (eventId: string) => void;
  maxDuration?: number; // Duration in ms for timeline width
  /** Arranged notes (output lane). When provided, an input-vs-arrangement A/B view renders. */
  arrangedNotes?: ArrangedTimelineNote[];
}

export function Timeline({ events, onEventClick, maxDuration, arrangedNotes }: TimelineProps) {
  // Calculate max duration if not provided. Consider both input (original) and
  // arranged timestamps so nothing falls off the right edge.
  const duration =
    maxDuration ||
    Math.max(
      ...events.map((e) => e.timestamp_ms),
      ...(arrangedNotes?.map((n) => n.timestamp_ms) ?? []),
      1000
    );

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

  const showArrangement = !!arrangedNotes && arrangedNotes.length > 0;

  // Lane vertical positions inside the SVG connector overlay (0-100 space).
  const INPUT_Y = 22;
  const OUTPUT_Y = 78;

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
        border: '3px solid #000',
        borderRadius: '4px',
        backgroundColor: '#F8F8F8',
        padding: '20px 16px',
      }}>
        {/* Two-lane A/B region: YOU (input) on top, ARRANGEMENT (output) below,
            wired by source_event_id so the "follows you" story is visible. */}
        <div
          data-testid="timeline-lanes"
          style={{
            position: 'relative',
            width: '100%',
            height: showArrangement ? '160px' : '60px',
          }}
        >
          {/* Connector overlay: lines from each input event to the arranged
              notes it produced (matched by source_event_id). Drawn in a 0-100
              coordinate space so percentage x-positions map directly. */}
          {showArrangement && (
            <svg
              data-testid="timeline-connectors"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              {arrangedNotes!.map((note, i) => {
                if (!note.source_event_id) return null;
                const src = events.find((e) => e.event_id === note.source_event_id);
                if (!src) return null;
                const x1 = (src.timestamp_ms / duration) * 100;
                const x2 = (note.timestamp_ms / duration) * 100;
                const color = note.class ? EVENT_CLASS_COLORS[note.class] : '#999';
                return (
                  <line
                    key={`conn-${i}`}
                    x1={x1}
                    y1={INPUT_Y}
                    x2={x2}
                    y2={OUTPUT_Y}
                    stroke={color}
                    strokeWidth={0.4}
                    strokeOpacity={0.55}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          )}

          {/* --- INPUT LANE (YOU) --- */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: showArrangement ? '30px' : '40px',
            zIndex: 2,
          }}>
            {showArrangement && (
              <span style={{
                position: 'absolute',
                left: 0,
                top: '-16px',
                fontSize: '10px',
                fontWeight: 'bold',
                letterSpacing: '1px',
                color: '#000',
              }}>
                YOU (INPUT)
              </span>
            )}
            <div style={{
              position: 'relative',
              height: '100%',
              backgroundColor: '#000',
              borderRadius: '2px',
            }}>
              {events.map((event, index) => {
                // Input lane uses the ORIGINAL (pre-quantize) timestamp.
                const position = (event.timestamp_ms / duration) * 100;
                const color = EVENT_CLASS_COLORS[event.class];
                const size = 8 + (event.confidence * 12); // 8-20px by confidence
                const opacity = 0.4 + (event.confidence * 0.6);

                return (
                  <motion.div
                    key={event.event_id}
                    data-testid="timeline-input-marker"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: index * 0.02 }}
                    whileHover={{ scale: 1.5, zIndex: 10 }}
                    onClick={() => onEventClick(event.event_id)}
                    title={`Detected ${event.class} @ ${formatTime(event.timestamp_ms)}`}
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
                  />
                );
              })}
            </div>
          </div>

          {/* --- OUTPUT LANE (ARRANGEMENT) --- */}
          {showArrangement && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '30px',
              zIndex: 2,
            }}>
              <span style={{
                position: 'absolute',
                left: 0,
                top: '-16px',
                fontSize: '10px',
                fontWeight: 'bold',
                letterSpacing: '1px',
                color: '#000',
              }}>
                ARRANGEMENT (OUTPUT)
              </span>
              <div style={{
                position: 'relative',
                height: '100%',
                backgroundColor: '#000',
                borderRadius: '2px',
              }}>
                {arrangedNotes!.map((note, i) => {
                  const position = (note.timestamp_ms / duration) * 100;
                  const color = note.class ? EVENT_CLASS_COLORS[note.class] : '#999';
                  return (
                    <motion.div
                      key={`note-${i}`}
                      data-testid="timeline-output-marker"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: i * 0.01 }}
                      whileHover={{ scale: 1.4, zIndex: 10 }}
                      onClick={() =>
                        note.source_event_id && onEventClick(note.source_event_id)
                      }
                      title={`${note.lane_name} @ ${formatTime(note.timestamp_ms)}`}
                      style={{
                        position: 'absolute',
                        left: `${position}%`,
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '10px',
                        height: '16px',
                        backgroundColor: color,
                        border: '2px solid #000',
                        borderRadius: '2px',
                        cursor: note.source_event_id ? 'pointer' : 'default',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
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
        {showArrangement
          ? 'Top lane = your detected hits; bottom lane = the notes the arranger placed. Lines connect each note back to the hit that triggered it — the arrangement follows YOU. Click any marker for details.'
          : 'Click on any event marker to see detailed decision information. Marker size and opacity indicate confidence level.'}
      </div>
    </motion.div>
  );
}
