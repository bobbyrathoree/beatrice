import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { DetectedEvent } from '../../types/visualization';

interface EventPillarsProps {
  event: DetectedEvent;
  theme: string;
}

export function EventPillars({ event, theme }: EventPillarsProps) {
  const meshRef = useRef<Mesh>(null);
  const colors = getThemeColors(theme);

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

function getThemeColors(theme: string) {
  switch (theme) {
    case 'BLADE RUNNER':
      return { primary: '#FF6B00', emissive: '#FF3300' };  // Orange/amber
    case 'STRANGER THINGS':
      return { primary: '#FF0055', emissive: '#FF0000' };  // Red/pink
    default:
      return { primary: '#00FFFF', emissive: '#0088FF' };  // Cyan
  }
}
