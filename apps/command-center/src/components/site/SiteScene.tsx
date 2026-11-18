import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { NODES } from '@/sim/layout';
import { simHolder, useSim, type CameraPreset } from '@/store/sim';
import { Agents } from './Agents';
import { Effects, FixMarker, MeshLinks } from './Effects';
import { SpiderNode } from './Spider';
import { Fence, Gateways, Headframe, Landscape, Ruins, Terrain, Underground } from './Structures';

const PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [115, 78, 128], target: [-15, 0, -5] },
  collar: { pos: [26, 16, 30], target: [0, 4, 0] },
  underground: { pos: [130, -10, 150], target: [0, -60, 0] },
  approach: { pos: [-175, 28, -40], target: [-70, 0, -70] },
};

/** Sun elevation from the simulated clock (0 at night, 1 at noon). */
function daylight(clockS: number): number {
  const h = ((clockS / 3600) % 24 + 24) % 24;
  return Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
}

function CameraRig() {
  const preset = useSim((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const { camera } = useThree();
  const until = useRef(0);
  useEffect(() => {
    until.current = performance.now() + 1800;
  }, [preset]);
  useFrame(() => {
    if (!controls || performance.now() > until.current) return;
    const p = PRESETS[preset];
    camera.position.lerp(new THREE.Vector3(...p.pos), 0.06);
    controls.target.lerp(new THREE.Vector3(...p.target), 0.08);
    controls.update();
  });
  return null;
}

function Lighting() {
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const bg = useThree((s) => s.scene);
  const night = new THREE.Color('#03060d');
  const day = new THREE.Color('#5b7fa6');
  useFrame(() => {
    const d = daylight(simHolder.current?.state.clock ?? 0);
    if (ambient.current) ambient.current.intensity = 0.42 + 0.4 * d;
    if (sun.current) sun.current.intensity = 1.6 * d;
    if (moon.current) moon.current.intensity = 0.95 * (1 - d);
    const c = night.clone().lerp(day, d);
    if (bg.background instanceof THREE.Color) bg.background.copy(c);
    else bg.background = c;
    if (bg.fog instanceof THREE.Fog) bg.fog.color.copy(c);
  });
  return (
    <>
      <ambientLight ref={ambient} intensity={0.2} color="#c7d2fe" />
      <directionalLight ref={sun} position={[120, 160, 60]} intensity={0} color="#fff7ed" castShadow />
      <directionalLight ref={moon} position={[-80, 120, -100]} intensity={0.45} color="#93c5fd" />
      <hemisphereLight args={['#1e3a5f', '#1a140c', 0.25]} />
    </>
  );
}

export function SiteScene() {
  const { reveal, xray, snapshot } = useSim();
  const nightNow = daylight(snapshot?.clock ?? 0) < 0.15;
  const status = new Map(snapshot?.nodes.map((n) => [n.id, n.status]) ?? []);
  return (
    <Canvas camera={{ position: PRESETS.overview.pos, fov: 45, near: 0.5, far: 2000 }} dpr={[1, 2]} shadows gl={{ antialias: true }} aria-label="3D digital twin of a derelict mine shaft">
      <fog attach="fog" args={['#03060d', 260, 720]} />
      <Lighting />
      {nightNow && <Stars radius={600} depth={100} count={3000} factor={6} fade speed={0.2} />}
      <Terrain xray={xray} night={nightNow} />
      <Headframe />
      <Ruins />
      <Fence />
      <Landscape />
      <Gateways reveal={reveal} />
      <Underground visible={xray} />
      {NODES.map((n) => (
        <SpiderNode key={n.id} spec={n} reveal={reveal} tampered={status.get(n.id) === 'tampered'} />
      ))}
      <Agents night={nightNow} />
      <Effects />
      <MeshLinks nodes={snapshot?.nodes ?? []} visible={reveal} />
      <FixMarker fix={snapshot?.fixes.at(-1)} simT={snapshot?.t ?? 0} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxDistance={650} minDistance={8} />
      <CameraRig />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.35} intensity={1.0} />
        <Vignette offset={0.3} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
