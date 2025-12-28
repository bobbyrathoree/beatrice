import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { ReactiveGeometry } from './ReactiveGeometry';
import { ParticleField } from './ParticleField';
import { EventPillars } from './EventPillars';
import { ProcessingIndicator } from './ProcessingIndicator';
import type { DetectedEvent } from '../../types/visualization';

interface AudioSceneProps {
  audioLevel: number;      // 0-1 current audio level
  events: DetectedEvent[]; // Events for visualization
  theme: string;           // Current theme for colors
  isProcessing: boolean;   // Show processing state
  progress: number;        // Processing progress 0-1
}

export function AudioScene({
  audioLevel,
  events,
  theme,
  isProcessing,
  progress
}: AudioSceneProps) {
  return (
    <Canvas style={{ width: '100%', height: '100%' }}>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} />
      <OrbitControls enableZoom={false} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />

      <ReactiveGeometry audioLevel={audioLevel} theme={theme} />
      <ParticleField events={events} />
      {events.filter(e => e.class === 'BilabialPlosive').map((e, i) => (
        <EventPillars key={i} event={e} theme={theme} />
      ))}

      {isProcessing && <ProcessingIndicator progress={progress} />}
    </Canvas>
  );
}
