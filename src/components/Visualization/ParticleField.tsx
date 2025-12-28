import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import type { Points as ThreePoints } from 'three';
import type { DetectedEvent } from '../../types/visualization';

interface ParticleFieldProps {
  events: DetectedEvent[];
}

export function ParticleField({}: ParticleFieldProps) {
  const pointsRef = useRef<ThreePoints>(null);

  // Generate particle positions
  const particles = useMemo(() => {
    const positions = new Float32Array(1000 * 3);
    for (let i = 0; i < 1000; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 10;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    return positions;
  }, []);

  useFrame(() => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += 0.001;
      // Could animate particles toward event positions
    }
  });

  return (
    <Points ref={pointsRef} positions={particles} stride={3}>
      <PointMaterial
        transparent
        color="#ffffff"
        size={0.02}
        sizeAttenuation
        depthWrite={false}
      />
    </Points>
  );
}
