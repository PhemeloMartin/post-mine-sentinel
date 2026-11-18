import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Rotating radar wedge with a fading trail and concentric range rings.
const fragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  #define TAU 6.28318530718
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    float sweep = mod(a - uTime * 0.9, TAU);
    float trail = exp(-sweep * 2.4) * 0.55;
    // NB: GLSL smoothstep is undefined when edge0 >= edge1, so fades are written as 1 - smoothstep.
    float rings = smoothstep(0.47, 0.5, abs(fract(r * 5.0) - 0.5)) * 0.12;
    float edge = 1.0 - smoothstep(0.97, 1.0, r);
    float alpha = (trail + rings) * edge * (1.0 - r * 0.55);
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export function RadarSweep({ position, radius }: { position: [number, number, number]; radius: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#22d3ee') } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} material={material}>
      <planeGeometry args={[radius * 2, radius * 2]} />
    </mesh>
  );
}
