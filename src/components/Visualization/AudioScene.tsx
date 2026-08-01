import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { ReactiveGeometry } from './ReactiveGeometry';
import { ParticleField } from './ParticleField';
import { EventPillars } from './EventPillars';
import { ProcessingIndicator } from './ProcessingIndicator';
import type { DetectedEvent } from '../../types/visualization';
import type { ThemeVisuals } from '../../bindings';

interface AudioSceneProps {
  audioLevel: number;      // 0-1 current audio level
  events: DetectedEvent[]; // Events for visualization
  /** Active theme's curated colours (from Theme.visuals); null before load. */
  visuals?: ThemeVisuals | null;
  isProcessing: boolean;   // Show processing state
  progress: number;        // Processing progress 0-1
}

export function AudioScene({
  audioLevel,
  events,
  visuals,
  isProcessing,
  progress
}: AudioSceneProps) {
  return (
    <Canvas style={{ width: '100%', height: '100%' }}>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} />
      <OrbitControls enableZoom={false} />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />

      <ReactiveGeometry audioLevel={audioLevel} visuals={visuals} />
      <ParticleField events={events} />
      {events.filter(e => e.class === 'BilabialPlosive').map((e, i) => (
        <EventPillars key={i} event={e} visuals={visuals} />
      ))}

      {isProcessing && <ProcessingIndicator progress={progress} />}
    </Canvas>
  );
}
