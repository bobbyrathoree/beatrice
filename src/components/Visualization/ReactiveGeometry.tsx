import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { ThemeVisuals } from '../../bindings';
import { sceneColors } from './themeColors';

interface ReactiveGeometryProps {
  audioLevel: number;
  /** The active theme's curated colours; undefined before summaries load. */
  visuals?: ThemeVisuals | null;
}

export function ReactiveGeometry({ audioLevel, visuals }: ReactiveGeometryProps) {
  const meshRef = useRef<Mesh>(null);

  const colors = sceneColors(visuals);

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

// Colours come from the theme's own `visuals` (see themeColors) — this file used
// to switch on theme NAME, which silently rendered generic cyan for any theme
// the switch didn't know about.
