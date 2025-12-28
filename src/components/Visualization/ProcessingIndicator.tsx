import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import type { Mesh } from 'three';

interface ProcessingIndicatorProps {
  progress: number;
}

export function ProcessingIndicator({ progress }: ProcessingIndicatorProps) {
  const ringRef = useRef<Mesh>(null);

  useFrame(() => {
    if (ringRef.current) {
      ringRef.current.rotation.z += 0.02;
    }
  });

  return (
    <group position={[0, -2, 0]}>
      <mesh ref={ringRef}>
        <torusGeometry args={[0.5, 0.05, 16, 100, Math.PI * 2 * progress]} />
        <meshStandardMaterial color="#00FF00" emissive="#00FF00" emissiveIntensity={0.5} />
      </mesh>
      <Text
        position={[0, 0, 0.1]}
        fontSize={0.2}
        color="#FFFFFF"
        anchorX="center"
        anchorY="middle"
      >
        {`${Math.round(progress * 100)}%`}
      </Text>
    </group>
  );
}
