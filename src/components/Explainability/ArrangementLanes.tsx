import { motion } from 'framer-motion';
import { useMemo } from 'react';

interface ArrangementNote {
  timestamp_ms: number;
  duration_ms: number;
  velocity: number;
  midi_note?: number;
}

interface ArrangementLane {
  name: string;
  events: ArrangementNote[];
}

interface Arrangement {
  drum_lanes: ArrangementLane[];
  bass_lane?: ArrangementLane;
  pad_lane?: ArrangementLane;
  arp_lane?: ArrangementLane;
  total_duration_ms: number;
}

interface ArrangementLanesProps {
  arrangement: Arrangement;
  currentTime: number; // in seconds
  isPlaying: boolean;
  themeName?: string;
}

export function ArrangementLanes({ arrangement, currentTime, isPlaying, themeName }: ArrangementLanesProps) {
  const loopCount = 4;
  const loopDurationMs = arrangement.total_duration_ms;
  const totalSongDurationMs = loopDurationMs * loopCount;
  
  const lanes = useMemo(() => {
    const allLanes = [
      ...arrangement.drum_lanes,
      arrangement.bass_lane,
      arrangement.pad_lane,
      arrangement.arp_lane,
    ].filter(Boolean) as ArrangementLane[];
    return allLanes;
  }, [arrangement]);

  // Map lane names to shorter display names
  const getDisplayName = (name: string) => {
    const n = name.toUpperCase();
    if (n.includes('KICK')) return 'KICK';
    if (n.includes('SNARE')) return 'SNARE';
    if (n.includes('HIHAT')) return 'HIHAT';
    return n;
  };

  // Check if a lane should be muted in a specific loop (Song Mode logic)
  const isLaneActiveInLoop = (laneName: string, loopIdx: number) => {
    const name = laneName.toUpperCase();
    if (loopIdx === 0) return name.includes('KICK') || name.includes('HIHAT');
    if (loopIdx === 1) return name.includes('KICK') || name.includes('HIHAT') || name.includes('SNARE') || name.includes('BASS');
    if (loopIdx === 2) return true;
    if (loopIdx === 3) return name.includes('BASS');
    return false;
  };

  const getLoopColor = (loopIdx: number) => {
    switch(loopIdx) {
      case 0: return '#00FFFF'; // Cyan
      case 1: return '#00FF00'; // Green
      case 2: return '#FF00FF'; // Magenta
      case 3: return '#FF0000'; // Red
      default: return '#666';
    }
  };

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
        boxShadow: '4px 4px 0 0 #000',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', textTransform: 'uppercase' }}>
          SONG ARRANGEMENT (16 BARS)
        </h3>
        {isPlaying && (
          <div style={{ 
            fontSize: '12px', 
            fontWeight: 'bold', 
            backgroundColor: '#000', 
            color: '#FFF', 
            padding: '4px 12px',
            borderRadius: '4px'
          }}>
            LIVE PLAYHEAD
          </div>
        )}
      </div>

      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        border: '3px solid #000',
        borderRadius: '4px',
        backgroundColor: '#000',
        padding: '4px',
        overflow: 'hidden',
      }}>
        {lanes.map((lane) => (
          <div key={lane.name} style={{
            height: '24px',
            display: 'flex',
            position: 'relative',
            backgroundColor: '#111',
            borderRadius: '2px',
          }}>
            {/* Lane Label */}
            <div style={{
              width: '80px',
              height: '100%',
              backgroundColor: '#222',
              color: '#666',
              fontSize: '10px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '8px',
              borderRight: '1px solid #333',
              zIndex: 5,
            }}>
              {getDisplayName(lane.name)}
            </div>

            {/* Note Grid */}
            <div style={{ flex: 1, position: 'relative', height: '100%' }}>
              {[0, 1, 2, 3].map((loopIdx) => {
                const isActive = isLaneActiveInLoop(lane.name, loopIdx);
                if (!isActive) return null;

                const color = getLoopColor(loopIdx);
                const loopStartPercent = (loopIdx / loopCount) * 100;
                
                return (
                  <div key={loopIdx} style={{
                    position: 'absolute',
                    left: `${loopStartPercent}%`,
                    width: `${100 / loopCount}%`,
                    height: '100%',
                  }}>
                    {lane.events.map((note, i) => {
                      const notePos = (note.timestamp_ms / loopDurationMs) * 100;
                      const noteWidth = (note.duration_ms / loopDurationMs) * 100;
                      
                      return (
                        <div
                          key={i}
                          style={{
                            position: 'absolute',
                            left: `${notePos}%`,
                            width: `${Math.max(1, noteWidth)}%`,
                            height: '60%',
                            top: '20%',
                            backgroundColor: color,
                            borderRadius: '1px',
                            opacity: 0.8,
                            boxShadow: `0 0 4px ${color}44`,
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Section Markers */}
        <div style={{
          display: 'flex',
          height: '16px',
          backgroundColor: '#222',
          marginTop: '4px',
          borderRadius: '2px',
        }}>
          <div style={{ width: '80px' }} />
          {['INTRO', 'BUILD', 'DROP', 'OUTRO'].map((name, i) => (
            <div key={name} style={{
              flex: 1,
              fontSize: '9px',
              fontWeight: 'bold',
              color: getLoopColor(i),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: i < 3 ? '1px solid #333' : 'none',
            }}>
              {name}
            </div>
          ))}
        </div>

        {/* Playhead */}
        {isPlaying && (
          <motion.div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '80px',
              width: '2px',
              backgroundColor: '#FFF',
              boxShadow: '0 0 10px #FFF',
              zIndex: 10,
              pointerEvents: 'none',
            }}
            animate={{
              left: `calc(80px + ${Math.min(100, (currentTime / (totalSongDurationMs / 1000)) * 100)}% - 80px * ${currentTime / (totalSongDurationMs / 1000)})`
            }}
            // Use a simpler approach for the left calculation
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `calc(80px + (100% - 80px) * ${Math.min(1, currentTime / (totalSongDurationMs / 1000))})`,
              width: '2px',
              backgroundColor: '#FFF',
              boxShadow: '0 0 10px #FFF',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      <div style={{ fontSize: '12px', color: '#666' }}>
        The arrangement evolves across 4 phases. 
        <span style={{ color: getLoopColor(0), marginLeft: '8px' }}>● Intro</span>
        <span style={{ color: getLoopColor(1), marginLeft: '8px' }}>● Build</span>
        <span style={{ color: getLoopColor(2), marginLeft: '8px' }}>● Peak</span>
        <span style={{ color: getLoopColor(3), marginLeft: '8px' }}>● Outro</span>
      </div>
    </motion.div>
  );
}
