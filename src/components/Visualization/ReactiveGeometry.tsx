import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

interface ReactiveGeometryProps {
  audioLevel: number;
  theme: string;
}

export function ReactiveGeometry({ audioLevel, theme }: ReactiveGeometryProps) {
  const meshRef = useRef<Mesh>(null);

  // Get theme colors
  const colors = getThemeColors(theme);

  useFrame(() => {
    if (meshRef.current) {
      // Morph based on audio level
      meshRef.current.scale.setScalar(1 + audioLevel * 0.5);
      meshRef.current.rotation.x += 0.01;
      meshRef.current.rotation.y += 0.01 * (1 + audioLevel);
    }
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial
        color={colors.primary}
        wireframe
        emissive={colors.emissive}
        emissiveIntensity={audioLevel}
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
