import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { DetectedEvent } from '../../types/visualization';
import type { ThemeVisuals } from '../../bindings';
import { sceneColors } from './themeColors';

interface EventPillarsProps {
  event: DetectedEvent;
  /** The active theme's curated colours; undefined before summaries load. */
  visuals?: ThemeVisuals | null;
}

export function EventPillars({ event, visuals }: EventPillarsProps) {
  const meshRef = useRef<Mesh>(null);
  const colors = sceneColors(visuals);

  // Position based on event timestamp (normalized to scene width)
  const x = (event.timestamp_ms / 1000) * 2 - 5;  // Map to -5 to +5

  useFrame((state) => {
    if (meshRef.current) {
      // Pulse effect
      const pulse = Math.sin(state.clock.elapsedTime * 4) * 0.1 + 1;
      meshRef.current.scale.y = pulse * event.confidence;
    }
  });

  return (
    <mesh ref={meshRef} position={[x, 0, 0]}>
      <boxGeometry args={[0.1, 2, 0.1]} />
      <meshStandardMaterial
        color={colors.primary}
        emissive={colors.emissive}
        emissiveIntensity={0.8}
      />
    </mesh>
  );
}

// Colours come from the theme's own `visuals` via the shared `sceneColors`
// helper — this file used to carry a duplicate switch on theme NAME.
